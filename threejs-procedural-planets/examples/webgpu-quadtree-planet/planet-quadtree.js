import { normalize } from "./planet-fields.js";

export const QUADTREE_EVIDENCE_SCOPE = Object.freeze({
  adjacency: "executed CPU fixture, including cube-face boundaries",
  balance: "executed CPU fixture over supplied leaf set",
  projectedError:
    "executed exact projection over caller-supplied support pairs and every supplied unjittered view",
  runtimeSelection:
    "executed horizon-aware six-face frontier selection from an authored conservative slope bound",
  bounds:
    "analytic radial-range and spherical-sector bounds; field-specific slope bound remains authored",
  exclusions: [
    "no proof that the supplied support pairs cover the continuous displaced patch",
    "no crack-free raster capture until native-WebGPU evidence is promoted",
  ],
});

export const PLANET_PATCH_EDGES = Object.freeze(["north", "east", "south", "west"]);

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

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function clampScalar(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
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
    bounds: bounds ?? {
      minHeightKm: 0,
      maxHeightKm: 0,
      boundingSphereRadiusKm: null,
      geometricErrorKm: null,
    },
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

function transformPoint4(matrix, point) {
  if (!Array.isArray(matrix) || matrix.length !== 16) {
    throw new Error("view/projection matrices must be 16 column-major values");
  }
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  ];
}

