import { Matrix4, Quaternion, Vector3 } from "three/webgpu";

import { createPatchBoundsCompute } from "./patch-compute.js";
import { createPlanetFieldAtlas } from "./planet-field-atlas.js";
import {
  createPlanetPatchMesh,
  createPlanetRuntimeConfiguration,
  createPlanetRuntimeFrontier,
  disposePlanetPatchMesh,
  setPlanetMaterialMode,
} from "./planet-mesh.js";
import { frontierSignature } from "./planet-quadtree.js";

function finiteVector(values, length, label) {
  if (!Array.isArray(values) || values.length !== length ||
      values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must contain ${length} finite values`);
  }
  return values;
}

export function createPlanetAtmosphereHandoff({
  config,
  worldUnitsPerMeter,
  bodyFrame = {},
} = {}) {
  if (!config?.preset || !(worldUnitsPerMeter > 0) || !Number.isFinite(worldUnitsPerMeter)) {
    throw new Error("atmosphere handoff requires a planet config and positive worldUnitsPerMeter");
  }
  const centerWorld = finiteVector(bodyFrame.centerWorld ?? [0, 0, 0], 3, "body centerWorld");
  const orientationValues = finiteVector(
    bodyFrame.orientationWorldFromBody ?? [0, 0, 0, 1],
    4,
    "body orientationWorldFromBody",
  );
  const orientation = new Quaternion(...orientationValues);
  if (!(orientation.lengthSq() > 0)) throw new Error("body orientation quaternion must be nonzero");
  orientation.normalize();
  const bodyToWorld = new Matrix4().compose(
    new Vector3().fromArray(centerWorld),
    orientation,
    new Vector3(1, 1, 1),
  );
  const worldToBody = bodyToWorld.clone().invert();
  const surfaceRadiusMeters = config.radiusKm * 1000;
  const atmosphereBottomRadiusMeters = config.preset.atmosphereInnerRadiusKm * 1000;
  const atmosphereTopRadiusMeters = config.preset.atmosphereOuterRadiusKm * 1000;

  function worldPointToBodyWorld(point) {
    finiteVector(point, 3, "world point");
    return new Vector3().fromArray(point).applyMatrix4(worldToBody);
  }

  return Object.freeze({
    schemaVersion: 1,
    referenceSurface: "sphere",
    worldUnitsPerMeter,
    metresPerWorldUnit: 1 / worldUnitsPerMeter,
    surfaceRadiusMeters,
    surfaceRadiusWorld: surfaceRadiusMeters * worldUnitsPerMeter,
    atmosphereBottomRadiusMeters,
    atmosphereTopRadiusMeters,
    atmosphereBottomRadiusWorld: atmosphereBottomRadiusMeters * worldUnitsPerMeter,
    atmosphereTopRadiusWorld: atmosphereTopRadiusMeters * worldUnitsPerMeter,
    centerWorld: Object.freeze([...centerWorld]),
    orientationWorldFromBody: Object.freeze(orientation.toArray()),
    bodyToWorldMatrix: Object.freeze(bodyToWorld.toArray()),
    worldToBodyMatrix: Object.freeze(worldToBody.toArray()),
    bodyToWorldPoint(bodyPointWorldUnits) {
      finiteVector(bodyPointWorldUnits, 3, "body point");
      return new Vector3().fromArray(bodyPointWorldUnits).applyMatrix4(bodyToWorld).toArray();
    },
    worldToBodyPoint(worldPoint) {
      return worldPointToBodyWorld(worldPoint).toArray();
    },
    worldToEcefMeters(worldPoint) {
      return worldPointToBodyWorld(worldPoint).multiplyScalar(1 / worldUnitsPerMeter).toArray();
    },
    altitudeMetersAtWorld(worldPoint) {
      return worldPointToBodyWorld(worldPoint).length() / worldUnitsPerMeter - surfaceRadiusMeters;
    },
    upAtWorld(worldPoint) {
      const bodyPoint = worldPointToBodyWorld(worldPoint);
      if (bodyPoint.lengthSq() === 0) throw new Error("planet up is undefined at the body center");
      return bodyPoint.normalize().applyQuaternion(orientation).toArray();
    },
    serializable() {
      return {
        schemaVersion: 1,
        referenceSurface: "sphere",
        worldUnitsPerMeter,
        metresPerWorldUnit: 1 / worldUnitsPerMeter,
        surfaceRadiusMeters,
        surfaceRadiusWorld: surfaceRadiusMeters * worldUnitsPerMeter,
        atmosphereBottomRadiusMeters,
        atmosphereTopRadiusMeters,
        atmosphereBottomRadiusWorld: atmosphereBottomRadiusMeters * worldUnitsPerMeter,
        atmosphereTopRadiusWorld: atmosphereTopRadiusMeters * worldUnitsPerMeter,
        centerWorld: [...centerWorld],
        orientationWorldFromBody: orientation.toArray(),
        bodyToWorldMatrix: bodyToWorld.toArray(),
        worldToBodyMatrix: worldToBody.toArray(),
      };
    },
  });
}

/**
 * Renderer/output-neutral adapter for Weathered World. The host injects its
 * sole renderer, scene, camera, pipeline, units, and time/weather envelope.
 */
export function createPlanetSceneAdapter({
  renderer,
  scene,
  camera,
  pipeline,
  worldUnitsPerMeter = 0.001,
  bodyFrame = null,
  weather = null,
  tier = "balanced",
  preset = "pelagia",
  seed = 1,
  renderTargetHeightPx = 1080,
} = {}) {
  if (!renderer || !scene || !camera || !pipeline) {
    throw new Error("planet integration adapter requires host renderer, scene, camera, and pipeline");
  }
  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("planet integration adapter requires an initialized native WebGPU renderer");
  }
  const cameraPositionWorld = new Vector3();
  let subject = null;
  let disposed = false;
  let rebuildCount = 0;

  function cameraBodyPosition(handoff) {
    camera.updateMatrixWorld?.(true);
    camera.getWorldPosition?.(cameraPositionWorld) ?? cameraPositionWorld.copy(camera.position);
    return handoff.worldToBodyPoint(cameraPositionWorld.toArray());
  }

  function createSubject() {
    const preliminary = createPlanetRuntimeConfiguration({
      tier,
      preset,
      seed,
      worldUnitsPerMeter,
    });
    const handoff = createPlanetAtmosphereHandoff({
      config: preliminary.config,
      worldUnitsPerMeter,
      bodyFrame: bodyFrame ?? undefined,
    });
    const runtime = createPlanetRuntimeFrontier({
      tier,
      preset,
      seed,
      worldUnitsPerMeter,
      cameraPositionBody: cameraBodyPosition(handoff),
      verticalFovRadians: (camera.fov ?? 42) * Math.PI / 180,
      renderTargetHeightPx,
      cameraNear: camera.near ?? 1,
    });
    const atlas = createPlanetFieldAtlas({
      patches: runtime.patches,
      preset: runtime.config.preset,
      seed,
      tileSide: runtime.tierConfig.gridSide,
    });
    const mesh = createPlanetPatchMesh({
      tier,
      preset,
      seed,
      worldUnitsPerMeter,
      patches: runtime.patches,
      atlas,
    });
    mesh.position.fromArray(handoff.centerWorld);
    mesh.quaternion.fromArray(handoff.orientationWorldFromBody);
    mesh.updateMatrixWorld(true);
    const patchBounds = createPatchBoundsCompute({
      patches: runtime.patches,
      radiusWorld: runtime.radiusWorld,
      maximumDisplacementWorld: runtime.maximumDisplacementWorld,
      maximumSurfaceSlope: runtime.tierConfig.maximumSurfaceSlope,
      gridSide: runtime.tierConfig.gridSide,
    });
    atlas.dispatch(renderer, { patchIds: null });
    patchBounds.dispatch(renderer);
    scene.add(mesh);
    rebuildCount += 1;
    return {
      runtime,
      handoff,
      atlas,
      patchBounds,
      mesh,
      signature: frontierSignature(runtime.patches),
    };
  }

  function destroySubject() {
    if (!subject) return;
    scene.remove(subject.mesh);
    subject.patchBounds.dispose();
    subject.atlas.dispose();
    disposePlanetPatchMesh(subject.mesh);
    subject = null;
  }

  subject = createSubject();

  return {
    get mesh() { return subject.mesh; },
    get atlas() { return subject.atlas; },
    get atmosphereHandoff() { return subject.handoff; },
    update({ time = weather?.time ?? 0, updateLod = true } = {}) {
      if (disposed) throw new Error("planet integration adapter is disposed");
      setPlanetMaterialMode(subject.mesh, { time });
      if (!updateLod) return { rebuilt: false };
      const next = createPlanetRuntimeFrontier({
        tier,
        preset,
        seed,
        worldUnitsPerMeter,
        cameraPositionBody: cameraBodyPosition(subject.handoff),
        verticalFovRadians: (camera.fov ?? 42) * Math.PI / 180,
        renderTargetHeightPx,
        cameraNear: camera.near ?? 1,
      });
      const nextSignature = frontierSignature(next.patches);
      if (nextSignature === subject.signature) return { rebuilt: false };
      destroySubject();
      subject = createSubject();
      setPlanetMaterialMode(subject.mesh, { time });
      return { rebuilt: true, patchCount: subject.runtime.patches.length };
    },
    describeOwnership() {
      return {
        owns: [
          "planet body-frame geometry",
          "camera-projected quadtree frontier",
          "planet field storage atlas",
          "analytic patch bounds compute",
        ],
        consumes: ["host renderer", "host camera", "host pipeline", "shared time"],
        doesNotOwn: ["renderer", "camera", "atmosphere transport", "weather", "tone map", "output transform"],
        atmosphereHandoff: subject.handoff.serializable(),
      };
    },
    describeResources() {
      return {
        geometry: subject.mesh.userData.resources,
        atlas: subject.atlas.describe(),
        patchBounds: subject.patchBounds.describe(),
        patchCount: subject.runtime.patches.length,
        rebuildCount,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      destroySubject();
    },
  };
}
