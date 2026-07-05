# Water Integration Surface Experiment

This folder is intentionally experimental. It uses the current checked-in
WebGPU bounded-water core without changing the skill text, then tests the
integration surface a host Three.js project needs around that core.

The demo is not a standalone water library. It treats the host project as owner
of the scene, camera, controls, opaque depth scene, transparent pass, masks,
post stack, buoyancy consumers, and network tick. The water core owns only the
GPU-resident heightfield, material, refraction inputs, and update call.

Run:

```sh
npm run check
npm run validate
```

Validation writes:

- `artifacts/integration-contract.json`
- `artifacts/integration-surface-page.png`
- `artifacts/integration-surface-readback.png`

The page screenshot is kept to document the known headless presentation issue.
The readback PNG is the acceptance artifact.

Current findings to feed into the next skill draft:

- Presets should be described as project-level parameter bundles that map into
  water parameters, post/sky settings, spray defaults, and quality preferences;
  the host sky remains separate.
- Quality levels should be integration policies: simulation grid, mesh
  segments, fixed step, max substeps, analytic/micro bands, pass resolution, and
  feature toggles. They must not introduce a WebGL path.
- Buoyancy belongs in the host or physics layer but needs a stable water query
  contract. The current analytic query is enough for broad floating behavior
  and avoids GPU readback; the residual from live drops/objects must be stated.
- Spray is naturally a host-side emitter/probe system driven by local probe
  crossings against the water query. A production path should freeze per-probe
  visual parameters at spawn and keep probe indices stable.
- Deterministic multiplayer needs a fixed tick, bounded catch-up, and an
  explicit `syncToTick(tick)` contract that sets time without replaying variable
  browser frame deltas.
- Transparent objects need a documented ordering policy: exclude them from the
  opaque water depth/color prepass, then render them after water.
- Screen-space water masking is not first-class in the current skill. The host
  can register masks, but the water material needs a mask texture/pass contract
  before hull interiors or submarine cabins can clip water fragments correctly.
- Post-processing should be host-owned but ordered: water depth/refraction
  first, then AA, then bloom and color grading.
