# Implementation Delta From Experiment

Validated:

- WebGPU backend initializes through `WebGPURenderer`.
- Host integration can keep presets, quality, deterministic tick, buoyancy,
  spray, transparent ordering, and mask registry outside the water core.
- Render-target readback is valid evidence; page screenshots can remain blank
  in headless Chromium.
- Buoyancy can use the analytic CPU query without per-frame GPU readback.
- Object motion can feed `setObjectImpulse()` and remain inside fixed-step
  simulation.
- Spray probes can fire from host-side signed-distance crossings.
- Transparent objects can be excluded from the opaque prepass and rendered
  after water.

Fixed during experiment:

- `MeshPhysicalNodeMaterial` water Fresnel used `pow(r, 2.0)` where `r` is a
  negative abstract float in WGSL. Replaced with `r.mul(r)`.
- Experimental validation now rejects browser console errors and blank
  WebGPU readbacks.

Still missing from checked-in skill/core:

- first-class preset schema as integration data, not scene ownership;
- four quality levels matching host-level feature budgets;
- explicit host/module ownership contract;
- buoyancy sample budget and multi-point object contract;
- deterministic multiplayer tick contract;
- spray emitter/probe contract and override precedence;
- transparent-object prepass exclusion policy;
- screen-space mask texture/pass/material hook;
- host-owned post-processing order;
- validation gate for WebGPU console errors and render-target readback evidence.
