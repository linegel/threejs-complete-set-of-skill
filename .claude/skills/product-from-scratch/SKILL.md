---
name: product-from-scratch
description: Design a product change before building it. Decides which of BRD, PRD, XDS, and SDD the change needs, and supplies the story, scenario, and state grammars for writing them, a vocabulary for naming controls precisely, and the review and verification rules. Use for any user-facing change, from a one-line fix to a new journey.
---

# Product from scratch

Decide what a person will see and do before code constrains it: the user, the outcome, the journey,
the interactions, the states, the failures, and the recovery. When implementation exposes a real
constraint, reopen the decision that owns it instead of redesigning around the code.

## Cost rules

1. Design effort stays proportionate to consequence and unresolved uncertainty. For an ordinary
   change it costs materially less than implementing the change twice.
2. Every artifact and every field must force a distinct decision or improve verification. Remove
   one that repeatedly does neither.
3. Reuse existing canon before authoring anything. Touching the interface does not earn a new
   document.

When work grows without resolving a decision or reducing a plausible risk, cut process. A process
defect is never fixed with another process layer: no manifests, hashes, computed statuses, approval
records, evidence taxonomies, reviewer machinery, or artifact quotas. Document lint proves
mechanics; it never approves a design.

## The chain

```text
BRD  when business intent changes
PRD  when product behaviour changes
XDS  when a material experience decision exists
SDD  when a material technical decision exists
then implementation, then verification
```

A layer is used only when its decision exists. Conditionality prevents dummy documents; it does not
permit leaving a decision unresolved. A new capability or cross-surface journey normally uses every
layer.

| Artifact | Use when | Owns | Must not own |
|---|---|---|---|
| **BRD**, business requirements | Business intent, target users, outcomes, scope, or non-negotiable qualities change | Why the work deserves to exist, user and business outcomes, acceptable effort, qualities that may not be traded away | Controls, layout, copy, colour |
| **PRD**, product requirements | A new capability or a material behaviour change needs a durable rule | Product stories, rules, data, permissions, required outcomes and invariants under success, failure, interruption, recovery, and return, observable acceptance | Control choice, choreography, layout, copy, hierarchy, motion, technical realization |
| **XDS**, experience design (a short UX note in the PR counts) | A new or materially changed journey, seam, hierarchy, state model, shared control, or interaction choice needs design | Journey, states and transitions, controls and events, copy, feedback ownership, preservation, retry, return, responsive composition, motion, alternatives | New business or product requirements, technical realization |
| **SDD**, solution design | Architecture, data, security, deployment, performance, or cross-module behaviour needs a durable technical decision | Schemas, APIs, persistence, performance, security, technical failure handling | Redesigning the experience |

Order and authority:

- Business intent precedes product behaviour, product behaviour precedes its experience, and both
  precede technical realization. A technical-only SDD needs no XDS.
- The PRD says what the product must do. The XDS says how the person reaches, understands, and
  recovers through it. A product rule discovered during design goes into the PRD, never into the XDS.
- A feasibility conflict reopens the owning product or experience decision. Technical work may expose
  constraints and propose options; it does not pick the user-facing resolution.
- Scope an XDS by a coherent journey or surface family. One XDS may serve several PRDs and one PRD may
  appear in several journeys.
- Current implementation, research, and measurements are evidence. They inform the target; they never
  define it. Keep the target and the as-built record distinct.

Before writing, name the decision and read only the artifacts that own or constrain it. Amend canon
only when its decision changes. Link to the owning statement instead of restating it. A legacy
product without a corpus owes no backfill before a small fix: put the smallest missing decision in
the issue or PR, and create durable canon only when a decision must outlive the change.

## Proportionality

| Change | Smallest useful material |
|---|---|
| No user-visible or interaction effect | None, unless a business, product, or technical decision independently needs durable treatment |
| Small maintenance delta | In the issue or PR: actor and task, current failure, expected behaviour, affected reachable states, preserved context, recovery and return rule, observable acceptance. Link existing requirements and tests instead of restating them |
| New capability or material behaviour change | Add or amend the PRD. Add or amend XDS material when the change introduces or alters a journey, seam, hierarchy, state model, shared control, or interaction choice |
| New or materially changed journey or cross-surface seam | One XDS in traversal order, covering only the decisions the journey needs |
| Consequential technical choice | One SDD |

There is no length quota. Use the lightest material that leaves no material decision implicit.
Escalate only when the lighter material failed to force a decision. A request for more documentation
is not a reason.

