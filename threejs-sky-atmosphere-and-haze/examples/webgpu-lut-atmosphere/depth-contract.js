export const DEPTH_MODE_CONTRACT = Object.freeze({
  standardPerspective: {
    helper: "perspectiveDepthToViewZ",
    nodeHelper: "PassNode.getViewZNode()",
    skyPixel: "explicit coverage preferred; clear depth is 1 only for this declared encoding",
    evidenceStatus: "CPU equation fixture; no scene-pass depth capture in Phase 1",
  },
  reversedPerspective: {
    helper: "reversedPerspectiveDepthToViewZ",
    nodeHelper:
      "PassNode.getViewZNode(); r185 perspectiveDepthToViewZ inspects renderer.reversedDepthBuffer",
    skyPixel: "explicit coverage preferred; clear depth is 0 only for this declared encoding",
    evidenceStatus: "CPU equation fixture; no scene-pass depth capture in Phase 1",
  },
  logarithmicPerspective: {
    helper: "logarithmicDepthToViewZ(depth, near, far)",
    nodeHelper: "logarithmicDepthToViewZ",
    skyPixel: "explicit no-surface depth mask",
    evidenceStatus: "CPU equation fixture; no scene-pass depth capture in Phase 1",
  },
  orthographic: {
    helper: "orthographicDepthToViewZ",
    nodeHelper: "orthographicDepthToViewZ",
    skyPixel: "explicit no-surface coverage mask",
    evidenceStatus: "CPU equation fixture; no scene-pass depth capture in Phase 1",
  },
  msaaResolved: {
    helper:
      "host-provided nearest-covered-surface depth plus coverage; never averaged depth",
    nodeHelper:
      "host resolve contract, then delegate to the declared standard/reversed/logarithmic/orthographic conversion",
    skyPixel: "resolved coverage mask",
    evidenceStatus:
      "CPU resolve/reconstruction fixture only; Phase 1 does not capture a multisampled GPU depth attachment",
  },
});

export function perspectiveDepthToViewZ(depth, near, far) {
  return (near * far) / ((far - near) * depth - far);
}

export function perspectiveViewZToDepth(viewZ, near, far) {
  return (near * far / viewZ + far) / (far - near);
}

export function reversedPerspectiveDepthToViewZ(depth, near, far) {
  return (near * far) / ((near - far) * depth - near);
}

export function reversedPerspectiveViewZToDepth(viewZ, near, far) {
  return (near * far / viewZ + near) / (near - far);
}

export function orthographicDepthToViewZ(depth, near, far, reversed = false) {
  return reversed
    ? (far - near) * depth - far
    : (near - far) * depth - near;
}

export function orthographicViewZToDepth(viewZ, near, far, reversed = false) {
  return reversed
    ? (viewZ + far) / (far - near)
    : (viewZ + near) / (near - far);
}

export function logarithmicDepthToViewZ(depth, near, far) {
  return -near * Math.exp(depth * Math.log(far / near));
}

export function logarithmicViewZToDepth(viewZ, near, far) {
  if (!(viewZ < 0)) throw new Error("logarithmic view Z must be negative");
  return Math.log(-viewZ / near) / Math.log(far / near);
}

export function perspectiveViewZToMetricRayDistance(viewZ, normalizedViewRayZ) {
  if (!(normalizedViewRayZ < 0)) {
    throw new Error("normalized perspective view ray must have negative z");
  }
  return -viewZ / -normalizedViewRayZ;
}

const RESOLVED_DEPTH_MODES = new Set([
  "standardPerspective",
  "reversedPerspective",
  "logarithmicPerspective",
  "orthographic",
]);

function isReversedEncoding(mode, orthographicReversed) {
  return mode === "reversedPerspective" ||
    (mode === "orthographic" && orthographicReversed);
}

export function resolveNearestSurfaceDepth({
  depthSamples,
  coverageSamples,
  resolvedDepthMode,
  orthographicReversed = false,
}) {
  if (!RESOLVED_DEPTH_MODES.has(resolvedDepthMode)) {
    throw new Error(`Unknown resolved atmosphere depth mode "${resolvedDepthMode}"`);
  }
  if (!Array.isArray(depthSamples) || !Array.isArray(coverageSamples) ||
      depthSamples.length !== coverageSamples.length || depthSamples.length === 0) {
    throw new Error("MSAA depth and coverage arrays must have the same non-zero length");
  }
  const covered = depthSamples.filter((_, index) => coverageSamples[index] === true);
  if (covered.length === 0) {
    return { covered: false, depth: null, resolvedDepthMode, orthographicReversed };
  }
  const reducer = isReversedEncoding(resolvedDepthMode, orthographicReversed)
    ? Math.max
    : Math.min;
  return {
    covered: true,
    depth: reducer(...covered),
    resolvedDepthMode,
    orthographicReversed,
  };
}

function depthToViewZ({
  depth,
  mode,
  near,
  far,
  orthographicReversed,
}) {
  const viewZByMode = {
    standardPerspective: () => perspectiveDepthToViewZ(depth, near, far),
    reversedPerspective: () => reversedPerspectiveDepthToViewZ(depth, near, far),
    logarithmicPerspective: () => logarithmicDepthToViewZ(depth, near, far),
    orthographic: () =>
      orthographicDepthToViewZ(depth, near, far, orthographicReversed),
  };
  const resolver = viewZByMode[mode];
  if (!resolver) throw new Error(`Unknown atmosphere depth mode "${mode}"`);
  return resolver();
}

export function classifyDepthSample({
  depth,
  mode = "standardPerspective",
  near = 0.1,
  far = 10000,
  noSurface = false,
  clearDepthIsNoSurface = false,
  msaaResolvePolicy = null,
  resolvedDepthMode = null,
  orthographicReversed = false,
}) {
  if (noSurface) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }
  if (clearDepthIsNoSurface && mode === "standardPerspective" && depth === 1) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }
  if (clearDepthIsNoSurface && mode === "reversedPerspective" && depth === 0) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }
  if (mode === "msaaResolved" && msaaResolvePolicy !== "nearest-surface") {
    throw new Error("MSAA atmosphere depth requires nearest-surface resolve plus coverage");
  }
  const conversionMode = mode === "msaaResolved" ? resolvedDepthMode : mode;
  if (mode === "msaaResolved" && !RESOLVED_DEPTH_MODES.has(conversionMode)) {
    throw new Error(
      "MSAA resolved depth must declare standardPerspective, reversedPerspective, logarithmicPerspective, or orthographic conversion",
    );
  }
  return {
    kind: "surface pixel",
    viewZ: depthToViewZ({
      depth,
      mode: conversionMode,
      near,
      far,
      orthographicReversed,
    }),
    depthMode: conversionMode,
  };
}
