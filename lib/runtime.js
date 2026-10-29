import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  access,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { Jobs } from "./jobs.js";
import {
  inspectProjector,
  modelParts,
  findProjector,
  browse,
} from "./models.js";
import { freshProfile, validateProfile, launchArgs } from "./profiles.js";
import { installEngine } from "./engine-install.js";
import { ready, terminate, run } from "./process.js";
import { benchmark } from "./benchmark.js";

export class Runtime {
  constructor(config = {}, changed = () => {}) {
    this.root = resolve(
      config.dataDir ||
        join(process.env.DSH_HOME || join(homedir(), ".dsh"), "dsh-lfm"),
    );
    this.changed = () => {
      if (!this.disposed) changed();
    };
    this.profiles = [];
    this.running = new Map();
    this.starting = new Map();
    this.writes = Promise.resolve();
    this.loads = Promise.resolve();
    this.shutdown = new AbortController();
    this.jobs = new Jobs(this.changed);
    this.engine = "";
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(
        await readFile(join(this.root, "profiles.json"), "utf8"),
      );
      if (data.version !== 1 || !Array.isArray(data.profiles))
        throw Error("Unsupported LFM configuration.");
      this.profiles = data.profiles.map(validateProfile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
  }
  persist() {
    const json =
      JSON.stringify({ version: 1, profiles: this.profiles }, null, 2) + "\n";
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const temp = join(this.root, "profiles-" + randomUUID() + ".tmp");
        try {
          await writeFile(temp, json, { mode: 0o600, flush: true });
          await rename(temp, join(this.root, "profiles.json"));
        } finally {
          await rm(temp, { force: true });
        }
      });
    return this.writes;
  }
  find(id) {
    const p = this.profiles.find((p) => p.id === id);
    if (!p) throw Error("LFM profile not found.");
    return p;
  }
  list() {
    return {
      profiles: this.profiles.map((p) => ({
        ...p,
        status: this.starting.has(p.id)
          ? "loading"
          : this.running.get(p.id)?.ready
            ? "running"
            : "stopped",
        active: this.running.get(p.id)?.active || 0,
        log: this.running.get(p.id)?.log || "",
      })),
      jobs: this.jobs.list(),
      runtimeReady: !!this.engine,
    };
  }
  async save(input, signal) {
    const p = validateProfile(input);
    if (this.starting.has(p.id) || this.running.get(p.id)?.active)
      throw Error(
        "Wait for the active load or answer before changing settings.",
      );
    const parts = await modelParts(p.modelPath, signal);
    if (parts[0].model !== p.model || p.context > parts[0].nativeContext)
      throw Error("Model/context does not match the selected GGUF.");
    p.modelPath = parts[0].path;
    p.nativeContext = parts[0].nativeContext;
    if (p.vision && p.projectorPath)
      await inspectProjector(p.projectorPath, signal);
    if (!p.vision) p.projectorPath = "";
    if (this.profiles.some((x) => x.id !== p.id && x.port === p.port))
      throw Error("Another LFM profile uses this local port.");
    const previous = this.profiles;
    const old = previous.find((x) => x.id === p.id);
    const fingerprint = (x) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(x).filter(([k]) => !["name", "benchmark"].includes(k)),
        ),
      );
    if (old?.benchmark && fingerprint(old) === fingerprint(p))
      p.benchmark = old.benchmark;
    else delete p.benchmark;
    await this.unload(p.id);
    this.profiles = [...previous.filter((x) => x.id !== p.id), p];
    try {
      await this.persist();
    } catch (error) {
      this.profiles = previous;
      throw error;
    }
    this.changed();
    return structuredClone(p);
  }
  async addModel(path, signal) {
    const parts = await modelParts(path, signal);
    const p = freshProfile(parts[0]);
    if (p.vision) p.projectorPath = await findProjector(p.modelPath, signal);
    while (this.profiles.some((x) => x.port === p.port)) p.port++;
    return this.save(p, signal);
  }
  ensureEngine(signal, report) {
    if (!this.installing)
      this.installing = installEngine(this.root, { signal, report })
        .then((path) => (this.engine = path))
        .finally(() => {
          this.installing = null;
        });
    return this.installing;
  }
  driver(p) {
    return {
      key: "lfm:" + p.id,
      name: p.name,
      gpu: p.gpu,
      priority: "interactive",
      fingerprint: JSON.stringify(p),
      load: (signal) => this.start(p, signal),
      unload: () => this.stop(p.id),
      busy: () => !!this.running.get(p.id)?.active || this.starting.has(p.id),
    };
  }
  async acquire(p, signal) {
    signal = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    if (this.scheduler) return this.scheduler.acquire(this.driver(p), signal);
    return { state: await this.start(p, signal), signal, release() {} };
  }
  async start(input, signal) {
    const p = validateProfile(input);
    if (this.disposed || !p.enabled)
      throw Error("LFM plugin/profile is disabled.");
    signal = signal
      ? AbortSignal.any([signal, this.shutdown.signal])
      : this.shutdown.signal;
    signal.throwIfAborted();
    if (this.starting.has(p.id)) return this.starting.get(p.id);
    const task = this.loads
      .catch(() => {})
      .then(() => this.startLocal(p, signal));
    this.starting.set(p.id, task);
    this.loads = task;
    try {
      return await task;
    } finally {
      this.starting.delete(p.id);
      this.changed();
    }
  }
  async startLocal(p, signal) {
    signal.throwIfAborted();
    if (this.running.get(p.id)?.ready) return this.running.get(p.id);
    for (const [id, state] of this.running) {
      if (state.active)
        throw Error(
          "Another LFM model is answering; wait or cancel its answer first.",
        );
      await this.stop(id);
    }
    const model = (await modelParts(p.modelPath, signal))[0];
    if (model.model !== p.model || p.context > model.nativeContext)
      throw Error("The selected model has changed. Import it again.");
    if (p.vision) {
      if (!p.projectorPath)
        throw Error("Select the LFM3-VL-2B vision projector in Settings.");
      await inspectProjector(p.projectorPath, signal);
    }
    const executable = p.executable || (await this.ensureEngine(signal));
    await access(executable);
    const url = `http://127.0.0.1:${p.port}`;
    try {
      await fetch(url + "/health", { signal: AbortSignal.timeout(1500) });
      throw Error(
        `Local port ${p.port} is occupied. Choose another port in Advanced.`,
      );
    } catch (error) {
      if (error.name !== "TypeError") throw error;
    }
    // The shared DSH scheduler may unload idle cooperating providers. Never kill foreign GPU processes.
    if (process.platform === "linux" && (p.autoFit || p.gpuLayers > 0)) {
      let result;
      try {
        result = await run(
          "nvidia-smi",
          [
            "--id=" + p.gpu,
            "--query-compute-apps=pid",
            "--format=csv,noheader,nounits",
          ],
          { signal },
        );
      } catch {
        signal.throwIfAborted();
      }
      if (result?.stdout.trim())
        throw Error(
          "Another GPU process is active. Unload that model before loading LFM.",
        );
    }
    const apiKey = randomBytes(32).toString("hex");
    const child = spawn(
      executable,
      [...launchArgs(p), "--api-key", apiKey, "--cors-origins", "localhost"],
      {
        cwd: dirname(executable),
        env: { ...process.env, CUDA_VISIBLE_DEVICES: String(p.gpu) },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    const state = {
      child,
      url,
      apiKey,
      profile: p,
      active: 0,
      ready: false,
      log: "",
      startupLog: "",
      gate: Promise.resolve(),
    };
    this.running.set(p.id, state);
    const log = (chunk) => {
      const text = String(chunk).replaceAll(apiKey, "[local key]");
      state.log = (state.log + text).slice(-30000);
      if (!state.ready)
        state.startupLog = (state.startupLog + text).slice(0, 16000);
    };
    child.stdout.on("data", log);
    child.stderr.on("data", log);
    child.on("error", (error) => {
      state.launchError = error;
      log(error.message);
    });
    child.on("exit", () => {
      state.ready = false;
      this.changed();
    });
    try {
      await ready(url, child, {
        signal,
        log: () => state.startupLog + "\n" + state.log,
        launchError: () => state.launchError,
        headers: { Authorization: "Bearer " + apiKey },
      });
      if (state.launchError) throw state.launchError;
      const listing = await (
        await fetch(url + "/v1/models", {
          signal,
          headers: { Authorization: "Bearer " + apiKey },
        })
      ).json();
      if (!listing.data?.some((m) => m.id === p.id))
        throw Error(
          "Engine model identity does not match the selected profile.",
        );
      state.ready = true;
      this.changed();
      return state;
    } catch (error) {
      await terminate(child);
      this.running.delete(p.id);
      throw error;
    }
  }
  async stop(id) {
    const state = this.running.get(id);
    if (!state) return;
    if (state.active)
      throw Error("LFM is answering; wait or cancel before unloading.");
    await terminate(state.child);
    this.running.delete(id);
    this.changed();
  }
  async unload(id) {
    if (this.running.get(id)?.active)
      throw Error("LFM is answering; wait or cancel first.");
    if (this.scheduler) await this.scheduler.unload("lfm:" + id);
    else await this.stop(id);
  }
  async action(action, payload = {}) {
    switch (action) {
      case "list":
        return this.list();
      case "browse":
        return browse(resolve(payload.path || homedir()));
      case "save":
        return this.save(payload);
      case "remove": {
        if (this.starting.has(payload.id))
          throw Error("Cancel the active load first.");
        await this.unload(payload.id);
        this.profiles = this.profiles.filter((p) => p.id !== payload.id);
        await this.persist();
        this.changed();
        return { removed: true };
      }
      case "importModel":
        return this.jobs.add("Import and load", async (signal, report) => {
          report("Checking model files and vision projector…");
          const p = await this.addModel(payload.path, signal);
          if (p.vision && !p.projectorPath)
            return { profile: p, needsProjector: true };
          report("Loading " + p.name + "…");
          const lease = await this.acquire(p, signal);
          lease.release();
          return { profile: p, ready: true };
        });
      case "start":
        return this.jobs.add("Load model", async (signal, report) => {
          report("Loading model…");
          const lease = await this.acquire(this.find(payload.id), signal);
          lease.release();
          return { ready: true };
        });
      case "stop":
        await this.unload(payload.id);
        return { stopped: true };
      case "benchmark":
        return this.jobs.add("Benchmark settings", (signal, report) =>
          benchmark(this, payload.id, signal, report),
        );
      case "installEngine":
        return this.jobs.add("Install LFM runtime", (signal, report) =>
          this.ensureEngine(signal, report),
        );
      case "cancel":
        this.jobs.cancel(payload.id);
        return { cancelled: true };
      default:
        throw Error("Unknown LFM action.");
    }
  }
  async dispose() {
    this.disposed = true;
    this.shutdown.abort();
    await this.jobs.close();
    await Promise.allSettled([...this.starting.values()]);
    for (const [id, state] of this.running) {
      await terminate(state.child);
      this.running.delete(id);
    }
    await this.writes;
  }
}
