# COMPOSER_25_PROBLEMS.md

**Review date:** 2026-07-05  
**HEAD:** `4bca3bd289c2f55be7d0ee4fb77bae6842e8b896`  
**Method:** 25 dedicated subagents (one per skill pack + procedural-creatures stub), each with PhD Comp Sci + Physics adversarial prompts, file:line evidence mandate, Derived/Gated/Orphaned bucketing, and contamination rules. Orchestrator re-verified critical HEAD claims via direct reads/greps.  
**Deliverable:** Report only. No skill source files were modified.  
**Subagent artifacts:** `/Users/linegel/_reps/threejs/.agent/plans/audit-threejs-*.md` (25 files)  
**Prior synthesis:** `GROK_BUILD_PROBLEMS_2_cli.md` (cross-cutting adversarial record)  
**Subagent model policy:** **Composer 2.5 (non-fast) required** — see §0.1 below before any re-audit.

---

## §0 Process & Provenance

### §0.1 Subagent model policy (mandatory for re-audit)

**Requirement (user directive):** Each audit subagent MUST run on **Composer 2.5, non-fast** — the proper Cursor coding model, not Grok Build, not Grok 4, not `composer-2.5-fast` if a distinct full Composer slug exists.

**Environment check at report time (`grok models`, `~/.grok/models_cache.json`):**

| Slug | Display name | Status |
|---|---|---|
| `grok-composer-2.5-fast` | Composer 2.5 | **Only Composer slug exposed** in this account |
| `grok-composer-2.5` (non-fast) | — | **NOT in catalog** |
| `grok-build` | Grok Build | Available; **disallowed** for skill audits |
| `composer-2.5` (Task tool param) | — | Resolves to `grok-composer-2.5-fast` per spawn `meta.json` |

**Prior wave attestation (session `019f2f48-…`, 73 subagent spawns):**

| `effective_model_id` | Count | Verdict |
|---|---|---|
| `grok-composer-2.5-fast` | 70 | Composer family, but **`-fast` suffix** — not the requested non-fast slug |
| `grok-build` | 3 | **Invalid** for PhD skill audits — discard those three outputs |

Evidence path per spawn: `~/.grok/sessions/%2FUsers%2Flinegel%2F_reps%2Fthreejs/019f2f48-2dc5-75c2-bdbc-f64559b310de/subagents/<id>/meta.json` → field `effective_model_id`.

**Re-audit gate (do not launch 25 subagents until):**

1. Parent session model is Composer 2.5 (`/model` → picker shows **Composer 2.5**).
2. Pin subagent inheritance in `~/.grok/config.toml`:
   ```toml
   [subagents.models]
   general-purpose = "grok-composer-2.5-fast"   # only Composer slug today; rename when non-fast appears
   explore = "grok-composer-2.5-fast"
   plan = "grok-composer-2.5-fast"
   ```
3. Each subagent prompt header requires attestation block:
   ```markdown
   ## MODEL_ATTESTATION
   effective_model_id: <from meta.json after run>
   parent_model_id: <session model>
   PASS only if Composer family AND NOT grok-build
   ```
4. Orchestrator rejects any artifact whose `meta.json` shows `grok-build` or missing attestation.
5. When xAI/Cursor exposes **`grok-composer-2.5`** (no `-fast`), update config and **re-run all 25** — prior `-fast` audits are then stale for peer review.

**Cursor Task tool note:** Allowlisted slug is `composer-2.5-fast` only. Requesting `composer-2.5` still spawned `grok-composer-2.5-fast` in test `019f2f78-…`. There is **no separate non-fast slug** in this environment yet; user requirement is recorded as **blocked on catalog**, not waived.

### Subagent coverage (25/25)

| Skill pack | Subagent artifact |
|---|---|
| `threejs-image-pipeline` | `.agent/plans/audit-threejs-image-pipeline.md` |
| `threejs-spectral-ocean` | `.agent/plans/audit-threejs-spectral-ocean.md` |
| `threejs-procedural-creatures` | `.agent/plans/audit-threejs-procedural-creatures.md` |
| `threejs-ambient-contact-shading` | `.agent/plans/audit-threejs-ambient-contact-shading.md` |
| `threejs-bloom` | `.agent/plans/audit-threejs-bloom.md` |
| `threejs-scalable-real-time-shadows` | `.agent/plans/audit-threejs-scalable-real-time-shadows.md` |
| `threejs-volumetric-clouds` | `.agent/plans/audit-threejs-volumetric-clouds.md` |
| `threejs-sky-atmosphere-and-haze` | `.agent/plans/audit-threejs-sky-atmosphere-and-haze.md` |
| `threejs-exposure-color-grading` | `.agent/plans/audit-threejs-exposure-color-grading.md` |
| `threejs-procedural-planets` | `.agent/plans/audit-threejs-procedural-planets.md` |
| `threejs-procedural-fields` | `.agent/plans/audit-threejs-procedural-fields.md` |
| `threejs-water-optics` | `.agent/plans/audit-threejs-water-optics.md` |
| `threejs-procedural-geometry` | `.agent/plans/audit-threejs-procedural-geometry.md` |
| `threejs-procedural-vegetation` | `.agent/plans/audit-threejs-procedural-vegetation.md` |
| `threejs-procedural-materials` | `.agent/plans/audit-threejs-procedural-materials.md` |
| `threejs-procedural-motion-systems` | `.agent/plans/audit-threejs-procedural-motion-systems.md` |
| `threejs-procedural-buildings-and-cities` | `.agent/plans/audit-threejs-procedural-buildings-and-cities.md` |
| `threejs-particles-trails-and-effects` | `.agent/plans/audit-threejs-particles-trails-and-effects.md` |
| `threejs-black-holes-and-space-effects` | `.agent/plans/audit-threejs-black-holes-and-space-effects.md` |
| `threejs-camera-controls-and-rigs` | `.agent/plans/audit-threejs-camera-controls-and-rigs.md` |
| `threejs-rain-snow-and-wet-surfaces` | `.agent/plans/audit-threejs-rain-snow-and-wet-surfaces.md` |
| `threejs-dynamic-surface-effects` | `.agent/plans/audit-threejs-dynamic-surface-effects.md` |
| `threejs-visual-validation` | `.agent/plans/audit-threejs-visual-validation.md` |
| `threejs-compatibility-fallbacks` | `.agent/plans/audit-threejs-compatibility-fallbacks.md` |
| `threejs-choose-skills` | `.agent/plans/audit-threejs-choose-skills.md` |

### Contamination rule (applied uniformly)

Anything outside a skill's own contracts and declared sibling `$threejs-*` wiring is **infected**. Islands/clicker/zoopark fingerprints and disconnected proof subgraphs are toxic by definition. Every quantitative claim is bucketed:

