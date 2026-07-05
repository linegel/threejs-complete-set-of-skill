# Remediation Plan — Formal Specification & Derivation Register

**Baseline:** `add38f6` · **Date:** 2026-07-05 · **Ledger:** `HANDOFF.md` §3 (items 3.1–3.14), `HandOff--1.md` (W1–W13)
**Audience:** reviewers with graduate-level competence in both computer science and physics. Every gate constant in this document is **Derived** (derivation shown at point of use) or **Gated** (enforced by a named executable validator); a constant with neither does not ship (`prompts/audit-provenance-free-constants.md`, three-bucket rule).
**Binding blacklist:** `HANDOFF.md` §4. The ocean Jacobian determinant, Hermitian ±k seeding, polynomial-smin gradient, tapered-capsule gradient, and Newton `−f∇f/‖∇f‖²` step are settled mathematics; no task below touches them, and §2.5/§2.12 add the machine checks that keep them settled.

---

## 0. Notation, definitions, and epistemic rules

**Notation.** $u = 2^{-24}$ (f32 unit roundoff, round-to-nearest); $\mathrm{ulp}(x) \approx 2^{\lfloor\log_2|x|\rfloor-23}$; $\gamma_n = nu/(1-nu)$ (standard first-order accumulation bound for $n$ f32 operations, Higham, *Accuracy and Stability of Numerical Algorithms*, §3). Frame budget $B = 16.6\,$ms at 60 Hz. Ocean: $\hat h(\mathbf k,t)$ height spectrum, $g$ gravity, $\sigma/\rho = \beta$ kinematic surface tension, $h$ depth, $L$ patch length, $N$ grid size, $k_{\max}=\pi N/L$. Creatures: $P$ primitive count, $K$ candidate-set size, $k$ smin radius, $S$ Newton steps.

**Definitions.**
- **Parity law** (fields doctrine): for a field $F:\mathbb R^3\to\mathbb R^m$ authored once, $\|F_{\mathrm{CPU}}(\mathbf p)-F_{\mathrm{GPU}}(\mathbf p)\|_\infty \le \varepsilon_c$ per channel $c$, with $\varepsilon_c$ **derived from the arithmetic**, not tuned until green.
- **Gate:** a numeric inequality asserted by a named validator over an artifact produced by *executing* the system under test. String presence is not execution.
- **Mutation check (falsifiability):** for every gate, a documented perturbation of the system that MUST flip the gate to FAIL. A gate without a demonstrated failure mode has zero evidential weight; this is the pack's original disease (shadows/clouds/planets validators were token-greps).
- **Certificate vs. sweep:** an *a posteriori certificate* is a cheap runtime-checkable sufficient condition for exactness of an approximation; a *sweep* is an empirical bound over a scripted input distribution. A sweep bounds observed error; a certificate bounds error at the evaluated point. §2.12 introduces one for the creature smin truncation.

