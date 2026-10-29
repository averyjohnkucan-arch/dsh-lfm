import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gguf } from "./fixture.js";
import {
  inspectModel,
  inspectProjector,
  modelParts,
  findProjector,
} from "../lib/models.js";

async function root(t) {
  const d = await mkdtemp(join(tmpdir(), "lfm-model-"));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}
test("recognizes text/VL from metadata after arbitrary filename changes and accepts GGUF quantizations", async (t) => {
  const d = await root(t);
  for (const fileType of [0, 1, 2, 7, 8, 12, 15, 32, 36, 39]) {
    const p = join(d, "arbitrary-" + fileType + ".gguf");
    await gguf(p, { fileType });
    assert.equal((await inspectModel(p)).model, "LFM3-1.7B");
  }
  const p = join(d, "vision.gguf");
  await gguf(p, { vision: true });
  const value = await inspectModel(p);
  assert.equal(value.vision, true);
  assert.equal(value.nativeContext, 128000);
  await gguf(p, { architecture: "qwen35" });
  await assert.rejects(inspectModel(p), /Other models/);
  await writeFile(p, "invalid");
  await assert.rejects(inspectModel(p), /GGUF|Truncated/);
});
test("any selected shard resolves the first shard, and missing/mismatched shards cannot load", async (t) => {
  const d = await root(t),
    first = join(d, "text-00001-of-00002.gguf"),
    second = join(d, "text-00002-of-00002.gguf");
  await gguf(first, { index: 0, count: 2 });
  await assert.rejects(modelParts(first), /Missing/);
  await gguf(second, { index: 1, count: 2 });
  assert.equal((await modelParts(second))[0].path, first);
  await gguf(second, { index: 1, count: 2, vision: true });
  await assert.rejects(modelParts(first), /inconsistent/);
});
test("finds an adjacent or nested LFM projector but requires choice when ambiguous", async (t) => {
  const d = await root(t),
    model = join(d, "model.gguf");
  await gguf(model, { vision: true });
  assert.equal(await findProjector(model), "");
  await mkdir(join(d, "vision"));
  const projector = join(d, "vision", "mmproj-BF16.gguf");
  await gguf(projector, { projector: true });
  assert.equal(await findProjector(model), projector);
  await gguf(join(d, "mmproj-F16.gguf"), { projector: true });
  assert.equal(await findProjector(model), "");
  await assert.rejects(inspectProjector(model), /projector/);
  await rename(projector, join(d, "vision", "renamed.gguf"));
  assert.equal(
    (await inspectProjector(join(d, "vision", "renamed.gguf"))).architecture,
    "clip",
  );
});
