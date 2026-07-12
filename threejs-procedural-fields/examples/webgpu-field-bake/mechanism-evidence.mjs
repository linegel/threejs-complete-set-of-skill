export const FIELD_MECHANISM_IDS = Object.freeze([
  "field-and-gradient-gallery",
  "domain-warp-jacobian",
  "storage-bake-and-mips",
  "direct-vs-baked",
  "structured-placement",
  "shared-cause-composition",
]);

export function analyzeFieldMechanismRgba(bytes, width, height) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== width * height * 4) {
    throw new Error("mechanism readback byte length mismatch");
  }
  const channelMin = [255, 255, 255, 255];
  const channelMax = [0, 0, 0, 0];
  const unique = new Set();
  let nonBlack = 0;
  let nonWhite = 0;
  let redDominant = 0;
  let greenDominant = 0;
  let pairedHalfSumAbsError = 0;
  let pairedHalfMaxAbsError = 0;
  let pairedHalfValueCount = 0;
  const halfWidth = Math.floor(width / 2);
  const rightStart = width - halfWidth;
  const leftHash = createHash("sha256");
  const rightHash = createHash("sha256");

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    leftHash.update(bytes.subarray(rowOffset, rowOffset + halfWidth * 4));
    rightHash.update(bytes.subarray(
      rowOffset + rightStart * 4,
      rowOffset + (rightStart + halfWidth) * 4,
    ));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const rgba = bytes.subarray(offset, offset + 4);
      for (let lane = 0; lane < 4; lane += 1) {
        channelMin[lane] = Math.min(channelMin[lane], rgba[lane]);
        channelMax[lane] = Math.max(channelMax[lane], rgba[lane]);
      }
      const [r, g, b, a] = rgba;
      unique.add((((r * 256 + g) * 256 + b) * 256 + a) >>> 0);
      if (r !== 0 || g !== 0 || b !== 0) nonBlack += 1;
      if (r !== 255 || g !== 255 || b !== 255) nonWhite += 1;
      if (r > g + 16 && r > b + 16) redDominant += 1;
      if (g > r + 16 && g > b + 16) greenDominant += 1;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < halfWidth; x += 1) {
      const leftOffset = (y * width + x) * 4;
      const rightOffset = (y * width + x + rightStart) * 4;
      for (let lane = 0; lane < 3; lane += 1) {
        const error = Math.abs(bytes[leftOffset + lane] - bytes[rightOffset + lane]);
        pairedHalfSumAbsError += error;
        pairedHalfMaxAbsError = Math.max(pairedHalfMaxAbsError, error);
        pairedHalfValueCount += 1;
      }
    }
  }
  const pixelCount = width * height;
  return Object.freeze({
    schemaVersion: 2,
    statisticsSource: "recomputed-from-decoded-rgba8",
    comparisonGeometry: Object.freeze({
      leftStart: 0,
      rightStart,
      halfWidth,
      excludedCenterColumns: width - halfWidth * 2,
    }),
    channelMin,
    channelMax,
    channelRange: channelMax.map((value, index) => value - channelMin[index]),
    uniqueRgbaCount: unique.size,
    nonBlackOccupancy: nonBlack / pixelCount,
    nonWhiteOccupancy: nonWhite / pixelCount,
    redDominantOccupancy: redDominant / pixelCount,
    greenDominantOccupancy: greenDominant / pixelCount,
    leftSha256: leftHash.digest("hex"),
    rightSha256: rightHash.digest("hex"),
    pairedHalfMeanAbsError: pairedHalfSumAbsError / pairedHalfValueCount,
    pairedHalfMaxAbsError,
    pairedHalfValueCount,
  });
}

export function validateReportedFieldMechanismStatistics(id, reported, bytes, width, height) {
  const recomputed = analyzeFieldMechanismRgba(bytes, width, height);
  if (JSON.stringify(reported) !== JSON.stringify(recomputed)) {
    throw new Error(`${id} reported statistics do not match decoded RGBA8 pixels`);
  }
  return validateFieldMechanismStatistics(id, recomputed);
}

export function validateFieldMechanismStatistics(id, statistics) {
  if (!FIELD_MECHANISM_IDS.includes(id)) throw new Error(`Unknown field mechanism "${id}"`);
  if (!statistics || !Array.isArray(statistics.channelRange) || statistics.channelRange.length !== 4) {
    throw new Error(`${id} mechanism statistics are incomplete`);
  }
  for (const key of [
    "uniqueRgbaCount",
    "nonBlackOccupancy",
    "nonWhiteOccupancy",
    "redDominantOccupancy",
    "greenDominantOccupancy",
  ]) {
    if (!Number.isFinite(statistics[key])) throw new Error(`${id} ${key} must be finite`);
  }
  if (statistics.uniqueRgbaCount < 64) {
    throw new Error(`${id} has insufficient color variation`);
  }
  if (statistics.nonBlackOccupancy < 0.2 || statistics.nonWhiteOccupancy < 0.2) {
    throw new Error(`${id} is predominantly blank or constant`);
  }
  if (statistics.channelRange.slice(0, 3).filter((range) => range >= 8).length < 2) {
    throw new Error(`${id} lacks two materially varying semantic channels`);
  }
  if (
    id === "domain-warp-jacobian" &&
    !statistics.channelRange.slice(0, 3).every((range) => range >= 8)
  ) {
    throw new Error("domain-warp-jacobian must vary all three tangent-vector channels");
  }
  if (id === "structured-placement") {
    if (statistics.redDominantOccupancy < 0.01) {
      throw new Error("placement diagnostic omitted rejected cells");
    }
    if (statistics.greenDominantOccupancy < 0.01) {
      throw new Error("placement diagnostic omitted accepted cells");
    }
  }
  if (id === "direct-vs-baked") {
    if (statistics.leftSha256 === statistics.rightSha256) {
      throw new Error("direct-vs-baked halves are falsely duplicated");
    }
    if (!Number.isFinite(statistics.pairedHalfMeanAbsError) || statistics.pairedHalfMeanAbsError > 0.05) {
      throw new Error(
        `direct-vs-baked visual mean error ${statistics.pairedHalfMeanAbsError} exceeded 0.05/255`,
      );
    }
    if (!Number.isFinite(statistics.pairedHalfMaxAbsError) || statistics.pairedHalfMaxAbsError > 2) {
      throw new Error(
        `direct-vs-baked visual max error ${statistics.pairedHalfMaxAbsError} exceeded 2/255`,
      );
    }
    if (
      statistics.comparisonGeometry?.rightStart !==
        statistics.comparisonGeometry?.halfWidth + statistics.comparisonGeometry?.excludedCenterColumns
    ) {
      throw new Error("direct-vs-baked comparison is not point-aligned around the excluded center seam");
    }
  }
  return Object.freeze(statistics);
}
import { createHash } from "node:crypto";
