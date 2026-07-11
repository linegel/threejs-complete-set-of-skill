import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCULPT_MODES, SCULPT_TIERS, summarizeSculptRuntime } from "../shared/sculpt-runtime.js";
import { CORPUS_DPR_CAPS } from "./lab-controller.js";
import { SCULPT_TARGETS } from "./object-catalog.js";
import { CORPUS_CAMERAS } from "./route-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "lab.manifest.json");
const corpusContractPath = resolve(here, "corpus.contract.json");

const EXPECTED_TARGET_IDS = Object.freeze([
  "articulated-desk-lamp",
  "potted-bonsai",
  "ceramic-teapot",
]);
const ACCEPTED_STATUS_WORDS = new Set(["accepted", "complete", "completed", "pass", "passed"]);

function readJson(path, label) {
  assert(existsSync(path), `missing ${label}: ${path}`);
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

function ids(entries, label) {
  assert(Array.isArray(entries), `${label} must be an array`);
  return entries.map((entry, index) => {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), `${label}[${index}] must be an object`);
    assert.equal(typeof entry.id, "string", `${label}[${index}].id must be a string`);
    return entry.id;
  });
}

function exact(actual, expected, label) {
  assert.deepEqual([...actual], [...expected], `${label} must preserve canonical order and membership`);
}

function requireIncomplete(value, label) {
  assert.equal(value, "incomplete", `${label} must remain incomplete until accepted evidence exists`);
}

function rejectAcceptedStatus(value, path = "root") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectAcceptedStatus(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      typeof entry === "string"
      && (key === "status" || key.endsWith("Status"))
      && ACCEPTED_STATUS_WORDS.has(entry.toLowerCase())
    ) {
      throw new Error(`${childPath} falsely claims accepted state without evidence`);
    }
    rejectAcceptedStatus(entry, childPath);
  }
}

function validateReferenceManifest(reference, definition, directory) {
  assert.equal(reference.schemaVersion, 1, `${definition.id} reference schema version drifted`);
  assert.equal(reference.targetId, definition.id, `${definition.id} reference target ID drifted`);
  assert.equal(reference.targetName, definition.title, `${definition.id} reference target name drifted`);
  assert.equal(reference.sourceKind, "authored-procedural-brief", `${definition.id} must use authored brief provenance`);
  assert.equal(reference.sourceUrl, null, `${definition.id} must not invent an external source URL`);
  assert(reference.referenceImage && typeof reference.referenceImage === "object", `${definition.id} referenceImage is required`);
  assert.equal(reference.referenceImage.available, false, `${definition.id} must not claim a reference image exists`);
  for (const field of ["path", "sha256", "mediaType", "widthPixels", "heightPixels", "license"]) {
    assert.equal(reference.referenceImage[field], null, `${definition.id} referenceImage.${field} must be null`);
  }
  assert.equal(reference.referenceImage.provenanceStatus, "unavailable", `${definition.id} image provenance must be unavailable`);
  requireIncomplete(reference.visualAcceptance?.status, `${definition.id} reference visualAcceptance.status`);
  requireIncomplete(reference.evidence?.status, `${definition.id} reference evidence.status`);
  exact(reference.evidence.imageArtifacts, [], `${definition.id} imageArtifacts`);
  exact(reference.evidence.comparisonArtifacts, [], `${definition.id} comparisonArtifacts`);
  exact(reference.evidence.reviewRecords, [], `${definition.id} reviewRecords`);
  assert(Array.isArray(reference.allowedClaims) && reference.allowedClaims.length > 0, `${definition.id} allowedClaims are required`);
  assert(Array.isArray(reference.blockedClaims) && reference.blockedClaims.length > 0, `${definition.id} blockedClaims are required`);

  const files = readdirSync(directory).sort();
  assert.deepEqual(files, ["reference.manifest.json"], `${definition.id} reference directory must not contain invented image evidence`);
  rejectAcceptedStatus(reference, `${definition.id}.reference`);
}

function validateAssessment(assessment, definition) {
  assert.equal(assessment.targetId, definition.id, `${definition.id} assessment target ID drifted`);
  assert.equal(assessment.targetName, definition.title, `${definition.id} assessment target name drifted`);
  assert.equal(assessment.sourceImage, null, `${definition.id} assessment must not name a source image`);
  assert.equal(assessment.referenceSourceKind, "authored-procedural-brief", `${definition.id} assessment provenance drifted`);
  assert.deepEqual(
    assessment.preSpecAssessment?.unknownsToResolveBeforeImplementation,
    [],
    `${definition.id} implementation-blocking unknowns must be resolved or explicitly move to evidence risks`,
  );
  assert(Array.isArray(assessment.qualityContract?.antiShallowSpecRules), `${definition.id} assessment needs anti-shallow rules`);
  assert(
    assessment.qualityContract.antiShallowSpecRules.some((rule) => /solver|canonical|physics/i.test(rule)),
    `${definition.id} assessment must block unsupported physics claims`,
  );
  assert(
    assessment.qualityContract.antiShallowSpecRules.some((rule) => /visual|evidence|acceptance/i.test(rule)),
    `${definition.id} assessment must block unsupported visual acceptance`,
  );
  rejectAcceptedStatus(assessment, `${definition.id}.assessment`);
}

function contractArray(contract, field, fallback = null) {
  const value = contract[field] ?? (fallback ? contract[fallback] : undefined);
  assert(Array.isArray(value), `factory contract ${contract.id}.${field} must be an array`);
  return value;
}

