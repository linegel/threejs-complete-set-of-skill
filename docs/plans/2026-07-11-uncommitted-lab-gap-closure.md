# Uncommitted Lab Gap-Closure Audit and Commit Map

Date: 2026-07-11

Authoritative dirty checkout: `/Users/linegel/_reps/threejs` at `5c2a210`

Evidence-first reconciliation clone: `/tmp/threejs-site-reconcile-merge` at `8b37cc0`

## Rules for this recovery

- Preserve every existing dirty hunk, especially the procedural-creature work. Do not reset, stash, or wholesale-checkout the tree.
- Stage only the files or exact hunks owned by one verified unit.
- Do not commit generated `docs/`, `skills.json`, or `labs/demo-registry.json` until their owning source commits have landed and the outputs have been regenerated.
- Every commit uses `type(scope): subject`, explains what and why in its body, and ends with a new repository-unique joke containing `https://devme.me/`.
- A passing source-token or browser-free test does not promote a rendering lab to accepted evidence.
- Primary rendering status remains `incomplete` until native-WebGPU execution, render-target readback, required v2 artifacts, lifecycle evidence, and claim-specific gates pass.

## Audited worktree baseline

`git status --porcelain=v1 -uall` reports 1,233 paths:

- 369 modified tracked paths.
- 103 deleted tracked paths: 102 generated demo assets plus the local ocean package lock.
- 761 untracked paths, including 33 raw lab manifests, five complete integration-lab directories, fixed route wrappers, browser/capture modules, provider assets, tests, and generated Pages files.
- Tracked diff: 472 files, 36,273 insertions, 11,698 deletions.
- Untracked payload: about 15.6 MB.

Current verification:

- Implementation matrix: 28 canonical targets and five flagships present.
- Canonical source check: 40 primary targets, zero missing source paths.
- Capture wiring: 40 primary targets structurally wired; this proves plumbing only.
- Shared tests: 42/42 pass.
- Lab unit suites: 39/40 pass.
- Mutation suites: 39/40 pass.
- Sole functional failure: `webgpu-procedural-creature-lab` bypasses the host `RenderPipeline` in canonical `renderOnce`.
- Registry generation: stale and intentionally not regenerated yet.
- Evidence acceptance: two non-rendering suites accepted; 38 rendering primaries remain incomplete.

## Complete dirty-unit inventory

Counts are modified/deleted/untracked paths. Generated publication output is listed separately from source.

