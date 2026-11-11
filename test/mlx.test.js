import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectModel, modelParts } from "../lib/models.js";
import {
  freshProfile,
  validateProfile,
  applySampling,
  launchArgs,
} from "../lib/profiles.js";
import { mlxLaunch, mlxEnvironment, checkMlx } from "../lib/mlx.js";
import { Runtime } from "../lib/runtime.js";
import { benchmark } from "../lib/benchmark.js";

async function snapshot(t) {
  const root = await mkdtemp(join(tmpdir(), "lfm-mlx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "renamed-checkpoint");
  await mkdir(path);
  const config = {
    model_type: "lfm3",
    architectures: ["Lfm3ForCausalLM"],
    hidden_size: 2048,
    num_hidden_layers: 24,
    vocab_size: 128000,
    quantization: { bits: 4, mode: "affine", group_size: 64 },
    max_position_embeddings: 262144,
  };
  const json = (name, value) =>
    writeFile(join(path, name), JSON.stringify(value));
  await json("config.json", config);
  await json("tokenizer_config.json", {});
  await json("tokenizer.json", {});
  await writeFile(join(path, "model.safetensors"), Buffer.alloc(8));
  return { root, path, config, json };
}

test("MLX detection is local, metadata-based and checks indexed shards safely", async (t) => {
  const { path, config, json } = await snapshot(t);
  const model = await inspectModel(path);
  assert.equal(model.backend, "mlx-vlm");
  assert.equal(model.vision, false);
  assert.equal((await modelParts(path)).length, 1);
  await json("config.json", { ...config, model_type: "llama" });
  await assert.rejects(inspectModel(path), /MLX snapshot/);
  await json("config.json", { ...config, quantization: undefined });
  await assert.rejects(inspectModel(path), /MLX snapshot/);
  await json("config.json", config);
  await json("model.safetensors.index.json", {
    weight_map: { a: "../outside.safetensors" },
  });
  await assert.rejects(inspectModel(path), /Unsafe/);
  await json("model.safetensors.index.json", {
    weight_map: { a: "missing.safetensors" },
  });
  await assert.rejects(inspectModel(path), /ENOENT/);
  await json("model.safetensors.index.json", { weight_map: {} });
  await assert.rejects(inspectModel(path), /Missing/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(inspectModel(path, abort.signal), {
    name: "AbortError",
  });
});

test("MLX profiles persist independently, fail closed on format changes and isolate flags", async (t) => {
  const { root, path } = await snapshot(t);
  const runtime = new Runtime({ dataDir: join(root, "state") });
  t.after(() => runtime.dispose());
  await runtime.init();
  const p = await runtime.addModel(path);
  assert.equal(p.backend, "mlx-vlm");
  assert.throws(() => mlxLaunch(p, "linux", "x64"), /Apple Silicon/);
  assert.throws(() => mlxLaunch(p, "darwin", "arm64"), /absolute path/);
  p.mlxPython = "/venv/bin/python";
  const launch = mlxLaunch(p, "darwin", "arm64");
  assert.ok(launch.args.includes("mlx_vlm.server"));
  for (const flag of [
    "--alias",
    "--fit",
    "--ctx-size",
    "--cors-origins",
    "--trust-remote-code",
  ])
    assert.ok(!launch.args.includes(flag));
  const env = mlxEnvironment("new-key", {
    PATH: "/bin",
    MLX_VLM_PRELOAD_IMAGE_MODEL: "foreign",
    MLX_VLM_DRAFT_MODEL: "foreign",
    MAX_KV_SIZE: "128",
    MLX_TRUST_REMOTE_CODE: "true",
  });
  assert.equal(env.HF_HUB_OFFLINE, "1");
  assert.equal(env.MLX_VLM_SERVER_API_KEY, "new-key");
  assert.equal(env.MLX_TRUST_REMOTE_CODE, "false");
  assert.equal(env.MLX_VLM_PRELOAD_IMAGE_MODEL, undefined);
  assert.equal(env.MLX_VLM_DRAFT_MODEL, undefined);
  assert.equal(env.MAX_KV_SIZE, undefined);
  assert.equal(env.PATH, "/bin");
  assert.throws(() => launchArgs(p), /own launcher/);
  assert.throws(() => validateProfile({ ...p, backend: "unknown" }), /backend/);
  assert.throws(() => validateProfile({ ...p, context: 4096 }), /context caps/);
  assert.throws(
    () => mlxLaunch({ ...p, kvK: "q8_0" }, "darwin", "arm64"),
    /KV precision/,
  );
  await assert.rejects(runtime.save({ ...p, backend: "llama.cpp" }), /Backend/);
  await runtime.save(p);
  const restarted = new Runtime({ dataDir: runtime.root });
  await restarted.init();
  assert.equal(restarted.find(p.id).mlxPython, p.mlxPython);
  await restarted.dispose();
  await assert.rejects(benchmark(runtime, p.id), /unavailable/);
  const body = {
    model: p.id,
    tools: [{ type: "function" }],
    cache_prompt: true,
    id_slot: 0,
  };
  applySampling(body, p);
  assert.equal(body.model, path);
  assert.equal(body.repetition_penalty, 1.1);
  assert.equal(body.enable_thinking, true);
  assert.equal(body.repeat_penalty, undefined);
  assert.equal(body.id_slot, undefined);
  assert.equal(body.cache_prompt, undefined);
  assert.equal(body.tools.length, 1);
  const legacy = { ...p };
  delete legacy.backend;
  delete legacy.mlxPython;
  assert.equal(validateProfile(legacy).backend, "llama.cpp");
  assert.equal(
    freshProfile({ ...(await inspectModel(path)), backend: undefined }).backend,
    "llama.cpp",
  );
  const saved = JSON.parse(await readFile(join(runtime.root, "profiles.json")));
  assert.equal(saved.profiles[0].backend, "mlx-vlm");
});

test("owned MLX process uses authenticated loaded identity, cleans up aborted startup and wrong identities (CPU fixture)", async (t) => {
  const { root, path } = await snapshot(t);
  const runtime = new Runtime({ dataDir: join(root, "state") });
  t.after(() => runtime.dispose());
  await runtime.init();
  const p = await runtime.addModel(path);
  const http = await import("node:http");
  const portServer = http.createServer();
  await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
  p.port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  // Only this test worker sees the mock host. No MLX imports/inference occur.
  const host = ["platform", "arch"].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(process, k),
  ]);
  for (const [k, value] of [
    ["platform", "darwin"],
    ["arch", "arm64"],
  ])
    Object.defineProperty(process, k, { value, configurable: true });
  t.after(() => {
    for (const [k, descriptor] of host)
      Object.defineProperty(process, k, descriptor);
  });
  const executable = join(root, "python-fixture");
  const source = `#!${process.execPath}
const http = require('node:http');
const args = process.argv.slice(2);
if (args[0] === '-c') process.exit(0);
if (args.includes('--fit') || args.includes('--alias') || !process.env.MLX_VLM_SERVER_API_KEY) process.exit(2);
const key = process.env.MLX_VLM_SERVER_API_KEY;
console.log(key);
if (process.argv[1].endsWith('slow')) setInterval(() => {}, 1000);
else http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + key) { res.writeHead(401); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  const id = process.argv[1].endsWith('wrong') ? 'wrong' : args[args.indexOf('--model') + 1];
  res.end(JSON.stringify({data: [{id, loaded: true}]}));
}).listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1');
`;
  for (const suffix of ["", "slow", "wrong"])
    await writeFile(executable + suffix, source, { mode: 0o700 });
  p.mlxPython = executable;
  await runtime.save(p);
  runtime.ensureEngine = () => {
    throw Error("Must not install llama.cpp for MLX");
  };
  const lease = await runtime.acquire(p);
  const state = lease.state;
  lease.release();
  assert.equal(state.ready, true);
  assert.equal((await fetch(state.url + "/v1/models")).status, 401);
  assert.equal(state.log.includes(state.apiKey), false);
  assert.match(state.log, /local key/);
  await runtime.unload(p.id);
  assert.equal(runtime.running.size, 0);
  const abort = new AbortController();
  const starting = runtime.start(
    { ...p, mlxPython: executable + "slow" },
    abort.signal,
  );
  const timer = setTimeout(() => abort.abort(), 250);
  await assert.rejects(starting);
  clearTimeout(timer);
  assert.equal(runtime.running.size, 0);
  assert.equal(runtime.starting.size, 0);
  await assert.rejects(
    runtime.start({ ...p, mlxPython: executable + "wrong" }),
    /identity/,
  );
  assert.equal(runtime.running.size, 0);
});

test("Python preflight rejects old/prerelease MLX and nonnative interpreters without importing MLX", async (t) => {
  const { run } = await import("../lib/process.js");
  let python;
  try {
    python = (
      await run("python3", ["-c", "import sys; print(sys.executable)"])
    ).stdout.trim();
  } catch {
    t.skip("Python 3 not available for the optional preflight probe test");
    return;
  }
  const { root } = await snapshot(t);
  for (const [version, arch, success] of [
    ["0.7.11", "arm64", true],
    ["0.7.10", "arm64", false],
    ["0.7.12rc1", "arm64", false],
    ["0.7.11", "x86_64", false],
  ]) {
    const shim = join(root, "python-" + version + arch);
    await writeFile(
      shim,
      `#!${python}
import sys, platform, importlib.metadata
platform.system = lambda: 'Darwin'
platform.machine = lambda: '${arch}'
importlib.metadata.version = lambda name: '${version}'
exec(sys.argv[2])
`,
      { mode: 0o700 },
    );
    if (success) await checkMlx(shim);
    else await assert.rejects(checkMlx(shim), /stable required|Apple Silicon/);
  }
});
