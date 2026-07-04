import {
  DataTexture,
  PerspectiveCamera,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three/webgpu";
import {
  assertCurvedRayTransformContract,
  configureColorTexture,
  createCurvedRayAccretionMesh,
  createSeededNoiseTexture,
  evaluateCurvedRayTransformContract,
} from "./curved-ray-accretion.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeMesh() {
  const mesh = createCurvedRayAccretionMesh({
    noiseTexture: createSeededNoiseTexture({ size: 1 }),
    starTexture: configureColorTexture(
      new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType),
      { mipmaps: false },
    ),
  });
  mesh.updateWorldMatrix(true, false);
  return mesh;
}

function disposeMesh(mesh) {
  mesh.geometry.dispose();
  mesh.material.userData.curvedRayTextures?.noiseTexture?.dispose?.();
  mesh.material.userData.curvedRayTextures?.starTexture?.dispose?.();
  mesh.material.dispose();
}

const camera = new PerspectiveCamera(55, 1, 0.01, 100);
camera.position.set(0, 0.15, 2.4);
camera.updateWorldMatrix(true, false);

const moved = makeMesh();
moved.position.set(3, -2, 7);
moved.updateWorldMatrix(true, false);
const movedContract = assertCurvedRayTransformContract(moved, { camera });
assert(movedContract.valid === true, "Moved proxy volume should preserve the local metric.");
assert(movedContract.localCameraDistance > 0, "Moved proxy must produce a finite local camera distance.");

const uniform = makeMesh();
uniform.position.set(-4, 1, 2);
uniform.scale.setScalar(12);
uniform.updateWorldMatrix(true, false);
const uniformContract = assertCurvedRayTransformContract(uniform, { cameraPosition: new Vector3(-4, 1, 26) });
assert(Math.abs(uniformContract.scaleRatio - 1) < 1e-6, "Uniform scale must keep a 1:1 local metric ratio.");
assert(Math.abs(uniformContract.localCameraPosition.z - 2) < 1e-6, "Uniform scale should map world distance to local units.");

const nonuniform = makeMesh();
nonuniform.scale.set(1, 2, 1);
nonuniform.updateWorldMatrix(true, false);
const nonuniformContract = evaluateCurvedRayTransformContract(nonuniform, { camera });
assert(nonuniformContract.valid === false, "Nonuniform proxy scale must be rejected.");
assert(
  nonuniformContract.reasons.some((reason) => reason.includes("nonuniform proxy scale")),
  "Nonuniform rejection must name the metric problem.",
);

const farOrigin = makeMesh();
farOrigin.position.set(1000000, -750000, 500000);
farOrigin.scale.setScalar(250);
farOrigin.updateWorldMatrix(true, false);
const farCamera = new Vector3(1000000, -750000, 500750);
const farContract = assertCurvedRayTransformContract(farOrigin, { cameraPosition: farCamera });
assert(farContract.farOriginNotice === true, "Far-origin fixture should be flagged for camera-relative/floating-origin review.");
assert(Math.abs(farContract.localCameraPosition.z - 3) < 1e-6, "Far-origin local transform must remain stable in local units.");

for (const mesh of [moved, uniform, nonuniform, farOrigin]) {
  disposeMesh(mesh);
}

console.log(JSON.stringify({
  pass: true,
  moved: {
    localCameraDistance: movedContract.localCameraDistance,
  },
  uniformScale: {
    scaleRatio: uniformContract.scaleRatio,
    localCameraZ: uniformContract.localCameraPosition.z,
  },
  nonuniformScale: {
    rejected: nonuniformContract.valid === false,
    reasons: nonuniformContract.reasons,
  },
  farOrigin: {
    notice: farContract.farOriginNotice,
    originDistance: farContract.originDistance,
    localCameraZ: farContract.localCameraPosition.z,
  },
}, null, 2));