- **Derived:** computed from declared parameters in skill contracts or installed Three.js source.
- **Gated:** requires browser/GPU execution; prose or grep cannot close it.
- **Orphaned:** stated in docs/manifests but not wired into the reachable GPU graph.

### Peer-review reconciliation (HEAD re-verify)

| Prior ID | Status at HEAD | Evidence |
|---|---|---|
| **P34** (evolve breaks Hermitian) | **RETRACTED** | `compute-kernels.js:258` applies `complexMul(h, phase) + complexMul(conj-partner, conj(phase))` — evolution preserves conjugate symmetry *given* Hermitian h₀. |
| P34b (h₀ init breaks Hermitian) | **OPEN — P53** | `compute-kernels.js:225-228` draws **independent** `gaussianPair(mirrored, seed)` for mirrored cell; not conj(primary). |
| P41 (0.78/0.22 lighting split) | **RETRACTED at HEAD** | `main.js:78-79` uses `aoPreservedDirect = hdrColor` with no split constants. |
| P42 (GTAO computed, not applied) | **CONFIRMED** | `main.js:70-79`: `gtao` built; `hdrComposite = aoPreservedDirect.add(bloom…)` — AO scalar never modulates composite. |
| P41 (setDebugMode inert) | **CONFIRMED** | `main.js:134-145`: updates `diagnostics.activeView` only; never assigns `renderPipeline.outputNode`. Render path stays `renderOutput(finalNode)` from `:85`. |
| Ghost creatures SKILL.md | **CONFIRMED** | `threejs-procedural-creatures/` contains only `plan.md` + `agents/openai.yaml`; **no `SKILL.md`**. Router still emits `$threejs-procedural-creatures` at `threejs-choose-skills/SKILL.md:192`. |

---

## §1 Executive — Cross-Cutting Architecture Fracture

```mermaid
flowchart TB
  subgraph doctrine [Doctrine Layer — Strong]
    IP[image-pipeline MRT contract]
    CS[choose-skills preflight]
    QBar[SKILL_QUALITY_BAR Layer 1-2]
  end
  subgraph impl [Implementation Layer — Fractured]
    Ex[Per-skill examples — islands]
    Val[String-grep validators]
    Stub[CPU scheduler stubs]
  end
  subgraph graph [Composition Graph — Broken]
    Route[~/.claude vs workspace name split]
    Tone[Multiple outputColorTransform owners]
    Shadow[Zero GPU shadow depth]
  end
  doctrine --> impl
  impl -.->|validators pass| Val
  impl -.->|no GPU proof| Stub
  Route --> graph
  IP --> Tone
  Shadow --> graph
```

### 1.1 Disconnected proof subgraphs (P0 theme)

**Claim:** Doctrine ≫ implementation across the pack. Validators and review prose pass while the reachable WebGPU graph is stub, orphan, or string-grep.

| Pattern | Blast radius | Bucket |
|---|---|---|
| String-token `validate.js` (shadows, particles, clouds) | Entire procedural + post stack | **Orphaned** gates |
| No `examples/` runnable path (image-pipeline ref-only; ambient-contact; exposure; visual-validation) | Agents invent graphs from prose | **Orphaned** proof |
| CPU-only `renderShadow()` | planets, ocean, vegetation, creatures, buildings | **Orphaned** GPU path |
| `setDebugMode` without `outputNode` mutation | All diagnostic contracts | **Orphaned** debug routing |

### 1.2 Composition fracture (P0 theme)

**Single-owner violations** documented in multiple packs:

| Owner | Declared owner | Violators |
|---|---|---|
| Tone map / output transform | `threejs-image-pipeline` + `threejs-exposure-color-grading` | `ocean-nodes.js:217` (`outputColorTransform = true`); legacy `cloud-system.js` local tone/gamma; sky scaffold double `renderOutput` |
| Shared gbuffer MRT | `threejs-image-pipeline` | Per-skill local `RenderPipeline` in ocean, bloom example, black-holes demo |
| Velocity field | `threejs-image-pipeline` | Clouds temporal same-UV; dynamic-surface frost stub; black-holes temporal placeholder |
| Weather envelope | `threejs-rain-snow-and-wet-surfaces` | Clouds/volumetric own parallel weather state in legacy paths |

**HEAD evidence — GTAO orphan in image-pipeline:**

```76:85:threejs-image-pipeline/examples/webgpu-image-pipeline/main.js
	const indirectVisibility = gtao.getTextureNode().r;
	const debugFinalColorMultiplyBaseline = hdrColor.mul( indirectVisibility );
	const aoPreservedDirect = hdrColor;
	const hdrComposite = aoPreservedDirect.add( bloomPass.getTextureNode() );
	// ...
	renderPipeline.outputNode = renderOutput( finalNode );
```

GTAO dispatch cost is **Derived** paid; AO effect on final image is **Orphaned** (computed texture unused in composite).

### 1.3 Routing infection (P0 theme)

| Location | Routes to | Workspace routes to |
|---|---|---|
| `~/.claude/skills/threejs-image-pipeline/SKILL.md` | `$threejs-screen-space-ambient-occlusion` | `$threejs-ambient-contact-shading` |
| `threejs-choose-skills/SKILL.md:192` | `$threejs-procedural-creatures` | **No SKILL.md exists** |

Subagent IDs without file:line transcripts are theater — every finding below cites path:line from orchestrator reads or subagent artifacts.

### 1.4 Validator theater (P1 theme)

**Shadows** — `validate.js:172-189` asserts substring presence (`wind`, `invalidate`, `castShadowPositionNode` string in `debug-views.js:67`) while `clipmap-shadow-node.js:76-81` performs zero GPU work:

```76:81:threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/clipmap-shadow-node.js
  renderShadow(frame) {
    for (const render of this.pendingRenders) {
      commitLevelRender(render.level, render.desired);
      render.level.lastFrame = frame?.frameId ?? 0;
    }
    this.pendingRenders = [];
  }
```

**Particles** — `validate-effects.mjs:129` uses `source.includes(required)` pattern (same class).

### 1.5 Ranked cross-pack severity (P41+)

