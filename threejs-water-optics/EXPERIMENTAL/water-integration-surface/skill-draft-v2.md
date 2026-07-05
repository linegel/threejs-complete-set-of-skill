# Water Integration Skill Draft V2

Use this draft to update the checked-in skill only after the experimental demo
has passed. Scope: integrate a high-end WebGPU water module into an existing
Three.js project. Do not design a monolithic app framework.

## Boundary

The host project owns:

- renderer, canvas sizing, camera, controls, scene graph, and asset loading;
- opaque color/depth prepass scene that excludes the water surface;
- transparent-object policy and render order;
- physics bodies, network tick, and authority model;
- post-processing chain and output transform;
- screen-space masks and their lifetime.

The water module owns:

- WebGPU-only simulation state and surface material;
- fixed-step update of GPU-resident height/velocity/slope/caustic textures;
- depth-aware refraction input nodes from the host opaque pass;
- analytic surface query for CPU-side consumers;
- impulse ingress for drops, objects, wakes, and probes;
- diagnostic modes and validation evidence.

No WebGL path belongs in this skill. Missing WebGPU is a hard blocker unless
the user explicitly asks for teaching how to apply fallback when WebGPU is
unavailable.

## Host Contract

Minimum integration shape:

```js
const water = await createWebGPUWaterSystem(renderer, {
  scene,
  opaqueScene,
  camera,
  quality: "high",
  preset: "tropicalCoast",
  time: fixedTickTimeNode,
});

scene.add(water.mesh);

function frame(dt) {
  clock.step(dt, (fixedDt, tick) => {
    water.updateFixed(fixedDt, tick);
    buoyancy.update(water.surfaceQuery, fixedDt, tick);
    spray.update(water.surfaceQuery, fixedDt, tick);
  });

  water.renderOpaqueInputs();
  renderer.render(scene, camera);
}
```

The host must not add `water.mesh` to the opaque prepass scene. That prepass
exists so water refraction can sample scene color and depth without recursive
self-sampling.

## Presets

Presets are project-level parameter bundles, not global scene ownership.

Allowed preset fields:

```ts
type WaterPreset = {
  simulation: {
    worldSize: [number, number];
    waveSpeed: number;
    damping: number;
    dropStrength: number;
    objectDisplacementScale: number;
  };
  optics: {
    absorptionPerMeter: [number, number, number];
    refractionStrength: number;
    roughness: number;
    deepBodyColor: [number, number, number];
    shallowScatterColor: [number, number, number];
  };
  foam: {
    crestThreshold: number;
    impulseGain: number;
    decay: number;
  };
  sprayDefaults?: SprayDefaults;
  qualityPreference?: "low" | "medium" | "high" | "ultra";
  hostSkyHint?: unknown;
};
```

`hostSkyHint` is advisory. The host applies sky, fog, and lighting through its
own scene systems.

## Quality Levels

Quality tiers choose WebGPU budgets, not alternate rendering stacks.

| Tier | Sim grid | Mesh segments | Fixed step | Max substeps | Bands | Refraction | Caustics |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| Low | 128 | 96-128 | 1/60 | 2 | 2-3 displaced | clamped depth-aware or body color | low-res compute |
| Medium | 192-256 | 128-192 | 1/90 | 2-3 | 3-4 displaced + 1 micro | half-res depth-aware | compute |
| High | 256-512 | 192-256 | 1/120 | 3 | 4 displaced + 3 micro | depth-aware | compute |
| Ultra | 512-1024 | 256+ | 1/120-1/240 | 4 | 5 displaced + 4 micro | full-res depth-aware | compute |

Each tier must pass CFL/Courant stability:

```text
c = waveSpeed * fixedDt / minCellSize <= 1 / sqrt(2)
```

Changing quality at runtime is a resource rebuild. Preserve host-level state:
tick, preset name, registered masks, buoyancy registrations, spray emitters,
and transparent ordering policy.

## Buoyancy

Buoyancy is a host/physics concern, but the skill must provide the query
contract:

```js
const surface = water.createSurfaceQuery();
const sample = surface.sampleHeightNormal(x, z, tick);
```

Rules:

- no per-frame GPU readback;
- multi-point objects use stable local-space samples;
- total active samples stay under 128 unless a project budget says otherwise;
- single-point objects may scale to 128 bodies;
- five-sample hulls scale to about 25 bodies;
- query results include `height`, approximate `normal`, `velocity`, and
  `residualBound`;
