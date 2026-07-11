import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function requireByteBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("PNG input must be a Buffer or Uint8Array");
}

export function decodePngRaster(value) {
  const bytes = requireByteBuffer(value);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("invalid PNG signature");

  let offset = 8;
  let ihdr = null;
  let sawEnd = false;
  const idat = [];
  const ancillaryChunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk header");
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) throw new Error(`truncated PNG ${type} chunk`);
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} CRC mismatch`);

    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) throw new Error("PNG must contain one 13-byte IHDR");
      ihdr = Buffer.from(data);
    } else if (type === "IDAT") {
      if (ihdr === null || sawEnd) throw new Error("PNG IDAT ordering is invalid");
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      if (length !== 0 || sawEnd) throw new Error("PNG IEND is invalid");
      sawEnd = true;
    } else {
      if ((typeBytes[0] & 0x20) === 0 && type !== "PLTE") throw new Error(`unsupported critical PNG chunk ${type}`);
      ancillaryChunks.push(type);
    }
    offset = crcOffset + 4;
    if (sawEnd && offset !== bytes.length) throw new Error("PNG contains data after IEND");
  }

  if (ihdr === null || idat.length === 0 || !sawEnd) throw new Error("PNG is missing IHDR, IDAT, or IEND");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filterMethod = ihdr[11];
  const interlace = ihdr[12];
  if (width < 1 || height < 1) throw new Error("PNG dimensions must be positive");
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG color type ${colorType}`);
  if (compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    throw new Error("only noninterlaced PNG compression/filter method 0 is supported");
  }

  const channels = colorType === 2 ? 3 : 4;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const expectedInflatedLength = (rowBytes + 1) * height;
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(`PNG inflated length ${inflated.length} does not match ${expectedInflatedLength}`);
  }

  const unpacked = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const inputRow = y * (rowBytes + 1);
    const filter = inflated[inputRow];
    if (filter > 4) throw new Error(`unsupported PNG row filter ${filter}`);
    const outputRow = y * rowBytes;
    const previousRow = outputRow - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[inputRow + 1 + x];
      const left = x >= channels ? unpacked[outputRow + x - channels] : 0;
      const up = y > 0 ? unpacked[previousRow + x] : 0;
      const upperLeft = y > 0 && x >= channels ? unpacked[previousRow + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paethPredictor(left, up, upperLeft);
      unpacked[outputRow + x] = (encoded + predictor) & 0xff;
    }
  }

  const rgb = new Uint8Array(width * height * 3);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const rgbOffset = pixel * 3;
    const rgbaOffset = pixel * 4;
    rgb[rgbOffset] = unpacked[source];
    rgb[rgbOffset + 1] = unpacked[source + 1];
    rgb[rgbOffset + 2] = unpacked[source + 2];
    rgba[rgbaOffset] = unpacked[source];
    rgba[rgbaOffset + 1] = unpacked[source + 1];
    rgba[rgbaOffset + 2] = unpacked[source + 2];
    rgba[rgbaOffset + 3] = channels === 4 ? unpacked[source + 3] : 255;
  }

  return Object.freeze({
    width,
    height,
    bitDepth,
    colorType,
    channels,
    ancillaryChunks: Object.freeze(ancillaryChunks),
    rgb,
    rgba,
    rgbSha256: createHash("sha256").update(rgb).digest("hex"),
    rgbaSha256: createHash("sha256").update(rgba).digest("hex"),
  });
}

export function comparePngRgb(left, right) {
  if (!left || !right || !(left.rgb instanceof Uint8Array) || !(right.rgb instanceof Uint8Array)) {
    throw new TypeError("decoded PNG raster inputs are required");
  }
  if (left.width !== right.width || left.height !== right.height || left.rgb.length !== right.rgb.length) {
    throw new RangeError("decoded PNG raster dimensions must match");
  }
  let absoluteDelta = 0;
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) {
    const offset = pixel * 3;
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left.rgb[offset + channel] - right.rgb[offset + channel]);
      absoluteDelta += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      pixelChanged ||= delta !== 0;
    }
    changedPixels += pixelChanged ? 1 : 0;
  }
  return Object.freeze({
    rgbMaeCodeValues: absoluteDelta / left.rgb.length,
    changedPixelRatio: changedPixels / (left.width * left.height),
    maxChannelDelta,
  });
}
