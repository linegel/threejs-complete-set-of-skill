---
name: product-from-scratch
description: Use when designing a product change before building it — deciding whether it needs a BRD, PRD, UX note/XDS, or SD/SDD; authoring or amending those artifacts; writing user stories; designing journeys and interactions; choosing controls, states, failures, and recovery; reviewing the result; or handing product decisions to another stateless worker. This skill owns a CONDITIONAL DECISION CHAIN, the boundary between PRODUCT REQUIREMENT AUTHORITY and EXPERIENCE REALIZATION, the PRODUCT-STORY and INTERACTION-SCENARIO grammars, Data · Time · Path · Frame state prompts, durable repository/PR handoff, rendered review, and a PROPORTIONALITY rule that caps process cost. It is a thinking aid, not a governance system — it produces no statuses, hashes, approval records, artifact quotas, or merge gates.
---

# Product from scratch — design before code, at a cost the change can afford

You are about to decide what a human will see and do. Make the important product and experience
decisions explicit before they constrain implementation: the user, outcome, journey, interactions,
states, failures, and recovery. If implementation exposes a real constraint, reopen the relevant
decision instead of silently redesigning around the code.

## The budget law — read this before anything else

This skill's ancestor grew into a certification bureaucracy: manifests, hashes, computed status
ladders, approval and conformance records, evidence taxonomies, and a resolver wired into CI. In the
originating trial, that machinery cost far more than implementing the same fixes directly, while the
decisive defects were caught by simple product stories and state prompts. Three rules keep the
machinery deleted:

1. **Design effort must be proportionate to consequence and unresolved uncertainty, and cheaper
   than the avoidable rework it is likely to prevent.** For an ordinary change that means
   materially cheaper than implementing the change twice — a falsifiable ceiling, not a vibe.
   When work grows without resolving a decision or reducing a plausible risk, cut process, not
   quality.
2. **A required artifact or field must force a distinct decision or materially improve
   verification.** If repeated real use shows it does neither, remove it.
3. **Reuse existing product canon before authoring anything new.** A change does not earn a new
   document merely because it touches the interface.

## The conditional decision chain

```text
BRD when business intent changes
  → PRD when product behaviour changes
    → UX/XDS when a material experience decision exists
      → SDD when a material technical decision exists
        → implementation → verification
```

Conditionality prevents dummy artifacts; it is not permission to skip an unresolved decision. A new
product capability or cross-surface journey normally uses every layer whose decision actually exists.

| Artifact | Use it when | Owns | Must not own |
|---|---|---|---|
| **BRD** (business requirements) | Business intent, target users, outcomes, scope, or non-negotiable qualities change | Why the work deserves to exist; user and business outcomes; acceptable effort/friction; qualities that may not be traded away | Controls, layout, copy, colour |
| **PRD** (product requirements) | A new capability or material product behaviour needs a durable rule | Product stories, rules, data, permissions, required outcomes and invariants under success, failure, interruption, recovery, and return, plus observable acceptance | Detailed control choice, interaction choreography, layout, copy, visual hierarchy, motion, or technical realization |
| **UX note / XDS** (experience design) | A new or materially redesigned journey, cross-surface seam, hierarchy, state model, or interaction choice needs design | How the user experiences the product rule: journey, material states and transitions, controls/events, copy, feedback ownership, preservation, retry, return, responsive composition, motion, and meaningful alternatives | New business/product requirement authority or technical realization |
| **SD / SDD** (solution design) | Architecture, data, security, deployment, performance, or cross-module behaviour needs durable technical resolution | Schemas, APIs, persistence, performance, security, and technical failure handling | Quietly redesigning the user experience |

The ordering applies only to artifacts the change actually needs:

- When both BRD and PRD are needed, business intent precedes product behaviour.
- The PRD is authority for **what the product must do**. UX/XDS decides **how the person understands,
  acts through, and recovers within it**. If experience design reveals a missing product rule, amend
  the PRD instead of minting that requirement inside the design.
- When a material user-facing decision and an SDD are both needed, the product/experience decision
  precedes technical realization. A technical-only SDD does not need a fictional XDS.
- A feasibility conflict reopens the owning product or experience decision. Technical work may
  expose constraints and propose options; it does not choose the user-facing resolution silently.
- Scope experience design by a coherent journey or surface family. Do not split it merely to mirror
  PRD boundaries. One design may serve several PRDs, and one PRD may participate in several journeys.

Before writing, identify the decision and read only the existing artifacts that own or constrain it.
Amend canon only when its decision changes. Link to an owning statement when the dependency matters;
do not duplicate requirement prose or create a completeness matrix.

