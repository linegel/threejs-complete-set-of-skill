# Website improvement pass - 2026-09-24

## Active order: skills before labs

The September 24 owner instruction supersedes the earlier lab-first checklist.
Work through the 27 authoritative `skills/` packages in roster order, one at a
time. For each, read its entrypoint and reachable guidance, correct concrete
defects, run source/distribution and relevant executable checks, and record
what was actually verified. Do not infer skill correctness from lab badges.
Only after this skill pass proceed to labs, visualisations, and recreations.

The already-started Object Sculptor inspector repair is browser-checked in its
own source unit. Generated publication stays separate from the skill commits.
Interruption-safe image publication is also deferred to the later website/lab
phase. No branch or worktree is created. Linear searches for `threejs` and
`Three.js` found no matching project issue; the latter returned only WAR DOGS.
Use this existing repository plan rather than an unrelated game ticket.

### Skill sequence

1. [x] `threejs-choose-skills` — source/reference pass; 12 regression checks.
2. [x] `threejs-debugging` — source/reference pass; publication uncertainty preserved.
3. [x] `threejs-visual-validation` — source/reference/helper pass; 17 new checks.
4. [x] `threejs-compatibility-fallbacks` — source/reference pass; backend and renderer-stack boundaries corrected.
5. [x] `threejs-camera-controls-and-rigs` — source/reference pass; nine new numerical/control checks.
6. [x] `threejs-scalable-real-time-shadows` — source/reference pass; five new math/API checks.
7. [x] `threejs-ambient-contact-shading` — source/reference pass; seven new math/API/lifecycle checks.
8. [x] `threejs-bloom` — source/reference pass; seven new blend/math/API checks.
9. [x] `threejs-exposure-color-grading` — source/reference/example pass; ten new meter/math/LUT checks.
10. [x] `threejs-image-pipeline` — source/reference/example pass; eight new graph/transaction checks.
11. [x] `threejs-sky-atmosphere-and-haze` — source/reference pass; eight transport/domain checks.
12. [x] `threejs-volumetric-clouds` — source/reference pass; ten transport/skip/history checks.
13. [ ] `threejs-spectral-ocean`
14. [ ] `threejs-water-optics`
15. [ ] `threejs-rain-snow-and-wet-surfaces`
16. [ ] `threejs-procedural-fields`
17. [ ] `threejs-procedural-materials`
18. [ ] `threejs-procedural-geometry`
19. [ ] `threejs-object-sculptor`
20. [ ] `threejs-procedural-buildings-and-cities`
21. [ ] `threejs-procedural-planets`
22. [ ] `threejs-procedural-vegetation`
23. [ ] `threejs-procedural-creatures`
24. [ ] `threejs-procedural-motion-systems`
25. [ ] `threejs-particles-trails-and-effects`
26. [ ] `threejs-dynamic-surface-effects`
27. [ ] `threejs-black-holes-and-space-effects`

### Skill 1 result: threejs-choose-skills

Observed defect: the projected-error reference uses nominal FOV/orthographic
span, omitting camera zoom and cropped-view scale. Preserve its cause-first
routing, one output owner, and fallback-only-on-request boundary. Use the
actual unjittered projection matrix; test the documented equations against
Three.js 0.185.1 perspective and orthographic projection, including zoom,
view offsets, depth perturbation, and near-plane restrictions. No rendering
lab source or capture is part of this unit.

All four router references, entrypoint, interface metadata, and generated article were read. The reference now uses actual projection-matrix scales, a finite paired-point depth-error equation, and explicit clipping/panorama limits. Twelve checks pass against pinned Three.js 0.185.1, including zoom/crop underestimation, finite depth changes, exact destination coverage, and a 50px interior-error counterexample with unchanged outer bounds. Distribution validation passes for all 27 packages. Near-plane restrictions were reviewed, not GPU-rendered. The existing article links this reference on main rather than embedding it, so no generated lab/site output is part of this change. Logs: `artifacts/website-improvement-20260924/continuation/skills-router-{before,after}.log`.

### Skill 2 result: threejs-debugging