| ID | Severity | Finding | Bucket |
|---|---|---|---|
| P41 | P0 | Custom clipmap `renderShadow()` — 0 GPU depth renders | Orphaned |
| P42 | P0 | No `castShadowPositionNode` example for displaced casters | Orphaned |
| P43 | P0 | Ghost `$threejs-procedural-creatures` — routed, no SKILL.md | Orphaned |
| P44 | P0 | Skill name divergence `~/.claude` vs workspace (ambient-contact) | Derived (grep) |
| P45 | P0 | GTAO computed, not applied in canonical image-pipeline | Derived (read) |
| P46 | P0 | `setDebugMode` inert — no `outputNode` switch | Derived (read) |
| P47 | P0 | Ocean `outputColorTransform=true` vs image-pipeline `false` | Derived (read) |
| P48 | P1 | FFT dispatch storm — per-stage `computeAsync` in `ocean-system.js` | Derived (grep) |
| P49 | P1 | Legacy clouds `PRIMARY_STEPS=320` — ~70× budget | Derived (read) |
| P50 | P1 | No composed integration scene proving single MRT/velocity/tone owners | Orphaned |
| P51 | P1 | Fields/planets CPU-vs-CPU parity labeled "TSL parity" | Orphaned |
| P52 | P1 | Visual-validation protocol without runnable harness | Orphaned |
| P53 | P2 | h₀ init independent mirrored Gaussian (Hermitian at t=0) | Derived (read) |
| P54 | P2 | Bloom internal draw count omitted from pipeline budgets | Derived |
| P55 | P2 | Exposure meter placement pre-bloom in composed stacks | Gated |

---

## §2 Per-Skill Adversarial Findings (P41+)

Finding IDs continue from §1.5 per skill. Each section: **CRITICAL/HIGH**, **POSITIVE**, **ORPHANS**, **INFECTED_REFERENCES**, **REVERIFY_AT_HEAD**.

---

### 2.1 `threejs-image-pipeline` (architecture owner)

**CRITICAL**
- **P45** GTAO orphan: `main.js:70-79` — **Derived**
- **P46** `setDebugMode` inert: `main.js:134-145` vs `:85` fixed `outputNode` — **Derived**
- **P56** Reference skeleton still teaches final-color multiply path: `production-image-pipeline.md:77-86` `applyIndirectVisibilityOnly` is no-op returning `color` — doctrine/code split — **Orphaned** helper
- **P57** No `examples/` at skill root per subagent A-state; example exists under `examples/webgpu-image-pipeline/` but subagent audit predates — **reconcile:** example present at HEAD; validator `validateImagePipelineConfig.js` checks scalar `sceneRenderCount===1` not reachable graph — **Orphaned** gate

**HIGH**
- **P58** Missing velocity MRT in canonical example — TRAA only if `options.velocityNode` injected — **Orphaned** temporal contract
- **P59** Internal GTAO/Bloom/TRAANode RT pressure omitted from `SKILL.md:155-160` budgets — **Derived** from BloomNode mip pyramid
- **P60** No integration scene with siblings — **Orphaned** (subagent C.5)

**POSITIVE**
- Single `scenePass` + `setMRT` architecture correct at `main.js:57-64`
- `outputColorTransform = false` + `renderOutput` ownership correct at `:84-85`
- 0.78/0.22 split removed at HEAD (**P41 retracted**)

**COMPOSITION_EDGES:** Consumes ambient-contact, bloom, exposure; provides MRT/depth/normal contract to all post users.

---

### 2.2 `threejs-spectral-ocean` (FFT + dispersion)

**CRITICAL**
- **P47** `ocean-nodes.js:217` `pipeline.outputColorTransform = true` — double tone-map risk when composed — **Derived**
- **P48** Dispatch storm: `ocean-system.js:38-40` `await renderer.computeAsync(nodes)` per batch; ~9 stages × 2 axes × 4 fields × N cascades per frame — **Derived** (subagent + GROK §2.3)
- **P53** h₀ Hermitian at init: `compute-kernels.js:225-228` independent `gaussianPair(mirrored)` — **Derived** (evolve **P34 retracted** at `:258`)

**HIGH**
- **P61** CPU `validation.js` does not execute GPU FFT kernels — **Orphaned** GPU proof (subagent B.5)
- **P62** Storage budget mismatch: 17 vs 18 textures, ultra tier ~102 MiB vs 96 MiB claim — **Derived** (subagent B.7)
- **P63** Legacy WebGL examples still in tree (`ShaderMaterial`, `WebGLRenderTarget`) — **infected** teaching surface (subagent B.3)
- **P64** No surface tension in dispersion for high-k cascades — **Derived** physics gap (GROK §2.1)

**POSITIVE**
- Dispersion `omega(k)=sqrt(g|k|tanh(...))` at `compute-kernels.js:116-125` — **Derived** correct
- Frequency-space derivatives before IFFT at `:262-268` — Layer 2 supremacy met
- Evolution kernel conjugate symmetry at `:258` — **P34 retracted**

**REVERIFY_AT_HEAD:** Hermitian evolve confirmed; h₀ init still independent mirrored draw.

---

### 2.3 `threejs-procedural-creatures` (ghost skill)

**CRITICAL — P0**
- **P43** No `SKILL.md` — only `plan.md` + `agents/openai.yaml` — **Derived** (`ls` at HEAD)
- **P65** Router table row at `threejs-choose-skills/SKILL.md:192` routes living actors here — **infected** routing
- **P66** Numeric gates §10 in `creature-body-systems.md:304` — **Orphaned** (no lab, no `validate` command)
- **P67** 15–19 Layer-4 gates from plan unenforceable without examples — **Orphaned**

**HIGH**
- **P68** `references/creature-body-systems.md:224` still says "masked 24-part unroll" — contamination fingerprint risk (GROK §11 generalized elsewhere; echo remains in audit read) — **infected** constant
- **P69** `castShadowPositionNode` parity documented nowhere in skill body (no SKILL.md) — **Orphaned**
- **P70** Candidate-set vs smin commutativity — prose correct; zero GPU shell snap — **Gated**

**POSITIVE (plan.md only)**
- SDF/smin order caveat, planted gait physics in `creature-body-systems.md` — strong Layer 1 prose
- r185 shadow hooks exist in `NodeMaterial.js` — **Derived** API truth

**INFECTED_REFERENCES:** Entire pack is a routing stub until SKILL.md ships.

---

### 2.4 `threejs-ambient-contact-shading`

**CRITICAL**
- **P71** No `examples/webgpu-node-gtao/` at skill root — **Orphaned** canonical path (subagent A.10, B.5)
- **P72** Reference snippet `gtao-bent-normal-pipeline.md:91-99` may still demonstrate `sceneColor.rgb.mul(visibility)` — final-color multiply trap — **Derived** (subagent B.1)

**HIGH**
- **P73** 2× scene pass risk when composed incorrectly vs image-pipeline 1× doctrine — **Gated** composition
- **P74** Name split: `screen-space-ambient-occlusion` in `~/.claude` — **P44** cross-ref

**POSITIVE**
- Layer 1 indirect-only AO doctrine at `SKILL.md:8,98`
- `GTAONode` API verified in `node_modules` — **Derived**

