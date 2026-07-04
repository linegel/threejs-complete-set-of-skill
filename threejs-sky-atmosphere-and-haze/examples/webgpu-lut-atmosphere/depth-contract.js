export const DEPTH_MODE_CONTRACT = Object.freeze({
  standardPerspective: {
    helper: "perspectiveDepthToViewZ",
    nodeHelper: "PassNode.getViewZNode()",
    skyPixel: "depth >= 0.999999",
  },
  reversedPerspective: {
    helper: "reversedDepthBuffer + perspectiveDepthToViewZ(1.0 - depth)",
    nodeHelper: "PassNode.getLinearDepthNode()",
    skyPixel: "depth <= 0.000001",
  },
  logarithmicPerspective: {
    helper: "logarithmicDepthToViewZ",
    nodeHelper: "logarithmicDepthToViewZ",
    skyPixel: "explicit no-surface depth mask",
  },
  orthographic: {
    helper: "orthographicDepthToViewZ",
    nodeHelper: "orthographicDepthToViewZ",
    skyPixel: "depth outside [epsilon, 1 - epsilon] or no-surface mask",
  },
  msaaResolved: {
    helper: "MSAA depth is resolved once by the host pass before atmosphere reads it",
    nodeHelper: "PassNode.getLinearDepthNode() after resolve",
    skyPixel: "resolved no-surface sample",
  },
});

export function perspectiveDepthToViewZ(depth, near, far) {
  return (near * far) / ((far - near) * depth - far);
}

export function reversedPerspectiveDepthToViewZ(depth, near, far) {
  return perspectiveDepthToViewZ(1 - depth, near, far);
}

export function orthographicDepthToViewZ(depth, near, far) {
  return depth * (near - far) - near;
}

export function logarithmicDepthToViewZ(depth, near, far, logDepthBufFC) {
  const clipW = Math.pow(2, depth / (logDepthBufFC * 0.5)) - 1;
  return -clipW * near / far;
}

export function classifyDepthSample({
  depth,
  mode = "standardPerspective",
  near = 0.1,
  far = 10000,
  logDepthBufFC = 2 / Math.log2(10000 + 1),
  noSurface = false,
}) {
  if (noSurface) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }
  if (mode === "standardPerspective" && depth >= 0.999999) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }
  if (mode === "reversedPerspective" && depth <= 0.000001) {
    return { kind: "sky pixel", viewZ: Number.NEGATIVE_INFINITY };
  }

  const viewZByMode = {
    standardPerspective: () => perspectiveDepthToViewZ(depth, near, far),
    reversedPerspective: () => reversedPerspectiveDepthToViewZ(depth, near, far),
    logarithmicPerspective: () =>
      logarithmicDepthToViewZ(depth, near, far, logDepthBufFC),
    orthographic: () => orthographicDepthToViewZ(depth, near, far),
    msaaResolved: () => perspectiveDepthToViewZ(depth, near, far),
  };

  const resolver = viewZByMode[mode];
  if (!resolver) {
    throw new Error(`Unknown atmosphere depth mode "${mode}"`);
  }
  return {
    kind: "surface pixel",
    viewZ: resolver(),
  };
}
