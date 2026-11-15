import { isAbsolute } from "node:path";
import { run } from "./process.js";

// Explicit interpreter; no automatic pip installs, shell commands or remote code.
export function mlxLaunch(p, platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || arch !== "arm64")
    throw Error(
      "The experimental MLX backend requires native arm64 macOS (Apple Silicon).",
    );
  if (!isAbsolute(p.mlxPython))
    throw Error(
      "Set MLX Python to the absolute path of a virtualenv interpreter with mlx-vlm >= 0.7.11.",
    );
  if (p.kvK !== "f16" || p.kvV !== "f16" || p.executable)
    throw Error(
      "MLX does not support llama.cpp KV precision or custom executable settings. Use f16 defaults and MLX Python.",
    );
  return {
    executable: p.mlxPython,
    args: [
      "-m",
      "mlx_vlm.server",
      "--model",
      p.modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(p.port),
      "--max-tokens",
      String(p.maxTokens),
      "--max-kv-size",
      String(p.context),
    ],
  };
}

export async function checkMlx(executable, signal) {
  await run(
    executable,
    [
      "-c",
      `
import importlib.metadata, platform, re
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise RuntimeError('Native Apple Silicon Python required')
v = importlib.metadata.version('mlx-vlm')
m = re.fullmatch(r'(\\d+)\\.(\\d+)\\.(\\d+)', v)
if not m or tuple(map(int, m.groups())) < (0, 7, 11):
    raise RuntimeError('mlx-vlm >= 0.7.11 stable required')
`,
    ],
    { signal },
  );
}

export function mlxEnvironment(apiKey, inherited = process.env) {
  // Prevent unrelated server/preload/draft/KV settings from loading extra models
  // or overriding the profile. Preserve ordinary Python/Metal system settings.
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key]) =>
        !/^(MLX_VLM_|KV_|MLX_TRUST_REMOTE_CODE$|MAX_KV_SIZE$|QUANTIZED_KV_START$)/.test(
          key,
        ),
    ),
  );
  return {
    ...env,
    HF_HUB_OFFLINE: "1",
    MLX_TRUST_REMOTE_CODE: "false",
    MLX_VLM_SERVER_API_KEY: apiKey,
  };
}
