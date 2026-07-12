# Native WebGPU Procedural Timelines

Canonical r185 motion lab with three runtime scenarios sharing one semantic
motion core: launch/staging, spin docking, and timed debris release. Additional
fixed routes isolate quaternion/reparent, compute storage, and interpolation/
velocity mechanisms.

The core now enforces:

- `sceneUnitsPerMeter` exactly once at the physical-to-scene boundary;
- world-transform-preserving reparenting under arbitrary rotated/non-uniformly
  scaled parents, retaining an affine local matrix when TRS would add shear;
- exact terminal docking position/quaternion with zero linear and angular
  velocity;
- deterministic one-shot event phases and fixed-step replay;
- analytically integrated spin angle, independent of presentation frame count;
- versioned previous/current solver and consecutive-presented position/
  quaternion storage;
- actual storage inventory from allocated typed arrays (`208 bytes/instance`);
- a real scenario-specific compute node whose parity lane is checked by native
  storage readback against explicit f32-storage and f64-semantic oracles for
  launch, docking, and debris checkpoints;
- an active renderer-device-generation binding: submitted storage versions are
  distinguished from readback-confirmed versions and device-loss races fail
  closed;
- linear position interpolation plus hemisphere-safe quaternion slerp into a
  separate presented-transform pair;
- distinct previous/current camera, projection, model, presented position, and
  presented quaternion state for velocity;
- disposal of all thirteen storage attributes and all bounded compute nodes;
- explicit NodeMaterial color/emissive nodes and a shared
  `output + normal + emissive + velocity` render pass;
- one `renderOutput(...)` owner with `outputColorTransform = false`;
- a camera-relative launch presentation origin and scenario-aware framing so
  planetary coordinates remain visible, plus a separately labelled,
  non-physical stage-detachment presentation cue;
- a declared velocity diagnostic gain applied only after the raw NDC MRT, with
  constant and low-occupancy diagnostic rejection;
- fixed mechanism and tier routes; unknown IDs throw.

Mechanism routes:

```text
launch-and-staging
spin-docking
debris-release
quaternion-and-reparent
compute-storage
interpolation-and-velocity
```

Tier routes are `full`, `balanced`, and `test-minimum`. They lock instance
capacity and DPR cap at startup so reported resource counts cannot silently
change. Every active instance retains the same fixed-step solver.

Run:

```sh
npm run check
npm run validate:unit
npm run test:mutations
npm run capture -- --profile correctness --output <temporary-directory>
```

The Node suite proves the CPU contract, TSL graph construction, storage byte
reconciliation, mutation rejection, WGSL-safe shader identifiers, and the
capture output contract. The correctness hook retains native presentation
readbacks for final, normal, emissive, and velocity routes; it derives the
diagnostic mosaic from those four readbacks and records no-post as structurally
inapplicable because the runtime graph contains no post stage. A capture session
is still not an accepted evidence bundle: the manifest remains `incomplete`
until the full v2 contract, hardware timestamps, lifecycle evidence, and direct
visual review pass.
