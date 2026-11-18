import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../lib/runtime.js";
import { gguf } from "./fixture.js";

test("portable config restores renamed vision shards, projector and settings to a new persistent profile", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lfm-transfer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const weights = join(dir, "weights");
  await mkdir(weights);
  const one = join(weights, "Vision-00001-of-00002.gguf"),
    two = join(weights, "Vision-00002-of-00002.gguf");
  await gguf(one, { vision: true, count: 2 });
  await gguf(two, { vision: true, count: 2, index: 1 });
  const proj = join(weights, "mmproj.gguf");
  await gguf(proj, { projector: true });
  const runtime = new Runtime({ dataDir: join(dir, "profiles") });
  await runtime.init();
  t.after(() => runtime.dispose());
  const p = await runtime.addModel(one);
  await runtime.save({
    ...p,
    name: "Camera",
    reasoningModes: [
      {
        id: "mode-vision",
        name: "My Vision",
        thinking: false,
        maxTokens: 99,
        sampling: { ...p.sampling, temperature: 0.2 },
      },
    ],
    defaultMode: "mode-vision",
    context: 65536,
    kvK: "q8_0",
    executable: "/local/private",
    thinking: false,
  });
  async function job(action, payload) {
    const { id } = await runtime.action(action, payload);
    await runtime.jobs.tail;
    return runtime.jobs.list().find((j) => j.id === id);
  }
  const exported = await job("export-config", { id: p.id });
  assert.equal(exported.status, "complete", exported.error);
  const config = exported.result;
  assert.deepEqual(
    config.files.map((f) => f.role),
    ["model", "part", "projector"],
  );
  assert.ok(!JSON.stringify(config).includes(dir));
  assert.ok(!JSON.stringify(config).includes("/local/private"));
  await rename(two, join(weights, "renamed.data"));
  await rename(proj, join(weights, "renamed-projector.data"));
  const bad = structuredClone(config);
  bad.files[0].md5 = "0".repeat(32);
  assert.equal(
    (await job("import-config", { config: bad, root: weights })).status,
    "failed",
  );
  assert.equal(runtime.profiles.length, 1);
  config.settings.executable = "/untrusted";
  config.settings.port = 1;
  config.settings.id = p.id;
  const imported = await job("import-config", { config, root: weights });
  assert.equal(imported.status, "complete", imported.error);
  const q = imported.result;
  assert.notEqual(p.id, q.id);
  assert.notEqual(p.port, q.port);
  assert.equal(q.name, "Camera");
  assert.deepEqual(q.reasoningModes, runtime.find(p.id).reasoningModes);
  assert.equal(q.defaultMode, "mode-vision");
  assert.equal(q.thinking, false);
  assert.equal(q.kvK, "q8_0");
  assert.equal(q.context, 65536);
  assert.equal(q.executable, "");
  const again = await job("export-config", { id: q.id });
  assert.deepEqual(again.result.files, config.files);
  const restarted = new Runtime({ dataDir: runtime.root });
  await restarted.init();
  assert.equal(restarted.find(q.id).projectorPath, q.projectorPath);
  await restarted.dispose();
  const malformed = structuredClone(config);
  malformed.settings.kvK = "unknown";
  assert.equal(
    (await job("import-config", { config: malformed, root: weights })).status,
    "failed",
  );
  assert.equal((await readdir(join(runtime.root, "imports"))).length, 1);
});

test("concurrent model imports keep both profiles and allocate distinct ports", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lfm-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "text.gguf");
  await gguf(file);
  const runtime = new Runtime({ dataDir: dir });
  await runtime.init();
  t.after(() => runtime.dispose());
  const profiles = await Promise.all([
    runtime.addModel(file),
    runtime.addModel(file),
  ]);
  assert.notEqual(profiles[0].port, profiles[1].port);
  const restored = new Runtime({ dataDir: dir });
  await restored.init();
  assert.deepEqual(
    restored.profiles.map((p) => p.id).sort(),
    profiles.map((p) => p.id).sort(),
  );
  await restored.dispose();
});
