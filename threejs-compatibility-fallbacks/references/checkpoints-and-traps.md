# Checkpoints And Traps

This reference is inactive unless the current user explicitly requests teaching
how to apply fallback when WebGPU is unavailable. Ordinary backend detection,
low-end/mobile optimization, or broad target support does not authorize these
checkpoints.

## Required Checkpoints

- **Activation:** record the explicit request and the tested unavailable-WebGPU
  condition. Without both, report a canonical blocker and stop.
- **Owner:** name the canonical skill, feature, artifact bundle, and invariant
  set. Do not edit the owner to accommodate the branch.
- **Capability:** record initialized backend truth, missing primitives, target
  device/browser/display, and secondary memory, bandwidth, thermal, interaction,
  or maintenance constraints.
- **Numeric provenance:** every value is `{ value, unit, label, source }` with
  label `Authored`, `Derived`, `Measured`, or `Gated`.
- **Invariant ledger:** classify physical, geometric, radiometric, color,
  temporal, space, and lifecycle invariants as preserved, weakened, or removed.
- **Single downgrade axis:** choose one representation change per feature and
  name its user-visible loss.
- **Branch isolation:** keep imports, build targets, tests, artifacts, and
  maintenance ownership separate from the canonical path.
- **Color/output:** preserve data color domains, scene-linear HDR semantics when
  retained, one tone map, and one output transform.
- **Refresh envelope:** derive CPU/GPU stage envelopes from target refresh after
  browser/compositor and safety reserves; freeze gates before candidate tuning.
- **Sustained evidence:** capture cold and final-stable CPU/GPU `p50 [Measured]`
  and `p95 [Measured]`, presentation misses, quality transitions, memory trend,
  and target telemetry when exposed.
- **Governor:** record thresholds, hysteresis, residence, transitions, resource
  rebuilds, and visual error per state. The settled state must pass both timing
  and visual gates.
- **Tile/resource evidence:** inventory resident and peak transient memory,
  attachment footprint, load/store/resolve traffic, pass breaks, storage/sample
  traffic bounds, uploads, readbacks, and disposal.
- **Visual proof:** attach native-domain metrics, spatial error maps, worst-case
  captures, and frozen gates for every weakened invariant.
- **Timing sufficiency:** when a claim requires GPU attribution, missing
  timestamps produce `INSUFFICIENT_EVIDENCE_GPU_TIMING`, never a pass or `SKIP`.
- **Lifecycle:** record branch-specific assets, resources, caches, resets,
  teardown, and dispose/recreate results.

## Inline Traps

| Trap | Symptom | Required response |
| --- | --- | --- |
| implicit activation | capability detection immediately constructs a compatibility path | remove the branch; report the WebGPU blocker until an explicit user request exists |
| flagship leakage | canonical skill contains WebGL imports, fallback tables, or dual-renderer advice | remove all fallback teaching from the owner and keep it in this quarantine |
| sRGB-as-data | fields, LUT data, normals, or masks wash out or threshold incorrectly | use `NoColorSpace` or explicit linear semantics, hash generation inputs, and rerun native-domain error metrics |
| double output transform | output is contrasty, washed, clipped, or device-dependent | assign one tone-map/output owner and remove material/effect/capture duplication |
| fake physical response | branch preserves a familiar look by violating geometry, energy, or field invariants | rename as approximate or stylized, or remove the feature |
| duplicate scene signals | each effect privately re-renders depth, normals, or color | route through one branch-owned graph or remove the dependent effect |
| hidden quality collapse | frame timing passes only because resolution or quality changed without evidence | log the governor state, measure visual error per state, and fail the undeclared transition |
| short-run acceptance | cold timing passes while the final stable segment degrades | gate the sustained segment and report the transition and thermal uncertainty |
| CPU-as-GPU timing | CPU duration or presentation cadence is used to claim GPU headroom | return `INSUFFICIENT_EVIDENCE_GPU_TIMING` for the GPU claim |
| tile blindness | allocation bytes pass while stores, resolves, or pass breaks saturate a tile GPU | model attachment footprint and external-traffic bounds; measure counters only when exposed |
| exact tile claims | hidden tile size, compression, or cache behavior is inferred from WebGPU resources | mark only a derived model with uncertainty; delete the measured-bandwidth claim |
| generic pixel threshold | scene-wide pixel ratio hides subject, depth, or temporal failure | use invariant-native metrics, subject masks, error maps, and worst-case captures |
| stale precompute | baked data no longer matches canonical field, asset, seed, or output domain | regenerate, hash, record domain, and rerun canonical-to-branch error metrics |
| parallel renderer product | branch becomes a second architecture without ownership or maintenance scope | require explicit maintenance acceptance or stop at honest feature removal |
| weakened validation | fallback authorization is treated as permission to omit diagnostics or lifecycle proof | restore the required evidence or narrow the signed-off claim |
