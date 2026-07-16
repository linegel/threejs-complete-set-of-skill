---
kind: faq-answer
slug: /faq/which-threejs-skill-should-i-use-first/
title: Which Three.js Skill Should I Use First?
description: Use the routing skill for broad multi-system work and a domain skill directly for focused tasks. See the exact decision rule and proof.
h1: Which Three.js skill should I use first?
primary_query: which threejs skill should i use first
query_aliases: ["what threejs agent skill should i start with","threejs choose skills first"]
summary: Use threejs-choose-skills first only when a request spans multiple rendering systems or ownership is unclear. It selects the smallest causal set and returns the current route fields: primaryOwner, selected, deferred, gaps, handoffs, resources, passes, output, and verification. For a focused task such as bloom, camera control, or ocean simulation, load that domain skill directly. Install the pack before using the router because its selected domain skills must be available.
related_skills: ["threejs-choose-skills"]
related_demos: []
related_pages: ["/docs/choose-skills/","/agents/routing-and-minimal-context/","/faq/which-threejs-version-does-the-skill-pack-support/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md"]
question_source_type: verified-local-failure
question_sources: ["local:skills/threejs-choose-skills/SKILL.md#route-result"]
first_observed: 2026-07-16
last_observed: 2026-07-16
canonical_route: /faq/which-threejs-skill-should-i-use-first/
evidence_status: verified
faq_group: skill-routing-and-usage
---

## Direct answer

Use threejs-choose-skills first only when a request spans multiple rendering systems or ownership is unclear. It selects the smallest causal set and returns the current route fields: primaryOwner, selected, deferred, gaps, handoffs, resources, passes, output, and verification. For a focused task such as bloom, camera control, or ocean simulation, load that domain skill directly. Install the pack before using the router because its selected domain skills must be available.

## The decision rule

Load one domain skill directly when one system clearly owns the task. Examples include a camera rig, a bloom stage, a procedural material, or a bounded-water surface. Direct routing keeps agent context smaller and makes the implementation owner explicit.

Load `threejs-choose-skills` first when a request spans several rendering systems, crosses resource or presentation boundaries, or leaves ownership unclear. Its current route result records:

- `primaryOwner` and the minimal `selected` set;
- conditional `deferred` skills and explicit `gaps`;
- ordered `handoffs` between producers and consumers;
- consumed `resources` and required `passes`;
- one final `output` owner and causal `verification` checks.

The router must report a missing owner when the pack does not cover the required asset, semantic-scene, lighting, or external-physics work. It must not stretch a nearby graphics skill over that gap.

## Contract basis

The installed [`threejs-choose-skills` route-result contract](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-choose-skills/SKILL.md#route-result) is the authoritative source for this answer. It defines the compact route fields and requires every requested observable to have one owner or an explicit gap. A route remains provisional until its declared verification checks pass.

## Conditions and limitations

- The router chooses guidance; it does not implement or validate every selected system by itself.
- The smallest useful set depends on the workload, target devices, data flow, and acceptance criteria.
- Installing only the router leaves its selected domain skills unavailable. Install the pack, then use the router within it.
- The route remains provisional until its declared verification checks pass.

Use the full [skill-selection procedure](/docs/choose-skills/) or the stricter [agent routing and minimal-context contract](/agents/routing-and-minimal-context/). Confirm the [supported Three.js revision](/faq/which-threejs-version-does-the-skill-pack-support/) before following revision-specific output.

## Question provenance

This question comes from a verified local routing failure: a broad request reached the decision boundary without an explicit owner or gap. The answer is rooted in the authoritative installed `threejs-choose-skills` route contract, not a public user question. First observed, last observed, and answer reviewed 2026-07-16.
