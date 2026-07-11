import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";

import {
  TARGET_CONTRACT as ARTICULATED_DESK_LAMP_CONTRACT,
  TARGET_ID as ARTICULATED_DESK_LAMP_ID,
  TARGET_TITLE as ARTICULATED_DESK_LAMP_TITLE,
  createArticulatedDeskLamp,
} from "./targets/articulated-desk-lamp/articulated-desk-lamp-factory.js";
import {
  TARGET_CONTRACT as POTTED_BONSAI_CONTRACT,
  TARGET_ID as POTTED_BONSAI_ID,
  TARGET_TITLE as POTTED_BONSAI_TITLE,
  createPottedBonsai,
} from "./targets/potted-bonsai/potted-bonsai-factory.js";
import {
  TARGET_CONTRACT as CERAMIC_TEAPOT_CONTRACT,
  TARGET_ID as CERAMIC_TEAPOT_ID,
  TARGET_TITLE as CERAMIC_TEAPOT_TITLE,
  createCeramicTeapot,
} from "./targets/ceramic-teapot/ceramic-teapot-factory.js";

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function requireExactSequence(actual, expected, label) {
  if (
    !Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} must be exactly: ${expected.join(", ")}`);
  }
}

function normalizeBoundsMeters(contract, id) {
  const source = contract?.dimensionsMeters;
  const dimensions = Array.isArray(source)
    ? { width: source[0], height: source[1], depth: source[2] }
    : source;
  if (!dimensions || typeof dimensions !== "object") {
    throw new TypeError(`Target "${id}" must publish dimensionsMeters`);
  }
  const bounds = {
    width: Number(dimensions.width),
    height: Number(dimensions.height),
    depth: Number(dimensions.depth),
  };
  if (Object.values(bounds).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`Target "${id}" dimensionsMeters must contain positive finite extents`);
  }
  return Object.freeze(bounds);
}

function defineTarget({
  id,
  title,
  description,
  contract,
  create,
  cameraTarget,
  defaultCamera = "design",
}) {
  requireText(id, "target id");
  requireText(title, `Target "${id}" title`);
  requireText(description, `Target "${id}" description`);
  if (!contract || typeof contract !== "object") throw new TypeError(`Target "${id}" contract is required`);
  if (contract.id !== id) throw new Error(`Target "${id}" contract ID does not match its export`);
  if (contract.title !== title) throw new Error(`Target "${id}" contract title does not match its export`);
  requireExactSequence(contract.modes, SCULPT_MODES, `Target "${id}" modes`);
  requireExactSequence(contract.tierIds, SCULPT_TIERS, `Target "${id}" tierIds`);
  if (typeof create !== "function") throw new TypeError(`Target "${id}" factory must be a function`);
  if (
    !Array.isArray(cameraTarget)
    || cameraTarget.length !== 3
    || cameraTarget.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError(`Target "${id}" cameraTarget must contain three finite numbers`);
  }

  return Object.freeze({
    id,
    title,
    description,
    contract,
    create,
    defaultCamera,
    cameraTarget: Object.freeze([...cameraTarget]),
    boundsMeters: normalizeBoundsMeters(contract, id),
  });
}

const definitions = [
  defineTarget({
    id: ARTICULATED_DESK_LAMP_ID,
    title: ARTICULATED_DESK_LAMP_TITLE,
    description: "Hard-surface product with serial hinges, paired arm rails, springs, and an animated lamp head.",
    contract: ARTICULATED_DESK_LAMP_CONTRACT,
    create: createArticulatedDeskLamp,
    cameraTarget: [0, 0.39, 0],
  }),
  defineTarget({
    id: POTTED_BONSAI_ID,
    title: POTTED_BONSAI_TITLE,
    description: "Organic branching sculpture with a glazed pot, rooted hierarchy, opaque foliage, and procedural wind.",
    contract: POTTED_BONSAI_CONTRACT,
    create: createPottedBonsai,
    cameraTarget: [0, 1.15, 0],
  }),
  defineTarget({
    id: CERAMIC_TEAPOT_ID,
    title: CERAMIC_TEAPOT_TITLE,
    description: "Lathed ceramic product with a swept spout and handle, material-focused detail, and an animated hinge lid.",
    contract: CERAMIC_TEAPOT_CONTRACT,
    create: createCeramicTeapot,
    cameraTarget: [0.025, 0.045, 0],
  }),
];

const ids = new Set();
const normalizedTitles = new Set();
for (const definition of definitions) {
  if (ids.has(definition.id)) throw new Error(`Duplicate sculpt target ID "${definition.id}"`);
  const normalizedTitle = definition.title.trim().toLocaleLowerCase("en-US");
  if (normalizedTitles.has(normalizedTitle)) {
    throw new Error(`Duplicate sculpt target title "${definition.title}"`);
  }
  ids.add(definition.id);
  normalizedTitles.add(normalizedTitle);
}

export const SCULPT_TARGETS = Object.freeze(definitions);
export const SCULPT_TARGET_IDS = Object.freeze(SCULPT_TARGETS.map(({ id }) => id));

const TARGET_BY_ID = new Map(SCULPT_TARGETS.map((definition) => [definition.id, definition]));

export function listSculptTargets() {
  return SCULPT_TARGETS;
}

export function getSculptTargetDefinition(id) {
  requireText(id, "sculpt target id");
  const definition = TARGET_BY_ID.get(id);
  if (!definition) throw new RangeError(`Unknown sculpt target "${id}"`);
  return definition;
}

function validateFactoryResult(definition, result) {
  if (!result || typeof result !== "object") {
    throw new TypeError(`Target "${definition.id}" factory must return an object`);
  }
  if (!result.root?.isObject3D) {
    throw new TypeError(`Target "${definition.id}" factory result.root must be a Three.js Object3D`);
  }
  if (!result.runtime || result.runtime.root !== result.root) {
    throw new TypeError(`Target "${definition.id}" factory result.runtime must own result.root`);
  }
  if (result.runtime.subjectId !== definition.id) {
    throw new Error(`Target "${definition.id}" factory returned runtime subject "${result.runtime.subjectId}"`);
  }
  if (result.root.userData.targetId !== definition.id) {
    throw new Error(`Target "${definition.id}" factory must publish root.userData.targetId`);
  }
  if (result.contract !== definition.contract) {
    throw new Error(`Target "${definition.id}" factory must return its registered contract`);
  }
  for (const method of ["setMode", "setTime", "dispose"]) {
    if (typeof result[method] !== "function") {
      throw new TypeError(`Target "${definition.id}" factory result.${method} must be a function`);
    }
  }
  return result;
}

export function createSculptTarget(id, options = {}) {
  const definition = getSculptTargetDefinition(id);
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("sculpt target options must be an object");
  }
  const tier = options.tier ?? "budgeted";
  const seed = options.seed ?? 1;
  if (!SCULPT_TIERS.includes(tier)) throw new RangeError(`Unknown sculpt tier "${tier}"`);
  if (!Number.isInteger(seed)) throw new TypeError("sculpt target seed must be an integer");

  const result = definition.create({ ...options, tier, seed });
  try {
    return validateFactoryResult(definition, result);
  } catch (error) {
    result?.dispose?.();
    throw error;
  }
}
