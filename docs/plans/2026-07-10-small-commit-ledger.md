# Small Thematic Commit Ledger — 2026-07-10

## Execution status — 2026-07-11

The ledger remains the source-to-publication order, but Phase A has advanced.
Do not recreate already landed commits or fold their remaining working-tree
supersets into later lab commits.

| Boundary | Status | Evidence |
| --- | --- | --- |
| A01 | complete | `1f56368` |
| A02–A18 | role closure landed, historical grouping differs from the proposed one-file split | `916e377`, `3be3966`, earlier lifecycle commits; live `npm run test:skills` passes |
| A19 | complete | `070bfcc`; live `npm run test:skills` passes |
| A20 | complete as six fixture commits | `9cbb5e4`, `359be02`, `a7519d2`, `5b0330f`, `c5e549f`, `04f4897`; full router suite passes |
| A21 | pending | implementation-matrix and source auditors remain untracked |
| A22 | complete locally | `1abe419`; rerun after source freeze |
| A23 | complete | `438be92` |
| B–F | pending | no proxy, lab, evidence, or generated publication row is accepted by this reconciliation |

### A20 executed split

The original A20 row understated the fixture count. It was correctly landed as
these smaller units:

1. `test(physics): close provider and water causality` — provider, water,
   environment, and error-ledger closure.
2. `test(physics): close contact and material identity` — sampled material,
   support, contact, and exact-once identity closure.
3. `test(physics): close external and GPU ownership` — directional adapter,
   recovery, receipt, and GPU-generation closure.
4. `test(physics): close physical impact partitions` — chart partition,
   non-overlap, measure, and commodity closure.
5. `test(physics): reconcile quality migration resources` — old/new/scratch
   allocations, traffic, completion, conservation, and retirement.
6. `test(physics): execute routed semantic invariants` — canonical route
   integration and the schema-keyed semantic runner.

The authoritative verification at `04f4897` passed 12 recipes, 33 semantic
invariants, 123 semantic cases, 5,230 subject-record validations, and 215
negative cases in 265 seconds.

## Commit rules

Every row below is an independent commit boundary. Do not bulk-stage an entire
skill directory unless the row explicitly says so.

For every commit:

1. Review the staged diff with `git diff --cached --check` and
   `git diff --cached --stat`.
2. Verify from a temporary index or clean worktree so unrelated unstaged files
   cannot make the commit appear green.
3. Run the row's focused command plus the nearest root gate.
4. Use `type(scope): subject`, a descriptive body, and a final original joke
   tailored to the change.
5. The joke must contain `https://devme.me/` and must not already occur in
   `git log`.
6. Never add AI attribution trailers.
7. Preserve and partially stage the user-owned creature work; never reset,
   stash, or absorb unrelated creature hunks.

## File-bucket policy for every lab

Each lab is split into at most three commits:

- **Core** — runtime algorithms, renderer/stage/controller code, and the base
  browser entry required to exercise that runtime. Exclude tests, capture,
  evidence, manifests, generated wrappers, and documentation.
- **Contracts** — unit/oracle/mutation tests, route locks, `lab.manifest.json`,
  package scripts, README boundary text, and physical mechanism/tier wrappers.
- **Evidence** — capture/readback/artifact validators and accepted evidence.
  Evidence is committed only after native-WebGPU capture succeeds. A truthful
  `INSUFFICIENT_EVIDENCE` guard may accompany Contracts, but images or summaries
  cannot be promoted as accepted evidence.

Generated `docs/`, `skills.json`, and `labs/demo-registry.json` never accompany
a lab Core or Contracts commit.

## Phase A — repository and physics-contract closure

These commits precede every lab commit.

