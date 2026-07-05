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
  return renderer;
}

export function createShadowArchitectureDecisionRecord({
  receiverBounded = false,
  needsCameraCascades = false,
  needsTiledProjection = false,
  streamingPersistentCoverage = false,
  measuredGpuTimes = {},
} = {}) {
  let selected = SHADOW_ARCHITECTURE_DECISIONS[0];
  if (streamingPersistentCoverage) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[3];
  } else if (needsTiledProjection) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[2];
  } else if (needsCameraCascades) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[1];
  } else if (!receiverBounded) {
    selected = SHADOW_ARCHITECTURE_DECISIONS[1];
  }

  return {
    selected,
    compared: SHADOW_ARCHITECTURE_DECISIONS.map((decision) => ({
      ...decision,
      measuredGpuTimeMs: measuredGpuTimes[decision.use] ?? null,
    })),
    requirement:
      "custom cached clipmap wins only when persistent coarse coverage or targeted invalidation lowers measured GPU time",
  };
}

export function createCachedClipmapShadowSystem({
  config = DEFAULT_CLIPMAP_CONFIG,
  light = new DirectionalLight(0xffffff, 1),
  architecture = createShadowArchitectureDecisionRecord({
    streamingPersistentCoverage: true,
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
  node.attachToLight(light);
  const { scene: casterScene, caster: displacedCaster } = createRenderableShadowCasterScene();

  return {
    light,
    node,
    architecture,
    config: validation.config,
    levels: node.levels,
    scene: createDeterministicValidationScene(),
    casterScene,
    displacedCaster,
    debugSnapshot() {
      return createDebugSnapshot({
        levels: node.levels,
        selection: node.lastSelection,
        memoryBytes: estimateShadowMemoryBytes(node.levels, validation.config.bytesPerDepthTexel),
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
      });
    },
    dispose() {
      node.dispose();
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
  material.receivedShadowPositionNode = sharedPositionNode;

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
