import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime } from "../lib/runtime.js";
import { launchArgs, validateProfile } from "../lib/profiles.js";
import { gguf } from "./fixture.js";

async function setup(t, vision = false) {
  const dir = await mkdtemp(join(tmpdir(), "lfm-runtime-"));
  const runtime = new Runtime({ dataDir: dir });
  t.after(async () => {
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  await runtime.init();
  const path = join(dir, "model.gguf");
  await gguf(path, { vision });
  return { runtime, dir, path };
}
test("model name/settings survive restart; changing performance settings invalidates the old measurement", async (t) => {
  const { runtime, dir, path } = await setup(t);
  const p = await runtime.addModel(path);
  p.name = "My small coder";
  p.context = 65536;
  p.kvK = "q8_0";
  p.kvV = "q4_0";
  p.benchmark = { decode: 100 };
  await runtime.save(p);
  assert.equal(runtime.find(p.id).benchmark, undefined);
  runtime.find(p.id).benchmark = { decode: 100 };
  await runtime.persist();
  const renamed = structuredClone(runtime.find(p.id));
  renamed.name = "Renamed";
  await runtime.save(renamed);
  assert.equal(runtime.find(p.id).benchmark.decode, 100);
  const restarted = new Runtime({ dataDir: dir });
  await restarted.init();
  assert.equal(restarted.find(p.id).name, "Renamed");
  assert.equal(restarted.find(p.id).context, 65536);
  assert.equal(restarted.find(p.id).kvV, "q4_0");
  await restarted.dispose();
  assert.equal(
    JSON.parse(await readFile(join(dir, "profiles.json"))).version,
    1,
  );
});
test("native fit preserves context/KV and uses no manually forced GPU layers", async (t) => {
  const { runtime, path } = await setup(t);
  const p = await runtime.addModel(path);
  const args = launchArgs(p);
  assert.ok(args.includes("--fit"));
  assert.ok(!args.includes("--n-gpu-layers"));
  assert.equal(args[args.indexOf("--ctx-size") + 1], "262144");
  p.autoFit = false;
  p.gpuLayers = 0;
  const manual = launchArgs(p);
  assert.equal(manual[manual.indexOf("--n-gpu-layers") + 1], "0");
  assert.throws(() => validateProfile({ ...p, context: 262145 }), /context/);
  assert.throws(() => validateProfile({ ...p, kvV: "nvfp4" }), /KV/);
  assert.equal(
    validateProfile({ ...p, options: { "--host": "0.0.0.0" } }).options,
    undefined,
  );
});
test("VL requires a valid matching projector, preserves native 128000 context, and rejects foreign GGUFs", async (t) => {
  const { runtime, dir, path } = await setup(t, true);
  const p = await runtime.addModel(path);
  assert.equal(p.context, 128000);
  assert.throws(() => launchArgs(p), /projector/);
  p.projectorPath = path;
  await assert.rejects(runtime.save(p), /projector/);
  p.projectorPath = join(dir, "mmproj.gguf");
  await gguf(p.projectorPath, { projector: true });
  await runtime.save(p);
  assert.equal(
    launchArgs(p)[launchArgs(p).indexOf("--mmproj") + 1],
    p.projectorPath,
  );
  await gguf(path, { architecture: "qwen35" });
  await assert.rejects(runtime.save(p), /Other models/);
});
test("busy profiles cannot be edited or unloaded, and browser follows model directory links", async (t) => {
  const { runtime, path } = await setup(t);
  const p = await runtime.addModel(path);
  runtime.running.set(p.id, { active: 1 });
  await assert.rejects(runtime.save(p), /active/);
  await assert.rejects(runtime.unload(p.id), /answering/);
  runtime.running.delete(p.id);
  const listing = await runtime.action("browse", { path: runtime.root });
  assert.ok(listing.entries.some((row) => row.path === path));
  await runtime.action("remove", { id: p.id });
  assert.equal(runtime.profiles.length, 0);
});
