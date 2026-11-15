import { readdir, stat, realpath, readFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { inspectGguf } from "./gguf.js";

/** Identify the two checkpoints from GGUF metadata, independent of the filename/quant. */
export async function inspectModel(path, signal) {
  signal?.throwIfAborted();
  if ((await stat(path)).isDirectory()) return inspectMlx(path, signal);
  const file = await inspectGguf(path, signal);
  const m = file.metadata;
  const family = String(
    m["general.basename"] || m["general.name"] || "",
  ).toLowerCase();
  const size = String(m["general.size_label"] || "").toLowerCase();
  const vision = /lfm3[\s_-]*vl/.test(family);
  const text = /^lfm3(?:[\s_-]|$)/.test(family) && !vision;
  if (
    file.architecture !== "lfm3" ||
    !(vision ? size === "2b" : text && size === "1.7b") ||
    /\bbase\b/i.test(String(m["general.name"] || ""))
  ) {
    throw Error(
      "Choose an LFM3-1.7B or LFM3-VL-2B GGUF. Other models are not supported.",
    );
  }
  const nativeContext = m["lfm3.context_length"];
  if (
    !Number.isSafeInteger(nativeContext) ||
    nativeContext < 256 ||
    nativeContext > 262144
  )
    throw Error("The GGUF has no valid native context length.");
  return {
    ...file,
    vision,
    nativeContext,
    model: vision ? "LFM3-VL-2B" : "LFM3-1.7B",
  };
}

// Local snapshots only. Never execute checkpoint Python or infer format from a name.
async function jsonFile(path, signal) {
  signal?.throwIfAborted();
  const info = await stat(path);
  if (!info.isFile() || info.size > 64 * 1024 * 1024)
    throw Error("Invalid or oversized model JSON: " + path);
  return JSON.parse(await readFile(path, { encoding: "utf8", signal }));
}

async function inspectMlx(input, signal) {
  const path = await realpath(input);
  const config = await jsonFile(join(path, "config.json"), signal);
  const q = config.quantization;
  if (
    config.model_type !== "lfm3" ||
    config.hidden_size !== 2048 ||
    config.num_hidden_layers !== 24 ||
    config.vocab_size !== 128000 ||
    !config.architectures?.includes("Lfm3ForCausalLM") ||
    ![2, 3, 4, 6, 8].includes(q?.bits) ||
    q?.mode !== "affine" ||
    ![32, 64, 128].includes(q?.group_size)
  )
    throw Error("Choose a native quantized LFM3-1.7B MLX snapshot directory.");
  const nativeContext = config.max_position_embeddings;
  if (
    !Number.isSafeInteger(nativeContext) ||
    nativeContext < 256 ||
    nativeContext > 262144
  )
    throw Error("The MLX config has no valid native context length.");
  await jsonFile(join(path, "tokenizer_config.json"), signal);
  await jsonFile(join(path, "tokenizer.json"), signal);
  const entries = await readdir(path);
  let weights = entries.filter((name) => name.endsWith(".safetensors"));
  const present = new Set(weights);
  if (entries.includes("model.safetensors.index.json")) {
    const index = await jsonFile(
      join(path, "model.safetensors.index.json"),
      signal,
    );
    if (
      !index.weight_map ||
      typeof index.weight_map !== "object" ||
      Array.isArray(index.weight_map)
    )
      throw Error("Invalid MLX weight index.");
    weights = [...new Set(Object.values(index.weight_map))];
  } else if (weights.length !== 1 || weights[0] !== "model.safetensors") {
    throw Error("Sharded MLX snapshots require model.safetensors.index.json.");
  }
  if (!weights.length) throw Error("Missing MLX safetensors weights.");
  for (const name of weights) {
    signal?.throwIfAborted();
    if (
      typeof name !== "string" ||
      name !== basename(name) ||
      /[\\/\0]/.test(name) ||
      !name.endsWith(".safetensors")
    )
      throw Error("Unsafe MLX weight index path.");
    const info = await stat(join(path, name));
    if (!info.isFile() || info.size < 8)
      throw Error("Missing or empty MLX weights: " + name);
  }
  if (
    weights.length !== present.size ||
    weights.some((name) => !present.has(name))
  )
    throw Error("MLX weight files do not match the weight index.");
  return {
    path,
    backend: "mlx-vlm",
    model: "LFM3-1.7B",
    vision: false,
    group: basename(path),
    nativeContext,
    count: 1,
  };
}

export async function inspectProjector(path, signal) {
  const file = await inspectGguf(path, signal);
  const m = file.metadata;
  const family = String(
    m["general.basename"] || m["general.name"] || "",
  ).toLowerCase();
  if (file.architecture !== "clip" || !/lfm3[\s_-]*vl/.test(family))
    throw Error("Choose the LFM3-VL-2B vision projector (mmproj GGUF).");
  if (file.count !== 1)
    throw Error("The vision projector must be a single GGUF.");
  return file;
}

/** A selected shard resolves only its own siblings; missing shards fail before launch. */
export async function modelParts(path, signal) {
  const selected = await inspectModel(path, signal);
  if (selected.count === 1) return [selected];
  const parts = [];
  for (const name of await readdir(dirname(path))) {
    if (!name.startsWith(selected.group + "-") || !/\.gguf$/i.test(name))
      continue;
    const part = await inspectModel(join(dirname(path), name), signal);
    if (part.group === selected.group) parts.push(part);
  }
  parts.sort((a, b) => a.index - b.index);
  const missing = Array.from(
    { length: selected.count },
    (_, i) => i + 1,
  ).filter((i) => !parts.some((p) => p.index === i));
  if (
    missing.length ||
    parts.length !== selected.count ||
    parts.some(
      (p) =>
        p.count !== selected.count ||
        p.model !== selected.model ||
        p.nativeContext !== selected.nativeContext,
    ) ||
    new Set(parts.map((p) => p.index)).size !== parts.length
  )
    throw Error(
      "Missing or inconsistent model shards" +
        (missing.length ? ": " + missing.join(", ") : "."),
    );
  return parts;
}

/** Look beside the model and one directory below it. Never choose an ambiguous projector. */
export async function findProjector(modelPath, signal) {
  const candidates = [];
  const seen = new Set();
  async function visit(directory, depth) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (["EACCES", "EPERM", "ENOENT", "ELOOP"].includes(error.code)) return;
      throw error;
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name);
      try {
        const info = entry.isSymbolicLink() ? await stat(path) : entry;
        if (info.isDirectory() && depth === 0) await visit(path, 1);
        else if (info.isFile() && /mmproj.*\.gguf$/i.test(entry.name)) {
          const canonical = await realpath(path);
          if (seen.has(canonical)) continue;
          const projector = await inspectProjector(path, signal);
          seen.add(canonical);
          candidates.push(projector);
        }
      } catch {
        signal?.throwIfAborted();
      }
    }
  }
  await visit(dirname(modelPath), 0);
  return candidates.length === 1 ? candidates[0].path : "";
}

export async function browse(path) {
  const rows = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    try {
      const file = join(path, entry.name);
      const info = entry.isSymbolicLink() ? await stat(file) : null;
      const directory = entry.isDirectory() || info?.isDirectory();
      if (
        directory ||
        ((entry.isFile() || info?.isFile()) && /\.gguf$/i.test(entry.name))
      )
        rows.push({ name: entry.name, path: file, directory: !!directory });
    } catch (error) {
      if (!["ENOENT", "EACCES", "ELOOP"].includes(error.code)) throw error;
    }
  }
  rows.sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
  return {
    path,
    parent: dirname(path),
    entries: rows.slice(0, 1000),
    truncated: rows.length > 1000,
  };
}