| Order | Commit subject | Exact staging boundary | Required verification |
| ---: | --- | --- | --- |
| A01 | `docs(audit): record uncommitted gap and commit ledgers` | only the two `docs/plans/2026-07-10-*` files | Markdown inspection; no generated Pages |
| A02 | `docs(camera): close presentation execution boundary` | `threejs-camera-controls-and-rigs/SKILL.md` only | `npm run test:skills` in an isolated staged checkout after all A02–A18 docs are applied |
| A03 | `docs(router): close route interaction and quality boundaries` | `threejs-choose-skills/SKILL.md` only | router corpus token check |
| A04 | `docs(surface): bind dynamic history to presentation candidates` | `threejs-dynamic-surface-effects/SKILL.md` only | skill corpus token check |
| A05 | `docs(exposure): close frame execution ownership` | `threejs-exposure-color-grading/SKILL.md` only | skill corpus token check |
| A06 | `docs(particles): close physics pool boundaries` | `threejs-particles-trails-and-effects/SKILL.md` only | skill corpus token check |
| A07 | `docs(buildings): close collider adapter boundaries` | `threejs-procedural-buildings-and-cities/SKILL.md` only | skill corpus token check |
| A08 | `docs(creatures): bind support and water providers` | only the relevant `threejs-procedural-creatures/SKILL.md` hunks | skill corpus token check; preserve all existing creature work |
| A09 | `docs(fields): bind semantic physics materials` | `threejs-procedural-fields/SKILL.md` only | skill corpus token check |
| A10 | `docs(materials): close frame execution projection` | `threejs-procedural-materials/SKILL.md` only | skill corpus token check |
| A11 | `docs(motion): bind graph and water sampling` | `threejs-procedural-motion-systems/SKILL.md` only | skill corpus token check |
| A12 | `docs(planets): bind material and quality transitions` | `threejs-procedural-planets/SKILL.md` only | skill corpus token check |
| A13 | `docs(weather): close graph and exact-once application` | `threejs-rain-snow-and-wet-surfaces/SKILL.md` only | skill corpus token check |
| A14 | `docs(atmosphere): bind the shared physics context` | `threejs-sky-atmosphere-and-haze/SKILL.md` only | skill corpus token check |
| A15 | `docs(ocean): close water exchange publications` | `threejs-spectral-ocean/SKILL.md` only | skill corpus token check |
| A16 | `docs(validation): observe the executable physics graph` | `threejs-visual-validation/SKILL.md` only | skill corpus token check |
| A17 | `docs(clouds): bind cloud stages to the physics graph` | `threejs-volumetric-clouds/SKILL.md` only | skill corpus token check |
| A18 | `docs(water): close candidate and exact-once boundaries` | `threejs-water-optics/SKILL.md` only | skill corpus token check |
| A19 | `test(skills): enforce the executable physics boundary matrix` | `scripts/validate-skills-manifest.mjs` only | `npm run test:skills`; all 26 skill rows must pass |
| A20 | `test(router): split and validate physical route fixtures` | `router-contract.test.mjs` plus the three `router-contract-*-fixtures.mjs` modules | direct router contract; SI-temperature mutation must fail for the intended gate |
| A21 | `test(labs): audit canonical implementation coverage` | `scripts/check-lab-implementation-matrix.mjs`, `scripts/check-lab-sources.mjs` | both scripts plus `node --test tests/labs/*.test.mjs` |
| A22 | `test(pages): validate source hashes and local routes` | `scripts/validate-pages-source-hashes.mjs`, `scripts/pages-smoke.mjs` | both scripts against frozen generated output |
| A23 | `fix(creatures): deduplicate artifact allowlist` | one copy of the creature artifact rules in `.gitignore`, artifact `.gitignore`, artifact schema | `git check-ignore` cases plus creature artifact validator |

`scripts/grok-ralph-loop.sh` and `scripts/ralph-grok-loop.sh` are on hold. They
overlap and reference a missing `ralph_task.md`; neither belongs in A01–A23.

## Phase B — secondary provider surfaces

Provider work stays explicitly secondary and cannot be mixed with canonical
lab acceptance.

| Order | Commit subject | Exact staging boundary |
| ---: | --- | --- |
| B01 | `feat(proxies): add the classified provider presentation runtime` | `labs/provider-proxies/provider-demo.mjs`, `provider-demo.css`; add direct classification/mode tests before commit |
| B02 | `feat(fields-proxy): add biome field variants` | three `biome-field-*.png` assets only |
| B03 | `feat(water-proxy): add caustic field variants` | three `caustic-field-*.png` assets only |
| B04 | `feat(planets-proxy): add crater mask variants` | three `crater-mask-*.png` assets plus generated-crater proxy validation files |
| B05 | `feat(ocean-proxy): add directional wave variants` | three `directional-wave-seed-*.png` assets plus generated-wave proxy validation files |
| B06 | `feat(surface-proxy): add frost crystal variants` | three `frost-crystal-*.png` assets only |
| B07 | `feat(materials-proxy): add lava cause variants` | three `lava-cause-*.png` assets only |
| B08 | `feat(vegetation-proxy): add meadow density variants` | three `meadow-density-*.png` assets only |
| B09 | `feat(weather-proxy): add ripple normal variants` | three `ripple-normal-*.png` assets only |
| B10 | `feat(space-proxy): add starfield variants` | three `starfield-tile-*.png` assets plus generated-starfield validator changes |
| B11 | `feat(clouds-proxy): add weather map variants` | three `weather-map-*.png` assets plus generated-weather validator changes |

Every B commit must keep proxy classification visible and must not modify
primary completion counts.

## Phase C — shared validation and image-pipeline dependency chain

