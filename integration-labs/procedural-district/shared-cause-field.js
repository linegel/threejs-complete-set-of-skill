import { positionWorld } from "three/tsl";
import { texture, vec2 } from "three/tsl";

import {
  createFieldBakeComputeNode,
  createFieldBakeResources,
  createFieldMipComputeNode,
  fieldMipExtents,
} from "../../threejs-procedural-fields/examples/webgpu-field-bake/field-bake.mjs";
import {
  CPU_FIELD_ALGORITHM,
  TSL_FIELD_ALGORITHM,
  sampleFieldCPU,
} from "../../threejs-procedural-fields/examples/webgpu-field-bake/field-bundle.mjs";
import {
  DISTRICT_FIELD_COORDINATE_CONTRACT,
  DISTRICT_WORLD_EXTENT,
  createDistrictFieldCoordinateClaims,
} from "./district-contract.js";

export const DISTRICT_CAUSE_FIELD_ID = "district-shared-cause-field-v2";
export { DISTRICT_FIELD_COORDINATE_CONTRACT, DISTRICT_WORLD_EXTENT };
export const DISTRICT_FIELD_DOMAIN = DISTRICT_FIELD_COORDINATE_CONTRACT.fieldDomain;
export const DISTRICT_FIELD_SCALE = DISTRICT_FIELD_COORDINATE_CONTRACT.worldToFieldScale;

if (CPU_FIELD_ALGORITHM !== TSL_FIELD_ALGORITHM) {
  throw new Error("District CPU and TSL cause fields must import the same algorithm object.");
}

function textureRecord(texture, owner = "threejs-procedural-fields") {
  const width = texture.image.width;
  const height = texture.image.height;
  return {
    id: texture.name,
    owner,
    kind: "rgba16float-storage-texture",
    bytes: width * height * 8,
    source: `${width}*${height}*8 B rgba16float logical payload`,
  };
}

export function worldToFieldUv(x, z) {
  const [fieldX, fieldZ] = worldToFieldCoordinate(x, z);
  return [
    (fieldX - DISTRICT_FIELD_DOMAIN.minX) / (DISTRICT_FIELD_DOMAIN.maxX - DISTRICT_FIELD_DOMAIN.minX),
    (fieldZ - DISTRICT_FIELD_DOMAIN.minZ) / (DISTRICT_FIELD_DOMAIN.maxZ - DISTRICT_FIELD_DOMAIN.minZ),
  ];
}

export function worldToFieldCoordinate(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError("District world coordinates must be finite.");
  return [x * DISTRICT_FIELD_SCALE, z * DISTRICT_FIELD_SCALE];
}

export function sampleDistrictCauseCPU(x, z, seed = 1) {
  const [fieldX, fieldZ] = worldToFieldCoordinate(x, z);
  return sampleFieldCPU({
    domain: "world",
    coordinate: [fieldX, DISTRICT_FIELD_DOMAIN.y, fieldZ],
    seed: seed >>> 0,
  });
}

export async function createDistrictCauseFieldStage({ renderer, tier, seed }) {
  if (!renderer) throw new TypeError("District cause-field stage requires the host renderer.");
  if (!tier || !Number.isInteger(tier.fieldExtent)) throw new TypeError("District cause-field stage requires a resolved tier.");
  if (!Number.isInteger(seed)) throw new TypeError("District cause-field seed must be an integer.");

  await renderer.init();
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("Procedural District requires native WebGPU for its field atlas.");
  }

  const resources = createFieldBakeResources(tier.fieldExtent, tier.fieldExtent);
  const extents = fieldMipExtents(tier.fieldExtent, tier.fieldExtent);
  const dispatchRecords = [];
  const baseCount = tier.fieldExtent * tier.fieldExtent;
  const baseNode = createFieldBakeComputeNode({
    resources,
    seed: seed >>> 0,
    domain: DISTRICT_FIELD_DOMAIN,
    name: "district:field-base",
  });
  renderer.compute(baseNode);
  dispatchRecords.push({
    id: "district-field-base",
    workgroups: [Math.ceil(baseCount / 64), 1, 1],
    source: `ceil(${baseCount}/64) workgroups for the full field atlas`,
  });

  for (let level = 1; level < extents.length; level += 1) {
    const extent = extents[level];
    const texelCount = extent.width * extent.height;
    renderer.compute(createFieldMipComputeNode({
      inputTexture: resources.packedMipTextures[level - 1],
      outputTexture: resources.packedMipTextures[level],
      inputExtent: extents[level - 1],
      region: { x: 0, y: 0, width: extent.width, height: extent.height },
      level,
    }));
    dispatchRecords.push({
      id: `district-field-mip-${level}`,
      workgroups: [Math.ceil(texelCount / 64), 1, 1],
      source: `ceil(${texelCount}/64) workgroups for packed field mip ${level}`,
    });
  }

  const fieldCoordinate = vec2(positionWorld.x, positionWorld.z)
    .mul(DISTRICT_FIELD_SCALE)
    .toVar("districtSharedFieldCoordinate");
  const worldUv = fieldCoordinate
    .sub(vec2(DISTRICT_FIELD_DOMAIN.minX, DISTRICT_FIELD_DOMAIN.minZ))
    .div(vec2(
      DISTRICT_FIELD_DOMAIN.maxX - DISTRICT_FIELD_DOMAIN.minX,
      DISTRICT_FIELD_DOMAIN.maxZ - DISTRICT_FIELD_DOMAIN.minZ,
    ))
    .clamp(0, 1)
    .toVar("districtSharedFieldUv");
  const packed = texture(resources.packedTexture, worldUv).toVar("districtPackedCause");
  const derived = texture(resources.derivedTexture, worldUv).toVar("districtDerivedCause");
  const gradient = texture(resources.gradientTexture, worldUv).toVar("districtGradientCause");

  let disposed = false;
  return {
    id: DISTRICT_CAUSE_FIELD_ID,
    owner: "threejs-procedural-fields",
    identity: Object.freeze({
      id: DISTRICT_CAUSE_FIELD_ID,
      algorithm: CPU_FIELD_ALGORITHM,
      seed: seed >>> 0,
      extent: tier.fieldExtent,
      coordinateContract: DISTRICT_FIELD_COORDINATE_CONTRACT,
    }),
    algorithm: CPU_FIELD_ALGORITHM,
    resources,
    dispatchRecords,
    nodes: Object.freeze({ coordinate: fieldCoordinate, uv: worldUv, packed, derived, gradient }),
    sampleCPU(x, z) {
      return sampleDistrictCauseCPU(x, z, seed);
    },
    describeResources() {
      return [
        ...resources.packedMipTextures.map((entry) => textureRecord(entry)),
        textureRecord(resources.derivedTexture),
        textureRecord(resources.gradientTexture),
      ];
    },
    describeCoordinateClaims() {
      return createDistrictFieldCoordinateClaims();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of resources.packedMipTextures) entry.dispose();
      resources.derivedTexture.dispose();
      resources.gradientTexture.dispose();
    },
  };
}
