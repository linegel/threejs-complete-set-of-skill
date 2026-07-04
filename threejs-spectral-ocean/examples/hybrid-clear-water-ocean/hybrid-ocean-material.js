import * as THREE from "three";

export const hybridOceanDebugModes = new Map([
  ["final", 0],
  ["cascade-bands", 1],
  ["normals", 2],
  ["foam", 3],
  ["refraction", 4],
  ["absorption", 5],
]);

const MAX_GERSTNER = 6;
const linColor = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export function buildHybridSwell({
  primaryDirectionDegrees = 20,
  secondaryDirectionDegrees = 110,
  primaryStrength = 0.55,
  secondaryStrength = 0.28,
  waveSpeed = 1,
  waveAmplitude = 1,
  steepness = 1,
} = {}) {
  const directions = [];
  const params = [];
  const make = (directionDegrees, wavelength, amplitude, q, speed) => {
    const angle = THREE.MathUtils.degToRad(directionDegrees);
    const k = (Math.PI * 2) / wavelength;
    const omega = Math.sqrt(9.81 * k) * speed * waveSpeed;
    directions.push(new THREE.Vector2(Math.cos(angle), Math.sin(angle)));
    params.push(
      new THREE.Vector4(
        k,
        amplitude * waveAmplitude,
        q * steepness,
        omega,
      ),
    );
  };

  make(primaryDirectionDegrees - 8, 180, 1.4 * primaryStrength, 0.62, 1);
  make(primaryDirectionDegrees + 6, 120, 0.95 * primaryStrength, 0.55, 1.05);
  make(primaryDirectionDegrees + 17, 78, 0.55 * primaryStrength, 0.48, 1.1);
  make(secondaryDirectionDegrees - 5, 96, 0.85 * secondaryStrength, 0.5, 1);
  make(secondaryDirectionDegrees + 12, 61, 0.5 * secondaryStrength, 0.45, 1.08);
  while (directions.length < MAX_GERSTNER) {
    directions.push(new THREE.Vector2(1, 0));
    params.push(new THREE.Vector4(0, 0, 0, 0));
  }
  return { directions, params };
}

const skyFunction = `
  float skyHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float skyNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), u.x),
      mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0)), u.x),
      u.y
    );
  }

  float skyFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += skyNoise(p) * a;
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  float cloudMask(vec3 direction, float time) {
    if (direction.y <= 0.015) return 0.0;
    vec2 uv = direction.xz / direction.y;
    uv = uv * 0.45 + time * 0.006;
    float d = skyFbm(uv) * 0.7 +
      skyFbm(uv * 3.1 - time * 0.01) * 0.3;
    float cover = mix(0.62, 0.34, 0.5);
    return smoothstep(cover, cover + 0.22, d) * smoothstep(0.0, 0.32, direction.y);
  }

  vec3 hybridSkyRadiance(vec3 direction, vec3 sunDirection, float time) {
    float up = clamp(direction.y, -1.0, 1.0);
    vec3 horizon = vec3(0.624, 0.791, 0.897);
    vec3 zenith = vec3(0.07, 0.30, 0.66);
    vec3 below = mix(horizon, vec3(0.003, 0.036, 0.078), 0.65);
    vec3 color = up >= 0.0
      ? mix(horizon, zenith, pow(up, 0.48))
      : mix(horizon, below, clamp(-up * 3.5, 0.0, 1.0));
    float cloud = cloudMask(normalize(direction), time);
    float sun = max(dot(normalize(direction), sunDirection), 0.0);
    vec3 cloudLit = mix(vec3(0.72, 0.78, 0.86), vec3(1.05, 1.02, 0.97),
      0.6 + 0.4 * sun);
    color = mix(color, cloudLit, cloud * 0.9);
    color += vec3(1.0, 0.86, 0.62) *
      (smoothstep(0.9995, 0.99986, sun) * 8.0 + pow(sun, 220.0) * 0.5 + pow(sun, 16.0) * 0.18) *
      (1.0 - cloud * 0.7);
    return color;
  }
`;

