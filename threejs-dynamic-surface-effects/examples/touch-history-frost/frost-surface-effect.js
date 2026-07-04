// Legacy WebGL implementation (deprecated, do not extend). The active
// WebGPU/TSL contract lives in ../webgpu-touch-history-frost/.
import * as THREE from "three";

const fullscreenVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

function material(fragmentShader, uniforms = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fullscreenVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

function target(width, height, options = {}) {
  return new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    ...options,
  });
}

function createBlurMaterial(kernelSize = 10) {
  const weights = [];
  let total = 0;
  for (let index = kernelSize - 1; index >= 0; index -= 1) {
    const radius = 1 + 2 * index;
    let weight = Math.exp(
      (-0.5 * radius * radius) / (kernelSize * kernelSize),
    );
    weights.push(weight);
    total += index > 0 ? weight * 2 : weight;
  }
  const values = weights
    .map((weight) => (weight / total).toFixed(7))
    .join(", ");

  return material(
    `
      #define KERNEL_SIZE ${kernelSize}
      const float WEIGHTS[KERNEL_SIZE] =
        float[KERNEL_SIZE](${values});
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      uniform vec2 uDirection;
      varying vec2 vUv;

      void main() {
        vec4 sum = vec4(0.0);
        float weightSum = 0.0;
        for (int index = 0; index < KERNEL_SIZE - 1; index += 1) {
          float weight = WEIGHTS[index];
          float offset = float(KERNEL_SIZE - 1 - index);
          vec2 delta = uTexel * uDirection * offset;
          vec4 left = texture2D(uSource, vUv - delta);
          vec4 right = texture2D(uSource, vUv + delta);
          sum += (left + right) * weight;
          weightSum += weight * 2.0;
        }
        float centerWeight = WEIGHTS[KERNEL_SIZE - 1];
        sum += texture2D(uSource, vUv) * centerWeight;
        weightSum += centerWeight;
        gl_FragColor = sum / max(weightSum, 1e-5);
      }
    `,
    {
      uSource: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uDirection: { value: new THREE.Vector2(1, 0) },
    },
  );
}

function createFrostNoiseMaterial() {
  return material(`
    varying vec2 vUv;
    const float PI = 3.14159265359;

    float randomValue(vec2 point) {
      float phase = mod(dot(point, vec2(0.129898, 0.78233)), PI);
      return fract(sin(phase) * 437.585453);
    }

    float interpolatedNoise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      vec2 curve = (1.0 - cos(local * PI)) * 0.5;
      float a = randomValue(cell);
      float b = randomValue(cell + vec2(1.0, 0.0));
      float c = randomValue(cell + vec2(0.0, 1.0));
      float d = randomValue(cell + 1.0);
      return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
    }

    float layeredNoise(vec2 point) {
      float value = 0.0;
      value += interpolatedNoise(point) * 0.25;
      value += interpolatedNoise(point * 0.5) * 0.5;
      return value;
    }

    float warpedNoise(vec2 point) {
      float value = 0.0;
      for (int index = 0; index < 2; index += 1) {
        value = layeredNoise(
          point + 4.0 * vec2(cos(value * 2.0), sin(value * 2.0))
        );
      }
      return value;
    }

    void main() {
      float frost = warpedNoise(vUv * 20.0);
      gl_FragColor = vec4(vec3(frost), 1.0);
    }
  `);
}

function createFrozenNoiseMaterial() {
  return material(
    `
      uniform sampler2D uNoiseMap;
      varying vec2 vUv;

      float randomValue(vec2 uv) {
        uv = floor(uv * 5000.0) / 5000.0;
        float a = dot(uv, vec2(92.0, 80.0));
        float b = dot(uv, vec2(41.0, 62.0));
        return fract(sin(a) + cos(b) * 51.0);
      }

      void main() {
        vec4 source = texture2D(uNoiseMap, vUv);
        vec2 crystals = vec2(
          randomValue(vUv + source.r * 0.05),
          randomValue(vUv + source.b * 0.05)
        ) * source.rg;
        gl_FragColor = vec4(crystals, 0.0, 1.0);
      }
    `,
    { uNoiseMap: { value: null } },
  );
}

