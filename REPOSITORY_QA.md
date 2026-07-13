# Repository QA and release boundaries

The `threejs-*` directories are the product. Their `SKILL.md` files, references,
assets, and product helpers are the only contents eligible for the published
skill package. Validation guidance inside a skill describes how an agent should
check Three.js work created with that skill; it is not a release procedure for
this repository.

## Skill product gate

`npm run skills:check` is the skill-product quality gate. It checks the authored
skill corpus, router behavior, product-resource links, the install projection,
and the exact `npm pack --dry-run` contents. A skill release must stop for a
technical error, contradictory or irrelevant guidance, a router error, or a
missing packaged product resource.

`npm run skills:pack` has exactly one prerequisite: `skills:check`. The package
uses an explicit allowlist and excludes examples, labs, repository tests,
browser automation, raw captures, evidence machinery, generated pages, and
other repository QA executables.

## Independent demo and publication contours

Labs and integration labs are runnable demonstrations. Their registry is a
catalog, not acceptance authority for skills. Demo status may be incomplete,
draft, stale, or featured without changing the release state of a skill.

- `labs:*` builds and checks runnable demos.
- `evidence:*` (where present) validates claim-scoped demo evidence and media.
- `pages:*` builds and validates the website and gallery.

These commands may be used for demo development and marketing publication, but
they are not prerequisites of `skills:check` or `skills:pack`. A featured demo
should have current curated media bound to its demo build; a broken or missing
demo, screenshot, video, evidence report, or site build does not block the skill
package.

Repository contributors should add only workload-relevant validation guidance
to skills. Repository paths, package commands, lab statuses, evidence schemas,
automation identities, fixed artifact matrices, and repository release states
belong outside the published skill corpus.
