import { writeFile } from "node:fs/promises";
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const string = (s) =>
  Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);

export async function gguf(
  path,
  {
    vision = false,
    projector = false,
    architecture,
    index = 0,
    count = 1,
    context,
    fileType = 32,
  } = {},
) {
  const values = [
    ["general.architecture", architecture || (projector ? "clip" : "lfm3")],
    ["general.basename", vision || projector ? "LFM3-VL" : "LFM3"],
    ["general.name", vision || projector ? "LFM3 VL 2B" : "LFM3 1.7B"],
    ["general.size_label", vision || projector ? "2B" : "1.7B"],
    ["general.file_type", fileType],
    ["lfm3.context_length", context || (vision ? 128000 : 262144)],
    ["split.no", index],
    ["split.count", count],
  ];
  await writeFile(
    path,
    Buffer.concat([
      Buffer.from("GGUF"),
      u32(3),
      u64(0),
      u64(values.length),
      ...values.map(([key, value]) =>
        Buffer.concat([
          string(key),
          u32(typeof value === "string" ? 8 : 4),
          typeof value === "string" ? string(value) : u32(value),
        ]),
      ),
    ]),
  );
}
