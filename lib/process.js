import { startupError } from "./startup-error.js";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
export function run(
  command,
  args = [],
  { cwd, env, signal, timeout = 30000, onData } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const stop = () => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill();
      } catch (e) {
        if (e.code !== "ESRCH") reject(e);
      }
    };
    const timer = setTimeout(stop, timeout);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on("data", (b) => {
      stdout = (stdout + b).slice(-2000000);
      onData?.(String(b));
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-2000000);
      onData?.(String(b));
    });
    child.on("error", (e) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (!settled)
        code === 0
          ? resolve({ stdout, stderr })
          : reject(
              new Error(
                signal?.aborted
                  ? "Cancelled"
                  : `${command} exited ${code}: ${stderr.slice(-6000)}`,
              ),
            );
    });
  });
}
export async function gpuInfo(index = 0) {
  const { stdout } = await run("nvidia-smi", [
    `--id=${index}`,
    "--query-gpu=memory.total,memory.free,utilization.gpu",
    "--format=csv,noheader,nounits",
  ]);
  const [totalMiB, freeMiB, utilization] = stdout.trim().split(",").map(Number);
  if (!totalMiB || !Number.isFinite(freeMiB))
    throw new Error("Cannot read GPU memory telemetry.");
  return {
    totalMiB,
    freeMiB,
    utilization,
    freePercent: (freeMiB / totalMiB) * 100,
  };
}
export async function ready(
  url,
  child,
  {
    signal,
    timeout = 900000,
    log = () => "",
    headers = {},
    launchError = () => null,
  } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (launchError()) throw launchError();
    if (child.exitCode !== null || child.signalCode)
      throw startupError(log(), child.exitCode);
    try {
      const r = await fetch(url + "/v1/models", {
        signal: AbortSignal.timeout(1500),
        headers,
      });
      if (r.ok) return;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    await delay(600, undefined, { signal });
  }
  throw new Error("Engine readiness timed out. " + log().slice(-5000));
}
export async function terminate(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    // taskkill's /T covers engine grandchildren. This PID was spawned by this plugin.
    if (child.exitCode !== null || child.signalCode) return;
    await run("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 15000,
    });
    return;
  }
  const alive = () => {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (e) {
      if (e.code === "ESRCH") return false;
      throw e;
    }
  };
  const signal = (s) => {
    try {
      process.kill(-child.pid, s);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  if (!alive()) return;
  signal("SIGTERM");
  let deadline = Date.now() + 8000;
  while (alive() && Date.now() < deadline) await delay(50);
  if (alive()) {
    signal("SIGKILL");
    deadline = Date.now() + 3000;
    while (alive() && Date.now() < deadline) await delay(50);
  }
  if (alive())
    throw new Error(
      "Owned engine process group has not finished stopping; refusing to report GPU release.",
    );
}