function validateSpec(spec, definition) {
  const { contract } = definition;
  assert.equal(spec.targetId, definition.id, `${definition.id} spec target ID drifted`);
  assert.equal(spec.targetName, definition.title, `${definition.id} spec target name drifted`);
  assert.equal(spec.sourceImage, null, `${definition.id} spec must not name a source image`);
  assert.equal(spec.referenceSourceKind, "authored-procedural-brief", `${definition.id} spec provenance drifted`);
  if (typeof contract.sourceRevision === "string") {
    assert.equal(spec.runtimeContract?.sourceRevision, contract.sourceRevision, `${definition.id} source revision drifted`);
  }
  exact(spec.runtimeContract?.modes, SCULPT_MODES, `${definition.id} spec modes`);
  exact(spec.runtimeContract?.tiers, SCULPT_TIERS, `${definition.id} spec tiers`);
  exact(spec.runtimeContract?.cameras, CORPUS_CAMERAS, `${definition.id} spec cameras`);
  exact(
    spec.runtimeContract?.protectedComponentIds,
    contractArray(contract, "protectedComponentIds", "semanticNodeIds"),
    `${definition.id} protected component IDs`,
  );
  exact(
    spec.runtimeContract?.protectedNodeIds,
    contractArray(contract, "protectedNodeIds", "protectedComponentIds"),
    `${definition.id} protected node IDs`,
  );
  exact(spec.runtimeContract?.protectedSocketIds, contractArray(contract, "protectedSocketIds", "socketIds"), `${definition.id} protected socket IDs`);
  exact(spec.runtimeContract?.protectedColliderIds, contractArray(contract, "protectedColliderIds", "colliderIds"), `${definition.id} protected collider IDs`);
  exact(
    spec.runtimeContract?.protectedDestructionGroupIds,
    contractArray(contract, "protectedDestructionGroupIds", "destructionGroupIds"),
    `${definition.id} protected destruction-group IDs`,
  );
  if (Array.isArray(contract.protectedConstraintIds)) {
    exact(spec.runtimeContract?.protectedConstraintIds, contract.protectedConstraintIds, `${definition.id} protected constraint IDs`);
  }

  assert.equal(spec.physicsHandoff?.recordType, "ColliderConstructionInput", `${definition.id} physics record type drifted`);
  assert.equal(spec.physicsHandoff?.authority, "authoring-input-only", `${definition.id} physics authority drifted`);
  assert.equal(spec.physicsHandoff?.solverAuthority, false, `${definition.id} must not claim solver authority`);
  assert.equal(spec.physicsHandoff?.canonicalProxyStatus, "blocked", `${definition.id} canonical proxy claim must remain blocked`);
  assert.match(spec.physicsHandoff?.rigidBodyPropertiesStatus ?? "", /^blocked/, `${definition.id} rigid-body claim must remain blocked`);
  assert.equal(spec.physicsHandoff?.visualLodIndependent, true, `${definition.id} visual LOD must not mutate physics authoring identity`);
  assert.equal(spec.motionContract?.enabledMode, "action-ready", `${definition.id} motion must be exposed in action-ready mode`);
  assert.equal(spec.motionContract?.exactReset, true, `${definition.id} action preview must define exact reset`);
  assert.equal(spec.motionContract?.solverAuthority, false, `${definition.id} motion preview must not claim solver authority`);
  if (typeof contract.motion?.kind === "string") {
    assert.equal(spec.motionContract.kind, contract.motion.kind, `${definition.id} motion kind drifted`);
  }
  if (Array.isArray(contract.motion?.channels)) {
    exact(spec.motionContract.channels, contract.motion.channels, `${definition.id} motion channels`);
    assert.equal(spec.motionContract.resetContract, contract.motion.resetContract, `${definition.id} motion reset contract drifted`);
  }
  if (contract.topology) {
    assert.equal(spec.topologyContract?.writer, contract.topology.latheWriter, `${definition.id} topology writer drifted`);
    assert.equal(spec.topologyContract?.uvSeam, contract.topology.uvSeam, `${definition.id} topology seam policy drifted`);
    assert.equal(spec.topologyContract?.degenerateTrianglesAllowed, contract.topology.degenerateTrianglesAllowed, `${definition.id} topology degeneracy policy drifted`);
  }
  if (contract.lodPolicy) {
    assert.equal(spec.visualLodContract?.policy, contract.lodPolicy.tessellationOnly ? "tessellation-only" : "representation-changing", `${definition.id} LOD policy drifted`);
    assert.equal(spec.visualLodContract?.drawCountPreserved, !contract.lodPolicy.drawCountReduction, `${definition.id} draw-count LOD claim drifted`);
  }
  if (contract.materialPolicy) {
    assert.equal(spec.materialImplementationContract?.objectSpaceProceduralShader, contract.materialPolicy.objectSpaceProceduralVariation, `${definition.id} material variation claim drifted`);
    assert.equal(spec.materialImplementationContract?.textureSamples, contract.materialPolicy.textureSamples, `${definition.id} material texture-sample claim drifted`);
    assert.equal(spec.materialImplementationContract?.structuralBands, contract.materialPolicy.structuralBands, `${definition.id} material band-count claim drifted`);
    assert.equal(spec.materialImplementationContract?.bandLimit, contract.materialPolicy.bandLimit, `${definition.id} material band-limit claim drifted`);
  }
  if (contract.continuityPolicy) {
    assert.deepEqual(
      {
        signatureRevision: spec.continuityContract?.signatureRevision,
        includedInputs: spec.continuityContract?.includedInputs,
        excludedVisualInputs: spec.continuityContract?.excludedVisualInputs,
        rule: spec.continuityContract?.rule,
      },
      contract.continuityPolicy,
      `${definition.id} continuity policy drifted`,
    );
    assert.match(spec.continuityContract?.solverStateContinuityClaim ?? "", /^blocked/, `${definition.id} solver continuity claim must remain blocked`);
  }
  if (contract.physics?.colliderErrorLowerBoundsMeters) {
    assert.deepEqual(
      spec.physicsHandoff?.colliderEvidenceLowerBoundsMeters,
      contract.physics.colliderErrorLowerBoundsMeters,
      `${definition.id} collider evidence lower bounds drifted`,
    );
  }
  if (contract.boundsEnvelopeMeters) {
    assert.deepEqual(spec.boundsContract?.dimensionsMeters, Array.isArray(contract.dimensionsMeters)
      ? contract.dimensionsMeters
      : [contract.dimensionsMeters.width, contract.dimensionsMeters.height, contract.dimensionsMeters.depth], `${definition.id} dimensions drifted`);
    assert.deepEqual(spec.boundsContract?.envelopeMinMeters, contract.boundsEnvelopeMeters.min, `${definition.id} minimum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.envelopeMaxMeters, contract.boundsEnvelopeMeters.max, `${definition.id} maximum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.sampledUnionMinMeters, contract.boundsEnvelopeMeters.measuredSampleUnion.min, `${definition.id} sampled minimum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.sampledUnionMaxMeters, contract.boundsEnvelopeMeters.measuredSampleUnion.max, `${definition.id} sampled maximum bounds drifted`);
  }
  if (contract.shadeTopology) {
    assert.equal(spec.shadeTopologyContract?.crown, contract.shadeTopology.crown, `${definition.id} shade crown claim drifted`);
    assert.equal(spec.shadeTopologyContract?.lowerApertureRadiusMeters, contract.shadeTopology.lowerApertureRadiusMeters, `${definition.id} shade aperture drifted`);
    assert.equal(spec.shadeTopologyContract?.exteriorCrownMeshId, contract.shadeTopology.exteriorCrownMeshId, `${definition.id} exterior crown identity drifted`);
    assert.equal(spec.shadeTopologyContract?.interiorCrownMeshId, contract.shadeTopology.interiorCrownMeshId, `${definition.id} interior crown identity drifted`);
    assert.equal(spec.shadeTopologyContract?.interiorMaterialSide, contract.shadeTopology.interiorMaterialSide, `${definition.id} interior crown side drifted`);
    assert.equal(spec.shadeTopologyContract?.undersideVisibleThroughLowerAperture, contract.shadeTopology.undersideVisibleThroughLowerAperture, `${definition.id} underside visibility contract drifted`);
  }
  if (contract.materialClaims) {
    assert.equal(spec.materialImplementationContract?.coating, contract.materialClaims.coating, `${definition.id} coating claim drifted`);
    assert.equal(spec.materialImplementationContract?.bulb, contract.materialClaims.bulb, `${definition.id} bulb claim drifted`);
  }
  if (contract.colliderErrorContracts) {
    assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters["base-cylinder"], contract.colliderErrorContracts["base-cylinder"].declaredMeters);
    assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters["bulb-trigger"], contract.colliderErrorContracts["bulb-trigger"].visualSurfaceDeviationMeters);
    for (const id of ["lower-arm-left-capsule", "lower-arm-right-capsule", "upper-arm-left-capsule", "upper-arm-right-capsule"]) {
      assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id], contract.colliderErrorContracts["arm-capsules"].declaredMeters, `${definition.id}/${id} collider ceiling drifted`);
    }
    if (contract.colliderErrorContracts["shade-neck-cylinder"]) {
      const neck = contract.colliderErrorContracts["shade-neck-cylinder"];
      const authoredNeck = spec.physicsHandoff.shadeNeckProxy;
      assert(authoredNeck, `${definition.id} shade-neck proxy contract is required`);
      assert.equal(authoredNeck.colliderId, "shade-neck-cylinder", `${definition.id} shade-neck collider ID drifted`);
      assert.equal(authoredNeck.meshId, neck.meshId, `${definition.id} shade-neck mesh ID drifted`);
      assert.equal(authoredNeck.shapeKind, neck.shapeKind, `${definition.id} shade-neck shape drifted`);
      assert.deepEqual(authoredNeck.startMeters, neck.startMeters, `${definition.id} shade-neck start drifted`);
      assert.deepEqual(authoredNeck.endMeters, neck.endMeters, `${definition.id} shade-neck end drifted`);
      assert.equal(authoredNeck.radiusMeters, neck.radiusMeters, `${definition.id} shade-neck radius drifted`);
      assert.equal(authoredNeck.includesVisualAndProxyCaps, neck.includesVisualAndProxyCaps, `${definition.id} shade-neck cap policy drifted`);
      assert.equal(authoredNeck.minimumTierSampledLowerBoundMeters, neck.minimumTierSampledLowerBoundMeters, `${definition.id} shade-neck sampled lower bound drifted`);
      assert.equal(authoredNeck.declaredBidirectionalMeters, neck.declaredBidirectionalMeters, `${definition.id} shade-neck declared bound drifted`);
      assert.equal(authoredNeck.collisionRole, neck.collisionRole, `${definition.id} shade-neck collision role drifted`);
      assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[authoredNeck.colliderId], neck.declaredBidirectionalMeters, `${definition.id} shade-neck collider ceiling drifted`);
    }
    if (contract.colliderErrorContracts["shade-shell-ribs"]) {
      const ribs = contract.colliderErrorContracts["shade-shell-ribs"];
      exact(ribs.colliderIds, contract.protectedColliderIds.filter((id) => id.startsWith("shade-shell-rib-")), `${definition.id} shade-rib collider IDs`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.ribCount, ribs.ribCount, `${definition.id} shade-rib count drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.includesSolidNeck, false, `${definition.id} shade ribs must exclude the solid neck`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.ribRadiusMeters, ribs.ribRadiusMeters, `${definition.id} shade-rib radius drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.sampledVisualToProxyLowerBoundMeters, ribs.sampledVisualToProxyLowerBoundMeters, `${definition.id} shade-rib sampled bound drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.declaredBidirectionalMeters, ribs.declaredBidirectionalMeters, `${definition.id} shade-rib declared bound drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.samplingConvergenceAllowanceMeters, ribs.samplingConvergenceAllowanceMeters, `${definition.id} shade-rib convergence allowance drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.lowerApertureClearRadiusMeters, ribs.lowerApertureClearRadiusMeters, `${definition.id} shade clear aperture drifted`);
      for (const id of ribs.colliderIds) {
        assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id], ribs.declaredBidirectionalMeters, `${definition.id}/${id} shade-rib collider ceiling drifted`);
      }
    }
  }
  if (contract.seedDomain) {
    assert.equal(spec.seedContract?.kind, contract.seedDomain.kind, `${definition.id} seed kind drifted`);
    assert.equal(spec.seedContract?.minimum, contract.seedDomain.min, `${definition.id} seed minimum drifted`);
    assert.equal(spec.seedContract?.maximum, contract.seedDomain.max, `${definition.id} seed maximum drifted`);
  }
  if (contract.seedPolicy) {
    assert.equal(spec.seedContract?.domain, contract.seedPolicy.domain, `${definition.id} seed domain drifted`);
    assert.equal(spec.seedContract?.minimum, contract.seedPolicy.minimum, `${definition.id} seed minimum drifted`);
    assert.equal(spec.seedContract?.maximum, contract.seedPolicy.maximum, `${definition.id} seed maximum drifted`);
    assert.equal(spec.seedContract?.outsideDomain, contract.seedPolicy.outsideDomain, `${definition.id} seed rejection policy drifted`);
    assert.equal(spec.seedContract?.normalization, contract.seedPolicy.normalization, `${definition.id} seed normalization claim drifted`);
  }
  if (contract.identityContinuity) {
    assert.deepEqual(spec.seedContract?.identityContinuity, contract.identityContinuity, `${definition.id} identity continuity contract drifted`);
  }
  if (contract.continuity) {
    assert.deepEqual(
      {
        signatureSchema: spec.continuityContract?.signatureSchema,
        identityInputs: spec.continuityContract?.identityInputs,
        excludedVisualInputs: spec.continuityContract?.excludedVisualInputs,
        policy: spec.continuityContract?.policy,
      },
      contract.continuity,
      `${definition.id} continuity contract drifted`,
    );
    assert.match(spec.continuityContract?.solverStateContinuityClaim ?? "", /^blocked/, `${definition.id} solver continuity claim must remain blocked`);
  }
  if (contract.proceduralScope) {
    assert.equal(spec.proceduralScope?.implementation, contract.proceduralScope.implementation, `${definition.id} procedural scope drifted`);
    assert.deepEqual(spec.proceduralScope?.excludedClaims, contract.proceduralScope.excludedClaims, `${definition.id} excluded procedural claims drifted`);
  }

  assert(Array.isArray(spec.viewEvidence) && spec.viewEvidence.length > 0, `${definition.id} authored brief traceability is required`);
  for (const [index, evidence] of spec.viewEvidence.entries()) {
    assert.equal(evidence.sourceKind, "authored-procedural-brief", `${definition.id} viewEvidence[${index}] source kind drifted`);
    assert.equal(evidence.evidenceStatus, "authoring-intent-only", `${definition.id} viewEvidence[${index}] must not claim visual proof`);
    assert.equal(evidence.imageRegion ?? null, null, `${definition.id} viewEvidence[${index}] must not invent image regions`);
  }
  exact(spec.visualEvidence, [], `${definition.id} visualEvidence`);
  exact(spec.reviewHistory, [], `${definition.id} reviewHistory`);
  exact(spec.sculptPipeline?.completedPasses, [], `${definition.id} completed sculpt passes`);
  assert.equal(spec.sculptPipeline?.currentPass, "blockout", `${definition.id} initial sculpt pass must remain blockout`);
  assert.match(spec.sculptPipeline?.blockedReason ?? "", /awaiting|pending/i, `${definition.id} pipeline must state its evidence blocker`);
  assert(
    spec.proceduralStrategy.some((rule) => /one scene render/i.test(rule))
      && spec.proceduralStrategy.some((rule) => /no post-processing/i.test(rule)),
    `${definition.id} spec must preserve one-render/no-post architecture`,
  );
  rejectAcceptedStatus(spec, `${definition.id}.spec`);
}