const gradingFunction = `
  vec3 aces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 saturate3(vec3 color, float saturation) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), color, saturation);
  }
`;

const foamFunction = `
  float foamHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float foamNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(foamHash(i), foamHash(i + vec2(1.0, 0.0)), f.x),
      mix(foamHash(i + vec2(0.0, 1.0)), foamHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float foamFbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * foamNoise(p);
      p *= 2.07;
      amp *= 0.5;
    }
    return v;
  }

  float computeHybridFoam(float jacobian, float curvature, vec2 worldXZ, float time) {
    float fold = smoothstep(0.34, 0.08, jacobian);
    fold = mix(fold, 1.0, 0.25 * fold);
    float crest = 0.18 * smoothstep(0.72, 1.2, curvature);
    float mask = clamp(fold + crest, 0.0, 1.0);
    vec2 fp = worldXZ * 2.4 * 0.05;
    float n = foamFbm(fp + time * 0.35 * vec2(0.3, -0.2));
    n = mix(n, foamFbm(fp * 2.3 - time * 0.35 * 0.5), 0.5);
    float foam = mask * mix(0.6, 1.0, n);
    foam = max(foam, mask * 0.25 * smoothstep(0.2, 0.8, n));
    foam = pow(clamp(foam, 0.0, 1.0), 2.2) * 0.55;
    return clamp(foam, 0.0, 1.0);
  }
`;

