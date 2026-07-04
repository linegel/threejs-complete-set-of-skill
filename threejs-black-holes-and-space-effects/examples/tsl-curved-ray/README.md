# TSL Curved-Ray Accretion

Canonical WebGPU/TSL port of the curved-ray accretion and lensing effect. It keeps the authored accretion identity from the legacy example, but replaces the old fixed WebGL loop with a bounded TSL node integrator.

## What It Demonstrates

- `WebGPURenderer` plus `MeshBasicNodeMaterial` from `three/webgpu`.
- TSL `Fn` ray integration over a bounded proxy sphere.
- Exactly one committed ray-position advance per accepted iteration. The legacy example advanced at both line 197 and line 276; this port steers before the accepted advance and commits only the candidate position.
- Adaptive step length from distance-to-core, distance-to-disk, and curvature estimators.
- Continuous disk plane crossing across the accepted segment.
- Front-to-back emission/transmittance accumulation with early termination.
- Environment lookup after integration using the bent final direction.
- Optional generated starfield tile from `../../assets/generated-variants/`, configured as `SRGBColorSpace` because stars and environment maps are color data.
- Awaitable generated star loading and renderer warmup: call `await
  renderer.init()`, `renderer.initTexture()` for the effect textures, then
  `compileAsync()`.
- Debug outputs for step count heatmap, remaining transmittance, steering
  magnitude, termination reason, invalid state, bent direction, opacity, and
  core hit.

## Pipeline / Dispatch Graph

1. JavaScript setup selects deterministic seed assets and quality tier.
2. Proxy sphere draw invokes `marchCurvedRayAccretion` in the material node.
3. The node transforms each fragment into a bounded local ray interval.
4. The adaptive loop evaluates steering, disk crossing, absorption, and termination.
5. The bent final direction samples the starfield environment.
6. `createCurvedRayRenderPipeline()` wraps the scene in a real `pass(scene,
   camera)`, applies the effect tier with `setResolutionScale()`, and uses
   `renderOutput()` as the single output transform owner.
7. Optional `CurvedRayTemporalHistory` owns two reduced-resolution `StorageTexture`
   histories, writes the next history through `textureStore()`, and rejects
   reuse on camera cuts, depth disocclusion, or velocity mismatch.

Default dispatch count is zero: the canonical path is one proxy draw. Enabling
`temporalHistory: true` adds one owned temporal compute-write lane with two
RGBA16F, `NoColorSpace` history textures; resize recreates the histories and
clears reuse.

## Quality Tiers

| Tier | Render scale | Accepted step budget | Opacity cutoff | Intended use |
| --- | --- | --- | --- | --- |
| `hero` | 0.5 | 160 | 0.01 | close camera, inspection shots |
| `standard` | 0.5 | 96 | 0.03 | default gameplay or orbit views |
| `background` | 0.25 | 48 | 0.03 | small on-screen volume or reduced budget tier |
| `distant` | 0.25 | 16 | 0.05 | impostor-like distant use |

Budgets: one proxy draw, one material raymarch, no default storage allocations.
The optional temporal history adds two reduced-resolution RGBA16F
`StorageTexture` allocations and one dispatch. The noise texture is an RGBA
`DataTexture` configured as `NoColorSpace`; generated star tiles use repeat
wrapping and `SRGBColorSpace`.

## Validation

Run:

```bash
npm run validate
```

The validator checks that star/environment textures use `SRGBColorSpace`,
noise/data textures use `NoColorSpace`, quality tiers have sane step bounds,
the disk-slab counterexample where both segment endpoints are outside the thin
disk but the segment crosses through it is detected, the TSL source keeps one
accepted ray advance, invalid-state/termination debug contracts are wired, and
proxy transforms reject nonuniform scale while preserving moved, uniformly
scaled, and far-origin local metrics. It also runs CPU RK4 wormhole reference
rays for impact parameter, near-radial fallback basis, escape side, final
direction, capped state, and tolerance checks before any physical-parity claim.
The source contract also verifies `RenderPipeline`, `pass()`,
`setResolutionScale()`, disabled `outputColorTransform`, and `renderOutput()`
ownership for the reduced-resolution node pass. Temporal validation verifies
the owned `StorageTexture` history pair, `textureStore()` write contract,
camera-cut/depth/velocity rejection, resize clearing, byte accounting, and
dispose idempotence.

## Run

```bash
npm run smoke
npm run serve
```

Then open `http://127.0.0.1:4173/threejs-black-holes-and-space-effects/examples/tsl-curved-ray/`.
The browser entry is `index.html` and `main.mjs`; the Node smoke command imports
the same entry and prints the mesh, quality tier, step budget, draw count, and
dispatch count without requiring a browser.

## Debug Modes

- `final`: integrated disk radiance plus bent-direction environment.
- `step-count`: accepted-step heatmap.
- `transmittance`: remaining transmittance after integration.
- `steering`: accumulated steering magnitude.
- `termination`: termination reason encoded by ID.
- `invalid-state`: magenta only when invalid-state termination is reached.
- `bent-direction`: final integrated environment lookup direction.
- `opacity`: accumulated opacity.
- `core-hit`: event/core absorption mask.

## Minimal Usage

```js
import { Scene, PerspectiveCamera } from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import {
  TSLCurvedRayAccretionEffect,
  prepareCurvedRayRenderer,
} from "./examples/tsl-curved-ray/curved-ray-accretion.js";

const renderer = new WebGPURenderer({ antialias: true });
const scene = new Scene();
const camera = new PerspectiveCamera(55, 1, 0.01, 100);
camera.position.set(0, 0.14, 2.35);

const effect = new TSLCurvedRayAccretionEffect({
  seed: 7,
  quality: "standard",
});
scene.add(effect.mesh);

await prepareCurvedRayRenderer({ renderer, scene, camera, effect });

effect.update(performance.now() * 0.001);
renderer.render(scene, camera);
```

Use `effect.setDebugMode("step-count")`, `effect.setDebugMode("transmittance")`, or `effect.setDebugMode("steering")` for diagnostics. Call `effect.dispose()` when removing it; geometry, material, generated textures, and the optional owned temporal history are disposed.