Read the entrypoint, upstream reference, and interface metadata. Fixed the ambiguous `fixed-unreleased` classification: unverified publication stays insufficient evidence. Added check-time/package-integrity requirements and kept unknown/not-run values in the current-version matrix. Reviewed three distinct cases: merged fix with unavailable publication evidence, checked unshipped fix, and published fix passing the same reproduction. Tag ancestry alone is not shipped-code proof. The packaging validator and existing 12 numeric/router tests pass; no upstream bug or GPU behavior is claimed fixed by this guidance correction. Log: `artifacts/website-improvement-20260924/continuation/skills-debugging-check.log`. Generated article publication remains part of the source-to-site reconciliation after the sequential skill pass; inherited lab outputs remain untouched.

### Skill 3 result: threejs-visual-validation

Read the entrypoint, protocol, actual aligned-readback helper, and interface metadata. Corrected blanket sRGB tagging, specified the helper's uncompressed single-layer padded-copy scope and raw-byte output, separated CPU-only claims from renderer-dependent proof, and required fresh scoped timing samples with bounded query collection. The installed HDR loader, color management, and both timestamp-pool source files were inspected. Seventeen new checks cover HDR parsing, layout boundaries, larger stride, mapped-view/copy offsets, minimal last-row bytes, invalid/overflowing layouts, independent output bytes, and half-float preservation. All 29 skill tests and distribution validation pass. The decoder itself was already correct for its declared scope and remains unchanged. Timestamp safeguards are source-reviewed guidance, not newly measured GPU results. Logs: `artifacts/website-improvement-20260924/continuation/skills-visual-validation-{before,after}.log`.

### Skill 4 result: threejs-compatibility-fallbacks

Read both references, entrypoint and interface metadata, then the installed WebGPURenderer constructor, standard material library, and WebGLBackend initialization. Activation now distinguishes positively identified fallback, capability-related initialization failure, missing identity, and unrelated application failure; explicit user authorization remains mandatory. The guidance separates the node renderer's WebGL backend from classic WebGLRenderer/ShaderMaterial/EffectComposer, including their different timing APIs and resource ownership. No fallback renderer was activated or lab converted. Distribution validation and the existing 29 checks pass; source/API review is not rendered fallback parity. Log: `artifacts/website-improvement-20260924/continuation/skills-compatibility-check.log`.

### Skill 5 result: threejs-camera-controls-and-rigs

Read the complete skill/reference/interface and installed OrbitControls, PointerLockControls, TRAA and TAAU implementations. Corrected parent-transform admission, constructor/handoff ordering, roll and limit compatibility, reset-state preservation, zero-duration cuts, and owned DOM/held-input cleanup. The r185 cursor-coordinate and held-Control disposal defects are explicit pinned adapter requirements, not claims that the dependency was patched. Nine new checks reproduce constructor mutation, roll removal, limit clamping, inverse-parent shear, zero-duration NaN, shifted projection matching, cursor-coordinate misuse, and listener/style cleanup with an event-host fixture. The corrected compatible handoff preserves pose and projection. All 38 skill checks and distribution validation pass; no browser, GPU, pointer-lock, or lab acceptance is claimed by these CPU/source tests. Logs: `artifacts/website-improvement-20260924/continuation/skills-camera-{before,after}.log`. Concurrent inspector/source publication through 8028e134 is retained and is not part of this skill unit.

### Skill 6 result: threejs-scalable-real-time-shadows

Read the skill/reference/interface and installed LightShadow, ShadowNode, CSMShadowNode, TileShadowNode, shadow filters, and conditional-node implementations. Corrected level sizing below the finest footprint, degenerate fades, publication of superseded cache work, sampling-domain/VSM invalidation after filter changes, and conditional-versus-eager receiver cost accounting. Five new checks cover level count, fade admission, late-content guidance, real clone omissions, real multi-camera throttling, and per-tap static/dynamic union. All 43 skill tests and distribution validation pass. The existing reversed-Tile and other rejected GPU configurations remain rejected; no engine patch, actual cache rendering, generated GPU shader profile, or target timing is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-shadows-{before,after}.log`.

### Skill 7 result: threejs-ambient-contact-shading

Read the complete skill/reference/interface and installed GTAO, Denoise, RTT and AO-context source, plus base-node disposal. Corrected final-image versus scene-linear invariance, admitted the default graph only for its supported perspective/non-logarithmic depth path, added per-view/positive-extent checks, replaced unconditional stock denoising with an explicitly validated optional reconstruction contract, and supplied the actual index/rotation correction. Noise and RTT target/material teardown now has explicit ownership. Seven tests cover radiance invariance, orthographic direction, denoiser math, zero-sized AO, real disposal omissions, and real opaque/transparent AO-context behavior. All 50 skill tests and distribution validation pass. No shader compilation, GPU resource plateau, corrected dependency renderer, or lab acceptance is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-ambient-{before,after}.log`.

