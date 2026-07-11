import { createWriter } from "./mesh-writer.js";
import { LOD_PRESETS } from "./lod-presets.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, amount) => start + (end - start) * amount;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const BOUNDARY_REASONS = Object.freeze({
  smoothSkin: 0,
  hardEdge: 1,
  cap: 2,
  uvSeam: 3,
  materialBoundary: 4,
  mirroredTangent: 5,
});

export function profileZAt(t, railWidth) {
  const scale = railWidth / 0.75;
  const crown = 0.355 * scale * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.56);
  const innerBead = 0.105 * scale * Math.exp(-Math.pow((t - 0.085) / 0.033, 2));
  const outerBead = 0.092 * scale * Math.exp(-Math.pow((t - 0.905) / 0.038, 2));
  const innerGroove = -0.115 * scale * Math.exp(-Math.pow((t - 0.205) / 0.043, 2));
  const outerGroove = -0.102 * scale * Math.exp(-Math.pow((t - 0.735) / 0.052, 2));
  const shoulder = 0.045 * scale * Math.exp(-Math.pow((t - 0.42) / 0.15, 2));
  const cove = -0.035 * scale * Math.exp(-Math.pow((t - 0.61) / 0.095, 2));
  let z = 0.07 * scale + crown + innerBead + outerBead + innerGroove + outerGroove + shoulder + cove;
  z = lerp(0.105 * scale, z, smoothstep(0, 0.052, t));
  z = lerp(z, 0.095 * scale, smoothstep(0.952, 1, t));
  return z;
}

function profileDerivativeAt(t, railWidth) {
  const step = 1e-5;
  const low = Math.max(0, t - step);
  const high = Math.min(1, t + step);
  return (profileZAt(high, railWidth) - profileZAt(low, railWidth)) / (high - low || 1);
}

export function findProfileExtrema(railWidth) {
  const roots = [];
  const scanSteps = 4096;
  let previousT = 1 / scanSteps;
  let previousValue = profileDerivativeAt(previousT, railWidth);
  for (let step = 2; step < scanSteps; step += 1) {
    const t = step / scanSteps;
    const value = profileDerivativeAt(t, railWidth);
    if (Number.isFinite(previousValue) && Number.isFinite(value) && previousValue * value < 0) {
      let low = previousT;
      let high = t;
      let lowValue = previousValue;
      for (let iteration = 0; iteration < 40; iteration += 1) {
        const midpoint = (low + high) * 0.5;
        const midpointValue = profileDerivativeAt(midpoint, railWidth);
        if (lowValue * midpointValue <= 0) high = midpoint;
        else {
          low = midpoint;
          lowValue = midpointValue;
        }
      }
      roots.push((low + high) * 0.5);
    }
    previousT = t;
    previousValue = value;
  }
  return roots;
}

function refinementCandidate(start, end, railWidth) {
  const startZ = profileZAt(start, railWidth);
  const endZ = profileZAt(end, railWidth);
  const startSlope = profileDerivativeAt(start, railWidth) / railWidth;
  const endSlope = profileDerivativeAt(end, railWidth) / railWidth;
  const startAngle = Math.atan(startSlope);
  const endAngle = Math.atan(endSlope);
  let selectedT = (start + end) * 0.5;
  let selectedScore = -Infinity;
  for (let sample = 1; sample < 32; sample += 1) {
    const amount = sample / 32;
    const t = lerp(start, end, amount);
    const chordError = Math.abs(profileZAt(t, railWidth) - lerp(startZ, endZ, amount)) / railWidth;
    const normalAngleError = Math.abs(
      Math.atan(profileDerivativeAt(t, railWidth) / railWidth) - lerp(startAngle, endAngle, amount),
    );
    const score = chordError + normalAngleError * 0.125;
    if (score > selectedScore) {
      selectedScore = score;
      selectedT = t;
    }
  }
  return { score: selectedScore, t: selectedT };
}