If a legacy product has no formal corpus, do not block a small fix while backfilling one. Put the
smallest missing decision in the issue or PR. Create durable canon only when a real product, journey,
or technical decision needs to outlive that change.

## Proportionality — choose the smallest useful material

| Change | Smallest useful design material |
|---|---|
| No user-visible or interaction effect | None, unless a business, product, or technical decision independently needs durable treatment |
| Small maintenance delta | The issue or PR may contain only: actor/task, current failure, expected behaviour, affected reachable states, preserved context, material recovery/return rule, and observable acceptance. If existing requirements and tests already make the decision clear, link them instead of rewriting them |
| New capability or material product behaviour | Add or amend the PRD; add or amend UX material when the capability introduces or materially changes a journey, seam, hierarchy, state model, shared control, or interaction choice |
| New or materially changed journey or cross-surface seam | One coherent UX note/XDS in traversal order, covering the decisions the journey actually needs |
| Consequential technical choice | One SDD for the architecture, data, security, deployment, performance, or cross-module decision |

There is no length quota. Use the lightest material that leaves no material decision implicit.
Escalate only when the lighter material failed to force a specific product or interaction decision;
“more rigor” or “a reviewer asked for more documentation” is not enough.

## Experience prompts — not a form

Use only the prompts that resolve the change. Omit irrelevant prompts without explanation.

1. **Product story** — who, in what context, doing what, and for which outcome.
2. **Experience thesis** — for a new feature or journey only: one sentence naming the committed
   direction and the one thing a user should remember. If the sentence could caption a
   competitor's product unchanged, there is no thesis yet.
3. **Journey** — entry → decisive moments → completion → return/resume.
4. **Interaction scenario** — named controls/events, visible response, terminal state, and what must
   never happen. State felt-quality commitments as observable values: input acknowledged within
   ~100 ms; completed or a designed slow state by ~1,000 ms; motion character named and bounded.
   A feel adjective ("snappy", "calm") with no value or named behaviour behind it is a wish.
   Compare alternatives only at a genuine, consequential hinge — and keep the losing candidate
   with one line on why it lost, so the hinge is not relitigated next session.
5. **State model** — reachable states that materially alter what the user sees or can do.
6. **Recovery** — what survives failure, what is lost, what can be retried, and where retry lives.
7. **Acceptance** — observable scenarios someone will actually exercise.

Render a state board, mockup, or prototype only when layout, density, motion, timing, or responsive
fit carries the decision. For a new surface or journey, the opening, the decisive interaction,
failure/recovery, and completion are visual claims — render them. A visual artifact is evidence for
a visual claim, never a ritual.

## Product-story grammar

The conventional form — _“As a creator, I want to add my game so that players can find it”_ — is too
weak when context, effort, abandonment, or falsification can change the product decision.

```text
STORY        <id>
As           <actor>
in           <named context: first-run · returning · signed-out · empty account · …>
I            <the task, independent of the system's route, schema, or control>
so that      <the business or personal outcome>

Arrives at   <the observable product state that constitutes success>
Abandons at  <plausible exit points and what makes leaving plausible>
Effort       <material inputs · decisions · context switches · external tools; quantify when useful>
Falsified by <the concrete observation or anti-pattern that disproves the story>
```

Use the full grammar for a material story when its lines force decisions. A local maintenance change
may need only actor, task, expected outcome, and observable acceptance. An atomic action with no
meaningful abandonment point does not need a filler `Abandons at` line.

A product story does not choose the control. Map a material story into the designed interaction:

```text
SCENARIO     <id, linked to the product story when one exists>
Starts in    <named state and context>
User         <activates a named control or performs a named event>
Immediately  <visible response>
While        <pending · slow · interrupted behaviour, when applicable>
Succeeds as  <named terminal state>
Fails as     <truthful failure state, when reachable>
Recovers by  <durable action and preserved context>
Returns to   <resume · back · refresh · authentication return · later-return behaviour, when material>
```

An interaction scenario that omits a material control/event, visible response, terminal state, or,
when failure or interruption is reachable and material, recovery decision has not designed that part
of the interaction.

## State prompts — inspect affected boundaries

Authors under pressure omit states they do not remember. Use the dimensions that can change the
affected experience; scan all four briefly for a material journey:

| Family | Inspect | Yields, for example |
|---|---|---|
| **Data** | Affected values: absent · partial · invalid · maximal; affected collections: zero · one · several · very many | Empty account · half-completed form · over-limit title |
| **Time** | Affected asynchronous actions: pending · slow (~1,000 ms) · success · failure · superseded · repeated · late completion | Slow-threshold notice · durable result after a toast is gone · stale completion discarded |
| **Path** | Relevant ways a value arrives and interruptions/returns: typed · restored · defaulted · fetched · authenticated · refreshed | Stale prefill validity · return from an auth detour with a draft intact |
| **Frame** | Supported widths/input modes and content extremes that can change the interaction | Narrow-viewport fit · longest label · failed image |

Record only reachable states that change user-visible behaviour or carry a plausible material
failure. Record an exclusion reason only when a plausible state is deliberately excluded and the
reason prevents ambiguity. Do not serialize a Cartesian product, inventory impossible combinations,
or treat the prompts as proof of completeness.

For affected controls, decide supported keyboard, pointer, and touch behaviour; focus placement and
restoration; and relevant orientation, safe-area, and width behaviour. These are ordinary interaction
decisions, not a separate compliance lane.

### Reading symptoms backwards

When the built thing feels wrong, enter here:

| You observe | Ruling |
|---|---|
| Success exists only in a toast | **Time** — success shows in the durable resulting state; the toast is at most an accent on it |
| A wait past ~1,000 ms with no acknowledgment | **Time** — a slow state is a designed state, not an absent one |
| An error survives a valid prefill, restore, or correction | **Path** — judgment that appears must also be told when to leave |
| Failure presented as a dead end or false exhaustion | **Recovery** — the retry lives where the failure is shown, and it outlives any toast |
| Page arrives, then rearranges | Skeleton that approximates the eventual structure, not a spinner (`references/distinctions.md`, loading family) |
| Breaks at narrow width or the longest real label | **Frame** — content extremes are test inputs, not edge cases |
| The spec says "dropdown", "modal", "tab", "toast" alone | Not yet a decision — `references/distinctions.md` |

## Choosing and naming a control

Control choice follows the user's task, never the schema type:

1. **Reuse audit** — inspect how the same task is solved elsewhere in the product and which existing
   component or interaction owns it. Reuse the product's grammar unless the task materially differs.
2. **Retrieval task** — does the user recall a value or recognise one from a set?
3. **Cardinality and comparability** — how many options exist, how familiar are they, and must users
   compare them simultaneously?
4. **Real-world arity** — one or many? Decide reality first, then the schema.
5. **Assistance audit** — is the value fetchable, derivable, defaultable, or suggestible? “Required by
   the schema” never justifies human transcription.
6. Name the control precisely enough to expose its material behaviour.

`references/ui-ontology/` is a naming corpus, not a component checklist. Use only relevant families
or alphabetical lookup. `references/distinctions.md` disambiguates overloaded terms such as
_dropdown_, _modal_, _tab_, _tooltip_, _chip_, _toast_, _grid_, and _drawer_.

When no shared name fits, define a clear project-local term. Propose it upstream only when it is
likely to be reusable across products. Imprecision is a review comment, not an INVALID verdict.

## Durable handoff — chat is ephemeral

Assume the next agent sees only the repository and the issue/PR description and threads. Before
handoff, put every downstream-critical fact in one durable place. Include, where relevant:

- the user and outcome;
- the current failure or decision;
- the chosen behaviour and interaction;
- affected reachable states, preservation, recovery, interruption, and return;
- non-goals and deliberately preserved context;
- accepted and rejected alternatives when they prevent reversal;
- observable acceptance and verification actually performed;
- known gaps, inaccessible scenarios, and blocked checks.

Link to owning documents instead of duplicating them. Do not invent status fields, hashes, or a
handoff manifest. Never write “see chat” or leave a load-bearing decision only in private plans or
reasoning. Normative specifications state the current target; PR or decision context keeps the why,
rejected alternatives, deviations, and unresolved evidence when another agent could otherwise undo
the decision.

If a public review verdict changes, correct the PR thread explicitly. Silent edits do not repair the
handoff another agent already read.

## Review and decision discipline

Review the product decision, not the existence of artifacts:

- Before a public verdict, read every changed product/design file end-to-end in its branch form.
  Diff, lint, link, and format checks prove mechanics, not meaning.
- A useful finding names a missing or wrong user-facing decision and points to evidence.
- For a new feature or journey, the single design review is done by someone who did not author
  the design and includes the renders needed to judge its material visual or temporal decisions.
  A small change uses ordinary PR review — no dedicated lane, no role record.
- Recheck concrete findings after correction when needed. Do not create review-of-review,
  convergence rituals, or a new process layer.