function validateRuntimeContract(definition, spec) {
  const contract = definition.contract;
  assert.equal(contract.id, definition.id, `${definition.id} factory contract ID drifted`);
  assert.equal(contract.title, definition.title, `${definition.id} factory title drifted`);
  exact(contract.modes, SCULPT_MODES, `${definition.id} factory modes`);
  exact(contract.tierIds, SCULPT_TIERS, `${definition.id} factory tiers`);
  assert.equal(contract.physics?.solverAuthority, false, `${definition.id} factory must not claim solver authority`);

  for (const tier of SCULPT_TIERS) {
    const asset = definition.create({ tier, seed: 1 });
    try {
      assert.equal(asset.runtime.subjectId, definition.id, `${definition.id}/${tier} runtime subject drifted`);
      for (const id of contractArray(contract, "protectedComponentIds", "semanticNodeIds")) {
        assert(asset.runtime.nodes.has(id), `${definition.id}/${tier} missing protected component ${id}`);
      }
      if (spec.topologyContract?.bodyCavityOverlap) {
        const cavity = asset.runtime.nodes.get("body-cavity");
        const geometry = cavity?.geometry;
        const authored = spec.topologyContract.bodyCavityOverlap;
        assert(geometry, `${definition.id}/${tier} body cavity geometry is required`);
        assert.equal(geometry.userData.semanticWriter, authored.writer, `${definition.id}/${tier} cavity writer drifted`);
        assert.equal(geometry.userData.boundaryPolicy?.rim?.kind, authored.boundaryKind, `${definition.id}/${tier} cavity boundary kind drifted`);
        assert.equal(geometry.userData.boundaryPolicy?.rim?.id, authored.boundaryId, `${definition.id}/${tier} cavity boundary ID drifted`);
        assert.equal(geometry.userData.expectedGeometricBoundaryLoops, authored.expectedGeometricBoundaryLoops, `${definition.id}/${tier} cavity boundary-loop count drifted`);
        assert.equal(geometry.userData.expectedEulerCharacteristic, authored.expectedEulerCharacteristic, `${definition.id}/${tier} cavity Euler characteristic drifted`);
        assert.equal(geometry.userData.seamVertexPairs?.length > 0, authored.seamVertexPairWelded, `${definition.id}/${tier} cavity seam-weld declaration drifted`);
        assert.equal(cavity.position.y, authored.diskYMeters, `${definition.id}/${tier} cavity height drifted`);
        assert.equal(geometry.userData.overlapContract?.innerWallBottomYMeters, authored.innerWallBottomYMeters, `${definition.id}/${tier} cavity wall height drifted`);
        assert(
          Math.abs(geometry.userData.overlapContract.verticalOverlapMeters - authored.verticalOverlapMeters) <= 1e-12,
          `${definition.id}/${tier} cavity vertical overlap drifted`,
        );
        const measuredRadialOverlap = geometry.userData.overlapContract.diskRadiusMeters
          - geometry.userData.overlapContract.innerWallBottomRadiusMeters;
        assert(
          Math.abs(measuredRadialOverlap - geometry.userData.overlapContract.minimumRadialOverlapMeters) <= 1e-12,
          `${definition.id}/${tier} cavity radial overlap drifted`,
        );
      }
      if (Array.isArray(spec.materialImplementationContract?.executedResponseBundles)) {
        const [celadonBundle, brassBundle] = spec.materialImplementationContract.executedResponseBundles;
        for (const [nodeId, frequencyPerMeter] of [["body-shell", 7.5], ["neck-band", 8.5]]) {
          const metadata = asset.runtime.nodes.get(nodeId)?.material?.userData?.proceduralPbr;
          assert(metadata, `${definition.id}/${tier}/${nodeId} procedural material evidence is required`);
          assert.equal(metadata.responseBundle, celadonBundle.id, `${definition.id}/${tier}/${nodeId} response bundle drifted`);
          assert.equal(metadata.coordinateMode, "object-space-metres", `${definition.id}/${tier}/${nodeId} material coordinates drifted`);
          assert.equal(metadata.cause, "mx_noise_float-single-band", `${definition.id}/${tier}/${nodeId} material cause drifted`);
          assert.equal(metadata.frequencyPerMeter, frequencyPerMeter, `${definition.id}/${tier}/${nodeId} material frequency drifted`);
          assert.deepEqual(metadata.sharedSlots, celadonBundle.sharedSlots, `${definition.id}/${tier}/${nodeId} shared response slots drifted`);
          assert.equal(metadata.metalnessEndpoint, celadonBundle.metalnessEndpoint, `${definition.id}/${tier}/${nodeId} dielectric endpoint drifted`);
          assert.equal(metadata.textureSamples, 0, `${definition.id}/${tier}/${nodeId} texture-sample claim drifted`);
          assert.equal(metadata.normalOrDisplacement, false, `${definition.id}/${tier}/${nodeId} normal/displacement claim drifted`);
        }
        const brassMetadata = asset.runtime.nodes.get("lid-joint-pin")?.material?.userData?.proceduralPbr;
        assert(brassMetadata, `${definition.id}/${tier}/lid-joint-pin procedural material evidence is required`);
        assert.equal(brassMetadata.responseBundle, brassBundle.id, `${definition.id}/${tier} brass response bundle drifted`);
        assert.equal(brassMetadata.coordinateMode, "object-space-metres", `${definition.id}/${tier} brass material coordinates drifted`);
        assert.equal(brassMetadata.cause, "mx_noise_float-single-band", `${definition.id}/${tier} brass material cause drifted`);
        assert.equal(brassMetadata.frequencyPerMeter, brassBundle.frequenciesPerMeter[0], `${definition.id}/${tier} brass material frequency drifted`);
        assert.deepEqual(brassMetadata.sharedSlots, brassBundle.sharedSlots, `${definition.id}/${tier} brass shared response slots drifted`);
        assert.equal(brassMetadata.conductorMetalnessEndpoint, brassBundle.conductorMetalnessEndpoint, `${definition.id}/${tier} brass conductor endpoint drifted`);
        assert.equal(brassMetadata.patinaMetalnessEndpoint, brassBundle.patinaMetalnessEndpoint, `${definition.id}/${tier} brass patina endpoint drifted`);
        assert.equal(brassMetadata.textureSamples, 0, `${definition.id}/${tier} brass texture-sample claim drifted`);
      }
      for (const id of contractArray(contract, "protectedSocketIds", "socketIds")) {
        assert(asset.runtime.sockets.has(id), `${definition.id}/${tier} missing protected socket ${id}`);
      }
      for (const id of contractArray(contract, "protectedColliderIds", "colliderIds")) {
        const collider = asset.runtime.colliders.get(id);
        assert(collider, `${definition.id}/${tier} missing protected collider construction input ${id}`);
        assert.equal(collider.recordType, "ColliderConstructionInput", `${definition.id}/${tier}/${id} record type drifted`);
        assert.equal(collider.claimStatus, "authoring-input", `${definition.id}/${tier}/${id} claim status drifted`);
        assert.equal(collider.solverAuthority, false, `${definition.id}/${tier}/${id} must not own solve`);
        assert.equal(collider.canonicalProxyStatus, "blocked", `${definition.id}/${tier}/${id} must not claim canonical proxy status`);
        assert.match(collider.rigidBodyPropertiesStatus, /^blocked/, `${definition.id}/${tier}/${id} rigid-body claim must remain blocked`);
        assert.equal(collider.shape.units, "metre", `${definition.id}/${tier}/${id} collider units drifted`);
        assert.equal(collider.validity.visualLodIndependent, true, `${definition.id}/${tier}/${id} must be visual-LOD-independent`);
        assert.equal(
          collider.approximationError.maxSurfaceDeviationMeters,
          spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id],
          `${definition.id}/${tier}/${id} authored collider ceiling drifted`,
        );
      }
      if (spec.physicsHandoff?.shadeNeckProxy) {
        const authoredNeck = spec.physicsHandoff.shadeNeckProxy;
        const neckCollider = asset.runtime.colliders.get(authoredNeck.colliderId);
        const neckMesh = asset.runtime.meshes.get(authoredNeck.meshId);
        const neckIntent = asset.runtime.colliderIntents?.get(authoredNeck.colliderId);
        assert.equal(asset.runtime.colliders.size, contract.protectedColliderIds.length, `${definition.id}/${tier} collider inventory must be exact`);
        assert(neckCollider && neckMesh && neckIntent, `${definition.id}/${tier} exact shade-neck collider evidence is required`);
        assert.equal(neckCollider.shape.kind, authoredNeck.shapeKind, `${definition.id}/${tier} shade-neck runtime shape drifted`);
        assert.deepEqual(neckCollider.shape.startMeters, authoredNeck.startMeters, `${definition.id}/${tier} shade-neck runtime start drifted`);
        assert.deepEqual(neckCollider.shape.endMeters, authoredNeck.endMeters, `${definition.id}/${tier} shade-neck runtime end drifted`);
        assert.equal(neckCollider.shape.radiusMeters, authoredNeck.radiusMeters, `${definition.id}/${tier} shade-neck runtime radius drifted`);
        assert.equal(neckCollider.collisionRole, authoredNeck.collisionRole, `${definition.id}/${tier} shade-neck runtime collision role drifted`);
        assert.equal(neckMesh.geometry.parameters.openEnded, false, `${definition.id}/${tier} shade-neck visual caps drifted`);
        assert.deepEqual(neckIntent.comparisonMeshScope, [authoredNeck.meshId], `${definition.id}/${tier} shade-neck comparison scope drifted`);
        assert.match(neckIntent.proxyCapPolicy, /both endpoint disks/, `${definition.id}/${tier} shade-neck proxy cap policy drifted`);
        assert.match(neckIntent.errorMetric, /bidirectional.*capped-cylinder/i, `${definition.id}/${tier} shade-neck error metric drifted`);
      }
      if (Array.isArray(contract.protectedConstraintIds)) {
        assert(asset.runtime.constraints instanceof Map, `${definition.id}/${tier} runtime constraints map is required`);
        for (const id of contract.protectedConstraintIds) {
          const constraint = asset.runtime.constraints.get(id);
          assert(constraint, `${definition.id}/${tier} missing protected constraint construction input ${id}`);
          assert.equal(constraint.recordType, "ConstraintConstructionInput", `${definition.id}/${tier}/${id} constraint type drifted`);
          assert.equal(constraint.claimStatus, "authoring-input", `${definition.id}/${tier}/${id} constraint claim drifted`);
          assert.equal(constraint.solverAuthority, false, `${definition.id}/${tier}/${id} constraint must not own solve`);
          assert.equal(constraint.canonicalConstraintStatus, "blocked", `${definition.id}/${tier}/${id} canonical constraint claim must remain blocked`);
          assert.equal(constraint.validity.visualLodIndependent, true, `${definition.id}/${tier}/${id} constraint must be visual-LOD-independent`);
        }
        assert(asset.runtime.motionPreviewBindings instanceof Map, `${definition.id}/${tier} motion preview map is required`);
        for (const bindingSpec of spec.motionContract.bindings) {
          const binding = asset.runtime.motionPreviewBindings.get(bindingSpec.constraintId);
          assert(binding, `${definition.id}/${tier} missing motion binding ${bindingSpec.constraintId}`);
          assert.equal(binding.nodeId, bindingSpec.nodeId);
          assert.equal(binding.channel, bindingSpec.channel);
          assert.deepEqual(binding.axisLocal, bindingSpec.axisLocal);
          assert.equal(binding.amplitudeRadians, bindingSpec.amplitudeRadians);
          assert.equal(binding.angularFrequencyRadPerS, bindingSpec.angularFrequencyRadPerS);
          assert.equal(binding.solverAuthority, false);
        }
        assert(asset.runtime.attachments instanceof Map, `${definition.id}/${tier} attachment map is required`);
        for (const attachmentSpec of spec.attachmentConstructionContract.attachments) {
          const attachment = asset.runtime.attachments.get(attachmentSpec.id);
          assert(attachment, `${definition.id}/${tier} missing attachment ${attachmentSpec.id}`);
          assert.equal(attachment.recordType, "SculptAttachmentInput");
          assert.equal(attachment.startSocketLocalId, attachmentSpec.startSocketId);
          assert.equal(attachment.endSocketLocalId, attachmentSpec.endSocketId);
          assert.equal(attachment.crossJoint, false);
          assert.equal(attachment.mechanicalLoadAuthority, false);
          assert.equal(attachment.solverAuthority, false);
        }
        const springContact = spec.attachmentConstructionContract.springSurfaceContactContract;
        if (springContact) {
          for (const contactCase of springContact.cases) {
            const spring = asset.runtime.meshes.get(contactCase.springId);
            const collar = asset.runtime.meshes.get(contactCase.collarId);
            const washer = asset.runtime.meshes.get(contactCase.washerId);
            assert(spring && collar && washer, `${definition.id}/${tier} incomplete spring-contact case ${contactCase.collarId}`);
            const endpointMeters = contactCase.endpointIndex === 0
              ? spring.userData.sourceDimensions.startMeters
              : spring.userData.sourceDimensions.endMeters;
            assert.equal(endpointMeters[2], springContact.springEndpointZMeters, `${definition.id}/${tier}/${contactCase.springId} endpoint Z drifted`);
            assert.equal(spring.userData.sourceDimensions.radiusMeters, spring.geometry.parameters.radius, `${definition.id}/${tier}/${contactCase.springId} wire-radius evidence drifted`);
            assert.equal(spring.geometry.parameters.radius, springContact.wireRadiiMeters[contactCase.springId], `${definition.id}/${tier}/${contactCase.springId} authored wire radius drifted`);
            const springAttachment = asset.runtime.attachments.get(springContact.attachmentIdsBySpring[contactCase.springId]);
            assert(springAttachment, `${definition.id}/${tier}/${contactCase.springId} spring attachment is required`);
            assert.equal(springAttachment.baseRadiusMeters, spring.geometry.parameters.radius, `${definition.id}/${tier}/${contactCase.springId} attachment radius drifted`);
            assert.equal(springAttachment.overlapMeters, springContact.attachmentOverlapMeters, `${definition.id}/${tier}/${contactCase.springId} attachment overlap drifted`);
            assert.equal(spring.userData.springRepresentation.receivingWasherMeshIds[contactCase.endpointIndex], contactCase.washerId, `${definition.id}/${tier}/${contactCase.springId} washer identity drifted`);
            assert.equal(spring.userData.springRepresentation.washerFrontFaceZMeters, springContact.washerFrontFaceZMeters, `${definition.id}/${tier}/${contactCase.springId} washer face drifted`);
            assert(
              Math.abs(spring.userData.springRepresentation.endpointCenterEmbedDepthMeters - springContact.endpointCenterEmbedDepthMeters) <= 1e-12,
              `${definition.id}/${tier}/${contactCase.springId} endpoint embed drifted`,
            );
            assert.equal(spring.userData.springRepresentation.endpointBoundaryPolicy, springContact.endpointBoundaryPolicy, `${definition.id}/${tier}/${contactCase.springId} endpoint boundary drifted`);
            assert.equal(washer.position.z, springContact.washerCenterZMeters, `${definition.id}/${tier}/${contactCase.washerId} washer center drifted`);
            assert.equal(washer.geometry.parameters.height / 2, springContact.washerHalfDepthMeters, `${definition.id}/${tier}/${contactCase.washerId} washer depth drifted`);
            assert.equal(collar.userData.attachmentRole, springContact.collarRole, `${definition.id}/${tier}/${contactCase.collarId} collar role drifted`);
            assert.equal(collar.geometry.parameters.radiusTop, springContact.collarRadiusMeters, `${definition.id}/${tier}/${contactCase.collarId} collar radius drifted`);
            assert.equal(collar.geometry.parameters.height, springContact.collarDepthMeters, `${definition.id}/${tier}/${contactCase.collarId} collar depth drifted`);
          }
        }
      }
      for (const id of contractArray(contract, "protectedDestructionGroupIds", "destructionGroupIds")) {
        assert(asset.runtime.destructionGroups.has(id), `${definition.id}/${tier} missing protected destruction group ${id}`);
      }
      if (spec.workloadContract?.[tier]) {
        const summary = summarizeSculptRuntime(asset.runtime);
        assert.equal(summary.renderItems, spec.workloadContract[tier].renderItems, `${definition.id}/${tier} render-item evidence drifted`);
        assert.equal(summary.storedVertices, spec.workloadContract[tier].storedVertices, `${definition.id}/${tier} stored-vertex evidence drifted`);
        assert.equal(summary.storedTriangles, spec.workloadContract[tier].triangles, `${definition.id}/${tier} triangle evidence drifted`);
      }
    } finally {
      asset.dispose();
    }
  }
}

