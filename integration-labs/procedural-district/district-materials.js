import { MeshPhysicalNodeMaterial } from "three/webgpu";
import {
  color,
  float,
  mix,
  select,
  uniform,
  vec3,
} from "three/tsl";

import {
  DISTRICT_MODE_CODES,
  requireDistrictMode,
} from "./district-contract.js";
import { DISTRICT_FIELD_SCALE } from "./shared-cause-field.js";
import {
  validateProceduralPbrConfig,
} from "../../threejs-procedural-materials/examples/tsl-procedural-pbr/procedural-pbr-materials.js";

export const DISTRICT_MATERIAL_ADAPTER_CONTRACT = Object.freeze({
  id: "procedural-district-minimal-pbr-adapter-v1",
  implementationClass: "integration-local-minimal-node-pbr-adapter",
  canonicalHostStage: false,
  canonicalContractValidator: "validateProceduralPbrConfig",
  semanticOwner: "threejs-procedural-materials",
  adapterOwner: "procedural-district",
  acceptanceStatus: "incomplete",
  implementedChannels: Object.freeze(["color", "roughness", "metalness", "clearcoat", "emissive-zero"]),
  omittedCanonicalMechanisms: Object.freeze([
    "derivative-normal-filtering",
    "specular-aa",
    "atlas-array-triplanar",
    "instanced-dissolve",
  ]),
});

const SLOT_IDENTITIES = Object.freeze({
  terrain: { color: 0x61705a, roughness: 0.82, metalness: 0, debug: 0x3c9d68 },
  limestone: { color: 0xc7b89a, roughness: 0.78, metalness: 0, debug: 0xe6d5b8 },
  granite: { color: 0x56575b, roughness: 0.52, metalness: 0, debug: 0x7f8491 },
  "terra-cotta": { color: 0xa85d42, roughness: 0.68, metalness: 0, debug: 0xef7655 },
  glass: { color: 0x416b7b, roughness: 0.24, metalness: 0, debug: 0x4fc3f7 },
  bronze: { color: 0x8f6336, roughness: 0.36, metalness: 1, debug: 0xd4974f },
  "black-metal": { color: 0x20272c, roughness: 0.3, metalness: 1, debug: 0x39444d },
  ornament: { color: 0xd0b98f, roughness: 0.62, metalness: 0, debug: 0xf6d365 },
  roof: { color: 0x50646c, roughness: 0.44, metalness: 1, debug: 0x7da1ad },
});

const OWNER_COLORS = Object.freeze({
  terrain: 0x24aa72,
  building: 0xf0a247,
});

