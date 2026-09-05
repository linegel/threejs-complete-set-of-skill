# product-from-scratch

A Claude Code skill for designing a product change before building it, at a cost the change can
afford.

```text
BRD  when business intent changes
PRD  when product behaviour changes
XDS  when a material experience decision exists
SDD  when a material technical decision exists
```

Each layer is used only when its decision exists. A small fix may live entirely in its issue or PR.
The skill supplies the story, scenario, and state grammars for writing these documents, a
vocabulary for naming controls by behaviour, and the review and verification rules. It produces no
statuses, hashes, approval records, or merge gates.

## Install

Copy this directory to `.claude/skills/product-from-scratch` in the project, or to
`~/.claude/skills/` for every project.

## Contents

| Path | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | The method |
| [`references/vocabulary.md`](references/vocabulary.md) | Control, pattern, and state names defined by the behaviour that separates them |