export function validateCorpusManifest() {
  const manifest = readJson(manifestPath, "corpus lab manifest");
  const corpus = readJson(corpusContractPath, "corpus deep contract");
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.id, "webgpu-object-sculptor-corpus");
  assert.equal(manifest.skill, "threejs-object-sculptor");
  assert.equal(manifest.kind, "canonical-lab");
  requireIncomplete(manifest.status, "manifest status");
  assert.equal(manifest.browserEntry, "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html");
  assert(manifest.canonicalSource.includes("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/corpus.contract.json"), "canonical manifest must link the deep corpus contract");
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.id, "webgpu-object-sculptor-corpus-contract");
  assert.equal(corpus.manifestId, manifest.id);
  assert.equal(corpus.manifestPath, "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/lab.manifest.json");
  assert.equal(corpus.canonicalSchemaPath, "labs/schema/lab-manifest.schema.json");
  requireIncomplete(corpus.status, "corpus deep-contract status");

  exact(ids(manifest.scenarios, "manifest scenarios"), EXPECTED_TARGET_IDS, "manifest scenarios");
  exact(ids(manifest.mechanisms, "manifest mechanisms"), SCULPT_MODES, "manifest mechanisms");
  exact(ids(manifest.tiers, "manifest tiers"), SCULPT_TIERS, "manifest tiers");
  exact(manifest.cameras, CORPUS_CAMERAS, "manifest cameras");
  exact(manifest.modes, SCULPT_MODES, "manifest modes");
  exact(ids(corpus.scenarios, "corpus scenarios"), EXPECTED_TARGET_IDS, "corpus scenarios");
  exact(ids(corpus.mechanisms, "corpus mechanisms"), SCULPT_MODES, "corpus mechanisms");
  exact(ids(corpus.tiers, "corpus tiers"), SCULPT_TIERS, "corpus tiers");
  exact(ids(corpus.cameras, "corpus cameras"), CORPUS_CAMERAS, "corpus cameras");
  assert.equal(corpus.physicalRouteContract?.routeCount, 15, "deep contract must register 15 physical routes");
  assert.equal(corpus.corpusDiversityContract?.minimumNonBoatTargets, 2);
  assert.equal(corpus.corpusDiversityContract?.preexistingBoatBaseline, "webgpu-tower-ship-sculptor");
  assert.equal(corpus.corpusDiversityContract?.boatBaselineCountsTowardMinimum, false);
  assert.equal(corpus.corpusDiversityContract?.actualNonBoatTargets, 3);
  assert.equal(corpus.corpusDiversityContract?.requiresOrganicTarget, true);
  assert.equal(corpus.corpusDiversityContract?.organicTarget, "potted-bonsai");
  assert.equal(corpus.corpusDiversityContract?.requiresDistinctConstructionFamilies, true);
  assert.equal(new Set(corpus.scenarios.map(({ category }) => category)).size, 3, "corpus scenarios must use distinct categories");
  assert(
    corpus.scenarios.find(({ id }) => id === "potted-bonsai")?.formLanguage?.includes("organic"),
    "corpus must retain one explicit organic target",
  );
  requireIncomplete(corpus.corpusDiversityContract?.status, "corpus diversity acceptance status");

  for (const [field, kind] of [["scenarios", "scenario"], ["mechanisms", "mechanism"]]) {
    for (const entry of manifest[field]) {
      const deepEntry = corpus[field].find(({ id }) => id === entry.id);
      assert(deepEntry, `deep contract missing ${kind}/${entry.id}`);
      assert.equal(entry.route, `${kind}/${entry.id}/`, `${kind}/${entry.id} canonical route drifted`);
      assert.equal(deepEntry.route, entry.route, `${kind}/${entry.id} canonical/deep route drifted`);
      requireIncomplete(entry.acceptanceStatus, `${kind}/${entry.id} canonical acceptance status`);
      requireIncomplete(deepEntry.status, `${kind}/${entry.id} deep acceptance status`);
      if (kind === "scenario") {
        const { mechanism, ...deepStartup } = deepEntry.startup;
        assert.deepEqual(
          entry.startup,
          { ...deepStartup, mode: mechanism },
          `${kind}/${entry.id} canonical/deep startup drifted`,
        );
      } else {
        assert.deepEqual(entry.startup, { mode: deepEntry.startup.mechanism }, `${kind}/${entry.id} canonical/deep startup drifted`);
      }
    }
  }
  for (const tier of manifest.tiers) {
    const deepTier = corpus.tiers.find(({ id }) => id === tier.id);
    assert(deepTier, `deep contract missing tier/${tier.id}`);
    assert.equal(deepTier.route, `tier/${tier.id}/`, `tier/${tier.id} deep route drifted`);
    requireIncomplete(tier.acceptanceStatus, `tier/${tier.id} canonical acceptance status`);
    requireIncomplete(deepTier.status, `tier/${tier.id} deep acceptance status`);
    assert.equal(tier.resolutionPolicy?.dprCap, CORPUS_DPR_CAPS[tier.id], `${tier.id} manifest/controller DPR cap drifted`);
  }
  for (const camera of corpus.cameras) {
    assert.equal(camera.route, `camera/${camera.id}/`, `camera/${camera.id} deep route drifted`);
    requireIncomplete(camera.status, `camera/${camera.id} deep acceptance status`);
  }
  assert.equal(corpus.defaultStartup.scenario, "potted-bonsai");
  assert.equal(corpus.defaultStartup.mechanism, "action-ready");
  assert.equal(corpus.defaultStartup.tier, "budgeted");
  assert.equal(corpus.defaultStartup.camera, "design");
  assert.equal(corpus.defaultStartup.seed, 1);
  assert.deepEqual(corpus.physicalRouteContract.dimensions, { scenario: 3, mechanism: 5, tier: 3, camera: 4 });
  exact(Object.keys(corpus.commands), ["specs", "targets", "unit", "generateRoutes", "routes"], "deep command names");

  assert.equal(corpus.renderArchitecture?.renderer, "WebGPURenderer");
  assert.equal(corpus.renderArchitecture?.requiredBackend, "native WebGPU");
  assert.equal(corpus.renderArchitecture?.fallback, "none");
  assert.equal(corpus.renderArchitecture?.sceneRendersPerFrame, 1);
  assert.equal(corpus.renderArchitecture?.postProcessingPasses, 0);
  assert.equal(corpus.renderArchitecture?.toneMappingOwners, 1);
  assert.equal(corpus.renderArchitecture?.outputTransformOwners, 1);
  assert.equal(corpus.physicsBoundary?.assetRecordType, "ColliderConstructionInput");
  assert.equal(corpus.physicsBoundary?.solverAuthority, false);
  assert.equal(corpus.physicsBoundary?.canonicalProxyStatus, "blocked");
  assert.match(corpus.physicsBoundary?.rigidBodyPropertiesStatus ?? "", /^blocked/);
  requireIncomplete(corpus.physicsBoundary?.status, "deep physics boundary status");
  assert.equal(corpus.identityContinuity?.semanticIdsStableAcrossVisualTiers, true);
  assert.equal(corpus.identityContinuity?.continuityTokenRequiredForTierRebuild, true);
  assert.equal(corpus.identityContinuity?.changedSeedOrSourceRequiresNewGeneration, true);
  assert.match(corpus.identityContinuity?.solverStateContinuityClaim ?? "", /^blocked/);
  requireIncomplete(corpus.identityContinuity?.status, "deep identity continuity status");
  for (const requirement of manifest.capabilityRequirements) requireIncomplete(requirement.status, `capability ${requirement.id}`);
  for (const proof of manifest.runtimeProof) requireIncomplete(proof.status, `runtime proof ${proof.id}`);
  requireIncomplete(corpus.referencePolicy?.visualAcceptanceStatus, "deep reference visual acceptance");
  assert.equal(corpus.referencePolicy?.referenceImageAvailable, false);
  assert.equal(corpus.referencePolicy?.referenceImageLicense, null);
  assert.equal(corpus.referencePolicy?.referenceImageHash, null);
  assert.equal(corpus.referencePolicy?.referenceSimilarityClaim, "blocked");
  requireIncomplete(corpus.visualAcceptance?.status, "deep visual acceptance");
  exact(corpus.visualAcceptance?.acceptedScenarios, [], "deep accepted scenarios");
  assert.equal(manifest.sourceHash, null, "manifest sourceHash must remain null until evidence generation");
  assert.equal(manifest.proxyStatus, null, "manifest proxyStatus must remain null until evidence generation");
  rejectAcceptedStatus(manifest, "manifest");
  rejectAcceptedStatus(corpus, "corpus");

  exact(SCULPT_TARGETS.map(({ id }) => id), EXPECTED_TARGET_IDS, "registered target catalog");
  for (const definition of SCULPT_TARGETS) {
    const scenario = corpus.scenarios.find(({ id }) => id === definition.id);
    assert(scenario, `deep scenario missing ${definition.id}`);
    const specPath = resolve(here, scenario.spec);
    const referencePath = resolve(here, scenario.referenceManifest);
    const assessmentPath = resolve(dirname(specPath), "pre-spec-assessment.json");
    validateReferenceManifest(readJson(referencePath, `${definition.id} reference manifest`), definition, dirname(referencePath));
    validateAssessment(readJson(assessmentPath, `${definition.id} pre-spec assessment`), definition);
    const spec = readJson(specPath, `${definition.id} object sculpt spec`);
    validateSpec(spec, definition);
    assert.deepEqual(
      corpus.physicsBoundary.authoredColliderCeilingsMeters[definition.id],
      spec.physicsHandoff.colliderMaxSurfaceDeviationMeters,
      `${definition.id} manifest collider ceilings drifted from the spec`,
    );
    for (const tier of corpus.tiers) {
      const evidence = tier.sourceWorkloadEvidence[definition.id];
      const expected = spec.workloadContract?.[tier.id];
      assert(expected, `${definition.id}/${tier.id} workload contract is required`);
      assert.equal(evidence.renderItems, expected.renderItems, `${definition.id}/${tier.id} manifest render items drifted`);
      assert.equal(evidence.storedVertices, expected.storedVertices, `${definition.id}/${tier.id} manifest stored vertices drifted`);
      assert.equal(evidence.triangles, expected.triangles, `${definition.id}/${tier.id} manifest triangles drifted`);
    }
    validateRuntimeContract(definition, spec);
  }

  const falseAcceptedMutation = structuredClone(corpus);
  falseAcceptedMutation.visualAcceptance.status = "accepted";
  falseAcceptedMutation.visualAcceptance.acceptedScenarios = [EXPECTED_TARGET_IDS[0]];
  assert.throws(
    () => rejectAcceptedStatus(falseAcceptedMutation, "falseAcceptedMutation"),
    /falsely claims accepted state/,
    "manifest validator must reject a fabricated accepted state",
  );

  return Object.freeze({
    ok: true,
    manifestId: manifest.id,
    status: manifest.status,
    targets: EXPECTED_TARGET_IDS.length,
    modes: SCULPT_MODES.length,
    tiers: SCULPT_TIERS.length,
    cameras: CORPUS_CAMERAS.length,
    physicalRoutes: corpus.physicalRouteContract.routeCount,
    referenceImages: 0,
    acceptedScenarios: 0,
    negativeControls: Object.freeze(["false-accepted-manifest"]),
  });
}

try {
  console.log(JSON.stringify(validateCorpusManifest(), null, 2));
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
