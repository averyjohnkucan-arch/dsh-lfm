import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Runtime } from "../lib/runtime.js";
import { gguf } from "./fixture.js";
const require = createRequire(import.meta.url);
const React = require("react"),
  { JSDOM } = require("jsdom");

test("real settings UI selects files, saves names/KV/context, and prompts for missing VL projector", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lfm-ui-")),
    folder = join(dir, "models");
  await mkdir(folder);
  await gguf(join(folder, "Text.gguf"));
  await gguf(join(folder, "Vision.gguf"), { vision: true });
  const runtime = new Runtime({ dataDir: dir });
  await runtime.init();
  const loaded = [];
  runtime.acquire = async (p) => {
    loaded.push(structuredClone(p));
    return { state: {}, release() {} };
  };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost:8298",
  });
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let Card, poll;
  const browserWindow = dom.window;
  browserWindow.__DSH_LFM__ = {
    path: "/plugins/dsh-lfm/action",
    token: "fixture",
  };
  browserWindow.__ModuleLoader__ = {
    load(spec) {
      assert.equal(spec.id, "dsh-lfm");
      spec
        .factory(() => React)
        .apply({
          slots: {
            inject(key, fn) {
              assert.equal(key, "settings.models.footer");
              fn();
            },
            register(spec, component) {
              Card = component;
              return () => {};
            },
          },
        });
    },
  };
  const inflight = new Set();
  const fetch = async (_path, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture");
    const { action, payload } = JSON.parse(options.body);
    const task = runtime.action(
      action,
      action === "browse" && !payload.path ? { path: folder } : payload,
    );
    inflight.add(task);
    try {
      const result = await task;
      return { ok: true, json: async () => ({ result }) };
    } catch (e) {
      return { ok: false, json: async () => ({ error: e.message }) };
    } finally {
      inflight.delete(task);
    }
  };
  vm.runInNewContext(
    await readFile(new URL("../client.js", import.meta.url), "utf8"),
    {
      window: browserWindow,
      fetch,
      structuredClone,
      setInterval(fn) {
        poll = fn;
        return 1;
      },
      clearInterval() {},
    },
  );
  const { createRoot } = require("react-dom/client"),
    root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(() => root.unmount());
    await runtime.dispose();
    dom.window.close();
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    await rm(dir, { recursive: true, force: true });
  });
  const tick = () => new Promise((r) => setImmediate(r));
  const settle = async () => {
    await tick();
    do {
      await Promise.allSettled([...inflight]);
      await runtime.jobs.tail;
      await runtime.writes;
      await tick();
    } while (inflight.size);
    await poll?.();
    await tick();
  };
  const click = async (text) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    assert.ok(b, text);
    assert.equal(b.disabled, false, text);
    await React.act(async () => {
      b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await settle();
    });
  };
  await React.act(async () => {
    root.render(React.createElement(Card));
    await settle();
  });
  await click("Select model file");
  await click("Text.gguf");
  assert.equal(loaded.length, 1);
  assert.equal(runtime.profiles.length, 1);
  await click("Settings");
  const context = document.querySelector('select[aria-label="Context"]');
  assert.equal(context.value, "262144");
  const k = document.querySelector('select[aria-label="K cache precision"]');
  await React.act(async () => {
    context.value = "65536";
    context.dispatchEvent(new window.Event("change", { bubbles: true }));
    k.value = "q8_0";
    k.dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick();
  });
  await React.act(async () => {
    document
      .querySelector('form[aria-label="LFM model settings"]')
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await settle();
  });
  assert.equal(runtime.profiles[0].context, 65536);
  assert.equal(runtime.profiles[0].kvK, "q8_0");
  await click("Select model file");
  await click("Vision.gguf");
  assert.match(document.body.textContent, /Required — select/);
  assert.equal(loaded.length, 1);
  assert.equal(
    document.querySelector('select[aria-label="Context"]').value,
    "128000",
  );
  await gguf(join(folder, "mmproj.gguf"), { projector: true });
  await click("Select projector");
  await click("mmproj.gguf");
  await click("Save and load");
  assert.equal(loaded.length, 2);
  assert.equal(loaded[1].projectorPath, join(folder, "mmproj.gguf"));
  assert.equal(runtime.profiles.length, 2);
  assert.match(document.body.textContent, /Vision/);
});
