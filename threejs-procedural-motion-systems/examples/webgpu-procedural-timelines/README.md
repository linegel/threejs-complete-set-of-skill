# WebGPU Procedural Timelines

Canonical fixture for the procedural motion systems skill.

It demonstrates launch, docking, stage detach, rotating-frame debris,
fixed-step replay, storage-backed instancing, and node-post ownership.

Run:

```sh
node --check main.js
node validation.js
```

Validation covers 30/60/120/240 Hz replay equivalence, terminal pose epsilon,
matrix equality after reparenting, seeded replay, quaternion norm drift,
radial fallback no NaN, dropped-substep behavior, and storage bytes.
