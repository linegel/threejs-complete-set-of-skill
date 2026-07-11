import { createDenseVegetationSceneAdapter } from "../webgpu-dense-grass/integration-adapter.js";
import {
  createAshForestStorage,
  createAshScene,
  disposeAshMaterialTextures,
  getAshGeometryResourceLedger,
  setAshDiagnosticMode,
} from "../structured-ash-growth/ash-scene.js";

export const VEGETATION_INTEGRATION_SCENARIOS = Object.freeze([
  "weathered-world-host",
  "creature-habitat-host",
]);

const REQUIRED_OWNER_KEYS = Object.freeze([
  "renderer",
  "camera",
  "planet",
  "terrain",
  "weather",
  "pipeline",
  "toneMap",
  "outputTransform",
]);

export function validateVegetationHostContract(host) {
  const errors = [];
  if (!host || typeof host !== "object") return { ok: false, errors: ["host contract is required"] };
  for (const key of ["renderer", "scene", "camera", "pipeline", "planet", "terrain", "weather"]) {
    if (!host[key]) errors.push(`host.${key} is required`);
  }
  for (const key of REQUIRED_OWNER_KEYS) {
    if (typeof host.owners?.[key] !== "string" || host.owners[key].length === 0) {
      errors.push(`host.owners.${key} must be a nonempty owner id`);
    }
  }
  if (!(host.worldUnitsPerMeter > 0) || !Number.isFinite(host.worldUnitsPerMeter)) {
    errors.push("host.worldUnitsPerMeter must be finite and positive");
  }
  for (const source of ["planet", "terrain"]) {
    if (host[source]?.worldUnitsPerMeter !== host.worldUnitsPerMeter) {
      errors.push(`${source}.worldUnitsPerMeter must equal the shared host unit contract`);
    }
  }
  const finalOwner = host.owners?.pipeline;
  if (host.owners?.toneMap !== finalOwner || host.owners?.outputTransform !== finalOwner) {
    errors.push("pipeline, tone map, and output transform must have the same single host owner");
  }
  if (host.renderer?.backend?.isWebGPUBackend !== true) {
    errors.push("host renderer must be initialized with a native WebGPU backend");
  }
  return { ok: errors.length === 0, errors };
}

