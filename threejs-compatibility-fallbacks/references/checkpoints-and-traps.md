# Checkpoints And Traps

## Required Checkpoints

1. Owner selected: canonical skill and exact feature are named.
2. Capability manifest recorded: backend, WebGPU availability, missing primitive,
   memory/thermal/browser constraint, and explicit user request.
3. Canonical invariant ledger filled: physical, color, temporal, and space rows.
4. One downgrade axis chosen per feature.
5. Lost features named in user-visible terms.
6. Color/output ownership checked: one tone map, one output transform.
7. Lifecycle delta listed: new assets, buffers, targets, disposal, and
   dispose/recreate obligations.
8. Validation delta attached: screenshot names, metric thresholds, frame budget,
   pass count, memory cap, and tests that still run.

## Inline Traps

| Trap | Symptom | Required response |
| --- | --- | --- |
| sRGB-as-data | fields, LUTs, normals, or masks wash out or threshold wrong | use `NoColorSpace`, hash/generated-data manifest, and rerun owner validation |
| double tone map | final image looks contrasty, washed, or device-dependent | assign one output owner and remove material/effect conversion |
| fake PBR | degraded tier keeps shiny look by violating energy | rename as stylized/approximate or remove the feature |
| duplicate gbuffer | each fallback effect re-renders scene privately | route through host image pipeline or declare diagnostic loss |
| parallel renderer product | fallback grows into a second app architecture | require explicit maintenance acceptance or stop at feature removal |
| stale precomputed asset | baked texture no longer matches canonical field/seed | regenerate, hash, record color space, and include screenshot delta |
