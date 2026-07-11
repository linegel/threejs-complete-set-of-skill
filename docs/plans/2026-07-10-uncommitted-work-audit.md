# Uncommitted Worktree Audit — 2026-07-10

## Authoritative live reconciliation — 2026-07-11

The frozen snapshot below remains the preservation baseline, but it is not the
current staging inventory. At reviewed HEAD
`e64763bb3920ef5af23d4319966c3bb1db0af48e`, the live checkout contains 1,287
changed paths:

- 70 paths have staged changes;
- 1,286 paths have unstaged changes;
- 69 paths contain both staged and unstaged changes;
- 803 paths are untracked;
- 103 tracked paths are deleted, primarily superseded generated demo assets.

The largest groups are 395 generated `docs/` paths, 152
`integration-labs/` paths, 52 vegetation paths, 43 planet paths, 42 creature
paths, 38 AO paths, 35 image-pipeline paths, 34 paths each under atmosphere
and `labs/`, and 32 paths each under black holes, weather, and clouds. The
Core / Contracts / Evidence split is still mandatory. Generated publication
remains downstream-only and must not absorb unfinished canonical work.

The local `main` branch is 52 commits ahead of and eight commits behind
`origin/main`. The custom domain is therefore a deployed-history review
surface, not proof of the current checkout. In particular, the meaningless CSS
pipeline-orbit graphic reported by the reviewer is absent from current source:
`91c90e5` replaced it and `6c34265` replaced ornamental/related media with
registry-derived evidence states. The deployed screenshot is stale. The site
must not be called updated until remote history is reconciled, pushed, Pages
finishes, and `https://threejs-skills.com/` is rechecked.

### Current registry truth

| Measure | Current value |
| --- | ---: |
| skill directories | 27 |
| demo registry records | 87 |
| primary records | 40 |
| canonical labs | 28 |
| integration demos | 10 |
| mechanism demos | 2 |
| accepted primary records | 2 |
| incomplete primary records | 38 |
| secondary records | 47 |

The accepted primary records are the non-rendering router and debugging
contract suites. No rendering lab is currently accepted. All 38 other primary
records intentionally publish `incomplete`; a screenshot, a loading browser
route, and a v2 evidence verdict remain different claims.

### Verification run against the current checkout

| Gate | Result | Exact implication |
| --- | --- | --- |
| `node scripts/check-lab-implementation-matrix.mjs` | PASS | 28 canonical targets and five flagships have strict source/entry/script/route contracts |
| `node scripts/check-lab-sources.mjs` | PASS | all 40 primary records resolve their declared canonical source paths |
| `node scripts/check-capture-wiring.mjs` | PASS | all 40 primary records have a declared capture policy; this is wiring, not accepted evidence |
| `node --test tests/labs/*.test.mjs` | PASS, 42/42 | root structural contracts pass |
| `node scripts/run-labs.mjs check` | PASS, 40/40 | all declared check commands complete |
| `npm run labs:test` | FAIL, 2 focused rows | router inventory still expects 26 rather than 27 skills; bounded-water mechanism wrapper does not import the canonical app |
| `npm run labs:test:mutations` | FAIL, 3 focused rows | the same router and water gaps plus an FFT-ocean mechanism wrapper that does not import the canonical app |
| manifest validator with `--require-complete` | FAIL, 30 blockers | 25 rendering/feature skills and all five flagships lack accepted primary evidence |
| `npm run pages:validate-source-hashes` | FAIL, 3 drift rows | generated registry and router demo/index hashes do not match current source |
| `npm run pages:validate-presentation` | PASS | current generated presentation reports 27 skills, 40 primary records, five flagships, and 545 primary URLs |
| `npm run pages:validate-seo` | PASS | 95 indexable pages and 603 HTML files meet the local static-content gate |
| `npm run pages:smoke` | environment-blocked in sandbox | local server could not bind `127.0.0.1:4173` (`EPERM`); rerun with approved host execution |

These results define the next three source commits before any publication
regeneration:

1. migrate router inventory fixtures from 26 to the actual 27-skill catalog;
2. make every bounded-water mechanism wrapper load the canonical lab app;
3. make every FFT-ocean mechanism wrapper load the canonical lab app.

### Verified C01 progress since the frozen snapshot

The native validation subject has advanced beyond the earlier note. Current
adapter evidence now includes:

- real native-WebGPU correctness captures at 1200×800 and odd 641×359;
- aligned RGBA8 readback with 4,864-byte and 2,816-byte source rows compacted
  to 4,800-byte and 2,564-byte transport rows;