### Skill 8 result: threejs-bloom

Read the skill/reference/interface and installed BloomNode, MRTNode, RenderOutputNode, alpha helpers, SpriteNodeMaterial, relevant NodeMaterial output/lighting, and WebGPU blending source. Corrected the emitter's double premultiplication and supplied alpha-aware contribution RGBA, distinguished ordered alpha-over from additive invariance, inverted nonlinear knee endpoints, admitted finite kernel controls, and documented non-idempotent setup replacement. Existing minimum-mip/storage equations and normal disposal were retained. Seven checks cover real blend factors, merge loss, allocated mip dimensions, repeated material growth, endpoint math, ordering, and all 18 owned disposal events. All 57 skill tests and distribution validation pass. No transparent GPU capture, custom shader compilation, runtime engine patch, or lab acceptance is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-bloom-{before,after}.log`.

### Skill 9 result: threejs-exposure-color-grading

Read the skill/reference/interface, executable identity LUT, and installed LUT, tone-mapping, and 3D-texture implementations. Corrected small-weight normalization, pre-arithmetic validity masking, reduction fan-in, histogram boundary/overflow rules, shared-view source ownership, calibration compensation, finite adaptation, and superseded-epoch publication. Normalization conversions now include dependent EV bounds. The identity LUT now checks safe arithmetic, caller dimension limits, and byte budget before allocation and declares its RGBA8 quantization error; existing voxel order, filtering, and alpha-safe placement remain. Ten tests cover those equations, actual allocation rejection, voxel data, quantization, and half-texel mapping. All 67 skill tests and distribution validation pass. No GPU meter dispatch, LUT shader compilation/capture, resource plateau, or lab acceptance is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-exposure-{before,after}.log`.

### Skill 10 result: threejs-image-pipeline

Read the complete skill/reference/rebuild example/interface and installed TRAA, RenderPipeline, and PassNode implementations. The executable helper now validates inputs and synchronous output, preserves tuned public settings, and returns an ownership-checked rollback without prematurely disposing either generation. Corrected named-attachment allocation order, transparent-layer exclusion, alpha-aware contribution/output contracts, logical versus physical traffic, bounded timing, failure-state restoration, and stock jitter/first-use/border limitations. Eight tests cover failed composition, invalid output, settings retention, rollback ownership, cropped camera state, render-target ownership, actual MRT allocation, and failed compile restoration. All 75 skill tests and distribution validation pass. No GPU shader compile, first-frame reset rendering, output capture, or lab acceptance is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-image-pipeline-{before,after}.log`.

### Skill 11 result: threejs-sky-atmosphere-and-haze

Read both references, entrypoint, and interface metadata. Corrected opaque-body truncation (no visible far-side interval), reversed shell/post error weighting, scaled-ray parameter ownership, top-boundary LUT degeneracy and cancellation, zero-curvature depth spacing, ordered optical-depth differences, attenuation-aware cumulative inscattering, and superseded product publication. Eight mathematical checks reproduce these counterexamples and retain the original unit-equivalence fixture. All 83 skill tests and distribution validation pass. These are numerical/domain checks, not a GPU transport solve, new phase/energy convergence result, sky capture, or lab acceptance. Logs: `artifacts/website-improvement-20260924/continuation/skills-atmosphere-{before,after}.log`.

### Skill 12 result: threejs-volumetric-clouds

Read all three references, entrypoint, and interface metadata. Corrected the zero-limit criterion and stable optical transfer, continuous majorant requirements, background-inclusive accumulated skip/tail error, parallel-axis DDA handling, finite-disc attenuation, overlapping-media composition, shadow epoch admission, small-opacity moments, invalid-history arithmetic, and interval-correct foreground upsampling. Ten checks demonstrate the affected counterexamples and preserve homogeneous step-partition invariance. Floating-point comparisons use explicit tolerances rather than bit equality. All 93 skill tests and distribution validation pass. No GPU volume render, light solve, moving-history capture, causal precipitation simulation, or lab acceptance is claimed. Logs: `artifacts/website-improvement-20260924/continuation/skills-clouds-{before,after}.log`.