---

### 2.5 `threejs-bloom`

**CRITICAL**
- **P75** No image-pipeline composition proof — bloom example owns full `RenderPipeline` — **Orphaned** (subagent C.6)

**HIGH**
- **P76** HDR emissive tier drift vs particles (documented 80 vs 32 in prior wave) — cross-skill **Orphaned** hierarchy
- **P77** Reduced tier still calls `setMRT` when `isWebGPUBackend` false — `index.js:257-263` vs `:387-392` — **Derived** (subagent B.4)
- **P54** BloomNode ~12 fullscreen draws not in pipeline budget table — **Derived**

**POSITIVE**
- MRT selective bloom architecture in `hdr-bloom-system.md:22-42`
- `node --check` passes on `examples/node-selective-bloom/index.js` — **Derived**

---

### 2.6 `threejs-scalable-real-time-shadows`

**CRITICAL**
- **P41** `renderShadow()` zero GPU — `clipmap-shadow-node.js:76-81` — **Derived**
- **P42** `castShadowPositionNode` — string in `debug-views.js:67` only; no material wiring — **Orphaned**
- **P78** `validate.js:172-189` substring theater — **Orphaned** validator

**HIGH**
- **P79** Deforming casters force 7-level invalidation — no deformation dirty bits — **Derived** scheduler
- **P80** Planets 300–900 patches × shadow passes — **Derived** combinatorics (GROK §12)
- **P81** No `examples/` in skill folder per early audit; example exists at `examples/webgpu-cached-clipmap-shadow/` but GPU path stub — **Orphaned**

**POSITIVE**
- Clipmap texel snapping / committed-center doctrine in `cached-clipmap-shadows.md` — Layer 2 correct
- `light.shadow.shadowNode` API verified — **Derived**

**COMPOSITION_EDGES:** Blocks creatures, ocean, planets, vegetation until GPU depth + displaced casters ship.

---

### 2.7 `threejs-volumetric-clouds`

**CRITICAL**
- **P49** Legacy `cloud-system.js:83` `PRIMARY_STEPS=320`, `LIGHT_STEPS=5` — **Derived** ~70× budget
- **P82** Canonical WebGPU example missing — legacy WebGL is only runnable — **Orphaned** (subagent B.7-8)
- **P83** Same-UV temporal `texture(uHistory, vUv)` — velocity/depth rejection absent — **Orphaned** (GROK §13)

**HIGH**
- **P84** Local tone/gamma in cloud path — violates image-pipeline HDR ownership — **Derived**
- **P85** `shape.bin` identified as opaque/wrong format in audit — asset contract broken — **Derived**
- **P86** Memory table wrong vs actual march cost — **Orphaned** budget

**POSITIVE**
- Layer 1 Beer/HG/powder prose in `weather-volume-and-reconstruction.md:387+`
- WebGPU API names verified against r185 — **Derived**

---

### 2.8 `threejs-sky-atmosphere-and-haze`

**CRITICAL**
- **P87** WebGPU scaffold only — LUT integration kernels not in reachable graph — **Orphaned** (GROK §13)
- **P88** Double `renderOutput` + `outputColorTransform` risk in composed stacks — **Gated**
- **P89** `toneMap` consumer error in integration manifest (prior wave) — **Orphaned** wiring

**HIGH**
- **P90** Precomputed LUT assets with SHA manifest — **POSITIVE** asset discipline
- Depth/sky classification trap depends on image-pipeline — **composition edge**

**POSITIVE**
- LUT-factored scattering class correct in `atmosphere-system-contract.md` — Layer 2

---

### 2.9 `threejs-exposure-color-grading`

**CRITICAL**
- **P55** Real GPU compute meter in prose but no `examples/` folder — **Orphaned** (subagent A.12, B.7)
- **P91** Meter domain split: pre-bloom vs post-bloom in composed apps — **Gated** ordering

**HIGH**
- **P92** `mrt({ output, emissive, depth, normal })` wording wrong — depth via `getTextureNode('depth')` — **Derived** (subagent B.4)
- **P93** `lut3D(postToneMapLinear)` arity mismatch vs `Lut3DNode` vec4 — **Derived** (subagent B.5)

**POSITIVE**
- Weighted log-average + asymmetric adaptation physics at `scene-referred-color-pipeline.md:100-122`
- `computeAsync`, `lut3D` exports verified — **Derived**

---

### 2.10 `threejs-procedural-planets`

**CRITICAL**
- **P94** Legacy `ShaderMaterial` example — no `webgpu-quadtree-planet/` — **Orphaned** (subagent B.1)
- **P95** CPU-vs-CPU parity labeled TSL — **Orphaned** (GROK + subagent B.10)
- **P96** `positionNode` displacement with no `castShadowPositionNode` bridge — **Orphaned** (shadow dependency)

**HIGH**
- **P97** `biomeId` vs `biomeWeights` schema split — **Derived** inconsistency (subagent B.8)
- **P98** 300–900 active patches without per-level caster culling — **Derived** shadow cost

**POSITIVE**
- Cube-sphere quadtree LOD doctrine — Layer 2 correct
- Crater/biome cause-field framing — Layer 1 strong

---

### 2.11 `threejs-procedural-fields`

**CRITICAL**
- **P51** No `examples/webgpu-field-bake/` — parity harness prose-only — **Orphaned** (subagent B.4-8)
- **P99** Bake path writes one constant texel (prior wave) — **Orphaned** GPU bake

**HIGH**
- **P100** `assets/generated-variants/` PNGs without `manifest.json` channel contract — **Orphaned**
- **P101** CPU/TSL parity claimed at `field-stack-recipes.md:302` — no executable gate — **Orphaned**

**POSITIVE**
- Tangential warp + frequency separation doctrine — Layer 1
- WebGPU/TSL-first quarantine line — Layer 5 clean

---

### 2.12 `threejs-water-optics`

**CRITICAL**
- **P102** No `getWaterHeight()` export for swimmer/creature coupling — **Orphaned** interface (prior wave)
- **P103** Dual simulation clocks (CPU drop vs GPU propagate) — **Derived** fracture risk

**HIGH**
- **P104** `smoothstep` used but not imported — `webgpu-bounded-water.js:198+` — **Derived** static defect
- **P105** Depth refraction uses raw depth × 80 heuristic — not `viewportLinearDepth` — **Derived** (subagent B.3)
- **P106** Material created before pipeline — `sceneColorNode`/`sceneDepthNode` not wired — **Orphaned** (subagent B.5)
- **P107** Fallback branch exposes uncomputed `StorageTexture` — **Orphaned** (subagent B.6)

