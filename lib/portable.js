import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, parse } from "node:path";

const roles = new Set(["model", "projector", "mtp", "mtp-runtime", "part"]);

/** Content identities survive renames and moves. Hash only files with a matching byte size. */
export async function fileMd5(
  path,
  { signal, report = () => {}, cache = new Map() } = {},
) {
  signal?.throwIfAborted();
  const before = await stat(path);
  if (!before.isFile()) throw new Error("Expected a file: " + path);
  const key = [
    before.dev,
    before.ino,
    before.size,
    before.mtimeMs,
    before.ctimeMs,
  ].join(":");
  if (cache.has(key)) return cache.get(key);
  const digest = createHash("md5");
  let bytes = 0,
    last = 0;
  for await (const block of createReadStream(path, {
    signal,
    highWaterMark: 4 * 1024 * 1024,
  })) {
    digest.update(block);
    bytes += block.length;
    if (Date.now() - last > 1000) {
      report(
        `Checking ${basename(path)}: ${Math.round((bytes / Math.max(1, before.size)) * 100)}%`,
      );
      last = Date.now();
    }
  }
  const after = await stat(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error("File changed while checking its MD5: " + path);
  const result = digest.digest("hex");
  cache.set(key, result);
  return result;
}

export async function exportManifest(
  engine,
  name,
  settings,
  entries,
  context = {},
) {
  context = { ...context, cache: context.cache || new Map() };
  const files = [];
  for (const [index, entry] of entries.entries()) {
    context.signal?.throwIfAborted();
    const info = await stat(entry.path);
    const md5 = await fileMd5(entry.path, context);
    if ((await stat(entry.path)).size !== info.size)
      throw new Error("File changed while exporting: " + entry.path);
    files.push({
      id: String(index),
      role: entry.role,
      name: basename(entry.path),
      size: info.size,
      md5,
      ...(entry.relative ? { relative: entry.relative } : {}),
    });
  }
  return validateManifest(
    { format: "dsh-local-model", version: 1, engine, name, settings, files },
    engine,
  );
}

/** Imported JSON is data: launch commands and credentials are never evaluated here. */
export function validateManifest(value, engine) {
  if (
    !value ||
    value.format !== "dsh-local-model" ||
    value.version !== 1 ||
    value.engine !== engine
  )
    throw new Error(
      "Choose a portable " + engine + " model config exported by this plugin",
    );
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !value.settings ||
    typeof value.settings !== "object" ||
    Array.isArray(value.settings)
  )
    throw new Error("Invalid portable model settings");
  if (
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.length > 4096
  )
    throw new Error("Config must describe between 1 and 4096 files");
  const ids = new Set();
  for (const file of value.files) {
    if (
      !file ||
      typeof file.id !== "string" ||
      !/^\d{1,5}$/.test(file.id) ||
      ids.has(file.id) ||
      !roles.has(file.role) ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 255 ||
      [".", ".."].includes(file.name) ||
      /[/\\\0]/.test(file.name) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.md5 !== "string" ||
      !/^[a-f0-9]{32}$/.test(file.md5)
    )
      throw new Error("Invalid file identity in model config");
    if (
      file.relative &&
      (typeof file.relative !== "string" ||
        /[\\\0]/.test(file.relative) ||
        file.relative.startsWith("/") ||
        file.relative.split("/").some((x) => x === ".." || x === ""))
    )
      throw new Error("Unsafe relative shard path in model config");
    ids.add(file.id);
  }
  return structuredClone(value);
}

export async function locateFiles(value, root, context = {}) {
  context = { ...context, cache: context.cache || new Map() };
  if (typeof root !== "string" || !isAbsolute(root))
    throw new Error("Choose an absolute model folder");
  root = await realpath(root);
  if (parse(root).root === root)
    throw new Error(
      "Choose an absolute model folder, rather than the entire filesystem",
    );
  if (!(await stat(root)).isDirectory())
    throw new Error("Choose an existing model folder");
  const wanted = new Map();
  for (const file of value.files) {
    const group = wanted.get(file.size) || [];
    group.push(file);
    wanted.set(file.size, group);
  }
  const found = new Map(),
    pending = [root],
    seen = new Set();
  let inspected = 0;
  while (pending.length && found.size < value.files.length) {
    context.signal?.throwIfAborted();
    const directory = pending.pop();
    try {
      const info = await stat(directory),
        identity = info.dev + ":" + info.ino;
      if (seen.has(identity)) continue;
      seen.add(identity);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        context.signal?.throwIfAborted();
        const path = join(directory, entry.name);
        try {
          const info = entry.isSymbolicLink() ? await stat(path) : null;
          if (entry.isDirectory()) {
            pending.push(path);
            continue;
          }
          if (!entry.isFile() && !info?.isFile()) continue;
          const size = info?.size ?? (await stat(path)).size;
          inspected++;
          if (inspected % 1000 === 0)
            context.report?.(
              `Searching subfolders: ${inspected.toLocaleString()} files checked by size`,
            );
          const candidates = (wanted.get(size) || []).filter(
            (file) => !found.has(file.id),
          );
          if (!candidates.length) continue;
          const md5 = await fileMd5(path, context);
          for (const file of candidates)
            if (file.md5 === md5) found.set(file.id, path);
        } catch (error) {
          if (
            !["ENOENT", "EACCES", "EPERM", "ELOOP", "ENAMETOOLONG"].includes(
              error.code,
            )
          )
            throw error;
        }
      }
    } catch (error) {
      if (
        !["ENOENT", "EACCES", "EPERM", "ELOOP", "ENAMETOOLONG"].includes(
          error.code,
        )
      )
        throw error;
    }
  }
  const missing = value.files.filter((file) => !found.has(file.id));
  if (missing.length)
    throw new Error(
      "No exact size and MD5 match for: " +
        missing.map((file) => file.name).join(", "),
    );
  return value.files.map((file) => ({ ...file, path: found.get(file.id) }));
}