### Current skill: threejs-spectral-ocean

Next in the roster; read its entrypoint and reachable resources before changes. All labs and recreations remain deferred.


## Finished and verified
- Repaired responsive image publication and manifest consistency.
- Reuse binds source bytes, encoder settings/versions, URLs, dimensions, and output hashes.
- Current publication: 191 PNG sources and 382 AVIF/WebP variants. The earlier 603-file decode covers the retained unchanged image files; stale Frost media is withheld.
- Cold migration: 290 sources in 524.55 seconds; unchanged current build: 0.207 seconds.
- Confirmed unchanged manifest bytes and image modification times on repeat generation.
- Browser: 129 surfaces at 1440, 390, and 320px; all 402 variants decoded in Chromium.
- Reconciled 40 evidence reports and retired preview owners during normal builds.
- Withheld outdated capture summaries without changing canonical source evidence.
- Restored article crops; current publication contains 48 crops for 16 skills after stale evidence withholding. Complete presentation and SEO checks pass.
- Raised evidence labels to 12px; resolved narrow-layout overflow with wrapping.
- Archived 88 unreferenced variants with hashes; original PNGs remain published.
- Fixed preflight import crash; 10 tests pass on Node 22.22.0 and 26.4.0.
- Pinned toolchain preflight, full site build, source hashes, and skill distribution pass.
- Full pinned lab unit suite: 211/211 passing. The five inherited failing tests are resolved by af24decc; publication tests and inspector route tests also pass.

## Deferred / boundaries
- Atomic output publication and resumable checkpoints were proposed, but tool edits
  were rejected. They were NOT implemented; the existing verified encoder was retained.
- Static browser/image checks do not establish native GPU rendering or timing correctness.
- Preserve unrelated capture staging, backups, bisect files, and all other agents' work.
- Owned browser contexts and preview servers close in finally blocks.

## Recorded defects and remaining work
1. Resolved in af24decc: tests/labs/capture-contract.test.mjs distinguishes optional favicon probes from declared missing SVG assets.
2. Resolved in af24decc: tests/labs/capture-wiring.test.mjs now passes the corrected Weathered World hook and Frost profile forwarding.
3. Resolved in af24decc: tests/labs/demo-roadmap.test.mjs and the roadmap retain individual unfinished proofs without inventing open work for accepted tiers.
4. Resolved in af24decc: tests/labs/runtime-evidence-preview.test.mjs verifies partial and contradictory identity observations; unobserved initialization remains unproven.
5. Bootstrap publication is repaired in 86578372. Remaining: the compatibility harness scenario URL is unresolved at build time, large chunks require measurement, and interruption-safe image generation remains deferred by the active skill order.

## Evidence files
- image-verification.json: full decode, hashes, bytes, no-rewrite benchmark.
- browser-report.json and screenshots: every evidence report plus core site surfaces.
- validation-final.log, full-build-final.log, preflight-pinned.log.
- unit-tests-pinned.log: historical five-failure baseline; continuation/all-tests-final.log records 211 passing tests.
- obsolete-variants.json: recoverable paths and hashes for archived generated variants.
- obsolete-responsive-archive/: archived bytes, not deleted original evidence.

## Commits
- ae403366: responsive delivery, evidence publication, generated outputs, and layout repair.
- bed34f1f: filesystem permission constant compatibility and real permission regression.
- 43abcf0b: evidence publication date; local HEAD and origin/main verified identical.
- af24decc and 86578372: capture/proof correctness and synchronous bootstrap delivery.
- d570997b and 8028e134: inspector source repair and complete generated publication.
- This unit releases its ownership after its final documentation commit; parallel skill work remains independent.

## Continuation scope and decisions
The active repository is the Three.js developer skill pack, not a game database.
The September 24 prompt changes execution and inspection rules without naming a
replacement project. Keep the existing developer audience and source contracts.
The shared September 24 tool-utility decision removes feature quotas; no game
extraction, accounts, localization, or game-specific tools are invented here.
Linear search for threejs returned no matching issue or project. Work follows
this promoted existing plan. Evidence filenames above are relative to
artifacts/website-improvement-20260924/. That directory is already gitignored.
Browser inspection uses the isolated browser MCP launcher. Plugin discovery found
no cloud Browser connector. Existing screenshots remain valid for unchanged pages.

