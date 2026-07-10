export const WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT = 256;

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function alignedBytesPerRow(
  width,
  bytesPerPixel,
  alignment = WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
) {
  requirePositiveInteger(width, 'width');
  requirePositiveInteger(bytesPerPixel, 'bytesPerPixel');
  requirePositiveInteger(alignment, 'alignment');

  const logicalBytesPerRow = width * bytesPerPixel;
  if (!Number.isSafeInteger(logicalBytesPerRow)) {
    throw new RangeError('logical row size exceeds the safe integer range');
  }
  return Math.ceil(logicalBytesPerRow / alignment) * alignment;
}

export function requiredPaddedByteLength(width, height, bytesPerPixel, bytesPerRow) {
  requirePositiveInteger(width, 'width');
  requirePositiveInteger(height, 'height');
  requirePositiveInteger(bytesPerPixel, 'bytesPerPixel');
  requirePositiveInteger(bytesPerRow, 'bytesPerRow');
  const logicalBytesPerRow = width * bytesPerPixel;
  if (bytesPerRow < logicalBytesPerRow) {
    throw new RangeError('bytesPerRow is smaller than the logical row width');
  }
  if (bytesPerRow % WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT !== 0) {
    throw new RangeError('bytesPerRow does not satisfy WebGPU copy alignment');
  }
  return bytesPerRow * (height - 1) + logicalBytesPerRow;
}

export function unpackAlignedRows({
  source,
  width,
  height,
  bytesPerPixel,
  bytesPerRow,
}) {
  if (!ArrayBuffer.isView(source)) throw new TypeError('source must be an ArrayBuffer view');
  const requiredLength = requiredPaddedByteLength(width, height, bytesPerPixel, bytesPerRow);
  if (source.byteLength < requiredLength) {
    throw new RangeError(`readback buffer is ${source.byteLength} bytes; ${requiredLength} required`);
  }

  const logicalBytesPerRow = width * bytesPerPixel;
  const input = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const output = new Uint8Array(logicalBytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * bytesPerRow;
    output.set(input.subarray(sourceOffset, sourceOffset + logicalBytesPerRow), y * logicalBytesPerRow);
  }
  return output;
}
