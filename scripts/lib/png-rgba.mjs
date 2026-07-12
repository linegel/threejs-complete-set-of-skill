import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
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

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength);
  return output;
}

export function encodeRgbaPng({ width, height, data }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('PNG width and height must be positive integers');
  }
  if (!ArrayBuffer.isView(data) || data.byteLength !== width * height * 4) {
    throw new RangeError(`RGBA data must contain exactly ${width * height * 4} bytes`);
  }
  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    pixels.copy(scanlines, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND'),
  ]);
}

export function decodeRgbaPng(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (bytes.byteLength < PNG_SIGNATURE.byteLength + 12
    || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
    throw new Error('Expected PNG signature');
  }

  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  const idat = [];
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error('PNG chunk header is truncated');
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.byteLength) throw new Error(`PNG ${type || '<unknown>'} chunk is truncated`);
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (expectedCrc !== actualCrc) throw new Error(`PNG ${type} chunk CRC mismatch`);

    if (type === 'IHDR') {
      if (sawHeader || offset !== PNG_SIGNATURE.byteLength || length !== 13) {
        throw new Error('PNG must contain exactly one leading 13-byte IHDR chunk');
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width <= 0 || height <= 0 || !Number.isSafeInteger(width * height)
        || width * height > 64 * 1024 * 1024) {
        throw new Error('PNG dimensions are invalid or exceed the evidence decoder limit');
      }
      if (data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Only non-interlaced 8-bit RGBA PNGs are supported');
      }
      sawHeader = true;
    } else if (type === 'IDAT') {
      if (!sawHeader || sawEnd) throw new Error('PNG IDAT chunk is out of order');
      idat.push(data);
      sawImageData = true;
    } else if (type === 'IEND') {
      if (!sawHeader || !sawImageData || length !== 0) {
        throw new Error('PNG IEND chunk is invalid or precedes image data');
      }
      sawEnd = true;
      offset = chunkEnd;
      break;
    } else if (type[0] === type[0]?.toUpperCase()) {
      throw new Error(`Unsupported critical PNG chunk ${type}`);
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd) throw new Error('PNG is missing IHDR, IDAT, or IEND');
  if (offset !== bytes.byteLength) throw new Error('PNG contains trailing bytes after IEND');

  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 4;
  const scanlineLength = rowBytes + 1;
  if (raw.byteLength !== height * scanlineLength) {
    throw new Error(`Unexpected PNG payload length: ${raw.byteLength} !== ${height * scanlineLength}`);
  }
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    const filter = raw[rowOffset];
    const sourceOffset = rowOffset + 1;
    const targetOffset = y * rowBytes;
    const previousOffset = targetOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = raw[sourceOffset + x];
      const left = x >= 4 ? pixels[targetOffset + x - 4] : 0;
      const up = y > 0 ? pixels[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[previousOffset + x - 4] : 0;
      let valueAtPixel;
      if (filter === 0) valueAtPixel = source;
      else if (filter === 1) valueAtPixel = source + left;
      else if (filter === 2) valueAtPixel = source + up;
      else if (filter === 3) valueAtPixel = source + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const prediction = left + up - upLeft;
        const leftDistance = Math.abs(prediction - left);
        const upDistance = Math.abs(prediction - up);
        const diagonalDistance = Math.abs(prediction - upLeft);
        const predictor = leftDistance <= upDistance && leftDistance <= diagonalDistance
          ? left
          : upDistance <= diagonalDistance ? up : upLeft;
        valueAtPixel = source + predictor;
      } else throw new Error(`Unsupported PNG row filter ${filter}`);
      pixels[targetOffset + x] = valueAtPixel & 0xff;
    }
  }
  return { width, height, raw, pixels };
}

export function compareRgbaPngs(baselineValue, candidateValue) {
  const baseline = decodeRgbaPng(baselineValue);
  const candidate = decodeRgbaPng(candidateValue);
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    throw new Error(`PNG dimensions differ: ${baseline.width}x${baseline.height} !== ${candidate.width}x${candidate.height}`);
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < baseline.pixels.byteLength; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(baseline.pixels[index + channel] - candidate.pixels[index + channel]);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > 0) pixelDiffers = true;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  const totalPixels = baseline.width * baseline.height;
  return {
    width: baseline.width,
    height: baseline.height,
    totalPixels,
    differingPixels,
    ratio: differingPixels / totalPixels,
    maxChannelDelta,
  };
}

export function inspectRgbaPng(value, label = 'PNG') {
  const { width, height, pixels } = decodeRgbaPng(value);
  const channelMin = [255, 255, 255];
  const channelMax = [0, 0, 0];
  let min = 255;
  let max = 0;
  let opaquePixels = 0;
  for (let index = 0; index < pixels.byteLength; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha === 0) continue;
    opaquePixels += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const sample = pixels[index + channel];
      channelMin[channel] = Math.min(channelMin[channel], sample);
      channelMax[channel] = Math.max(channelMax[channel], sample);
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
  }
  const pixelCount = width * height;
  const opaqueRatio = opaquePixels / pixelCount;
  const maxChannelRange = Math.max(...channelMax.map((valueAtChannel, index) => (
    valueAtChannel - channelMin[index]
  )));
  if (opaqueRatio < 0.01 || maxChannelRange < 8) {
    throw new Error(`${label} is blank or effectively flat, or effectively transparent`);
  }
  return {
    width,
    height,
    min,
    max,
    opaquePixels,
    opaqueRatio,
    maxChannelRange,
  };
}
