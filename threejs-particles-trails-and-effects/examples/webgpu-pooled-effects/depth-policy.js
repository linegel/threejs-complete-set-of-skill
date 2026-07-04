import { Box3, Vector3 } from "three";

export const DEPTH_POLICY = [
  "Hull plasma shell: depthTest true, depthWrite false, softDepthFade against depth texture, render after hull.",
  "Wake core: depthTest true, depthWrite false, softDepthFade on occluder intersections.",
  "Wake haze and shear lobes: depthTest true by default; tier down before ignoring unrelated occluder geometry.",
  "Sparks and shock flecks: depthTest true, depthWrite false, camera-facing sprites, not WebGPU point-size primitives.",
  "Opaque debris: depthTest true, depthWrite true, computeBounds per live chunk.",
];

export function softDepthFade({ sceneDepthMeters, effectDepthMeters, fadeMeters = 0.75 }) {
  const separation = sceneDepthMeters - effectDepthMeters;
  return Math.min(Math.max(separation / fadeMeters, 0), 1);
}

export function computeBounds(instances, { radius = 0.5 } = {}) {
  const bounds = new Box3();
  const point = new Vector3();
  bounds.makeEmpty();

  for (const instance of instances) {
    point.fromArray(instance.position);
    bounds.expandByPoint(point);
  }

  if (!bounds.isEmpty()) bounds.expandByScalar(radius);
  return bounds;
}

export function validateDepthPolicy() {
  return DEPTH_POLICY.every((line) => line.includes("depthTest"));
}
