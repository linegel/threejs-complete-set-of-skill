import * as THREE from "three";

export const lavaFlowDebugModes = new Map([
  ["final", 0],
  ["height", 1],
  ["normals", 2],
  ["emission", 3],
]);

export function createLavaFlowMaterial({
  cameraSpeed = 0.1,
  flowSpeed = 0.1,
  ridgeFrequency = 0.0,
  pulseSpeed = 0.05,
  amplitude = 0.4,
  octaves = 7,
  emberCount = 80,
  filmNoise = 0.015,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraPosition: { value: new THREE.Vector3(0, 0.2, 0) },
      uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uCameraForward: { value: new THREE.Vector3(0, -0.35, 1).normalize() },
      uVerticalTan: { value: Math.tan(THREE.MathUtils.degToRad(54) * 0.5) },
      uDebugMode: { value: 0 },
      uCameraSpeed: { value: cameraSpeed },
      uFlowSpeed: { value: flowSpeed },
      uRidgeFrequency: { value: ridgeFrequency },
      uPulseSpeed: { value: pulseSpeed },
      uAmplitude: { value: amplitude },
      uOctaves: { value: octaves },
      uEmberCount: { value: emberCount },
      uFilmNoise: { value: filmNoise },
      uLavaHot: { value: new THREE.Color(0xff1402) },
      uLavaCool: { value: new THREE.Color(0xb20000) },
      uEmberColor: { value: new THREE.Color(0xff5511) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec3 uCameraPosition;
      uniform vec3 uCameraRight;
      uniform vec3 uCameraUp;
      uniform vec3 uCameraForward;
      uniform float uVerticalTan;
      uniform int uDebugMode;
      uniform float uCameraSpeed;
      uniform float uFlowSpeed;
      uniform float uRidgeFrequency;
      uniform float uPulseSpeed;
      uniform float uAmplitude;
      uniform float uOctaves;
      uniform float uEmberCount;
      uniform float uFilmNoise;
      uniform vec3 uLavaHot;
      uniform vec3 uLavaCool;
      uniform vec3 uEmberColor;
      varying vec2 vUv;

      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 hash31(float p) {
        vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xxy + p3.yzz) * p3.zyx);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), u.x),
          u.y
        );
      }

      float ridgeNoise(vec2 p, float octaveLimit) {
        float h = 0.0;
        float amp = 0.58;
        mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 10; i++) {
          if (float(i) >= octaveLimit) break;
          float n = valueNoise(p);
          h += amp * (1.0 - abs(n * 2.0 - 1.0));
          p = rotation * p * 2.03;
          amp *= 0.52;
        }
        return h;
      }

      float fbmHeight(vec2 p, float octaveLimit) {
        float h = 0.0;
        float amp = 0.8;
        mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 10; i++) {
          if (float(i) >= octaveLimit) break;
          h += amp * valueNoise(p);
          p = rotation * p * 2.1;
          amp *= 0.5;
        }
        return h;
      }

      vec2 advectedDomain(vec2 p) {
        p += vec2(1.0, 1.5) * uTime * uFlowSpeed;
        vec2 curl = vec2(
          sin(p.y * uRidgeFrequency + uTime * 0.42),
          cos(p.x * uRidgeFrequency + uTime * 0.31)
        ) * 0.2;
        return p + curl;
      }

      float terrainHeight(vec2 p) {
        float pulse = uAmplitude + sin(uTime * uPulseSpeed) * 0.06;
        vec2 domain = advectedDomain(p);
        float h = fbmHeight(domain, uOctaves);
        return -0.9 + h * pulse;
      }

      float mapSurface(vec3 p) {
        return (p.y - terrainHeight(p.xz)) * 0.52;
      }

      vec3 surfaceNormal(vec3 p) {
        vec2 e = vec2(0.012, 0.0);
        return normalize(vec3(
          mapSurface(p + e.xyy) - mapSurface(p - e.xyy),
          mapSurface(p + e.yxy) - mapSurface(p - e.yxy),
          mapSurface(p + e.yyx) - mapSurface(p - e.yyx)
        ));
      }

      float lavaMask(vec3 p) {
        return clamp(1.0 - smoothstep(-0.7, -0.3, p.y), 0.0, 1.0);
      }

      float emberField(vec3 ro, vec3 rd, float surfaceT) {
        float accum = 0.0;
        for (float i = 0.0; i < 150.0; i++) {
          if (i >= uEmberCount) break;
          vec3 seed = hash31(i + 17.13);
          float speed = 0.08 + seed.x * 0.13;
          float life = fract(uTime * speed + seed.y);
          vec3 ember = vec3(
            (seed.x - 0.5) * 6.2,
            mix(-0.86 + seed.z * 0.24, 0.85 + seed.x, pow(life, 1.35)),
            ro.z + (seed.y - 0.5) * 5.2 + 3.2
          );
          float drift = uTime * (0.8 + seed.x * 0.45);
          ember.x += (sin(drift * 2.1 + seed.z * 10.0) * 0.34 +
            cos(drift * 4.7 + seed.y * 5.0) * 0.11) * life;
          ember.z += (cos(drift * 2.4 + seed.x * 8.0) * 0.32 +
            sin(drift * 5.2 + seed.z * 6.0) * 0.1) * life;

          vec3 toEmber = ember - ro;
          float projected = dot(toEmber, rd);
          if (projected <= 0.0 || projected >= surfaceT) continue;
          float distanceToRay = length(ro + rd * projected - ember);
          float core = smoothstep(0.017, 0.001, distanceToRay);
          float halo = 0.0000025 / (distanceToRay * distanceToRay + 0.0000015);
          float fade =
            smoothstep(0.0, 0.12, life) *
            smoothstep(1.0, 0.68, life);
          accum += (core * 1.1 + halo) * fade * (0.45 + seed.z * 0.7);
        }
        return accum;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
        vec3 ro = uCameraPosition + uCameraForward * uTime * uCameraSpeed;
        vec3 rd = normalize(
          uCameraForward +
          uCameraRight * uv.x * 2.0 * uVerticalTan +
          uCameraUp * uv.y * 2.0 * uVerticalTan
        );

        float t = 0.0;
        float maxDistance = 15.0;
        float glow = 0.0;
        vec3 p = ro;
        for (int i = 0; i < 84; i++) {
          p = ro + rd * t;
          float d = mapSurface(p);
          if (d < 0.004 || t > maxDistance) break;
          t += d;
          float heat = smoothstep(-0.18, -0.86, p.y);
          glow += exp(-d * 6.2) * heat * 0.055;
        }

        float horizonBand = exp(-abs(uv.y - 0.02) * 7.0);
        vec3 background = mix(
          vec3(0.00005, 0.00002, 0.00008),
          vec3(0.16, 0.028, 0.015),
          horizonBand
        );
        vec3 color = background;
        float emissionMask = 0.0;
        vec3 normal = vec3(0.0, 1.0, 0.0);
        if (t < maxDistance) {
          normal = surfaceNormal(p);
          vec3 lightDirection = normalize(vec3(0.42, 0.92, -0.18));
          float diffuse = max(dot(normal, lightDirection), 0.0);
          float specular = pow(max(dot(reflect(-lightDirection, normal), -rd), 0.0), 12.0);
          float ash = ridgeNoise(p.xz * 0.9 + vec2(3.0, -8.0), 4.0);
          vec3 rock = mix(vec3(0.028, 0.018, 0.018), vec3(0.12, 0.09, 0.10), ash) *
            (0.24 + diffuse * 0.62) +
            vec3(0.12, 0.10, 0.12) * specular;
          emissionMask = lavaMask(p);
          float rockMask = smoothstep(-0.7, -0.3, p.y);
          vec3 lava = mix(uLavaHot * 1.7, uLavaCool, smoothstep(-0.9, -0.6, p.y));
          color = mix(lava, rock, rockMask);
        }

        float embers = emberField(ro, rd, min(t, maxDistance));
        color += vec3(1.05, 0.11, 0.025) * glow;
        color += uEmberColor * embers * 1.85;

        float distanceFog = 1.0 - exp(-0.04 * min(t, maxDistance) * min(t, maxDistance));
        float lowMist = t < maxDistance ? smoothstep(-0.25, -1.05, p.y) * 0.22 : 0.0;
        vec3 fogColor = mix(
          vec3(0.005, 0.002, 0.01),
          vec3(0.44, 0.055, 0.02),
          horizonBand
        );
        color = mix(color, fogColor, clamp(distanceFog + lowMist, 0.0, 0.82));

        if (uDebugMode == 1) {
          float heightValue = t < maxDistance ? clamp((p.y + 1.0) * 0.72, 0.0, 1.0) : 0.0;
          color = mix(vec3(0.02, 0.0, 0.04), vec3(1.0, 0.18, 0.02), heightValue);
        } else if (uDebugMode == 2) {
          color = normal * 0.5 + 0.5;
        } else if (uDebugMode == 3) {
          color = vec3(glow * 1.7, emissionMask, embers * 0.08);
        }

        color *= 1.0 - 0.42 * length(uv);
        color = pow(max(color, 0.0), vec3(0.4545));
        float grain = hash21(gl_FragCoord.xy + vec2(fract(uTime * 0.123), fract(uTime * 0.321)) * 997.0);
        color += (grain - 0.5) * uFilmNoise;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

export function createLavaFlowSurface(options = {}) {
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    createLavaFlowMaterial(options),
  );
  surface.frustumCulled = false;
  return surface;
}

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();

export function updateLavaFlowMaterial(material, {
  elapsed,
  width,
  height,
  camera,
  debugMode = "final",
}) {
  material.uniforms.uTime.value = elapsed;
  material.uniforms.uResolution.value.set(width, height);
  material.uniforms.uDebugMode.value =
    lavaFlowDebugModes.get(debugMode) ?? 0;
  if (camera) {
    camera.getWorldDirection(cameraForward);
    const elements = camera.matrixWorld.elements;
    cameraRight.set(elements[0], elements[1], elements[2]).normalize();
    cameraUp.set(elements[4], elements[5], elements[6]).normalize();
    material.uniforms.uCameraPosition.value.copy(camera.position);
    material.uniforms.uCameraRight.value.copy(cameraRight);
    material.uniforms.uCameraUp.value.copy(cameraUp);
    material.uniforms.uCameraForward.value.copy(cameraForward);
    material.uniforms.uVerticalTan.value =
      Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 54) * 0.5);
  }
}