function createHighlightNoiseMaterial() {
  return material(
    `
      uniform sampler2D uNoiseMap;
      varying vec2 vUv;

      float randomValue(vec2 uv) {
        uv = floor(uv * 5000.0) / 5000.0;
        float a = dot(uv, vec2(92.0, 80.0));
        float b = dot(uv, vec2(41.0, 62.0));
        return fract(sin(a) + cos(b) * 51.0);
      }

      void main() {
        float source = texture2D(uNoiseMap, vUv).r;
        float crystal = smoothstep(
          0.85,
          1.0,
          randomValue(vUv + source * 0.05)
        );
        gl_FragColor = vec4(vec3(crystal), 1.0);
      }
    `,
    { uNoiseMap: { value: null } },
  );
}

function createDebugDisplayMaterial() {
  return material(
    `
      uniform sampler2D uSource;
      uniform int uChannel;
      varying vec2 vUv;

      void main() {
        vec4 value = texture2D(uSource, vUv);
        if (uChannel == 1) {
          value = vec4(vec3(value.r), 1.0);
        } else if (uChannel == 2) {
          value = vec4(vec3(value.a), 1.0);
        }
        gl_FragColor = value;
      }
    `,
    {
      uSource: { value: null },
      uChannel: { value: 0 },
    },
  );
}

function createPointerMaterial() {
  return material(
    `
      uniform sampler2D uPrevious;
      uniform sampler2D uNoiseMap;
      uniform sampler2D uFrostNoise;
      uniform vec2 uPointer;
      uniform float uAspect;
      uniform float uTouching;
      uniform float uDecay;
      varying vec2 vUv;

      float contrast(float value, float amount) {
        return clamp((value - 0.5) * amount + 0.5, 0.0, 1.0);
      }

      float brushMask(float distanceValue) {
        float mask = 1.0 - smoothstep(0.15, 0.17, distanceValue);
        float radialEdge = 1.0 - smoothstep(
          0.5,
          0.6,
          length(vUv - vec2(0.5))
        );
        vec2 edgeDistance = min(vUv, 1.0 - vUv);
        float sideEdge = smoothstep(
          0.0,
          0.5,
          min(edgeDistance.x, edgeDistance.y)
        );
        return mask * 0.3 * radialEdge * sideEdge * uTouching;
      }

      void main() {
        vec4 previous = texture2D(uPrevious, vUv);
        float visible = max(previous.r - uDecay, 0.0);
        float tilt = max(previous.a - uDecay, 0.0);

        vec2 center = uPointer * 0.5 + 0.5;
        center.x *= uAspect;
        vec2 uv = vUv;
        uv.x *= uAspect;
        float distanceValue = length(uv - center);

        float textureNoise = contrast(
          texture2D(uNoiseMap, vUv * 1.5).r,
          1.5
        );
        float frostNoise = texture2D(uFrostNoise, vUv).r;
        float roughDistance =
          distanceValue + textureNoise * 0.16 + frostNoise * 0.1;
        float tiltDistance =
          distanceValue + (textureNoise * 0.16 + frostNoise * 0.1) * 0.5;

        visible = clamp(visible + brushMask(roughDistance), 0.0, 1.0);
        tilt = clamp(tilt + brushMask(tiltDistance), 0.0, 1.0);
        gl_FragColor = vec4(vec3(visible), tilt);
      }
    `,
    {
      uPrevious: { value: null },
      uNoiseMap: { value: null },
      uFrostNoise: { value: null },
      uPointer: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
      uTouching: { value: 0 },
      uDecay: { value: 0.002 },
    },
  );
}

