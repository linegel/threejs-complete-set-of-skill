import { pass, renderOutput } from "three/tsl";

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
    inputSpace: "linear HDR",
    outputSpace: "linear HDR",
    outputOwner,
    reads: {
      sceneColor,
      sceneDepth,
      cloudRadiance,
      cloudTransmittance,
      representativeDepth: "resolvedCloudRepresentativeDepth",
    },
    compositeEquation:
      "compositedLinearHDR = sceneColor * cloudTransmittance + cloudRadiance",
    restrictions: [
      "no local output conversion",
      "no local display transfer",
      "one host tone-map owner",
      "one host output transform owner",
    ],
  };
}

export function validateCloudCompositeContract(contract) {
  const errors = [];
  if (contract.inputSpace !== "linear HDR" || contract.outputSpace !== "linear HDR") {
    errors.push("cloud composite must remain linear HDR");
  }
  if (!contract.outputOwner?.includes("RenderPipeline")) {
    errors.push("host RenderPipeline must own final output transform");
  }
  if (!contract.restrictions?.includes("one host tone-map owner")) {
    errors.push("composite must declare a single host tone-map owner");
  }
  return { ok: errors.length === 0, errors };
}
