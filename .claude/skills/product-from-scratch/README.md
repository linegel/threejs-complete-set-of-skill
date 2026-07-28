# product-from-scratch

Design before code, at a cost the change can afford.

```text
BRD when business intent changes
  → PRD when product behaviour changes
    → UX/XDS when a material experience decision exists
      → SDD when a material technical decision exists
        → implementation → verification
```

A thinking aid for product and experience design: conditional artifact selection, product stories
that make outcomes falsifiable, interaction scenarios that name what users actually do,
Data · Time · Path · Frame prompts for material states, reuse-first control selection, rendered
design review, durable repository/PR handoff, and real-flow verification.

The chain is a **decision order, not a checklist to recreate in every PR**:

- use a BRD when business intent, users, outcomes, scope, or non-negotiable qualities change;
- use a PRD for a new capability or material product-behaviour change;
- add UX/XDS when the capability introduces or materially changes a journey, cross-surface seam,
  hierarchy, state model, shared control, or interaction choice;
- add an SDD for consequential architecture, data, security, deployment, performance, or
  cross-module decisions.

Ordering applies only to artifacts the change needs. Conditionality prevents dummy documents; it is
not permission to skip an unresolved decision. Small maintenance work may live entirely in its issue
or PR and link existing canon.

The method keeps four boundaries explicit:

- **BRD defines why and for whom.** It owns the problem, outcomes, scope, acceptable friction, and
  qualities that may not be traded away.
- **PRD defines what the product must do.** It owns product stories, rules, data, permissions,
  required outcomes/invariants under success, failure, interruption, recovery, and return, non-goals,
  and observable acceptance. It does not choose detailed controls or composition.
- **Experience design defines how the person understands and acts through those rules.** It owns the
  journey, controls/events, visible responses, states/transitions, copy, feedback and recovery
  ownership, preservation, return, hierarchy, responsive behaviour, motion, and meaningful
  alternatives. It may not invent a missing business or product requirement; amend the BRD/PRD.
- **Technical design realizes the chosen product and experience.** A feasibility conflict reopens
  the owning decision; it does not silently redesign around the data model.

It is **not** a governance system. The earlier method grew manifests, hashes, status ladders,
approval/conformance records, evidence taxonomies, reviewer machinery, completeness matrices, and a
CI-wired resolver. Those mechanics cost far more than the product decisions they were meant to
support. `SKILL.md` keeps the useful parts and prohibits rebuilding the certification layer.

## Contents

| Path | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | The method: budget law, conditional chain and authority boundaries, proportionality, product-story and interaction-scenario grammars, state prompts, control selection, rendered review, durable handoff, and verification |
| [`references/ui-ontology/web-ui-master-vocabulary-checklist.md`](references/ui-ontology/web-ui-master-vocabulary-checklist.md) | The vocabulary by family — consult only relevant families |
| [`references/ui-ontology/web-ui-master-vocabulary-alphabetical.md`](references/ui-ontology/web-ui-master-vocabulary-alphabetical.md) | The same names alphabetically, for targeted lookup |
| [`references/distinctions.md`](references/distinctions.md) | Rulings on overloaded names such as _dropdown_, _modal_, _tab_, and _toast_ |

The vocabulary is a **dictionary, not a gate**. It lets two documents name the same thing precisely,
so disagreement can be about the decision rather than the word. A project-specific term may be
defined locally. Its rows create no feature, documentation, review, verification, accessibility,
specialist-workstream, or evidence obligation. Imprecision is a review comment, never a computed
verdict.

## Vocabulary provenance

The vocabulary rows originate in `ui-ontology` at `500f54f` and are bundled so the skill works when
loaded. Reusable row corrections belong upstream and the copy is refreshed; one-off product concepts
stay in the product that owns them. The short **Notes on use** in the categorized checklist is local
integration guidance: rows are lookup candidates and do not become a methodology.

## Adopting it in a project

A project keeps only the business, product, experience, and technical decisions that its work needs.
Normative documents state the current target; issues and PR descriptions/threads preserve the
load-bearing rationale, accepted/rejected alternatives, deviations, actual verification, inaccessible
scenarios, and known gaps another stateless worker needs.

Ordinary links replace duplicated prose. A legacy project does not owe a corpus backfill before a
small correction. Nothing else is required — no adoption profile, resolver, status vocabulary,
approval hash, evidence taxonomy, completeness matrix, or fixed reviewer program.

Mechanical document lint may catch broken links, duplicate IDs, missing references, or malformed
format. It may not approve a design or substitute for inspecting material renders and exercising the
real user flow in the real host.
