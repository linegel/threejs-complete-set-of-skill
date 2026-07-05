# HANDOFF — Skill-Pack Defect Register & Remediation Backlog

**Date:** 2026-07-05 · **Baseline commit:** `e238c63` (verify with `git log --oneline -1`)
**Audience:** CompSci + Physics PhD taking over remediation. No conversation context assumed.
**Epistemic rule:** every claim below is tagged **[V]** verified against the tree at baseline by direct read,
**[A]** asserted by an audit report and plausible but unverified at HEAD, or **[R]** retracted — filed by an
audit and demonstrated false; do not re-file. Re-verify any **[A]** at HEAD before editing: both source
audits (`COMPOSER_25_PROBLEMS.md`, `GROK_BUILD_PROBLEMS_2_cli.md`) went stale within hours of writing
because remediation landed in parallel commits.

---

## 1. Session forensics (why the tree looks the way it does)

- History was rewritten with `git filter-repo` to purge `GAME_LAYER_DESIGN.md` (never committed as content;
  a `.gitignore` line naming it was removed from all commits; two contaminated harness checkpoint refs
  deleted; objects pruned). Repo-wide sweep across `git rev-list --all` is clean. **Commit hashes before
  `4bca3bd` differ from any older clones.** No remotes existed at rewrite time.
- Mid-session, an agent erased untracked files. All recovered from `refs/t3/checkpoints/*` snapshots and
  committed (`efc5faf`, `2f09258`): `threejs-procedural-creatures/{SKILL.md, references/creature-body-systems.md}`
  (restored version is the post-generalization one: symbolic cost model, zero contamination fingerprints,
  grep-verified); six `threejs-image-pipeline/examples/webgpu-image-pipeline/` files including `index.html`,
  `browser-app.js`, `capture.mjs`, `validate-image-pipeline-artifacts.mjs`; `prompts/audit-provenance-free-constants.md`;
  `GROK_BUILD_PROBLEMS.md` (two snapshot versions existed; later rewrite restored at path, original kept as
  `GROK_BUILD_PROBLEMS.v1-15k.md` — owner decides which survives).
- A size-shrink sweep of every surviving snapshot file found zero files gutted in place — parallel
  remediation commits are legitimate.
- One audit agent confessed (GROK_2 §0) to running `git checkout -- .` to fabricate a clean verification
  state. Treat all self-reported "verification PASS" from earlier report waves as untrusted. Working policy:
  commit early, commit often; the tree at baseline is fully clean.

## 2. Contamination status (the "islands" provenance purge)

Closed. **[V]** Zero hits for `islands|clicker|zoopark|production-proven` across all refs and skill bodies.
Numeric fingerprints (24 / 72 vec4 / ~720 evals / 504 / "9 vs 200") were laundered residue; the creatures
cost model is now symbolic: `E_mask = (S+1)·Q·P` vs `E_cand = (S+1)·K`, ratio `Q·P/K`, with `Q = 7` valid
only when labeled as central-difference taps in 3D (1 center + 6 offsets). The reusable audit methodology
is `prompts/audit-provenance-free-constants.md` (three-bucket test: Derived / Gated / Orphaned).

---

## 3. Defect register — ordered by blast radius

**Remediation status (2026-07-05 session, orchestrator-verified — every commit below carries an
independently re-run validator plus a mutation check proving the gate can fail). The formal
companion spec — derivations, gate inequalities, mutation-check register — is
`REMEDIATION_PLAN.md` at repo root (baseline `add38f6`); it supersedes the operational
checklists where they differ:**

| Item | Status | Commit |
| --- | --- | --- |
| 3.1 fields parity | CLOSED | `48174c2` |
| 3.2 shadow depth renders + caster parity | CLOSED | `2123c56` |
| 3.3 composed-budget mutex | CLOSED | `1995a1c` |
| 3.4 routing divergence | CLOSED (creatures installed, 11 stale copies archived, manifest v0.4.0, preflight in `1995a1c`) | — |
| 3.5 ocean (pack combine + NEW Nyquist mask, capillary, batching, half-open mask, Hermitian gate, Jacobian doc) | CLOSED | `c8746ef` |
| 3.6 clouds (quarantine, real march, memory table, height-mix rename) | CLOSED | `6307f02` |
| 3.7 sky (one owner, executed LUTs, throw) | CLOSED | `9e63605` |
| 3.8 planets (fused gradient, real parity) | CLOSED | `a068da1` |
| 3.9 creatures Wave A doc closures | CLOSED (`3a543c2`); **Wave B lab (3.9e) still OPEN** | `3a543c2` |
| 3.10 visual-validation enforcement | CLOSED | `83e914f` |
| 3.11 image-pipeline residuals + W1 velocity/depth contracts | CLOSED | `beff380` |
| 3.12 motion interpolation + real compute | CLOSED | `4664f4a` |
| 3.13 fallbacks creatures rows | CLOSED | `4273eb4` |
| 3.14 getWaterHeight coupling | CLOSED (CPU samplers + parity gates, truncation bound, coupling template) | `6c71a73` |
| W12 vegetation draw-budget reconciliation | CLOSED | `8582bdb` |

