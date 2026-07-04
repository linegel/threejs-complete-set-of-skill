import * as THREE from "three";

export function createCurvedRayAccretionEffect({
  noiseTexture,
  starTexture,
}) {
  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uNoise: { value: noiseTexture },
    uStars: { value: starTexture },
    uDebugMode: { value: 0 },
    uRayOrigin: { value: new THREE.Vector3(0, 0.14, 2.35) },
    uRayForward: { value: new THREE.Vector3(0, 0, -1) },
    uRayRight: { value: new THREE.Vector3(1, 0, 0) },
    uRayUp: { value: new THREE.Vector3(0, 1, 0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform vec2 uResolution;
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform sampler2D uStars;
      uniform int uDebugMode;
      uniform vec3 uRayOrigin;
      uniform vec3 uRayForward;
      uniform vec3 uRayRight;
      uniform vec3 uRayUp;

      const int ITERATIONS = 128;
      const float STEP_SIZE = 0.0071;
      const float BENDING_POWER = 0.3;
      const float CORE_RADIUS = 0.13;
      const float DISK_WIDTH = 0.03;

      float hash12(vec2 value) {
        return fract(
          sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453
        );
      }

      float remapClamped(
        float value,
        float inMin,
        float inMax,
        float outMin,
        float outMax
      ) {
        float t = clamp(
          (value - inMin) / (inMax - inMin),
          0.0,
          1.0
        );
        return mix(outMin, outMax, t);
      }

      float smoothRange(
        float value,
        float inMin,
        float inMax,
        float outMin,
        float outMax
      ) {
        float t = clamp(
          (value - inMin) / (inMax - inMin),
          0.0,
          1.0
        );
        t = t * t * (3.0 - 2.0 * t);
        return mix(outMin, outMax, t);
      }

      vec2 rotate2D(vec2 value, float angle) {
        float sine = sin(angle);
        float cosine = cos(angle);
        return mat2(cosine, -sine, sine, cosine) * value;
      }

      vec2 equirectUv(vec3 direction) {
        vec3 normalizedDirection = normalize(direction);
        return vec2(
          atan(normalizedDirection.z, normalizedDirection.x) /
            6.28318530718 + 0.5,
          acos(clamp(normalizedDirection.y, -1.0, 1.0)) /
            3.14159265359
        );
      }

      vec3 colorRamp(float value) {
        vec3 whiteHot = vec3(1.0, 0.99, 0.95);
        vec3 gold = vec3(1.0, 0.82, 0.34);
        vec3 amber = vec3(0.42, 0.16, 0.02);
        if (value < 0.33) {
          return mix(
            whiteHot,
            gold,
            smoothstep(0.06, 0.33, value)
          );
        }
        return mix(
          gold,
          amber,
          smoothstep(0.33, 1.0, value)
        );
      }

      bool intersectSphere(
        vec3 rayOrigin,
        vec3 rayDirection,
        out float nearDistance,
        out float farDistance
      ) {
        float b = dot(rayOrigin, rayDirection);
        float c = dot(rayOrigin, rayOrigin) - 1.0;
        float discriminant = b * b - c;
        if (discriminant < 0.0) return false;
        float root = sqrt(discriminant);
        nearDistance = -b - root;
        farDistance = -b + root;
        return farDistance > 0.0;
      }

      void main() {
        vec2 pixel =
          (gl_FragCoord.xy * 2.0 - uResolution.xy) /
          uResolution.y;
        vec3 rayOrigin = uRayOrigin;
        vec3 rayDirection = normalize(
          normalize(uRayForward) * 1.78 +
          normalize(uRayRight) * pixel.x +
          normalize(uRayUp) * pixel.y
        );

        float nearDistance;
        float farDistance;
        if (
          !intersectSphere(
            rayOrigin,
            rayDirection,
            nearDistance,
            farDistance
          )
        ) {
          gl_FragColor = vec4(
            texture2D(
              uStars,
              equirectUv(rayDirection)
            ).rgb,
            1.0
          );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }

        vec3 rayPosition =
          rayOrigin + rayDirection * max(nearDistance, 0.0);
        rayPosition -= rayDirection *
          ((hash12(gl_FragCoord.xy) - 0.5) * 0.02);

        vec3 colorAccumulated = vec3(0.0);
        float alphaAccumulated = 0.0;
        float steeringAccumulated = 0.0;
        float densityMaximum = 0.0;

        for (int index = 0; index < ITERATIONS; index += 1) {
          float radius = max(length(rayPosition), 0.001);
          vec3 radialDirection = rayPosition / radius;
          float steeringMagnitude =
            STEP_SIZE * BENDING_POWER / (radius * radius);
          float steeringRange = remapClamped(
            radius,
            1.0,
            0.5,
            0.0,
            1.0
          );
          vec3 steeredDirection = normalize(
            rayDirection -
            radialDirection * steeringMagnitude * steeringRange
          );
          steeringAccumulated +=
            steeringMagnitude * steeringRange;

          vec3 advance = rayDirection * STEP_SIZE;
          rayPosition += advance;

          float radialDistance = length(rayPosition.xy);
          float rotationPhase =
            radialDistance * 4.27 - uTime * 0.1;
          vec2 noiseUv = rotate2D(
            rayPosition.xy,
            rotationPhase
          ) * 2.0;
          vec3 deepNoise = texture2D(uNoise, noiseUv).rgb;

          vec3 distanceToBand =
            vec3(-DISK_WIDTH, 0.0, DISK_WIDTH) -
            vec3(rayPosition.z);
          vec3 quadraticBand =
            distanceToBand * distanceToBand / DISK_WIDTH;
          vec3 diskBand = max(
            (vec3(DISK_WIDTH) - quadraticBand) / DISK_WIDTH,
            vec3(0.0)
          );
          vec3 noiseAmplitude = deepNoise * diskBand;
          float noiseLength = length(noiseAmplitude);
          float nearbyNoiseLength = length(
            texture2D(uNoise, noiseUv * 1.002).rgb *
            diskBand
          );

          float rampInput =
            radialDistance +
            (noiseLength - 0.78) * 1.5 +
            (noiseLength - nearbyNoiseLength) * 19.75;
          vec3 baseColor = colorRamp(rampInput);
          float detailBoost = remapClamped(
            nearbyNoiseLength,
            0.35,
            1.2,
            0.75,
            1.15
          );
          vec3 emissiveColor =
            baseColor * (1.95 * detailBoost) +
            vec3(1.0, 0.72, 0.26);

          bool insideCore =
            length(rayPosition) < CORE_RADIUS;
          vec3 shadedColor =
            insideCore ? vec3(0.0) : emissiveColor;
          float alphaNoise = (noiseLength - 0.75) * -0.6;
          float alphaPre = abs(rayPosition.z) + alphaNoise;
          float alphaRadial = smoothRange(
            radialDistance,
            1.0,
            0.0,
            0.0,
            1.0
          );
          float alphaBand = smoothRange(
            alphaPre,
            DISK_WIDTH,
            0.0,
            0.0,
            alphaRadial
          );
          float alphaLocal = insideCore ? 1.0 : alphaBand;
          densityMaximum = max(densityMaximum, alphaLocal);

          float remaining = 1.0 - alphaAccumulated;
          float weight = remaining * alphaLocal;
          colorAccumulated = mix(
            colorAccumulated,
            shadedColor,
            weight
          );
          alphaAccumulated = mix(
            alphaAccumulated,
            1.0,
            alphaLocal
          );

          rayPosition += advance;
          rayDirection = steeredDirection;
        }

        vec3 environment = texture2D(
          uStars,
          equirectUv(
            rayDirection * vec3(1.0, -1.0, 1.0)
          )
        ).rgb;
        float transmittance = 1.0 - alphaAccumulated;
        vec3 finalColor = mix(
          colorAccumulated,
          environment,
          transmittance
        );

        if (uDebugMode == 1) {
          float steeringView = clamp(
            steeringAccumulated * 3.0,
            0.0,
            1.0
          );
          finalColor = vec3(
            steeringView,
            steeringView * steeringView,
            1.0 - steeringView
          );
        } else if (uDebugMode == 2) {
          finalColor = vec3(
            densityMaximum,
            densityMaximum * 0.42,
            densityMaximum * 0.04
          );
        } else if (uDebugMode == 3) {
          finalColor = vec3(transmittance);
        } else if (uDebugMode == 4) {
          finalColor = rayDirection * 0.5 + 0.5;
        }

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    material,
  );
  const debugModes = new Map([
    ["final", 0],
    ["steering", 1],
    ["disk-density", 2],
    ["transmittance", 3],
    ["bent-direction", 4],
  ]);

  return {
    mesh,
    material,
    uniforms,
    setSize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    setDebugMode(mode) {
      uniforms.uDebugMode.value = debugModes.get(mode) ?? 0;
    },
    updateCamera(camera) {
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(uniforms.uRayForward.value);
      uniforms.uRayOrigin.value.copy(camera.position);
      uniforms.uRayRight.value
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      uniforms.uRayUp.value
        .set(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
    },
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