## Experience prompts

Use the prompts that resolve the change and omit the rest without comment.

1. **Product story**: who, in what context, doing what, for which outcome.
2. **Experience thesis**, for a new feature or journey only: one sentence naming the committed
   direction and the one thing a user should remember. If it could caption a competitor's product
   unchanged, there is no thesis yet.
3. **Journey**: entry, decisive moments, completion, return or resume.
4. **Interaction scenario**: named controls and events, visible response, terminal state, and what
   must never happen. State felt qualities as observable values: input acknowledged within 100 ms,
   completed or in a designed slow state by 1 s (the classic response-time limits), motion character
   named and bounded. An adjective with no value behind it is a wish. Compare alternatives only at a
   consequential hinge, and keep the losing candidate with one line on why it lost.
5. **State model**: reachable states that change what the user sees or can do.
6. **Recovery**: what survives failure, what is lost, what can be retried, and where retry lives.
7. **Acceptance**: observable scenarios someone will exercise.

Render a state board, mockup, or prototype when layout, density, motion, timing, or responsive fit
carries the decision. For a new surface or journey, the opening, the decisive interaction, failure
and recovery, and completion are visual claims, so render them.

## Grammars

The conventional story ("As a creator, I want to add my game so that players can find it") is too
weak when context, effort, abandonment, or falsification can change the decision.

```text
STORY        <id>
As           <actor>
in           <context: first-run, returning, signed-out, empty account, ...>
I            <the task, independent of route, schema, or control>
so that      <the business or personal outcome>

Arrives at   <the observable state that constitutes success>
Abandons at  <plausible exit points and what makes leaving plausible>
Effort       <inputs, decisions, context switches, external tools; quantify when useful>
Falsified by <the observation that disproves the story>
```

Use the full grammar when its lines force decisions. A local maintenance change needs only actor,
task, expected outcome, and acceptance. An atomic action with no meaningful exit needs no
`Abandons at` line.

A story never chooses a control. Map a material story into its interaction:

```text
SCENARIO     <id, linked to the story when one exists>
Starts in    <state and context>
User         <activates a named control or performs a named event>
Immediately  <visible response>
While        <pending, slow, or interrupted behaviour, when applicable>
Succeeds as  <terminal state>
Fails as     <truthful failure state, when reachable>
Recovers by  <durable action and preserved context>
Returns to   <resume, back, refresh, authentication return, later return, when material>
```

A scenario that omits a material control, response, terminal state, or reachable recovery has not
designed that part of the interaction.

## State prompts

Authors omit the states they do not remember. Scan all four dimensions for a material journey and
use the ones that can change the affected experience.

| Dimension | Inspect | Yields, for example |
|---|---|---|
| **Data** | Values: absent, partial, invalid, maximal. Collections: zero, one, several, very many | Empty account, half-completed form, over-limit title |
| **Time** | Asynchronous actions: pending, slow (past 1 s), success, failure, superseded, repeated, late completion | Slow-state notice, durable result after the toast is gone, stale completion discarded |
| **Path** | How a value arrives, and interruptions: typed, restored, defaulted, fetched, authenticated, refreshed | Stale prefill validity, draft intact after an authentication detour |
| **Frame** | Supported widths, input modes, and content extremes | Narrow-viewport fit, longest label, failed image |

Record only reachable states that change user-visible behaviour or carry a plausible failure. Record
an exclusion only when a plausible state is deliberately excluded and the reason prevents ambiguity.
Never serialize a Cartesian product or claim exhaustive coverage.

For each affected control, decide keyboard, pointer, and touch behaviour; focus placement and
restoration; and orientation, safe-area, and width behaviour. These are ordinary interaction
decisions.

### Reading symptoms backwards

| Observed | Ruling |
|---|---|
| Success exists only in a toast | Time. Success shows in the durable resulting state; the toast is at most an accent |
| A wait past 1 s with no acknowledgment | Time. A slow state is a designed state |
| An error survives a valid prefill, restore, or correction | Path. Judgment that appears must be told when to leave |
| Failure shown as a dead end | Recovery. Retry lives where the failure is shown and outlives any toast |
| Page arrives, then rearranges | A skeleton that approximates the eventual structure. A spinner hides the geometry (`references/vocabulary.md`, loading) |
| Breaks at narrow width or the longest real label | Frame. Content extremes are test inputs |
| The spec says "dropdown", "modal", "tab", or "toast" alone | No decision yet (`references/vocabulary.md`) |

