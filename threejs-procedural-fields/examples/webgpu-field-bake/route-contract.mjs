export const ROUTE_KINDS = Object.freeze(["mechanism", "tier"]);

export const FIELD_MECHANISM_OUTPUTS = Object.freeze({
  "field-and-gradient-gallery": Object.freeze({ outputNodeId: "macro-slope-roughness-gallery" }),
  "domain-warp-jacobian": Object.freeze({ outputNodeId: "tangent-warp-vector" }),
  "storage-bake-and-mips": Object.freeze({ outputNodeId: "storage-packed-sample" }),
  "direct-vs-baked": Object.freeze({ outputNodeId: "split-direct-storage-comparison" }),
  "structured-placement": Object.freeze({ outputNodeId: "accepted-rejected-placement-mask" }),
  "shared-cause-composition": Object.freeze({ outputNodeId: "height-moisture-roughness-causes" }),
});

export function validateTierResourceDescription(tier, description) {
  if (!description || description.tier !== tier) {
    throw new Error(`resource description does not belong to tier "${tier}"`);
  }
  const ledger = description.common?.completeResourceLedger;
  const resourceIds = new Set(ledger?.resources?.map((resource) => resource.id));
  if (
    ledger?.schemaVersion !== 2 ||
    !resourceIds.has("display-evidence-target") ||
    !resourceIds.has("raw-probe-target") ||
    !resourceIds.has("display-readback-request") ||
    ledger.opaqueRendererResidency !== "NOT_CLAIMED"
  ) {
    throw new Error("tier resource description omitted common targets or scoped capture transients");
  }
  if (tier === "gpu-storage") {
    if (!(description.textures >= 3) || !(description.storageBuffers >= 2) || !(description.bytes > 0)) {
      throw new Error("gpu-storage tier must own live textures, compacted indices, and placement records");
    }
    for (const id of [
      "probe-corpus-coordinates",
      "probe-corpus-gradient-output",
      "storage-readback-request",
    ]) {
      if (!resourceIds.has(id)) throw new Error(`gpu-storage resource ledger omitted ${id}`);
    }
  } else if (tier === "gpu-direct-evaluate") {
    if (description.textures !== 0 || description.storageBuffers !== 0 || description.storageBytes !== 0) {
      throw new Error("gpu-direct-evaluate tier retained storage or sampled field textures");
    }
  } else if (tier === "precomputed-minimum") {
    if (
      description.precomputedTextures !== 1 ||
      description.storageBuffers !== 0 ||
      description.storageBytes !== 0
    ) {
      throw new Error("precomputed-minimum tier must own exactly one sampled asset and no runtime storage");
    }
    const asset = description.precomputedAsset;
    if (
      !asset ||
      asset.seed !== description.seed ||
      !Number.isInteger(asset.sourceByteLength) || asset.sourceByteLength <= 0 ||
      !/^[0-9a-f]{64}$/.test(asset.sha256 ?? "") ||
      !Array.isArray(description.mipExtents) ||
      description.mipExtents.length !== description.mipLevelCount ||
      description.decodedTextureBytes !== description.decodedMipChainBytes ||
      description.sourceAssetBytes !== asset.sourceByteLength ||
      description.sourceAssetSha256 !== asset.sha256
    ) {
      throw new Error("precomputed-minimum seed, source hash, mip chain, or byte contract is incomplete");
    }
    const exactMipBytes = description.mipExtents.reduce(
      (sum, extent) => sum + extent.width * extent.height * asset.channels,
      0,
    );
    if (
      description.decodedBaseBytes !== asset.width * asset.height * asset.channels ||
      description.decodedMipChainBytes !== exactMipBytes
    ) {
      throw new Error("precomputed-minimum decoded byte count does not match its exact mip extents");
    }
    if (!resourceIds.has("precomputed-field-texture")) {
      throw new Error("precomputed-minimum resource ledger omitted its sampled mip chain");
    }
  } else {
    throw new Error(`Unknown tier "${tier}"`);
  }
  return Object.freeze(description);
}

export function enforceLockedRouteSelection({ kind, id }, selectionKind, value) {
  if (kind === null || kind === undefined) return;
  if (!ROUTE_KINDS.includes(kind)) throw new Error(`Unknown route kind "${kind}"`);
  if (!ROUTE_KINDS.includes(selectionKind)) throw new Error(`Unknown selection kind "${selectionKind}"`);
  if (kind === selectionKind && value !== id) {
    throw new Error(`Locked ${kind} route "${id}" cannot select "${value}"`);
  }
}

export function validateStorageEvidenceContract(contract) {
  if (contract.filteredConsumerValidated === true && contract.filteredMipReadbackValidated !== true) {
    throw new Error("filtered consumption cannot pass without independent filtered-mip readback");
  }
  return Object.freeze(contract);
}

export function validateDisplaySubmissionCount(description) {
  if (description.sceneSubmissionCount !== 2) {
    throw new Error("field display renders once to the evidence target and once to the canvas");
  }
  return Object.freeze(description);
}

export function resolveLockedRoute(manifest, kind, id) {
  if (!ROUTE_KINDS.includes(kind)) throw new Error(`Unknown route kind "${kind}"`);
  if (typeof id !== "string" || id.length === 0) throw new Error("route id must be nonempty");
  const entries = kind === "mechanism" ? manifest.mechanisms : manifest.tiers;
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown ${kind} route "${id}"`);
  const outputNodeId = kind === "mechanism" ? FIELD_MECHANISM_OUTPUTS[id]?.outputNodeId : null;
  if (kind === "mechanism" && !outputNodeId) {
    throw new Error(`Mechanism route "${id}" has no distinct output contract`);
  }
  return Object.freeze({ kind, id, labId: manifest.id, status: entry.acceptanceStatus, outputNodeId });
}
