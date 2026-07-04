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

export function buildProfileSamples(railWidth, preset = LOD_PRESETS.hero) {
  const pinned = [0, 0.085, 0.205, 0.42, 0.61, 0.735, 0.905, 1];
  const samples = new Set(pinned.map((value) => Number(value.toFixed(6))));
  for (let index = 0; samples.size < preset.profileSamples; index += 1) {
    samples.add(Number((index / (preset.profileSamples - 1)).toFixed(6)));
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
    return { t, z, profileArcLength: arc };
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
  const capacity = {
    vertices: profile.length * (lengthSegments + 1) * 4,
    indices:
      2 * (profile.length - 1) * lengthSegments * 6 +
      2 * lengthSegments * 6 +
      (profile.length - 1) * 6,
  };
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
        normal: [0, 0, 1],
        tangent: [1, 0, 0, 1],
        uv: [
          distanceAlongRail * texelsPerWorldUnit,
          sample.profileArcLength * texelsPerWorldUnit,
        ],
        debug: [s, sample.t],
        surface: 1,
        boundary: BOUNDARY_REASONS.smoothSkin,
      });
      bottom[p][segment] = writer.duplicateForBoundary(
        top[p][segment],
        BOUNDARY_REASONS.hardEdge,
        {
          position: [x, y, bottomZ],
          normal: [0, 0, -1],
          tangent: [1, 0, 0, -1],
          surface: 2,
        },
      );
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
  for (let segment = 0; segment < lengthSegments; segment += 1) {
    writer.addQuad(bottom[0][segment], bottom[0][segment + 1], top[0][segment], top[0][segment + 1]);
    const last = profile.length - 1;
    writer.addQuad(top[last][segment], top[last][segment + 1], bottom[last][segment], bottom[last][segment + 1]);
  }
  writer.addGroup(wallStart, writer.indexCount - wallStart, "wall");

  const capStart = writer.indexCount;
  for (let p = 0; p < profile.length - 1; p += 1) {
    writer.addQuad(
      writer.duplicateForBoundary(bottom[p][0], BOUNDARY_REASONS.cap, { surface: 4 }),
      writer.duplicateForBoundary(top[p][0], BOUNDARY_REASONS.cap, { surface: 4 }),
      writer.duplicateForBoundary(bottom[p + 1][0], BOUNDARY_REASONS.cap, { surface: 4 }),
      writer.duplicateForBoundary(top[p + 1][0], BOUNDARY_REASONS.cap, { surface: 4 }),
    );
  }
  writer.addGroup(capStart, writer.indexCount - capStart, "cap");

  const geometry = writer.finishGeometry();
  geometry.userData.fixture = {
    tier,
    texelsPerWorldUnit,
    profileSamples: profile.length,
    railSegments: lengthSegments,
  };
  return geometry;
}