- 14 schema-v2 JSON artifacts and all ten required standard images;
- a materially different diagnostics image (approximately 0.864 differing
  pixel ratio);
- 50/50 fresh create/render/resize/mode/tier/dispose cycles;
- zero numeric renderer-memory counters after every disposal;
- measured render-target resource range of 6,443,332–60,480,000 bytes.

Its claim verdicts remain deliberately separated: visual correctness and
lifecycle stability pass; mechanism correctness, performance compliance, and
GPU-stage attribution remain `INSUFFICIENT_EVIDENCE`. The bundle is therefore
`browser-capture-incomplete`, not publishable, and does not promote the lab to
accepted.

## Scope and preservation

This audit freezes the repository before any new staging or bulk commit. The
review snapshot was reconstructed from `357dd582fc10aa01ec5fac04f05cb467b76d993d`
at 18:14Z. The live checkout continued changing during the audit, so the
snapshot is the stable comparison target and the live delta must be reconciled
before staging.

Preservation artifacts were created outside the repository:

- `/tmp/threejs-uncommitted-review-20260710-1814Z.patch` — tracked binary diff;
- `/tmp/threejs-untracked-review-20260710-1814Z.tar.gz` — all untracked files;
- `/tmp/threejs-uncommitted-review-1814Z-stable.json` — per-file status, size,
  category, line delta, modification time, and SHA-256;
- `/tmp/threejs-uncommitted-paths-by-group-1814Z.md` — grouped path inventory;
- `/tmp/threejs-audit-snapshot-1814Z/` — reconstructed stable checkout.

No reset, stash, checkout, or mutation of the user-owned creature changes was
performed.

## Expanded inventory

Ordinary `git status` collapsed untracked directories and undercounted the
work. `--untracked-files=all` produced the authoritative snapshot inventory:

- 1,062 changed files;
- 372 tracked modifications or deletions;
- 690 untracked files;
- 406 changed JavaScript modules;
- 156 changed JSON documents;
- 42 changed PNG assets.

| Area | Files | Tracked | Untracked | Review classification |
| --- | ---: | ---: | ---: | --- |
| `docs/` | 173 | 161 | 12 | generated publication; never stage before source-hash gates |
| `integration-labs/` | 152 | 0 | 152 | five new flagship implementations and evidence scaffolds |
| `labs/` | 33 | 0 | 33 | generated registry plus secondary provider assets/runtime |
| `scripts/` | 10 | 4 | 6 | validation, Pages, and local orchestration tooling |
| `threejs-ambient-contact-shading/` | 38 | 5 | 33 | GTAO canonical lab plus image-pipeline integration |
| `threejs-black-holes-and-space-effects/` | 32 | 11 | 21 | curved-ray canonical lab |
| `threejs-bloom/` | 22 | 3 | 19 | selective BloomNode canonical lab |
| `threejs-camera-controls-and-rigs/` | 22 | 5 | 17 | camera-rig canonical lab |
| `threejs-choose-skills/` | 5 | 2 | 3 | physics/router contract and extracted fixtures |
| `threejs-compatibility-fallbacks/` | 25 | 0 | 25 | explicit-request browser fallback harness |
| `threejs-dynamic-surface-effects/` | 31 | 4 | 27 | frost history lab plus temporal integration |
| `threejs-exposure-color-grading/` | 25 | 8 | 17 | exposure pipeline canonical lab |
| `threejs-image-pipeline/` | 35 | 14 | 21 | image pipeline and temporal history labs |
| `threejs-particles-trails-and-effects/` | 27 | 6 | 21 | pooled-effects canonical lab |
| `threejs-procedural-buildings-and-cities/` | 28 | 12 | 16 | material-slot compiler lab |
| `threejs-procedural-creatures/` | 42 | 23 | 19 | preserved creature lab work plus new runtime/evidence files |
| `threejs-procedural-fields/` | 23 | 9 | 14 | field bake canonical lab |
| `threejs-procedural-geometry/` | 26 | 8 | 18 | semantic mesh writer lab |
| `threejs-procedural-materials/` | 24 | 7 | 17 | procedural PBR canonical lab |
| `threejs-procedural-motion-systems/` | 23 | 8 | 15 | procedural timeline canonical lab |
| `threejs-procedural-planets/` | 43 | 19 | 24 | quadtree planet lab and generated proxy updates |
| `threejs-procedural-vegetation/` | 52 | 7 | 45 | dense grass, structured growth, and integration labs |
| `threejs-rain-snow-and-wet-surfaces/` | 32 | 4 | 28 | weather lab and image-pipeline integration |
| `threejs-scalable-real-time-shadows/` | 7 | 7 | 0 | three shadow lab contract updates |
| `threejs-sky-atmosphere-and-haze/` | 34 | 9 | 25 | LUT atmosphere canonical lab |
| `threejs-spectral-ocean/` | 33 | 13 | 20 | FFT ocean canonical lab |
| `threejs-visual-validation/` | 1 | 1 | 0 | harness documentation boundary update |
| `threejs-volumetric-clouds/` | 32 | 11 | 21 | volumetric cloud canonical lab |
| `threejs-water-optics/` | 30 | 9 | 21 | bounded-water canonical lab |
| Root config and registries | 3 | 3 | 0 | ignore policy and generated catalog state |

