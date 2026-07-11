import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  SRGBColorSpace,
} from "three/webgpu";
import {
  Fn,
  attribute,
  dFdx,
  dFdy,
  float,
  normalView,
  output,
  pow,
  positionLocal,
  uniform,
  vec3,
} from "three/tsl";

import {
  detailRepresentationWeights,
  heightDerivativeCandidate,
} from "./altitude-detail.js";
import { planetFields } from "./planet-fields.js";

export const PLANET_MATERIAL_NODE_CONTRACT = `
const surfaceDirection = attribute("surfaceDirection", "vec3").normalize();
const fields = planetFields(surfaceDirection, planetPreset);
material.positionNode = surfaceDirection.mul(radius).mul(fields.height.mul(amplitude).add(1));
material.colorNode = biomeColor(fields.biomeWeights).add(craterColor(fields.craterRim, fields.ejectaStrength));
const unresolvedNormalResidual = filteredMaterialNormal.sub(resolvedGeometryNormal);
const residualVariance = normalVariance(unresolvedNormalResidual);
material.roughnessNode = pow(clamp(pow(baseRoughness, 4).add(residualVariance), alphaMin2, 1), 0.25);
material.normalNode = validatedHeightGradient.add(filteredDetailNormal(detailWeights));
`;

export function createPlanetMaterialContract({ physical = true } = {}) {
  const materialClass = physical ? MeshPhysicalNodeMaterial : MeshStandardNodeMaterial;
  return {
    implementationStatus: "descriptor-only-not-rendered",
    materialClass: materialClass.name,
    textureEncodingPolicy:
      "assign SRGBColorSpace only to authored color textures; scalar/vector fields remain NoColorSpace",
    positionNode: "shared planetFields(surfaceDirection).height",
    colorNode: "biomeWeights plus crater/ejecta/snow/water causes",
    roughnessNode:
      "fourth-root combination in GGX alpha-squared space using only unresolved material-normal residual variance",
    normalNode:
      "requires an independently validated height derivative; the bundled derivative candidate is not accepted",
    metalnessNode: "body preset or ore/lava mask",
    emissiveNode: "lava, aurora, city lights, or stellar emission only",
    outputOwner: "renderOutput; therefore RenderPipeline.outputColorTransform=false",
    proofExclusions: [
      "this object does not construct or compile a NodeMaterial graph",
      "no material render, image capture, or GPU timing is performed",
    ],
    imports: {
      MeshPhysicalNodeMaterial,
      MeshStandardNodeMaterial,
      NoColorSpace,
      SRGBColorSpace,
      Fn,
      attribute,
      dFdx,
      dFdy,
      float,
      normalView,
      output,
      pow,
      positionLocal,
      uniform,
      vec3,
    },
  };
}

export function sampleMaterialInputs(direction, options = {}) {
  const fields = planetFields(direction, options);
  const weights = detailRepresentationWeights({
    wavelengths: options.detailSampling?.wavelengths ?? {
      macro: 0.08,
      meso: 0.012,
      micro: 0.0025,
    },
    vertexSpacing: options.detailSampling?.vertexSpacing ?? 0.001,
    pixelFootprint: options.detailSampling?.pixelFootprint ?? 0.00075,
  });
  const derivative = heightDerivativeCandidate(direction, options);
  return {
    fields,
    macroWeight: weights.macroWeight,
    mesoWeight: weights.mesoWeight,
    microWeight: weights.microWeight,
    heightDerivativeCandidate: derivative.candidate,
    derivativeCorrectness: derivative.derivativeCorrectness,
    evidenceStatus: "CPU equation fixture only; material descriptor is not rendered",
  };
}