function createFrostCompositeMaterial() {
  return material(
    `
      uniform sampler2D uScene;
      uniform sampler2D uBlurredScene;
      uniform sampler2D uFrostNoise;
      uniform sampler2D uFrozenNoise;
      uniform sampler2D uHighlightNoise;
      uniform sampler2D uPointer;
      uniform int uDebugMode;
      varying vec2 vUv;

      float contrast(float value, float amount) {
        return clamp((value - 0.5) * amount + 0.5, 0.0, 1.0);
      }

      vec3 rgbToHsv(vec3 colorValue) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(
          vec4(colorValue.bg, K.wz),
          vec4(colorValue.gb, K.xy),
          step(colorValue.b, colorValue.g)
        );
        vec4 q = mix(
          vec4(p.xyw, colorValue.r),
          vec4(colorValue.r, p.yzx),
          step(p.x, colorValue.r)
        );
        float d = q.x - min(q.w, q.y);
        return vec3(
          abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)),
          d / (q.x + 1e-10),
          q.x
        );
      }

      vec3 hsvToRgb(vec3 hsv) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
        return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
      }

      void main() {
        float clearMask = 1.0 - texture2D(uPointer, vUv).r;
        float crystalline = texture2D(uFrozenNoise, vUv).r;
        float highlight = texture2D(uHighlightNoise, vUv).r;
        float structure = mix(crystalline, highlight, 0.3);
        float coarse = contrast(
          texture2D(uFrostNoise, vUv).r * 1.7,
          1.6
        );

        float fullMask = contrast(structure + coarse, 1.8);
        float appliedMask = contrast(
          structure + coarse * clearMask,
          1.8
        ) * clearMask;

        vec4 sharp = texture2D(uScene, vUv);
        vec4 blurred = texture2D(uBlurredScene, vUv);
        vec4 outputValue = mix(
          sharp,
          blurred,
          clamp(clearMask * (appliedMask + 0.3), 0.0, 1.0)
        );
        outputValue.rgb *= vec3(0.9, 0.9, 1.03);
        vec3 hsv = rgbToHsv(outputValue.rgb);
        hsv.y = clamp(hsv.y * 1.2, 0.0, 1.0);
        hsv.z = clamp(hsv.z * 0.7, 0.0, 1.0);
        outputValue.rgb = hsvToRgb(hsv);

        vec3 frostTint = mix(
          vec3(0.82, 0.86, 1.05),
          vec3(0.92, 0.96, 1.1),
          coarse
        );
        vec3 frostColor = mix(outputValue.rgb, frostTint, 0.7);
        frostColor = mix(frostColor, vec3(1.0), highlight * 0.8);
        outputValue.rgb = clamp(
          mix(outputValue.rgb, frostColor, appliedMask),
          0.0,
          1.0
        );

        if (uDebugMode == 1) {
          outputValue.rgb = vec3(appliedMask);
        } else if (uDebugMode == 2) {
          outputValue.rgb = vec3(fullMask);
        }
        outputValue.a = fullMask;
        gl_FragColor = outputValue;
      }
    `,
    {
      uScene: { value: null },
      uBlurredScene: { value: null },
      uFrostNoise: { value: null },
      uFrozenNoise: { value: null },
      uHighlightNoise: { value: null },
      uPointer: { value: null },
      uDebugMode: { value: 0 },
    },
  );
}

function createOutputMaterial() {
  return material(
    `
      uniform sampler2D uFrost;
      uniform sampler2D uPointer;
      uniform sampler2D uMainNormal;
      uniform sampler2D uDetailNormal;
      uniform float uMainNormalSize;
      uniform float uDetailNormalSize;
      uniform vec2 uTilt;
      varying vec2 vUv;

      mat3 rotateX(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(1, 0, 0, 0, c, -s, 0, s, c);
      }

      mat3 rotateY(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
      }

      vec2 refractionOffset(
        sampler2D normalMap,
        float textureSizeValue,
        float scale,
        vec3 viewDirection
      ) {
        vec2 mapUv = gl_FragCoord.xy / textureSizeValue;
        vec3 normalValue =
          texture2D(normalMap, mapUv).xyz * 2.0 - 1.0;
        vec3 refraction = refract(
          -viewDirection,
          normalize(normalValue),
          1.0 / 1.31
        );
        return refraction.xy * scale;
      }

      void main() {
        vec4 pointerValue = texture2D(uPointer, vUv);
        float untouched = 1.0 - pointerValue.r;
        vec2 baseUv = (vUv - 0.5) * 0.66 + 0.5;
        float frostMask = texture2D(uFrost, baseUv).a;
        float tiltStrength = pointerValue.a * 0.8;
        vec3 viewDirection = rotateY(uTilt.x * 0.05 * tiltStrength)
          * rotateX(uTilt.y * 0.05 * tiltStrength)
          * vec3(0.0, 0.0, 1.0);

        vec2 offset = refractionOffset(
          uMainNormal,
          uMainNormalSize,
          0.3,
          viewDirection
        );
        offset += refractionOffset(
          uDetailNormal,
          uDetailNormalSize,
          2.0,
          viewDirection
        );

        vec2 refractedUv = clamp(baseUv + offset, 0.0, 1.0);
        vec3 baseColor = texture2D(uFrost, vUv).rgb;
        vec3 refractedColor = texture2D(uFrost, refractedUv).rgb;
        float mixAmount = clamp(
          untouched * frostMask * 1.8,
          0.0,
          1.0
        );
        gl_FragColor = vec4(
          mix(baseColor, refractedColor, mixAmount),
          1.0
        );
      }
    `,
    {
      uFrost: { value: null },
      uPointer: { value: null },
      uMainNormal: { value: null },
      uDetailNormal: { value: null },
      uMainNormalSize: { value: 1200 },
      uDetailNormalSize: { value: 350 },
      uTilt: { value: new THREE.Vector2() },
    },
  );
}

