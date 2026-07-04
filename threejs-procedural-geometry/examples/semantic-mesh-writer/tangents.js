import { computeMikkTSpaceTangents } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function validateTangents(geometry) {
  const tangent = geometry.attributes.tangent;
  if (!tangent) return { ok: true, errors: [], generatedBy: "not required" };
  const errors = [];
  for (let index = 0; index < tangent.count; index += 1) {
    const w = tangent.getW(index);
    if (!(w === 1 || w === -1)) {
      errors.push(`tangent.w invalid at ${index}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    generatedBy: "computeMikkTSpaceTangents",
  };
}

export { computeMikkTSpaceTangents };
