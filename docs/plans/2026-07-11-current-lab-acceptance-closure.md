# Current Lab Acceptance Closure Plan

Date: 2026-07-11

Audited revision: `97394fd`

Public site: `https://threejs-skills.com/`

## 1. What the latest reconciliation actually finished

The earlier 1,233-path dirty checkout has been fully reconciled. The current
checkout is clean, `main` matches `origin/main`, and the source, registry, Pages
generator, responsive evidence media, and deployed site all describe the same
revision.

Completed repository-wide work includes:

- schema-v2 manifests for 40 primary routes;
- browser entrypoints and validation commands for every primary route;
- fixed mechanism and tier URLs generated from canonical implementations;
- explicit proxy, generated-asset, fixture, and legacy classifications;
- five integration flagships with declared ownership contracts;
- evidence-led skill pages with no decorative substitute for runtime proof;
- inspected native-WebGPU preview summaries for AO, bloom, exposure, and the
  image pipeline;
- source-hash validation, route smoke tests, responsive evidence images, and
  live-domain SEO/presentation audits.

This work completed the implementation and publication framework. It did not
complete rendering acceptance.

## 2. Current truthful baseline

The registry contains 40 primary routes:

- 2 accepted non-rendering contract suites:
  - `router-manifest-lab`;
  - `debugging-contract-lab`.
- 38 incomplete rendering or capability routes.
- 4 of those 38 have inspected native-WebGPU preview evidence:
  - `webgpu-node-gtao`;
  - `node-selective-bloom`;
  - `webgpu-exposure-color-pipeline`;
  - `webgpu-image-pipeline`.
- 34 have no promoted runtime preview summary.
- All 38 incomplete routes currently have `evidenceBundle: null` in the
  registry.
- With the exception of three accepted static checks in the explicit fallback
  harness, their runtime-proof requirements remain unaccepted.

An inspected preview proves that a current browser initialized native WebGPU
and produced a directly inspected render-target image. It does not prove the
complete v2 evidence protocol, sustained timing, lifecycle stability, odd-size
readback, mechanism mutations, or tier budgets.

## 3. Shared blockers that must be closed first

### 3.1 Destructive test cleanup

The repository-wide test commands are not currently safe to run under the
repository deletion policy. Recursive forced deletion remains in:

- `tests/labs/evidence-v2.test.mjs`;
- `tests/labs/foundation.test.mjs`;
- the visual-validation harness self-test;
- atmosphere and cloud mutation tests;
- the creature capture cleanup path.

These sites must be replaced with isolated, uniquely named workspaces that do
not require destructive cleanup. Until then, a claimed full-pack run would be
false because the required commands cannot be executed lawfully.

### 3.2 Publishable v2 evidence bundles

Every accepted rendering lab needs the normative JSON set, required images,
integer aligned readback metadata, backend proof, runtime graph, resource
ledger, lifecycle trace, and claim-separated verdicts. The current four
promoted summaries are intentionally smaller and remain `incomplete`.

### 3.3 Current-adapter GPU timing

Performance claims require timestamp-query-backed measurements. When the
adapter or browser cannot expose the required timestamp path, the verdict must
remain `INSUFFICIENT_EVIDENCE`; authored or CPU wall-clock values cannot replace
GPU measurements.

### 3.4 Lifecycle and mutation execution

Each rendering primary needs repeated create, render, resize, mode/tier change,
history reset, and dispose cycles, plus its required negative mutations. A
one-iteration loop or a source-token check cannot satisfy this gate.

### 3.5 Integration ordering

The five flagships cannot be accepted before each included standalone mechanism
has accepted native proof. Their owner graphs, resource ledgers, and timing
traces are integration evidence, not substitutes for standalone evidence.

## 4. Route-by-route gap groups

### Group A — shared acceptance foundation

1. `webgpu-validation-harness`
   - remove destructive fixture cleanup;
   - make the v2 dispatcher, path confinement, numeric provenance, image
     comparison, aligned readback, timing verdicts, and lifecycle trends
     executable end to end;
   - capture and inspect the deterministic native-WebGPU subject;
   - publish the first complete rendering evidence bundle.
2. `browser-fallback-harness`
   - retain the default blocker behavior;
   - capture live backend/capability proof;
   - prove explicit activation and isolated legacy execution without automatic
     fallback.

### Group B — promoted previews that need full acceptance bundles

3. `webgpu-image-pipeline`
4. `webgpu-node-gtao`
5. `node-selective-bloom`
6. `webgpu-exposure-color-pipeline`

For each route, extend the inspected preview into the standard image set,
mechanism diagnostics, odd-size readback, resource inventory, timing verdict,
lifecycle trace, mutation results, and source-hash-linked bundle. Keep status
incomplete wherever a claim remains unmeasured.

### Group C — remaining standalone canonical rendering labs

7. `webgpu-camera-rig`
8. `webgpu-procedural-timelines`
9. `webgpu-cached-clipmap-shadow`
10. `webgpu-lut-atmosphere`
11. `webgpu-weather-volume-clouds`
12. `webgpu-fft-ocean`
13. `webgpu-bounded-water`
14. `webgpu-rain-snow-and-wet-surfaces`
15. `webgpu-touch-history-frost`
16. `webgpu-field-bake`
17. `tsl-procedural-pbr`
18. `semantic-mesh-writer`
19. `webgpu-material-slot-compiler`
20. `webgpu-quadtree-planet`
21. `webgpu-dense-grass`
22. `structured-ash-growth`
23. `webgpu-procedural-creature-lab`
24. `webgpu-pooled-effects`
25. `tsl-curved-ray`
26. `webgpu-tower-ship-sculptor`