export class FrostSurfaceEffect {
  constructor(
    renderer,
    {
      sceneTexture,
      noiseTexture,
      mainNormalTexture,
      detailNormalTexture,
      lowResolutionScale = 0.4,
    },
  ) {
    this.renderer = renderer;
    this.sceneTexture = sceneTexture;
    this.lowResolutionScale = lowResolutionScale;
    this.pointer = new THREE.Vector2();
    this.touching = false;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.blur = createBlurMaterial();
    this.frostNoise = createFrostNoiseMaterial();
    this.frozenNoise = createFrozenNoiseMaterial();
    this.highlightNoise = createHighlightNoiseMaterial();
    this.debugDisplay = createDebugDisplayMaterial();
    this.pointerMaterial = createPointerMaterial();
    this.frostComposite = createFrostCompositeMaterial();
    this.output = createOutputMaterial();

    this.blur.uniforms.uSource.value = sceneTexture;
    this.frostComposite.uniforms.uScene.value = sceneTexture;
    this.frozenNoise.uniforms.uNoiseMap.value = noiseTexture;
    this.highlightNoise.uniforms.uNoiseMap.value = noiseTexture;
    this.pointerMaterial.uniforms.uNoiseMap.value = noiseTexture;
    this.output.uniforms.uMainNormal.value = mainNormalTexture;
    this.output.uniforms.uDetailNormal.value = detailNormalTexture;

    this.verticalBlur = target(1, 1);
    this.horizontalBlur = target(1, 1);
    this.frostTarget = target(1, 1);
    this.pointerRead = target(1, 1, { type: THREE.HalfFloatType });
    this.pointerWrite = target(1, 1, { type: THREE.HalfFloatType });
    this.frostNoiseTarget = target(1, 1);
    this.frozenNoiseTarget = target(1, 1);
    this.highlightNoiseTarget = target(1, 1);
    this.width = 1;
    this.height = 1;
    this.staticDirty = true;
    this.debugMode = "final";
    this.clearHistory();
  }

