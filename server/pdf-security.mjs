import { inflateSync } from "node:zlib";
export function safeArtifactPath(path, scanId) {
  return (
    typeof path === "string" &&
    path.startsWith(scanId + "/") &&
    /^[0-9a-f-]{36}\/[1-3]\/(desktop|mobile)\.png$/.test(path)
  );
}
export function boundedPng(input) {
  const bytes = Buffer.from(input);
  if (
    bytes.length > 2097152 ||
    bytes.length < 45 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("invalid_png");
  const kept = [bytes.subarray(0, 8)],
    idat = [];
  let offset = 8,
    header = null,
    ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("invalid_png");
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8);
    if (length > 2097152 || offset + 12 + length > bytes.length)
      throw new Error("invalid_png");
    const chunk = bytes.subarray(offset, offset + 12 + length),
      data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (header || offset !== 8 || length !== 13)
        throw new Error("invalid_png");
      const width = data.readUInt32BE(0),
        height = data.readUInt32BE(4),
        depth = data[8],
        color = data[9];
      if (
        width < 1 ||
        height < 1 ||
        width > 1440 ||
        height > 900 ||
        width * height > 1500000 ||
        depth !== 8 ||
        ![2, 6].includes(color) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new Error("invalid_png");
      header = { width, height, channels: color === 6 ? 4 : 3 };
      kept.push(chunk);
    } else if (type === "IDAT") {
      if (!header) throw new Error("invalid_png");
      idat.push(data);
      kept.push(chunk);
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("invalid_png");
      kept.push(chunk);
      ended = true;
      offset += 12;
      break;
    }
    offset += 12 + length;
  }
  if (!header || !ended || !idat.length || offset !== bytes.length)
    throw new Error("invalid_png");
  const expected = (header.width * header.channels + 1) * header.height;
  const inflated = inflateSync(Buffer.concat(idat), {
    maxOutputLength: Math.min(6000000, expected),
  });
  if (inflated.length !== expected) throw new Error("invalid_png");
  // Retain no ancillary chunks that might contain compressed profiles or metadata.
  return Buffer.concat(kept);
}