Every path in the table is represented in the per-file SHA-256 inventory.

## Verification performed on the frozen snapshot

| Gate | Result | Meaning |
| --- | --- | --- |
| `node --check` over every changed `.js`/`.mjs` | PASS, 406/406 | syntax only |
| JSON parse over every changed `.json` | PASS, 156/156 | syntax only |
| PNG signature/dimension validation | PASS, 42/42 | container validity only |
| `bash -n` for changed shell scripts | PASS | syntax only |
| `git diff --check` | PASS | no whitespace errors |
| `npm run labs:test` | PASS, 39 commands | CPU/static/unit contracts |
| `npm run labs:test:mutations` | PASS, 39 commands | declared mutations are detected |
| `node scripts/run-labs.mjs quick` | PASS, 39 commands | browser-free quick gates |
| `npm run test:skills` | FAIL | physics-boundary contract prose is incomplete |
| direct router contract | FAIL | SI-temperature negative fixture rejects for the wrong invariant |
| manifest `--require-complete` | FAIL, 29 blockers | 24 skills and five flagships lack accepted coverage |
| Pages source hashes | FAIL, 3 | registry and router proxy drift |
| Pages presentation | FAIL, 2 | coverage/home build revision drift |
| Pages SEO | FAIL, 1 | temporal-history demo shell has 79 words; gate requires 80 |
| Pages smoke | PASS, 95 routes | route loading only |

The passing unit/quick gates do not prove native-WebGPU execution, readback,
timing, lifecycle stability, or accepted publication.

## Global blocking gaps

### 1. Physics boundary matrix is ahead of skill prose

The new skill validator requires positive, exact ABI ownership prose. Seventeen
skills are missing at least one required token:

| Skill | Missing positive ABI records |
| --- | --- |
| camera controls | `FrameExecutionRecord` |
| choose skills | `SurfaceExchange`, `FrameExecutionRecord`, `QualityChangeRequest` |
| dynamic surfaces | `PhysicsPresentationCandidate` |
| exposure/grading | `FrameExecutionRecord` |
| particles/effects | `ContactManifoldRecord`, `PhysicsMaterialRegistry`, `PhysicsGraph` |
| buildings/cities | `ExternalSolverAdapter`, `PhysicsPresentationCandidate`, `InteractionRecord`, `QualityTransition` |
| creatures | `WaterSurfaceSample`, `SupportSurfaceSample` |
| procedural fields | `PhysicsMaterialRegistry` |
| procedural materials | `FrameExecutionRecord` |
| procedural motion | `PhysicsGraph`, `WaterSurfaceSample` |
| procedural planets | `PhysicsMaterialRegistry`, `QualityTransition` |
| rain/snow/wetness | `PhysicsGraph`, `InteractionBatchLedger`, `InteractionApplicationLedger` |
| sky/atmosphere | `PhysicsContext` |
| spectral ocean | `WaterSurfaceSample`, `SurfaceExchange`, `InteractionRecord`, `PhysicsPresentationCandidate` |
| visual validation | `PhysicsGraph` |
| volumetric clouds | `PhysicsGraph` |
| water optics | `PhysicsContext`, `PhysicsPresentationCandidate`, `InteractionApplicationLedger` |

The validator must not be committed as green until each token is explained in
the owning skill's non-reference, non-example boundary prose.

### 2. Router contract has a semantic negative-fixture mismatch

`router-contract.test.mjs` fails the
`physics context exposes authoring temperature units` case. The Celsius
mutation is rejected, but not by the expected canonical-SI invariant. The
fixture or validator ordering must be corrected so the test proves the intended
boundary rather than accepting any rejection.

### 3. Rendering coverage is structurally present but unaccepted