- residual from live GPU impulses is explicitly bounded when not queried on CPU;
- object motion feeds the GPU surface through `submitObjectImpulse()`.

The analytic query is suitable for broad floating, camera clearance, and spray
crossing tests. It is not a substitute for reading the live compute heightfield
inside the frame.

## Deterministic Tick

Networked scenes must drive water from an authoritative integer tick.

```js
water.setDeterministic({ enabled: true, stepSize: 1 / 60 });
water.syncToTick(authoritativeTick);
water.updateFixed(stepSize, authoritativeTick);
```

Rules:

- shader time is `tick * stepSize`, not wall-clock time;
- catch-up steps are capped to 2-4 per visual frame;
- seeded drops, spray jitter, and wake probes use deterministic integer hashes;
- tick wrap is handled modulo a documented period;
- changing deterministic mode resets the fractional accumulator.

## Spray

Spray is an emitter/probe system coupled to the surface query.

```ts
type SprayEmitter = {
  object: Object3D;
  probes: Array<{
    local: Vector3;
    enabled?: boolean;
    velocityThreshold?: number;
    size?: number;
    opacity?: number;
    stretchX?: number;
    stretchY?: number;
  }>;
};
```

Trigger condition:

```text
previousSignedDistance > 0
currentSignedDistance <= 0
abs(deltaSignedDistance / dt) >= velocityThreshold
```

Per-probe visual parameters are frozen at spawn. Probe indices stay stable when
disabled. System defaults are overridden by emitter values, then probe values.

## Transparent Objects

Water refraction samples opaque scene color and depth. Transparent host objects
must be excluded from that prepass and rendered after water, unless a project
implements a separate order-independent transparency path.

Policy:

- `MeshStandardNodeMaterial` or equivalent transparent materials render after
  water with `depthWrite = false`;
- alpha-tested cutouts may remain in the opaque depth pass;
- physically transmitted glass/liquid materials need a separate design because
  they require their own transmission pipeline and depth policy.

## Screen-Space Masking

A production integration needs a host-owned mask registry plus a water-owned
mask sample in the material.

```js
const mask = water.masking.add(maskMesh, {
  space: "screen",
  channel: "hullInterior",
  dilationPixels: 1,
});
```

Required contract:

- mask meshes are invisible in the main scene;
- the host renders registered masks to a screen-space `NoColorSpace` mask
  texture before the water pass;
- the water material discards or alpha-fades fragments where the mask is set;
- masks are skipped when the registry is empty;
- validation includes a hull/interior camera where masked water is absent.

Current experiment finding: the checked-in water core has only a host-side mask
registry. It needs the mask texture/pass/material hook before hull interiors are
correct.

## Post Processing

Water effects must feed the host post stack in this order:

1. opaque scene/depth prepass;
2. water material refraction/absorption/reflection/foam;
3. underwater haze or fog that depends on depth;
4. anti-aliasing;
5. bloom/glints;
6. film grain, vignette, grading, and final output transform.

The host owns the final output conversion. Do not tone map inside the water
material.

## Wave Tuning

Bounded authored water uses shared analytic bands for displacement, normals,
foam, spray, and CPU queries. If the project needs JONSWAP/FFT cascades,
directional spreading, spectral sharpness, or persistent ocean foam, route the
surface provider to the spectral-ocean skill and keep this integration contract:

```ts
type SurfaceProvider = {
  updateFixed(dt: number, tick: number): void;
  sampleHeightNormal(x: number, z: number, tick: number): SurfaceSample;
  submitImpulse(impulse: SurfaceImpulse): void;
  getMaterialInputs(): WaterMaterialInputs;
};
```

## Validation Gates

The validator must fail on:

- non-WebGPU backend;
- browser console `GPUValidationError`;
- blank page screenshot accepted as evidence;
- render-target readback with invalid row stride;
- readback image range too flat;
- water in the opaque refraction prepass;
- transparent object included in opaque depth inputs;
- buoyancy sample budget above 128;
- spray probes that cannot fire under a forced crossing;
- deterministic `syncToTick()` that does not land on the next fixed step;
- screen-space masks claimed as implemented without a mask texture and material
  hook.

WGSL note: compute Fresnel `F0` as multiplication:

```js
const r = (etaA - etaB) / (etaA + etaB);
const F0 = r * r;
```

Do not emit `pow(negativeAbstractFloat, 2.0)`.