**POSITIVE**
- Bounded pool + Beer/Fresnel doctrine — Layer 1
- WebGPU example scaffold with disposal paths — partial Layer 4

---

### 2.13 `threejs-procedural-geometry`

**CRITICAL**
- **P108** Box-proxy budget gate passes single-rail strip not 4-rail hero — **Orphaned** validation (prior wave)
- **P109** No vegetation bridge (`setWind`, shared wind field) — **Orphaned** composition

**HIGH**
- **P110** Semantic mesh writer contracts strong; GPU examples partial — subagent gap list in artifact

**POSITIVE**
- Rail/frame profile doctrine — Layer 2 for authored kits

---

### 2.14 `threejs-procedural-vegetation`

**CRITICAL**
- **P111** Draw count: examples report 162 visible draw objects vs SKILL 8–24 ceiling doctrine — **Derived** (`dense-grass-system.js:963` validation ceiling logic vs actual scene)
- **P112** `setWind()` in `dense-grass-system.js:853` — broken/unshared with fields envelope — **Orphaned**

**HIGH**
- **P113** `frustumCulled = false` in `gpu-grass-system.js:993`, `stylized-meadow-grass` — **Derived** perf leak
- **P114** No shared wind field from `threejs-procedural-fields` — **composition edge**

**POSITIVE**
- Patch LOD + impostor doctrine in `SKILL.md:22,60`
- `webgpu-dense-grass` has culling checkpoint prose — Layer 4 partial

---

### 2.15 `threejs-procedural-materials`

**CRITICAL**
- **P115** No planet radial material mode — **Orphaned** sibling bridge
- **P116** `castShadowPositionNode` docs only — no example — **Orphaned** (shadow P42 dependency)

**HIGH**
- Atlas/specular AA doctrine present; WebGPU examples partial per subagent artifact

**POSITIVE**
- Derivative normals + PBR identity framing — Layer 1

---

### 2.16 `threejs-procedural-motion-systems`

**CRITICAL**
- **P117** GPU compute path placebo — CPU timeline owns motion — **Orphaned** (prior wave)
- **P118** `sceneScaleMeters` orphan uniform — **Orphaned**
- **P119** Presentation alpha not implemented — **Orphaned**

**HIGH**
- Fixed-step/spring/quaternion doctrine — Layer 1 strong in prose

---

### 2.17 `threejs-procedural-buildings-and-cities`

**CRITICAL**
- **P120** Box-proxy compiler — not production mesh grammar — **Orphaned** proof
- **P121** `BatchedMesh` string-only — no WebGPU batch path — **Orphaned**
- **P122** No WebGPU shadows integration — **P41** dependent

**HIGH**
- Massing/façade doctrine — Layer 1 prose strong

---

### 2.18 `threejs-particles-trails-and-effects`

**CRITICAL**
- **P123** CPU pool stub — not GPU instanced analytic sparks — **Orphaned**
- **P76** HDR 80 vs bloom 32 tier drift — **Orphaned** hierarchy
- **P124** Not in integration manifest — **Orphaned** composition
- **P125** `validate-effects.mjs:129` `includes()` theater — **Orphaned**

**HIGH**
- Ship-conforming plasma doctrine — Layer 1 prose

---

### 2.19 `threejs-black-holes-and-space-effects`

**CRITICAL**
- **P126** Demo bypasses shared `RenderPipeline` — local graph — **Orphaned** composition
- **P127** Temporal history GPU stub — **Orphaned** (subagent B.6)
- **P128** `resolutionScale` stored but no `PassNode.setResolutionScale` execution — **Orphaned** (subagent B.5)

**HIGH**
- **P129** Star textures taught as `NoColorSpace` — should be `SRGBColorSpace` — **Derived** (subagent B.1)

**POSITIVE**
- Rejects UV-swirl fake lensing — Layer 1
- `curved-ray-accretion.js` passes `node --check` — partial Layer 4

---

### 2.20 `threejs-camera-controls-and-rigs`

**CRITICAL**
- **P130** Floating origin stub — not wired — **Orphaned**
- **P131** Side camera pose wrong frame — **Derived** (prior wave)
- **P132** No MRT/velocity export for image-pipeline — **Orphaned** composition

**HIGH**
- Chase/orbit/quaternion doctrine — Layer 1 prose strong

---

### 2.21 `threejs-rain-snow-and-wet-surfaces`

**CRITICAL**
- **P133** WebGPU token scaffold — legacy WebGL only runnable — **Orphaned** (subagent + GROK)
- **P134** Weather envelope owner but no shared inject API in WebGPU example — **Orphaned**

**HIGH**
- Coupled envelope doctrine — Layer 1 correct
- GPL asset provenance flagged in GROK §0.2 — **infected** provenance risk

---

### 2.22 `threejs-dynamic-surface-effects`

**CRITICAL**
- **P135** WebGPU frost stub — 3-way deposit ODE fork — **Orphaned**
- **P136** No TRAA/history bridge to image-pipeline — **Orphaned**

**HIGH**
- Touch-history ping-pong doctrine — Layer 2 correct in prose

---

### 2.23 `threejs-visual-validation`

**CRITICAL**
- **P52** 4-layer acceptance prose only — no runnable harness — **Orphaned** (subagent A.12)
- **P137** `renderer.outputBufferType` taught; r185 uses `getOutputBufferType()` — **Derived** API drift (`SKILL.md:68`)
- **P138** No creatures validation section — **Orphaned** (P43 gap)
- **P139** No budget gates executable — **Orphaned**

**HIGH**
- Stride/readback rules in AGENTS.md stronger than this skill embeds — **composition gap**

**POSITIVE**
- Falsifiability stance — "validate the mechanism" — Layer 1 correct

---

### 2.24 `threejs-compatibility-fallbacks`

**CRITICAL**
- **P140** No creatures ledger row — cannot catch crowd lies — **Orphaned** (subagent B.3)
- **P141** Validator cannot catch disconnected GPU graphs — **Orphaned**

**HIGH**
- Quarantine boundary doctrine — Layer 5 **POSITIVE**
- Missing 23-owner loss ledger — subagent B.3

---

### 2.25 `threejs-choose-skills`

**CRITICAL**
- **P43** Ghost creatures route — `SKILL.md:192` — **Derived**
- **P142** No composed budget mutex across skills — **Orphaned**
- **P143** Recipes disagree with integration manifest on `toneMap`/`outputTransform` ownership — **Orphaned** (prior wave)

**HIGH**
- **P44** No runtime alias check for ambient-contact name split — **Orphaned**
- Preflight prose strong but not assertable — subagent B.2-5

**POSITIVE**
- "Do not route beauty to post" — Layer 1
- WebGPU/TSL baseline + `PassNode.setResolutionScale` verified — Layer 3