Each lab must be handled as its own evidence unit. A lab is not promoted merely
because its controller loads or its browser-free tests pass.

### Group D — focused integrations and support surfaces

27. `webgpu-temporal-history`
28. `integration-image-pipeline-ao`
29. `integration-precipitation-image-pipeline`
30. `integration-temporal-surface`
31. `webgpu-shadow-architecture-bench`
32. `webgpu-shadow-pipeline-integration`
33. `webgpu-vegetation-integration`

These routes must prove shared signals and ownership with real runtime graphs.
They may import canonical implementations, but may not fork algorithms or
invent separate renderer, tone-map, output-transform, temporal, or weather
owners.

### Group E — five flagships

34. `final-image-flight`
35. `weathered-world`
36. `procedural-district`
37. `creature-habitat`
38. `relativistic-space-shot`

Each flagship needs accepted standalone dependencies, fixed hero/balanced/
budgeted routes, a runtime owner graph, current resource inventory, sustained
timing, tier-transition trace, lifecycle loop, and duplicate-owner mutations.

## 5. Small thematic commit sequence from the current clean revision

Every item below is committed independently after its named verification. No
generated registry or site output is mixed into implementation commits.

1. `docs(audit): reconcile current lab acceptance gaps`
   - this plan only;
   - verify the counts directly from `labs/demo-registry.json`.
2. `test(labs): isolate fixtures without destructive cleanup`
   - root foundation and evidence-v2 tests only;
   - run both root test files directly.
3. `test(validation): retain self-test fixtures safely`
   - visual-validation self-test only;
   - run the harness self-test and mutation suite.
4. `test(atmosphere): retain mutation fixtures safely`
   - atmosphere mutation fixture only;
   - run atmosphere checks, unit tests, and mutations.
5. `test(clouds): retain mutation fixtures safely`
   - cloud mutation fixture only;
   - run cloud checks, unit tests, and mutations.
6. `fix(creatures): make capture retention non-destructive`
   - creature capture lifecycle only;
   - run creature checks, unit tests, mutations, and a retained capture.
7. `feat(validation): emit complete v2 runtime bundles`
   - schema dispatcher, browser adapter, runtime manifest reconciliation, and
     artifact validator;
   - run validation unit and mutation suites.
8. `feat(validation): capture deterministic WebGPU evidence`
   - browser subject and capture path;
   - inspect final, no-post, diagnostics, odd-size, seed, and temporal images.
9. `docs(evidence): publish validation harness proof`
   - accepted summary JSON and selected inspected images only;
   - validate source hashes and Pages rendering.

After the foundation, each standalone lab uses three small commits:

1. `fix(<scope>): close runtime mechanism gaps`
   - only when browser execution exposes an actual mechanism defect;
   - check, unit, and mutation verification.
2. `feat(<scope>): capture complete runtime evidence`
   - capture/controller/artifact-validation changes only;
   - native-WebGPU capture, direct image inspection, lifecycle, timing verdict,
     and artifact validation.
3. `docs(<scope>): publish inspected acceptance evidence`
   - selected evidence and generated publication output only;
   - source-hash validation, route smoke, and live-domain inspection.

The standalone order is:

```text
image-pipeline -> AO -> bloom -> exposure -> camera -> motion -> shadows ->
atmosphere -> clouds -> ocean -> bounded-water -> precipitation -> frost ->
fields -> materials -> geometry -> cities -> planets -> dense-grass -> Ash ->
creatures -> particles -> curved-ray -> object-sculptor
```

Focused integrations follow their standalone dependencies in this order:

```text
temporal-history -> AO integration -> precipitation integration ->
temporal-surface -> shadow architecture/integration -> vegetation integration
```

Flagships are last:

```text
Final Image Flight -> Procedural District -> Creature Habitat ->
Relativistic Space Shot -> Weathered World
```

The final publication is split into:

1. `build(labs): regenerate accepted evidence registry`;
2. `docs(site): publish verified acceptance matrix`;
3. `chore(release): verify live acceptance routes`, only if release metadata
   actually changes.

## 6. Verification required before any rendering status changes

For one lab to move from `incomplete` to `accepted`, all applicable gates must
pass in the same source revision:

1. browser entry initializes `WebGPURenderer` with Three `0.185.1`;
2. `renderer.backend.isWebGPUBackend === true` is captured;
3. the named mechanism is reachable in the runtime graph;
4. actual render or compute work is submitted;
5. render-target or storage readback proves nontrivial output;
6. row stride records the real integer 256-byte alignment;
7. required diagnostics materially differ from final output;
8. numeric values are labelled Authored, Derived, Measured, or Gated;
9. missing GPU timestamps produce `INSUFFICIENT_EVIDENCE`, never PASS;
10. lifecycle results derive from repeated measured snapshots;
11. required mutations fail for the expected machine-readable reason;
12. final and diagnostic images are opened and inspected directly;
13. the accepted bundle passes the v2 artifact validator;
14. Pages source hashes match canonical source;
15. the dedicated-domain route loads the same build and evidence.

## 7. Final pack gate

Only after all route-level units are committed and accepted, run from a clean
checkout:

```text
npm ci
npm run labs:check
npm run labs:test
npm run labs:test:mutations
npm run labs:validate:quick
npm run labs:validate:full
npm run pages:build
npm run pages:validate-source-hashes
npm run pages:smoke
npm test
```

Then inspect the required final, no-post, diagnostic, camera, seed, tier, and
temporal images for every canonical lab and flagship. Unsupported target-device
performance remains `INSUFFICIENT_EVIDENCE`; it is not inferred from the
current adapter.