export async function createVegetationIntegration({
  host,
  scenario = "weathered-world-host",
  denseTier = "medium",
  denseSeed = 1,
  forestCount = 100,
  loadTextures = false,
} = {}) {
  if (!VEGETATION_INTEGRATION_SCENARIOS.includes(scenario)) {
    throw new Error(`unknown vegetation integration scenario "${scenario}"`);
  }
  const validation = validateVegetationHostContract(host);
  if (!validation.ok) throw new Error(`invalid vegetation host contract:\n- ${validation.errors.join("\n- ")}`);

  const dense = await createDenseVegetationSceneAdapter({
    renderer: host.renderer,
    scene: host.scene,
    camera: host.camera,
    pipeline: host.pipeline,
    weather: host.weather,
    worldUnitsPerMeter: host.worldUnitsPerMeter,
    tier: denseTier,
    seed: denseSeed,
  });
  const ash = createAshScene({ loadTextures, worldUnitsPerMeter: host.worldUnitsPerMeter });
  const forest = createAshForestStorage({
    tree: ash.tree,
    materials: ash.materials,
    timeNode: ash.timeNode,
    count: forestCount,
    worldUnitsPerMeter: host.worldUnitsPerMeter,
  });
  host.scene.add(ash.group, forest.group);
  let disposed = false;
  let mode = "owner-graph";

  const integration = {
    scenario,
    dense,
    ash,
    forest,
    update({ time = host.weather.time ?? 0, contacts = [] } = {}) {
      if (disposed) throw new Error("vegetation integration is disposed");
      dense.update({ time, contacts });
      ash.timeNode.value = time;
      ash.windStrengthNode.value = host.weather.windStrength ?? 0;
    },
    setMode(nextMode) {
      const mapping = {
        final: ["final", "final"],
        "owner-graph": ["bounds", "branch-levels"],
        "weather-diagnostics": ["wind", "wind-displacement"],
        "contact-diagnostics": ["wind", "final"],
      };
      if (!(nextMode in mapping)) throw new Error(`unknown vegetation integration mode "${nextMode}"`);
      mode = nextMode;
      dense.system.setDebugMode(mapping[nextMode][0]);
      setAshDiagnosticMode(ash, mapping[nextMode][1]);
    },
    describePipeline() {
      return {
        owners: { ...host.owners },
        signals: [
          { id: "world-units", producer: host.owners.terrain, consumers: ["dense-grass", "structured-ash"] },
          { id: "weather", producer: host.owners.weather, consumers: ["dense-grass", "structured-ash"] },
          { id: "creature-contacts", producer: scenario === "creature-habitat-host" ? "host-creatures" : "host-none", consumers: ["dense-grass"] },
        ],
        sceneSubmissions: [{ id: "host-scene-pass", owner: host.owners.pipeline, count: 1 }],
        computeDispatches: [{ id: "dense-static-placement", owner: "dense-grass", count: dense.system.getStats().initDispatches }],
        resources: integration.describeResources(),
        finalToneMapOwner: host.owners.toneMap,
        finalOutputTransformOwner: host.owners.outputTransform,
      };
    },
    describeResources() {
      const denseResources = dense.system.getDiagnostics();
      const branchVertices = ash.tree.branchGeometry.getAttribute("position").count;
      const branchTriangles = ash.tree.branchGeometry.index.count / 3;
      const leafVertices = ash.tree.leafGeometry.getAttribute("position").count;
      const leafTriangles = ash.tree.leafGeometry.index.count / 3;
      const ashGeometry = getAshGeometryResourceLedger(ash.tree);
      return {
        dense: {
          patchCount: denseResources.patchCount,
          storageBytes: denseResources.storageResidentBytes,
          storageBytesPerBlade: denseResources.storageBytesPerBlade,
          renderGeometryBytes: denseResources.renderGeometryBytes,
          drawCeiling: denseResources.visibleDrawObjectCeiling,
          staticStorageIdentity: denseResources.staticStorageIdentity,
          staticStorageRevision: denseResources.staticStorageRevision,
          staticStorageImmutable: denseResources.staticStorageImmutable,
          rootedDeformation: denseResources.rootedDeformation,
          deformedNormals: denseResources.deformedNormals,
          shadowUsesVisibleDeformation: denseResources.visibleShadowDeformationParity,
          worldUnitsPerMeter: denseResources.worldUnitsPerMeter,
          patchSizeSceneUnits: dense.system.options.patchSize,
          patchSizeMeters: dense.system.options.patchSizeMeters,
        },
        ashForeground: {
          branchVertices,
          branchTriangles,
          leafVertices,
          leafTriangles,
          worldUnitsPerMeter: ash.worldUnitsPerMeter,
          objectScale: ash.group.scale.x,
          rootedNormalNode: Boolean(ash.leafMesh.material.normalNode),
          shadowUsesVisibleMaterial: ash.leafMesh.castShadow && ash.leafMesh.customDepthMaterial == null,
          geometryResidentBytes: ashGeometry.residentBytes,
        },
        ashForest: {
          instances: forest.count,
          bands: forest.bands.length,
          draws: forest.drawCount,
          storageBytes: forest.storageBytes,
          storageIdentity: forest.storageIdentity,
          storageImmutable: forest.storageImmutable(),
          worldUnitsPerMeter: forest.worldUnitsPerMeter,
          sharedTopologyResidentBytes: ashGeometry.residentBytes,
          geometryObjects: forest.bands.length * 2,
        },
        hostOwned: ["planet", "terrain", "renderer", "camera", "pipeline", "toneMap", "outputTransform"],
      };
    },
    getMetrics() {
      return {
        scenario,
        acceptanceStatus: "incomplete",
        mode,
        worldUnitsPerMeter: host.worldUnitsPerMeter,
        dense: dense.system.getDiagnostics(),
        forestDraws: forest.drawCount,
        rendererOwnerCount: 1,
        pipelineOwnerCount: 1,
        toneMapOwnerCount: 1,
        outputTransformOwnerCount: 1,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dense.dispose();
      host.scene.remove(ash.group, forest.group);
      forest.dispose();
      ash.branchMesh.geometry.dispose();
      ash.leafMesh.geometry.dispose();
      ash.leafOrigins.geometry.dispose();
      ash.ground.geometry.dispose();
      ash.ground.material.dispose();
      ash.materials.bark.dispose();
      ash.materials.leaves.dispose();
      disposeAshMaterialTextures(ash.materials);
      for (const material of Object.values(ash.materials.diagnostics)) material.dispose();
    },
  };
  integration.setMode(mode);
  integration.update();
  return integration;
}
