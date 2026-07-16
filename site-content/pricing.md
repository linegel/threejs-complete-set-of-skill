---
kind: pricing
slug: /pricing/
title: Three.js WebGPU Skill Pack Pricing and License
description: See what the $0 Three.js WebGPU skill pack includes, how its licenses apply, and how to estimate adoption and production cost.
h1: The skill pack costs $0. Here is what still costs money.
primary_query: threejs webgpu skill pack pricing
query_aliases: ["threejs webgpu skill pack cost","threejs agent skill pack price"]
summary: Repository access costs $0. Repository-authored material is ISC licensed; incorporated files retain their stated licenses and notices. Coding-agent usage, engineering time, hardware, assets, hosting, migration, and support remain external.
related_skills: ["threejs-choose-skills","threejs-image-pipeline","threejs-visual-validation"]
related_demos: []
related_pages: ["/docs/install/","/faq/is-the-threejs-skill-pack-free-for-commercial-use/","/alternatives/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://github.com/linegel/threejs-complete-set-of-skill/blob/main/LICENSE","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-object-sculptor/LICENSE","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/package.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/README.md","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/labs/canonical-targets.json","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/docs/demos/registry.json","https://github.com/linegel/threejs-complete-set-of-skill/issues"]
---

## The exact price boundary

The Three.js WebGPU Skill Pack repository is available for **$0**. It has no pack-level account, activation key, subscription tier, or per-seat fee. That price is a repository access choice, not a consequence of its license terms.

Repository-authored material is ISC licensed; incorporated files retain their stated licenses and notices. The incorporated Three.js Object Sculptor files retain their MIT license and notice.

That does not make adoption or production free. The pack supplies specialist instructions, references, examples, demos, and validation tooling. The user supplies the coding agent, engineering judgment, hardware, assets, hosting, and operational work.

## Included here and paid elsewhere

| Included in this repository | Paid or supplied elsewhere |
| --- | --- |
| Published `threejs-*` Agent Skills | Coding-agent subscription or API usage |
| Checked-in skill references, assets, and scripts | Engineering, review, and technical-art time |
| Checked-in examples and lab source | Workstation, GPU, mobile devices, and browser test matrix |
| Demo registry, diagnostics, and evidence tooling | Optional generated, purchased, or commissioned assets |
| Site guides and machine-readable skill indexes | Production hosting, storage, bandwidth, and monitoring |
| Public repository updates when they are published | Managed migration, integration, training, or consulting |
| Public issue flow | Contracted support response or service-level agreement |

The right-hand column is not a list of mandatory vendors. It names cost categories the repository does not bundle. A local project with existing hardware and a flat-rate agent plan will have a different cost profile from a production team using metered APIs, commercial assets, and a large device matrix.

## License boundaries in plain language

For repository-authored material, the ISC license permits use, copying, modification, and distribution for any purpose, with or without fee. The copyright notice and permission notice must appear in copies. The software is provided as-is, without the warranties described in the license.

This is a practical summary, not legal advice. The exact [repository ISC license](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/LICENSE) and the retained [Object Sculptor MIT license](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/skills/threejs-object-sculptor/LICENSE) control their respective files.

| Question | Answer from the applicable license |
| --- | --- |
| Can I use repository-authored material in commercial work? | Yes, the ISC license permits use for any purpose with or without fee. |
| Can I modify it? | Yes. |
| Can I redistribute it? | Yes, subject to retaining the required notice. |
| Which license covers the incorporated Object Sculptor files? | MIT; retain its copyright and license notice as required. |
| Is a warranty included? | No. Both licenses provide the covered material as-is and disclaim warranties and liability as written. |
| Does the license include support? | No support commitment is created by the license. |

For the short canonical answer, see [commercial-use FAQ](/faq/is-the-threejs-skill-pack-free-for-commercial-use/).

## What the pack includes

The package manifest and repository currently publish specialist skill instructions plus their selected references, assets, and scripts. The repository also contains examples, lab source, integration demos, generated diagnostics, evidence reports, and site indexes. Verify an artifact's current status and source hash before relying on it as evidence for a claim.

The primary conversion is installation, not account creation. The README documents listing and installing skills through the open skills CLI, plus file-based use by compatible coding agents. After a complete install, `threejs-choose-skills` routes broad work to a smaller specialist set.