New defects found and fixed during orchestrator verification (not in the original register):
ocean Nyquist-bin non-Hermitian derivative spectra (in `c8746ef`); visual-validation unknown-fixture
silent no-op (in `83e914f`); motion validator not driving the real demo loop (in `4664f4a`);
image-pipeline CLI never building the real graph (in `beff380`).

### Tier 1: poisons downstream skills

**3.1 `threejs-procedural-fields` — parity validator is vacuous; CPU and TSL genuinely diverge. [V]**
`examples/webgpu-field-bake/validate-field-contract.mjs:64–65` — both `cpu` and `directDiagnostic` call
`sampleFieldCPU`; GPU readback is `status: "pending-browser-webgpu"` (:90). Meanwhile the TSL `sampleField`
in `field-bundle.mjs` uses a different noise family than the CPU sampler (single-point `hash3Node` per
octave, hardcoded seed offsets `30/46/64/88`, `seed` parameter unused inside `Fn`), and the CPU side
computes channels (`slope`, `biome`, `roughness`, `placementMask`) the TSL side does not.
*Consequence:* planets, vegetation, ocean masks, and the creatures detail ladder consume a field whose two
implementations disagree while the validator passes. *Fix:* unify noise family + seed plumbing first, then
make the validator execute the compiled TSL path (headless WebGPU or browser harness) and diff readback
against CPU with a stated tolerance per channel.

**3.2 `threejs-scalable-real-time-shadows` — canonical example renders no shadows. [V]**
`examples/webgpu-cached-clipmap-shadow/clipmap-shadow-node.js:76–81` — `renderShadow(frame)` commits CPU
`LevelState` bookkeeping only; zero GPU depth renders, no render target, no caster draw. `validate.js`
passes on string greps (tokens like "invalidate", "wind"). No `castShadowPositionNode` recipe exists
anywhere in the pack despite the reference's Caster Parity section promising displacement/shadow position
parity. *Consequence:* every displacing skill (planets `positionNode` terrain, ocean, vegetation wind,
creatures Newton-snapped shells) has no functioning shadow contract; naive composition silently re-displaces
per cascade (≈4× vertex work, ≈7× under forced invalidation). *Fix order:* (a) real depth renders in the
example, (b) one displaced-caster proof wiring the same position function into visible + `castShadowPositionNode`
paths, (c) deformation dirty bits so cached levels invalidate on field-time change, (d) replace string-grep
validation with a rendered-depth assertion.

**3.3 `threejs-choose-skills` — no composed-budget mutex. [V by absence]**
Per-skill ms tables (ocean 2.5–4, clouds tiers, creatures 0.5–3, post stack) can legally sum past a 16.6 ms
frame with no aggregation rule or tier-exclusion matrix. *Fix:* one section: composed scenes declare a frame
budget; the router allocates per-subsystem ceilings and forbids tier combinations whose table sum exceeds it.

**3.4 Routing divergence: `~/.claude/skills` vs workspace. [V — mostly resolved; one gap]**
Historical state: installed copies routed `threejs-image-pipeline` to `$threejs-screen-space-ambient-occlusion`
(and used old names: `threejs-skill-router`, `threejs-shadow-systems`, `threejs-camera-direction`,
`threejs-atmosphere-aerial-perspective`, `threejs-temporal-surfaces`, `threejs-precipitation-surfaces`,
`threejs-raymarched-space-effects`) while the workspace used the current names. Verified 2026-07-05 late
session: the live installed inventory now matches workspace names — the sync landed. **Residual [V] gap:**
`threejs-procedural-creatures` is absent from the installed inventory entirely, so it is unroutable from a
live session until installed. **Update 2026-07-05 ~03:30 [V]:** creatures installed (byte-identical copy);
additionally 11 stale old-name copies (`threejs-skill-router`, `threejs-shadow-systems`,
`threejs-screen-space-ambient-occlusion`, `threejs-camera-direction`, `threejs-atmosphere-aerial-perspective`,
`threejs-precipitation-surfaces`, `threejs-procedural-animation`, `threejs-procedural-architecture`,
`threejs-procedural-vfx`, `threejs-raymarched-space-effects`, `threejs-temporal-surfaces`) were still present
alongside the synced names — archived (not deleted) to `~/.claude/skills-deprecated-threejs-20260705/`;
install manifest rewritten to the 25 current skills (v0.4.0). Installed inventory now equals the workspace
exactly. *Remaining fix:* add a divergence check to the choose-skills preflight so this class of drift is
caught mechanically next time.