## Ordered finalization plan
Status: complete means delivered and recorded; pending means not yet established.
1. [x] Reconcile repository identity and owner instructions with current chat.
2. [x] Read existing finalization evidence instead of repeating the prior audit.
3. [x] Preserve unrelated untracked capture staging and bisect files.
4. [x] Repair typography on catalog and guides (03eec1a0).
5. [x] Repair skill navigation spacing (38639997).
6. [x] Restore current responsive variants and byte-bound reuse (ae403366).
7. [x] Reconcile current evidence reports and stale preview owners (ae403366).
8. [x] Restore article crop inventory and metadata (ae403366).
9. [x] Repair evidence text sizes and narrow overflow (ae403366).
10. [x] Fix preflight imports and executable-permission checks (bed34f1f).
11. [x] Refresh evidence publication date (43abcf0b).
12. [x] Reproduce the five remaining tests on the pinned toolchain.
13. [x] Trace favicon failure handling and preserve legitimate error reporting.
14. [x] Resolve capture-hook detection using the actual configured paths.
15. [x] Verify Frost profile forwarding without changing its runtime contract.
16. [x] Correct stale roster assertions without weakening capture checks.
17. [x] Derive roadmap expectations from declared open fields and accepted tiers.
18. [x] Verify accepted labels cannot invent missing current-adapter timing proof.
19. [x] Preserve unknown/false backend identity and initialization facts.
20. [x] Test partial, contradictory, and complete runtime-proof records.
21. [x] Commit and push the finished capture/evidence correction (af24decc).
22. [x] Reproduce object-sculptor bootstrap loading in isolated browser MCP.
23. [x] Repair its source-owned bundling without removing controls or routes.
24. [x] Exercise object selection, diagnostics, reload, and history restoration.
25. [x] Inspect affected desktop layouts at 1024, 1280, 1440, and 1728px.
26. [x] Inspect affected non-map layouts at 390 and 768px after desktop passes.
27. [x] Capture console/network observations for each affected browser load.
28. [x] Commit and push the finished browser-path correction (d570997b, 8028e134).
29. [ ] Add interruption-safe image publication using existing encoder helpers.
30. [ ] Verify resumed generation reuses finished work and repairs partial output.
31. [ ] Verify corrupt cache records cannot suppress reconstruction.
32. [ ] Preserve existing encoding settings, source PNGs, and visual results.
33. [ ] Commit and push the finished image-generator correction.
34. [x] Current repair: 211 pinned lab tests and source/distribution checks pass; repeat after later phases.
35. [x] Current repair: full committed-source site build published in 8028e134; repeat after later phases.
36. [ ] Inspect emitted size warnings and identify actual user-facing bottlenecks.
37. [ ] Exercise the affected rendering paths with truthful backend observations.
38. [ ] Repair further directly observed defects; retain unmeasured GPU limits.
39. [x] Stop owned MCP/server and remove 6,621,675,111 bytes of owned test/build staging.
40. [ ] Complete project-wide sign-off after the remaining skill, runtime, image, and performance phases. This repair has a current record and pushed commits.

## What to test: capture/evidence correction
The first unit changes diagnostics and capture configuration, not visual layout.
Reproduce recorded failures with focused tests; distinguish stale assertions from
runtime defects. Preserve earlier image/layout evidence. For a user-facing change,
inspect the affected rendered demo through browser MCP before reporting it fixed.

## Capture/evidence correction results
Pinned root unit suite: 208/208 pass; focused changed suite: 47/47 pass.
The Weathered World hook path now resolves from its npm package directory. Frost
forwards correctness/performance and output arguments; performance records cannot
pass through its correctness-only finalizer. A declared SVG failure remains fatal.
The roadmap reads each declared proof even when overall status says accepted; it
does not invent open work for accepted tiers. Backend names no longer imply device
initialization, explicit false observations survive, and the final snapshot wins.

