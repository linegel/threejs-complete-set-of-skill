# Website improvement pass — 2026-09-24

## Finished and verified
- Repaired responsive image publication and manifest consistency.
- Reuse binds source bytes, encoder settings/versions, URLs, dimensions, and output hashes.
- Current publication: 201 PNG sources, 402 AVIF/WebP variants; all 603 fully decoded.
- Cold migration: 290 sources in 524.55 seconds; unchanged current build: 0.207 seconds.
- Confirmed unchanged manifest bytes and image modification times on repeat generation.
- Browser: 129 surfaces at 1440, 390, and 320px; all 402 variants decoded in Chromium.
- Reconciled 40 evidence reports and retired preview owners during normal builds.
- Withheld outdated capture summaries without changing canonical source evidence.
- Restored 51 article crops for 17 skills; complete presentation and SEO checks pass.
- Raised evidence labels to 12px; resolved narrow-layout overflow with wrapping.
- Archived 88 unreferenced variants with hashes; original PNGs remain published.
- Fixed preflight import crash; 10 tests pass on Node 22.22.0 and 26.4.0.
- Pinned toolchain preflight, full site build, source hashes, and skill distribution pass.
- Full pinned unit suite: 192/197 passing. Relevant image/evidence tests: 19/19 passing.

## Deferred / boundaries
- Atomic output publication and resumable checkpoints were proposed, but tool edits
  were rejected. They were NOT implemented; the existing verified encoder was retained.
- Static browser/image checks do not establish native GPU rendering or timing correctness.
- Preserve unrelated capture staging, backups, bisect files, and all other agents' work.
- Owned browser contexts and preview servers close in finally blocks.

## Next concrete failures (not hidden or marked passing)
1. tests/labs/capture-contract.test.mjs: favicon request failure policy disagrees with runner.
2. tests/labs/capture-wiring.test.mjs: weathered-world lacks its declared shared hook;
   webgpu-touch-history-frost wrapper fails forwarded-profile audit.
3. tests/labs/demo-roadmap.test.mjs: incomplete-tier closure expectation and creature
   current-adapter timestamp requirement disagree with the current roadmap output.
4. tests/labs/runtime-evidence-preview.test.mjs: backend proof fixture omits current
   adapter/device identity fields. Preserve uncertainty rather than inventing hardware proof.
5. Build warnings: object-sculptor classic bootstrap script is not bundled; a scenario URL
   remains unresolved at build time; some chunks exceed 500 kB. Verify actual route behavior.

## Evidence files
- image-verification.json: full decode, hashes, bytes, no-rewrite benchmark.
- browser-report.json and screenshots: every evidence report plus core site surfaces.
- validation-final.log, full-build-final.log, preflight-pinned.log.
- unit-tests-pinned.log: exact five remaining failed tests and assertions.
- obsolete-variants.json: recoverable paths and hashes for archived generated variants.
- obsolete-responsive-archive/: archived bytes, not deleted original evidence.

## Commits
- ae403366: responsive delivery, evidence publication, generated outputs, and layout repair.
- bed34f1f: filesystem permission constant compatibility and real permission regression.
- 43abcf0b: evidence publication date; local HEAD and origin/main verified identical.
- Ownership released in hey.md; tracked worktree and index are clean.

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
21. [ ] Commit and push the finished capture/evidence correction.
22. [x] Reproduce object-sculptor bootstrap loading in isolated browser MCP.
23. [ ] Repair its source-owned bundling without removing controls or routes.
24. [ ] Exercise object selection, diagnostics, reload, and history restoration.
25. [ ] Inspect affected desktop layouts at 1024, 1280, 1440, and 1728px.
26. [ ] Inspect affected non-map layouts at 390 and 768px after desktop passes.
27. [ ] Capture console/network observations for each affected browser load.
28. [ ] Commit and push the finished browser-path correction.
29. [ ] Add interruption-safe image publication using existing encoder helpers.
30. [ ] Verify resumed generation reuses finished work and repairs partial output.
31. [ ] Verify corrupt cache records cannot suppress reconstruction.
32. [ ] Preserve existing encoding settings, source PNGs, and visual results.
33. [ ] Commit and push the finished image-generator correction.
34. [ ] Run the pinned unit suite and required source/distribution checks.
35. [ ] Rebuild the complete site from the latest default branch.
36. [ ] Inspect emitted size warnings and identify actual user-facing bottlenecks.
37. [ ] Exercise the affected rendering paths with truthful backend observations.
38. [ ] Repair further directly observed defects; retain unmeasured GPU limits.
39. [ ] Stop owned servers/MCP sessions and clean owned temporary artifacts.
40. [ ] Update this complete plan, release ownership, and verify remote parity.

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