function createMaterial({ name, identity, role, causeField, uniforms }) {
  const canonicalValidation = validateProceduralPbrConfig({
    identity: {
      metalnessModel: identity.metalness === 1 ? "conductor-endpoint" : "dielectric-endpoint",
    },
    coordinateScale: DISTRICT_FIELD_SCALE,
    coordinateMode: "world",
    seed: causeField.identity.seed,
    sceneUnitsPerMeter: 1,
    roughnessRange: [0.08, 1],
    metalnessRange: [identity.metalness, identity.metalness],
    clearcoatRange: [0, 0.86],
    clearcoatRoughnessRange: [0.18, 0.42],
    heightMetersRange: [0, 0],
    causeMaps: [
      causeField.resources.packedTexture,
      causeField.resources.derivedTexture,
      causeField.resources.gradientTexture,
    ],
  });
  const packed = causeField.nodes.packed;
  const derived = causeField.nodes.derived;
  const base = color(identity.color);
  const macroValue = packed.r.mul(0.28).add(0.86);
  const wear = packed.g.mul(0.46).add(packed.b.mul(0.54)).clamp(0, 1);
  const spatialWetness = uniforms.wetness
    .mul(packed.a.mul(0.62).add(packed.b.mul(0.38)))
    .clamp(0, 1)
    .toVar("districtSpatialWetness");
  const pooledWetness = uniforms.puddle
    .mul(packed.b)
    .mul(derived.r.oneMinus())
    .clamp(0, 1)
    .toVar("districtPooledWetness");
  const snow = uniforms.snow
    .mul(derived.r.oneMinus())
    .clamp(0, 1)
    .toVar("districtSnowCoverage");

  const wornBase = base.mul(macroValue).mul(float(1).sub(wear.mul(0.08)));
  const wetBase = wornBase.mul(float(1).sub(spatialWetness.mul(0.34)));
  const finalColor = mix(wetBase, color(0xdce7ea), snow.mul(0.72));
  const dryRoughness = float(identity.roughness).add(derived.b.sub(0.5).mul(0.12)).clamp(0.08, 1);
  const wetRoughness = mix(dryRoughness, float(0.2), spatialWetness.max(pooledWetness));
  const finalRoughness = mix(wetRoughness, float(0.86), snow);

  let displayColor = finalColor;
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["shared-field"]),
    vec3(packed.r, derived.g, packed.b),
    displayColor,
  );
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["facade-ownership"]),
    role === "terrain" ? color(0x18251f) : color(identity.debug),
    displayColor,
  );
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["material-slots"]),
    color(identity.debug),
    displayColor,
  );
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["weather-state"]),
    vec3(spatialWetness, pooledWetness, snow),
    displayColor,
  );
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["shadow-contribution"]),
    color(0xd9e0e2),
    displayColor,
  );
  displayColor = select(
    uniforms.mode.equal(DISTRICT_MODE_CODES["owner-graph"]),
    color(OWNER_COLORS[role]),
    displayColor,
  );

  const material = new MeshPhysicalNodeMaterial();
  material.name = `district-${name}`;
  material.colorNode = displayColor;
  material.roughnessNode = finalRoughness;
  material.metalnessNode = float(identity.metalness);
  material.clearcoatNode = pooledWetness.mul(0.86);
  material.clearcoatRoughnessNode = mix(float(0.18), float(0.42), packed.b);
  material.emissiveNode = color(0x000000);
  material.userData.proceduralDistrict = {
    materialSlot: name,
    materialOwner: "threejs-procedural-materials",
    causeFieldId: causeField.id,
    weatherOwner: "threejs-rain-snow-and-wet-surfaces",
    coupledChannels: ["color", "roughness", "clearcoat"],
    metalnessIdentity: identity.metalness,
    adapterContractId: DISTRICT_MATERIAL_ADAPTER_CONTRACT.id,
    canonicalHostStage: DISTRICT_MATERIAL_ADAPTER_CONTRACT.canonicalHostStage,
    canonicalValidation,
  };
  return material;
}

export function createDistrictMaterials({ causeField, weatherStage }) {
  if (!causeField?.nodes || !weatherStage?.weather) throw new TypeError("District materials require the shared cause and weather stages.");
  const uniforms = {
    mode: uniform(DISTRICT_MODE_CODES.final, "int"),
    time: uniform(weatherStage.weather.time),
    forcing: uniform(weatherStage.weather.forcing),
    wetness: uniform(weatherStage.weather.wetness),
    puddle: uniform(weatherStage.weather.puddleFill),
    snow: uniform(weatherStage.weather.snowCoverage),
  };
  const terrain = createMaterial({
    name: "terrain",
    identity: SLOT_IDENTITIES.terrain,
    role: "terrain",
    causeField,
    uniforms,
  });
  const slots = {};
  for (const [name, identity] of Object.entries(SLOT_IDENTITIES)) {
    if (name === "terrain") continue;
    slots[name] = createMaterial({ name, identity, role: "building", causeField, uniforms });
  }
  const all = [terrain, ...Object.values(slots)];
  let mode = "final";
  let disposed = false;

  function updateWeatherUniforms() {
    const weather = weatherStage.weather;
    uniforms.time.value = weather.time;
    uniforms.forcing.value = weather.forcing;
    uniforms.wetness.value = weather.wetness;
    uniforms.puddle.value = weather.puddleFill;
    uniforms.snow.value = weather.snowCoverage;
  }

  return {
    owner: "threejs-procedural-materials",
    causeFieldId: causeField.id,
    uniforms,
    terrain,
    slots,
    all,
    setMode(nextMode) {
      requireDistrictMode(nextMode);
      mode = nextMode;
      uniforms.mode.value = DISTRICT_MODE_CODES[nextMode];
    },
    updateWeatherUniforms,
    describe() {
      return {
        owner: "threejs-procedural-materials",
        adapterContract: DISTRICT_MATERIAL_ADAPTER_CONTRACT,
        mode,
        causeFieldIds: [...new Set(all.map((material) => material.userData.proceduralDistrict.causeFieldId))],
        materialOwnerClaims: [...new Set(all.map((material) => material.userData.proceduralDistrict.materialOwner))],
        slots: all.map((material) => ({
          id: material.userData.proceduralDistrict.materialSlot,
          metalnessIdentity: material.userData.proceduralDistrict.metalnessIdentity,
          coupledChannels: material.userData.proceduralDistrict.coupledChannels,
        })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of all) material.dispose();
    },
  };
}
