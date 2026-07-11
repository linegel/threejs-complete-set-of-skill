import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import {
  abs,
  clamp,
  color,
  dot,
  float,
  mix,
  normalView,
  normalWorld,
  normalize,
  positionLocal,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

import { createReentryShell } from "./reentry-shell.js";

const forwardAxis = new Vector3(0, 0, -1);
const VISUAL_TIER_LIMITS = Object.freeze({
  ultra: { shellLayers: 5, wakeFamilies: 3, fieldOctaves: 3 },
  high: { shellLayers: 4, wakeFamilies: 2, fieldOctaves: 2 },
  medium: { shellLayers: 2, wakeFamilies: 1, fieldOctaves: 1 },
});

function heatToColorNode(heat) {
  const residue = vec3(0.35, 0.008, 0.001);
  const orange = vec3(4.5, 0.28, 0.015);
  const whiteHot = vec3(32, 9, 1.6);
  const ion = vec3(48, 21, 60);
  const low = mix(residue, orange, smoothstep(0.0, 0.55, heat));
  const high = mix(whiteHot, ion, smoothstep(0.75, 1.25, heat));
  return mix(low, high, smoothstep(0.45, 0.8, heat));
}

function makeWakeMaterial({ role, opacity, emissionScale }) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const roleColor = role === "core"
    ? vec3(15, 2.6, 0.15)
    : role === "haze"
      ? vec3(1.7, 0.16, 2.8)
      : vec3(0.28, 0.8, 3.5);
  material.colorNode = roleColor.mul(emissionScale * 0.06);
  material.emissiveNode = roleColor.mul(emissionScale);
  material.opacityNode = float(opacity);
  material.userData.effectRole = role;
  material.userData.rawHDR = true;
  return material;
}

/**
 * Builds actual depth-tested hull, shell, wake-core, haze, and shear-lobe
 * render objects. All parts use one normalized downstream flow vector and the
 * support-point origin derived from the transformed hull samples.
 */
export function createReentryEffectVisuals({
  tier = "high",
  flowDirectionWorld = [0, 0, -1],
  hullGeometry = new BoxGeometry(1.2, 0.7, 3.8),
} = {}) {
  const limits = VISUAL_TIER_LIMITS[tier];
  if (!limits) throw new RangeError(`Unknown reentry visual tier: ${tier}`);
  const group = new Group();
  group.name = "reentry-shell-and-wake";
  const hullMaterial = new MeshStandardNodeMaterial({
    color: new Color(0x242a33),
    roughness: 0.42,
    metalness: 0.78,
  });
  hullMaterial.colorNode = color(0x242a33);
  hullMaterial.emissiveNode = vec3(0);
  const hull = new Mesh(hullGeometry, hullMaterial);
  hull.name = "reentry-hull";
  hull.castShadow = true;
  hull.receiveShadow = true;
  hull.updateMatrixWorld(true);
  group.add(hull);

  const shellContract = createReentryShell({
    hullGeometry,
    matrixWorld: hull.matrixWorld,
    flowDirectionWorld,
    tier,
  });
  const flowUniform = uniform(
    new Vector3().fromArray(shellContract.flowDirectionWorld).normalize(),
    "vec3",
  ).setName("reentryFlowDirectionWorld");
  const timeUniform = uniform(0).setName("reentryVisualTime");
  const facing = clamp(dot(normalize(normalWorld), flowUniform.negate()), 0, 1);
  const facingMask = smoothstep(0.18, 0.96, facing);
  const viewCosine = clamp(
    abs(dot(normalize(normalView), normalize(positionViewDirection))),
    0,
    1,
  );
  const rim = pow(float(1).sub(viewCosine), 2);
  let field = float(0);
  for (let octave = 0; octave < limits.fieldOctaves; octave += 1) {
    const frequency = 2 ** octave;
    const phase = dot(
      positionLocal,
      vec3(1.73 * frequency, 2.41 * frequency, 0.91 * frequency),
    ).add(timeUniform.mul(1.4 + octave * 0.73));
    field = field.add(sin(phase).mul(0.055 / frequency));
  }
  const heat = clamp(facingMask.mul(0.82).add(rim.mul(0.28)).add(field), 0, 1.25);
  const shellMaterial = new MeshPhysicalNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    roughness: 0.22,
    metalness: 0,
  });
  shellMaterial.colorNode = heatToColorNode(heat).mul(0.08 / limits.shellLayers);
  shellMaterial.emissiveNode = heatToColorNode(heat).div(limits.shellLayers);
  shellMaterial.opacityNode = smoothstep(0.05, 0.5, heat)
    .mul(0.92 / Math.sqrt(limits.shellLayers));
  shellMaterial.userData.effectRole = "hull-shell";
  shellMaterial.userData.rawHDR = true;
  shellMaterial.userData.rimContract = "view-dependent abs(dot(normalView, positionViewDirection))";
  const shellGeometry = hullGeometry.clone();
  const hullShells = [];
  for (let layer = 0; layer < limits.shellLayers; layer += 1) {
    const hullShell = new Mesh(shellGeometry, shellMaterial);
    hullShell.name = `hull-conforming-plasma-shell-${layer}`;
    hullShell.castShadow = false;
    hullShell.scale.setScalar(1.008 + layer * 0.006);
    hullShells.push(hullShell);
    group.add(hullShell);
  }
  const hullShell = hullShells[0];

  const support = new Vector3().fromArray(shellContract.supportPoint);
  const flow = new Vector3().fromArray(shellContract.flowDirectionWorld).normalize();
  const wakeRotation = new Quaternion().setFromUnitVectors(forwardAxis, flow);
  const roles = [
    ["wakeCore", "core", 0.76, 1],
    ["wakeHaze", "haze", 0.22, 0.42],
    ["shearLobe", "shear", 0.3, 0.62],
  ];
  const wakeMeshes = [];
  let disposed = false;
  for (const [contractName, visualRole, opacity, emissionScale] of roles.slice(0, limits.wakeFamilies)) {
    const contract = shellContract.roles[contractName];
    const mesh = new Mesh(
      contract.geometry,
      makeWakeMaterial({ role: visualRole, opacity, emissionScale }),
    );
    mesh.name = `reentry-${visualRole}`;
    mesh.castShadow = false;
    mesh.position.copy(support);
    mesh.quaternion.copy(wakeRotation);
    mesh.frustumCulled = true;
    wakeMeshes.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    hull,
    hullShell,
    hullShells,
    wakeMeshes,
    shellContract,
    flowDirectionWorld: flow,
    supportPoint: support,
    update(timeSeconds) {
      timeUniform.value = timeSeconds;
    },
    describe() {
      return {
        roles: ["opaque-hull", "hull-shell", "wake-core", "wake-haze", "shear-lobe"],
        supportPoint: support.toArray(),
        flowDirectionWorld: flow.toArray(),
        shellLayers: hullShells.length,
        wakeFamilies: wakeMeshes.length,
        fieldOctaves: limits.fieldOctaves,
        depthTestedTransparentRoles: wakeMeshes.length + hullShells.length,
        bloomIndependentReadability: true,
      };
    },
    dispose() {
      if (disposed) return;
      const geometries = new Set();
      const materials = new Set();
      group.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      for (const role of Object.values(shellContract.roles)) {
        if (role.geometry) geometries.add(role.geometry);
      }
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      disposed = true;
    },
  };
}