**Epistemic rules (inherited from HANDOFF §5, tightened).**
1. Re-verify every cited literal at HEAD before editing; the line anchors in this plan are execution-time hints, not durable citations — durable text cites *section + invariant*.
2. Physics disputes are settled by validators, not prose (Hermitian residual gate, §2.5.5).
3. External implementations are test inputs, never provenance. Named methods are cited by author/venue only where the method itself is used (Tessendorf's spectral synthesis; Schneider's cloud density formulation; Hillaire's multi-scattering LUT; Karis-style neighborhood clamping) — no page-number theater, no imported benchmark numbers.
4. Delegation: implementation runs on codex/gpt-5.5 with fully self-contained prompts (Appendix A packet template); the orchestrating session re-derives all math in a delegated diff before accepting. Verification claims from any agent are hypotheses until re-executed.

---

## 1. Cross-cutting numerical doctrine

These results are used by multiple tasks; each task cites them instead of re-deriving.

### 1.1 f32 model and WGSL intrinsic accuracy

WGSL/WebGPU guarantees (W3C WGSL spec, "Floating point accuracy" — verify the table against the spec version shipped with Chrome at execution time; Task 0.4):
- Basic arithmetic ($+,-,\times,\div$): correctly rounded (÷ within 2.5 ulp).
- $\exp, \exp2$: $\le 3+2|x|$ ulp; $\log,\log2$: $\le 3$ ulp (absolute $2^{-21}$ near 1); $\sqrt{}$: correctly rounded via `inverseSqrt` $\le 2$ ulp.
- $\sin, \cos$: **absolute error $\le 2^{-11}$ only on $x \in [-\pi,\pi]$. Outside that interval accuracy is implementation-defined.**
- $\mathrm{pow}(x,y) = \exp2(y\,\log2\,x)$: error compounds per that decomposition.

**Consequence 1 (hash doctrine).** Any construction of the form $\mathrm{fract}(A\sin(d))$ with $A\sim 4.4\times10^4$ and $|d| \gg \pi$ is *doubly* disqualified as a cross-device parity primitive:
(i) even with a perfect $\sin$, the product $A\sin(d)$ carries absolute rounding error $\approx A\,u \approx 4.4\times10^4 \cdot 2^{-24} \approx 2.6\times10^{-3}$, which `fract` preserves — i.e. the hash itself has only $\sim\!8$ dependable bits;
(ii) $\sin$ at $|d|\sim 10^2..10^3$ is implementation-defined in WGSL, so CPU↔GPU and GPU↔GPU agreement is not merely loose but *unspecified*.
Therefore the parity-bearing hash MUST be an **integer hash** on quantized lattice coordinates (e.g. `lowbias32`/PCG-family over `u32`), computed with `u32` arithmetic on the GPU and forced-u32 semantics (`>>> 0`, `Math.imul`) on the CPU. Integer arithmetic is exact on both sides ⇒ **hash parity is bit-exact by construction**, and the float conversion $u32 \cdot 2^{-32} \to [0,1)$ rounds identically. The only surviving CPU↔GPU discrepancies are in the *float post-processing* (interpolation, fBm accumulation, channel shaping), which §1.2 bounds. This changes Task 2.1's design: we do not "tolerance away" the sin-hash — we remove it from the parity path.

### 1.2 Parity tolerance derivation for value-noise/fBm channels

With bit-exact lattice hashes $n_i \in [0,1)$, trilinear value noise at $\mathbf p$ computes $\sum_{i=1}^{8} w_i n_i$ with $w_i$ products of three smoothstep weights, $\sum w_i = 1$, $w_i \ge 0$. Per octave: ~30 flops ⇒ error $\le \gamma_{30} \cdot \max_i |n_i| \approx 30u \approx 1.8\times10^{-6}$. fBm over $O$ octaves with normalized weights is a convex combination ⇒ no amplification; total fBm error $\le \gamma_{30(O+1)} \approx 2\times10^{-5}$ at $O=4$ **plus** the CPU-side f64→f32 representation gap of inputs, same order. Channel shaping: $\mathrm{pow}(x, 2.7)$ has relative condition number $2.7$; libm-vs-GPU `pow` discrepancy $\le$ a few ulp of the decomposition ($\approx 5\times10^{-6}$ relative after conditioning). Domain warp multiplies position error by the field's Lipschitz constant $L_F=\sup\|\nabla F\|$; for the authored bundle $L_F \lesssim \sum_i (\text{amp}_i \cdot \text{freq}_i) \cdot L_{\mathrm{interp}} = O(4)$ (unit-amplitude octaves at gain·lacunarity ≈ 1) ⇒ still $O(10^{-5})$.

**Gate constant:** $\varepsilon_{\text{continuous}} = 10^{-4}$ per continuous channel (≥5× margin over the $2\times10^{-5}$ bound — margin absorbs driver libm variation, and the margin factor is stated in the validator output). Thresholded channels (`placementMask`): compare **pre-threshold** scalar with $\varepsilon_{\text{continuous}}$, and additionally require the post-threshold bit to agree except where the pre-threshold value lies within $\varepsilon_{\text{continuous}}$ of the threshold (measure-zero band; validator reports band occupancy). Comparing post-threshold bits unconditionally would make the gate flaky by construction — a reviewer trap the validator must document.

### 1.3 Reversed-z precision and temporal disocclusion thresholds

Reversed-z with $d = n/z$ (infinite far): $z = n/d$, $\delta z = z^2\,\delta d/n$, and $\delta d \le \mathrm{ulp}(d) \le 2^{-24}d$ ⇒ $\boxed{\delta z / z \le 2^{-24}}$ — constant *relative* precision across the range (the property that motivates reversed-z). Disocclusion test for history rejection therefore uses
$$\tau_z(\mathbf p) = c_{\text{fp}}\, z + \Big\|\tfrac{\partial z}{\partial \mathbf{uv}}\Big\|\,\|\Delta \mathbf{uv}\| ,\qquad c_{\text{fp}} = 2^{-20}\ (\text{16× margin over } 2^{-24}),$$
i.e. a floating-point floor plus a geometric slope term (surface seen at grazing angle legitimately changes depth across one texel). A fixed absolute $\tau_z$ is wrong at both ends of the range; this formula goes into the W-C contract verbatim.

### 1.4 EMA temporal accumulation: variance, lag, and why same-UV history is void

Exponential history $H_t = \alpha C_t + (1-\alpha)H_{t-1}$ with i.i.d. per-frame noise variance $\sigma^2$: steady state $\mathrm{Var}(H) = \sigma^2 \alpha/(2-\alpha)$ ⇒ effective-sample multiplier $N_{\text{eff}} = (2-\alpha)/\alpha$ ($\alpha = 1/16 \Rightarrow N_{\text{eff}} = 31$). Impulse-response lag $\approx (1-\alpha)/\alpha$ frames. **Without reprojection** (history fetched at the same UV under camera motion $\Delta\mathbf{uv}$/frame), the history is an average over a *screen-space trail* of scene points; the resulting bias is $\approx \|\nabla_{\mathbf{uv}} L\|\cdot\|\Delta\mathbf{uv}\|\,(1-\alpha)/\alpha$ — unbounded relative to the signal, which is why the clouds skill's own SKILL.md forbids it and why the legacy example (which does exactly this) is deleted, not tuned (§2.6). The claimed "4–16× temporal amortization" is *only* real when $N_{\text{eff}}$ applies, i.e. only with valid reprojection.

### 1.5 FFT rounding and the Hermitian residual threshold

Radix-2 FFT of size $N$ has normwise relative rounding error $O(u\log_2 N)$ (Higham §24). For $N=512$, $u\log_2 N \approx 5\times10^{-7}$. A Hermitian-symmetric spectrum evolved as $\hat h(\mathbf k,t)=\hat h_0(\mathbf k)e^{i\omega t}+\hat h_0^*(-\mathbf k)e^{-i\omega t}$ yields real $h(\mathbf x)$ up to that rounding, so the machine gate
$$\max_{\mathbf x}|\mathrm{Im}\,h(\mathbf x)| < 10^{-4}\, h_{\mathrm{rms}}$$
carries ≥100× margin over the $O(10^{-6})$ floating-point floor while still catching any *structural* symmetry break (a broken evolve kernel produces $\mathrm{Im}\,h = O(h_{\mathrm{rms}})$, 4 orders above the gate). This is the mechanical settlement of the retracted "Hermitian violation" finding — the gate decides, not prose.

### 1.6 Kernel-cost accounting identities

Used by budget tables so every count is a visible product, not a folklore number:
- Ray-march cost per frame: $C = W_r H_r \cdot S_p (1 + S_\ell)$ density-field taps at render resolution $W_r{\times}H_r$, $S_p$ primary steps, $S_\ell$ light taps per step. Legacy clouds at quarter-linear 480×270 with $S_p{=}320, S_\ell{=}5$: $480\cdot270\cdot320\cdot6 \approx 2.5\times10^8$ taps/frame — the *direction* of the retracted eval-count finding, restated with correct arithmetic.
- Bloom mip chain to depth $D$: $D$ downsample draws + $D$ upsample/combine draws + prefilter + composite $= 2D+2$ fullscreen-class draws ($D{=}5 \Rightarrow 12$).
- Buffer bytes: $W\!\cdot\!H\!\cdot\!\text{bpp}$, shown in-table (quarter-linear 1080p RGBA16F: $480\cdot270\cdot8\,\mathrm{B} \approx 1.04\,\mathrm{MB}$; half-linear $960\cdot540\cdot8 \approx 4.15\,\mathrm{MB}$; full $1920\cdot1080\cdot8 \approx 16.6\,\mathrm{MB}$ — the reference table currently mislabels the latter two, §2.6).
- Cascaded-shadow displacement tax: a displacing material with $C$ shadow levels runs its displacement $1{+}C$ times/frame steady-state, and up to $1{+}C_{\text{full}}$ under full invalidation — the budget term absent from every downstream table (§2.2).

---

## 2. Work items — formal specifications

Ordering and blast-radius rationale follow `HANDOFF.md` §3. Each item: **Contract** (the invariant, stated formally) → **Design** → **Derivations** (or pointer into §1) → **Gates & mutation checks** → **Files**. Execution mechanics (codex packets, commit protocol) are in Appendix A and apply uniformly.

### 2.0 Phase 0 — Preflight (blocks everything)

P0.1 **Harness viability.** Run `threejs-image-pipeline/examples/webgpu-image-pipeline/capture.mjs` once. It is the single browser-execution anchor (HTTP server + spawned Chrome + PNG/JSON artifacts via `threejs-visual-validation/.../src/{browser-webgpu-surface.js,png.js}`); all new capture validators pattern-copy it. If headless Chrome lacks WebGPU on this machine, all captures run headed; record the working flag set.
P0.2 **Skill-inventory sync** (ledger 3.4): delete the 11 stale old-name dirs from `~/.claude/skills` (list recorded in the Phase-0 commit body), install `threejs-procedural-creatures`, `diff -rq` the remaining 25 against the workspace (workspace authoritative).
P0.3 **Open-verdict re-reads:** (a) ocean `.zw` assembly-kernel consumption (the one unadjudicated packing allegation — read the assembly kernel after the butterfly at `compute-kernels.js:~332`, verdict fix-or-strike feeds §2.5); (b) vegetation worst-case draw count vs its 8–24 table (feeds §2.14); (c) `integration-manifest.json` velocity/tone-map wording vs primary evidence from P0.4 (feeds §2.3); (d) which node owns final output in `webgpu-fft-ocean` (feeds §2.5.6).
P0.4 **Primary-source API facts** from `node_modules/three` (r185.1) — never from audit hearsay: exact `castShadowPositionNode`/`receivedShadowPositionNode` semantics and where the shadow pass consumes them; `renderer.computeAsync([nodes])` array acceptance; `VelocityNode` sign convention and jitter handling; previous-instance-matrix provisioning for instanced velocity; WGSL intrinsic-accuracy table version (§1.1).
P0.5 **Audit the five self-reported remediation commits** (`31e7f18` AO wiring, `a20dfa2` compute metering, `41a7e9a` choose-skills schema, `cb95d9e` derivative normals, `4bca3bd` validation schema): ledger §1 voids self-reported verification; read each diff, run its validator once; clean-list stands or items reopen with evidence.
P0.6 **Asset-intent check:** `add38f6` declared PNG triage moot on clean-porcelain grounds, which proves commitment, not intent. Read `ASSET_VARIANT_REVIEW.md`; if it does not adjudicate per-asset, re-run the documented seeded generation for 2–3 sampled skills and byte-compare.
P0.7 **Ledger retag commit** (evidence lines for every [A]→[V]/[R] transition; deleted-dir list; API facts).

### 2.1 W-A · `threejs-procedural-fields` — parity law made true and executable (ledger 3.1)

**Contract.** The skill's central law — *author once, evaluate anywhere* — becomes the checkable statement: for every published channel $c$ and probe $\mathbf p$ in a seeded probe set $\mathcal P$ ($|\mathcal P| \ge 10^3$, fixed seed),
$$|F^c_{\mathrm{CPU}}(\mathbf p) - F^c_{\mathrm{GPU}}(\mathbf p)| \le \varepsilon_c,\qquad \varepsilon_{\text{continuous}} = 10^{-4}\ \text{(derived §1.2)},$$
with the thresholded-channel protocol of §1.2, evaluated on **readback of the actually-compiled TSL kernel**, not a CPU mirror.

**Verified divergence state at HEAD** (supersedes both audits and the sibling plan's delta): octave-seed increments already agree (`seed+17/34/51`); remaining divergences: (i) noise family — TSL per-octave point hash `hash3Node` vs CPU trilinear 8-corner `valueNoise3`; (ii) seed plumbing — `sampleField` takes no seed input; base seeds `30/46/64/88` and `warpSeed=17` hardcoded at call sites; (iii) TSL fBm hardcodes 4 octaves/frequencies `2.03/4.1209/8.3654` vs CPU parameterized octaves/lacunarity/gain; (iv) TSL missing channels `slope`, `biome`, `roughness`, `placementMask`.

**Design.** (1) Replace the sin-dot hash **on both sides** with a shared integer lattice hash per §1.1 Consequence 1 (this is a *derived necessity*, not taste: no tolerance exists that makes the sin-hash parity gate both tight and portable). CPU: `u32` semantics via `Math.imul`/`>>>0`; TSL: `u32` ops. (2) One shared parameter object (octaves, lacunarity, gain, seed, channel post-maps) serialized into both evaluators; the TSL `Fn` takes the seed as a uniform. (3) Implement the four missing channels from the same shared causes. (4) `capture-field-parity.mjs` (pattern §2.0/P0.1): compile, bake probes to a storage buffer, read back, emit JSON artifact. (5) `validate-field-contract.mjs` consumes the artifact; absent artifact ⇒ `SKIPPED` + nonzero in gate mode (never PASS); the CPU-vs-CPU tautology at `:64–65` and the `pending-browser-webgpu` escape hatch are deleted.

**Gates & mutation.** G1 per-channel inequality above, reported as $\max$ and 99.9th-percentile error per channel with the derivation constants echoed in the artifact. G2 determinism: two runs, identical readback bytes. **M1:** perturb one lattice-hash multiplier on the TSL side only ⇒ G1 FAILs. **M2:** change the seed on one side ⇒ G1 FAILs. Consumer note recorded in SKILL.md: this parity gate is what downstream skills (planets §2.8, creatures detail ladder, vegetation placement) cite — its falsifiability is load-bearing for them, hence M1/M2 outputs are committed as evidence.

**Files.** `examples/webgpu-field-bake/{field-bundle.mjs, validate-field-contract.mjs, capture-field-parity.mjs(new), index.html(new)}`, `SKILL.md`, parity-law reference section.

### 2.2 W-B · `threejs-scalable-real-time-shadows` — depth renders exist; caster parity is a theorem about one function (ledger 3.2)

**Contract (caster parity).** For a displaced surface $\mathbf p' = \mathbf p + \mathbf D(\mathbf p, t)$, the *same* $\mathbf D$ must be evaluated in the camera pass (`positionNode`) and the shadow-depth pass (`castShadowPositionNode`), with `receivedShadowPositionNode` sampling at $\mathbf p'$ in world space for self-receive. The invariant is *single-source-of-truth for $\mathbf D$*: one TSL `Fn`, two wirings. Violation modes: undisplaced proxy casts (shadow detaches from silhouette by up to $\|\mathbf D\|_\infty$ projected), or double displacement.

**Design.** (1) `renderShadow(frame)` performs actual GPU depth renders into a per-level region of a depth atlas with the light camera — the existing CPU scheduler remains the *selection* stage it already is. (2) Canonical displaced-caster recipe in `main.js` + reference: shared field-time-driven displacement `Fn`, wired per P0.4's verified API names. (3) Deformation-aware invalidation: `LevelState.fieldTime`; a level is dirty iff its cached content was rendered at a stale field time; re-render is budgeted (≤ $R$ levels/frame), with the starvation-freedom argument below. (4) Budget table gains the displacement-tax identity from §1.6 (the $1{+}C$ term), cross-linked from planets/ocean/vegetation/creatures budget sections.

**Scheduler analysis (starvation freedom).** With priority = (level age since dirty) × (screen-space area weight) and a budget of $R\ge1$ re-renders/frame over $\Lambda$ levels, any persistently dirty level's priority grows without bound while a freshly re-rendered level's resets ⇒ every dirty level is re-rendered within at most $\lceil \Lambda / R\rceil$ frames of becoming dirty (age term dominates eventually; formal because priorities are strictly increasing in age and only $R$ resets occur per frame). Worst-case staleness bound goes in the reference next to the budget so the "cached" claim has a stated latency.

**Silhouette/footprint gate derivation.** Rasterize (a) the displaced mesh's light-POV silhouette mask and (b) the binary occupancy of its shadow-map footprint at the same resolution. Both are rasterizations of the same displaced geometry ⇒ disagreement is bounded by raster quantization: ≤ ½ texel per independent rasterization along the boundary ⇒ boundary-band disagreement of ≤ 2 texels; interior must agree exactly. Gate: symmetric-difference pixels restricted to outside a 2-texel boundary band $= 0$; boundary-band disagreement reported, not gated (it is quantization, and gating it would be tuning noise).

**Gates & mutation.** G1 ≥1 real depth render observed (renderer.info render-target draws > 0) and per-committed-level depth variance > 0. G2 silhouette/footprint gate above. G3 invalidation: advancing field time marks exactly the affected levels dirty (validator asserts the dirty set). **M1:** stub `renderShadow` back to bookkeeping ⇒ G1 FAILs. **M2:** wire `castShadowPositionNode` to the *undisplaced* position ⇒ G2 FAILs (this is the exact bug class the recipe exists to prevent — the mutation check literally demonstrates the pack-wide failure mode). **M3:** freeze `fieldTime` ⇒ G3 FAILs. String-grep `validate.js` is deleted.

**Files.** `examples/webgpu-cached-clipmap-shadow/{clipmap-shadow-node.js, main.js, clipmap-config.js, validate.js(rewrite), capture-shadow-depth.mjs(new)}`, `references/cached-clipmap-shadows.md`, `SKILL.md`.

### 2.3 W-C · `threejs-image-pipeline` — temporal signal ownership; validation against the live graph (W1 + ledger 3.11)

**Contract (reprojection algebra, stated once, owned here).** For a point with model transform $M_t$ and view-projection $P_tV_t$ (**unjittered** for velocity purposes; jitter is applied only at sampling and removed before velocity — the owner of that subtraction is named in the table),
$$\mathbf{uv}_{t-1} = \tfrac12\,\Big(\frac{(P_{t-1}V_{t-1}M_{t-1}\,\mathbf x)_{xy}}{(P_{t-1}V_{t-1}M_{t-1}\,\mathbf x)_w}\Big) + \tfrac12,\qquad \mathbf v = \mathbf{uv}_t - \mathbf{uv}_{t-1},$$
with the sign convention fixed to whatever r185's `VelocityNode` actually implements (P0.4 primary evidence — the manifest's current "previous/current" wording is corrected to match). `velocityToPreviousUV(uv, v) = uv − v` is the single helper all consumers import; consumers never re-derive the algebra. **Per-instance/skinned ownership:** correct $\mathbf v$ for instanced/deformed geometry requires $M_{t-1}$ (previous instance matrices / previous deformed positions); the table names the owner per P0.4 (three-provided vs skill-managed storage) — without this, every moving creature ghosts under TRAA/cloud reprojection. **Depth row:** convention flag (reversed/log/ortho) + the single view-Z reconstruction and the disocclusion threshold $\tau_z$ formula from §1.3. **Reset events enumerated:** camera cut/teleport, resolution/tier change, renderer restore, first frame ⇒ history-valid flag consumers must honor; identical reset behavior across TRAA/clouds/frost by construction.

**Design.** (1) Signal table gains the velocity + depth rows above. (2) Implement `velocity-to-previous-uv.js`; the example's TRAA path uses it. (3) Fix `integration-manifest.json` velocity/tone-map wording to primary evidence; update its validator. (4) **Live-graph enforcement:** `browser-app.js` walks the composed node graph, counts reachable scene-pass nodes, writes the count into the capture artifact; `validateImagePipelineConfig.js` asserts artifact count == 1 (the config scalar `sceneRenderCount` demotes to informational). (5) Budget table gains effect-internal rows via §1.6 identities (bloom $2D{+}2$; GTAO AO+denoise; TRAA resolve+history).

**Gates & mutation.** G1 live-graph scene-pass count == 1 from the executed capture. G2 manifest-vs-example convention consistency (validator cross-checks strings against the helper's actual sign by evaluating it on a synthetic matrix pair — an executable convention test, not prose agreement: feed $M_{t-1} \ne M_t$ with known displacement, assert reconstructed $\mathbf{uv}_{t-1}$ within $2u$). **M1:** the existing `'duplicate-scene-render'` fixture must now fail via the graph count, not the config. **M2:** negate the velocity sign in the helper ⇒ G2 FAILs.

**Files.** `SKILL.md` + signal-table reference, `examples/webgpu-image-pipeline/{browser-app.js, validateImagePipelineConfig.js, pipelineConfig.js, velocity-to-previous-uv.js(new)}`, `examples/integration-shared-framegraph/{integration-manifest.json, validate-integration-manifest.mjs}`.

### 2.4 W-D · `threejs-choose-skills` — composed-budget feasibility as interval arithmetic (ledger 3.3, 3.4 residual)

**Contract.** Per-skill tier costs are published as intervals $[l_i, h_i]$ ms (they are hardware ranges, and pretending otherwise would be false precision). A composed route with frame budget $B$ and selected tiers $\{t_i\}$ is:
- **certified feasible** iff $\sum_i h_i(t_i) \le B_{\text{alloc}}$, where $B_{\text{alloc}} = B - B_{\text{reserve}}$ and $B_{\text{reserve}}$ (engine/other, a declared manifest field) is stated, not implied;
- **infeasible** iff $\sum_i l_i(t_i) > B_{\text{alloc}}$ (upper bounds can't save it);
- otherwise **conditional** — legal only with an explicit measured-on-target waiver recorded in the manifest.
The router auto-approves only certified routes; the canonical counterexample (Full ocean + Full clouds + 200 creatures + full post: $\sum l_i > 16.6$ already) is shown with its forced downgrade path. This three-way verdict is deliberately conservative; a reviewer should recognize it as standard interval-arithmetic feasibility, chosen over point estimates because the inputs are ranges.

**Design.** SKILL.md + `router-recipes.md` section; route-manifest schema gains `frameBudgetMs`, `reserveMs`, per-skill tier row references; `validate-route-manifest.mjs` computes both sums and emits the verdict; ≥1 fauna/water composition recipe (swimmer + `getWaterHeight` handoff per §2.9, crowd shadow policy citing §2.2's displacement tax, outline/MRT owner declaration); inventory-divergence preflight detecting BOTH missing and coexisting-stale skill dirs (the observed failure mode was 11 stale dirs *coexisting*).

**Gates & mutation.** G1 certified fixture passes; G2 the counterexample fixture returns infeasible. **M1:** raise one tier's $h_i$ so the certified fixture's $\sum h_i$ exceeds $B_{\text{alloc}}$ ⇒ G1 FAILs.

**Files.** `SKILL.md`, `references/router-recipes.md`, `examples/{validate-route-manifest.mjs(new or extended), composed-budget-manifest.json(new)}`.

### 2.5 W-E · `threejs-spectral-ocean` — dispersion physics, submission batching, symmetry gates (ledger 3.5)

**2.5.1 Capillary–gravity dispersion (fix everywhere the relation appears: TSL kernel, WGSL strings, CPU mirrors, group-velocity node).** Finite-depth capillary–gravity relation (Lamb, *Hydrodynamics*, §267):
$$\omega^2 = \big(gk + \beta k^3\big)\tanh(kh),\qquad \beta = \sigma/\rho = 7.28\times10^{-5}\ \mathrm{m^3 s^{-2}}\ (\text{clean water, 20 °C; preset field }\texttt{sigmaOverRho}).$$
Worked magnitude at the finest cascade ($L=5$ m, $N=512$): $k_{\max} = \pi N/L \approx 322\ \mathrm{rad/m}$; $\beta k_{\max}^2/g \approx 0.78$ ⇒ the shipped gravity-only $\omega$ underestimates by $\sqrt{1.78} \approx 1.33$ (∼33% phase speed) exactly in the ripple band. The ratio is 0.78 — any "≫1" phrasing is drift and is rejected. Group velocity, re-derived with both terms (this expression feeds foam/advection timing and MUST change in the same commit as $\omega$):
$$c_g = \frac{d\omega}{dk} = \frac{(g + 3\beta k^2)\tanh(kh) + (gk + \beta k^3)\,h\,\mathrm{sech}^2(kh)}{2\omega}.$$
Dimensional check: numerator $[\mathrm{m\,s^{-2}}]$, $\omega$ $[\mathrm{s^{-1}}]$ ⇒ $c_g$ $[\mathrm{m\,s^{-1}}]$ ✓; limits: $\beta\to0,\ kh\to\infty$ recovers $g/2\omega = \tfrac12 c_p$ ✓ (deep-water gravity), $\beta k^2 \gg g$, $kh\to\infty$ gives $\tfrac32 c_p$ ✓ (capillary). These limit checks go into the validator as unit tests of the CPU mirror.
**Scope boundary (stated, not hidden):** we correct the *kinematics* $\omega(k), c_g(k)$; the authored gravity-range spectrum shape $S(k)$ is retained. A capillary equilibrium range has different spectral slope than the gravity range, and modeling it is out of scope — the visual defect being fixed is phase/group-velocity error (wrong advection), not energy content. This is recorded in the reference as a Derived-scope limitation so a physics reviewer finds the boundary drawn, not fudged.

**2.5.2 Submission batching.** Dispatch count per frame is structural: 3 cascades × 2 axes × $\log_2 512 = 9$ stages = 54 butterfly dispatches + spectrum/assembly. Dispatches are cheap; *submission boundaries* (`await computeAsync` per node) serialize host↔GPU. Restructure to dependency-layered arrays (P0.4 confirms `computeAsync([...])`; fallback: enqueue via non-awaited `compute()` and one terminal await). Gate: instrumented submissions/frame ≤ 3 (spectrum, FFT block, assembly) vs the current ~50+. The identical if/else at `ocean-system.js:37–41` collapses in passing.

**2.5.3 Band mask.** Half-open $[k_{\text{lo}}, k_{\text{hi}})$ (`step(lo,k) − step(hi,k)` composition rather than closed-both-ends product): removes the double-count when a bin lands exactly on a cascade handoff. Severity honestly stated: coincidence is measure-zero across incommensurate patch lengths — P2, fixed because it is free while the file is open.

**2.5.4 `.zw` packing verdict** from P0.3(a): fix or strike with kernel-level evidence; the packing *technique* (two real fields as one complex signal, separated post-IFFT by Hermitian symmetry) is valid in general and is not the allegation.

**2.5.5 Symmetry gates (blacklist enforcement).** Add the Hermitian-residual gate with the §1.5 threshold; document the Jacobian symmetry argument ($\hat{\mathbf D} = i(\mathbf k/k)\hat h$ is a gradient field ⇒ $\partial_z D_x \equiv \partial_x D_z$ by Fourier-multiplier symmetry ⇒ the single-cross-term determinant is exact) next to the determinant code. Neither is a code change; both exist so the two loudest false positives of the audit cycle can never be re-filed against silence.

**2.5.6 Output ownership** per P0.3(d): exactly one owner of the output color transform, aligned with §2.3's contract (expected: `outputColorTransform = false` where a `renderOutput()`-style node owns it).

**Gates & mutation.** G1 CPU-mirror dispersion unit tests incl. both limit checks; G2 submissions/frame ≤ 3; G3 Hermitian residual < $10^{-4} h_{\mathrm{rms}}$; G4 (if `.zw` confirmed) assembly consumes all packed channels. **M1:** drop the $\beta k^3$ term from the CPU mirror only ⇒ G1 capillary-limit test FAILs. **M2:** restore per-node awaits ⇒ G2 FAILs. **M3:** conjugate the wrong term in a copy of the evolve kernel used by the validator's negative fixture ⇒ G3 FAILs (proves the gate detects the structural break it exists for).

**Files.** `examples/webgpu-fft-ocean/{compute-kernels.js, ocean-system.js, ocean-nodes.js, constants.js, validation.js, validate-ocean-contracts.js}`, `examples/spectral-cascade-ocean/{spectrum.js, ocean-system.js}`, `references/spectral-cascade-ocean-system.md`.

### 2.6 W-F · `threejs-volumetric-clouds` — an executed march or nothing (ledger 3.6)

**Contract.** The canonical WebGPU path contains an *executable* TSL march whose transmittance is $T = \exp(-\int \sigma_t\,ds)$ integrated per-step as $T \mathrel{*}= \exp(-\sigma_t\,\Delta s)$ (exact for piecewise-constant $\sigma_t$; quadrature error $O(\Delta s\,\cdot \mathrm{TV}(\sigma_t))$ along the ray, which is what tier step counts trade against — stated in the reference so step-count tiers are an error/cost tradeoff, not folklore). Scattering uses a normalized phase function ($\int_{S^2} p\,d\Omega = 1$; HG with stated $g$). History accumulation follows §1.4 with reprojection via §2.3's `velocityToPreviousUV` + depth rejection with §1.3's $\tau_z$ — this import is the pack's first executed composition proof. Scene-linear output; no local tone/gamma (single-owner rule, §2.3).

**Reference fixes (confirmed at HEAD).** (a) Detail-erosion height profile: current text applies the "top" modifier at $h_{\text{frac}}<0.2$ (arguments swapped relative to the low-wispy/high-billowy formulation of the Schneider-family density model): swap to `mix(bottomModifier, topModifier, remapClamped(h, 0.2, 0.4))`, `bottom = 1−detail`, `top = detail^6`. Density topology feeds $\sigma_t$ hence $T$ — this is a physics fix, not cosmetics. (b) Memory table: BOTH lines wrong; correct with §1.6 arithmetic shown in-table (≈1.04 / 4.15 / 16.6 MB for quarter/half/full-linear 1080p RGBA16F).

**Design.** New `examples/webgpu-cloud-march/`: tier-driven $S_p, S_\ell$ from the tier table (no literal 320 anywhere), quarter/half-res, reprojection per above; capture script emits per-tier PNG + timing + step-product artifact. **Legacy `examples/weather-volume-clouds/` is DELETED** (owner decision; git history preserves it) with all references repointed — it violates the skill's own rules three ways (same-UV history §1.4, unbounded step count, local tone-map).

**Gates & mutation.** G1 executed march artifact exists with $S_p \cdot S_\ell \cdot W_r H_r$ matching the tier table row (§1.6 identity). G2 energy sanity on readback: $T \in (0,1]$, monotone non-increasing along a probe ray. G3 reprojection: under the scripted camera move, history-rejection mask is nonzero at disocclusions and zero on static interior (artifact-level check). **M1:** hardcode $S_p{=}320$ ⇒ G1 FAILs. **M2:** switch history fetch to same-UV ⇒ G3 FAILs (the exact legacy sin, now mechanically caught). Dual visual judging (codex+grok) on per-tier captures per the standing visual-QA protocol.

**Files.** `examples/webgpu-cloud-march/(new)`, delete `examples/weather-volume-clouds/`, `references/weather-volume-and-reconstruction.md`, `SKILL.md`, `validation.js`.

### 2.7 W-G · `threejs-sky-atmosphere-and-haze` — executed LUTs with physical gates (ledger 3.7)

**Contract.** Transmittance LUT $T(r,\mu) = \exp(-\sum_s \int \sigma_s(\mathbf x(t))\,dt)$ over the standard altitude × view-cosine parameterization, computed by an *executed* compute kernel (trapezoidal quadrature, $M$ samples). Quadrature error for exponential density profiles (scale height $H$): relative optical-depth error $\lesssim \ell^2/(12 M^2 H^2)\cdot \tau$ for path length $\ell$ — the reference states this and derives the shipped $M$ from a $10^{-3}$ relative target rather than asserting a magic sample count. Multiple-scattering LUT follows the isotropic-multiple-scattering factorization (Hillaire 2020): with single-scatter albedo bound $a<1$, the geometric series $\sum_n a^n = 1/(1-a)$ bounds the LUT ⇒ executable energy gate.

**Fixes.** Double output transform: `renderOutput(...)` AND `outputColorTransform = true` — present both inside the `PIPELINE_SCAFFOLD` template string (`webgpu-lut-atmosphere.js:64–72`) and the live class path (`:159`); both become single-owner per §2.3. Silent tier downgrade on non-WebGPU becomes a hard throw whose message routes to `threejs-compatibility-fallbacks` (that skill's explicit-ask contract). Descriptor-string "kernels" are replaced by executed kernels (owner decision: implement, not relabel).

**Gates & mutation.** G1 $T \in (0,1]$, $T$ monotone non-increasing in path length, $T(\ell{=}0)=1$ exactly. G2 hand-computed single-wavelength Rayleigh vertical column matches LUT readback within the stated quadrature bound (the orchestrator computes this independently — it is the acceptance spot-check). G3 multi-scatter LUT $\le 1/(1-a)$ everywhere. **M1:** drop the density integrand's altitude term ⇒ G2 FAILs. **M2:** set both transform owners on ⇒ the §2.3 convention validator FAILs.

**Files.** `examples/webgpu-lut-atmosphere/{webgpu-lut-atmosphere.js, validation.js, README.md, capture-atmosphere-luts.mjs(new)}`.

### 2.8 W-H · `threejs-procedural-planets` — gradient cost and non-tautological parity (ledger 3.8)

**Contract.** Macro-normal queries cost **one** field evaluation, not four. Two admissible designs, chosen by measurement at execution time: (a) *fused analytic gradient* — value noise is $C^1$ inside cells with closed-form derivative (differentiate the trilinear/smoothstep form; per-octave derivative bound $\|\nabla n_i\| \le \tfrac{3}{2}\,\mathrm{freq}_i$ from $\max|s'(x)| = \tfrac32$ for smoothstep), so fBm gradient is the weighted sum sharing all hash/interpolation intermediates — cost $1\times$ eval with ~2× flops; the derivative-amplification factor $\sum_i \mathrm{amp}_i\,\mathrm{freq}_i$ is stated next to any gradient-magnitude gate (it is why naive unit-gradient assumptions fail on fBm — same failure family as the creatures $\sqrt{1+s^2}$ gate bound). (b) *bake*: height+gradient to a cube-face storage atlas per the fields skill's read-count doctrine; bake texel size $\Delta$ chosen from the normal-error target: angular error $\approx \arctan(\|\nabla^2 h\|\,\Delta/2) \le \theta_{\max}$ ⇒ $\Delta \le 2\tan(\theta_{\max})/\|\nabla^2 h\|_\infty$ with $\theta_{\max}=0.5°$ and the field's own curvature bound — formula in the reference, number computed from it.
Parity: the current harness compares `planetFields()` to itself (`tslMirror` is the same CPU function; the "TSL" contract is an uncompiled string). Replace with executed-TSL readback parity through §2.1's harness, tolerances by §1.2 (planet fields are fBm-family channels ⇒ same $\varepsilon$ machinery; if the planet bundle still uses transcendental hashing at execution time, it inherits §1.1's integer-hash doctrine first).

**Gates & mutation.** G1 evaluations per gradient query == 1 (instrumented counter in the capture artifact). G2 executed parity per §2.1's gate form. **M1:** re-introduce one central-difference tap ⇒ G1 FAILs. **M2:** perturb a TSL-side constant ⇒ G2 FAILs.

**Files.** `examples/*/altitude-detail.js`, `examples/*/validate-planet.mjs`, gradient reference section.

### 2.9 W-I · cross-cutting `getWaterHeight(x,z,t)` — the coupling contract (ledger 3.14)

**Contract.** Every water owner exposes a CPU-evaluable $h_w(x,z,t)$ derived from the *same authored causes* as its GPU field, with a **stated truncation bound**; consumers (creatures swimmer buoyancy, gate $<0.09$ world units) inject it; hot-path GPU readback remains forbidden pack-wide. This is the template for all future physics coupling (the one salvageable idea from the deleted game-layer draft, now with math).

**Spectral ocean (truncated sum).** Sort bins by amplitude $a_i$; keep top $M$. Worst-case (coherent) truncation error $E_{\text{max}}(M) = \sum_{i>M} a_i$; RMS error $E_{\text{rms}}(M) = \sqrt{\tfrac12\sum_{i>M} a_i^2}$. Choose $M$ minimal s.t. $E_{\text{max}}(M) \le \tfrac13 \cdot 0.09 = 0.03$ world units (⅓ of the downstream buoyancy gate, so the coupling consumes at most a third of the consumer's error budget — allocation stated, not implied). Both $E$ curves are computed at author time from the seeded spectrum (prefix sums, $O(N^2)$ bins sorted once) and embedded in the artifact; the validator additionally measures actual CPU-vs-GPU-readback error on a probe grid (validation-time readback only) and asserts it $\le E_{\text{max}}(M) + \varepsilon_{\text{fp}}$. Phase consistency requires the CPU sum to use the §2.5.1 dispersion — hence the §2.5-before-§2.9 ordering.

**Water-optics (analytic waves).** The authored closed-form sum is exported directly; parity is exact by construction up to f32 (state $\varepsilon = O(\gamma_n)$ per §1.2 machinery).

**Gates & mutation.** G1 measured probe-grid error $\le$ stated bound. G2 the two skills' SKILL.mds + creatures reference + router fauna recipe all cite the same contract symbol (link check). **M1:** drop the highest-amplitude bin from the CPU sum ⇒ G1 FAILs.

**Files.** `threejs-spectral-ocean/examples/webgpu-fft-ocean/cpu-water-height.js(new)` + SKILL.md/reference; `threejs-water-optics` analytic module + SKILL.md; cross-links in creatures reference and §2.4's recipe.

### 2.10 W-J · `threejs-visual-validation` — budgets that can fail; golden regression (ledger 3.10)

**Contract.** `frameBudgetMs`/`memoryBudgetMB` are enforced: measured median > budget ⇒ FAIL; `gpuTimingUnavailable` ⇒ explicit `SKIPPED` that gate-mode treats as failure (a fixture that cannot fail is not evidence — §0 falsifiability). Golden pixel regression implements the already-declared `perViewPixelDiff`: per-view max-channel diff and diff-pixel fraction vs committed goldens, thresholds in the contract JSON; goldens refresh only through the dual-judge visual protocol. Adds the creature-mechanism evidence section (SDF snap residual, stance drift by named space, candidate-vs-full sweep, silhouette-vs-shadow) so the creatures↔validation routing loop closes on a defined artifact schema (consumed later by the Wave B lab, §3).

**Gates & mutation.** G1 over-budget fixture FAILs. G2 golden diff on a perturbed render FAILs; identical render PASSes twice (determinism prerequisite). **M1/M2** are those fixtures themselves — this task's gates are self-mutating by design.

**Files.** `examples/webgpu-validation-harness/src/{harness.js, schema/artifact-schemas.js}`, `references/graphics-validation-protocol.md`.

### 2.11 W-K · `threejs-procedural-motion-systems` — interpolation implemented, kernel dispatched (ledger 3.12)

**Verified state:** fixed-step accumulator exists (`timeline.js:43–68`); no render-state interpolation anywhere; `gpu-instance-motion.js:53` builds a real compute node but `:60` ships `dispatch:` as a descriptor string the demo never executes. Decision: implement (creatures' fixed-step doctrine leans on this scaffold).

**Contract & error bound.** Render state $\mathbf x_r = \mathrm{lerp}(\mathbf x_{n-1}, \mathbf x_n, \alpha)$, $\alpha = \text{acc}/\Delta t$. Interpolation error $\le \tfrac18 \Delta t^2 \max\|\ddot{\mathbf x}\|$ (standard linear-interpolant bound at midpoint), at the cost of one fixed step of latency — both stated in SKILL.md where the doctrine is claimed (the doc currently claims the mechanism without the tradeoff; a reviewer should find the latency admitted). The compute kernel is dispatched once per fixed step with real state writes.

**Gates & mutation.** G1 presented pose varies with $\alpha$ between fixed steps (validator samples two presentation frames inside one fixed step, asserts difference consistent with lerp). G2 storage state changes across dispatches. **M1:** freeze $\alpha$ ⇒ G1 FAILs. **M2:** skip the dispatch ⇒ G2 FAILs.

**Files.** `examples/webgpu-procedural-timelines/{timeline.js, gpu-instance-motion.js, main.js, validation.js}`, `SKILL.md:29–31`.

### 2.12 W-L · `threejs-procedural-creatures` — Wave A closures with a truncation certificate (ledger 3.9 a–d, f)

**(a) K-subset status, formalized.** The body field is the *sequential* fold $d = \mathrm{smin}_k(\dots \mathrm{smin}_k(d_1,d_2)\dots,d_P)$. Two prior facts (settled, §0 blacklist): pairwise $\mathrm{smin}_k(a,b) \in [\min(a,b) - k/4,\ \min(a,b)]$ (the deviation term $-k\,h(1-h)$ peaks at $k/4$), and the mix-form gradient is exact in the unclamped interior. New required statements:
1. **Fold bound:** by induction over the fold, $d \in [\min_i d_i - (P{-}1)k/4,\ \min_i d_i]$ — order affects where in that band the fold lands, so *order is part of the authored spec* (write order (b) below is not a style choice).
2. **Truncation is an approximation with no a-priori theorem:** rest-AABB adjacency bounds which primitives *can* interact at rest; pose deformation and unsaturated tails (any $j$ with $|d_j - x| < k$ at some fold step contributes) void it as a proof. The only *empirical* bound is the full-field-vs-candidate locomotion sweep; policy on sweep failure: reject spec / raise $K$ / per-vertex dynamic fallback, plus adjacency padding by locomotion excursion radius.
3. **A posteriori certificate (new, makes the gate cheap and pointwise):** exclusion of $j$ is *exact* at $\mathbf p$ if $d_j(\mathbf p) \ge x^\ast(\mathbf p) + k$ where $x^\ast$ is the computed candidate fold — because the pairwise smin saturates ($h \in \{0,1\}$) and returns $x^\ast$ unchanged. A conservative lower bound $\underline d_j(\mathbf p) = \mathrm{dist}(\mathbf p, \mathrm{caps}(j)) $ from each excluded primitive's posed bounding capsule gives the runtime certificate
$$\min_{j \notin K} \underline d_j(\mathbf p) \ \ge\ x^\ast(\mathbf p) + k \quad\Longrightarrow\quad \text{truncation exact at } \mathbf p,$$
evaluable in $O(P)$ cheap distance-to-capsule ops with **zero** full evaluations. The doc specifies it as the recommended per-frame spot-gate (sampled shell points), with the sweep remaining the distributional gate. This upgrades "the sweep is the only bound" to "sweep for distribution + certificate for the points we actually shipped this frame."
**(b)** Rope-verlet → SoA `a.xyz|b.xyz` slot write order per fixed step relative to squash/yaw/IK; CPU cost identity `substeps × relaxationPasses × segments`.
**(c)** World-planted-foot → body-frame IK → creature-local SoA → storage upload → culling-bounds pipeline (kills the double-applied-root-transform failure mode, which is otherwise invisible until crowds jitter).
**(d)** Stance-drift thresholds named by space: sim-step local $10^{-9}$/step vs world marker $10^{-4}$ vs platform-relative $10^{-4}$ — three different quantities, three names, no shared symbol.
**(f)** `agents/openai.yaml` expanded from the 4-line stub (pattern: a complete sibling's agent file).

**Gates.** Doc-only wave: gates are the §0 three-bucket audit on the touched reference + blacklist compliance (no reopened settled math). The executable versions of (a)–(d) land with the Wave B lab (§3).

**Files.** `references/creature-body-systems.md`, `SKILL.md`, `agents/openai.yaml`.

### 2.13 W-M · `threejs-compatibility-fallbacks` — creatures loss row (ledger 3.13)

`canonical-loss-ledger.md` gains the `procedural-creatures` row: per fallback tier, SDF snap / storage-pose instancing / planted gait each marked preserved / weakened / removed, with the weakened cases quantified (e.g. snap disabled ⇒ silhouette error up to the snap clamp $2r_{\max}$ — reuse §2.2's silhouette language).

### 2.14 W-N · `threejs-procedural-vegetation` — draw-budget reconciliation (P0.3(b) verdict)

If the per-patch `InstancedMesh` worst case (~grid² draws) exceeds the 8–24 table: either batch patches (design change) or re-derive the table with the worst case shown (honesty change) — decided by the P0.3(b) count, not by preference. Add the creatures-composition note (shared wind field sampling, trampling API surface).

### 2.15 FINAL — closing sweep

Contamination grep still zero (`islands|clicker|zoopark|production-proven`); three-bucket audit over every touched reference; **every validator in Appendix B run in sequence with the pass/fail table + mutation-check evidence committed into `HANDOFF.md` §6**; every ledger item retagged `[FIXED <hash>]` or explicitly deferred with reason; `GROK_BUILD_PROBLEMS.v1-15k.md` deletion proposed for owner approval (not unilateral). Durable citations by section + invariant.

---

## 3. Deferred: creatures Wave B lab (separate plan, gated on §2.1/§2.2/§2.3)

`examples/webgpu-procedural-creature-lab/` with the 15-gate `npm run validate`: seeded spec-driven creatures, scripted locomotion sweep, artifacts for SDF snap residual (Newton step), candidate-vs-full sweep **plus the §2.12(a) certificate sampled per frame**, stance drift in all three named spaces, silhouette-vs-shadow via §2.2's recipe, storage-pose determinism (seed sweep), squash volume conservation, rope SoA ordering, swim handoff via §2.9. Deferred because its gates *are* consumers of the composition spine — building it first would gate against stubs.

## 4. Composition proof obligations (the plan's actual point)

The pack's systemic diagnosis is doctrine ≫ implementation on every composition edge. Three edges get *executed* proofs in this plan:
1. **clouds → image-pipeline** (§2.6 imports §2.3's helper + $\tau_z$): one scene, one scene pass, single tone-map owner, both skills' validators run against the same capture.
2. **displaced surface → shadows** (§2.2): one displacement `Fn`, two wirings, silhouette/footprint gate.
3. **water → creatures** (§2.9): CPU/GPU same-cause sampler with budgeted truncation error.
Remaining edges (creatures→TRAA per-instance history; fields→planets parity chain) are contract-specified here (§2.3, §2.8) and get executed proofs in the Wave B plan.

## 5. Execution mechanics, order, and risks

Mechanics: codex/gpt-5.5 delegation with the Appendix A packet; orchestrator re-derives all math per diff; dual codex+grok judging on visual artifacts; one commit per work item (conventional + unique joke ending with the https://devme.me/ plug; no AI trailers); ledger retag rides each commit; quota-failure ⇒ inline fallback with identical discipline.
Order: P0 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9 → 2.10 → 2.11 → 2.12 → 2.13/2.14 → FINAL. Parallel pairs (disjoint dirs): {2.1, 2.2}, {2.4, 2.5}, {2.7, 2.8}, {2.10, 2.12}. Hard edges: 2.3 ≺ 2.6; 2.5 ≺ 2.9; 2.1 harness ≺ 2.8.
Risks (register): headless-WebGPU availability (P0.1 decides headed/headless); `computeAsync` array shape (P0.4, fallback stated §2.5.2); f32 parity flakiness (eliminated by design via §1.1 integer hashing, not tolerated); sky multi-scatter scope creep (bounded to the $1/(1-a)$-gated minimal LUT); codex overreach (packet whitelists files; orchestrator reviews full diff); session death (per-task commits are the resume points).

## Appendix A — codex packet template

```
GOAL: <task §-reference + one sentence>.
REPO: /Users/linegel/_reps/threejs (three r185; WebGPURenderer + TSL; no new dependencies).
FILES TO MODIFY: <whitelist, absolute paths>. FILES NOT TO TOUCH: everything else; specifically the
  HANDOFF §4 settled math (ocean Jacobian det, Hermitian seeding, smin gradient, capsule gradient,
  Newton /|∇d|² step).
SPEC & MATH (self-contained, restated in full): <the task's Contract + Derivations verbatim>.
API FACTS (P0.4-verified, do not re-guess): <the subset this task needs>.
NUMERIC RULES: every constant Derived (derivation in comment/reference) or Gated (named validator);
  integer-hash doctrine (§1.1) applies to any parity-bearing randomness.
ACCEPTANCE: <validator command(s)> exit 0; <mutation check> exits nonzero; report the outputs you saw.
OUTPUT: file-by-file diff summary; validator output verbatim; every assumption flagged loudly.
```
Launch: `codex exec -s workspace-write -C /Users/linegel/_reps/threejs -c model_reasoning_effort=high -o <scratchpad>/codex-<task>.md "<packet>"`, background, unique output file, never orphaned.

## Appendix B — gate inventory (all runnable green at FINAL, each with demonstrated FAIL)

| § | Gate (inequality / assertion) | Constant provenance | Mutation that must FAIL |
|---|---|---|---|
| 2.1 | $\max_c\|F_{CPU}-F_{GPU}\| \le 10^{-4}$; bit-identical reruns | §1.1–1.2 derivation | TSL-only hash perturbation; one-sided seed change |
| 2.2 | depth draws > 0; level variance > 0; silhouette Δ outside 2-texel band = 0; dirty-set exactness | raster quantization argument §2.2 | stubbed renderShadow; undisplaced caster; frozen fieldTime |
| 2.3 | live-graph scene passes == 1; helper sign test within $2u$ | graph walk; synthetic-matrix test | duplicate-pass fixture; negated velocity |
| 2.4 | $\sum h_i \le B{-}B_{\text{res}}$ certified / $\sum l_i$ infeasible verdicts | interval arithmetic §2.4 | inflated tier upper bound |
| 2.5 | dispersion limit tests; submissions ≤ 3; $\max\|\mathrm{Im}\,h\| < 10^{-4}h_{rms}$ | Lamb §267; §1.5 | dropped $\beta k^3$; per-node awaits; broken-evolve fixture |
| 2.6 | step-product == tier row; $T\in(0,1]$ monotone; disocclusion mask sane | §1.6; Beer–Lambert | hardcoded 320; same-UV history |
| 2.7 | $T$ gates; Rayleigh column within quadrature bound; MS ≤ $1/(1-a)$ | trapezoid error bound §2.7 | dropped altitude term; dual transform owners |
| 2.8 | evals/gradient == 1; executed parity | §2.8 derivative/bake bounds | reintroduced FD tap; perturbed constant |
| 2.9 | probe error ≤ $E_{\max}(M)$, $E_{\max} \le 0.03$ | truncation bound §2.9 | dropped dominant bin |
| 2.10 | over-budget FAIL; golden diff FAIL/PASS pair | contract JSON | (self-mutating fixtures) |
| 2.11 | pose varies with α; state changes across dispatches | lerp bound §2.11 | frozen α; skipped dispatch |
| 2.12 | three-bucket audit clean; blacklist intact | §0 | (doc wave) |

*Ledger cross-reference: 2.1↔3.1, 2.2↔3.2, 2.3↔3.11+W1, 2.4↔3.3, 2.5↔3.5, 2.6↔3.6, 2.7↔3.7, 2.8↔3.8, 2.9↔3.14, 2.10↔3.10, 2.11↔3.12, 2.12↔3.9, 2.13↔3.13, 2.14↔veg[A], P0.2↔3.4.*
