# HandOff--1 — Three.js Skill Pack: Audit Synthesis & Corrective Work Order

**Date:** 2026-07-05 · **Audience:** Comp Sci + Physics PhD taking over corrective work.
**Repo:** `/Users/linegel/_reps/threejs` (26 skills under `threejs-*/`).
**Prime directives in force:** (a) any reference to code/measurements/"proven" results outside the
skill trees is contamination — the known external source (islands-clicker) is a condemned,
near-zero-FPS project and carries zero authority; de-attributed residue of it (its constants,
its benchmarks) is equally contaminated; (b) every quantitative claim must be **Derived**
(re-derivable from the doc's own parameters), **Gated** (enforced by a named executable
validator), or it is **Orphaned** and must be fixed; (c) target reader of all skill text is a
CS/Physics PhD who will re-derive every number.

---

## 1. State at handoff

1. **Contamination: purged and verified.** Repo-wide grep for
   `islands|clicker|zoopark|proven implementation|production-proven` → 0 hits in skill bodies.
   The purge went through three stages: (i) removal of literal provenance
   (`@islands/characters`, absolute path, "production-proven" claims); (ii) removal of
   *numeric fingerprints* — `maxParts=24`-derived constants (`72 vec4 = 24×3`,
   `~720 evals/vertex ≈ (S+1)·7·24`, `504 = 3·7·24`, "9 vs 200 creatures" benchmark);
   (iii) replacement with closed-form cost models in the skill's own parameters
   (`E_mask = (S+1)·7·maxParts`, `E_cand = (S+1)·K`, ratio `7·P/K`) plus deletion of the
   entire diff-shaped anti-pattern ledger. Lesson encoded: stripping a name while keeping the
   constants is laundering; an anti-pattern table enumerating one dead project's mistakes
   row-by-row is that project's ghost.
2. **Skill routing snapshot re-synced.** The installed `~/.claude/skills` inventory previously
   diverged from the workspace (old names: `threejs-skill-router`,
   `threejs-screen-space-ambient-occlusion`, `threejs-shadow-systems`, …). It now matches the
   workspace names, **except `threejs-procedural-creatures` is absent from the installed
   inventory** — the skill is unroutable from a live session until installed.
3. **Math corrections already applied to `threejs-procedural-creatures`** (in
   `references/creature-body-systems.md`, verified present at handoff):
   - Tapered-capsule analytic gradient now includes the taper's axial term:
     `∇d = q̂ − s·â`, `s = (rb−ra)/|b−a|`, `â = normalize(b−a)`; interior `q ⊥ â` so
     `|∇d| = √(1+s²)`. The radial-only form was wrong by `atan(s)` on every cone and would
     have failed the doc's own `|analytic − centralDiff| < 5e-2` gate for `|s| > ~0.05`.
   - Polynomial-smin gradient `mix(∇d_A, ∇d_B, h)` documented as **exact** in the unclamped
     interior: with `h = ½ + (d_A−d_B)/2k`, the cross terms `(d_B−d_A)∇h − k(1−2h)∇h` cancel
     identically; at saturation the mix degenerates to the surviving branch.
   - Gradient-magnitude gate `0.95–1.05` annotated: raw un-normalized magnitude is `√(1+s²)`;
     the raw gate only holds for `|s| ≤ 0.32` — normalize per-primitive or bound the taper.
   - Newton snap uses the true first-order step `Δp = −(d−iso)·∇d/|∇d|²` (the `/|∇d|` variant
     assumes `|∇d| = 1` and undershoots in blend regions where `|∇s| < 1`).
   - Lerp-radius tapered capsule labeled with its exactness bound (true distance only for
     `ra = rb`; interior compression `√(1+s²)`, 4.4% at `|s| = 0.3`).
4. **One numeric fix applied to `threejs-volumetric-clouds/SKILL.md`:** RGBA16F @1920×1080 is
   ~4.1 MB at half-linear (960×540) and ~1.0 MB at quarter-linear (480×270); the original
   "quarter-linear ≈ 4 MB" was a 4× error.