- Once the responsible owner approves a direction, execute it. Reopen design when the user or owner
  changes direction, requirements are corrected, a material constraint is discovered, or new
  concrete evidence makes the decision materially wrong, impossible, or critically unsafe.

## Verification — look at the thing

A design artifact can be ready before implementation. The product change is not done until its
result works.

- For user-visible work, exercise the affected real flow in a representative real host, including
  reachable material failure, recovery, interruption, and return paths. A happy-path screenshot or
  HTTP status does not verify interaction.
- Actually inspect UI changes in the supported scenarios that matter. Stills cannot verify motion or
  interaction feel.
- An instrumented walk verifies **commitments, not feelings** — it measures the timings, states,
  and motion properties the design committed to, which is why feel is encoded as observable values
  upstream. The final judge of feel is a human looking at the real thing; when the human disagrees
  with a green walk, the human is right and the design was missing a commitment — add the value
  that would have caught it.
- Build-time polish — radii, easings, staggers, press states, optical alignment — is the province
  of companion craft skills loaded at the moment of making; this method neither duplicates nor
  substitutes for them.
- Follow repository-required checks and run change-relevant tests. Tests do not replace live
  interaction verification.
- If a real host or external seam cannot be exercised, record the exact unverified scenario and
  follow-up in the PR. Do not claim the product change is fully verified.
- When the main uncertainty is comprehension, perceived effort, or whether a journey feels worth
  completing, observe a representative user when feasible. If access is unavailable, record the
  unresolved assumption and validation follow-up without claiming certainty. More documentation
  cannot answer that question.
- Reader-facing documents get an audience-fit read: “What does not parse for a reader outside this
  project?” Keep workflow jargon out of product documents.
- Machine checks stay mechanical: links resolve, IDs are unique, referenced documents exist, and the
  chosen format parses. A project may block mechanical corruption; no machine check may compute
  design quality, approve implementation, or replace human judgment.

Inspect current behaviour, code, research, measurements, and technical constraints as evidence. They
may inform the target; they do not silently define or authorize it. Keep the normative target and
the verification of what shipped distinct.

## Hard limits

Design:

- Never make a product story choose a control; never leave a material interaction choice implicit.
- Never let UX/XDS mint a missing business or product requirement; amend the owning BRD/PRD.
- Never claim exhaustive state coverage. Record reachable, material decisions and unknowns.
- Never let technical design silently alter an already-made experience decision.
- Never reverse artifacts that are actually needed: intent before product behaviour, product
  behaviour before its experience realization, and product/experience decisions before technical
  realization.
- Never create a standalone document when existing canon or the issue/PR already resolves the
  decision durably.
- Never let current implementation become authority for the target.
- Never blur target and as-built.
- Never leave a load-bearing decision only in chat or private reasoning.

Process:

- Never add manifests, spec/approval/conformance hashes, computed status ladders, evidence-type
  taxonomies, per-moment identities, reviewer-identity machinery, or artifact quotas.
- Never treat a document validator as design approval.
- Never respond to a process defect by adding a process layer.
- Never restart planning after direction is approved unless the user or owner changes direction,
  requirements are corrected, a material constraint is discovered, or concrete evidence invalidates
  it.
- Never let design material grow beyond what consequence and uncertainty justify; remove work that
  resolves no decision and reduces no plausible risk.

## Definition of done

Apply only the items relevant to the requested stage and change.

**Ready to implement:**

1. The smallest sufficient durable material was chosen; only the artifacts the decision needs were
   created or amended, in the right order.
2. The user, task, outcome, and observable acceptance are clear enough to falsify the decision.
3. Product requirements state what must be true; UX/XDS states how the person reaches, understands,
   and recovers through it without inventing new authority.
4. Material interaction, state, preservation, recovery, interruption, return, effort, abandonment,
   and non-goal decisions are explicit when the change has them.
5. Relevant Data · Time · Path · Frame prompts were considered without creating a completeness
   ledger.
6. Material visual or temporal decisions were rendered and inspected by the relevant reviewer.
7. Another agent can recover the controlling decision and known gaps without this chat.
8. Anything that forced no distinct decision was removed.

**Implemented change verified:**

1. The implementation preserves the chosen experience; constraints did not silently rewrite it.
2. The affected real flow and reachable material failure/recovery paths were exercised in a
   representative real host, or the exact unverified seam is recorded without a completion claim.
3. Repository-required checks and change-relevant tests were run; blocked checks are recorded
   honestly.
4. Reader-facing documents describe the current target and passed the audience-fit read.
5. Mechanical document checks, when the project uses them, report no broken references or malformed
   structure.
