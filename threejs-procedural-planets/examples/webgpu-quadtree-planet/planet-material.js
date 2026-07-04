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
  positionLocal,
  uniform,
  vec3,
} from "three/tsl";

import { altitudeDetailWeights, heightGradient } from "./altitude-detail.js";
import { planetFields } from "./planet-fields.js";

export const PLANET_MATERIAL_NODE_CONTRACT = `
const surfaceDirection = attribute("surfaceDirection", "vec3").normalize();
const fields = planetFields(surfaceDirection, planetPreset);
material.positionNode = surfaceDirection.mul(radius).mul(fields.height.mul(amplitude).add(1));
material.colorNode = biomeColor(fields.biomeWeights).add(craterColor(fields.craterRim, fields.ejectaStrength));
material.roughnessNode = baseRoughness.add(fields.roughnessVariance);
material.normalNode = analyticGradient(fields.heightGradient).mix(derivativeDetailNormal, nearWeight);
`;

export function createPlanetMaterialContract({ physical = true } = {}) {
  const materialClass = physical ? MeshPhysicalNodeMaterial : MeshStandardNodeMaterial;
  return {
    materialClass: materialClass.name,
    colorTextures: "SRGBColorSpace",
    dataTextures: "NoColorSpace",
    positionNode: "shared planetFields(surfaceDirection).height",
    colorNode: "biomeWeights plus crater/ejecta/snow/water causes",
    roughnessNode: "roughnessVariance with derivative normal anti-aliasing",
    normalNode: "analyticGradient / heightGradient plus altitude-faded micro detail",
    metalnessNode: "body preset or ore/lava mask",
    emissiveNode: "lava, aurora, city lights, or stellar emission only",
    outputOwner: "RenderPipeline.outputColorTransform",
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
      positionLocal,
      uniform,
      vec3,
    },
  };
}

export function sampleMaterialInputs(direction, options) {
  const fields = planetFields(direction, options);
  const weights = altitudeDetailWeights({
    altitude: options.altitude ?? 10,
    radius: options.radius ?? 1,
  });
  const gradient = heightGradient(direction, options);
  return {
    fields,
    nearWeight: weights.nearWeight,
    midWeight: weights.midWeight,
    farWeight: weights.farWeight,
    analyticGradient: gradient.analyticGradient,
    heightGradient: gradient.heightGradient,
  };
}