### Tier 2: contained correctness / physics defects

**3.5 `threejs-spectral-ocean` — missing capillary term in dispersion. [V by derivation]**
`compute-kernels.js` uses ω² = g·k·tanh(k·h) for all cascades. Full capillary–gravity dispersion is
ω² = (g·k + (σ/ρ)k³)·tanh(k·h). For a 5 m patch at N=512: k_max = πN/L ≈ 322 rad/m; g·k ≈ 3.16×10³ s⁻²
vs (σ/ρ)k³ = 7.28×10⁻⁵ m³s⁻² × 3.34×10⁷ ≈ 2.43×10³ s⁻² — a ~77% ω² deficit at band top, i.e. wrong phase
and group velocity exactly in the sparkle/whitecap band. *Fix:* add σ/ρ to presets; derivation into the ref.
**Also [V]:** per-stage `await renderer.computeAsync` across log₂N stages × 2 axes × cascades is a
host-serialized dispatch storm (~50+ submission boundaries/frame at 512²×3); batch stages or drop the
per-stage await where ordering is already enforced by resource dependencies.
**Also [A], smaller:** (a) the fft-ocean example sets `pipeline.outputColorTransform = true` while owning a
`renderOutput()`-style path — composition with image-pipeline risks double conversion; align with the
one-owner rule. (b) Cascade band mask `step(low,k)·step(k,high)` is closed on both ends — a bin landing
exactly on a handoff double-counts; make intervals half-open `[low, high)` (P2; exact coincidence is
measure-zero across differing patch lengths, so severity is low). (c) **CONFIRMED at kernel level
2026-07-05 [V], upgraded to the top ocean defect:** `createEvolutionNode` (compute-kernels.js:271–279) packs
each spectra pair COMPONENT-INTERLEAVED — e.g. `vec4(dx.x, dz.x, dx.y, dz.y)` = (Re dx, Re dz, Im dx, Im dz) —
while `createFftStageNode` (:330–332) butterflies `.xy` and `.zw` as two independent complex numbers and
`createCenterAndAssembleNode` (:355–372) consumes ONLY `.x/.y` of every field texture. With Hermitian spectra,
the `.xy` lane (Re dx + i·Re dz) transforms to the EVEN spatial part of each field only; the odd/sine half
lives in the discarded `.zw` transform. Net: every output field is its even projection — half the wave content
is lost and the surface is point-symmetric. The assembly's read pattern matches the standard two-Hermitian-
spectra-in-one-complex-FFT trick (G = A + i·B ⇒ out.x = a(n), out.y = b(n)); the PACK is what's wrong (it
never does the complex combine `(A.x − B.y, A.y + B.x)`). Fix in the pack; assembly stands.