export function createHybridOceanMaterial(cascades, {
  patchLengths,
  sceneColor = null,
  sunDirection = new THREE.Vector3(-0.42, 0.62, 0.66).normalize(),
  swell = buildHybridSwell(),
} = {}) {
  const uniforms = {
    displacement0: { value: cascades[0].displacement },
    displacement1: { value: cascades[1].displacement },
    displacement2: { value: cascades[2].displacement },
    derivatives0: { value: cascades[0].derivatives.texture },
    derivatives1: { value: cascades[1].derivatives.texture },
    derivatives2: { value: cascades[2].derivatives.texture },
    patchLengths: { value: new THREE.Vector3(...patchLengths) },
    uSceneColor: { value: sceneColor },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uSandLevel: { value: -2.4 },
    uGerstnerDir: { value: swell.directions },
    uGerstnerParams: { value: swell.params },
    uModelOffset: { value: new THREE.Vector2() },
    uCascadeWeight: { value: new THREE.Vector3(1.0, 0.55, 0.28) },
    uOceanExtent: { value: 1200 },
    uHorizonBlend: { value: 0.32 },
    uFogColor: { value: linColor(0xbcd7e8) },
    uFogDensity: { value: 0.0016 },
    uFogStrength: { value: 1 },
    uDeepColor: { value: linColor(0x0a3550) },
    uSurfaceColor: { value: linColor(0x1aa7c0) },
    uScatterColor: { value: linColor(0x1d9ab0) },
    uExtinction: { value: new THREE.Vector3(0.32, 0.085, 0.06) },
    uSunColor: { value: linColor(0xfff6ec) },
    uSunIntensity: { value: 4 },
    uExposure: { value: 1.05 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.04 },
    uBrightness: { value: 1.0 },
    uDebugMode: { value: 0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      precision highp float;

      uniform sampler2D displacement0;
      uniform sampler2D displacement1;
      uniform sampler2D displacement2;
      uniform vec3 patchLengths;
      uniform float uTime;
      uniform vec2 uGerstnerDir[${MAX_GERSTNER}];
      uniform vec4 uGerstnerParams[${MAX_GERSTNER}];
      uniform vec2 uModelOffset;
      uniform vec3 uCascadeWeight;

      varying vec2 vOceanXZ;
      varying vec3 vWorldPosition;
      varying vec3 vGerstnerNormal;
      varying float vFftHeight;

      vec4 sampleDisplacement(sampler2D map, vec2 xz, float lengthScale) {
        return texture2D(map, fract(xz / lengthScale));
      }

      void main() {
        vOceanXZ = position.xz + uModelOffset;
        vec4 d0 = sampleDisplacement(displacement0, vOceanXZ, patchLengths.x);
        vec4 d1 = sampleDisplacement(displacement1, vOceanXZ, patchLengths.y);
        vec4 d2 = sampleDisplacement(displacement2, vOceanXZ, patchLengths.z);
        vec3 fftDisplacement =
          d0.xyz * uCascadeWeight.x +
          d1.xyz * uCascadeWeight.y +
          d2.xyz * uCascadeWeight.z;
        vFftHeight = fftDisplacement.y;

        vec3 swellDisplacement = vec3(0.0);
        vec3 swellNormal = vec3(0.0, 1.0, 0.0);
        for (int i = 0; i < ${MAX_GERSTNER}; i++) {
          vec4 p = uGerstnerParams[i];
          if (p.x <= 0.0) continue;
          vec2 direction = uGerstnerDir[i];
          float phase = p.x * dot(direction, vOceanXZ) - p.w * uTime;
          float c = cos(phase);
          float s = sin(phase);
          swellDisplacement.xz += p.z * p.y * direction * c;
          swellDisplacement.y += p.y * s;
          float wa = p.x * p.y;
          swellNormal.xz -= direction * wa * c;
          swellNormal.y -= p.z * wa * s;
        }
        vGerstnerNormal = swellNormal;

        vec3 displaced = position + fftDisplacement + swellDisplacement;
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform sampler2D displacement0;
      uniform sampler2D displacement1;
      uniform sampler2D displacement2;
      uniform sampler2D derivatives0;
      uniform sampler2D derivatives1;
      uniform sampler2D derivatives2;
      uniform sampler2D uSceneColor;
      uniform vec3 patchLengths;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform float uSandLevel;
      uniform vec3 uCascadeWeight;
      uniform float uOceanExtent;
      uniform float uHorizonBlend;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uFogStrength;
      uniform vec3 uDeepColor;
      uniform vec3 uSurfaceColor;
      uniform vec3 uScatterColor;
      uniform vec3 uExtinction;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform float uExposure;
      uniform float uSaturation;
      uniform float uContrast;
      uniform float uBrightness;
      uniform int uDebugMode;

      varying vec2 vOceanXZ;
      varying vec3 vWorldPosition;
      varying vec3 vGerstnerNormal;
      varying float vFftHeight;

      ${skyFunction}
      ${gradingFunction}
      ${foamFunction}

      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
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

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += valueNoise(p) * a;
          p *= 2.03;
          a *= 0.5;
        }
        return v;
      }

      vec4 sampleDisplacement(sampler2D map, vec2 xz, float lengthScale) {
        return texture2D(map, fract(xz / lengthScale));
      }

      vec4 sampleDerivatives(sampler2D map, vec2 xz, float lengthScale) {
        return texture2D(map, fract(xz / lengthScale));
      }

      float ggxD(float noH, float a) {
        float a2 = a * a;
        float d = noH * noH * (a2 - 1.0) + 1.0;
        return a2 / (3.14159265 * d * d);
      }

      float smith(float noV, float noL, float a) {
        float k = a * a * 0.5;
        float gv = noV / (noV * (1.0 - k) + k);
        float gl = noL / (noL * (1.0 - k) + k);
        return gv * gl;
      }

      void main() {
        vec4 der0 = sampleDerivatives(derivatives0, vOceanXZ, patchLengths.x);
        vec4 der1 = sampleDerivatives(derivatives1, vOceanXZ, patchLengths.y);
        vec4 der2 = sampleDerivatives(derivatives2, vOceanXZ, patchLengths.z);
        vec4 derivative =
          der0 * uCascadeWeight.x +
          der1 * uCascadeWeight.y +
          der2 * uCascadeWeight.z;
        vec3 fftNormal = normalize(vec3(
          -derivative.x / max(0.18, 1.0 + derivative.z),
          1.0,
          -derivative.y / max(0.18, 1.0 + derivative.w)
        ));
        vec3 swellNormal = normalize(vGerstnerNormal);
        vec3 normal = normalize(vec3(
          fftNormal.x + swellNormal.x / max(swellNormal.y, 0.08),
          1.0,
          fftNormal.z + swellNormal.z / max(swellNormal.y, 0.08)
        ));
        vec2 detailA = vec2(
          fbm(vOceanXZ * 0.18 + vec2(uTime * 0.025, -uTime * 0.018)),
          fbm(vOceanXZ * 0.18 + vec2(19.0 - uTime * 0.018, uTime * 0.025))
        ) - 0.5;
        vec2 detailB = vec2(
          fbm(vOceanXZ * 0.55 + vec2(-uTime * 0.055, uTime * 0.034)),
          fbm(vOceanXZ * 0.55 + vec2(23.0 + uTime * 0.034, -uTime * 0.055))
        ) - 0.5;
        normal = normalize(normal + vec3(detailA + detailB * 0.45, 0.0).xzy * 0.16);
        if (!gl_FrontFacing) normal = -normal;

        vec4 disp0 = sampleDisplacement(displacement0, vOceanXZ, patchLengths.x);
        vec4 disp1 = sampleDisplacement(displacement1, vOceanXZ, patchLengths.y);
        vec4 disp2 = sampleDisplacement(displacement2, vOceanXZ, patchLengths.z);
        float jacobian =
          (1.0 + derivative.z) *
          (1.0 + derivative.w);
        float curvature = clamp(length(derivative.xy) * 0.6 + (1.0 - jacobian), 0.0, 1.0);
        float foam = computeHybridFoam(jacobian, curvature, vOceanXZ, uTime);

        if (uDebugMode == 1) {
          vec3 bands = vec3(abs(disp0.y), abs(disp1.y) * 2.0, abs(disp2.y) * 3.2);
          gl_FragColor = vec4(pow(clamp(bands, 0.0, 1.0), vec3(0.55)), 1.0);
          return;
        }
        if (uDebugMode == 2) {
          gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
          return;
        }
        if (uDebugMode == 3) {
          gl_FragColor = vec4(vec3(foam), 1.0);
          return;
        }

        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirection = normalize(uSunDirection);
        vec3 halfVector = normalize(viewDirection + lightDirection);
        float noV = max(dot(normal, viewDirection), 0.001);
        float noL = max(dot(normal, lightDirection), 0.0);
        float noH = max(dot(normal, halfVector), 0.0);
        float voH = max(dot(viewDirection, halfVector), 0.0);
        float f0 = pow((1.0 - 1.333) / (1.0 + 1.333), 2.0);
        float fresnel = f0 + (1.0 - f0) * pow(1.0 - noV, 5.0);

        vec3 reflected = reflect(-viewDirection, normal);
        vec3 reflection = hybridSkyRadiance(normalize(reflected), lightDirection, uTime);
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec2 refractOffset = normal.xz * 0.18 * 0.08 * 0.55;
        vec3 sceneRefraction = texture2D(
          uSceneColor,
          clamp(screenUv + refractOffset, vec2(0.002), vec2(0.998))
        ).rgb;

        vec3 refracted = refract(-viewDirection, normal, 1.0 / 1.333);
        float depth = max(vWorldPosition.y - uSandLevel, 0.0);
        float pathLen = depth / max(0.07, abs(refracted.y));
        vec3 extinction = uExtinction;
        vec3 transmittance = exp(-extinction * pathLen);
        vec3 inscatter = mix(uScatterColor, uDeepColor, clamp(pathLen / 28.0, 0.0, 1.0));
        vec3 refraction = sceneRefraction * transmittance +
          inscatter * (1.0 - transmittance);
        float crest = clamp(vFftHeight * 0.5 + 0.5, 0.0, 1.0);
        float wrapScatter = max(dot(normal, lightDirection) * 0.5 + 0.5, 0.0);
        refraction += uScatterColor * pow(crest, 3.0) * wrapScatter * 0.12;
        float forwardScatter =
          pow(max(dot(viewDirection, -lightDirection), 0.0), 4.0) *
          smoothstep(-0.15, 0.75, vFftHeight);
        refraction += uScatterColor * forwardScatter * (1.0 - fresnel);

        float roughness = 0.035;
        float spec =
          ggxD(noH, roughness) *
          smith(noV, noL, roughness) *
          (f0 + (1.0 - f0) * pow(1.0 - voH, 5.0)) *
          noL;
        vec3 color = mix(refraction, reflection, fresnel) +
          uSunColor * spec * uSunIntensity * 1.2;
        color += refraction * noL * 0.05 * uSunColor;
        float glint = pow(max(dot(reflected, lightDirection), 0.0), 350.0);
        float sparkleMask = smoothstep(0.55, 0.95, skyFbm(vOceanXZ * 2.5 + uTime * 0.5));
        color += uSunColor * glint * sparkleMask * uSunIntensity * 2.5 * 1.2;

        float distanceToCamera = length(cameraPosition.xz - vWorldPosition.xz);
        float fog = 1.0 - exp(-pow(uFogDensity * distanceToCamera, 2.0));
        fog = clamp(fog * uFogStrength, 0.0, 1.0);
        color = mix(color, uFogColor, fog);

        float halfExtent = uOceanExtent * 0.5;
        float hazeStart = halfExtent * mix(0.85, 0.30, clamp(uHorizonBlend, 0.0, 1.0));
        float edge = smoothstep(hazeStart, halfExtent * 0.99, distanceToCamera);
        vec3 skyColor = hybridSkyRadiance(
          normalize(vec3(-viewDirection.x, 0.06, -viewDirection.z)),
          lightDirection,
          uTime
        );
        color = mix(color, mix(skyColor, uFogColor, 0.6), edge);

        vec3 foamColor = vec3(1.15) * mix(vec3(0.9, 0.95, 1.0), uSunColor, 0.15);
        foamColor *= 0.5 + 0.5 * noL + 0.12 * uSunIntensity;
        color = mix(color, foamColor, foam * 0.55);

        color *= uExposure;
        color = aces(color);
        color = saturate3(color, uSaturation);
        color = (color - 0.5) * uContrast + 0.5;
        color *= uBrightness;
        color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

        if (uDebugMode == 4) {
          color = sceneRefraction;
        } else if (uDebugMode == 5) {
          color = transmittance;
        }

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

export function createHybridOceanSkyMaterial({
  sunDirection = new THREE.Vector3(-0.42, 0.62, 0.66).normalize(),
} = {}) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDirection: { value: sunDirection },
      uFogColor: { value: linColor(0xbcd7e8) },
      uExposure: { value: 1.05 },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uFogColor;
      uniform float uExposure;
      varying vec3 vDirection;
      ${skyFunction}
      ${gradingFunction}
      void main() {
        vec3 color = hybridSkyRadiance(normalize(vDirection), normalize(uSunDirection), uTime);
        float horizonFog = pow(1.0 - clamp(abs(normalize(vDirection).y), 0.0, 1.0), 6.0);
        color = mix(color, uFogColor, horizonFog * 0.6);
        color *= uExposure;
        color = aces(color);
        color = pow(color, vec3(1.0 / 2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

export function createClearWaterSandMaterial({
  colorMap,
  normalMap,
  roughnessMap,
  aoMap,
  textureScale = 0.12,
  normalStrength = 1.2,
  brightness = 1.05,
  causticIntensity = 0.7,
  causticScale = 0.35,
  causticSpeed = 0.6,
  sunDirection = new THREE.Vector3(-0.42, 0.62, 0.66).normalize(),
  sunColor = linColor(0xfff6ec),
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorMap: { value: colorMap },
      uNormalMap: { value: normalMap },
      uRoughMap: { value: roughnessMap },
      uAoMap: { value: aoMap },
      uTextureScale: { value: textureScale },
      uNormalStrength: { value: normalStrength },
      uBrightness: { value: brightness },
      uTime: { value: 0 },
      uCausticIntensity: { value: causticIntensity },
      uCausticScale: { value: causticScale },
      uCausticSpeed: { value: causticSpeed },
      uSunColor: { value: sunColor.clone() },
      uSunDirection: { value: sunDirection.clone() },
    },
    vertexShader: `
      varying vec2 vWorldXZ;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform sampler2D uColorMap;
      uniform sampler2D uNormalMap;
      uniform sampler2D uRoughMap;
      uniform sampler2D uAoMap;
      uniform float uTextureScale;
      uniform float uNormalStrength;
      uniform float uBrightness;
      uniform float uTime;
      uniform float uCausticIntensity;
      uniform float uCausticScale;
      uniform float uCausticSpeed;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      varying vec2 vWorldXZ;

      float caustic(vec2 uv, float time) {
        vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
        vec2 i = p;
        float c = 1.0;
        float inten = 0.005;
        for (int n = 0; n < 5; n++) {
          float t = time * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(
            cos(t - i.x) + sin(t + i.y),
            sin(t - i.y) + cos(t + i.x)
          );
          c += 1.0 / length(vec2(
            p.x / (sin(i.x + t) / inten),
            p.y / (cos(i.y + t) / inten)
          ));
        }
        c /= 5.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 8.0), 0.0, 1.0);
      }

      void main() {
        vec2 uv = vWorldXZ * uTextureScale;
        vec3 albedo = pow(texture2D(uColorMap, uv).rgb, vec3(2.2));
        float ao = texture2D(uAoMap, uv).r;
        float rough = texture2D(uRoughMap, uv).r;
        vec3 nm = texture2D(uNormalMap, uv).rgb * 2.0 - 1.0;
        nm.y = -nm.y;
        nm.xy *= uNormalStrength;
        vec3 N = normalize(vec3(nm.x, nm.z, nm.y));
        vec3 L = normalize(uSunDirection);
        float ndl = clamp(dot(N, L), 0.0, 1.0);
        float wrap = ndl * 0.65 + 0.35;
        vec3 lit = albedo * ao * uSunColor * wrap + albedo * 0.15;
        float spec = pow(ndl, mix(40.0, 6.0, rough)) * (1.0 - rough) * 0.15;
        lit += uSunColor * spec;
        lit *= uBrightness;

        vec2 cp = vWorldXZ * uCausticScale;
        float c = caustic(cp, uTime * uCausticSpeed);
        c += caustic(cp * 1.7 + 13.0, uTime * uCausticSpeed * 0.8) * 0.6;
        lit += uSunColor * c * uCausticIntensity * (0.5 + 0.5 * ndl);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function updateClearWaterSandMaterial(material, {
  elapsed,
  sunDirection,
} = {}) {
  material.uniforms.uTime.value = elapsed;
  if (sunDirection) {
    material.uniforms.uSunDirection.value.copy(sunDirection);
  }
}

export function updateHybridOceanMaterial(material, cascades) {
  material.uniforms.displacement0.value = cascades[0].displacement;
  material.uniforms.displacement1.value = cascades[1].displacement;
  material.uniforms.displacement2.value = cascades[2].displacement;
  material.uniforms.derivatives0.value = cascades[0].derivatives.texture;
  material.uniforms.derivatives1.value = cascades[1].derivatives.texture;
  material.uniforms.derivatives2.value = cascades[2].derivatives.texture;
}
