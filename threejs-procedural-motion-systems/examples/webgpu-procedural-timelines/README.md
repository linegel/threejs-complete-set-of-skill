# WebGPU Procedural Timelines

Canonical fixture for the procedural motion systems skill.

It demonstrates launch, docking, stage detach, rotating-frame debris,
fixed-step replay, previous/current presentation interpolation,
storage-backed instancing, fixed-step compute dispatch, and node-post ownership.

Run:

```sh
node --check main.js
node validation.js
```

Validation covers 30/60/120/240 Hz replay equivalence, terminal pose epsilon,
matrix equality after reparenting, seeded replay, quaternion norm drift,
radial fallback no NaN, dropped-substep behavior, previous/current alpha
interpolation, fixed-step ComputeNode dispatch, seek-vs-step deterministic
mirror state, and storage bytes.