function transformVector4(matrix, vector) {
  const [x, y, z, w] = vector;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

function projectPhysicalPixel(point, view) {
  const viewPoint = transformPoint4(view.viewMatrix, point);
  const viewDepth = -viewPoint[2] / viewPoint[3];
  if (!(viewDepth >= view.cameraNear)) {
    throw new Error("projected-error support crosses or precedes the camera near plane");
  }
  const clip = transformVector4(view.projectionMatrix, viewPoint);
  if (!(clip[3] > 0)) {
    throw new Error("projected-error support has non-positive clip w");
  }
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return [
    (ndcX * 0.5 + 0.5) * view.renderTargetWidthPx,
    (0.5 - ndcY * 0.5) * view.renderTargetHeightPx,
  ];
}

// Implements the shared projected-error contract for a finite support witness.
// The caller still owns proof that supportPairs cover the complete static,
// procedural, deformation, and dwell-time motion envelope.
export function projectedScreenError({ supportPairs, views }) {
  if (!Array.isArray(supportPairs) || supportPairs.length === 0) {
    throw new Error("projectedScreenError requires a nonempty supportPairs array");
  }
  if (!Array.isArray(views) || views.length === 0) {
    throw new Error("projectedScreenError requires every active view");
  }
  let maximumPixels = 0;
  for (const view of views) {
    if (view.unjitteredProjection !== true) {
      throw new Error("LOD selection requires an unjittered projection");
    }
    if (!(view.renderTargetWidthPx > 0) || !(view.renderTargetHeightPx > 0) ||
        !(view.cameraNear > 0)) {
      throw new Error("view requires physical render-target dimensions and positive cameraNear");
    }
    for (const pair of supportPairs) {
      if (!Array.isArray(pair.referenceWorld) || !Array.isArray(pair.approximateWorld)) {
        throw new Error("each support pair requires referenceWorld and approximateWorld points");
      }
      const referencePixel = projectPhysicalPixel(pair.referenceWorld, view);
      const approximatePixel = projectPhysicalPixel(pair.approximateWorld, view);
      maximumPixels = Math.max(
        maximumPixels,
        Math.hypot(
          approximatePixel[0] - referencePixel[0],
          approximatePixel[1] - referencePixel[1],
        ),
      );
    }
  }
  return maximumPixels;
}

export function shouldSplitPatch(patch, { splitThreshold, maxLevel }) {
  return patch.screenError > splitThreshold && patch.level < maxLevel;
}

export function shouldMergePatch(patch, { mergeThreshold }) {
  return patch.screenError < mergeThreshold && patch.level > 0;
}

function cubePoint(patch, unitU, unitV) {
  const face = FACE_AXES[patch.face];
  const u = unitU * 2 - 1;
  const v = unitV * 2 - 1;
  return add3(face.origin, scale3(face.u, u), scale3(face.v, v));
}

export function patchSurfaceDirection(patch, localU, localV) {
  if (!(localU >= 0 && localU <= 1 && localV >= 0 && localV <= 1)) {
    throw new Error("patch-local coordinates must be in [0, 1]");
  }
  const { minU, minV, maxU, maxV } = patch.uvRect;
  const unitU = minU + (maxU - minU) * localU;
  const unitV = minV + (maxV - minV) * localV;
  return normalize(cubePoint(patch, unitU, unitV));
}

function edgeSegment(patch, edge) {
  const { minU, minV, maxU, maxV } = patch.uvRect;
  if (edge === "north") return [cubePoint(patch, minU, maxV), cubePoint(patch, maxU, maxV)];
  if (edge === "south") return [cubePoint(patch, minU, minV), cubePoint(patch, maxU, minV)];
  if (edge === "east") return [cubePoint(patch, maxU, minV), cubePoint(patch, maxU, maxV)];
  return [cubePoint(patch, minU, minV), cubePoint(patch, minU, maxV)];
}

function segmentDescriptor(segment) {
  const delta = segment[1].map((value, axis) => value - segment[0][axis]);
  const varyingAxis = delta.reduce(
    (best, value, axis) => Math.abs(value) > Math.abs(delta[best]) ? axis : best,
    0,
  );
  const constantAxes = [0, 1, 2].filter((axis) => axis !== varyingAxis);
  const quantize = (value) => Math.round(value * 2 ** 30) / 2 ** 30;
  return {
    lineKey: `${varyingAxis}:${constantAxes.map((axis) => quantize(segment[0][axis])).join(":")}`,
    min: Math.min(segment[0][varyingAxis], segment[1][varyingAxis]),
    max: Math.max(segment[0][varyingAxis], segment[1][varyingAxis]),
  };
}

function segmentsOverlap(a, b, epsilon = 1e-12) {
  return a.lineKey === b.lineKey && Math.min(a.max, b.max) - Math.max(a.min, b.min) > epsilon;
}

function allPatchEdges(patch) {
  return ["north", "south", "east", "west"].map((edge) => ({
    edge,
    descriptor: segmentDescriptor(edgeSegment(patch, edge)),
  }));
}

function createPatchEdgeIndex(patches) {
  const byLine = new Map();
  for (const patch of patches) {
    for (const entry of allPatchEdges(patch)) {
      const bucket = byLine.get(entry.descriptor.lineKey) ?? [];
      bucket.push({ patch, edge: entry.edge, descriptor: entry.descriptor });
      byLine.set(entry.descriptor.lineKey, bucket);
    }
  }
  for (const bucket of byLine.values()) {
    bucket.sort((a, b) => a.descriptor.min - b.descriptor.min ||
      a.descriptor.max - b.descriptor.max || a.patch.id.localeCompare(b.patch.id));
  }
  return byLine;
}

function indexedEdgeNeighbors(patch, edge, edgeIndex) {
  const descriptor = segmentDescriptor(edgeSegment(patch, edge));
  return (edgeIndex.get(descriptor.lineKey) ?? [])
    .filter((candidate) => candidate.patch.id !== patch.id &&
      segmentsOverlap(descriptor, candidate.descriptor))
    .map((candidate) => candidate.patch);
}

export function edgeNeighbors(patch, patches, edge) {
  return indexedEdgeNeighbors(patch, edge, createPatchEdgeIndex(patches));
}

export function annotateNeighborLevels(patches) {
  const edgeIndex = createPatchEdgeIndex(patches);
  for (const patch of patches) {
    for (const edge of ["north", "south", "east", "west"]) {
      const neighbors = indexedEdgeNeighbors(patch, edge, edgeIndex);
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
  const edgeIndex = createPatchEdgeIndex(patches);
  for (const patch of patches) {
    for (const edge of ["north", "south", "east", "west"]) {
      for (const neighbor of indexedEdgeNeighbors(patch, edge, edgeIndex)) {
        const delta = Math.abs(patch.level - neighbor.level);
        if (delta > maxDelta) {
          errors.push(`${patch.id} ${edge} neighbor ${neighbor.id} level delta ${delta}`);
        }
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    evidenceScope: QUADTREE_EVIDENCE_SCOPE,
  };
}

/**
 * Verify that every directed edge-neighbor relation has a reciprocal edge on
 * the candidate. This catches face-orientation tables that look plausible for
 * one traversal direction but fail at a cube edge or corner.
 */
export function validateReciprocalAdjacency(patches) {
  const errors = [];
  const edgeIndex = createPatchEdgeIndex(patches);
  for (const patch of patches) {
    for (const edge of ["north", "east", "south", "west"]) {
      for (const neighbor of indexedEdgeNeighbors(patch, edge, edgeIndex)) {
        const reciprocal = ["north", "east", "south", "west"].some(
          (neighborEdge) => indexedEdgeNeighbors(neighbor, neighborEdge, edgeIndex)
            .some((candidate) => candidate.id === patch.id),
        );
        if (!reciprocal) {
          errors.push(`${patch.id}:${edge} -> ${neighbor.id} is not reciprocal`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Restrict an arbitrary cube-face leaf set to the 2:1 invariant. Splitting is
 * deterministic (coarsest level, then stable patch id), so cache keys and
 * transition-mask bins do not depend on input iteration order.
 */
export function balanceQuadtree(inputPatches, maxDelta = 1) {
  let patches = [...inputPatches];
  let iterations = 0;
  const maximumIterations = 64;

  while (iterations < maximumIterations) {
    iterations += 1;
    const edgeIndex = createPatchEdgeIndex(patches);
    const coarseIds = new Set();
    for (const patch of patches) {
      for (const edge of ["north", "east", "south", "west"]) {
        for (const neighbor of indexedEdgeNeighbors(patch, edge, edgeIndex)) {
          if (Math.abs(patch.level - neighbor.level) > maxDelta) {
            const coarser = patch.level < neighbor.level ? patch : neighbor;
            coarseIds.add(coarser.id);
          }
        }
      }
    }
    if (coarseIds.size === 0) {
      annotateNeighborLevels(patches);
      return patches;
    }

    const next = [];
    for (const patch of patches) {
      if (coarseIds.has(patch.id)) next.push(...splitPatch(patch));
      else next.push(patch);
    }
    patches = next;
  }

  throw new Error(`quadtree balancing exceeded ${maximumIterations} iterations`);
}

function remapTransitionVertex(x, y, gridSide, mask) {
  const last = gridSide - 1;
  let rx = x;
  let ry = y;
  // Bit order is north/east/south/west. Odd fine-edge vertices collapse to
  // their preceding even coarse-grid vertex. Corners are already even.
  if ((mask & 1) !== 0 && y === last && (x & 1) === 1) rx = x - 1;
  if ((mask & 2) !== 0 && x === last && (y & 1) === 1) ry = y - 1;
  if ((mask & 4) !== 0 && y === 0 && (x & 1) === 1) rx = x - 1;
  if ((mask & 8) !== 0 && x === 0 && (y & 1) === 1) ry = y - 1;
  return ry * gridSide + rx;
}

/** Build one of the 16 dyadic transition-index variants for a 2^k+1 grid. */
export function createTransitionIndexVariant(gridSide, mask) {
  if (!Number.isInteger(gridSide) || gridSide < 3 ||
      !Number.isInteger(Math.log2(gridSide - 1))) {
    throw new Error("gridSide must be 2^k+1 and at least 3");
  }
  if (!Number.isInteger(mask) || mask < 0 || mask > 15) {
    throw new Error("transition mask must be an integer in [0, 15]");
  }

  const indices = [];
  const pushTriangle = (a, b, c) => {
    if (a !== b && b !== c && c !== a) indices.push(a, b, c);
  };
  for (let y = 0; y < gridSide - 1; y += 1) {
    for (let x = 0; x < gridSide - 1; x += 1) {
      const i00 = remapTransitionVertex(x, y, gridSide, mask);
      const i10 = remapTransitionVertex(x + 1, y, gridSide, mask);
      const i01 = remapTransitionVertex(x, y + 1, gridSide, mask);
      const i11 = remapTransitionVertex(x + 1, y + 1, gridSide, mask);
      pushTriangle(i00, i10, i11);
      pushTriangle(i00, i11, i01);
    }
  }
  const IndexType = gridSide * gridSide > 65535 ? Uint32Array : Uint16Array;
  return new IndexType(indices);
}

export function createTransitionIndexVariants(gridSide) {
  return Array.from({ length: 16 }, (_, mask) =>
    createTransitionIndexVariant(gridSide, mask));
}

export function transitionMask(patch) {
  return (
    (patch.transitionEdges.north ? 1 : 0) |
    (patch.transitionEdges.east ? 2 : 0) |
    (patch.transitionEdges.south ? 4 : 0) |
    (patch.transitionEdges.west ? 8 : 0)
  );
}

/**
 * Return the largest central angle between a patch center and its four cube-
 * sphere corners. The result is independent of body radius and is therefore a
 * stable part of the patch identity/bounds contract.
 */
export function patchAngularRadius(patch) {
  const center = patchCenterDirection(patch);
  let maximum = 0;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const corner = patchSurfaceDirection(patch, u, v);
    maximum = Math.max(
      maximum,
      Math.acos(clampScalar(dot3(center, corner), -1, 1)),
    );
  }
  return maximum;
}

/**
 * Bound a displaced spherical sector. `maximumSurfaceSlope` is a bound on
 * |d height_world / d arc_world|. It is explicit because silently inferring a
 * slope from a few field samples is not conservative.
 */
export function createConservativePatchBounds(patch, {
  radiusWorld,
  maximumDisplacementWorld,
  gridSide,
  maximumSurfaceSlope,
} = {}) {
  for (const [name, value] of Object.entries({
    radiusWorld,
    maximumDisplacementWorld,
    maximumSurfaceSlope,
  })) {
    if (!Number.isFinite(value) || value < 0 || (name === "radiusWorld" && value === 0)) {
      throw new Error(`${name} must be finite${name === "radiusWorld" ? " and positive" : " and non-negative"}`);
    }
  }
  if (!Number.isInteger(gridSide) || gridSide < 3 ||
      !Number.isInteger(Math.log2(gridSide - 1))) {
    throw new Error("gridSide must be 2^k+1 and at least 3");
  }

  const centerDirection = patchCenterDirection(patch);
  const angularRadius = patchAngularRadius(patch);
  const minimumRadiusWorld = Math.max(0, radiusWorld - maximumDisplacementWorld);
  const maximumRadiusWorld = radiusWorld + maximumDisplacementWorld;
  const centerWorld = scale3(centerDirection, radiusWorld);
  let boundingSphereRadiusWorld = maximumDisplacementWorld;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const direction = patchSurfaceDirection(patch, u, v);
    for (const radialDistance of [minimumRadiusWorld, maximumRadiusWorld]) {
      boundingSphereRadiusWorld = Math.max(
        boundingSphereRadiusWorld,
        length3(subtract3(scale3(direction, radialDistance), centerWorld)),
      );
    }
  }

  // A grid cell spans no more than the patch diagonal divided by the number
  // of intervals. The sphere sagitta and a Lipschitz height term bound the
  // difference from the bilinear coarse representation.
  const cellAngularRadius = angularRadius / (gridSide - 1);
  const sphereSagittaWorld = maximumRadiusWorld * (1 - Math.cos(cellAngularRadius));
  const heightVariationWorld = Math.min(
    2 * maximumDisplacementWorld,
    maximumSurfaceSlope * maximumRadiusWorld * cellAngularRadius,
  );
  const geometricErrorWorld = sphereSagittaWorld + heightVariationWorld;

  return Object.freeze({
    centerDirection,
    centerWorld,
    angularRadius,
    minimumRadiusWorld,
    maximumRadiusWorld,
    boundingSphereRadiusWorld,
    sphereSagittaWorld,
    heightVariationWorld,
    geometricErrorWorld,
    maximumSurfaceSlope,
    boundProvenance: Object.freeze({
      radialRange: "Derived",
      sphericalSector: "Derived",
      maximumSurfaceSlope: "Authored",
      geometricError: "Derived from the authored slope bound",
    }),
  });
}

export function isPatchPotentiallyVisible(bounds, cameraPositionBody) {
  if (!Array.isArray(cameraPositionBody) || cameraPositionBody.length !== 3 ||
      cameraPositionBody.some((value) => !Number.isFinite(value))) {
    throw new Error("cameraPositionBody must contain three finite values");
  }
  const cameraDistance = length3(cameraPositionBody);
  if (cameraDistance <= bounds.maximumRadiusWorld) return true;
  const cameraDirection = scale3(cameraPositionBody, 1 / cameraDistance);
  const centerAngle = Math.acos(
    clampScalar(dot3(bounds.centerDirection, cameraDirection), -1, 1),
  );
  const horizonAngle = Math.acos(
    clampScalar(bounds.maximumRadiusWorld / cameraDistance, -1, 1),
  );
  const boundInflationAngle = Math.asin(
    clampScalar(bounds.boundingSphereRadiusWorld / cameraDistance, 0, 1),
  );
  return centerAngle <= horizonAngle + bounds.angularRadius + boundInflationAngle;
}

/** Project an analytic patch-error bound into physical render-target pixels. */
export function projectPatchErrorPixels(bounds, {
  cameraPositionBody,
  verticalFovRadians,
  renderTargetHeightPx,
  cameraNear,
} = {}) {
  if (!(verticalFovRadians > 0 && verticalFovRadians < Math.PI) ||
      !(renderTargetHeightPx > 0) || !(cameraNear > 0)) {
    throw new Error("projectPatchErrorPixels requires a valid FOV, target height, and near plane");
  }
  if (!isPatchPotentiallyVisible(bounds, cameraPositionBody)) return 0;
  const distanceToCenter = length3(subtract3(cameraPositionBody, bounds.centerWorld));
  const nearestDistance = Math.max(cameraNear, distanceToCenter - bounds.boundingSphereRadiusWorld);
  const focalLengthPixels = renderTargetHeightPx / (2 * Math.tan(verticalFovRadians * 0.5));
  return bounds.geometricErrorWorld * focalLengthPixels / nearestDistance;
}

export function computePatchMorphFactor(screenError, {
  splitThreshold,
  mergeThreshold,
  level,
} = {}) {
  if (!(splitThreshold > mergeThreshold && mergeThreshold >= 0)) {
    throw new Error("morph thresholds require splitThreshold > mergeThreshold >= 0");
  }
  if (!Number.isFinite(screenError) || screenError < 0) {
    throw new Error("screenError must be finite and non-negative");
  }
  if (level === 0) return 0;
  return clampScalar(
    (splitThreshold - screenError) / (splitThreshold - mergeThreshold),
    0,
    1,
  );
}

function decorateRuntimePatch(patch, options) {
  const bounds = createConservativePatchBounds(patch, options);
  const screenError = projectPatchErrorPixels(bounds, options);
  patch.bounds = bounds;
  patch.screenError = screenError;
  patch.lodMorph = computePatchMorphFactor(screenError, {
    splitThreshold: options.splitThreshold,
    mergeThreshold: options.mergeThreshold,
    level: patch.level,
  });
  return patch;
}

/**
 * Select a camera-dependent leaf frontier over all six cube faces, then apply
 * the global cross-face 2:1 restriction. This is deliberately stateless: the
 * morph factor makes a child converge to its parent representation before a
 * caller swaps frontiers at the merge threshold.
 */
export function selectPlanetQuadtreeFrontier({
  cameraPositionBody,
  verticalFovRadians,
  renderTargetHeightPx,
  cameraNear,
  radiusWorld,
  maximumDisplacementWorld,
  maximumSurfaceSlope,
  gridSide,
  splitThreshold,
  mergeThreshold,
  minLevel = 0,
  maxLevel,
  maxLeafPatches = 32768,
} = {}) {
  if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel) ||
      minLevel < 0 || maxLevel < minLevel) {
    throw new Error("minLevel/maxLevel must be ordered non-negative integers");
  }
  if (!Number.isInteger(maxLeafPatches) || maxLeafPatches < 6) {
    throw new Error("maxLeafPatches must be an integer >= 6");
  }
  const options = {
    cameraPositionBody,
    verticalFovRadians,
    renderTargetHeightPx,
    cameraNear,
    radiusWorld,
    maximumDisplacementWorld,
    maximumSurfaceSlope,
    gridSide,
    splitThreshold,
    mergeThreshold,
  };
  const leaves = [];
  const stack = createRootPatches().reverse();
  while (stack.length > 0) {
    const patch = decorateRuntimePatch(stack.pop(), options);
    const split = patch.level < minLevel || shouldSplitPatch(patch, { splitThreshold, maxLevel });
    if (split) {
      const children = splitPatch(patch);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    } else {
      leaves.push(patch);
      if (leaves.length + stack.length > maxLeafPatches) {
        throw new Error(`planet frontier exceeds maxLeafPatches=${maxLeafPatches}`);
      }
    }
  }

  const balanced = balanceQuadtree(leaves).map((patch) => decorateRuntimePatch(patch, options));
  if (balanced.length > maxLeafPatches) {
    throw new Error(`balanced planet frontier exceeds maxLeafPatches=${maxLeafPatches}`);
  }
  annotateNeighborLevels(balanced);
  balanced.sort((a, b) => a.face - b.face || a.level - b.level || a.y - b.y || a.x - b.x);
  return balanced;
}

export function frontierSignature(patches) {
  return [...patches].map((patch) => patch.id).sort().join("|");
}

/** Verify exact dyadic coverage and the absence of overlapping leaves. */
export function validateLeafCoverage(patches, epsilon = 1e-12) {
  const errors = [];
  for (let face = 0; face < FACE_AXES.length; face += 1) {
    const facePatches = patches.filter((patch) => patch.face === face);
    const area = facePatches.reduce(
      (sum, patch) => sum +
        (patch.uvRect.maxU - patch.uvRect.minU) *
        (patch.uvRect.maxV - patch.uvRect.minV),
      0,
    );
    if (Math.abs(area - 1) > epsilon) errors.push(`face ${face} leaf area is ${area}`);
    for (let a = 0; a < facePatches.length; a += 1) {
      for (let b = a + 1; b < facePatches.length; b += 1) {
        const left = facePatches[a].uvRect;
        const right = facePatches[b].uvRect;
        const overlapU = Math.min(left.maxU, right.maxU) - Math.max(left.minU, right.minU);
        const overlapV = Math.min(left.maxV, right.maxV) - Math.max(left.minV, right.minV);
        if (overlapU > epsilon && overlapV > epsilon) {
          errors.push(`${facePatches[a].id} overlaps ${facePatches[b].id}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Four-vertex bilinear stencil for morphing a fine grid to the next coarser
 * dyadic grid. The same stencil is forced on odd vertices of transition edges,
 * so the fine boundary evaluates the exact coarse-edge chord.
 */
export function createVertexMorphStencil({ x, y, gridSide, patch }) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x >= gridSide || y >= gridSide) {
    throw new Error("morph stencil coordinates must address the patch grid");
  }
  if (!Number.isInteger(Math.log2(gridSide - 1))) {
    throw new Error("morph stencil gridSide must be 2^k+1");
  }
  const last = gridSide - 1;
  const x0 = Math.floor(x / 2) * 2;
  const y0 = Math.floor(y / 2) * 2;
  const x1 = Math.min(x0 + 2, last);
  const y1 = Math.min(y0 + 2, last);
  const tx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  const ty = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
  const transition = Boolean(
    (patch.transitionEdges.north && y === last && (x & 1) === 1) ||
    (patch.transitionEdges.east && x === last && (y & 1) === 1) ||
    (patch.transitionEdges.south && y === 0 && (x & 1) === 1) ||
    (patch.transitionEdges.west && x === 0 && (y & 1) === 1)
  );
  return Object.freeze({
    coordinates: Object.freeze([[x0, y0], [x1, y0], [x0, y1], [x1, y1]]),
    weights: Object.freeze([
      (1 - tx) * (1 - ty),
      tx * (1 - ty),
      (1 - tx) * ty,
      tx * ty,
    ]),
    transitionWeight: transition ? 1 : 0,
  });
}