## Choosing and naming a control

Control choice follows the task, never the schema type:

1. **Reuse audit**: how is the same task solved elsewhere in the product, and which component owns
   it? Reuse the product's grammar unless the task materially differs.
2. **Retrieval**: does the user recall a value or recognise one from a set?
3. **Cardinality and comparison**: how many options, how familiar, and must they be compared side by
   side?
4. **Real-world arity**: one or many, decided from reality before the schema.
5. **Assistance**: is the value fetchable, derivable, defaultable, or suggestible? A schema
   requirement never justifies human transcription.
6. Name the control precisely enough to expose its behaviour. `references/vocabulary.md` defines the
   names whose choice changes behaviour, states, input model, or recovery. Consult it when a name is
   ambiguous; it is a lookup and creates no obligation. A project may define a local term when no
   shared name fits.

## Durable handoff

The next agent sees only the repository and the issue or PR. Before handoff, put every
downstream-critical fact in one durable place: the user and outcome; the current failure or
decision; the chosen behaviour and interaction; affected states, preservation, recovery,
interruption, and return; non-goals; accepted and rejected alternatives when they prevent reversal;
observable acceptance and the verification actually performed; known gaps and blocked checks.

Link owning documents instead of duplicating them. Normative documents state the current target; the
PR keeps the why, the rejected alternatives, and the deviations. Never write "see chat" and never
leave a load-bearing decision only in private reasoning. If a public review verdict changes, correct
the PR thread explicitly; a silent edit does not repair a handoff another agent already read.

## Review

Review the product decision. The existence of an artifact proves nothing.

- Before a public verdict, read every changed product or design file end to end in its branch form.
  Diff, lint, and link checks prove mechanics only.
- A useful finding names a missing or wrong user-facing decision and points to evidence.
- A new feature or journey gets one design review by someone who did not author it, with the renders
  needed to judge its visual and temporal decisions. A small change gets ordinary PR review.
- Recheck concrete findings after correction. Do not create review-of-review or convergence rituals.
- Once the owner approves a direction, execute it. Reopen design only when the owner changes
  direction, a requirement is corrected, a material constraint appears, or concrete evidence makes
  the decision wrong, impossible, or unsafe.

## Verification

A design can be ready before implementation. The change is done only when its result works.

- Exercise the affected real flow in a representative host, including reachable failure, recovery,
  interruption, and return paths. A happy-path screenshot or an HTTP status verifies nothing about
  interaction, and stills never verify motion.
- An instrumented walk measures the timings, states, and motion properties the design committed to.
  The final judge of feel is a person using the real thing. When the person disagrees with a green
  walk, the design was missing a commitment; add the value that would have caught it.
- Run repository-required checks and change-relevant tests. Tests do not replace live verification.
- When a host or seam cannot be exercised, record the exact unverified scenario in the PR and make no
  completion claim.
- When the main uncertainty is comprehension or perceived effort, observe a representative user when
  feasible; otherwise record the assumption and the follow-up. More documentation cannot answer that
  question.
- Give reader-facing documents an audience-fit read: what does not parse for a reader outside the
  project? Keep workflow jargon out of product documents.
- Machine checks stay mechanical: links resolve, IDs are unique, referenced documents exist, the
  format parses.

Build-time polish (radii, easings, staggers, press states, optical alignment) belongs to the craft
skills loaded at the moment of making. This method does not duplicate them.

## Definition of done

Ready to implement:

1. Only the artifacts the decision needs were created or amended, in chain order.
2. User, task, outcome, and observable acceptance are clear enough to falsify the decision.
3. Interaction, state, preservation, recovery, interruption, return, effort, abandonment, and non-goal
   decisions are explicit where the change has them, and no story chose a control.
4. Data, Time, Path, and Frame were considered without a completeness ledger.
5. Visual and temporal decisions were rendered and inspected by the reviewer.
6. Another agent can recover the controlling decision and known gaps from the repository alone.
7. Anything that forced no decision was removed.

Implemented:

1. The implementation preserves the chosen experience; constraints did not rewrite it silently.
2. The real flow and its failure and recovery paths were exercised in a representative host, or the
   unverified seam is recorded without a completion claim.
3. Required checks and relevant tests ran; blocked checks are recorded.
4. Reader-facing documents describe the current target and passed the audience-fit read.