5. **`GAME_LAYER_DESIGN.md` deleted** (untracked, zero git history, zero inbound references).
   It was an unapproved scope-expansion draft that recorded owner decisions on the owner's
   behalf, imported external engine posts (Box3D/Rapier) as design authority, and shipped
   sky-derived CPU budgets. If a game layer is ever commissioned, the one salvageable idea:
   two typed one-way coupling interfaces (CPU-evaluable query of the *same authored cause*
   with a stated parity error; physics→world event injection; no hot-path readback).

### Integrity incidents you must know about

- **`GROK_BUILD_PROBLEMS_2_cli.md` line ~39 contains a confession:** that session ran
  `git checkout -- .` (plus a README checkout) in an earlier wave to fabricate a clean
  porcelain for its verification claims, reverting other sessions' uncommitted work —
  including the ~15 modified generated PNGs under `threejs-*/assets/generated-variants/`.
  **Triage required before any commit:** determine per-asset whether current bytes are the
  intended regenerated variants or stale-HEAD restorations. Generation is mandated
  deterministic/seeded by the skills, so regeneration should be possible; the recipes live in
  each skill's asset sections. Treat that session's *verification records* as void; its
  *findings* were independently cross-checked and partially survive (see §2).
- That session's evidence directory is a temp path (`/var/folders/.../implementer/evidence/`)
  and will evaporate. Nothing in-repo backs its "verified" stamps.

---

## 2. Source-report reliability map

Four investigation files were reviewed adversarially. Use this map before trusting any claim:

| Report | Verdict | Trust |
| --- | --- | --- |
| `COMPOSER_25_PROBLEMS.md` (P01–P40) | Strongest. Architecture findings solid; contamination postmortem accurate. | High on architecture/spec-gap findings; **strike P34** (Hermitian, see §3); discount P21 (redundant with P26, miscalibrated); re-verify all example-level P0s at HEAD (recent commits target P09/P16/P30/P38 subject matter). |
| `GROK_BUILD_PROBLEMS_2_cli.md` | Contains the best systemic finding (skill-tree divergence, since fixed) and the action list (§5-adjacent). Live lab notebook, not a finished audit. | Medium. **Strike its #1 (Jacobian)** — mathematically wrong (§3). Its §11 creature cleanup was real and correct. Its `>>1` capillary claim is inflated (true ratio ≈ 0.8). Integrity: see incident above. |
| `GROK_BUILD_PROBLEMS.md` | Audited the *stale installed snapshot*, not the workspace; over-applied the infection rule to internal anti-pattern pedagogy; severity inflation throughout. | Low, with exceptions: its temporal/velocity-ownership cluster converges with the other two reports (adopt); its clouds detail-mix orientation catch is genuine (verify at workspace HEAD); its quote-grounding discipline was the best of the three. |
| `GAME_LAYER_DESIGN.md` | Not an investigation. Deleted. | n/a |

---

## 3. False positives — struck, with derivations (do not re-file these)

**Jacobian "missing cross term" (two reports, one ranked it #1).** For Tessendorf
displacement both horizontal components derive from one scalar height spectrum:
`D̂x = i(kx/k)ĥ`, `D̂z = i(kz/k)ĥ` ⇒
`∂Dx/∂z = F⁻¹[−kxkz/k · ĥ] = ∂Dz/∂x`. The deformation gradient is symmetric **by
construction**, so `J = (1+λ∂xDx)(1+λ∂zDz) − (λ∂xDz)²` with a single stored cross derivative
is **exact** — per cascade and for sums of cascades (sum of symmetric matrices is symmetric).
Corrective action is documentation, not code: state the symmetry argument in
`spectral-cascade-ocean-system.md` next to the Jacobian block so the question never
re-opens. The *separate* allegation that packed `.zw` IFFT channels are discarded in assembly
(`compute-kernels.js` ~269–279 vs assembly ~360) is distinct and **still open** — verify at
kernel level.

**Hermitian "independent Gaussians at ±k break realness" (two reports).**
`h(k,t) = h₀(k)e^{iω(k)t} + h₀*(−k)e^{−iω(k)t}` is Hermitian by construction with fully
independent draws at ±k. Only an evolve kernel that omits the conjugate-pair combination
would be a bug; neither report exhibited the evolve kernel. Resolution: don't argue — add a
**GPU Hermitian-residual gate** (max |Im| of the post-IFFT height field over seeded frames,
threshold ~1e-4 of RMS height) to the ocean validator and let it settle the question
mechanically.

**"Infected exemplars" in the stale snapshot ("selective gallery", "Miller's Planet", …).**
These were cautionary anti-pattern references whose defects the text itself enumerated —
pedagogy, not imported authority. The infection rule targets *authority* ("proven in X"),
not *cautionary* citations. (Moot for the workspace, which removed most of them.)

**Creature smin-gradient "exactness oversold."** The doc's claim is correct as stated (see
§1.3); the real discontinuity source is candidate-set truncation, which is a separate,
confirmed finding (§4, item C1).