Repository material can change. "Included" means present in the published source or package being installed, not a promise that every current file will exist forever or that every requested Three.js domain has an owner.

## What the pack explicitly does not include

- A language model, coding-agent subscription, or API credit.
- A hosted application or managed runtime.
- GPU hardware, test devices, or browser infrastructure.
- A stock model, texture, audio, or production asset library.
- Production hosting, monitoring, storage, or bandwidth.
- Managed migration of an existing codebase.
- A paid support plan, guaranteed response time, or SLA.
- A guarantee that generated code is correct for a particular product.

The public repository and issue flow are the support channels documented today. They are not a contracted service level.

## Cost worksheet

Use named inputs rather than a fabricated package total:

```text
total adoption cost = agent usage
                    + engineering and review time
                    + optional assets and services
                    + hosting and hardware
```

For an internal estimate, record:

- agent plan or metered usage for implementation and review;
- engineer hours for architecture, integration, inspection, and rework;
- technical artist or domain expert hours where visual judgment is required;
- asset acquisition or generation inputs;
- target hardware and device-lab cost;
- hosting and operational cost;
- recurring upgrade, regression, and evidence-maintenance time.

Do not put volatile provider prices into the repository unless a named owner will review them. Link to the chosen provider's current billing source in the project estimate instead.

## Four adoption scenarios

### Evaluation

Estimate installation, one representative task, agent usage, engineer review, and validation time. The exit question is whether the pack improves a real workflow under the team's standards, not whether a demo merely runs.

```text
evaluation = setup + one bounded implementation + review + validation
```

### Solo project

Add integration time, optional asset or service cost, target-device checks, and hosting. A solo developer may save coordination time but still owns every technical and visual acceptance decision.

```text
solo project = evaluation + integration + assets/services + deployment
```

### Team rollout

Add onboarding, shared routing rules, permission review, code-review standards, evidence storage, and a maintenance owner. Installing the pack for every developer is $0 at the repository layer; supporting a consistent team workflow is not.

```text
team rollout = pilot + onboarding + governance + repeated project adoption
```

### Production maintenance

Add Three.js upgrade work, browser and device regression checks, evidence refresh, incident handling, asset/license review, and ongoing hosting. The pack can guide these tasks where a specialist owns them, but it does not operate the production system.

```text
production = rollout + upgrades + regressions + operations + incident work
```

## What different spending routes buy

| Route | What it can buy | Best fit | Boundary |
| --- | --- | --- | --- |
| This $0 pack | Reusable specialist instructions, examples, and validation contracts | Teams already able to run and review an AI coding workflow | Execution, judgment, hardware, and operations remain external |
| Course or structured tutorial | Human learning sequence and exercises | A person building foundational understanding | Price, revision, depth, and support depend on the chosen course |
| Consultant or contractor | Scoped expertise or implementation capacity | A team needing externally supplied work or review | Requires an actual scope, quote, ownership, and acceptance process |
| Internal playbook | Organization-specific rules and conventions | Teams with distinctive infrastructure and a maintenance owner | Authoring, review, and upkeep are internal costs |
| General AI prompt | Fast expression of one task and its local constraints | A bounded, well-understood change with strong review | Model usage and verification remain; repeated prompts can drift |

These options can combine. A team can use official docs for API truth, the pack for specialist procedure, an internal playbook for product rules, and a consultant for a bounded review. Pay only for a job that has a clear owner and acceptance condition.

## Support and maintenance boundary

An issue can report a reproducible problem, request clarification, or propose a correction. It does not guarantee triage time, a fix, compatibility with every agent, or production incident response. If a project needs a contractual response, arrange that separately and document its scope outside this repository.

The pack also needs normal dependency review. Before adopting a later Three.js revision, recheck upstream APIs, examples, labs, diagnostics, and evidence. A formatting-only update does not prove that a technical claim was revalidated.

## Limitations

The $0 statement applies to this repository, not to every tool used with it. Total cost varies by team, model, workload, assets, device coverage, and required assurance. This page intentionally gives formulas instead of invented external prices.

The license summary cannot replace legal review for a specific distribution. The public support boundary cannot replace an SLA. The pack cannot replace understanding the code, its side effects, and its behavior on the actual product.

Ready to evaluate it? Start with [installation](/docs/install/) and use one bounded representative task in an existing project.
