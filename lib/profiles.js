import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";

import { defaultSampling, starterModes } from "./reasoning.js";

export { defaultSampling };
export const cacheTypes = [
  "f16",
  "bf16",
  "f32",
  "q8_0",
  "q5_0",
  "q5_1",
  "q4_0",
  "q4_1",
  "iq4_nl",
];
export function freshProfile(model) {
  const profile = {
    id: randomUUID(),
    name: model.group,
    model: model.model,
    vision: model.vision,
    modelPath: model.path,
    projectorPath: "",
    nativeContext: model.nativeContext,
    context: model.nativeContext,
    kvK: "f16",
    kvV: "f16",
    thinking: true,
    autoFit: true,
    gpuLayers: 999,
    gpu: 0,
    port: 8270,
    executable: "",
    threads: Math.min(8, availableParallelism()),
    batch: 512,
    ubatch: 128,
    maxTokens: 16384,
    enabled: true,
    sampling: { ...defaultSampling },
  };
  profile.reasoningModes = starterModes(profile);
  return profile;
}

export function validateProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid LFM profile.");
  const p = structuredClone(input);
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) ||
    typeof p.name !== "string" ||
    !p.name.trim()
  )
    throw Error("A profile ID and model name are required.");
  p.name = p.name.trim();
  if (
    !["LFM3-1.7B", "LFM3-VL-2B"].includes(p.model) ||
    p.vision !== (p.model === "LFM3-VL-2B")
  )
    throw Error("Unsupported LFM model.");
  for (const key of ["thinking", "autoFit", "enabled"])
    if (typeof p[key] !== "boolean") throw Error("Invalid " + key + ".");
  for (const key of ["modelPath", "projectorPath", "executable"])
    if (typeof p[key] !== "string" || p[key].includes("\0"))
      throw Error("Invalid " + key + ".");
  if (!p.modelPath) throw Error("Select a model GGUF first.");
  for (const [key, min, max] of [
    ["nativeContext", 256, 262144],
    ["context", 256, p.nativeContext],
    ["port", 1024, 65535],
    ["gpu", 0, 64],
    ["gpuLayers", 0, 999],
    ["threads", 1, 256],
    ["batch", 1, 32768],
    ["ubatch", 1, p.batch],
    ["maxTokens", 1, p.context],
  ])
    if (!Number.isInteger(p[key]) || p[key] < min || p[key] > max)
      throw Error("Invalid " + key + ".");
  for (const key of ["kvK", "kvV"])
    if (!cacheTypes.includes(p[key]))
      throw Error("Unsupported KV cache precision.");
  validateSampling(p.sampling);
  const modes =
    p.reasoningModes === undefined ? starterModes(p) : p.reasoningModes;
  if (!Array.isArray(modes)) throw Error("Invalid reasoning mode list.");
  const names = new Set(["off", "thinking"]),
    ids = new Set();
  p.reasoningModes = modes.map((mode) => {
    if (
      !mode ||
      typeof mode.id !== "string" ||
      !/^mode-[a-zA-Z0-9-]{1,80}$/.test(mode.id) ||
      ids.has(mode.id)
    )
      throw Error("Invalid or duplicate reasoning mode ID.");
    const name = typeof mode.name === "string" && mode.name.trim();
    if (!name || name.length > 100 || names.has(name.toLowerCase()))
      throw Error(
        "Give each reasoning mode a unique name of 1–100 characters.",
      );
    if (
      typeof mode.thinking !== "boolean" ||
      !Number.isInteger(mode.maxTokens) ||
      mode.maxTokens < 1 ||
      mode.maxTokens > p.context
    )
      throw Error("Invalid thinking switch or output limit for " + name + ".");
    validateSampling(mode.sampling);
    ids.add(mode.id);
    names.add(name.toLowerCase());
    return {
      id: mode.id,
      name,
      thinking: mode.thinking,
      sampling: mode.sampling,
      maxTokens: mode.maxTokens,
    };
  });
  if (p.defaultMode !== undefined && !ids.has(p.defaultMode))
    throw Error("Choose an existing default reasoning mode.");
  // Persist configuration, never transient UI/process state or arbitrary engine arguments.
  const fields = [
    "id",
    "name",
    "model",
    "vision",
    "modelPath",
    "projectorPath",
    "nativeContext",
    "context",
    "kvK",
    "kvV",
    "thinking",
    "autoFit",
    "gpuLayers",
    "gpu",
    "port",
    "executable",
    "threads",
    "batch",
    "ubatch",
    "maxTokens",
    "enabled",
    "sampling",
    "benchmark",
    "reasoningModes",
    "defaultMode",
  ];
  return Object.fromEntries(
    fields.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
  );
}

function validateSampling(s) {
  if (
    !s ||
    typeof s !== "object" ||
    Array.isArray(s) ||
    Object.keys(s).length !== Object.keys(defaultSampling).length ||
    Object.keys(defaultSampling).some((k) => !Number.isFinite(s[k])) ||
    s.temperature < 0 ||
    s.temperature > 5 ||
    s.top_p <= 0 ||
    s.top_p > 1 ||
    !Number.isInteger(s.top_k) ||
    s.top_k < 0 ||
    s.top_k > 128000 ||
    s.min_p < 0 ||
    s.min_p > 1 ||
    s.repeat_penalty <= 0 ||
    s.repeat_penalty > 5
  )
    throw Error("Invalid sampling settings.");
}

/** Keep file quantization untouched; these flags configure attention cache and resource placement. */
export function launchArgs(input) {
  const p = validateProfile(input);
  if (p.vision && !p.projectorPath)
    throw Error("Select the LFM3-VL-2B vision projector before loading.");
  return [
    "--model",
    p.modelPath,
    ...(p.vision ? ["--mmproj", p.projectorPath] : []),
    "--alias",
    p.id,
    "--host",
    "127.0.0.1",
    "--port",
    String(p.port),
    "--ctx-size",
    String(p.context),
    "--parallel",
    "1",
    "--jinja",
    "--reasoning",
    "auto",
    "--no-webui",
    "--cache-type-k",
    p.kvK,
    "--cache-type-v",
    p.kvV,
    "--flash-attn",
    "on",
    ...(p.autoFit
      ? ["--fit", "on", "--fit-ctx", String(p.context)]
      : ["--fit", "off", "--n-gpu-layers", String(p.gpuLayers)]),
    "--threads",
    String(p.threads),
    "--threads-batch",
    String(p.threads),
    "--batch-size",
    String(p.batch),
    "--ubatch-size",
    String(p.ubatch),
    "--no-context-shift",
  ];
}

export function applySampling(body, p) {
  Object.assign(body, p.sampling);
  delete body.reasoning_effort;
  body.chat_template_kwargs = {
    ...body.chat_template_kwargs,
    enable_thinking: p.thinking,
  };
  body.cache_prompt = true;
  body.id_slot = 0;
}