The registry contains 26 skills, 39 primary targets, and 47 secondary targets.
Only the non-rendering router and debugging suites are accepted. The other 37
primary targets have `evidenceBundle: null` and explicit incomplete capability
or runtime-proof rows.

All rendering targets still require, as applicable:

- initialized native `WebGPURenderer` proof;
- `renderer.backend.isWebGPUBackend === true` after initialization;
- actual render/compute mechanism reachability;
- aligned render-target or storage readback;
- current-adapter GPU timestamps for performance claims;
- resource, bandwidth, and owner ledgers;
- 50–100 cycle lifecycle evidence;
- fixed camera/seed/tier/temporal images;
- accepted v2 claim-separated evidence.

The five flagships additionally lack accepted owner-graph, coupled-signal,
current-adapter timing, and lifecycle bundles.

### 4. Generated publication is downstream and currently stale

The 173 `docs/` changes are generated output. They must remain unstaged until
the canonical sources, registry, and previews are frozen. Current failures are:

- demo registry drift;
- router provider source/index hash drift;
- coverage and homepage build-revision drift;
- temporal-history SEO shell one word below the gate.

### 5. Commit hygiene issues inside the uncommitted set

- `.gitignore` repeats the creature artifact allowlist twice.
- `scripts/grok-ralph-loop.sh` and `scripts/ralph-grok-loop.sh` overlap, depend
  on a missing `ralph_task.md`, and should not be mixed with product commits.
- `labs/provider-proxies/provider-demo.mjs` is a 3,686-line, 129 KiB monolith;
  it must be committed separately from the 30 generated PNGs, preferably after
  splitting domain adapters or at least adding direct contract tests.
- the FFT-ocean package-lock deletion must be intentional and committed only
  with the root-managed dependency-policy change.
- generated Pages, registries, evidence summaries, and preview images must not
  be used to hide incomplete runtime claims.

## Per-domain acceptance gaps

| Domain | Primary targets | Remaining acceptance evidence |
| --- | --- | --- |
| AO | `webgpu-node-gtao`, `integration-image-pipeline-ao` | AO reachability, honest pass pair, readback, timestamps |
| black holes | `tsl-curved-ray` | transfer/cache compute, metric probes, temporal reset, timestamps |
| bloom | `node-selective-bloom` | BloomNode targets, PSF/emissive isolation, readback, timestamps |
| camera | `webgpu-camera-rig` | MRT/origin storage readback and timing |
| fallback | `browser-fallback-harness` | live no-WebGPU blocker and isolated explicit branch |
| dynamic surfaces | frost lab plus temporal integration | storage dispatch/readback, shared-signal identity, timing |
| exposure | exposure pipeline | compute histogram/readback and current-adapter timing |
| image pipeline | image/temporal labs plus five flagships | live MRT/history/reset, owners, timing, lifecycle |
| particles | pooled effects | ordered compaction, bijection/indirect readback, soft depth, timestamps |
| buildings | material-slot compiler | native renderer and compiled-resource ledger |
| creatures | creature lab | native certification/readback, shadows, lifecycle; preserve user patch |
| fields | field bake | direct/storage/mip/placement readbacks and timing |
| geometry | semantic writer | native draw/indirect proof and readback |
| materials | procedural PBR | channel, atlas, shadow, specular-error readbacks and timing |
| motion | procedural timelines | compute/storage/MRT readback and timing |
| planets | quadtree planet | live dispatch/readback, resource graph, derivative correctness |
| vegetation | grass, growth, integration | native images, storage, LOD, shadow parity, timing |
| weather | weather lab and integration | live impacts, resource diagnostics, shared identity, timing |
| shadows | cached, architecture, integration | receiver consumption, actual depth, submissions, parity, timestamps |
| atmosphere | LUT atmosphere | executed five-stage chain, live depth/ECEF composition, readback, timing |
| ocean | FFT ocean | complete 2D FFT and per-cascade/foam readbacks, timing |
| validation | WebGPU harness | real browser bundle, MRT/readback, timestamps, lifecycle |
| clouds | volumetric clouds | bounded dispatch, R32F depth, temporal rejection, timing |
| bounded water | water lab | heightfield/caustic/depth/optics readbacks, lifecycle, timing |

## Review conclusion

The uncommitted work contains substantial and mostly coherent implementation,
test, route, and presentation scaffolding. It is suitable for small truthful
source commits after the live checkout stops changing and after each proposed
commit is re-verified in isolation. It is not suitable for a bulk commit and it
does not close rendering acceptance.

The companion small-commit ledger defines the required staging boundaries and
verification command for each unit.
