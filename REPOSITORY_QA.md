# Repository QA and release boundaries

The 27 real directories under `skills/` are the installable product. Each may
contain `SKILL.md`, `agents/openai.yaml`, references, scripts, and a license.
Top-level `threejs-*` examples and all labs, generated evidence, and site output
are repository material; the skills CLI must not copy them.

Validation guidance inside a skill describes how an agent checks Three.js work
created with that skill. It is not a release procedure for this repository.

## Skill product gate

`npm run skills:check` validates the exact roster, real-directory layout,
frontmatter, invocation metadata, linked product resources, and absence of
repository-only sediment. A release must also pass one real
`skills add . --skill '*' --copy` smoke install and compare the installed tree
byte-for-byte with `skills/`.

A release stops for a technical error, contradictory or irrelevant guidance,
an invocation error, a broken product link, or an unexpected installed file.

## Independent demo and publication contours

Labs and integration labs are runnable demonstrations. Their registry is a
catalog, not acceptance authority for skills. Demo status may be incomplete,
draft, stale, or featured without changing the release state of a skill.

- `labs:*` builds and checks runnable demos.
- `evidence:*` (where present) validates claim-scoped demo evidence and media.
- `pages:*` builds and validates the website and gallery.

These commands may be used for demo development and marketing publication, but
they are not prerequisites of `skills:check`. A featured demo
should have current curated media bound to its demo build; a broken or missing
demo, screenshot, video, evidence report, or site build does not block the skill
package.

Repository contributors should add only workload-relevant validation guidance
to skills. Repository paths, package commands, lab statuses, evidence schemas,
automation identities, fixed artifact matrices, and repository release states
belong outside the published skill corpus.
