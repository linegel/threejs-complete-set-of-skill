import {
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  RenderPipeline,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/addons/tsl/shadows/TileShadowNode.js";
import { Fn, positionLocal, sin, uniform, vec3 } from "three/tsl";

import {
  CLIPMAP_IMPLEMENTATION_STATUS,
  DEFAULT_CLIPMAP_CONFIG,
  SHADOW_ARCHITECTURE_DECISIONS,
  clampClipmapConfig,
  estimateShadowMemoryBytes,
  validateClipmapConfig,
} from "./clipmap-config.js";
import { CachedClipmapShadowNode } from "./clipmap-shadow-node.js";
import { createDebugSnapshot, createDeterministicValidationScene } from "./debug-views.js";

const addonSymbols = { CSMShadowNode, TileShadowNode, RenderPipeline };
void addonSymbols;

export async function createShadowRenderer(options = {}) {
  const renderer = new WebGPURenderer(options);
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new Error("Cached clipmap shadow validation requires the WebGPU backend");
  }
  return renderer;
}

export function createShadowArchitectureDecisionRecord({
  receiverBounded = false,
  needsCameraCascades = false,
  needsTiledProjection = false,
  persistentLocalizedCoverage = false,
  measurementEvidence = {},
} = {}) {
  let selected = SHADOW_ARCHITECTURE_DECISIONS[0];
  if (needsTiledProjection) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[2];
  } else if (needsCameraCascades) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[1];
  } else if (!receiverBounded) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[1];
  }

  const customCandidate = persistentLocalizedCoverage
    ? SHADOW_ARCHITECTURE_DECISIONS[3]
    : null;

  return {
    selected,
    customCandidate,
    decisionStatus: customCandidate
      ? "phase-1-custom-candidate-not-production-selectable"
      : "built-in-path-selected",
    productionClipmapProof: CLIPMAP_IMPLEMENTATION_STATUS.productionClipmapProof,
    compared: SHADOW_ARCHITECTURE_DECISIONS.map((decision) => ({
      ...decision,
      measurementEvidence: measurementEvidence[decision.use] ?? null,
    })),
    requirement:
      "custom cached clipmap selection requires a complete receiver implementation plus same-workload Measured evidence against built-in paths",
  };
}

export function createCachedClipmapShadowSystem({
  config = DEFAULT_CLIPMAP_CONFIG,
  light = new DirectionalLight(0xffffff, 1),
  attachPhase1Scaffold = false,
  architecture = createShadowArchitectureDecisionRecord({
    persistentLocalizedCoverage: true,
  }),
} = {}) {
  const validation = validateClipmapConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  light.castShadow = true;
  light.position.set(20, 50, 20);
  light.target.position.set(0, 0, 0);
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = false;

  const node = new CachedClipmapShadowNode(light, light.shadow, validation.config);
  if (attachPhase1Scaffold) {
    node.attachToLight(light);
  }
  const { scene: casterScene, caster: displacedCaster } = createRenderableShadowCasterScene();
  let disposed = false;

  return {
    light,
    node,
    implementationStatus: CLIPMAP_IMPLEMENTATION_STATUS,
    architecture,
    config: validation.config,
    levels: node.levels,
    scene: createDeterministicValidationScene(),
    casterScene,
    displacedCaster,
    get attachedToLight() {
      return light.shadow.shadowNode === node;
    },
    get disposed() {
      return disposed;
    },
    attachForValidation() {
      node.attachToLight(light);
      return node;
    },
    debugSnapshot() {
      return createDebugSnapshot({
        levels: node.levels,
        selection: node.lastSelection,
        memoryBytes: estimateShadowMemoryBytes(
          node.levels,
          validation.config.bytesPerDepthTexel,
          validation.config.bytesPerColorTexel,
        ),
        architecture,
      });
    },
    update(cameraLight = new Vector3(), frame = {}) {
      if (frame.deformationTime !== undefined) {
        displacedCaster.displacementTime.value = frame.deformationTime;
      }
      node.updateBefore({
        cameraLight,
        lightDirectionChanged: frame.lightDirectionChanged,
        deformationFields: [
          {
            id: "shared-wave-caster",
            uniform: displacedCaster.displacementTime,
            boundsLightSpace: frame.deformationBoundsLightSpace,
          },
        ],
      });
      return node.renderShadow({
        frameId: frame.frameId ?? 0,
        renderer: frame.renderer,
        casterScene: frame.casterScene ?? casterScene,
        lightDirection: frame.lightDirection,
        lightBasis: frame.lightBasis,
        lightSpaceToWorld: frame.lightSpaceToWorld,
        shadowDepthInterval: frame.shadowDepthInterval,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      node.dispose();
      casterScene.remove(displacedCaster.mesh);
      displacedCaster.mesh.geometry.dispose();
      displacedCaster.material.dispose();
    },
  };
}

export function createSeededShadowValidationScene(seed = 1234) {
  return createDeterministicValidationScene(seed);
}

export function normalizeShadowConfig(config = {}) {
  return clampClipmapConfig(config);
}

export function createSharedDisplacedCaster({
  displacementTime = uniform(0),
  displacementAmplitude = uniform(0.35),
} = {}) {
  const sharedPositionNode = Fn(() =>
    positionLocal.add(
      vec3(
        0,
        sin(positionLocal.x.mul(0.31).add(displacementTime)).mul(displacementAmplitude),
        0,
      ),
    ),
  )();

  const material = new MeshStandardNodeMaterial();
  material.positionNode = sharedPositionNode;
  material.castShadowPositionNode = sharedPositionNode;
  // r185 space contract: positionNode/castShadowPositionNode are local-space
  // geometry hooks. receivedShadowPositionNode is a world-space receiver
  // lookup hook, so the default derived positionWorld path must remain active.
  material.receivedShadowPositionNode = null;

  const mesh = new Mesh(new PlaneGeometry(24, 24, 32, 32), material);
  mesh.name = "shared-position-node-displaced-caster";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.shadowCasterParity = {
    sharedPositionNode,
    positionNode: material.positionNode,
    castShadowPositionNode: material.castShadowPositionNode,
    receivedShadowPositionNode: material.receivedShadowPositionNode,
  };

  return { mesh, material, displacementTime, displacementAmplitude, sharedPositionNode };
}

export function createRenderableShadowCasterScene() {
  const scene = new Scene();
  scene.name = "cached-clipmap-shadow-caster-scene";
  const caster = createSharedDisplacedCaster();
  scene.add(caster.mesh);
  return { scene, caster };
}
