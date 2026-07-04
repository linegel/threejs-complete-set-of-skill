// Legacy shadow helper retained for historical context only. Do not extend this
// file from the buildings skill; use ../webgpu-material-slot-compiler/ for
// current architecture examples and the shadow skill for shadow algorithms.
import * as THREE from "three";

const BIAS_MATRIX = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

export function createCachedShadowClipmaps(renderer, scene, receiver) {
  const direction = new THREE.Vector3(-0.56, -1, -0.42).normalize();
  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), direction)
    .normalize();
  const lightUp = new THREE.Vector3().crossVectors(direction, right).normalize();
  const worldToLight = new THREE.Matrix4()
    .makeBasis(right, lightUp, direction)
    .invert();
  const halfWidths = [72, 72 * 2.15, 72 * 2.15 * 2.15];
  const mapSizes = [2048, 1024, 512];
  const guardBand = 0.16;
  const states = halfWidths.map((halfWidth, index) => {
    const renderedHalfWidth = halfWidth / (1 - guardBand);
    const camera = new THREE.OrthographicCamera(
      -renderedHalfWidth,
      renderedHalfWidth,
      renderedHalfWidth,
      -renderedHalfWidth,
      1,
      520,
    );
    camera.up.copy(lightUp);
    const target = new THREE.WebGLRenderTarget(mapSizes[index], mapSizes[index], {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.depthTexture = new THREE.DepthTexture(
      mapSizes[index],
      mapSizes[index],
      THREE.UnsignedIntType,
    );
    target.depthTexture.format = THREE.DepthFormat;
    target.depthTexture.type = THREE.UnsignedIntType;
    return {
      halfWidth,
      renderedHalfWidth,
      mapSize: mapSizes[index],
      texelWidth: (renderedHalfWidth * 2) / mapSizes[index],
      camera,
      target,
      centerX: Number.NaN,
      centerY: Number.NaN,
      centerZ: Number.NaN,
      valid: false,
      forceDirty: true,
      age: 0,
      updates: 0,
    };
  });
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
    side: THREE.DoubleSide,
  });
  const committedCenters = states.map(
    () => new THREE.Vector4(0, 0, 1, 1),
  );
  const shadowMatrices = states.map(() => new THREE.Matrix4());

  const uniforms = {
    uShadowMap0: { value: states[0].target.depthTexture },
    uShadowMap1: { value: states[1].target.depthTexture },
    uShadowMap2: { value: states[2].target.depthTexture },
    uShadowMatrix0: { value: shadowMatrices[0] },
    uShadowMatrix1: { value: shadowMatrices[1] },
    uShadowMatrix2: { value: shadowMatrices[2] },
    uLevel0: { value: committedCenters[0] },
    uLevel1: { value: committedCenters[1] },
    uLevel2: { value: committedCenters[2] },
    uWorldToLight: { value: worldToLight },
    uLightDirection: { value: direction.clone().negate() },
    uDebugMode: { value: 0 },
  };

  const centerWorld = new THREE.Vector3();
  const anchorLight = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const previousTarget = new THREE.WebGLRenderTarget();

  function renderLevel(state) {
    centerWorld
      .copy(right)
      .multiplyScalar(state.centerX)
      .addScaledVector(lightUp, state.centerY)
      .addScaledVector(direction, state.centerZ);
    state.camera.position
      .copy(centerWorld)
      .addScaledVector(direction, -100);
    lookTarget.copy(centerWorld);
    state.camera.lookAt(lookTarget);
    state.camera.updateMatrixWorld(true);
    state.camera.updateProjectionMatrix();

    receiver.visible = false;
    const oldOverride = scene.overrideMaterial;
    scene.overrideMaterial = depthMaterial;
    const activeTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(state.target);
    renderer.clear();
    renderer.render(scene, state.camera);
    renderer.setRenderTarget(activeTarget);
    scene.overrideMaterial = oldOverride;
    receiver.visible = true;

    const index = states.indexOf(state);
    shadowMatrices[index]
      .copy(BIAS_MATRIX)
      .multiply(state.camera.projectionMatrix)
      .multiply(state.camera.matrixWorldInverse);
    committedCenters[index].set(
      state.centerX,
      state.centerY,
      state.halfWidth,
      state.texelWidth,
    );
    state.valid = true;
    state.forceDirty = false;
    state.age = 0;
    state.updates += 1;
  }

  function update(camera) {
    anchor.set(camera.position.x, 0, camera.position.z);
    anchorLight.copy(anchor).applyMatrix4(worldToLight);
    let budget = states.some((state) => !state.valid) ? states.length : 1;

    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      state.age += 1;
      const desiredX =
        Math.round(anchorLight.x / state.texelWidth) * state.texelWidth;
      const desiredY =
        Math.round(anchorLight.y / state.texelWidth) * state.texelWidth;
      const quantumZ = state.halfWidth * 0.5;
      const desiredZ =
        Math.round(anchorLight.z / quantumZ) * quantumZ;
      const moved =
        desiredX !== state.centerX ||
        desiredY !== state.centerY ||
        desiredZ !== state.centerZ;
      const dynamic = index === 0;
      const expired = state.age >= 120;
      const dirty =
        dynamic ||
        !state.valid ||
        state.forceDirty ||
        moved ||
        expired;
      const canRender = dynamic || state.forceDirty || budget > 0;

      if (dirty && canRender) {
        if (!dynamic && !state.forceDirty) budget -= 1;
        state.centerX = desiredX;
        state.centerY = desiredY;
        state.centerZ = desiredZ;
        renderLevel(state);
      }
    }
  }

  function dispose() {
    depthMaterial.dispose();
    for (const state of states) state.target.dispose();
    previousTarget.dispose();
  }

  return { uniforms, states, update, dispose };
}