| Unit | M/D/U | Review result |
| --- | ---: | --- |
| `docs/` | 166/102/109 | Obsolete generated build. Superseded by evidence-first site work; never stage from this tree. |
| `scripts/` | 4/0/2 | SEO-shell work is superseded; two Ralph/Grok loop scripts are unrelated and excluded. |
| `labs/` | 0/0/33 | Generated registry plus provider-proxy source/assets; split source assets from registry output. |
| `integration-labs/creature-habitat` | 0/0/34 | Unit/mutations pass; runtime evidence incomplete. |
| `integration-labs/final-image-flight` | 0/0/23 | Unit/mutations pass; runtime evidence incomplete. |
| `integration-labs/procedural-district` | 0/0/36 | Unit/mutations pass; runtime evidence incomplete. |
| `integration-labs/relativistic-space-shot` | 0/0/18 | Unit/mutations pass; runtime evidence incomplete. |
| `integration-labs/weathered-world` | 0/0/38 | Unit/mutations pass; runtime evidence incomplete. |
| `threejs-compatibility-fallbacks/.../browser-fallback-harness` | 0/0/25 | Unit/mutations pass; explicit-request fallback policy remains incomplete browser evidence. |
| `threejs-ambient-contact-shading/.../webgpu-node-gtao` | 5/0/17 | Unit/mutations pass; canonical capture/evidence incomplete. |
| `threejs-ambient-contact-shading/.../integration-image-pipeline-ao` | 0/0/16 | Unit/mutations pass; integration capture/evidence incomplete. |
| `threejs-bloom/.../node-selective-bloom` | 3/0/19 | Unit/mutations pass; canonical capture/evidence incomplete. |
| `threejs-camera-controls-and-rigs/.../webgpu-camera-rig` | 5/0/17 | Unit/mutations pass; canonical capture/evidence incomplete. |
| `threejs-exposure-color-grading/.../webgpu-exposure-color-pipeline` | 8/0/17 | Unit/mutations pass; native compute/readback evidence incomplete. |
| `threejs-image-pipeline/.../integration-shared-framegraph` | 3/0/0 | Contract changes pass; keep separate from canonical browser surface. |
| `threejs-image-pipeline/.../webgpu-image-pipeline` | 11/0/18 | Unit/mutations pass; canonical capture/evidence incomplete. |
| `threejs-image-pipeline/.../webgpu-temporal-history` | 0/0/3 | Thin locked-route surface; depends on canonical image-pipeline source. |
| `threejs-dynamic-surface-effects/.../webgpu-touch-history-frost` | 4/0/16 | Unit/mutations pass; storage/readback evidence incomplete. |
| `threejs-dynamic-surface-effects/.../integration-temporal-surface` | 0/0/11 | Unit/mutations pass; integration evidence incomplete. |
| `threejs-rain-snow-and-wet-surfaces/.../webgpu-rain-snow-and-wet-surfaces` | 4/0/17 | Unit/mutations pass; native weather capture incomplete. |
| `threejs-rain-snow-and-wet-surfaces/.../integration-precipitation-image-pipeline` | 0/0/11 | Unit/mutations pass; integration evidence incomplete. |
| `threejs-procedural-fields/.../webgpu-field-bake` | 9/0/14 | Unit/mutations pass; direct/baked GPU readback incomplete. |
| `threejs-procedural-geometry/.../semantic-mesh-writer` | 8/0/18 | Unit/mutations pass; indirect/native draw evidence incomplete. |
| `threejs-procedural-materials/.../tsl-procedural-pbr` | 7/0/17 | Unit/mutations pass; PBR MRT/browser evidence incomplete. |
| `threejs-procedural-buildings-and-cities/.../webgpu-material-slot-compiler` | 12/0/16 | Unit/mutations pass; native compiled-scene evidence incomplete. |
| `threejs-procedural-planets/.../webgpu-quadtree-planet` | 18/0/24 | Unit/mutations pass; compute dispatch/readback evidence incomplete. |
| `threejs-procedural-vegetation/.../webgpu-dense-grass` | 5/0/17 | Unit/mutations pass; native storage/draw evidence incomplete. |
| `threejs-procedural-vegetation/.../structured-ash-growth` | 2/0/18 | Unit/mutations pass; exact Ash CPU contract retained, browser evidence incomplete. |
| `threejs-procedural-vegetation/.../webgpu-vegetation-integration` | 0/0/10 | Unit/mutations pass; integration evidence incomplete. |
| `threejs-procedural-motion-systems/.../webgpu-procedural-timelines` | 8/0/15 | Unit/mutations pass; native compute/readback evidence incomplete. |
| `threejs-procedural-creatures/.../webgpu-procedural-creature-lab` | 21/0/19 | Blocked by host-pipeline ownership failure; user-owned work must be split carefully. |
| `threejs-particles-trails-and-effects/.../webgpu-pooled-effects` | 5/0/21 | Unit/mutations pass; native compaction/indirect evidence incomplete. |
| `threejs-black-holes-and-space-effects/.../tsl-curved-ray` | 10/0/21 | Unit/mutations pass; temporal fixture explicitly not claimed; GPU evidence incomplete. |
| `threejs-sky-atmosphere-and-haze/.../webgpu-lut-atmosphere` | 8/0/25 | Unit/mutations pass; executed LUT/froxel evidence incomplete. |
| `threejs-volumetric-clouds/.../webgpu-weather-volume-clouds` | 11/0/21 | Unit/mutations pass; native transport/temporal evidence incomplete. |
| `threejs-spectral-ocean/.../webgpu-fft-ocean` | 12/1/10 | Unit/mutations pass; deleted local lock requires separate dependency decision; GPU FFT evidence incomplete. |
| `threejs-water-optics/.../webgpu-bounded-water` | 9/0/11 | Unit/mutations pass; native simulation/optics evidence incomplete. |
| `threejs-scalable-real-time-shadows` three surfaces | 7/0/0 | Small evidence-status and validator changes; all runtime claims remain insufficient. |
| `LICENSE` | 0/0/1 | Valid ISC text, but commit independently from rendering work. |
| `skills.json` | 1/0/0 | Generated/stale; regenerate last. |

