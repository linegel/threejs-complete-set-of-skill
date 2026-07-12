import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoRegistry } from "../../scripts/lib/lab-registry.mjs";
import { validateLabManifest } from "../../scripts/lib/lab-validation.mjs";
import { validateIntegrationContract } from "../shared/integration-contract-core.mjs";
import {
  DISTRICT_EXCLUSIVE_OWNERS,
  DISTRICT_MECHANISMS,
  DISTRICT_MODES,
  DISTRICT_TIERS,
  createDistrictRuntimeGraph,
} from "./district-contract.js";

const here = dirname(fileURLToPath(import.meta.url));

function matches(source, expression, message, errors) {
  if (!expression.test(source)) errors.push(message);
}

export function validateDistrictSourceContracts({ mainSource, fieldSource, materialSource, geometrySource, routeSource, captureHookSource, captureSource }) {
  const errors = [];
  const rendererCount = (mainSource.match(/new\s+WebGPURenderer\s*\(/g) ?? []).length;
  const pipelineCount = (mainSource.match(/new\s+RenderPipeline\s*\(/g) ?? []).length;
  if (rendererCount !== 1) errors.push(`expected exactly one WebGPURenderer constructor; found ${rendererCount}`);
  if (pipelineCount !== 1) errors.push(`expected exactly one RenderPipeline constructor; found ${pipelineCount}`);
  matches(mainSource, /await\s+renderer\.init\(\)/, "renderer.init() must be awaited", errors);
  matches(mainSource, /renderer\.backend\.isWebGPUBackend\s*!==\s*true/, "native WebGPU must be hard-gated", errors);
  matches(mainSource, /renderPipeline\.outputColorTransform\s*=\s*false/, "explicit renderOutput requires disabled automatic output transform", errors);
  matches(mainSource, /rtt\(renderOutput\(/, "one renderOutput owner must feed a captureable render target", errors);
  matches(mainSource, /createGTAOStage\(/, "host must compose the canonical GTAO stage", errors);
  matches(mainSource, /createShadowArchitectureOwner\(/, "host must compose the bounded shadow owner", errors);
  matches(mainSource, /createSharedWeatherStage\(/, "host must compose the shared weather stage", errors);
  matches(fieldSource, /renderer\.compute\(baseNode\)/, "field stage must dispatch real base-atlas compute", errors);
  matches(fieldSource, /createFieldMipComputeNode/, "field stage must dispatch the dependent mip chain", errors);
  matches(fieldSource, /worldToFieldCoordinate\(x, z\)/, "CPU field consumers must use the shared world-to-field transform", errors);
  matches(fieldSource, /fieldCoordinate[\s\S]*?\.mul\(DISTRICT_FIELD_SCALE\)/, "GPU material sampling must use the shared world-to-field Jacobian", errors);
  matches(materialSource, /causeField\.nodes\.(?:packed|derived)/, "materials must consume the shared field nodes", errors);
  matches(materialSource, /weatherStage\.weather/, "materials must consume the shared weather state", errors);
  matches(materialSource, /validateProceduralPbrConfig\(/, "minimal district materials must execute the canonical procedural-PBR contract validator", errors);
  matches(materialSource, /canonicalHostStage:\s*false/, "district material adapter must state that it is not the canonical full host stage", errors);
  matches(materialSource, /acceptanceStatus:\s*"incomplete"/, "minimal district material adapter must remain explicitly incomplete", errors);
  matches(geometrySource, /createWriter\(/, "terrain topology must use the semantic mesh writer", errors);
  matches(geometrySource, /createProceduralDistrictBuildingFactory\(/, "buildings must use the canonical material-slot compiler", errors);
  matches(mainSource, /STATIC_GEOMETRY_REGENERATED/, "weather updates must guard static geometry identity", errors);
  matches(mainSource, /assertDistrictRouteLock\(routeLocks,\s*"mode"/, "controller mode setter must enforce route locks", errors);
  matches(mainSource, /assertDistrictRouteLock\(routeLocks,\s*"tier"/, "controller tier setter must enforce route locks", errors);
  matches(routeSource, /params\.get\("mechanism"\)/, "generated mechanism query routes must be consumed", errors);
  matches(routeSource, /routeLocks/, "resolved generated routes must publish controller locks", errors);
  matches(mainSource, /inferDistrictPaddedLayout/, "readback must use an integer aligned-row helper", errors);
  for (const image of ["final.design.png", "no-post.design.png", "diagnostics.mosaic.png", "camera.near.png", "camera.design.png", "camera.far.png"]) {
    if (!captureHookSource.includes(image)) errors.push(`capture hook must write standard image ${image}`);
  }
  if (/WebGLRenderer|automatic\s+fallback/i.test(mainSource)) errors.push("canonical integration cannot contain a WebGL or automatic fallback branch");
  if (/page\.screenshot/.test(captureSource)) errors.push("capture must not use page screenshots as WebGPU proof");
  if (!/INSUFFICIENT_EVIDENCE/.test(captureSource)) errors.push("capture must keep unmeasured claims insufficient");
  if (errors.length) throw new Error(`Invalid Procedural District source contracts:\n- ${errors.join("\n- ")}`);
  return true;
}

export function validateDistrictRuntimeGraph(graph = createDistrictRuntimeGraph()) {
  const errors = [];
  if (graph.schemaVersion !== 2) errors.push("runtime graph schemaVersion must be 2");
  for (const [semantic, owner] of Object.entries(DISTRICT_EXCLUSIVE_OWNERS)) {
    if (graph.owners[semantic] !== owner) errors.push(`runtime owner mismatch for ${semantic}`);
  }
  if (graph.finalToneMapOwner !== "threejs-image-pipeline/renderOutput") errors.push("tone map owner mismatch");
  if (graph.finalOutputTransformOwner !== "threejs-image-pipeline/renderOutput") errors.push("output transform owner mismatch");
  const signalIds = graph.signals.map((entry) => entry.id);
  if (new Set(signalIds).size !== signalIds.length) errors.push("runtime signal ids must be unique");
  for (const signal of graph.signals) {
    if (!Array.isArray(signal.consumers) || typeof signal.reachable !== "boolean") errors.push(`invalid runtime signal ${signal.id}`);
  }
  for (const resource of graph.resources) {
    const datum = resource.residentBytes;
    if (!datum || datum.unit !== "bytes" || !["Derived", "Measured"].includes(datum.label) || !(datum.value >= 0)) {
      errors.push(`invalid runtime resource ${resource.id}`);
    }
  }
  for (const dispatch of graph.computeDispatches) {
    if (dispatch.workgroups?.label !== "Derived" || dispatch.workgroups?.unit !== "workgroups") {
      errors.push(`invalid compute dispatch ${dispatch.id}`);
    }
  }
  if (errors.length) throw new Error(`Invalid Procedural District runtime graph:\n- ${errors.join("\n- ")}`);
  return true;
}

export async function validateProceduralDistrict() {
  const [manifest, contract, canonicalTargets, mainSource, fieldSource, materialSource, geometrySource, routeSource, captureHookSource, captureSource] = await Promise.all([
    readFile(join(here, "lab.manifest.json"), "utf8").then(JSON.parse),
    readFile(join(here, "contract.json"), "utf8").then(JSON.parse),
    readFile(join(here, "../../labs/canonical-targets.json"), "utf8").then(JSON.parse),
    readFile(join(here, "main.js"), "utf8"),
    readFile(join(here, "shared-cause-field.js"), "utf8"),
    readFile(join(here, "district-materials.js"), "utf8"),
    readFile(join(here, "terrain-geometry.js"), "utf8"),
    readFile(join(here, "routes.js"), "utf8"),
    readFile(join(here, "capture-hook.mjs"), "utf8"),
    readFile(join(here, "capture.mjs"), "utf8"),
  ]);
  const target = canonicalTargets.integrations.find((entry) => entry.id === "procedural-district");
  const registryManifest = buildDemoRegistry().demos.find((entry) => entry.id === manifest.id);
  if (!registryManifest) throw new Error(`Registry does not contain ${manifest.id}.`);
  const manifestResult = validateLabManifest(registryManifest, { validateEvidence: false });
  if (manifestResult.errors.length) throw new Error(`Manifest validation failed:\n- ${manifestResult.errors.join("\n- ")}`);
  if (manifest.status !== "incomplete") throw new Error("Procedural District must remain incomplete pending native-WebGPU evidence.");
  if (JSON.stringify(manifest.modes) !== JSON.stringify(target.modes)) throw new Error("Manifest modes drift from canonical target.");
  if (JSON.stringify(manifest.mechanisms.map((entry) => entry.id)) !== JSON.stringify(DISTRICT_MECHANISMS)) throw new Error("Manifest mechanisms drift from runtime constants.");
  if (JSON.stringify(manifest.tiers.map((entry) => entry.id)) !== JSON.stringify(Object.keys(DISTRICT_TIERS))) throw new Error("Manifest tiers drift from runtime constants.");
  if (JSON.stringify(contract.modes) !== JSON.stringify(DISTRICT_MODES)) throw new Error("Integration contract modes drift from runtime constants.");
  const contractResult = validateIntegrationContract(contract);
  if (contractResult.verdict !== "PASS" || contractResult.code !== "ADAPTERS_OR_RUNTIME_EVIDENCE_INCOMPLETE") {
    throw new Error(`Integration contract failed: ${JSON.stringify(contractResult)}`);
  }
  validateDistrictSourceContracts({ mainSource, fieldSource, materialSource, geometrySource, routeSource, captureHookSource, captureSource });
  validateDistrictRuntimeGraph(createDistrictRuntimeGraph({ mode: "final", tier: "balanced" }));
  return { manifest, contract, target, contractResult };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await validateProceduralDistrict();
  console.log("procedural-district source and contract validation: passed");
}