---

## §3 Composition Edge Matrix

| Producer → Consumer | Required handoff | Status at HEAD |
|---|---|---|
| image-pipeline → ambient-contact | depth, normal, velocity | Example omits velocity — **Orphaned** |
| image-pipeline → bloom | emissive MRT | Example wires emissive — **Derived** OK locally |
| image-pipeline → exposure | HDR pre-tone scene color | No composed example — **Orphaned** |
| image-pipeline → ocean | single tone owner | Ocean `outputColorTransform=true` — **BROKEN** |
| shadows → planets/vegetation/creatures | `castShadowPositionNode` | **BROKEN** (P42) |
| fields → vegetation | shared wind | **BROKEN** (P114) |
| water-optics → creatures | `getWaterHeight` | **BROKEN** (P102) |
| rain-snow → clouds/volumetric | weather envelope | Legacy forks — **BROKEN** |
| visual-validation → all | harness + artifacts | **BROKEN** (P52) |
| choose-skills → creatures | SKILL.md | **BROKEN** (P43) |

---

## §4 Example Truth Table (canonical vs legacy vs stub)

| Skill | Canonical WebGPU path | Runnable at HEAD | GPU proof | Validator type |
|---|---|---|---|---|
| image-pipeline | `examples/webgpu-image-pipeline/` | Yes (`node --check`) | Partial — AO orphan | Config JS |
| spectral-ocean | `examples/webgpu-fft-ocean/` | Gated browser | FFT kernels real; validation CPU-only | CPU self-test |
| procedural-creatures | — | **No** | **None** | **None** |
| ambient-contact-shading | missing | No | None | None |
| bloom | `examples/node-selective-bloom/` | Yes | Gated | `node --check` |
| scalable-real-time-shadows | `examples/webgpu-cached-clipmap-shadow/` | Yes | **Stub** (0 GPU depth) | **Substring** |
| volumetric-clouds | missing | Legacy WebGL only | Legacy 320-step | Partial |
| sky-atmosphere-and-haze | scaffold | Gated | LUT stub | Partial |
| exposure-color-grading | missing | No | None | None |
| procedural-planets | legacy WebGL | Yes legacy | No WebGPU | Partial |
| procedural-fields | missing | No | None | None |
| water-optics | `examples/webgpu-bounded-water/` | Gated | Partial wiring bugs | Partial |
| procedural-geometry | partial | Gated | Partial | Box-proxy |
| procedural-vegetation | `examples/webgpu-dense-grass/` | Gated | Draw ceiling failures | JS validation |
| procedural-materials | partial | Gated | Partial | String |
| procedural-motion-systems | partial | Gated | CPU-owned | Partial |
| procedural-buildings-and-cities | box proxy | Gated | Stub | String |
| particles-trails-and-effects | CPU pool | Gated | Stub | **Substring** |
| black-holes-and-space-effects | `examples/tsl-curved-ray/` | Yes | Partial | `node --check` |
| camera-controls-and-rigs | partial | Gated | Stubs | Partial |
| rain-snow-and-wet-surfaces | legacy WebGL | Yes legacy | No WebGPU | Partial |
| dynamic-surface-effects | frost stub | Gated | Stub | Partial |
| visual-validation | missing | No | None | Prose only |
| compatibility-fallbacks | missing | No | None | None |
| choose-skills | missing | No | None | Prose only |

---

## §5 Contamination Postmortem

### Islands/clicker fingerprints (generalized vs residual)

| Fingerprint | Disposition at HEAD |
|---|---|
| 24-part / 504 / 720 eval constants | Generalized in GROK §11; **residual** "24-part unroll" at `creature-body-systems.md:224` (P68) |
| Per-creature 72 vec4 uniforms | Generalized in anti-pattern prose |
| Variable render-dt → gait | Retained as bad-practice description only — OK |
| Forbidden external project strings in skill bodies | **Clean** per GROK grep |
| `node_modules/three` duplicates inside examples | **Present** — disconnected subgraph risk (GROK §0.2) |

### Provenance audit prompt (for future waves)

1. Read SKILL.md + all references + all example JS — full file, not grep slices.
2. Map every claimed ms/MiB/dispatch count to Derived (formula), Gated (harness), or Orphaned (no wiring).
3. Trace reachable `RenderPipeline.outputNode` from `setDebugMode` or equivalent — if diagnostics do not mutate output, mark inert.
4. For FFT/ocean: verify h₀ init **and** evolve separately for Hermitian.
5. For shadows: require GPU depth render call in `renderShadow`, not CPU `commitLevelRender` only.
6. Treat `~/.claude/skills` vs workspace divergence as P0 routing defect.
7. Subagent output without file:line citations is discarded.

---

## §6 Actions — What to act on, in order

This is the execution list distilled from §1–§5. Each item names the owner skill, converging finding IDs, and whether the claim is already **struck**, **retracted at HEAD**, or **needs re-verify** after the last five commits (`4bca3bd` … `31e7f18`).

**Subagent re-audit:** Blocked on §0.1 until non-fast Composer slug exists **or** you explicitly accept `grok-composer-2.5-fast` as the only Composer available and re-run all 25 with pinned config + `MODEL_ATTESTATION`.

**Last five commits (may already close filed P0s — re-read before coding):**

| Commit | Touches | Re-verify before acting |
|---|---|---|
| `4bca3bd` | visual-validation stride/schema/timestamps | P52, P137 — harness may now be partial not absent |
| `cb95d9e` | procedural-materials derivative normals | P115 — planet radial mode still open |
| `a20dfa2` | exposure compute metering | P55, P91 — example may exist; meter ordering still Gated |
| `41a7e9a` | choose-skills manifest/schema | P142, P143 — creatures row may still ghost |
| `31e7f18` | ambient-contact material-context AO | P72 — reference multiply trap; image-pipeline wiring still P45 |

---

### Step −1 — Subagent model hygiene (before any re-audit or new findings)

0. **Unblock Composer 2.5 non-fast** — check `grok models` for `grok-composer-2.5` (no `-fast`). If absent: either wait for catalog update, run audits from **Cursor IDE** with full Composer if exposed there, or document explicit waiver that `grok-composer-2.5-fast` is the only Composer slug (§0.1).
1. **Invalidate grok-build subagent outputs** — three spawns in session `019f2f48-…` used `grok-build`; do not merge into `COMPOSER_25_PROBLEMS.md` without re-run on Composer.
2. **Re-launch 25 subagents** only with: extensive PhD prompts (existing `.agent/plans/prompts/audit-*.txt`), `capability_mode: read-only`, `MODEL_ATTESTATION` header, orchestrator verification of each `meta.json`.
3. **Do not substitute** Codex, Grok Build, or Grok 4 for skill-pack adversarial audits.