export function createShadowReceiverMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uShadowMap0;
      uniform sampler2D uShadowMap1;
      uniform sampler2D uShadowMap2;
      uniform mat4 uShadowMatrix0;
      uniform mat4 uShadowMatrix1;
      uniform mat4 uShadowMatrix2;
      uniform vec4 uLevel0;
      uniform vec4 uLevel1;
      uniform vec4 uLevel2;
      uniform mat4 uWorldToLight;
      uniform vec3 uLightDirection;
      uniform int uDebugMode;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float compareDepth(
        sampler2D shadowMap,
        mat4 shadowMatrix,
        vec3 worldPosition,
        float texelWidth
      ) {
        vec4 shadowCoord = shadowMatrix * vec4(
          worldPosition + vWorldNormal * texelWidth * 0.55,
          1.0
        );
        shadowCoord.xyz /= shadowCoord.w;
        if (
          shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
          shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
          shadowCoord.z < 0.0 || shadowCoord.z > 1.0
        ) return 1.0;
        float sum = 0.0;
        vec2 texel = vec2(1.0 / 1024.0);
        for (int x = -1; x <= 1; x += 1) {
          for (int y = -1; y <= 1; y += 1) {
            float depth = texture2D(
              shadowMap,
              shadowCoord.xy + vec2(float(x), float(y)) * texel
            ).r;
            sum += shadowCoord.z - texelWidth * 0.00045 <= depth
              ? 1.0
              : 0.24;
          }
        }
        return sum / 9.0;
      }

      float levelFade(vec2 lightPosition, vec4 level) {
        float distanceToCenter = max(
          abs(lightPosition.x - level.x),
          abs(lightPosition.y - level.y)
        );
        return 1.0 - smoothstep(
          level.z * 0.85,
          level.z,
          distanceToCenter
        );
      }

      void main() {
        vec3 lightPosition =
          (uWorldToLight * vec4(vWorldPosition, 1.0)).xyz;
        float fade0 = levelFade(lightPosition.xy, uLevel0);
        float fade1 = levelFade(lightPosition.xy, uLevel1);
        float fade2 = levelFade(lightPosition.xy, uLevel2);
        float remaining = 1.0;
        float weight0 = fade0 * remaining;
        remaining *= 1.0 - fade0;
        float weight1 = fade1 * remaining;
        remaining *= 1.0 - fade1;
        float weight2 = fade2 * remaining;
        remaining *= 1.0 - fade2;

        float shadow0 = compareDepth(
          uShadowMap0,
          uShadowMatrix0,
          vWorldPosition,
          uLevel0.w
        );
        float shadow1 = compareDepth(
          uShadowMap1,
          uShadowMatrix1,
          vWorldPosition,
          uLevel1.w
        );
        float shadow2 = compareDepth(
          uShadowMap2,
          uShadowMatrix2,
          vWorldPosition,
          uLevel2.w
        );
        float shadow =
          shadow0 * weight0 +
          shadow1 * weight1 +
          shadow2 * weight2 +
          remaining;
        if (uDebugMode == 6) shadow = 1.0;

        vec3 base = vec3(0.12, 0.125, 0.12);
        float aggregate =
          sin(vWorldPosition.x * 0.18) *
          sin(vWorldPosition.z * 0.18) * 0.035;
        base += aggregate;
        float diffuse = max(
          dot(normalize(vWorldNormal), normalize(uLightDirection)),
          0.0
        );
        vec3 color = base * (0.32 + diffuse * 0.68) * shadow;

        if (uDebugMode == 4) {
          color =
            vec3(0.95, 0.34, 0.16) * weight0 +
            vec3(0.18, 0.78, 0.95) * weight1 +
            vec3(0.55, 0.32, 0.95) * weight2 +
            vec3(0.08) * remaining;
          color *= 0.55 + shadow * 0.45;
        } else if (uDebugMode == 5) {
          vec4 activeLevel = weight0 > 0.01
            ? uLevel0
            : weight1 > 0.01
              ? uLevel1
              : uLevel2;
          vec2 cell = abs(
            fract(
              (lightPosition.xy - activeLevel.xy) /
              activeLevel.w
            ) - 0.5
          );
          float line = 1.0 - smoothstep(0.44, 0.49, max(cell.x, cell.y));
          color = mix(vec3(0.055, 0.07, 0.08), vec3(0.95, 0.8, 0.28), line);
        }

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
