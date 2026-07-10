---
name: threejs-debugging
description: "Diagnose unexpected Three.js runtime, rendering, API, asset, and version-dependent behavior. Use when observed output disagrees with expected behavior, installed source, types, documentation, or examples; when a regression or known upstream issue may exist; when a project is behind and a later fix may justify upgrading; or when choosing among an application fix, dependency upgrade, bounded workaround, upstream report, and blocker. Do not use for ordinary scene design without a concrete failure, suspicious behavior, or audit request."
---

# Three.js Debugging

Establish the failure locally, then treat official upstream history as executable
diagnostic evidence. Do not preload remembered issue lists. Issue status, affected
versions, fix availability, and backend behavior are revision-dependent facts.

This skill owns root-cause and version/fix triage. A domain skill owns the
intended graphics or physics mechanism. `$threejs-visual-validation` owns formal
image, timing, resource, and regression evidence when those proofs are required;
it does not own issue archaeology.

## Investigation Contract

Keep one compact working record. This is diagnostic output, not an extension of
the visual-validation manifest:

```yaml
debugCase:
  symptom: ""
  expectedBehavior: ""
  firstObserved: ""
  minimalRepro: ""
  installed:
    packageVersion: ""
    runtimeRevision: ""
    lockfileResolution: ""
    importEntrypoints: []
    rendererClass: ""
    initializedBackend: ""
    browserGpuOs: ""
  suspectApis: []
  localEvidence: []
  upstreamCandidates: []
  versionMatrix: []
  conclusion: ""
  nextAction: ""
```

Record exact commands, commits, package versions, URLs, and repro results. Keep
unknown values unknown; do not infer the runtime revision from a lockfile range.

## Diagnostic Workflow

1. **Freeze the failing configuration.** Record the resolved package version,
   runtime `THREE.REVISION`, import map or bundler resolution, renderer class,
   initialized backend, browser/OS/GPU, relevant capabilities, scene seed, asset
   revisions, and the smallest deterministic reproduction.
2. **State the violated contract.** Separate expected API semantics, numerical
   invariants, render-state invariants, and visual expectations. Record the first
   failing assertion, frame, pass, draw, dispatch, or resource transition.
3. **Reduce without replacing the suspected mechanism.** Remove unrelated scene
   systems and post effects, but preserve the API, material, geometry path,
   backend, projection, precision, and lifecycle behavior under investigation.
   A different material or renderer may localize the fault; it cannot prove the
   original path correct.
4. **Partition local hypotheses.** Test application misuse, stale imports or
   examples, migration changes, duplicated output conversion, missing renderer
   initialization, unsupported backend/capability, invalid data, lifecycle or
   synchronization errors, and third-party integration before declaring an
   engine defect.
5. **Inspect the installed implementation.** Read the resolved export map,
   source, types, tests, examples, and migration material for the installed
   revision. Prefer an executable assertion or source path over prose memory.
6. **Research upstream when local evidence does not settle the cause, installed
   code and current documentation disagree, the installed release is behind, or
   the user asks about known issues or upgrade value.** A recognizable regression
   signature is not a prerequisite. Read
   [upstream research](references/upstream-research.md) before searching.
7. **Build a version matrix.** Reproduce on the installed version and, as
   evidence permits, a last-known-good version, first-bad version, fixing commit,
   first published fixed release, and current checked release. Hold the repro,
   backend, browser/GPU, assets, and assertion constant.
8. **Verify the proposed fix.** A merged PR proves only that code entered its
   target branch. Recommend a released upgrade only after proving which published
   package contains the fix and that the minimal repro passes there. Preserve the
   repro as a project regression test when the failure can recur.
9. **Choose the narrowest proven action.** Use an application correction for
   misuse or invalid state; upgrade for a verified released fix; use a bounded
   workaround or pinned patch when upgrade constraints dominate; file or extend
   an upstream report when the current checked release still reproduces without
   a matching report; return a blocker when required evidence cannot be obtained.

Do not stop after finding a plausible issue title. Continue until its reproduction,
affected range, fix state, and release availability agree with the local case.

## Candidate Classification

Classify each upstream candidate independently:

| Status | Required proof |
| --- | --- |
| `usage-or-integration-error` | Installed source/API contract explains the local failure and a local correction passes. |
| `intentional-api-change` | Official migration/source history proves the behavior changed by design. |
| `upstream-active` | Current checked code reproduces and an open or acknowledged upstream record matches. |
| `fixed-unreleased` | The matching fix is merged, but no verified published package contains it. |
| `fixed-released` | A published release contains the fixing commit and the local repro passes on it. |
| `not-reproduced` | The candidate's stated configuration cannot reproduce the local failure. |
| `unrelated` | API path, backend, symptom, affected range, or reproduction differs materially. |
| `insufficient-evidence` | Fix containment, release mapping, or reproduction proof is missing. |

Closed is not a classification. A closed issue may be fixed, duplicated,
invalid, intentional, or abandoned. Likewise, a merged PR is not automatically
available to an npm-installed project.

## Decision Evidence

Before recommending an upgrade, record:

- the installed package and runtime revision;
- the fixing PR or commit and its target branch;
- the first verified published release containing that commit;
- installed-versus-fixed repro results under the same configuration;
- migration and dependency risks relevant to the project;
- the regression test or assertion that will prevent recurrence.

Before recommending a workaround, record the violated invariant, why the
workaround avoids it, its version/backend scope, removal condition, and whether
it changes correctness, image quality, performance, or resource ownership.

## Report

Return only the evidence needed to act:

```yaml
threejsDebugging:
  rootCause: ""
  installedResult: ""
  upstream:
    issueOrPr: ""
    fixingCommit: ""
    affectedRange: ""
    firstPublishedFixedRelease: ""
    classification: ""
  verification:
    fixedVersionResult: ""
    regressionTest: ""
  decision: application-fix | upgrade | workaround | upstream-report | blocker
  limitations: []
```

Do not turn investigated issue IDs into a general cheat sheet. Carry them only
inside the case that proved their relevance.
