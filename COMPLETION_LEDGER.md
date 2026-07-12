# Three.js skill-pack completion ledger

This is the authoritative living TODO for the repository-wide completion goal.
Update it before starting and after finishing each unit. A source commit does not
promote evidence, and an evidence commit does not replace source verification.

## Status vocabulary

- `todo`: not started.
- `in-progress`: one named owner is actively changing the unit.
- `source-complete`: source is committed and its browser-free gates pass.
- `evidence-complete`: required Codex in-app Browser artifacts are committed.
- `accepted`: source, evidence, direct inspection, target binding, and promotion gates pass.
- `blocked`: a required external capability or physical target is unavailable.

## Current repository generation

| Field | Value |
| --- | --- |
| Baseline HEAD | `c7f9d04ce9154e984d0b2de9058a3d022f6f88fb` |
| Observed `origin/main` | `7256d72a7aa331dcf87d71b1b26706d1cc9f6ca3` |
| Merge base | `b02b0c4587d339af17e6b1d7925e138281533e3f` |
| Initial divergence | local ahead 46, behind 6 |
| Staged paths at freeze | none |
| Browser policy | Codex in-app Browser only |
| Commit policy | conventional subject/body; unique final joke containing `https://devme.me/`; no AI trailers |

## Execution ledger

| ID | Unit | Dependencies | Status | Source owner / paths | Browser-free gate | Browser evidence | Source commit | Evidence commit / limitation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| STAB-01 | Freeze writers and classify dirty work | none | in-progress | root + four read-only audits | clean ownership inventory | not applicable | pending | no staging until classification closes |
| STAB-02 | Shared evidence contracts and source closures | STAB-01 | todo | `labs/runtime`, `labs/schema`, corpus/harness closure modules | focused schema/runtime tests | none | pending | pending |
| STAB-03 | Object Sculptor runtime transactions and generations | STAB-02 | todo | corpus runtime/controller/frame driver | corpus unit/mutation suite | lifecycle runner | pending | pending |
| STAB-04 | Object Sculptor in-app collection and importer | STAB-03 | todo | corpus runner/server/import/metrics | route/runner/import tests | 15 routes + 48 PNG + 15 masks | pending | pending |
| STAB-05 | Commit coherent fields/materials/motion work | STAB-01 | todo | three existing canonical labs | package/unit/mutation suites | lab-specific | pending | pending |
| GIT-01 | Integrate `origin/main` and regenerate derivatives | STAB-02..05 | todo | root manifests/generated docs | registry/foundation/build checks | none | pending | normal merge; no force |
| ROUTE-01 | Generate complete skill roster and router schema | GIT-01 | todo | `threejs-choose-skills` | route fixtures/mutations | router lab | pending | current 27, then 32 after new owners |
| PHYS-01 | Executable physics conformance profiles | GIT-01 | todo | `labs/runtime/physics`, schemas | closed-schema and graph tests | mechanism diagnostics | pending | render-only/query/one-way/two-way/external |
| VALID-01 | Shared Codex in-app Browser evidence runtime | GIT-01, PHYS-01 | todo | visual-validation harness | runner/import/source-closure tests | same-origin physical runner | pending | Playwright/Chrome forbidden in canonical paths |
| SKILL-NEW-01 | Physics integration skill | ROUTE-01, PHYS-01 | todo | new skill + adapter lab | quick validation + conformance tests | adapter lab | pending | pending |
| SKILL-NEW-02 | Lighting/environments/reflections skill | ROUTE-01 | todo | new skill + two lighting labs | quick validation + decision fixtures | product/coastal routes | pending | pending |
| SKILL-NEW-03 | Asset pipeline and optimization skill | ROUTE-01 | todo | new skill + scripts/manifests | quick validation + asset fixtures | asset-budget lab | pending | pending |
| SKILL-NEW-04 | Environment forcing skill | ROUTE-01, PHYS-01 | todo | new skill + forcing lab | quick validation + SI/provider tests | forcing diagnostics | pending | pending |
| SKILL-NEW-05 | Volumes/point-clouds/large-data skill | ROUTE-01 | todo | new skill + large-data lab | quick validation + representation fixtures | large-data routes | pending | pending |
| TOWER-01 | Tower hull/topology/pass-lock correctness | STAB-03 | todo | Tower Ship sculptor | topology/contract/mutation tests | bow/final diagnostics | pending | pending |
| TOWER-02 | Tower visible animation and terminal HUD | TOWER-01 | todo | Tower Ship runtime | exact reset/motion-region tests | action-ready captures | pending | pending |
| CORPUS-01 | Lamp, bonsai, teapot corpus acceptance | STAB-04 | todo | Object Sculptor corpus | metrics/review/resource/lifecycle gates | full corpus matrix | pending | pending |
| PLANET-01 | Metric displacement and body-frame contract | GIT-01 | todo | procedural planets + Weathered World | deterministic frontier fixtures | orbit/horizon/surface | pending | pending |
| PLANET-02 | Device-limit atlas paging | PLANET-01 | todo | planet atlas/runtime adapter | planner/boundary tests | forced page cap | pending | pending |
| PLANET-03 | Transition-mask batching and transactions | PLANET-02 | todo | planet mesh/host lifecycle | ownership/fault/leak tests | 18 final/no-post + diagnostics | pending | pending |
| LAND-01 | Coastal causal-field bundle | PHYS-01 | todo | procedural fields | parity/topology/redistance/drainage | field diagnostics | pending | pending |
| LAND-02 | Manifold coastal mesh/support compiler | LAND-01 | todo | procedural geometry | DCEL/manifold/LOD/support | topology/support captures | pending | pending |
| LAND-03 | Coupled coastal materials and asset variants | LAND-01, LAND-02, SKILL-NEW-03 | todo | procedural materials/assets | identity/filter/binding tests | close/grazing/minified | pending | pending |
| LAND-04 | Coastal ecology compiler | LAND-01, LAND-02 | todo | procedural vegetation | halo/conflict/support tests | population/LOD routes | pending | pending |
| LAND-05 | Semantic ruin/dock/skiff/geology site kit | LAND-01..04 | todo | buildings/cities | family/socket/obstacle/proxy tests | site routes | pending | pending |
| WATER-01 | Analytic coastal wave compiler | LAND-01, PHYS-01 | todo | water optics | dispersion/eikonal/action gates | analytic route | pending | pending |
| WATER-02 | Sparse persistent Saint-Venant solver | LAND-01, PHYS-01 | todo | water optics | lake/dam/Thacker/closure tests | SWE route | pending | pending |
| WATER-03 | Paged active-domain state | WATER-02 | todo | water optics | sparse/dense/overflow/catch-up | sparse diagnostics | pending | pending |
| WATER-04 | Packed offshore FFT cascades | PHYS-01 | todo | spectral ocean | DFT/FFT/Hermitian/Parseval | spectral route | pending | pending |
| WATER-05 | Spectral-to-coastal handoff | WATER-01..04 | todo | spectral ocean + water optics | phase/discharge/reflection gates | seam diagnostics | pending | pending |
| WATER-06 | Unified foam, wetness, optics, caustics | WATER-01..05, LAND-03 | todo | water optics/material receiver | source/exact-once/optical tests | contribution diagnostics | pending | pending |
| PHYS-02 | Dynamic skiff two-way coupling | WATER-02, LAND-05 | todo | shared physics mechanism | equilibrium/reaction/contact/rollback | coupling route | pending | pending |
| CRAB-01 | Segmented crab geometry and rig | PHYS-01, LAND-02 | todo | procedural creatures | topology/rig/profile tests | final/tier captures | pending | pending |
| CRAB-02 | Support-relative gait and water interaction | CRAB-01, WATER-02 | todo | creatures + motion | IK/reset/omitted-feedback tests | action/mechanism routes | pending | pending |
| ARCH-01 | Compose reusable archipelago owners | LAND-01..05, WATER-01..06, CRAB-02 | todo | integration lab | owner/ID/resource graph tests | 72 core captures | pending | pending |
| ARCH-02 | Deterministic camera, lighting, shadows | ARCH-01, SKILL-NEW-02 | todo | camera/shadow/lighting owners | matrix/fit/caster tests | four bookmarks | pending | pending |
| ARCH-03 | Opaque/water/output pipeline | ARCH-01, ARCH-02 | todo | image pipeline | pass/depth/refraction/output tests | final/no-post/diagnostics | pending | pending |
| ARCH-04 | Transactional extent, quality, recovery | ARCH-03 | todo | integration host | fault/resize/recovery/leak tests | lifecycle routes | pending | pending |
| SKILL-CLOSE-01 | Remaining existing-skill executable closures | VALID-01 | todo | AO/bloom/exposure/shadows/atmosphere/clouds/rain/FX/black holes | owner-specific suites | owner-specific routes | pending | no umbrella cleanup commit |
| DOCS-01 | Publish routing and regenerate registries/docs | all source units | todo | source generators only | manifest/foundation/site build | smoke routes | pending | generated commit separate |
| EVID-01 | Source-frozen physical evidence commits | source-complete units | todo | content-addressed artifact bundles | artifact validators | Codex Browser only | n/a | one commit per lab/target |
| PERF-01 | M4 Max flagship performance | accepted source | todo | physical host | timing/resource validators | cadence + GPU lanes | n/a | named target only |
| PERF-02 | M1/M2 Air conservative performance | accepted source | todo | second physical host | timing/resource validators | cadence + GPU lanes | n/a | `blocked` if host unavailable |
| FINAL-01 | Requirement-by-requirement completion audit | all | todo | repository | full test/build/registry audit | direct artifact inspection | pending | do not mark complete on partial evidence |
| PUSH-01 | Normal push of `main` | accepted source/evidence wave | todo | Git | fetch/merge/integration checks | none | pending | verify remote divergence `0/0` |

## Protected invariants

- Native Three.js r185 WebGPU/TSL is canonical.
- Low-end/mobile pressure never activates renderer fallback.
- Mobile performance is not measured under the Browser-only constraint.
- Physics, render, evidence, and generated-document generations remain distinct.
- Render LOD never changes physics/support/collider identity.
- A screenshot alone cannot prove a solver, motion, resource, or timing claim.
- No source correction is patched around with edited evidence JSON; recapture instead.
