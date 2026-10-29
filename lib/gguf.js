import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
const limit = 128 * 1024 ** 2;
const widths = new Map([
  [0, 1],
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 4],
  [5, 4],
  [6, 4],
  [7, 1],
  [10, 8],
  [11, 8],
  [12, 8],
]);

/** A bounded sliding buffer inspects headers without mapping multi-gigabyte weights. */
class Reader {
  constructor(file, size, signal) {
    this.file = file;
    this.size = size;
    this.signal = signal;
    this.offset = 0;
    this.start = -1;
    this.buffer = Buffer.alloc(0);
  }
  check(bytes) {
    this.signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.offset + bytes > Math.min(this.size, limit)
    )
      throw Error("Truncated or oversized GGUF header.");
  }
  skip(bytes) {
    this.check(bytes);
    this.offset += bytes;
  }
  async take(bytes) {
    this.check(bytes);
    if (
      this.offset < this.start ||
      this.offset + bytes > this.start + this.buffer.length
    ) {
      this.start = this.offset;
      this.buffer = Buffer.alloc(
        Math.min(
          Math.max(65536, bytes),
          this.size - this.offset,
          limit - this.offset,
        ),
      );
      const { bytesRead } = await this.file.read(
        this.buffer,
        0,
        this.buffer.length,
        this.offset,
      );
      this.buffer = this.buffer.subarray(0, bytesRead);
      if (bytesRead < bytes) throw Error("Truncated GGUF header.");
    }
    const value = this.buffer.subarray(
      this.offset - this.start,
      this.offset - this.start + bytes,
    );
    this.offset += bytes;
    return value;
  }
  async number(type) {
    const width = widths.get(type);
    if (!width) throw Error("Unsupported GGUF metadata type.");
    const value = await this.take(width);
    if (type === 0 || type === 7) return value.readUInt8();
    if (type === 1) return value.readInt8();
    if (type === 2) return value.readUInt16LE();
    if (type === 3) return value.readInt16LE();
    if (type === 4) return value.readUInt32LE();
    if (type === 5) return value.readInt32LE();
    if (type === 6) return value.readFloatLE();
    if (type === 12) return value.readDoubleLE();
    const n = Number(
      type === 10 ? value.readBigUInt64LE() : value.readBigInt64LE(),
    );
    if (!Number.isSafeInteger(n))
      throw Error("GGUF integer exceeds inspection limits.");
    return n;
  }
  async string(capture = true) {
    const bytes = await this.number(10);
    if (bytes > 16 * 1024 ** 2)
      throw Error("GGUF string exceeds inspection limits.");
    if (!capture) {
      this.skip(bytes);
      return;
    }
    return (await this.take(bytes)).toString("utf8");
  }
  async value(type, capture) {
    if (type === 8) return this.string(capture);
    if (type === 9) {
      const subtype = await this.number(4),
        count = await this.number(10);
      if (count > 2_000_000)
        throw Error("GGUF array exceeds inspection limits.");
      if (subtype === 8)
        for (let i = 0; i < count; i++) await this.string(false);
      else if (widths.has(subtype)) this.skip(widths.get(subtype) * count);
      else throw Error("Unsupported GGUF array type.");
      return null;
    }
    return this.number(type);
  }
}

export async function inspectGguf(path, signal) {
  path = resolve(path);
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size,
      r = new Reader(file, size, signal);
    if (
      (await r.take(4)).toString() !== "GGUF" ||
      ![2, 3].includes(await r.number(4))
    )
      throw Error("Expected a GGUF v2/v3 file.");
    const tensors = await r.number(10),
      keys = await r.number(10);
    if (tensors > 200_000 || keys > 20_000)
      throw Error("GGUF directory exceeds inspection limits.");
    const metadata = {};
    for (let i = 0; i < keys; i++) {
      const key = await r.string(),
        capture =
          key.startsWith("general.") ||
          key.startsWith("split.") ||
          key.startsWith("lfm3.") ||
          key.startsWith("clip.") ||
          key.endsWith(".context_length");
      const value = await r.value(await r.number(4), capture);
      if (capture) metadata[key] = value;
    }
    let maxOffset = -1;
    const roles = {};
    for (let i = 0; i < tensors; i++) {
      const name = await r.string(),
        dimensions = await r.number(4);
      if (dimensions < 1 || dimensions > 8)
        throw Error("Invalid tensor dimensions.");
      for (let d = 0; d < dimensions; d++)
        if ((await r.number(10)) < 1) throw Error("Invalid tensor shape.");
      await r.number(4);
      maxOffset = Math.max(maxOffset, await r.number(10));
      const role = /token_embd|embed_tokens/.test(name)
        ? "Embeddings"
        : "Decoder";
      roles[role] = (roles[role] || 0) + 1;
    }
    const alignment = metadata["general.alignment"] ?? 32;
    if (
      !Number.isInteger(alignment) ||
      alignment < 1 ||
      alignment > 4096 ||
      alignment & (alignment - 1)
    )
      throw Error("Invalid tensor alignment.");
    if (
      maxOffset >= 0 &&
      Math.ceil(r.offset / alignment) * alignment + maxOffset >= size
    )
      throw Error("Tensor payload is truncated.");
    const name = basename(path),
      match = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(name);
    const index = match
        ? Number(match[2])
        : Number(metadata["split.no"] ?? 0) + 1,
      count = Number(metadata["split.count"] ?? (match ? match[3] : 1));
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 10000 ||
      !Number.isInteger(index) ||
      index < 1 ||
      index > count ||
      (match &&
        (count !== Number(match[3]) ||
          (metadata["split.no"] !== undefined &&
            metadata["split.no"] !== index - 1)))
    )
      throw Error("Filename and GGUF shard metadata disagree.");
    return {
      path,
      name,
      bytes: size,
      architecture: String(metadata["general.architecture"] || ""),
      group: match ? match[1] : name.replace(/\.gguf$/i, ""),
      index,
      count,
      metadata,
      tensors: roles,
    };
  } finally {
    await file.close();
  }
}