export function buildProfileSamples(railWidth, preset = LOD_PRESETS.hero) {
  const samples = new Set([0, 1, ...findProfileExtrema(railWidth)].map((value) => Number(value.toFixed(9))));
  if (samples.size > preset.profileSamples) {
    throw new Error(`tier requests ${preset.profileSamples} samples but ${samples.size} profile extrema are mandatory`);
  }
  while (samples.size < preset.profileSamples) {
    const sorted = Array.from(samples).sort((a, b) => a - b);
    let selected = null;
    let selectedScore = -Infinity;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index];
      const end = sorted[index + 1];
      const candidate = refinementCandidate(start, end, railWidth);
      if (candidate.score > selectedScore) {
        selectedScore = candidate.score;
        selected = candidate.t;
      }
    }
    samples.add(Number(selected.toFixed(9)));
  }
  const sorted = Array.from(samples).sort((a, b) => a - b);
  let arc = 0;
  return sorted.map((t, index) => {
    const z = profileZAt(t, railWidth);
    if (index > 0) {
      const previous = sorted[index - 1];
      const dz = z - profileZAt(previous, railWidth);
      arc += Math.hypot((t - previous) * railWidth, dz);
    }
    const dzdt = profileDerivativeAt(t, railWidth);
    const normalLength = Math.hypot(dzdt, railWidth);
    return {
      t,
      z,
      dzdt,
      normal: [0, -dzdt / normalLength, railWidth / normalLength],
      profileArcLength: arc,
    };
  });
}

export function measureProfileApproximation(profile, railWidth, { subsamples = 32 } = {}) {
  const extrema = findProfileExtrema(railWidth);
  let maximumGap = 0;
  let maximumNormalizedChordError = 0;
  let maximumNormalAngleError = 0;
  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = profile[index];
    const end = profile[index + 1];
    maximumGap = Math.max(maximumGap, end.t - start.t);
    const startAngle = Math.atan(start.dzdt / railWidth);
    const endAngle = Math.atan(end.dzdt / railWidth);
    for (let sample = 1; sample < subsamples; sample += 1) {
      const amount = sample / subsamples;
      const t = lerp(start.t, end.t, amount);
      maximumNormalizedChordError = Math.max(
        maximumNormalizedChordError,
        Math.abs(profileZAt(t, railWidth) - lerp(start.z, end.z, amount)) / railWidth,
      );
      maximumNormalAngleError = Math.max(
        maximumNormalAngleError,
        Math.abs(
          Math.atan(profileDerivativeAt(t, railWidth) / railWidth) - lerp(startAngle, endAngle, amount),
        ),
      );
    }
  }
  const preservedExtrema = extrema.filter((root) =>
    profile.some((sample) => Math.abs(sample.t - root) <= 2e-8));
  return {
    maximumGap,
    maximumNormalizedChordError,
    maximumNormalAngleError,
    extrema,
    preservedExtrema,
    extremaPreservationOk: preservedExtrema.length === extrema.length,
  };
}

export function frameFixtureCapacity(profileSampleCount, railSegments) {
  const stations = railSegments + 1;
  return Object.freeze({
    // Top/backing grids, two separately-owned wall strips, and two separately
    // owned caps. No surface relies on post-allocation duplication.
    vertices:
      2 * profileSampleCount * stations +
      4 * stations +
      4 * profileSampleCount,
    indices:
      2 * (profileSampleCount - 1) * railSegments * 6 +
      2 * railSegments * 6 +
      2 * (profileSampleCount - 1) * 6,
  });
}

