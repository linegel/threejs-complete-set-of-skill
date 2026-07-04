import { normalize } from "./planet-fields.js";

export const FACE_AXES = Object.freeze([
  { name: "+X", origin: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { name: "-X", origin: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { name: "+Y", origin: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { name: "-Y", origin: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { name: "+Z", origin: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { name: "-Z", origin: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
]);

function add3(a, b, c = [0, 0, 0]) {
  return [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
}

function scale3(a, scale) {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

export function createPatch({ face, level = 0, x = 0, y = 0, bounds = null }) {
  const size = 1 / 2 ** level;
  const uvRect = {
    minU: x * size,
    minV: y * size,
    maxU: (x + 1) * size,
    maxV: (y + 1) * size,
  };
  return {
    id: `face${face}:level${level}:x${x}:y${y}`,
    face,
    level,
    x,
    y,
    uvRect,
    faceAxes: FACE_AXES[face],
    screenError: 0,
    neighborLevels: { north: level, south: level, east: level, west: level },
    transitionEdges: { north: false, south: false, east: false, west: false },
    bounds: bounds ?? { minHeight: 0, maxHeight: 0, radius: 1 },
  };
}

export function patchCenterDirection(patch) {
  const face = FACE_AXES[patch.face];
  const u = (patch.uvRect.minU + patch.uvRect.maxU) - 1;
  const v = (patch.uvRect.minV + patch.uvRect.maxV) - 1;
  return normalize(add3(face.origin, scale3(face.u, u), scale3(face.v, v)));
}

export function createRootPatches() {
  return FACE_AXES.map((_, face) => createPatch({ face }));
}

export function splitPatch(patch) {
  const childLevel = patch.level + 1;
  return [
    createPatch({ face: patch.face, level: childLevel, x: patch.x * 2, y: patch.y * 2 }),
    createPatch({ face: patch.face, level: childLevel, x: patch.x * 2 + 1, y: patch.y * 2 }),
    createPatch({ face: patch.face, level: childLevel, x: patch.x * 2, y: patch.y * 2 + 1 }),
    createPatch({ face: patch.face, level: childLevel, x: patch.x * 2 + 1, y: patch.y * 2 + 1 }),
  ];
}

export function projectedScreenError({
  patch,
  cameraDistance,
  radiusKm,
  viewportHeight,
  fovRadians,
}) {
  const patchGeometricError = radiusKm / 2 ** (patch.level + 4);
  const projectionScale = viewportHeight / (2 * Math.tan(fovRadians / 2));
  return (patchGeometricError * projectionScale) / Math.max(cameraDistance, 1e-5);
}

export function shouldSplitPatch(patch, { splitThreshold, maxLevel }) {
  return patch.screenError > splitThreshold && patch.level < maxLevel;
}

export function shouldMergePatch(patch, { mergeThreshold }) {
  return patch.screenError < mergeThreshold && patch.level > 0;
}

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function edgeNeighbors(patch, patches, edge) {
  return patches.filter((candidate) => {
    if (candidate.id === patch.id || candidate.face !== patch.face) return false;
    if (edge === "east") {
      return (
        candidate.uvRect.minU === patch.uvRect.maxU &&
        overlaps(candidate.uvRect.minV, candidate.uvRect.maxV, patch.uvRect.minV, patch.uvRect.maxV)
      );
    }
    if (edge === "west") {
      return (
        candidate.uvRect.maxU === patch.uvRect.minU &&
        overlaps(candidate.uvRect.minV, candidate.uvRect.maxV, patch.uvRect.minV, patch.uvRect.maxV)
      );
    }
    if (edge === "north") {
      return (
        candidate.uvRect.minV === patch.uvRect.maxV &&
        overlaps(candidate.uvRect.minU, candidate.uvRect.maxU, patch.uvRect.minU, patch.uvRect.maxU)
      );
    }
    return (
      candidate.uvRect.maxV === patch.uvRect.minV &&
      overlaps(candidate.uvRect.minU, candidate.uvRect.maxU, patch.uvRect.minU, patch.uvRect.maxU)
    );
  });
}

export function annotateNeighborLevels(patches) {
  for (const patch of patches) {
    for (const edge of ["north", "south", "east", "west"]) {
      const neighbors = edgeNeighbors(patch, patches, edge);
      const level = neighbors.length
        ? Math.max(...neighbors.map((neighbor) => neighbor.level))
        : patch.level;
      patch.neighborLevels[edge] = level;
      patch.transitionEdges[edge] = level < patch.level;
    }
  }
  return patches;
}

export function assertAdjacentLevelDelta(patches, maxDelta = 1) {
  const errors = [];
  for (const patch of patches) {
    for (const edge of ["north", "south", "east", "west"]) {
      for (const neighbor of edgeNeighbors(patch, patches, edge)) {
        const delta = Math.abs(patch.level - neighbor.level);
        if (delta > maxDelta) {
          errors.push(`${patch.id} ${edge} neighbor ${neighbor.id} level delta ${delta}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
