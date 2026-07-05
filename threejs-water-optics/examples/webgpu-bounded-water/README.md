# WebGPU Bounded Water

Canonical WebGPU/TSL example for `threejs-water-optics`. It demonstrates the production path from the skill: bounded heightfield simulation in ping-ponged `StorageTexture` state, fixed-step `Fn().compute()` kernels, differential-area caustics, and a `MeshPhysicalNodeMaterial` water surface with side-aware Fresnel, Beer-Lambert absorption, depth-aware refraction, and debug views.

Legacy render-target ping-pong is intentionally not used.

## Dispatch Graph

```text
input drop/object impulse
  -> resetDiagnostics
  -> dropAndImpulseAB / dropAndImpulseBA
  -> propagateBA / propagateAB
  -> normalCausticFromA / normalCausticFromB
  -> MeshPhysicalNodeMaterial samples state + normal/caustic + scene color/depth
  -> optional RenderPipeline owns renderOutput()
```

State layout:

```text
state.r = height
state.g = velocity
state.b = foam/impulse accumulator
state.a = boundary validity

normalCaustic.rg = packed slope
normalCaustic.b = clamped caustic intensity
normalCaustic.a = validity
```

Caustics are computed from local area compression with `max(area, epsilon)`, finite intensity clamps, and an atomic invalid-cell counter in `diagnostics.invalidCausticCounter`. There is no CPU readback in the frame path.

## CPU Height Coupling

For buoyancy, camera clearance, or other cross-skill consumers, use the
analytic CPU query:

```js
import { createBoundedWaterHeightQuery } from './index.js';

const waterHeight = createBoundedWaterHeightQuery();
const y = waterHeight.getWaterHeight(x, z, timeSeconds);
```

The query imports the same `AUTHORED_WAVES` list used by the TSL displacement
path, so analytic parity error is zero except floating-point roundoff. The live
StorageTexture heightfield is not read back. Its residual coupling gap is
bounded by the declared drop/object impulse amplitude budget:
`abs(dropStrength) + abs(objectDisplacementScale)`.

## Quality Tiers

| Tier | Grid | Fixed Step | Max Steps | Bands | Storage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ultra | 512 | 1/240 s | 4 | 5 + 4 micro | ~6 MiB for three RGBA16F fields |
| High | 256 | 1/120 s | 3 | 4 + 3 micro | ~1.5 MiB |
| Budgeted | 128 | 1/60 s | 2 | 3 + 0 micro | ~0.375 MiB |

If `renderer.backend.isWebGPUBackend` is false after `await renderer.init()`,
this example throws and routes fallback teaching to
`../threejs-compatibility-fallbacks/`.

## Debug Modes

- `final`
- `height`
- `velocity`
- `normals`
- `caustics`
- `refractionValidity`

## Minimal Usage

Pass `sceneColorScene` as a host-owned opaque/background scene that does not
contain `water.mesh`.

```js
import { WebGPURenderer } from "three/webgpu";
import { float } from "three/tsl";
import {
  createWebGPUBoundedWaterSystem,
  seededDropSequence,
} from "./examples/webgpu-bounded-water/index.js";

const renderer = new WebGPURenderer({ antialias: false });
const water = await createWebGPUBoundedWaterSystem(renderer, {
  tier: "high",
  seed: 42,
  sceneColorScene: opaqueScene,
  camera,
  timeNode: float(0),
});

scene.add(water.mesh);

for (const drop of seededDropSequence(42, 4)) {
  water.heightfield.setDrop(drop);
  water.heightfield.runFixedStep();
}

function frame(deltaSeconds) {
  water.update(deltaSeconds);
  water.pipeline?.render();
  renderer.render(scene, camera);
}
```

## Budgets

- Compute: 3 simulation dispatches plus 1 diagnostic reset per fixed step.
- Draws: one water surface draw; optional host receiver/debug draws.
- Storage: two ping-ponged RGBA16F state textures plus one RGBA16F normal/caustic texture.
- Output: the node render pipeline owns tone mapping/output conversion through `renderOutput()`. Water materials output linear HDR values and do not do their own final conversion.

## Build-Order Mapping

1. Validate config: `validateWaterConfig()` must pass the CFL/Courant gate. You must see a JSON result with `courant <= maxCourant`; if it fails, lower `waveSpeed`, lower `fixedTimeStep`, or increase `worldSize` before rendering.
2. Seed a drop: render `height`. You must see a centered radial impulse with boundary fade; if it streaks or explodes, the sim texel/world-XZ mapping is wrong.
3. Propagate one ring: render `velocity`. You must see a smooth signed ring leaving the drop; if amplitude changes with frame rate, the fixed-step accumulator or `height += velocity * dt` path is wrong.
4. Reconstruct normals: render `normals`. You must see bounded RGB normal variation aligned to the height ring; if normals scroll independently, the normal pass is not sampling the same state.
5. Compute caustics: render `caustics`. You must see finite compressed highlights with no white NaN blocks; if the image saturates, inspect the projected-area epsilon and invalid-cell counter.
6. Wire scene refraction: render `refractionValidity`. You must see green only where the refracted UV is in bounds and behind the water; if foreground objects leak, the scene pass/depth owner or water-exclusion policy is wrong.
7. Composite final: render `final` and a no-post host capture. You must see Fresnel reflection, Beer-Lambert transmission, caustics, and foam from the same surface state; if bloom or grading supplies the form, debug the water before post.
