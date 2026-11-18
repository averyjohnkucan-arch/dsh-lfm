import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  readlink,
  realpath,
  rename,
  rm,
  chmod,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { run } from "./process.js";

export const release = "b12088";
const base = `https://github.com/ggml-org/llama.cpp/releases/download/${release}/`;
const assets = {
  cuda: [
    [
      "llama-b12088-bin-ubuntu-cuda-12.8-x64.tar.gz",
      187221983,
      "36ac9e91c2a54fd85e599590a655c9d7f78e68dc525bf7f46e48ea781aa196f5",
    ],
    [
      "cudart-llama-b12088-bin-ubuntu-cuda-12.8-x64.tar.gz",
      594371475,
      "cc97cee4d1e588dbc0aad2f4bb4d608de924c6d6ea09baf9cc5cbf5fd61ec70d",
    ],
  ],
  cpu: [
    [
      "llama-b12088-bin-ubuntu-x64.tar.gz",
      22951829,
      "abf1c4daf83e68577e485cbb7435bab95b7ba3c3264150e7050e77fe8ac591ee",
    ],
  ],
  metal: [
    [
      "llama-b12088-bin-macos-arm64.tar.gz",
      16566697,
      "4ab6165a920a1054ed2b44c28de51479de7aa301f3aeab16c0e400fed150cb03",
    ],
  ],
};

async function sha(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const inside = (root, path) => {
  const rel = relative(root, path);
  return (
    rel !== ".." &&
    !rel.startsWith("../") &&
    !rel.startsWith("/") &&
    !rel.includes("\\")
  );
};

/** Record both files and internal shared-library symlinks after archive verification. */
async function inventory(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const info = await lstat(path);
    if (info.isDirectory()) files.push(...(await inventory(root, path)));
    else if (info.isSymbolicLink()) {
      if (!inside(root, await realpath(path)))
        throw Error("Runtime symlink leaves its directory.");
      files.push({ name: relative(root, path), link: await readlink(path) });
    } else if (info.isFile())
      files.push({
        name: relative(root, path),
        bytes: info.size,
        sha256: await sha(path),
      });
    else throw Error("Unexpected runtime file type.");
  }
  return files;
}

export async function verifyEngine(target, key, signal) {
  const receipt = JSON.parse(
    await readFile(join(target, "installed.json"), "utf8"),
  );
  if (
    receipt.key !== key ||
    !Array.isArray(receipt.files) ||
    !receipt.files.length
  )
    throw Error("Runtime installation is incomplete.");
  for (const file of receipt.files) {
    signal?.throwIfAborted();
    const path = resolve(target, file.name);
    if (!inside(target, path) || !inside(target, await realpath(path)))
      throw Error("Unsafe runtime path.");
    const info = await lstat(path);
    if (
      file.link !== undefined
        ? !info.isSymbolicLink() || (await readlink(path)) !== file.link
        : !info.isFile() ||
          info.size !== file.bytes ||
          (await sha(path)) !== file.sha256
    )
      throw Error("Runtime checksum mismatch: " + file.name);
  }
  if (!receipt.files.some((f) => f.name === "lfm-server"))
    throw Error("Runtime launcher missing.");
  return join(target, "lfm-server");
}

async function download(asset, path, signal, report, request) {
  const [name, bytes, expected] = asset;
  const response = await request(base + name, { signal });
  if (!response.ok || !response.body)
    throw Error(
      `Runtime download failed (${response.status}). Retry installation.`,
    );
  let received = 0,
    last = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > bytes)
        return callback(Error("Runtime exceeds its expected size."));
      hash.update(chunk);
      if (Date.now() - last > 1000) {
        report(
          `Downloading ${name.startsWith("cudart") ? "CUDA libraries" : "llama.cpp"}: ${Math.floor((received / bytes) * 100)}%`,
        );
        last = Date.now();
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(path),
    { signal },
  );
  if (received !== bytes || hash.digest("hex") !== expected)
    throw Error("Runtime archive checksum mismatch. Retry installation.");
}

/** Download pinned official binaries into this plugin's state; never compile or borrow another plugin's runtime. */
export async function installEngine(
  root,
  { signal, report = () => {}, request = fetch, backend } = {},
) {
  if (!backend) {
    if (process.platform === "darwin" && process.arch === "arm64")
      backend = "metal";
    else if (process.platform === "linux" && process.arch === "x64") {
      try {
        await run("nvidia-smi", ["-L"], { signal });
        backend = "cuda";
      } catch {
        signal?.throwIfAborted();
        backend = "cpu";
      }
    } else
      throw Error(
        "Automatic installation supports Linux x64 and Apple Silicon. Set a compatible llama-server executable in Advanced on other systems.",
      );
  }
  if (!assets[backend]) throw Error("Unsupported runtime backend.");
  const key = `${release}-${backend}`;
  const target = join(root, "engine", key);
  try {
    return await verifyEngine(target, key, signal);
  } catch {
    signal?.throwIfAborted();
  }
  const stage = join(root, "engine", "install-" + randomUUID());
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const extracted = join(stage, "runtime");
    await mkdir(extracted);
    for (const [index, asset] of assets[backend].entries()) {
      const archive = join(stage, `archive-${index}.tar.gz`);
      await download(asset, archive, signal, report, request);
      const listing = await run("tar", ["-tzf", archive], { signal });
      if (
        listing.stdout
          .split("\n")
          .filter(Boolean)
          .some(
            (name) =>
              name.startsWith("/") ||
              name.includes("\\") ||
              name.split("/").some((p) => p === ".."),
          )
      )
        throw Error("Unsafe runtime archive.");
      const destination = index === 0 ? extracted : join(extracted, "cuda");
      await mkdir(destination, { recursive: true });
      await run(
        "tar",
        [
          "-xzf",
          archive,
          "--strip-components=1",
          "--no-same-owner",
          "-C",
          destination,
        ],
        { signal, timeout: 120000 },
      );
    }
    const launcher =
      '#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport LD_LIBRARY_PATH="$HERE:$HERE/cuda${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$HERE/llama-server" "$@"\n';
    await writeFile(join(extracted, "lfm-server"), launcher, { mode: 0o755 });
    await chmod(join(extracted, "llama-server"), 0o755);
    const files = await inventory(extracted);
    await writeFile(
      join(extracted, "installed.json"),
      JSON.stringify(
        {
          key,
          source: "ggml-org/llama.cpp",
          revision: "d1044bc82712fbf08996080bef6298b24a27e9c7",
          archives: assets[backend],
          files,
        },
        null,
        2,
      ),
    );
    signal?.throwIfAborted();
    await rm(target, { recursive: true, force: true });
    await rename(extracted, target);
    report("Official llama.cpp runtime installed.");
    return await verifyEngine(target, key, signal);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