For each row, apply the Core/Contracts/Evidence bucket policy. Evidence remains
deferred until capture succeeds.

| Order | Lab | Core commit | Contracts commit | Evidence commit after capture |
| ---: | --- | --- | --- | --- |
| C01 | `webgpu-validation-harness` | `feat(validation): execute the native WebGPU validation subject` | `test(validation): lock v2 routes and blocking mutations` | `test(validation): publish current-adapter v2 evidence` |
| C02 | `webgpu-image-pipeline` | `feat(image-pipeline): build the shared MRT and history graph` | `test(image-pipeline): lock signal ownership and temporal routes` | `test(image-pipeline): capture native MRT and history evidence` |
| C03 | `webgpu-temporal-history` | no duplicate core; import C02 | `test(temporal): add locked history mechanism routes` | captured with C02 but separate artifact verdict |
| C04 | `webgpu-exposure-color-pipeline` | `feat(exposure): execute histogram adaptation and LUT grading` | `test(exposure): lock metering and grading contracts` | `test(exposure): capture reduction and timing evidence` |
| C05 | `webgpu-node-gtao` | `feat(ao): execute the GTAO and denoise stages` | `test(ao): lock fixtures tiers and pass accounting` | `test(ao): capture AO mechanism evidence` |
| C06 | `integration-image-pipeline-ao` | `feat(ao): integrate the honest prepass and lit pass` | `test(ao): lock shared signal ownership` | `test(ao): capture integrated AO evidence` |
| C07 | `node-selective-bloom` | `feat(bloom): execute selective BloomNode composition` | `test(bloom): lock emissive PSF and tier contracts` | `test(bloom): capture BloomNode resource evidence` |
| C08 | `webgpu-cached-clipmap-shadow` | `feat(shadows): consume committed clipmap levels` | `test(shadows): lock scheduling bias and parity contracts` | `test(shadows): capture receiver and depth evidence` |
| C09 | `webgpu-shadow-architecture-bench` | `feat(shadows): compare bounded CSM tiled and cached paths` | `test(shadows): lock architecture comparison contracts` | `test(shadows): capture architecture timing evidence` |
| C10 | `webgpu-shadow-pipeline-integration` | `feat(shadows): integrate child shadow publications` | `test(shadows): lock single-output ownership` | `test(shadows): capture integrated shadow evidence` |

Do not commit C01–C10 Core rows while their known browser route still throws.
The focused route must initialize and render successfully first.

## Phase D — standalone procedural and simulation labs

| Order | Lab | Core commit | Contracts commit | Deferred evidence commit |
| ---: | --- | --- | --- | --- |
| D01 | `webgpu-camera-rig` | `feat(camera): implement body-relative rigs and floating origin` | `test(camera): lock replay collision velocity and lifecycle` | `test(camera): capture MRT and origin evidence` |
| D02 | `webgpu-procedural-timelines` | `feat(motion): execute deterministic storage timelines` | `test(motion): lock reparent docking and interpolation contracts` | `test(motion): capture compute and MRT evidence` |
| D03 | `webgpu-touch-history-frost` | `feat(surface): execute storage-texture frost history` | `test(surface): lock odd dispatch diffusion and route contracts` | `test(surface): capture history and timing evidence` |
| D04 | `webgpu-field-bake` | `feat(fields): execute gradient bake mips and placement` | `test(fields): lock parity dirty-tile and route contracts` | `test(fields): capture storage and placement evidence` |
| D05 | `semantic-mesh-writer` | `feat(geometry): implement semantic mesh and indirect strategies` | `test(geometry): lock topology tangent update and route contracts` | `test(geometry): capture native draw evidence` |
| D06 | `tsl-procedural-pbr` | `feat(materials): execute procedural PBR channel identities` | `test(materials): lock filtering atlas dissolve and routes` | `test(materials): capture channel and shadow evidence` |
| D07 | `webgpu-material-slot-compiler` | `feat(buildings): compile deterministic city material slots` | `test(buildings): lock grammar geometry and disposal contracts` | `test(buildings): capture compiled-resource evidence` |
| D08 | `webgpu-quadtree-planet` | `feat(planets): execute balanced cube-sphere patch rendering` | `test(planets): lock field quadtree atlas and routes` | `test(planets): capture patch and atlas evidence` |
| D09 | `webgpu-dense-grass` | `feat(vegetation): execute dense spatially ranked grass` | `test(vegetation): lock wind LOD storage and routes` | `test(vegetation): capture grass storage evidence` |
| D10 | `structured-ash-growth` | `feat(vegetation): render structured growth and forest storage` | `test(vegetation): preserve Ash contract and route locks` | `test(vegetation): capture shadow and forest evidence` |
| D11 | `webgpu-vegetation-integration` | `feat(vegetation): compose grass growth weather and contacts` | `test(vegetation): lock shared identities and ownership` | `test(vegetation): capture integration evidence` |
| D12 | `webgpu-rain-snow-and-wet-surfaces` | `feat(weather): execute coupled precipitation and wet surfaces` | `test(weather): lock impacts accumulation and routes` | `test(weather): capture weather storage evidence` |
| D13 | `integration-precipitation-image-pipeline` | `feat(weather): integrate precipitation with the host pipeline` | `test(weather): lock host signal ownership` | `test(weather): capture integrated weather evidence` |
| D14 | `webgpu-lut-atmosphere` | `feat(atmosphere): execute the LUT scattering chain` | `test(atmosphere): lock radiometry depth and routes` | `test(atmosphere): capture LUT and timing evidence` |
| D15 | `webgpu-weather-volume-clouds` | `feat(clouds): execute bounded volumetric transport` | `test(clouds): lock density history shadow and routes` | `test(clouds): capture transport evidence` |
| D16 | `webgpu-fft-ocean` | `feat(ocean): execute cascaded FFT displacement and foam` | `test(ocean): lock FFT optics query and routes` | `test(ocean): capture cascade and foam evidence` |
| D17 | `webgpu-bounded-water` | `feat(water): execute bounded waves caustics and optics` | `test(water): lock impulses masks optics and routes` | `test(water): capture receiver and optics evidence` |
| D18 | `tsl-curved-ray` | `feat(space): execute curved-ray and lens-cache modes` | `test(space): lock metric convergence temporal and routes` | `test(space): capture metric and cache evidence` |
| D19 | `webgpu-pooled-effects` | `feat(particles): execute GPU pool compaction and indirect draws` | `test(particles): lock identity trajectories and routes` | `test(particles): capture indirect and emissive evidence` |
| D20 | `webgpu-procedural-creature-lab` | `feat(creatures): complete certified creature runtime` | `test(creatures): lock contributor locomotion and route contracts` | `test(creatures): capture subject-aware native evidence` |

