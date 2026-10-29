import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../lib/runtime.js";
import { apply } from "../index.js";

test("provider registration protects local file actions and disposes background work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lfm-plugin-"));
  const previous = Runtime.prototype.ensureEngine;
  Runtime.prototype.ensureEngine = async function () {
    this.engine = "/fixture";
    return this.engine;
  };
  t.after(async () => {
    Runtime.prototype.ensureEngine = previous;
    await rm(root, { recursive: true, force: true });
  });
  const disposers = [];
  let handler,
    injectIndex,
    adapter,
    removed = false;
  const registration = () => {
    removed = true;
  };
  registration.replace = () => {};
  const ctx = {
    llm: {
      registerAdapter(ids, instance) {
        assert.deepEqual(ids, ["lfm"]);
        adapter = instance;
        return registration;
      },
    },
    webServer: {
      getOrigin: () => "http://localhost:3080",
      register(spec) {
        handler = spec.handler;
        return () => {};
      },
    },
    effect(fn) {
      const d = fn();
      if (d) disposers.push(d);
    },
    inject() {},
    on(name, fn) {
      assert.equal(name, "webserver/index-inject");
      injectIndex = fn;
    },
  };
  await apply(ctx, { dataDir: root });
  const table = [];
  injectIndex(table);
  assert.equal(table[0].name, "__DSH_LFM__");
  async function call({
    token = table[0].value.token,
    origin = "http://localhost:3080",
    method = "POST",
    body = { action: "list" },
  } = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.headers = {
      authorization: "Bearer " + token,
      origin,
      "content-type": "application/json",
    };
    req.method = method;
    const res = {
      status: 200,
      setHeader() {},
      writeHead(code) {
        this.status = code;
      },
      end(text) {
        this.value = JSON.parse(text);
      },
    };
    await handler(req, res);
    return res;
  }
  assert.equal((await call({ token: "" })).status, 401);
  assert.equal((await call({ origin: "http://foreign.invalid" })).status, 403);
  assert.equal((await call({ method: "GET" })).status, 405);
  assert.equal((await call()).value.result.profiles.length, 0);
  assert.deepEqual(await adapter.listModels(), []);
  assert.equal((await call({ body: { action: "unknown" } })).status, 400);
  for (const dispose of disposers.reverse()) await dispose();
  assert.equal(removed, true);
});