Browser observation: the creature demo's opened documentation drawer displays its
four remaining proof records, including current-adapter timestamps. The same load
reported zero console errors and failed network requests. The screenshot still
shows shader compilation behind the drawer, so it establishes the drawer result,
not completed creature rendering. Its undersized shared labels join the inspector
readability repair. The object-sculptor baseline shows a rendered bonsai but a 404
for its classic bootstrap script, truncated metric values, and labels below 12px.

Full site build passes. Changing Frost's capture source invalidates its prior
promoted preview binding; the builder withholds those images rather than relabeling
old evidence. Current publication has 191 preview sources and 48 article crops.
This is not new Frost render or performance acceptance. Original PNGs remain intact.

## What to test: published scripts and inspector readability
The object-sculptor entry must keep its synchronous head bootstrap and exact source
bytes. Converting it to a module would break document.currentScript and observer
installation order, so publication will copy classic scripts through Vite's public
asset path with content-based names. Module scripts retain the normal bundler path.

The inspector keeps all existing subject/mode/tier/camera behavior and diagnostic
facts. Labels use at least 12px; values wrap rather than truncate. Metric geometry
must leave no partial final row. Small-screen controls remain reachable without
covering the entire object. The shared evidence drawer receives the same type floor.
Check desktop widths 1024, 1280, 1440, and 1728 before 390/768. Exercise subject and
mode changes, camera control, keyboard input, reload, history, hover details, and
same-load console/network output. Earlier image-cache evidence remains unchanged.

## Classic script publication result
The builder now preserves synchronous classic scripts as exact, content-addressed
public assets. Five asset-publication tests pass. In isolated browser MCP the
bootstrap loads from /demos/assets/classic-02b6399d3910b7432a1f23a6cc662f9f21c5f2830335872ffca7861692a90576.js,
executes with its original correctness surface attribute, and remains capture-disabled
on the public route. Subject selection changed the rendered bonsai into the teal
hinged teapot; final mode settled with firstFrameCompleted and nativeWebGPU true.
The inspected screenshot shows the complete pot, lid, handle, and spout. The same
load has zero console warnings/errors and a successful classic-script request.
The formerly unbundled-script warning is gone. Inspector text truncation is now
resolved in d570997b; this result does not certify model fidelity or GPU timing.

## Inspector repair acceptance
The existing inspector unit preserves the procedural subjects and capture-owned
controller contract. Browser MCP inspected 1024, 1280, 1440, and 1728px before
390/768px. All four controls measure 44px; paired mode/tier centres match and the
1440px header centres both measure 57.3984375px. Inspector text is at least 12px.
The canvas reserves the inspector column; narrow layouts stack the object,
inspector, and evidence drawer without overlap or horizontal overflow.

Keyboard Home/End/Enter changes the object or camera and keeps focus on the
trigger. Escape preserves the committed mode. Pointer hover leaves keyboard
selection unchanged with exactly one popup; clicking hierarchy changes the
rendered semantic colours and URL. Back/Forward restores subject and title.
A direct URL restores all four choices; route-locked subject stays disabled.
Invalid view parameters show an unobstructed reset action, which returns to a
ready default scene. Motion/DPR details use one authored tooltip, not title bubbles.
Successful loads report no console errors or failed requests.

The object package syntax, target, route, lifecycle, and artifact tests pass; the
pinned root lab suite passes 211 tests. These checks do not establish sustained
GPU timing, canonical release acceptance, or a new physical-route capture.
Screenshots and MCP responses remain under
artifacts/website-improvement-20260924/continuation/. The active skill sequence
above remains owned by the separate skills-first session; its files are excluded.

## Publication and cleanup
8028e134 publishes the complete current committed source, including the four skill
corrections completed by the parallel session. The full build, presentation/SEO,
source hashes, and distribution checks pass. New skill edits still require their
normal later publication; no in-flight skill file entered this unit's commits.

Isolated browser MCP worker 88788 closed its tabs, transport, and port 4173. Removed
16,890 reviewed temporary files and 2,011 empty directories, including every
owned build staging tree and synthetic capture fixture under continuation/tmp.
Temporary MCP transport, schema, snapshot copies, and socket directories are also
removed. Accepted screenshots, command responses, test logs, and the cleanup
inventory remain as local verification records. Unrelated historic captures and
the parallel session's skill logs were preserved.