export function buildFrameFixture({
  tier = "hero",
  railLength = 4,
  railWidth = 0.75,
  texelsPerWorldUnit = 4,
} = {}) {
  const preset = LOD_PRESETS[tier];
  const profile = buildProfileSamples(railWidth, preset);
  const lengthSegments = preset.railSegments;
  const capacity = frameFixtureCapacity(profile.length, lengthSegments);
  const writer = createWriter(capacity, ["top", "backing", "wall", "cap"]);
  const top = [];
  const bottom = [];
  const bottomZ = -0.18 * (railWidth / 0.75);

  for (let p = 0; p < profile.length; p += 1) {
    top[p] = [];
    bottom[p] = [];
    const sample = profile[p];
    for (let segment = 0; segment <= lengthSegments; segment += 1) {
      const s = segment / lengthSegments;
      const distanceAlongRail = s * railLength;
      const x = distanceAlongRail;
      const y = sample.t * railWidth;
      top[p][segment] = writer.addVertex({
        position: [x, y, sample.z],
        normal: sample.normal,
        tangent: [1, 0, 0, 1],
        uv: [
          distanceAlongRail * texelsPerWorldUnit,
          sample.profileArcLength * texelsPerWorldUnit,
        ],
        debug: [s, sample.t],
        surface: 1,
        boundary: BOUNDARY_REASONS.smoothSkin,
      });
      bottom[p][segment] = writer.addVertex({
        position: [x, y, bottomZ],
        normal: [0, 0, -1],
        tangent: [1, 0, 0, -1],
        uv: [distanceAlongRail * texelsPerWorldUnit, sample.t * railWidth * texelsPerWorldUnit],
        debug: [s, sample.t],
        surface: 2,
        boundary: BOUNDARY_REASONS.hardEdge,
      });
    }
  }

  const topStart = writer.indexCount;
  for (let p = 0; p < profile.length - 1; p += 1) {
    for (let segment = 0; segment < lengthSegments; segment += 1) {
      writer.addQuad(top[p][segment], top[p][segment + 1], top[p + 1][segment], top[p + 1][segment + 1]);
    }
  }
  writer.addGroup(topStart, writer.indexCount - topStart, "top");

  const backingStart = writer.indexCount;
  for (let p = 0; p < profile.length - 1; p += 1) {
    for (let segment = 0; segment < lengthSegments; segment += 1) {
      writer.addQuad(bottom[p + 1][segment], bottom[p + 1][segment + 1], bottom[p][segment], bottom[p][segment + 1]);
    }
  }
  writer.addGroup(backingStart, writer.indexCount - backingStart, "backing");

  const wallStart = writer.indexCount;
  const innerWall = [[], []];
  const outerWall = [[], []];
  const last = profile.length - 1;
  for (let segment = 0; segment <= lengthSegments; segment += 1) {
    const s = segment / lengthSegments;
    const distanceAlongRail = s * railLength;
    for (const [row, z, normal, surface, handedness] of [
      [0, profile[0].z, [0, -1, 0], 3, 1],
      [1, bottomZ, [0, -1, 0], 3, 1],
    ]) {
      innerWall[row][segment] = writer.addVertex({
        position: [distanceAlongRail, 0, z],
        normal,
        tangent: [1, 0, 0, handedness],
        uv: [distanceAlongRail * texelsPerWorldUnit, (z - bottomZ) * texelsPerWorldUnit],
        debug: [s, row],
        surface,
        boundary: BOUNDARY_REASONS.hardEdge,
      });
    }
    for (const [row, z, normal, surface, handedness] of [
      [0, profile[last].z, [0, 1, 0], 3, -1],
      [1, bottomZ, [0, 1, 0], 3, -1],
    ]) {
      outerWall[row][segment] = writer.addVertex({
        position: [distanceAlongRail, railWidth, z],
        normal,
        tangent: [1, 0, 0, handedness],
        uv: [distanceAlongRail * texelsPerWorldUnit, (z - bottomZ) * texelsPerWorldUnit],
        debug: [s, row],
        surface,
        boundary: BOUNDARY_REASONS.hardEdge,
      });
    }
  }
  for (let segment = 0; segment < lengthSegments; segment += 1) {
    writer.addQuad(innerWall[1][segment], innerWall[1][segment + 1], innerWall[0][segment], innerWall[0][segment + 1]);
    writer.addQuad(outerWall[0][segment], outerWall[0][segment + 1], outerWall[1][segment], outerWall[1][segment + 1]);
  }
  writer.addGroup(wallStart, writer.indexCount - wallStart, "wall");

  const capStart = writer.indexCount;
  const caps = [];
  for (const [capIndex, segment, xNormal] of [[0, 0, -1], [1, lengthSegments, 1]]) {
    caps[capIndex] = [[], []];
    for (let p = 0; p < profile.length; p += 1) {
      const sample = profile[p];
      for (const [row, z] of [[0, bottomZ], [1, sample.z]]) {
        caps[capIndex][row][p] = writer.addVertex({
          position: [segment === 0 ? 0 : railLength, sample.t * railWidth, z],
          normal: [xNormal, 0, 0],
          tangent: [0, 1, 0, xNormal < 0 ? -1 : 1],
          uv: [sample.t * railWidth * texelsPerWorldUnit, (z - bottomZ) * texelsPerWorldUnit],
          debug: [sample.t, row],
          surface: 4,
          boundary: BOUNDARY_REASONS.cap,
        });
      }
    }
  }
  for (let p = 0; p < profile.length - 1; p += 1) {
    writer.addQuad(caps[0][0][p + 1], caps[0][0][p], caps[0][1][p + 1], caps[0][1][p]);
    writer.addQuad(caps[1][0][p], caps[1][0][p + 1], caps[1][1][p], caps[1][1][p + 1]);
  }
  writer.addGroup(capStart, writer.indexCount - capStart, "cap");

  const geometry = writer.finishGeometry();
  const profileApproximation = measureProfileApproximation(profile, railWidth);
  geometry.userData.fixture = {
    tier,
    texelsPerWorldUnit,
    profileSamples: profile.length,
    railSegments: lengthSegments,
    profileT: profile.map((sample) => sample.t),
    profileApproximation,
  };
  return geometry;
}
