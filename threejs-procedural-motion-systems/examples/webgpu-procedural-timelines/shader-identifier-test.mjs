import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MOTION_SHADER_IDENTIFIERS,
  motionComputeShaderIdentifier,
  motionPresentationShaderIdentifier,
  motionStaticMetadataShaderIdentifier,
  requireWgslIdentifier,
} from "./gpu-instance-motion.js";
import { MOTION_SCENARIOS } from "./timeline.js";

const WGSL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const source = readFileSync(new URL("./gpu-instance-motion.js", import.meta.url), "utf8");

for (const [id, value] of Object.entries(MOTION_SHADER_IDENTIFIERS)) {
  assert.match(value, WGSL_IDENTIFIER, `${id} is a WGSL-safe stable identifier`);
  assert.equal(requireWgslIdentifier(value), value);
}

for (const scenario of MOTION_SCENARIOS) {
  assert.match(motionComputeShaderIdentifier(scenario), WGSL_IDENTIFIER);
  assert.match(motionPresentationShaderIdentifier(scenario), WGSL_IDENTIFIER);
  assert.match(motionStaticMetadataShaderIdentifier(scenario), WGSL_IDENTIFIER);
}

assert.throws(
  () => requireWgslIdentifier("motion:simulation-time", "mutated motion uniform"),
  /WGSL identifier characters/,
  "colon and hyphen mutation must fail before TSL emits WGSL",
);
assert.throws(() => requireWgslIdentifier("9motion"), /WGSL identifier characters/);
assert.doesNotMatch(
  source,
  /\.setName\(\s*["'`]([^"'`]*[:\-][^"'`]*)["'`]\s*\)/,
  "no literal TSL node name may contain punctuation that is illegal in a WGSL identifier",
);
assert.equal(
  [...source.matchAll(/uniform\([^;\n]+\)\.setName\(([^)]+)\)/g)].length,
  Object.keys(MOTION_SHADER_IDENTIFIERS).length,
  "every motion uniform carries one validated stable name",
);

console.log("motion TSL uniforms and compute nodes use stable WGSL-safe identifiers");
