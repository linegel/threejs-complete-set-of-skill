# Uncommitted Worktree Audit — 2026-07-10

## Live reconciliation — 2026-07-11

The frozen snapshot below remains the preservation baseline, but it is no
longer the current staging inventory. At `04f4897` the live checkout contains
1,059 changed paths:

- 68 paths have both staged and unstaged differences;
- 303 tracked paths have unstaged differences;
- one tracked path is deleted;
- 687 paths are untracked.

Relative to the 18:14Z snapshot, 886 shared paths are byte-identical, 168
shared paths changed content, five new dirty paths appeared, and eight paths
left the dirty inventory because they were committed. The five additions are
`LICENSE`, `docs/about/index.html`, `docs/llm.txt`, `docs/llms.txt`, and
`scripts/build-pages.mjs`. The committed removals include the router test,
provider/water, external/GPU, and quality fixture modules plus the Pages hash
and smoke validators and the deduplicated root ignore policy.

The current top-level distribution still matches the original architecture:
176 generated `docs/` paths, 152 integration-lab paths, 33 provider/registry
paths, nine scripts, one generated root catalog, and the remaining skill-owned
lab implementations. Therefore the original Core / Contracts / Evidence split
is still valid; generated publication remains downstream-only.

### Verified progress since the frozen snapshot

| Unit | Commit(s) | Current verification |
| --- | --- | --- |
| audit and preservation | `1f56368` | committed without generated output |
| physics role prose | `916e377`, `3be3966`, `0033683`, `845264a` | `npm run test:skills` passes in the live checkout |
| Pages local/hash gates | `1abe419` | committed; publication still waits for source freeze |
| creature ignore policy | `438be92` | committed without creature source changes |
| provider/water causality | `9cbb5e4` | syntax and integrated router suite pass |
| contact/material identity | `359be02` | syntax and integrated router suite pass |
| external/GPU ownership | `a7519d2` | syntax and integrated router suite pass |
| physical impact partitions | `5b0330f` | syntax and integrated router suite pass |
| quality migration resources | `c5e549f` | syntax and integrated router suite pass |
| semantic invariant execution | `04f4897` | 33 invariants, 123 cases, 5,230 record validations, 215 negative cases; PASS in 265 s |
| skill ABI closure gate | `070bfcc` | `npm run test:skills` passes and invokes the executable router suite |

This reconciliation does not promote any rendering lab to accepted. The 37
native-WebGPU primary surfaces still require their declared browser, readback,
timing, lifecycle, and visual evidence.

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