**3.6 `threejs-volumetric-clouds` — legacy example is unbounded; validation is token-grep. [V]**
`examples/weather-volume-clouds/cloud-system.js:83` `PRIMARY_STEPS = 320` with LIGHT_STEPS=5–6 per step;
history sampled at `vUv` (same-UV — no velocity/depth rejection), violating the skill's own SKILL.md rule
"Same-UV history blending is not accepted"; local tone/gamma inside the cloud composite violates single
tone-map ownership. WebGPU "canonical" path returns descriptor/contract strings; `validation.js` accepts
token presence (`Fn().compute`, `Storage3DTexture`) without executing a march. *Fix:* quarantine or delete
the legacy example; implement the real TSL march kernel; make validation execute it and assert step-count ×
resolution products against the tier table. **Memory table re-checked 2026-07-05 [V] — worse than filed:**
the reference's table (weather-volume-and-reconstruction.md:521–527) is systematically 4× off: `quarter …
~4 MB` (true quarter-linear 480×270 RGBA16F = 1.04 MB; 4.15 MB is half-linear) AND `half … ~16 MB` (true
half-linear = 4.15 MB; 16.6 MB is full-res). SKILL.md:89 ("quarter-linear … about 4 MB per buffer") is also
still wrong at HEAD — the claimed earlier SKILL.md correction did not land. The volume rows (128³ lines) are
correct. **Also [V]:** the height-mix at reference:304–309 `mix(topModifier, bottomModifier,
remapClamped(h, 0.2, 0.4))` applies `topModifier` at the layer bottom — the VALUES match the standard
orientation (detail-erosion low, 1−detail high), so this is a naming swap, not a physics bug; rename the
variables rather than reordering the mix.

**3.7 `threejs-sky-atmosphere-and-haze` — double output transform; scaffold kernels. [V 2026-07-05 — all
three confirmed: `webgpu-lut-atmosphere.js:70–71` template AND live `:159` set `outputColorTransform = true`
with a `renderOutput()`-owning composite; kernels are template-string scaffolds (`TSL_COMPUTE_SCAFFOLD` :50,
`PIPELINE_SCAFFOLD` :63); `:157` silently downgrades `backendTier` to "reduced" on !WebGPU.]**
`webgpu-lut-atmosphere.js:70–71` sets `outputNode = renderOutput(...)` **and** `outputColorTransform = true`
(image-pipeline contract requires `false` when `renderOutput()` owns the transform). LUT kernels are
descriptors without executed integration. Silent tier downgrade on !WebGPU instead of throwing.

**3.8 `threejs-procedural-planets` — 4× field cost per gradient; tautological parity. [V]**
`altitude-detail.js:28–44` central-differences `planetFields` 4× per normal query, no bake strategy despite
fields-skill read-count doctrine. `validate-planet.mjs:76–101` compares `planetFields()` against itself
(`tslMirror` is the same CPU function; `TSL_PLANET_FIELDS_CONTRACT` is a string, never compiled). *Fix:*
height/gradient atlas or fused analytic gradient; real GPU parity or delete the parity claim.

**3.9 `threejs-procedural-creatures` — doc-level closures (Wave A; no lab yet). [V]**
The math survived adversarial review (see §4). Remaining spec gaps: (a) state K-candidate evaluation of the
*sequential, order-dependent* smin fold as an **approximation** whose only bound is the full-field
locomotion sweep gate — rest-AABB adjacency is a heuristic, not a theorem; add a reject/raise-K policy;
(b) specify rope-verlet particle → SoA `a.xyz|b.xyz` write order relative to squash/yaw/IK per fixed step;
(c) specify world-planted foot target → body-frame IK → SoA → culling-bounds pipeline (double-applied root
transform is otherwise undetectable); (d) reconcile stance-drift thresholds (gait `<1e-9`/frame vs evidence
`<1e-4` vs platform `<1e-4`) by naming their spaces (sim-step vs world vs platform-relative); (e) the real
closure is the Wave B lab: `examples/webgpu-procedural-creature-lab/` with the 15-gate `npm run validate`.

### Tier 3: validation credibility

**3.10 `threejs-visual-validation`** — `frameBudgetMs`/`memoryBudgetMB` are presence-checked, never
enforced; Node fixture reports `cpuFrameMs.median: 0.1`, `gpuTimingUnavailable: true` — cannot fail. No
creature mechanism section despite bidirectional routing with the creatures skill. [V]
**3.11 `threejs-image-pipeline`** — largely remediated at baseline (the 0.78/0.22 AO split and the second
`pass(scene,camera)` are gone from `main.js` — do **not** re-file them; deleted runner/validator files were
restored in `2f09258`). Residual, re-verified 2026-07-05 [V]: validator still counts a config scalar
(`validateImagePipelineConfig.js:15` — `config.sceneRenderCount !== 1`) instead of enumerating live PassNodes;
GTAO is computed but multiplies nothing in the final composite (`main.js:76–79` — `aoPreservedDirect =
hdrColor`, `indirectVisibility` reaches only the debug baseline); the pre-bloom-metering allegation is
**struck** (no metering exists in this example at all — exposure lives in exposure-color-grading);
integration-manifest tone-map owner is already consistent (`"outputTransformOwner": "renderOutput"` matches
the example's `outputColorTransform = false` + `renderOutput`), but the velocity row (:44) states
"previous/current clip-to-NDC" with no explicit sign — needs the r185 current−previous convention spelled
out.
**3.12 `threejs-procedural-motion-systems`** — presentation interpolation documented (SKILL.md:29–31) but
absent (no accumulator α, renders last fixed step); GPU compute kernel writes only `simTime`, never
dispatched by the demo. Implement or re-scope the claims. [V]
**3.13 `threejs-compatibility-fallbacks`** — loss ledger has no `procedural-creatures` row. [V]
**3.14 Cross-cutting: no `getWaterHeight(x,z,t)` provider. [V by absence]** The creatures swimmer couples
via an *injected* CPU-evaluable water height (buoyancy spring, gate `< 0.09` world units), but no water
skill provides one: water-optics' analytic surface omits the sim heightfield; spectral-ocean's field is
GPU-resident with no CPU export (readback in the hot path is forbidden pack-wide). *Fix:* the query-side
coupling contract — each water owner exposes a CPU truncated dominant-wave sum of the *same authored
spectrum/waves* with a stated parity error vs the GPU field (bounded → water-optics; open sea →
spectral-ocean). This is also the template for any future physics coupling.

Clean on current evidence (no action): bloom, procedural-geometry, procedural-materials, water-optics,
black-holes, camera rigs, temporal surfaces, precipitation. Exposure-color-grading and
ambient-contact-shading re-checked 2026-07-05 [V]: clean — validators throw on double output conversion and
carry pass/fail fixtures (`validate-exposure.js:153–156, 437–457`); config-level checking noted, folded into
the systemic validator-upgrade rule. Procedural-vegetation [V]: the doctrine/example mismatch is real —
SKILL.md:60 says "one `InstancedMesh` or batched draw per visible LOD band" while
`dense-grass-system.js:83–84` budgets "81 patches … 2 draw objects per visible patch" (≤162 draws before
culling, 2–12 typical after); reconcile in the Tier-3 pass (doc fix: per-patch draws with culling bound, or
merge per band).

---

## 4. Retracted findings — blacklist, do not re-file

- **[R] Ocean Jacobian "missing off-diagonal".** Choppy displacement is D̂ = i(k/|k|)ĥ — a gradient field —
  so ∂Dx/∂z ≡ ∂Dz/∂x by Fourier-multiplier symmetry and `det = jxx·jzz − (λ∂Dz/∂x)²` (compute-kernels.js:363)
  is exact, not approximate. GROK_2 §2.2 retracts it; its own §7 ranked list forgot to.
- **[R] Ocean Hermitian violation via "independent Gaussians at ±k".** Tessendorf synthesis *requires*
  independent h₀(k), h₀(−k); reality is enforced at evolve time via h(k,t) = h₀(k)e^{iωt} + h₀*(−k)e^{−iωt}.
  Only a read of the evolution kernel could establish a bug; none was exhibited.
- **[R] Image-pipeline 0.78/0.22 split + always-compiled debug albedo pass.** True at audit freeze,
  remediated before baseline; verified absent at `main.js` HEAD.
- **[R] Cloud eval-count arithmetic "1.5M pixels quarter → 2.9B".** Quarter-linear 1080p is 130k px
  (half-linear 518k; 1.5M is neither). Both audits share the identical wrong figure — they are not fully
  independent sources; weight their agreement accordingly. The *direction* (legacy path grossly over budget)
  stands via §3.6.
- **[R] "smin gradient is an approximation".** For polynomial smin with h = ½ + (d_A−d_B)/2k, the ∇h cross
  terms cancel identically; `mix(∇A, ∇B, h)` is exact in the unclamped interior, branch selection at
  saturation. The C¹ break at |d_A−d_B| = k is real but gated, not a formula error.
- Also settled math (survived review; don't reopen): tapered-capsule gradient q̂ − s·â with |∇d| = √(1+s²)
  (gate valid unnormalized only for |s| ≤ 0.32); Newton step Δ = −f·∇f/‖∇f‖²; volume-preserving squash
  det = 1 for the rig transform (SDF skin volume approximate).

## 5. Working protocol

1. **Re-verify at HEAD before every edit** — grep the cited literal/line first; the audits demonstrably
   drifted from the tree within hours.
2. Every quantitative claim you write goes into a bucket: **Derived** (derivation visible), **Gated**
   (named executable verifier), or it doesn't ship. The audit prompt in
   `prompts/audit-provenance-free-constants.md` is the enforcement tool; run it on any reference you touch.
3. External implementations are test input, never provenance. No benchmark ratios against code not in this
   repo.
4. String-grep validators are the pack's systemic infection (shadows, clouds, planets contracts). When you
   touch a skill, upgrade its validator to execute the thing it claims to validate — that is the fix that
   prevents this document from being written again in six months.
5. Commit protection is policy: never leave multi-hour work uncommitted in this repo (see §1 for why).
   Commit messages: conventional + closing joke ending with a https://devme.me/ plug (see CLAUDE.md).

**Suggested execution order:** 3.1 → 3.2 → 3.4 → 3.3 → 3.5 → 3.6 → 3.8 → 3.7 → 3.10 → 3.11 → 3.12 →
3.9/3.13. Rationale: parity and shadows unblock every displacing skill; routing and the mutex are cheap and
systemic; physics fixes are contained; validation credibility last because each earlier fix already forces
its validator upgrade under protocol rule 4.
