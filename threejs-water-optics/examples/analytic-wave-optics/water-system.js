import * as THREE from "three";

export const oceanWaves = [
  [0.94, 0.32, 0.38, 28.0, 0.5],
  [-0.42, 0.91, 0.24, 18.0, 0.46],
  [0.78, -0.52, 0.16, 12.0, 0.42],
  [-0.35, -0.78, 0.1, 10.0, 0.35],
  [0.55, 0.62, 0.06, 9.5, 0.28],
];

export function createWaterMaterial(sceneColor) {
  const uniforms = {
    uTime: { value: 0 },
    uSceneColor: { value: sceneColor },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSunDirection: {
      value: new THREE.Vector3(-0.28, 0.62, -0.73).normalize(),
    },
    uDebugMode: { value: 0 },
  };

  const waveDeclarations = oceanWaves
    .map(
      ([x, z, amplitude, wavelength, steepness], index) => `
        const vec2 WAVE_DIRECTION_${index} = vec2(${x}, ${z});
        const float WAVE_AMPLITUDE_${index} = ${amplitude.toFixed(4)};
        const float WAVE_LENGTH_${index} = ${wavelength.toFixed(4)};
        const float WAVE_STEEPNESS_${index} = ${steepness.toFixed(4)};
      `,
    )
    .join("\n");

  const wavePosition = oceanWaves
    .map(
      (_, index) => `
        {
          float k = TAU / WAVE_LENGTH_${index};
          float omega = sqrt(9.81 * k);
          float phase = k * dot(WAVE_DIRECTION_${index}, baseXZ) - omega * uTime;
          displaced.xz += WAVE_DIRECTION_${index} *
            WAVE_STEEPNESS_${index} * WAVE_AMPLITUDE_${index} * cos(phase);
          displaced.y += WAVE_AMPLITUDE_${index} * sin(phase);
        }
      `,
    )
    .join("\n");

  const waveNormal = oceanWaves
    .map(
      (_, index) => `
        {
          float k = TAU / WAVE_LENGTH_${index};
          float omega = sqrt(9.81 * k);
          float phase = k * dot(WAVE_DIRECTION_${index}, baseXZ) - omega * uTime;
          float kA = k * WAVE_AMPLITUDE_${index};
          gradient += WAVE_DIRECTION_${index} * kA * sin(phase);
          verticalCorrection += WAVE_STEEPNESS_${index} * kA * cos(phase);
          phaseAlignment += abs(sin(phase)) * WAVE_AMPLITUDE_${index};
        }
      `,
    )
    .join("\n");

  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    vertexShader: `
      precision highp float;
      uniform float uTime;
      varying vec2 vBaseXZ;
      varying vec3 vWorldPosition;
      varying float vHeight;
      const float TAU = 6.28318530718;
      ${waveDeclarations}

      void main() {
        vec2 baseXZ = position.xz;
        vec3 displaced = position;
        ${wavePosition}
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vBaseXZ = baseXZ;
        vWorldPosition = world.xyz;
        vHeight = displaced.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform sampler2D uSceneColor;
      uniform vec2 uResolution;
      uniform vec3 uSunDirection;
      uniform int uDebugMode;
      varying vec2 vBaseXZ;
      varying vec3 vWorldPosition;
      varying float vHeight;
      const float TAU = 6.28318530718;
      ${waveDeclarations}

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x),
          u.y
        );
      }

      vec3 skyColor(vec3 direction) {
        float y = direction.y;
        vec3 below = vec3(0.35, 0.55, 0.78);
        vec3 horizon = vec3(0.52, 0.72, 0.92);
        vec3 lower = vec3(0.30, 0.58, 0.88);
        vec3 middle = vec3(0.12, 0.32, 0.70);
        vec3 zenith = vec3(0.02, 0.08, 0.36);
        float t0 = smoothstep(-0.1, 0.0, y);
        float t1 = smoothstep(0.0, 0.28, y);
        float t2 = smoothstep(0.28, 0.85, y);
        vec3 gradient = mix(
          mix(below, horizon, t0),
          mix(lower, mix(middle, zenith, t2), t1),
          t1
        );
        float sunDot = clamp(dot(direction, uSunDirection), 0.0, 1.0);
        return gradient
          + vec3(1.0, 0.95, 0.75) * pow(sunDot, 5000.0) * 50.0
          + vec3(1.0, 0.72, 0.32) * pow(sunDot, 20.0) * 2.8
          + vec3(1.0, 0.8, 0.5) * pow(sunDot, 4.0) * 0.5;
      }

      vec4 resolvedNormalAndCrest(
        vec2 baseXZ,
        out vec3 aaWeights,
        out float phaseAlignment
      ) {
        vec2 gradient = vec2(0.0);
        float verticalCorrection = 0.0;
        phaseAlignment = 0.0;
        ${waveNormal}
        vec3 macroNormal = normalize(vec3(
          -gradient.x,
          1.0 - verticalCorrection,
          -gradient.y
        ));

        vec2 footprint = vec2(
          max(length(dFdx(vWorldPosition.xz)), length(dFdy(vWorldPosition.xz))),
          0.0
        );
        float f = footprint.x;
        float k2 = TAU / 5.25;
        float k3 = TAU / 3.0;
        float k4 = TAU / 1.5;
        aaWeights = vec3(
          1.0 - smoothstep(0.0, 2.0, f * k2),
          1.0 - smoothstep(0.0, 1.5, f * k3),
          1.0 - smoothstep(0.0, 1.0, f * k4)
        );

        vec2 wind = normalize(vec2(0.8, 0.4));
        vec2 crossWind = vec2(-wind.y, wind.x);
        vec2 d2 = normalize(wind * 0.866 + crossWind * 0.5);
        vec2 d3 = normalize(wind * 0.866 - crossWind * 0.5);
        vec2 d4 = normalize(wind * 0.5 + crossWind * 0.866);
        vec2 microGradient = vec2(0.0);
        float p2 = dot(vWorldPosition.xz, d2) * k2 + uTime * sqrt(9.8 * k2) * 0.9;
        float p3 = dot(vWorldPosition.xz, d3) * k3 + uTime * sqrt(9.8 * k3) * 1.1;
        float p4 = dot(vWorldPosition.xz, d4) * k4 + uTime * sqrt(9.8 * k4) * 0.7;
        microGradient += d2 * (0.12 * k2 * cos(p2) * aaWeights.x);
        microGradient += d3 * (0.08 * k3 * cos(p3) * aaWeights.y);
        microGradient += d4 * (0.05 * k4 * cos(p4) * aaWeights.z);
        float turbulenceA =
          valueNoise(vWorldPosition.xz * 0.08 + wind * uTime * 0.03) * 2.0 - 1.0;
        float turbulenceB =
          valueNoise(vWorldPosition.xz * 0.056 + crossWind * uTime * 0.025) * 2.0 - 1.0;
        microGradient += wind * turbulenceA * 0.025;
        microGradient += crossWind * turbulenceB * 0.015;

        vec3 resolved = normalize(vec3(
          macroNormal.x - microGradient.x * 0.8,
          macroNormal.y,
          macroNormal.z - microGradient.y * 0.8
        ));
        float slope = clamp(1.0 - resolved.y, 0.0, 1.0);
        float crest = pow(clamp(slope * 5.0, 0.0, 1.0), 2.0);
        return vec4(resolved, crest);
      }

      void main() {
        vec3 aaWeights;
        float phaseAlignment;
        vec4 normalAndCrest = resolvedNormalAndCrest(
          vBaseXZ,
          aaWeights,
          phaseAlignment
        );
        vec3 normal = normalAndCrest.xyz;
        float crest = normalAndCrest.w;
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        bool underwater = dot(normal, viewDirection) < 0.0;
        float eta = underwater ? 1.333 : 1.0 / 1.333;
        float f0 = pow((1.0 - eta) / (1.0 + eta), 2.0) + 0.035;
        float nDotV = abs(dot(normal, viewDirection));
        float fresnel =
          f0 + (1.0 - f0) * pow(1.0 - nDotV, 5.0);

        vec3 reflected = reflect(-viewDirection, normal);
        vec3 reflection = skyColor(reflected);
        float reflectedSun = clamp(dot(reflected, uSunDirection), 0.0, 1.0);
        reflection +=
          vec3(1.0, 0.95, 0.72) * pow(reflectedSun, 2500.0) * 14.0
          + vec3(1.0, 0.7, 0.36) * pow(reflectedSun, 14.0) * 1.1;

        vec3 refracted = refract(-viewDirection, normal, eta);
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec2 noiseOffset = vec2(
          valueNoise(vWorldPosition.xz * 0.41 + uTime * 0.13),
          valueNoise(vWorldPosition.xz * 0.37 - uTime * 0.09)
        ) - 0.5;
        vec2 refractionOffset =
          (refracted.xz * 0.5 + noiseOffset * 0.5)
          * (0.005 + 0.02 * 0.18 * (1.0 - fresnel));
        vec3 sceneRefraction = texture2D(
          uSceneColor,
          clamp(screenUv + refractionOffset, vec2(0.002), vec2(0.998))
        ).rgb;

        float path =
          4.0 / max(0.001, abs(refracted.y) + 0.001);
        vec3 transmittance =
          exp(-vec3(0.20, 0.06, 0.02) * path);
        vec3 deep = vec3(0.005, 0.042, 0.115);
        vec3 transmitted =
          mix(deep, sceneRefraction, 0.65) * transmittance;
        float forwardScatter = pow(
          clamp(dot(viewDirection, -uSunDirection), 0.0, 1.0),
          4.0
        );
        transmitted +=
          vec3(0.0, 0.27, 0.19)
          * forwardScatter
          * 0.42
          * (1.0 - fresnel);

        float foamNoise =
          valueNoise(vWorldPosition.xz * 0.9 + uTime * vec2(0.12, 0.06));
        float foam = smoothstep(
          0.05,
          0.45,
          crest * mix(0.6, 1.4, foamNoise)
        );
        vec3 halfVector = normalize(viewDirection + uSunDirection);
        float specular =
          pow(clamp(dot(normal, halfVector), 0.0, 1.0), 1200.0) * 12.0;
        vec3 color = mix(transmitted, reflection, fresnel)
          + vec3(1.0, 0.96, 0.8) * specular
          + vec3(0.9, 0.95, 1.0) * crest * 0.28
          + vec3(1.0) * foam * 0.34;

        float distanceToCamera = distance(cameraPosition, vWorldPosition);
        float haze =
          clamp(1.0 - exp(-distanceToCamera * 0.0026), 0.0, 1.0);
        color = mix(color, vec3(0.76, 0.87, 0.99), haze);

        if (uDebugMode == 1) {
          color = mix(
            vec3(0.03, 0.08, 0.16),
            vec3(0.9, 0.42, 0.12),
            clamp(vHeight * 0.72 + 0.5, 0.0, 1.0)
          );
        } else if (uDebugMode == 2) {
          color = normal * 0.5 + 0.5;
        } else if (uDebugMode == 3) {
          color = aaWeights;
        } else if (uDebugMode == 4) {
          color = vec3(fresnel);
        } else if (uDebugMode == 5) {
          color = sceneRefraction;
        } else if (uDebugMode == 6) {
          color = transmittance;
        } else if (uDebugMode == 7) {
          color = vec3(
            clamp(foam * 4.0, 0.0, 1.0),
            clamp(crest * 8.0, 0.0, 1.0),
            clamp((1.0 - normal.y) * 20.0, 0.0, 1.0)
          );
        }

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function oceanSurfaceHeightAt(x, z, timeSeconds) {
  let height = 0;
  for (const [dx, dz, amplitude, wavelength] of oceanWaves) {
    const k = (Math.PI * 2) / wavelength;
    const omega = Math.sqrt(9.81 * k);
    height += amplitude *
      Math.sin(k * (dx * x + dz * z) - omega * timeSeconds);
  }
  return height;
}
