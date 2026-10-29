import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyEngine, installEngine } from "../lib/engine-install.js";

test("installed runtime reuse verifies files and detects corruption", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lfm-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "engine", "b11960-cpu");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "lfm-server"), "fixture");
  await writeFile(
    join(target, "installed.json"),
    JSON.stringify({
      key: "b11960-cpu",
      files: [
        {
          name: "lfm-server",
          bytes: 7,
          sha256: createHash("sha256").update("fixture").digest("hex"),
        },
      ],
    }),
  );
  assert.equal(
    await installEngine(root, {
      backend: "cpu",
      request: () => {
        throw Error("Must reuse");
      },
    }),
    join(target, "lfm-server"),
  );
  await writeFile(join(target, "lfm-server"), "changed");
  await assert.rejects(verifyEngine(target, "b11960-cpu"), /checksum/);
});
test("bad downloads fail verification, staging is removed, and retry can start", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lfm-engine-bad-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      installEngine(root, {
        backend: "cpu",
        request: async () => {
          calls++;
          return new Response("corrupt");
        },
      }),
      /checksum/,
    );
  assert.equal(calls, 2);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(join(root, "engine")), []);
});
test("cancellation does not publish an incomplete runtime", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lfm-engine-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    installEngine(root, {
      backend: "cpu",
      signal: controller.signal,
      request: () => {
        throw Error("Must not download");
      },
    }),
    /abort/i,
  );
});