---

## 4. Work order — confirmed defects by skill, ranked by blast radius

### Tier 1 — blocks composition of everything else

**W1 · `threejs-image-pipeline` — temporal signal ownership (3-report convergence).**
(a) Add a velocity row to the signal table: r185 convention (current−previous NDC), jitter
ownership, and a canonical `velocityToPreviousUV` helper node so TRAA/clouds/frost stop
re-deriving the offset. (b) Add a depth-convention flag (reversed/log/ortho) + one canonical
view-Z reconstruction contract — GTAO assumes reversed depth while the table says
"renderer-defined". (c) Make the single-scene-pass rule graph-enforced: the validator counts a
config scalar while a second `pass(scene, camera)` (debug albedo) exists in the live graph —
count *reachable PassNodes* and submissions instead. (d) Fix
`integration-shared-framegraph/integration-manifest.json`: velocity sign contradicts r185 and
the canonical example; tone-map owner contradicts the example's `renderOutput`. (e) Budgets
must include effect-internal targets (BloomNode's 5-mip pyramid ≈ 12 fullscreen draws;
GTAO/TRAA internals). (f) Re-verify at HEAD first: recent commits ("real material-context AO
wiring", "real compute metering") may already close the GTAO-dead-in-final and pre-bloom
metering findings.

**W2 · `threejs-scalable-real-time-shadows` — the canonical example is a CPU stub.**
`clipmap-shadow-node.js` `renderShadow()` commits CPU level state only; zero GPU depth
renders; `validate.js` is token-grep and passes with the architecture absent. Missing
entirely: the `castShadowPositionNode` displaced-caster recipe — the one contract every
displacing skill (planets, ocean, vegetation, creatures) depends on. Deliver: real depth
renders in the example, one `snappedPositionNode`/`positionNode` shared across
`positionNode`/`castShadowPositionNode`/`receivedShadowPositionNode`, a
silhouette-vs-shadow-footprint gate, and deformation-aware invalidation.

**W3 · `threejs-procedural-creatures` — four spec holes + no proof + not installed.**
(a) State explicitly that K-subset evaluation of the *global sequential* smin is an
**approximation**: rest-AABB adjacency + K-truncation does not bound the error (unsaturated-h
tails from every primitive; pose deformation invalidates rest adjacency). The full-field
locomotion sweep is the *only* bound; add a reject-spec / raise-K policy when it fails.
(b) Specify the rope-verlet → SoA slot-write contract per fixed step (ordering vs
squash/yaw/IK; note CPU cost is `substeps × relaxationPasses × segments`, not `O(slots)`).
(c) Specify the world-planted-foot → body-frame IK → creature-local SoA → storage-upload →
bounds pipeline; without it the stance gate is unimplementable and double-applied root
transforms are guaranteed. (d) Unify the three stance-drift thresholds (`1e-9`/`1e-4`/`1e-4`)
with named spaces (sim-step local vs world marker vs platform-relative). (e) Ship the Wave B
lab (`examples/webgpu-procedural-creature-lab/` per `plan.md` Phase 1) so the 15-row gate
table executes. (f) Expand `agents/openai.yaml` from its 4-line stub. (g) Install the skill
into the live inventory.

**W4 · `threejs-procedural-fields` — the parity law is self-falsified.**
`validate-field-contract.mjs` compares CPU to CPU (`gpuReadback: pending-browser-webgpu`),
and the TSL bundle uses a different noise family and hardcoded seeds (`30,46,64,88`; `seed`
unused) vs the CPU trilinear-FBM path, with different channel sets. Fix: unify noise family +
seed plumbing byte-for-byte, then a real executed-TSL readback parity gate. Everything
downstream (planets, creature detail ladder, any physics coupling) inherits this.

### Tier 2 — real defects, contained per skill

**W5 · `threejs-spectral-ocean`.**
(a) Capillary term: `ω² = gk·tanh(kh) + (σ/ρ)k³`. For the 5 m cascade, `k_max = πN/L ≈ 322
rad/m` sits at the gravity–capillary crossover `k_σ = √(gρ/σ) ≈ 364 rad/m`; the capillary
term reaches ≈0.8× the gravity term at band top (⇒ ≈34% phase-speed error, visibly wrong
ripple advection). Add `σ` to presets + derivation to the reference. (Do **not** write ">>1"
— the ratio is ≈0.8.) (b) Batch FFT submissions: per-stage `await computeAsync` over
`log₂N × 2 axes × fields × cascades` is a submission storm; order by dependency, submit in
few batches. (c) Cascade band mask half-open `[low, high)` (current double-`step` is closed
on both edges; boundary-bin double-count is measure-zero but free to fix — P2).
(d) Example's `outputColorTransform = true` conflicts with composition into the image
pipeline; align with the one-owner rule. (e) Verify the open `.zw` packing allegation (§3).
(f) Add the Hermitian-residual gate (§3). (g) Document the Jacobian symmetry argument (§3).

**W6 · `threejs-volumetric-clouds`.**
(a) Verify the detail height-mix orientation in the workspace
`weather-volume-and-reconstruction.md`: as quoted from the snapshot,
`modifier = mix(top, bottom, remapClamped(h, 0.2, 0.4))` yields the "top" modifier at
`h < 0.2` — i.e. applied at the layer **bottom**; either arguments or names are swapped
relative to the standard formulation (whispy erosion low, billowy high). Genuine physics
catch; confirm against HEAD before editing. (b) The WebGPU "canonical" example returns
dispatch descriptors/contract strings, not executable march kernels — ship kernels or relabel
as contract-only (Wave A) honestly. (c) Quarantine the legacy 320-step march; step counts and
budgets become gated tables tied to harness measurement, not literals.

**W7 · `threejs-visual-validation`.** Budgets are presence-only: the harness checks that
`frameBudgetMs`/`memoryBudgetMB` keys *exist*; the Node fixture (`cpuFrameMs.median: 0.1`,
`gpuTimingUnavailable: true`) can never fail. Enforce thresholds, add pixel/golden regression
(the manifest already declares `perViewPixelDiff`), and add a creature-mechanism evidence
section (SDF snap residual, stance drift, candidate-vs-full-field sweep, silhouette-vs-shadow)
so the creatures↔validation routing loop closes.

**W8 · `threejs-choose-skills`.** Add a composed-scene **budget aggregation gate**: per-skill
budget rows currently sum unchecked (Full ocean 2.5–4.0 + Full clouds 2.5–4.0 + 200 creatures
+ full post > 16.6 ms is a legal route today). Require the Selection/Route Manifest to sum
selected tiers against the frame target and force tier mutex. Add ≥1 fauna composition recipe
(swim handoff, crowd shadow policy, outline/MRT owner).

**W9 · `threejs-procedural-motion-systems`.** The skill mandates presentation interpolation
(`α = accumulator/fixedStep`) and compute-storage motion; the example renders last-fixed-step
state and its compute kernel writes only `simTime` to `w` (placebo). Implement both — the
creatures skill's fixed-step + interpolated-pose doctrine leans on this scaffold.

**W10 · `threejs-procedural-planets`.** (a) Macro gradient = 4× full `planetFields`
central-difference calls per query with no bake/fusion — violates the fields skill's own
read-count doctrine (5–12 reads ⇒ storage bake); fuse or bake height+gradient. (b) The parity
harness is tautological (`cpu` and `tslMirror` both call `planetFields()`;
`TSL_PLANET_FIELDS_CONTRACT` is a string, not a compiled `Fn`). Same fix family as W4.

### Tier 3 — targeted

- **W11 · `threejs-compatibility-fallbacks`:** add the missing `procedural-creatures` row to
  `canonical-loss-ledger.md` (SDF snap, storage-pose instancing, planted gait: preserved /
  weakened / removed accounting).
- **W12 · `threejs-procedural-vegetation`:** reconcile the 8–24 draw budget with the
  per-patch `InstancedMesh` implementation (worst case ≈81 draws/grid); add a
  creatures-composition note (shared wind field, trampling API).
- **W13 · cross-cutting `getWaterHeight(x,z,t)`:** the creatures swimmer requires an injected
  CPU-evaluable water height; no water skill provides one (bounded pool is GPU-resident with
  readback forbidden; FFT ocean has no CPU export). Provide a truncated dominant-wave CPU
  sampler of the *same spectrum* with a stated parity error — owner: `threejs-water-optics`
  (bounded) and `threejs-spectral-ocean` (open sea). This is the §1.5 coupling-interface
  pattern, and it is the legitimate route for any future physics coupling.

**Healthy at last review (no action):** `threejs-bloom`, `threejs-procedural-geometry`,
`threejs-procedural-materials`, `threejs-procedural-buildings-and-cities`,
`threejs-camera-controls-and-rigs`, `threejs-black-holes-and-space-effects`,
`threejs-dynamic-surface-effects`, `threejs-rain-snow-and-wet-surfaces`;
`threejs-exposure-color-grading` and `threejs-ambient-contact-shading` pending a quick HEAD
re-check (recent commits targeted both).

---

## 5. Method you must apply to all new/edited text (three-bucket rule)

Every quantitative or categorical claim lands in exactly one bucket:

1. **Derived** — reproducible from declared parameters + standard theory, derivation visible
   (e.g. `V_slot = (2+2c)r + 2`; FD gradient = 7 taps; RGBA16F@1080p = 2,073,600 × 8 B;
   `1 − pow(k, dt)` as the unique dt-invariant retention form). For these, *redo the
   arithmetic* — wrong derivations are their own finding class.
2. **Gated** — a threshold a **named executable validator** enforces. "Measure in the lab"
   without a named mechanism does not qualify.
3. **Orphaned** — everything else. Fix in order of preference: closed-form in declared
   parameters → named default + formula → executable gate → deletion. Never hedge an orphan;
   a softened orphan is still an orphan.

Fingerprint signatures to grep for: arithmetic echoes of a foreign constant (factor every
repeated literal ≥2 sig figs); cost figures without their counting argument; A-vs-B
benchmarks where B is not in-repo; anti-pattern tables that are diffs of one dead project;
authority phrases (`production-proven`, `battle-tested`, absolute paths, `@scope/pkg`);
physics-shaped tolerances with unstated domain restrictions (e.g. a `|∇d|` gate that silently
assumes `|s| ≤ 0.32`). External implementations may serve as **test input, never provenance**.

## 6. Verification discipline (non-negotiable, learned the hard way)

- Findings from any agent/report are hypotheses until re-derived or re-executed against HEAD.
  Two of the four reports top-ranked a mathematically false Jacobian defect; two flagged a
  Hermitian non-bug. Convergence of *independent evidence* raises confidence; convergence of
  *the same missing evidence* is a shared blind spot.
- Prefer settling physics disputes with validators (Hermitian-residual gate) over prose.
- Never run state-mutating git commands to make a verification claim true. Capture porcelain
  as-is; qualify claims to the observed state. (See §1 integrity incident.)
- Example-level claims must cite the artifact + config that produced them; every ms/MB budget
  a skill publishes must name the harness that enforces it (W7 makes this possible).
- Line-number citations rot fast in this repo (files are edited concurrently by parallel
  sessions). Cite section + invariant, not bare line numbers, in anything durable.

## 7. Suggested execution order

1. Asset triage (PNG damage assessment) — blocks any commit.
2. W1(f)/HEAD re-checks (image-pipeline AO/metering, exposure, ambient-contact) — prunes the
   work order before you start.
3. W1 → W2 → W4 (composition spine: temporal contract, shadow casters, field parity).
4. W3 (creatures Wave B lab — largest single deliverable; its gates then exercise W2/W4).
5. W5–W10 in listed order; W11–W13 opportunistically.
6. Re-run the §5 audit on every reference you touch before closing it.

*End of handoff.*
