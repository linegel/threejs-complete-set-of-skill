---
name: threejs-debugging
description: Diagnose unexpected Three.js WebGPU/TSL runtime, rendering, API, asset, or version behavior. Use for a concrete failure, a suspected upstream regression or known issue, or a choice among an application fix, released upgrade, bounded workaround, upstream report, and blocker.
---

# Three.js Debugging

Reproduce first. Treat installed source and official history as evidence, not as
background trivia. A domain skill defines the intended mechanism;
`$threejs-visual-validation` supplies formal image, timing, resource, or
regression proof when the diagnosis needs it.

Keep one case record with the symptom, expected behavior, exact environment,
minimal reproduction, first failed contract, local evidence, upstream
candidates, constant version matrix, conclusion, action, and limits. Record
unknown values as unknown.

## 1. Reproduce the exact environment

Record every environment fact that can affect the failure: resolved package
version, runtime `THREE.REVISION`, lockfile resolution, import entrypoints,
browser/OS, seed, asset revisions, and exact command or interaction. For a
rendering or backend claim, also record renderer class, initialized backend,
GPU, and relevant capabilities. Build the smallest deterministic reproduction
that still fails.

A conclusion about the canonical WebGPU path requires an initialized
`WebGPURenderer` with `renderer.backend.isWebGPUBackend === true`. Otherwise
record that claim's blocker; reach `$threejs-compatibility-fallbacks` only when
the user explicitly requests that branch. Do not impose a renderer or backend
gate on a non-rendering API, export, asset, or version conclusion.

This step is complete when the relevant environment truth is recorded, the
reproduction fails repeatedly under that environment, and another run can
distinguish reproduced from not reproduced.

## 2. Name the violated contract and first failure

Separate API semantics, numerical invariants, render-state invariants, resource
transitions, and visual expectations. Identify the earliest failing assertion,
frame, pass, draw, dispatch, resource transition, or diagnostic—not merely the
final symptom.

This step is complete when one observable boundary divides the last known-good
state from the first bad state.

## 3. Minimize without replacing the mechanism

Remove unrelated systems while preserving the suspect API, material, geometry
path, backend, projection, precision, ownership, and lifecycle behavior. At a
cross-system boundary preserve the same units, frames/origin, owner,
interval/cadence/sample phase, state identity, validity/staleness/error, reset,
and completion semantics.

A different renderer, material, or representation may localize the fault; it
cannot prove the original path correct.

This step is complete when every remaining component participates in the first
failure and the suspected mechanism is still the one under test.

## 4. Resolve local evidence

Inspect the installed export map, source, types, tests, examples, and migration
material for the resolved revision. Test local hypotheses first: application
misuse, stale or duplicate imports, migration changes, missing renderer
initialization, unsupported backend/capability, invalid data, duplicate output
conversion, lifecycle/synchronization error, and third-party integration.

This step is complete when each plausible local hypothesis has an executable
result or an explicit missing-evidence record.

## 5. Research upstream conditionally

Research upstream only when local evidence does not settle the cause, installed
source and current documentation disagree, a version-dependent regression or
upgrade is plausible, or the user asks about known issues. Read
[upstream research](references/upstream-research.md) before searching and
follow its primary-source order.

Classify every candidate independently:

| Classification | Required proof |
| --- | --- |
| `usage-or-integration-error` | installed contract explains the failure and the local correction passes |
| `intentional-api-change` | official migration or source history proves a deliberate change |
| `upstream-active` | current checked code reproduces and an upstream record matches |
| `fixed-unreleased` | the matching fix is merged but no verified published package contains it |
| `fixed-released` | a published package contains the fix and the same reproduction passes |
| `not-reproduced` | the candidate configuration does not reproduce the local failure |
| `unrelated` | API, backend, symptom, affected range, or reproduction differs materially |
| `insufficient-evidence` | reproduction, containment, fix, or release proof is missing |

Closed is not a classification, and merged is not evidence that an npm release
contains the fix.

This step is complete when every inspected candidate has exactly one supported
classification.

## 6. Hold a constant version matrix when version-dependent

When the diagnosis depends on version behavior, change one Three.js version at
a time while holding the reproduction, backend, browser/GPU, imports, assets,
and assertion constant. As evidence permits, record the installed version, last
known good, first bad, fixing commit, first published fixed release, and current
checked release.

This step is complete when every conclusion about affected range or release
availability follows from comparable rows rather than version labels.

## 7. Contain, verify, then choose one action

First identify the narrowest containment that protects the violated invariant.
Then verify the proposed correction on the original reproduction. Recommend an
upgrade only after proving the fixing commit, the first published package that
contains it, and a passing reproduction on that package.

Choose one action:

- application fix for misuse or invalid state;
- released upgrade for a verified published fix;
- bounded workaround or pin with scope and removal condition;
- upstream report when current checked code reproduces without a matching case;
- blocker when required evidence is unavailable.

This step is complete when the chosen action has a passing or falsifiable
verification, names its version/backend scope and side effects, and does not
claim more than the evidence supports.

## Report and stop

Return the root cause, installed result, relevant upstream issue/PR and fixing
commit, affected range, first published fixed release, classification, fixed
version result, regression assertion, one decision, and limitations.

Stop when one conclusion has direct local evidence and, when upstream is
involved, direct primary-source/release proof. Also stop when all plausible
candidates are classified and the exact missing evidence is explicit. Do not
collect unrelated issue IDs after the action is settled.
