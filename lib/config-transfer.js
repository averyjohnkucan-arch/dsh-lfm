import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { exportManifest, locateFiles, validateManifest } from "./portable.js";
import { modelParts, inspectProjector } from "./models.js";
import { freshProfile } from "./profiles.js";

const fields = [
  "context",
  "kvK",
  "kvV",
  "thinking",
  "autoFit",
  "gpuLayers",
  "threads",
  "batch",
  "ubatch",
  "maxTokens",
  "enabled",
  "sampling",
  "reasoningModes",
  "defaultMode",
];
const settings = (p) =>
  Object.fromEntries(
    fields.filter((k) => Object.hasOwn(p, k)).map((k) => [k, p[k]]),
  );

export async function exportConfig(profile, signal, report) {
  const parts = await modelParts(profile.modelPath, signal);
  const files = parts.map((part, i) => ({
    role: i === 0 ? "model" : "part",
    path: part.path,
  }));
  if (profile.projectorPath)
    files.push({ role: "projector", path: profile.projectorPath });
  return exportManifest("lfm", profile.name, settings(profile), files, {
    signal,
    report,
  });
}

export async function importConfig(runtime, config, root, signal, report) {
  const manifest = validateManifest(config, "lfm");
  if (
    manifest.files.filter((f) => f.role === "model").length !== 1 ||
    manifest.files.filter((f) => f.role === "projector").length > 1 ||
    manifest.files.some(
      (f) => !["model", "part", "projector"].includes(f.role),
    ) ||
    new Set(manifest.files.map((f) => f.name)).size !== manifest.files.length
  )
    throw Error("Invalid LFM shard or projector list.");
  const files = await locateFiles(manifest, root, { signal, report });
  // Restore the shard names expected by llama.cpp even if the originals moved.
  const imports = join(runtime.root, "imports");
  await mkdir(imports, { recursive: true });
  const directory = await mkdtemp(join(imports, "config-"));
  try {
    for (const file of files)
      await symlink(file.path, join(directory, file.name));
    const model = files.find((f) => f.role === "model");
    const projector = files.find((f) => f.role === "projector");
    const parts = await modelParts(join(directory, model.name), signal);
    if (
      parts[0].name !== model.name ||
      parts.length !== files.length - Number(Boolean(projector))
    )
      throw Error("The exported shards do not form a complete LFM model.");
    const profile = Object.assign(
      freshProfile(parts[0]),
      settings(manifest.settings),
      { name: manifest.name },
    );
    if (manifest.settings.reasoningModes === undefined)
      delete profile.reasoningModes;
    if (projector) {
      if (!profile.vision)
        throw Error("A text-only LFM model cannot use a vision projector.");
      profile.projectorPath = join(directory, projector.name);
      await inspectProjector(profile.projectorPath, signal);
    }
    signal.throwIfAborted();
    return await runtime.save(profile, signal, { allocatePort: true });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