The ocean package-lock deletion belongs in D16 Contracts only after confirming
the root-managed dependency model and clean `npm ci` behavior.

## Phase E — integration flagships

Each flagship gets three independent commits: host runtime, owner/route tests,
and accepted evidence.

| Order | Flagship | Runtime commit | Contract commit | Evidence commit |
| ---: | --- | --- | --- | --- |
| E01 | Final Image Flight | `feat(flagship): compose final image flight` | `test(flagship): lock final image owners and tiers` | `test(flagship): capture final image flight evidence` |
| E02 | Weathered World | `feat(flagship): compose the weathered world` | `test(flagship): lock world units weather and water owners` | `test(flagship): capture weathered world evidence` |
| E03 | Procedural District | `feat(flagship): compose the procedural district` | `test(flagship): lock field geometry and material ownership` | `test(flagship): capture procedural district evidence` |
| E04 | Creature Habitat | `feat(flagship): compose the creature habitat` | `test(flagship): lock contacts culling and output ownership` | `test(flagship): capture creature habitat evidence` |
| E05 | Relativistic Space Shot | `feat(flagship): compose the relativistic space shot` | `test(flagship): lock temporal emissive and exposure ownership` | `test(flagship): capture relativistic shot evidence` |

No E row is accepted merely because its unit/mutation suite passes.

## Phase F — registries, previews, and Pages

These are final downstream commits after all source commits they describe.

| Order | Commit subject | Exact staging boundary | Required verification |
| ---: | --- | --- | --- |
| F01 | `chore(labs): regenerate the canonical demo registry` | `labs/demo-registry.json` only | registry validator with no drift |
| F02 | `chore(skills): regenerate the public skill catalog` | root `skills.json` and generated `docs/skills.json` only | skill manifest and catalog parity |
| F03 | `feat(seo): add substantial static demo shells` | Pages builder and static/live SEO validators only | local SEO validator; every demo shell at least 80 words |
| F04 | `feat(previews): publish classified primary preview media` | 12 `docs/previews/primary/*.png` plus preview manifest changes | provenance validator and manual image inspection |
| F05 | `docs(demos): publish source-hash-equivalent demo bundles` | `docs/demos/**` excluding preview media | source hashes and 95-route smoke test |
| F06 | `docs(site): publish the accepted catalog revision` | homepage, skill pages, sitemap, robots/manifest metadata | presentation, SEO, source hashes, smoke |

F05 and F06 must not be generated from a dirty or changing source tree.

## Final clean-checkout gate

After the ledger is complete, run exactly:

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

Any failed row remains uncommitted or gets a focused follow-up commit; failures
are never hidden in a broad generated-output commit.