---

### Step 0 — Register hygiene (do first; stops false P0 churn)

**Strike from all active registers** (keep only as historical audit footnotes):

| Strike | Reason at HEAD | Keep instead |
|---|---|---|
| Both **Jacobian determinant "criticals"** (GROK §7.1, ocean numerics agent) | Symmetric Tessendorf/choppy displacement: `jxx·jzz − (λ∂Dz/∂x)²` is exact when mixed partials match; `compute-kernels.js:363-368` uses consistent cross term | Packing/readback verification only — **Gated** |
| **Hermitian broken by evolve kernel** (prior P34) | **RETRACTED** — `:258` preserves conj symmetry given Hermitian h₀ | — |
| **Hermitian "always broken"** blanket claims | Over-broad; evolve is fine | **P53** h₀ init only: independent `gaussianPair(mirrored)` at `:225-228` |
| **R4 "infected exemplar" cluster** on creatures anti-pattern numerics | Anti-pattern **pedagogy**, not provenance — unless literal 24/504/720 constants reappear in executable paths | Parameterized cost model in plan only |
| **0.78/0.22 lighting split** (prior P41) | **RETRACTED** — removed from `image-pipeline/main.js` | Indirect-only composite wiring (P45) remains |
| **Creatures `creature-body-systems.md` citations** in §2.3 | **Folder at HEAD is hollow** — only `plan.md` + `agents/openai.yaml`; references cited by subagents are **not on disk** | Act on `plan.md` Phase 1 or delist router row |

**Do not strike (confirmed at HEAD):** P41 GPU-less `renderShadow`, P42/P45/P46 orphans, P43 ghost router, P47 ocean `outputColorTransform=true`, P48 dispatch storm.

---

### Step 1 — Composition blockers (P0; nothing else composes until these move)

1. **Creatures ghost route** — either ship `SKILL.md` + `references/creature-body-systems.md` per `plan.md` Phase 1, or remove `$threejs-procedural-creatures` from `choose-skills/SKILL.md:192` until the pack exists. **Converges:** P43, P65, P66. **HEAD:** folder is 2 files only.

2. **Routing name split** — add alias table in `choose-skills` + fix `~/.claude/skills/threejs-image-pipeline` to `$threejs-ambient-contact-shading` (not `screen-space-ambient-occlusion`). **Converges:** P44, P74.

3. **Image-pipeline example: close the orphan graph** — at `main.js:70-85`:
   - Wire GTAO into an **indirect-only** composite (material-context or explicit indirect term — not `hdrColor.mul(ao)` on direct/emissive).
   - Make `setDebugMode()` assign `renderPipeline.outputNode` from `diagnostics.views[mode]` (or equivalent predeclared node) **and** `renderPipeline.needsUpdate = true`.
   - Re-run capture harness after fix; confirm `AO.r` diagnostic differs from `final`. **Converges:** P45, P46, P56. **Re-verify:** `31e7f18` fixed ambient-contact canonical path, not this composed example.

4. **Temporal signal ownership in the image-pipeline contract** — extend `SKILL.md` + `production-image-pipeline.md` + `pipelineConfig.js` / `validateImagePipelineConfig.js` with an explicit **velocity row**:
   - Convention: current→previous NDC (r185), Y flip policy, pixels vs UV delta.
   - Exported helper: `velocityToPreviousUV(depth, camera, jitter)` (name negotiable; must be single owner).
   - **Depth convention flag:** `reversedDepthBuffer` / `logarithmicDepthBuffer` / ortho — propagated to GTAO, TRAA, sky classification.
   - **History-validity signals:** camera cut, exposure jump, material ID change, resize, DPR change, weather discontinuity — each must declare who invalidates which history target.
   - Add velocity MRT to canonical example or document explicit injection contract. **Converges:** R1-P11/P37 → P58; R3-#4 composition edges; R4 defects 1–2 (velocity/temporal orphans). **Re-verify:** validator already has `missing-velocity-convention` fixture — extend, don't duplicate.

5. **Single tone-map / output-transform owner** — enforce across composed siblings:
   - Ocean: `ocean-nodes.js:217` → `outputColorTransform = false` when under image-pipeline.
   - Clouds/sky: no local `toneMap`/`pow(·,1/2.2)` in beauty paths.
   - Integration manifest asserts exactly one `toneMapOwner` + one `outputTransformOwner`. **Converges:** P47, P84, P88, P50, P143.

6. **Shadows: real GPU path or stop claiming production** — `clipmap-shadow-node.js:76-81` must issue actual depth renders; add one displaced-caster example with `castShadowPositionNode` tied to `positionNode` (planet/ocean/vegetation fixture). Replace `validate.js:172-189` substring gate with reachability checks. **Converges:** P41, P42, P78, P80 — blocks P96, P116, P122.

---

### Step 2 — Physics & algorithm truth (ship correct math before more examples)

7. **K-subset smin evaluation = approximation** — in creatures contract (when `references/creature-body-systems.md` returns): state bounded candidate-set evaluation as an **approximation** whose only bound is a periodic **full-field sweep** at gate time; add **reject/raise-K policy** when residual / containment fails. **Converges:** R1-P02/P26 → P70; plan.md Phase 1 items 2 + 6. **Do not** treat K-subset as exact without sweep evidence.

