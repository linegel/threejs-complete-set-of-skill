import * as THREE from "three/webgpu";
import {
  emissive,
  mrt,
  output,
  pass,
  renderOutput,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import {
  createAntiqueGoldPbrMaterial,
  createEbonyFramePbrMaterial,
  createLavaEmissivePbrMaterial,
  createWalnutPbrMaterial,
  proceduralPbrDebugModes,
  setLavaFlowTime,
  setProceduralPbrDebugMode,
} from "./procedural-pbr-materials.js";

export const SCENE_DEBUG_MODES = Object.freeze({
  final: "final",
  rawEmissive: "raw-emissive",
  bloomOnly: "bloom-only",
  noPost: "no-post",
});

function makeSwatch(material, x, label) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 96, 48), material);
  mesh.position.set(x, 0.72, 0);
  mesh.name = label;
  return mesh;
}

export async function createProceduralPbrScene({
  canvas,
  width = 1280,
  height = 720,
  pixelRatio = 1,
  debugMode = "final",
  materialScale = 1,
} = {}) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    outputBufferType: THREE.HalfFloatType,
  });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101416);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);
  camera.position.set(0, 2.1, 6.4);
  camera.lookAt(0, 0.72, 0);

  const materials = {
    walnut: createWalnutPbrMaterial({ seed: 11, coordinateScale: 1.15 * materialScale, debugMode }),
    antiqueGold: createAntiqueGoldPbrMaterial({ seed: 23, coordinateScale: 1.5 * materialScale, debugMode }),
    ebony: createEbonyFramePbrMaterial({ seed: 31, coordinateScale: 1.35 * materialScale, debugMode }),
    lava: createLavaEmissivePbrMaterial({ seed: 41, coordinateScale: 1.2 * materialScale, debugMode }),
  };

  const swatches = [
    makeSwatch(materials.walnut, -2.55, "swatch-oiled-walnut"),
    makeSwatch(materials.antiqueGold, -0.85, "swatch-antique-gold"),
    makeSwatch(materials.ebony, 0.85, "swatch-ebony-lacquer"),
    makeSwatch(materials.lava, 2.55, "swatch-lava-crust-heat"),
  ];
  swatches.forEach((mesh) => scene.add(mesh));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 2.4),
    new THREE.MeshStandardNodeMaterial({ color: 0x3d4448, roughness: 0.74 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = "neutral-ground-plane";
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xdce8ff, 0x171411, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const renderPipeline = new THREE.RenderPipeline(renderer);
  // RenderPipeline.outputColorTransform is disabled because this example owns
  // the single output conversion through explicit renderOutput() nodes below.
  renderPipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    emissive,
  }));
  scenePass.setResolutionScale(1);

  const sceneColor = scenePass.getTextureNode("output");
  const emissiveNode = scenePass.getTextureNode("emissive");
  const bloomPass = bloom(emissiveNode, 0.42, 0.32, 0.85);
  bloomPass.smoothWidth.value = 0.08;
  bloomPass.setResolutionScale(0.5);
  const bloomNode = bloomPass.getTextureNode();
  const finalNode = renderOutput(sceneColor.add(bloomNode));
  const rawEmissiveNode = renderOutput(emissiveNode);
  const bloomOnlyNode = renderOutput(bloomNode);
  const noPostNode = renderOutput(sceneColor);
  const debugOutputs = {
    [SCENE_DEBUG_MODES.final]: finalNode,
    [SCENE_DEBUG_MODES.rawEmissive]: rawEmissiveNode,
    [SCENE_DEBUG_MODES.bloomOnly]: bloomOnlyNode,
    [SCENE_DEBUG_MODES.noPost]: noPostNode,
  };
  renderPipeline.outputNode = finalNode;

  function resize(nextWidth = width, nextHeight = height, nextPixelRatio = pixelRatio) {
    width = nextWidth;
    height = nextHeight;
    pixelRatio = Math.min(nextPixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    scenePass.setSize(width, height);
    bloomPass.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setDebugMode(mode) {
    for (const material of Object.values(materials)) {
      setProceduralPbrDebugMode(material, mode);
    }
  }

  function setSceneDebugMode(mode) {
    renderPipeline.outputNode = debugOutputs[mode] ?? finalNode;
    renderPipeline.needsUpdate = true;
  }

  function setMaterialScale(nextScale) {
    for (const [index, material] of Object.values(materials).entries()) {
      const state = material.userData.proceduralPbr;
      if (state?.uniforms?.coordinateScale) {
        state.uniforms.coordinateScale.value = nextScale * (1 + index * 0.15);
      }
    }
  }

  function frame(elapsedSeconds = 0) {
    setLavaFlowTime(materials.lava, elapsedSeconds);
    for (const [index, mesh] of swatches.entries()) {
      mesh.rotation.y = elapsedSeconds * 0.18 + index * 0.35;
    }
    renderPipeline.render();
  }

  function dispose() {
    bloomPass.dispose();
    scenePass.dispose();
    renderPipeline.dispose();
    renderer.dispose();
    for (const mesh of swatches) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    floor.geometry.dispose();
    floor.material.dispose();
  }

  resize(width, height, pixelRatio);
  return {
    renderer,
    renderPipeline,
    scene,
    scenePass,
    bloomPass,
    camera,
    materials,
    swatches,
    debugOutputs,
    frame,
    resize,
    setDebugMode,
    setSceneDebugMode,
    setMaterialScale,
    dispose,
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const canvas = document.querySelector("#scene");
  const debugSelect = document.querySelector("#debug");
  const rawEmissive = document.querySelector("#raw-emissive");
  const bloomOnly = document.querySelector("#bloom-only");
  const noPost = document.querySelector("#no-post");
  const scale = document.querySelector("#scale");

  for (const mode of proceduralPbrDebugModes.keys()) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode;
    debugSelect.append(option);
  }

  const app = await createProceduralPbrScene({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  });

  function setExclusiveSceneDebugMode(activeControl, mode) {
    for (const control of [rawEmissive, bloomOnly, noPost]) {
      if (control !== activeControl) control.checked = false;
    }
    app.setSceneDebugMode(activeControl.checked ? mode : SCENE_DEBUG_MODES.final);
  }

  debugSelect.addEventListener("change", () => app.setDebugMode(debugSelect.value));
  rawEmissive.addEventListener("change", () => setExclusiveSceneDebugMode(rawEmissive, SCENE_DEBUG_MODES.rawEmissive));
  bloomOnly.addEventListener("change", () => setExclusiveSceneDebugMode(bloomOnly, SCENE_DEBUG_MODES.bloomOnly));
  noPost.addEventListener("change", () => setExclusiveSceneDebugMode(noPost, SCENE_DEBUG_MODES.noPost));
  scale.addEventListener("input", () => app.setMaterialScale(Number(scale.value)));
  window.addEventListener("resize", () => app.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio));
  rendererLoop(app);
}

function rendererLoop(app) {
  app.renderer.setAnimationLoop((timeMs) => app.frame(timeMs * 0.001));
}
