import {
  abs,
  exp,
  float,
  pass,
  renderOutput,
  screenUV,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const ownedByHostPipeline = { pass, renderOutput };
void ownedByHostPipeline;

export function createCloudCompositeContract({
  sceneColor = "hostSceneColorLinearHDR",
  cloudRadiance = "resolvedCloudRadianceLinearHDR",
  cloudTransmittance = "resolvedCloudTransmittance",
  sceneDepth = "hostSceneDepth",
  outputOwner = "host RenderPipeline outputColorTransform/renderOutput",
} = {}) {
  return {
    name: "linearHDRCloudComposite",
    claimLevel: "source-implemented",
    implementationStatus: "depth-aware four-tap TSL upsample and linear-HDR composite; runtime evidence incomplete",
    inputSpace: "linear HDR",
    outputSpace: "linear HDR",
    outputOwner,
    reads: {
      sceneColor,
      sceneDepth,
      cloudRadiance,
      cloudTransmittance,
      representativeDepth: "resolvedCloudRepresentativeDepth",
      cloudOpticalDepth: "separate sun-aligned cloud optical-depth shadow",
    },
    compositeEquation:
      "compositedLinearHDR = sceneColor * surfaceCloudShadow * cloudTransmittance + cloudRadiance",
    restrictions: [
      "no local output conversion",
      "no local display transfer",
      "one host tone-map owner",
      "one host output transform owner",
    ],
  };
}

/**
 * Reusable host-owned cloud stage. It allocates no renderer or pipeline and
 * returns scene-linear HDR. Four low-grid taps are weighted by representative
 * cloud depth agreement before applying C_scene*T + L_cloud.
 */
export function createDepthAwareCloudCompositeNode({
  sceneColorNode,
  sceneDepthMetersNode,
  cloudResolvedTexture,
  cloudDepthTexture,
  cloudResolvedNode = null,
  cloudDepthNode = null,
  lowWidth,
  lowHeight,
  uvNode = screenUV,
  depthSigmaMeters = 240,
  cloudOpticalDepthNode = float(0),
  surfaceCoverageNode = float(1),
  cloudShadowStrength = 1,
}) {
  if (
    !sceneColorNode ||
    !sceneDepthMetersNode ||
    (!cloudResolvedTexture && !cloudResolvedNode) ||
    (!cloudDepthTexture && !cloudDepthNode)
  ) {
    throw new Error("cloud composite requires host color/depth and resolved cloud color/depth");
  }
  if (!(lowWidth > 0 && lowHeight > 0 && depthSigmaMeters > 0)) {
    throw new Error("cloud composite dimensions and depth sigma must be positive");
  }
  const texel = vec2(1 / lowWidth, 1 / lowHeight);
  const offsets = [
    vec2(-0.5, -0.5).mul(texel),
    vec2(0.5, -0.5).mul(texel),
    vec2(-0.5, 0.5).mul(texel),
    vec2(0.5, 0.5).mul(texel),
  ];
  const radianceTransmittance = vec4(0).toVar();
  const weightSum = float(0).toVar();
  for (const offset of offsets) {
    const sampleUv = uvNode.add(offset).clamp(0, 1);
    const cloud = cloudResolvedNode
      ? cloudResolvedNode.sample(sampleUv)
      : texture(cloudResolvedTexture, sampleUv);
    const cloudDepth = cloudDepthNode
      ? cloudDepthNode.sample(sampleUv).x
      : texture(cloudDepthTexture, sampleUv).x;
    const depthWeight = exp(
      abs(sceneDepthMetersNode.sub(cloudDepth)).div(depthSigmaMeters).negate(),
    );
    radianceTransmittance.assign(
      radianceTransmittance.add(cloud.mul(depthWeight)),
    );
    weightSum.assign(weightSum.add(depthWeight));
  }
  const resolved = radianceTransmittance.div(weightSum.max(1e-6));
  const cloudShadow = exp(
    cloudOpticalDepthNode.max(0).mul(-Math.max(0, cloudShadowStrength)),
  );
  const surfaceCloudShadow = surfaceCoverageNode
    .clamp(0, 1)
    .mul(cloudShadow)
    .add(float(1).sub(surfaceCoverageNode.clamp(0, 1)));
  return vec4(
    sceneColorNode.rgb
      .mul(surfaceCloudShadow)
      .mul(resolved.a.clamp(0, 1))
      .add(resolved.rgb.max(vec3(0))),
    sceneColorNode.a,
  );
}

export function validateCloudCompositeContract(contract) {
  const errors = [];
  if (contract.inputSpace !== "linear HDR" || contract.outputSpace !== "linear HDR") {
    errors.push("cloud composite must remain linear HDR");
  }
  if (!contract.outputOwner?.includes("RenderPipeline")) {
    errors.push("host RenderPipeline must own final output transform");
  }
  if (contract.claimLevel !== "source-implemented") {
    errors.push("cloud composite must identify its source-implemented TSL node");
  }
  if (!contract.restrictions?.includes("one host tone-map owner")) {
    errors.push("composite must declare a single host tone-map owner");
  }
  return { ok: errors.length === 0, errors };
}