## Gap-closing list

1. Reconcile the clean evidence-first site branch with this dirty implementation branch without losing either history.
2. Fix the creature controller so the canonical render path uses the host `RenderPipeline`; re-run the strict controller mutation and full creature gate pack.
3. Land every already-passing source unit in isolated commits before any generated registry or Pages output.
4. Decide the ocean lockfile intentionally. Do not stage its deletion merely because root dependencies currently work.
5. Keep the Ralph/Grok loop scripts out of lab commits; they are unrelated automation.
6. Commit provider proxy source/assets with explicit secondary classification and licensing, never as primary proof.
7. Regenerate the registry only after all raw manifests and source units are committed.
8. Replace the dirty checkout’s older fixed SEO panel and generated `docs/` with the already reviewed evidence-first/collapsed-provenance implementation.
9. Run native-WebGPU correctness capture per rendering lab. Promote only inspected render-target images, with source hashes and `INCOMPLETE` limitations where the full bundle is absent.
10. Build the 14 normative v2 JSON files, standard image set, odd-size readback, timing, lifecycle, and mutation evidence for each rendering lab before changing any status to accepted.
11. Capture all five flagships only after their standalone dependencies have native proof and their owner graphs remain singular.
12. Regenerate Pages, validate source hashes, smoke all routes, inspect the dedicated domain, and only then publish.

## Small thematic commit sequence

The list below is ordered by dependency. Each item is staged by explicit paths or hunks and verified before commit.

### A. Audit and common repository contracts

1. `docs(audit): map uncommitted lab closure units`
   - This file only.
   - Verify Markdown diff and clean staged scope.
2. `docs(license): add repository ISC license`
   - `LICENSE` only; verify site/package license claims match.
3. `feat(proxies): classify generated provider assets`
   - `labs/provider-proxies/**` only; validate hashes, dimensions, provenance, and secondary-only registry behavior.
4. `test(integrations): add shared flagship evidence contracts`
   - `integration-labs/package.json` and `integration-labs/tests/**` only.

### B. Repair and split the protected creature work

5. `feat(creatures): certify total contributor capacity`
   - Blend DAG, candidate certification, field/spec schema, frozen sweep corpus, and certification gates.
6. `feat(creatures): make locomotion replay deterministic`
   - Driver plus gait, IK, hopper, flyer, swimmer, rope, and genome modules with numeric gates.
7. `feat(creatures): bind GPU pose and material caches`
   - Pose storage, field nodes, materials, outline, cache identity, and partial-upload gates.
8. `fix(creatures): render through the host pipeline`
   - Browser controller/runtime stage/capture ownership hunk plus the failing pipeline mutation.
9. `test(creatures): reconcile artifact and route gates`
   - Remaining validation, manifest, package scripts, findings, artifact schema, route wrappers, and browser entry.

### C. Standalone canonical labs

For large labs, the first commit contains pure mechanisms/oracles and the second contains browser/controller/routes/capture/manifest. Small self-contained labs use one commit.

10. `feat(fallbacks): add explicit browser fallback harness` — core/tests, then browser/routes/manifest if staged separately.
11. `feat(ao): implement executable GTAO mechanisms`; `feat(ao): wire canonical browser evidence surface`.
12. `feat(bloom): implement selective HDR bloom`; `feat(bloom): wire canonical browser evidence surface`.
13. `feat(camera): complete rig mathematics and lifecycle`; `feat(camera): wire canonical browser evidence surface`.
14. `feat(exposure): implement weighted metering and adaptation`; `feat(exposure): wire tone-map LUT browser lab`.
15. `feat(pipeline): implement shared final-image graph`; `feat(pipeline): wire canonical and temporal routes`.
16. `feat(surface): implement frost history and diffusion`; `feat(surface): wire canonical browser evidence surface`.
17. `feat(weather): implement coupled precipitation response`; `feat(weather): wire canonical browser evidence surface`.
18. `feat(fields): implement analytic gradients and storage bake`; `feat(fields): wire canonical browser evidence surface`.
19. `feat(geometry): complete semantic mesh writer`; `feat(geometry): wire batching and indirect browser lab`.
20. `feat(materials): complete procedural PBR identities`; `feat(materials): wire canonical browser evidence surface`.
21. `feat(cities): complete deterministic building compiler`; `feat(cities): wire canonical browser evidence surface`.
22. `feat(planets): implement balanced cube-sphere quadtree`; `feat(planets): wire field-atlas browser lab`.
23. `feat(vegetation): complete dense grass lab`.
24. `feat(vegetation): complete structured Ash growth lab`.
25. `feat(motion): complete deterministic procedural timelines`; `feat(motion): wire compute/browser evidence surface`.
26. `feat(effects): implement GPU pooled compaction`; `feat(effects): wire reentry and indirect browser lab`.
27. `feat(space): complete bounded curved-ray integrators`; `feat(space): wire temporal and browser evidence surface`.
28. `feat(atmosphere): implement physical LUT and depth contracts`; `feat(atmosphere): wire native browser lab`.
29. `feat(clouds): implement bounded volume transport`; `feat(clouds): wire temporal/shadow browser lab`.
30. `feat(ocean): implement staged spectral FFT`; `feat(ocean): wire canonical browser evidence surface`.
31. `build(ocean): reconcile local dependency lock` — explicit keep/remove decision after `npm ci` equivalence check.
32. `feat(water): implement bounded simulation and optics`; `feat(water): wire canonical browser evidence surface`.
33. `fix(shadows): keep support surfaces evidence-gated` — the seven small tracked shadow changes only.

