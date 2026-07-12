export const WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT = 256;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

export function alignReadbackStride(
  rowBytes,
  alignmentBytes = WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
) {
  positiveInteger(rowBytes, "rowBytes");
  positiveInteger(alignmentBytes, "alignmentBytes");
  return Math.ceil(rowBytes / alignmentBytes) * alignmentBytes;
}

/**
 * Distinguishes the layout requested for a WebGPU copy from the byte layout
 * actually returned by Three.js. WebGPURenderer may normalize a padded GPU
 * transfer into compact rows, so the requested stride must never be relabelled
 * as observed transport metadata.
 */
export function inferRendererReadbackLayout({
  width,
  height,
  bytesPerPixel,
  returnedByteLength,
  requestedAlignment = WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
}) {
  positiveInteger(width, "width");
  positiveInteger(height, "height");
  positiveInteger(bytesPerPixel, "bytesPerPixel");
  positiveInteger(returnedByteLength, "returnedByteLength");
  positiveInteger(requestedAlignment, "requestedAlignment");

  const rowBytes = width * bytesPerPixel;
  const requestedBytesPerRow = alignReadbackStride(rowBytes, requestedAlignment);
  const compactByteLength = rowBytes * height;
  const requestedShortFinalRowByteLength =
    requestedBytesPerRow * (height - 1) + rowBytes;
  const requestedFullRowsByteLength = requestedBytesPerRow * height;

  const requested = Object.freeze({
    width,
    height,
    bytesPerPixel,
    rowBytes,
    bytesPerRow: requestedBytesPerRow,
    alignmentBytes: requestedAlignment,
    shortFinalRowByteLength: requestedShortFinalRowByteLength,
    fullRowsByteLength: requestedFullRowsByteLength,
  });

  let bytesPerRow;
  let padding;
  if (requestedBytesPerRow === rowBytes && returnedByteLength === compactByteLength) {
    bytesPerRow = rowBytes;
    padding = "compact-aligned";
  } else if (returnedByteLength === compactByteLength) {
    bytesPerRow = rowBytes;
    padding = "renderer-normalized-compact";
  } else if (returnedByteLength === requestedShortFinalRowByteLength) {
    bytesPerRow = requestedBytesPerRow;
    padding = "requested-padding-short-final-row";
  } else if (returnedByteLength === requestedFullRowsByteLength) {
    bytesPerRow = requestedBytesPerRow;
    padding = "requested-padding-full-final-row";
  } else {
    throw new RangeError(
      `renderer returned ${returnedByteLength} bytes; expected compact ${compactByteLength}, ` +
      `short-final-row ${requestedShortFinalRowByteLength}, or full-row ${requestedFullRowsByteLength}`,
    );
  }

  return Object.freeze({
    requested,
    observed: Object.freeze({
      width,
      height,
      bytesPerPixel,
      rowBytes,
      bytesPerRow,
      byteLength: returnedByteLength,
      padding,
    }),
  });
}

export function assertObservedReadbackLayout(layout, returnedByteLength) {
  if (!layout?.observed || layout.observed.byteLength !== returnedByteLength) {
    throw new Error("observed readback byte length does not match the renderer-returned payload");
  }
  const minimum = layout.observed.bytesPerRow * (layout.observed.height - 1) + layout.observed.rowBytes;
  const maximum = layout.observed.bytesPerRow * layout.observed.height;
  if (returnedByteLength !== minimum && returnedByteLength !== maximum) {
    throw new Error("observed readback stride cannot produce the renderer-returned payload length");
  }
  return true;
}