  renderMaterial(materialValue, outputTarget) {
    this.quad.material = materialValue;
    this.renderer.setRenderTarget(outputTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  clearHistory() {
    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const historyTarget of [this.pointerRead, this.pointerWrite]) {
      this.renderer.setRenderTarget(historyTarget);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(previousColor, previousAlpha);
  }

  resize(width, height) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;

    const lowWidth = Math.max(
      1,
      Math.round(nextWidth * this.lowResolutionScale),
    );
    const lowHeight = Math.max(
      1,
      Math.round(nextHeight * this.lowResolutionScale),
    );
    this.verticalBlur.setSize(lowWidth, lowHeight);
    this.horizontalBlur.setSize(lowWidth, lowHeight);
    this.frostTarget.setSize(nextWidth, nextHeight);
    this.pointerRead.setSize(nextWidth, nextHeight);
    this.pointerWrite.setSize(nextWidth, nextHeight);
    this.frostNoiseTarget.setSize(lowWidth, lowHeight);
    this.frozenNoiseTarget.setSize(nextWidth, nextHeight);
    this.highlightNoiseTarget.setSize(nextWidth, nextHeight);
    this.blur.uniforms.uTexel.value.set(1 / lowWidth, 1 / lowHeight);
    this.pointerMaterial.uniforms.uAspect.value = nextWidth / nextHeight;
    this.staticDirty = true;
    this.clearHistory();
  }

  setPointer(ndcX, ndcY, touching = true) {
    this.pointer.set(ndcX, ndcY);
    this.touching = touching;
  }

  setTilt(x, y) {
    this.output.uniforms.uTilt.value.set(x, y);
  }

  setDebugMode(mode) {
    this.debugMode = mode;
  }

  update(deltaSeconds) {
    if (this.staticDirty) {
      this.renderMaterial(this.frostNoise, this.frostNoiseTarget);
      this.renderMaterial(this.frozenNoise, this.frozenNoiseTarget);
      this.renderMaterial(this.highlightNoise, this.highlightNoiseTarget);
      this.staticDirty = false;
    }

    this.blur.uniforms.uSource.value = this.sceneTexture;
    this.blur.uniforms.uDirection.value.set(0, 1);
    this.renderMaterial(this.blur, this.verticalBlur);
    this.blur.uniforms.uSource.value = this.verticalBlur.texture;
    this.blur.uniforms.uDirection.value.set(1, 0);
    this.renderMaterial(this.blur, this.horizontalBlur);

    this.pointerMaterial.uniforms.uPrevious.value = this.pointerRead.texture;
    this.pointerMaterial.uniforms.uFrostNoise.value =
      this.frostNoiseTarget.texture;
    this.pointerMaterial.uniforms.uPointer.value.copy(this.pointer);
    this.pointerMaterial.uniforms.uTouching.value = this.touching ? 1 : 0;
    this.pointerMaterial.uniforms.uDecay.value =
      0.002 * Math.max(deltaSeconds * 60, 0.25);
    this.renderMaterial(this.pointerMaterial, this.pointerWrite);
    [this.pointerRead, this.pointerWrite] = [
      this.pointerWrite,
      this.pointerRead,
    ];

    this.frostComposite.uniforms.uBlurredScene.value =
      this.horizontalBlur.texture;
    this.frostComposite.uniforms.uFrostNoise.value =
      this.frostNoiseTarget.texture;
    this.frostComposite.uniforms.uFrozenNoise.value =
      this.frozenNoiseTarget.texture;
    this.frostComposite.uniforms.uHighlightNoise.value =
      this.highlightNoiseTarget.texture;
    this.frostComposite.uniforms.uPointer.value = this.pointerRead.texture;
    this.renderMaterial(this.frostComposite, this.frostTarget);

    this.output.uniforms.uFrost.value = this.frostTarget.texture;
    this.output.uniforms.uPointer.value = this.pointerRead.texture;
  }

  render() {
    const debugSource = {
      "root-scene": [this.sceneTexture, 0],
      blur: [this.horizontalBlur.texture, 0],
      "history-previous": [this.pointerWrite.texture, 1],
      deposit: [this.pointerRead.texture, 1],
      "history-next": [this.pointerRead.texture, 1],
      structure: [this.frozenNoiseTarget.texture, 0],
      "frost-mask": [this.frostTarget.texture, 2],
      "no-refraction": [this.frostTarget.texture, 0],
    }[this.debugMode];
    if (debugSource) {
      this.debugDisplay.uniforms.uSource.value = debugSource[0];
      this.debugDisplay.uniforms.uChannel.value = debugSource[1];
      this.renderMaterial(this.debugDisplay, null);
      return;
    }
    this.renderMaterial(this.output, null);
  }

  dispose() {
    this.quad.geometry.dispose();
    for (const materialValue of [
      this.blur,
      this.frostNoise,
      this.frozenNoise,
      this.highlightNoise,
      this.debugDisplay,
      this.pointerMaterial,
      this.frostComposite,
      this.output,
    ]) {
      materialValue.dispose();
    }
    for (const renderTarget of [
      this.verticalBlur,
      this.horizontalBlur,
      this.frostTarget,
      this.pointerRead,
      this.pointerWrite,
      this.frostNoiseTarget,
      this.frozenNoiseTarget,
      this.highlightNoiseTarget,
    ]) {
      renderTarget.dispose();
    }
  }
}