Every standalone commit runs its package `check`, `validate:unit`, and `test:mutations`; browser/capture commits additionally run native WebGPU capture and artifact validation, retaining `INCOMPLETE` where evidence is insufficient.

### D. Focused integrations

34. `feat(ao): integrate AO with the shared image pipeline`.
35. `feat(surface): integrate temporal surface history`.
36. `feat(weather): integrate precipitation with final image`.
37. `feat(vegetation): integrate grass and structured growth`.
38. `feat(pipeline): validate shared framegraph ownership`.

### E. Cross-skill flagships

Each flagship is split into an owner-graph/contracts commit and a browser/capture/manifest commit.

39. `feat(flagship): define Final Image Flight ownership`; `feat(flagship): publish Final Image Flight runtime`.
40. `feat(flagship): define Weathered World ownership`; `feat(flagship): publish Weathered World runtime`.
41. `feat(flagship): define Procedural District ownership`; `feat(flagship): publish Procedural District runtime`.
42. `feat(flagship): define Creature Habitat ownership`; `feat(flagship): publish Creature Habitat runtime`.
43. `feat(flagship): define Relativistic Space Shot ownership`; `feat(flagship): publish Relativistic Space Shot runtime`.

### F. Registry, site reconciliation, evidence, and publication

44. `build(labs): regenerate the schema-v2 registry`
   - Regenerate `labs/demo-registry.json` only after raw source commits land.
45. `merge(site): reconcile evidence-first publication source`
   - Merge the clean reconciliation history; retain collapsed provenance, direct-evidence-only previews, and truthful counts.
46. `fix(site): remove generated whitespace and stale SEO-shell behavior`
   - Fix the owning generator, never the generated HTML directly.
47. `docs(evidence): publish inspected incomplete readbacks`
   - One small commit per lab or tightly coupled integration, with source hash, adapter facts, and limitations.
48. `docs(site): regenerate the verified publication matrix`
   - Generated `docs/**`, `skills.json`, responsive media, sitemap, and source manifests only.
49. `chore(release): verify and publish the completed matrix`
   - Only if a release metadata change is actually required; pushing itself is not a content commit.

## Per-commit verification floor

1. `git diff --cached --check`.
2. Confirm staged paths belong only to the named unit.
3. Run syntax/static checks owned by the lab.
4. Run its unit and mutation suites.
5. For browser commits, initialize native WebGPU and capture render-target pixels with an aligned integer stride.
6. Inspect final and mechanism-specific images directly.
7. Run artifact validation and retain claim-specific insufficient verdicts.
8. Check `git log` for joke uniqueness.
9. Commit with a relevant final joke paragraph containing `https://devme.me/` and no AI attribution trailer.

## Publication acceptance remains open

This audit proves that most source units are testable and nearly all browser-free contracts pass. It does **not** prove that the native-WebGPU lab matrix is finished. Completion still requires current-adapter capture, full v2 evidence, lifecycle loops, timing where claimed, visual inspection, clean source-hash publication, and live-domain verification for every accepted rendering claim.
