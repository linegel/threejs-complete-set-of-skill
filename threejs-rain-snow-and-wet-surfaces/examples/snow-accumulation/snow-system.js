// Legacy WebGL implementation (deprecated, do not extend). The active
// WebGPU/TSL contract lives in ../webgpu-rain-snow-and-wet-surfaces/.
import * as THREE from "three";

export const snowDebugModes = new Map([
  ["final", 0],
  ["snowMask", 1],
  ["snowNormals", 2],
  ["sparkle", 3],
  ["lake", 4],
]);

export function createSharedWeatherUniforms({
  wind = new THREE.Vector3(1.2, 0, 0.5),
} = {}) {
  return {
    uTime: { value: 0 },
    uWind: { value: wind.clone() },
  };
}

export function createSnow({ camera, sharedUniforms, maxCount = 30000 }) {
  const geometry = new THREE.InstancedBufferGeometry();

  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const aSeed = new Float32Array(maxCount * 3);
  const aRand = new Float32Array(maxCount);
  const random = (() => {
    let state = 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();
  for (let i = 0; i < maxCount; i++) {
    aSeed[i * 3 + 0] = random();
    aSeed[i * 3 + 1] = random();
    aSeed[i * 3 + 2] = random();
    aRand[i] = random();
  }
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(aSeed, 3));
  geometry.setAttribute("aRand", new THREE.InstancedBufferAttribute(aRand, 1));

  const uniforms = {
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uCameraPos: { value: new THREE.Vector3() },
    uVolume: { value: new THREE.Vector3(50, 40, 50) },
    uSpeed: { value: 3.2 },
    uSize: { value: 0.07 },
    uSway: { value: 0.5 },
    uOpacity: { value: 0.9 },
    uColor: { value: new THREE.Color(0xffffff) },
    uDebugMode: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      uniform float uTime;
      uniform vec3  uWind;
      uniform vec3  uCameraPos;
      uniform vec3  uVolume;
      uniform float uSpeed;
      uniform float uSize;
      uniform float uSway;

      attribute vec3  aSeed;
      attribute float aRand;

      varying vec2  vUv;
      varying float vRand;

      void main() {
        vUv = uv;
        vRand = aRand;

        vec3 vol = uVolume;
        vec3 origin = uCameraPos - vec3(vol.x * 0.5, vol.y * 0.4, vol.z * 0.5);

        float speed = uSpeed * (0.6 + 0.7 * aRand);
        vec3 base = aSeed * vol;

        float phase = aRand * 6.2831853;
        float t = uTime;
        vec3 sway = vec3(
          sin(t * 0.7 + phase) + 0.35 * sin(t * 1.6 + phase * 1.7),
          0.0,
          cos(t * 0.6 + phase) + 0.35 * cos(t * 1.3 + phase * 1.3)
        ) * uSway * (0.4 + 0.6 * aRand);

        vec3 disp = vec3(uWind.x, -speed, uWind.z) * t + sway;
        vec3 pos = mod(base + disp - origin, vol) + origin;

        float size = uSize * (0.5 + 1.0 * aRand);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = pos + right * (position.x * size) + up * (position.y * size);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3  uColor;
      uniform int   uDebugMode;

      varying vec2  vUv;
      varying float vRand;

      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(1.0, 0.1, d);
        float core = smoothstep(0.6, 0.0, d) * 0.5;
        float alpha = (disc + core) * uOpacity * (0.55 + 0.45 * vRand);
        if (alpha < 0.001) discard;
        vec3 color = uDebugMode == 3 ? vec3(vRand, 1.0 - vRand, 1.0) : uColor;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  geometry.instanceCount = Math.floor(maxCount * 0.5);

  return {
    mesh,
    material,
    uniforms,
    maxCount,
    update() {
      uniforms.uCameraPos.value.copy(camera.position);
    },
    setDensity(fraction) {
      geometry.instanceCount = Math.max(
        1,
        Math.floor(THREE.MathUtils.clamp(fraction, 0, 1) * maxCount),
      );
    },
    setDebugMode(mode) {
      uniforms.uDebugMode.value = snowDebugModes.get(mode) ?? 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export const NOISE_FUNCTIONS = `
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return value;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
`;

export function createSnowUniforms(sharedUniforms) {
  return {
    uSnowScale: { value: 0.16 },
    uSnowSeed: { value: new THREE.Vector2(8.3, 2.1) },
    uSnowCoverage: { value: 0.7 },
    uSnowEdge: { value: 0.12 },
    uSnowColor: { value: new THREE.Color(0xeaf1ff) },
    uSnowRoughness: { value: 0.82 },
    uSnowDepth: { value: 0.9 },
    uSnowBumpScale: { value: 0.7 },
    uSnowBumpStrength: { value: 0.6 },
    uSparkle: { value: 0.5 },
    uSparkleScale: { value: 90.0 },
    uTime: sharedUniforms.uTime,
    uWind: sharedUniforms.uWind,
    uDebugMode: { value: 0 },
  };
}

export function createLakeUniforms() {
  return {
    uLakeEnabled: { value: 0 },
    uLakeCenter: { value: new THREE.Vector2(0, 0) },
    uLakeRadius: { value: 3.2 },
    uLakeEdge: { value: 0.25 },
    uLakeShapeAmp: { value: 0.08 },
    uLakeShapeFreq: { value: 3.0 },
    uLakeSeed: { value: 0.0 },
    uLakeDepth: { value: 0.42 },
    uLakeBedColor: { value: new THREE.Color(0x33b1ff) },
  };
}

export const SNOW_FUNCTIONS = `
uniform float uSnowScale;
uniform vec2  uSnowSeed;
uniform float uSnowCoverage;
uniform float uSnowEdge;
uniform vec3  uSnowColor;
uniform float uSnowRoughness;
uniform float uSnowDepth;
uniform float uSnowBumpScale;
uniform float uSnowBumpStrength;
uniform float uSparkle;
uniform float uSparkleScale;
uniform float uTime;
uniform vec3  uWind;
uniform int   uDebugMode;

float snowMaskAt(vec2 worldXZ) {
  vec2 p = worldXZ * uSnowScale + uSnowSeed;
  float n = fbm(p) * 0.5 + 0.5;
  float threshold = 1.0 - uSnowCoverage;
  return smoothstep(threshold - uSnowEdge, threshold + uSnowEdge, n);
}

float snowHeightAt(vec2 worldXZ) {
  float mask = snowMaskAt(worldXZ);
  float drift = fbm(worldXZ * uSnowBumpScale) * 0.5 + 0.5;
  float h = mask * (1.0 - 0.4 * uSnowBumpStrength + 0.4 * uSnowBumpStrength * drift);
  vec2 edge = smoothstep(10.0, 8.0, abs(worldXZ));
  return uSnowDepth * h * edge.x * edge.y;
}
`;

export const LAKE_FUNCTIONS = `
uniform float uLakeEnabled;
uniform vec2  uLakeCenter;
uniform float uLakeRadius;
uniform float uLakeEdge;
uniform float uLakeShapeAmp;
uniform float uLakeShapeFreq;
uniform float uLakeSeed;
uniform float uLakeDepth;
uniform vec3  uLakeBedColor;

float lakeRadiusAt(float ang) {
  float w  = 1.00 * sin(ang * uLakeShapeFreq + uLakeSeed);
  w       += 0.50 * sin(ang * (uLakeShapeFreq * 2.0 + 1.0) - uLakeSeed * 1.3);
  w       += 0.25 * sin(ang * (uLakeShapeFreq * 3.0 + 2.0) + uLakeSeed * 2.1);
  w /= 1.75;
  return uLakeRadius * (1.0 + uLakeShapeAmp * w);
}

float lakeInsideAt(vec2 worldXZ) {
  if (uLakeEnabled < 0.5) return 0.0;
  vec2  d = worldXZ - uLakeCenter;
  float r = length(d);
  float R = lakeRadiusAt(atan(d.y, d.x));
  float edge = R * uLakeEdge + 0.001;
  return 1.0 - smoothstep(R - edge, R + edge, r);
}

float lakeDepth01(vec2 worldXZ) {
  return smoothstep(0.0, 0.82, lakeInsideAt(worldXZ));
}
`;

export const GROUND_FUNCTIONS = `
float groundHeightAt(vec2 worldXZ) {
  float inside = lakeInsideAt(worldXZ);
  float snow = snowHeightAt(worldXZ) * (1.0 - inside);
  float basin = uLakeDepth * lakeDepth01(worldXZ);
  return snow - basin;
}

vec3 groundSurfaceNormal(vec2 worldXZ) {
  float e = 0.08;
  float h0 = groundHeightAt(worldXZ);
  float hx = groundHeightAt(worldXZ + vec2(e, 0.0));
  float hz = groundHeightAt(worldXZ + vec2(0.0, e));
  vec2 grad = vec2(hx - h0, hz - h0) / e;
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}
`;

export const GROUND_INJECT =
  NOISE_FUNCTIONS + SNOW_FUNCTIONS + LAKE_FUNCTIONS + GROUND_FUNCTIONS;

export function applySnowToGroundMaterial(material, {
  snowUniforms,
  lakeUniforms,
} = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, snowUniforms, lakeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPosition;\n" + GROUND_INJECT,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      vec2 groundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
      transformed += normalize(objectNormal) * groundHeightAt(groundXZ);
      vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPosition;\n" + GROUND_INJECT,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
      float lakeIn = lakeInsideAt(vWorldPosition.xz);
      float snowMask = snowMaskAt(vWorldPosition.xz) * (1.0 - lakeIn);
      float snowShade = 0.85 + 0.15 * (fbm(vWorldPosition.xz * uSnowBumpScale * 2.0) * 0.5 + 0.5);
      vec3 snowAlbedo = uSnowColor * snowShade;
      float sp = hash21(floor(vWorldPosition.xz * uSparkleScale));
      float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + sp * 30.0);
      float sparkle = step(0.985, sp) * twinkle * uSparkle;
      snowAlbedo += sparkle;
      vec3 bed = uLakeBedColor * (1.0 - 0.6 * lakeDepth01(vWorldPosition.xz));
      if (uDebugMode == 1) {
        diffuseColor.rgb = vec3(snowMask);
      } else if (uDebugMode == 2) {
        diffuseColor.rgb = groundSurfaceNormal(vWorldPosition.xz) * 0.5 + 0.5;
      } else if (uDebugMode == 3) {
        diffuseColor.rgb = vec3(sparkle);
      } else if (uDebugMode == 4) {
        diffuseColor.rgb = mix(vec3(lakeIn), bed, lakeIn);
      } else {
        diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, snowMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, bed, lakeIn);
      }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, uSnowRoughness, snowMask);
      roughnessFactor = mix(roughnessFactor, 0.08, sparkle * snowMask);
      roughnessFactor = mix(roughnessFactor, 0.55, lakeIn);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
      vec3 gN = groundSurfaceNormal(vWorldPosition.xz);
      vec3 gView = normalize((viewMatrix * vec4(gN, 0.0)).xyz);
      float surfaceBlend = clamp(snowMask + lakeIn, 0.0, 1.0);
      normal = normalize(mix(normal, gView, surfaceBlend));`,
      );
  };
  material.customProgramCacheKey = () => "precipitation-snow-ground-v1";
  material.needsUpdate = true;
  return material;
}

export function createSnowyGroundMaterial({
  maps = {},
  sharedUniforms,
  lakeUniforms = createLakeUniforms(),
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    map: maps.map ?? null,
    aoMap: maps.aoMap ?? null,
    roughnessMap: maps.roughnessMap ?? null,
    normalMap: maps.normalMap ?? null,
    displacementMap: maps.displacementMap ?? null,
    normalMapType: THREE.TangentSpaceNormalMap,
    roughness: 1.0,
    metalness: 0.0,
    aoMapIntensity: 1.0,
    normalScale: new THREE.Vector2(1, 1),
    displacementScale: 0.0,
    displacementBias: 0.0,
    envMapIntensity: 1.0,
  });
  const snowUniforms = createSnowUniforms(sharedUniforms);
  applySnowToGroundMaterial(material, { snowUniforms, lakeUniforms });
  material.userData.snowUniforms = snowUniforms;
  material.userData.lakeUniforms = lakeUniforms;
  return material;
}

export const MODEL_SNOW_GLSL = `
varying vec3 vWorldNormalW;
varying vec3 vModelPosW;
uniform float uTime;
uniform mat4  uModelInv;
uniform vec2  uSnowSeed;
uniform float uSnowScale;
uniform float uSnowCoverage;
uniform float uSnowEdge;
uniform float uSnowThickness;
uniform float uSnowFlatThreshold;
uniform vec3  uSnowColor;
uniform float uSnowRoughness;
uniform float uSnowSparkle;
uniform float uSnowSparkleScale;
uniform float uSnowBump;
uniform float uSnowBumpScale;

${NOISE_FUNCTIONS}

float snowCoverageMask(vec2 worldXZ) {
  float n = fbm(worldXZ * uSnowScale + uSnowSeed) * 0.5 + 0.5;
  float threshold = 1.0 - uSnowCoverage;
  return smoothstep(threshold - uSnowEdge, threshold + uSnowEdge, n);
}

float snowAccumAt(vec3 worldNormal, vec2 worldXZ) {
  float up = clamp(worldNormal.y, 0.0, 1.0);
  float top = smoothstep(uSnowFlatThreshold, 1.0, up);
  return top * snowCoverageMask(worldXZ);
}

vec3 snowReliefNormal(vec2 worldXZ) {
  float e = 0.04;
  float h0 = fbm(worldXZ * uSnowBumpScale);
  float hx = fbm(worldXZ * uSnowBumpScale + vec2(e, 0.0));
  float hz = fbm(worldXZ * uSnowBumpScale + vec2(0.0, e));
  vec2 grad = vec2(hx - h0, hz - h0) / e;
  return normalize(vec3(-grad.x * uSnowBump, 1.0, -grad.y * uSnowBump));
}
`;

export function createModelSnowUniforms(sharedUniforms) {
  return {
    uTime: sharedUniforms.uTime,
    uModelInv: { value: new THREE.Matrix4() },
    uSnowSeed: { value: new THREE.Vector2(3.0, 7.0) },
    uSnowScale: { value: 0.9 },
    uSnowCoverage: { value: 0.7 },
    uSnowEdge: { value: 0.15 },
    uSnowThickness: { value: 0.06 },
    uSnowFlatThreshold: { value: 0.35 },
    uSnowColor: { value: new THREE.Color(0xeaf1ff) },
    uSnowRoughness: { value: 0.85 },
    uSnowSparkle: { value: 0.5 },
    uSnowSparkleScale: { value: 120.0 },
    uSnowBump: { value: 0.4 },
    uSnowBumpScale: { value: 3.0 },
  };
}

export function applySnowToModelMaterial(material, snowUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, snowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + MODEL_SNOW_GLSL)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nvWorldNormalW = normalize(mat3(modelMatrix) * objectNormal);",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          vec3 wPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vModelPosW = (uModelInv * vec4(wPos, 1.0)).xyz;
          vec3 wN = mat3(modelMatrix) * objectNormal;
          float ms = max(length(wN), 1e-4);
          float accum = snowAccumAt(wN / ms, vModelPosW.xz);
          transformed += normalize(objectNormal) * (uSnowThickness * accum / ms);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + MODEL_SNOW_GLSL)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
          vec3 wn = normalize(vWorldNormalW);
          float snowAmt = snowAccumAt(wn, vModelPosW.xz);
          float shade = 0.85 + 0.15 * (fbm(vModelPosW.xz * uSnowBumpScale * 2.0) * 0.5 + 0.5);
          vec3 snowCol = uSnowColor * shade;
          float sp = hash21(floor(vModelPosW.xz * uSnowSparkleScale));
          float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + sp * 30.0);
          float sparkle = step(0.985, sp) * twinkle * uSnowSparkle;
          snowCol += sparkle;
          diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowAmt);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, uSnowRoughness, snowAmt);
          roughnessFactor = mix(roughnessFactor, 0.08, sparkle * snowAmt);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
          vec3 sN = snowReliefNormal(vModelPosW.xz);
          vec3 sView = normalize((viewMatrix * vec4(sN, 0.0)).xyz);
          normal = normalize(mix(normal, sView, snowAmt));`,
      );
  };
  material.customProgramCacheKey = () => "precipitation-snow-model-v1";
  material.needsUpdate = true;
}

export function createFrozenLake({
  lakeUniforms,
  sharedUniforms,
  sunDir,
  sunColor,
}) {
  const iceLevel = 0.04;
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: sunDir.clone().normalize() },
    uSunColor: { value: sunColor.clone() },
    uIceOpacity: { value: 1.0 },
    uShallowColor: { value: new THREE.Color(0x9fc6d8) },
    uDeepColor: { value: new THREE.Color(0x184762) },
    uReflectColor: { value: new THREE.Color(0xafc4e0) },
    uReflectStrength: { value: 0.8 },
    uFresnelPower: { value: 3.5 },
    uSurfaceRipple: { value: 0.25 },
    uRippleScale: { value: 0.5 },
    uCrackAmount: { value: 0.31 },
    uCrackScale: { value: 0.3 },
    uFrost: { value: 0.6 },
    uFrostWidth: { value: 0.74 },
    uBubbleAmount: { value: 0.12 },
    uBubbleScale: { value: 29.5 },
    uGlint: { value: 0.7 },
  };
  Object.assign(uniforms, lakeUniforms);
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime;
      uniform vec3  uCameraPos;
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform float uIceOpacity;
      uniform vec3  uShallowColor;
      uniform vec3  uDeepColor;
      uniform vec3  uReflectColor;
      uniform float uReflectStrength;
      uniform float uFresnelPower;
      uniform float uSurfaceRipple;
      uniform float uRippleScale;
      uniform float uCrackAmount;
      uniform float uCrackScale;
      uniform float uFrost;
      uniform float uFrostWidth;
      uniform float uBubbleAmount;
      uniform float uBubbleScale;
      uniform float uGlint;
      ${NOISE_FUNCTIONS}
      ${LAKE_FUNCTIONS}
      void main() {
        vec2 xz = vWorldPos.xz;
        float inside = lakeInsideAt(xz);
        if (inside <= 0.002) discard;
        float depth01 = lakeDepth01(xz);
        float e = 0.1;
        float h0 = fbm(xz * uRippleScale);
        float hx = fbm(xz * uRippleScale + vec2(e, 0.0));
        float hz = fbm(xz * uRippleScale + vec2(0.0, e));
        vec2 g = vec2(hx - h0, hz - h0) / e;
        vec3 N = normalize(vec3(-g.x * uSurfaceRipple, 1.0, -g.y * uSurfaceRipple));
        vec3 V = normalize(uCameraPos - vWorldPos);
        vec3 baseCol = mix(uShallowColor, uDeepColor, depth01);
        float cr = abs(fbm(xz * uCrackScale + 11.0));
        float cracks = (1.0 - smoothstep(0.0, 0.05, cr)) * uCrackAmount;
        baseCol += cracks * 0.6;
        float bh = hash21(floor(xz * uBubbleScale));
        float bubbles = step(0.93, bh) * uBubbleAmount * (0.3 + 0.7 * depth01);
        baseCol += bubbles * 0.5;
        float frost = (1.0 - smoothstep(0.0, uFrostWidth, depth01)) * uFrost;
        baseCol = mix(baseCol, vec3(0.95, 0.97, 1.0), frost);
        float fres = pow(1.0 - max(dot(N, V), 0.0), uFresnelPower);
        vec3 refl = reflect(-V, N);
        vec3 sky = mix(uReflectColor * 0.45, uReflectColor, clamp(refl.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 col = mix(baseCol, sky, fres * uReflectStrength);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 200.0);
        col += uSunColor * spec * uGlint;
        float edgeFeather = smoothstep(0.0, 0.05, inside);
        float alpha = uIceOpacity * mix(0.4, 0.92, depth01);
        alpha = max(alpha, fres * uReflectStrength);
        alpha = clamp(alpha + frost * 0.5 + cracks * 0.4, 0.0, 1.0) * edgeFeather;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const geometry = new THREE.CircleGeometry(1, 96);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  function applyShape() {
    const c = lakeUniforms.uLakeCenter.value;
    const maxR =
      lakeUniforms.uLakeRadius.value *
        (1.0 + lakeUniforms.uLakeShapeAmp.value) +
      0.5;
    mesh.position.set(c.x, iceLevel, c.y);
    mesh.scale.set(maxR, maxR, 1);
    mesh.visible = lakeUniforms.uLakeEnabled.value > 0.5;
  }
  applyShape();
  return {
    mesh,
    uniforms,
    applyShape,
    update(cameraPos) {
      uniforms.uCameraPos.value.copy(cameraPos);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
