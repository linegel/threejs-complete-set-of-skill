# Native WebGPU Space Integrator Lab

One canonical stage family for bounded artistic accretion, the ultrastatic
Ellis wormhole, Schwarzschild null lensing, convergence inspection,
termination-aware temporal reconstruction, and a bounded direction cache.
The stage factories do not create a renderer or final image owner; the
standalone `SpaceIntegratorLab` supplies those owners.

## Models and claims

- `accretion-disk`: art-directed transverse inverse-square steering and a
  finite emitting slab. It is not a GR model.
- `ellis-wormhole`: null transfer for
  `ds²=-dt²+dl²+(l²+a²)dΩ²`, parameterized by `B=b/a`. A critical-split
  nonuniform table resolves `B<1` traversal, `B>1` turning, and labels `B=1`
  unresolved-critical.
- `schwarzschild-lensing`: equatorial null transfer in geometric units
  `G=c=1`, with horizon `2M`, photon sphere `3M`, and critical impact
  `3√3 M`. The reference solves
  `r'=p_r`, `p_r'=b²/r³-3Mb²/r⁴`, `φ'=b/r²` and gates the table against that
  independent float64 path.
- `integration-convergence`: three direct Schwarzschild GPU probe dispatches
  at affine-step caps `0.08`, `0.04`, and `0.02`, with validation-only storage
  readback against float64 CPU trajectories. Its startup image shows the
  coarse-`0.08` versus fine-`0.02` transfer residual rather than another copy
  of the beauty view.
- `lens-cache`: compute-written world-space bent direction, termination ID,
  representative world position/depth, and transfer diagnostics. It is
  refreshed only when the measured camera/effect transform change exceeds its
  authored angular-error gate; it does not cache tone-mapped color.
- `temporal-reconstruction`: compute ping-pong of bent direction and
  representative position/depth. History is reprojected through the previous
  view-projection matrix and rejected on reset, camera cut, bounds,
  termination, angular, depth, or position disagreement.

The static physical models use critical-split transfer tables concentrated in
`log(abs(b-bCritical))`; they do not pay a per-pixel RK loop. The artistic
shader remains a bounded per-pixel march with one committed position advance.
The older `CurvedRayTemporalHistory` class in `curved-ray-accretion.js` remains
an explicitly undispatched `contract-fixture`; it cannot satisfy canonical
temporal acceptance. The executable route uses `SpaceTemporalDirectionHistory`.

## Routes

Mechanisms:

- `mechanism/accretion-disk/`
- `mechanism/ellis-wormhole/`
- `mechanism/schwarzschild-lensing/`
- `mechanism/integration-convergence/`
- `mechanism/temporal-reconstruction/`
- `mechanism/lens-cache/`

Locked tiers:

- `tier/hero/`
- `tier/standard/`
- `tier/background/`
- `tier/distant/`

Every wrapper imports `space-lab.mjs`; there is no forked renderer.

## Numerical contracts

- A ray missing the bounded proxy reports zero accepted steps.
- Accepted work never exceeds the exact configured cap.
- Critical, escaped, horizon/core, capped, and invalid are separate classes.
- Ellis output reconstruction uses the finite-exit radial and tangential
  components, not orbital position alone.
- Schwarzschild weak-field deflection converges toward `4M/b`.
- Horizon and escape crossings are refined to the continuous event surface;
  returned event residuals are exactly zero at the stored radius.
- Metric tables store transfer state; environment radiance is sampled after
  the current transfer, so environment/exposure changes do not invalidate the
  geometry cache.
- Temporal reuse never hides deterministic integration truncation error.

## Ownership

`createSpaceIntegratorStage()` is reusable by Relativistic Space Shot. It
reports `rendererOwner: host` and `outputOwner: host`. The standalone app owns
one `WebGPURenderer`, one `RenderPipeline`, one scene pass, one bloom response,
and one explicit `renderOutput()` conversion. With explicit output conversion,
`outputColorTransform` is false. Debug switches set a real node/material mode
and mark the pipeline dirty.

## Validation state

Node tests cover bounded misses, exact caps, Ellis regimes, Schwarzschild
horizon/photon-sphere/critical-impact behavior, weak-field deflection, step
refinement, invariant drift, critical-split finite tables, ownership, and
blocking mutations. They also cover previous-matrix reprojection, unchanged
cache reuse, and distinct three-resolution convergence graphs. The older high-accuracy Ellis validator remains an
independent RK4 step-doubling versus adaptive-quadrature check.

These CPU/source checks do not prove GPU execution. `lab.manifest.json` remains
`incomplete` until native browser capture records transfer sampling, cache and
temporal dispatches, reset equivalence, render-target images, invalid-pixel
diagnostics, lifecycle stability, and current-adapter timestamps. Unavailable
timing is `INSUFFICIENT_EVIDENCE`.

## Commands

```sh
npm run check
npm run validate:unit
npm run test:mutations
npm run validate:quick
npm run capture
npm run validate:artifacts
npm run validate:full
```