8. **Clouds detail-mix orientation** — **verify before filing** (R4's one genuine physics catch):
   - Reference: `weather-volume-and-reconstruction.md:301-309` — `mix(topModifier=detail⁶, bottomModifier=1−detail, remap(height,0.2,0.4))`.
   - Legacy WebGL: `cloud-system.js:326-330` — same argument order and height fraction remap → **aligned at HEAD**.
   - WebGPU scaffold: `cloud-nodes.js` exports `detailModifier` debug channel but **no TSL density kernel yet** — when implemented, copy reference order verbatim; add one fixed-probe unit test (low vs high `heightFraction` → modifier direction).
   - **Action if WebGPU diverges:** fix orientation; **action if aligned:** strike R4 detail-mix defect; keep height-dependent erosion requirement (doc `:628`).

9. **Capillary–gravity dispersion for small cascades** — add σ/ρ·k³ term (or documented cutoff) to `compute-kernels.js` dispersion + `spectral-cascade-ocean-system.md`; gate validates ω error at finest band top (~80% ω² error claim is **Derived** order-of-magnitude — re-measure after term). **Converges:** R3-#8 → P64.

10. **h₀ Hermitian init (not evolve)** — replace independent `gaussianPair(mirrored)` at `compute-kernels.js:225-228` with conj(primary) or stored mirrored partner; add CPU gate on imag spectrum energy after h₀ creation. **Converges:** P53 (evolve P34 stays retracted).

11. **Ocean cascade band mask → half-open** — `compute-kernels.js:196,217` uses `step(kLength, cutoffHigh)` (closed at top); switch to `kLength < cutoffHigh` semantics for handoff bands; validate adjacent cascades do not double-count bin at boundary. **Converges:** R4 demoted **P2**; subagent B.2 overlap check. **Priority:** after Steps 1–2 blockers.

12. **Batch FFT submissions** — reduce per-stage `await renderer.computeAsync` in `ocean-system.js:38-40`; batch stages per axis/field where dependency allows; log submission count in validation manifest. **Converges:** R3-#5 → P48. **Target:** document dispatches/frame in SKILL budget table.

---

### Step 3 — Validators & proof harness (replace theater)

13. **Visual-validation as enforcement layer** — `4bca3bd` added stride/schema/timestamp flow; next: runnable `examples/webgpu-validation-harness/` consumed by every skill with GPU claims. Mandate: padded-row stride, `needsUpdate` on diagnostic output switch, mosaic from real modes. **Converges:** P52, P139, AGENTS.md field notes.

14. **Replace all `source.includes()` validators** — shadows, particles, effects, clouds configs → graph/reachability or artifact JSON gates. **Converges:** P78, P125, P141.

15. **Fields/planets parity** — ship `webgpu-field-bake/` + `webgpu-quadtree-planet/` or downgrade "CPU/TSL parity" claims to "CPU reference only". **Converges:** P51, P94, P95, P99.

---

### Step 4 — Example-level HEAD re-verification (mandatory before any example P0 lands)

16. **Re-read every example cited as P0/P1 in §2 and §4 at current HEAD** — the last five commits explicitly target: visual-validation evidence, materials normals, exposure metering, choose-skills manifest, ambient-contact AO wiring. For each filed example defect, run:

    ```bash
    git log --oneline -5
    rg -n "<claimed pattern>" <example path>
    node --check <example>/main.js  # where applicable
    ```

    **Demote or close** findings already fixed; **escalate** if doctrine fixed but composed integration still broken (image-pipeline GTAO orphan is the template).

    | Example path | Filed IDs | Likely HEAD delta |
    |---|---|---|
    | `ambient-contact-shading/examples/…` | P71, P72 | `31e7f18` — re-verify material-context path |
    | `exposure-color-grading/…` | P55 | `a20dfa2` — metering may be real; composed order still open |
    | `visual-validation/…` | P52 | `4bca3bd` — partial harness; not yet consumer for all skills |
    | `image-pipeline/examples/webgpu-image-pipeline/` | P45, P46 | **Still open** at `4bca3bd` |
    | `scalable-real-time-shadows/examples/…` | P41, P42 | **Still open** |
    | `procedural-creatures/` | P43+ | **More hollow than audit** — refs gone |

---

### Step 5 — Composition integration scene (one proof closes P50-class orphans)

17. **Ship `examples/integration-shared-framegraph/`** (owner: image-pipeline) — one scene, one `RenderPipeline`, shared `mrt({ output, normal, emissive, velocity })`, weather envelope inject, AO + bloom + exposure + tone-map single owner, diagnostic mosaic. Manifest is the contract choose-skills recipes must match. **Converges:** P50, P75, P124, P126, P136, choose-skills excellent item 5.

---

### Step 6 — Secondary / P2 (after Steps 0–5)

18. **Bloom budget honesty** — document BloomNode ~12 fullscreen draws + internal RTs in image-pipeline budget table. **Converges:** P54, P59.

19. **HDR emissive hierarchy mutex** — reconcile particles (80) vs bloom (32) vs SKILL_QUALITY_BAR tiers; single table in choose-skills manifest. **Converges:** P76, P123.

20. **Water-optics composition** — wire `sceneColorNode`/`sceneDepthNode` after pipeline creation; export `getWaterHeight()` for swimmers; fix `smoothstep` import; replace depth×80 with `viewportLinearDepth`. **Converges:** P102–P107.

21. **Vegetation draw ceiling** — fix `dense-grass-system.js` validation vs 162 draw objects; share wind from fields envelope; justify or remove `frustumCulled = false`. **Converges:** P111–P114.

22. **Clouds WebGPU canonical** — retire `PRIMARY_STEPS=320` legacy as non-teaching; implement bounded march + velocity temporal in `webgpu-weather-volume-clouds/`. **Converges:** P49, P82, P83.

23. **Compatibility loss ledger** — 23-owner table including creatures row; forbidden-fake column for "validator passes, GPU stub". **Converges:** P140, P141.

24. **Duplicate `node_modules/three` in skill examples** — quarantine or symlink to repo root; stale engine copies are disconnected proof subgraphs (GROK §0.2).

25. **Camera floating origin + MRT export** — wire `camera-controls-and-rigs` stubs to image-pipeline velocity/depth conventions. **Converges:** P130, P132.

---

### Step 7 — EXCELLENT tier (blocked on harness + integration)

26. Closed-loop frame-time governors per skill (AO, ocean, shadows, clouds) driven by measured GPU ms, not static tiers.

27. A/B diagnostic imagery wired to visual-validation harness (double tone-map, AO-on-direct, velocity ghosting, candidate-set holes).

28. Seed sweeps + dispose/recreate leak loops in CI for every skill with "X ms / Y MiB" claims.

---

**Minimum viable sequence if time-boxed:** `0 → 1 → 4 → 6 → 13 → 16 → 17` (hygiene, compose blockers, temporal contract, shadows truth, harness, HEAD re-verify, integration proof).

---

## §7 Attestation

| Check | Result |
|---|---|
| Skill files modified | **No** |
| Sole deliverable | `COMPOSER_25_PROBLEMS.md` |
| Subagent artifacts read | 25/25 in `.agent/plans/` |
| HEAD claims re-verified | P34 retract, P41 split retract, P45/P46/P43 confirmed; §6 action list added |
| Finding IDs | P41–P143 (continuing prior P41+ scheme) |
| Action list | §6 Steps −1–7 (32 items); time-boxed minimum `0→1→4→6→13→16→17` |
| Subagent model policy | §0.1 — Composer 2.5 non-fast required; catalog has only `grok-composer-2.5-fast`; 3/73 prior spawns invalid (`grok-build`) |

---

*Read-only adversarial audit. Do not treat passing string validators as GPU truth. Poll sibling evidence: `GROK_BUILD_PROBLEMS_2_cli.md`, `.agent/plans/audit-threejs-*.md`, `SKILL_QUALITY_BAR.md`, `AGENTS.md`.*