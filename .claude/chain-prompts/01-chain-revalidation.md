# Chain revalidation — threejs

## Unit preamble

NOT rebaselined on 2026-07-28 (held batch). Phase 1 carries the full weight
here: verify every doc claim against current source and live state before
any design work.

## Mission

Bring this project's product documentation to current, verified state, then
design whatever work is genuinely next. You are the orchestrator; subagents
execute bounded assignments and never delegate further.

## METHOD — binding, read before anything else

Read `.claude/skills/product-from-scratch/SKILL.md` in this repo FULLY (canon:
`github.com/LocSo/product-from-scratch`). Follow it exactly, including its
budget law and its bureaucracy prohibitions. Everything below is subordinate
to that skill — where this prompt and the skill disagree, the skill wins.

Two phases govern all content work:

- **PHASE 1 — truth before design.** Every existing doc read end to end and
  rewritten to current state only: no "previously we…", no invented facts,
  unknowns stated as unknown. Every claim about a live surface verified
  against the live surface. Public copy that promises behavior the code does
  not implement is REPORTED, not fixed. No BRD/PRD/XDS/SD authoring in this
  phase; no backfilling a chain for work already shipped.
- **PHASE 2 — design only what a decision requires.** No per-feature artifact
  quota; weight comes from the skill's proportionality rules: small change →
  a short experience brief in the plan or PR; a feature → one design
  document; a journey → one coherent journey document. Author BRD/PRD upward
  only where a business or product decision must outlive this change. A
  capability with no decision to record gets no document. Ads-monetized
  content (guides, databases, news) is a viable business model.

Craft rules for everything authored in Phase 2:

- Every user story uses the skill's product-story grammar (Arrives at /
  Abandons at / Falsified by).
- State coverage is GENERATED via Data · Time · Path · Frame — with a stated
  reason on every "cannot occur".
- Felt quality is committed as observable values (~100 ms acknowledgment,
  ~1,000 ms slow state), never as adjectives.
- PRDs own WHAT; design owns HOW; design never mints a requirement.
- BRDs scope into blocks, blocks into the product — keep that hierarchy
  visible.
- Maintain a docs index page: every doc listed once with a one-line condensed
  summary, so nothing duplicate gets written.
- Docs are clean RFC-style HTML, cross-linked many-to-many, current state
  only.
- Technical documentation prose adheres to ADS-STE100 Simplified Technical
  English: short sentences, one instruction per sentence, approved-word
  discipline, active voice. NOTE: break this rule freely — every single time —
  when the words must show a specific and exact thing: concepts, approaches,
  paradigms; UI, design, or UX elements; established domain and industry
  terms of art; product, brand, and feature names; code identifiers (APIs,
  functions, config keys, CLI commands, file paths); standards, protocols,
  and third-party tool names; verbatim user-facing copy being specified;
  quoted upstream canon statements (grounding quotes stay verbatim); precise
  metrics, units, and numeric commitments; user-research verbatims.
  Exactness beats simplification wherever the exact term IS the content.
- Downstream docs GROUND themselves in upstream canon: a PRD quotes the exact
  BRD statement it satisfies and anchors it; XDS/SD do the same against the
  PRD. Verify alignment by following the links, both directions.

## FIGURES — documentation visualization is a feature, not decoration

Figures materially help humans and agents understand the docs — author them
wherever a picture carries the meaning better than prose. **The medium is
chosen by the figure's job — different use cases require different
mediums:**

- Precise structure — architecture, flows, state charts, wireframes, data
  relationships, timelines → inline SVG: exact, diffable, controllable.
- Visual/illustrative content — concept art, mood and style direction, hero
  imagery, product illustration, anything photographic or artistic →
  GENERATED IMAGE. Do not fake these with SVG.

Whichever medium: iterate until the figure is actually correct for its
description. Figure-finalization loops are VERIFICATION — repeat as many
times as needed; they never consume the review budget. Only when image
generation repeatedly fails to produce a correct image for a description
that precision could express, switch that one figure to a
precisely-controllable form. Every figure is referenced from the text that
depends on it, and stills never certify motion or interaction feel.

## STAGES — how the run is orchestrated

Proportionality applies to orchestration too: in a small repo (a handful of
docs, one surface) run Stages 1–5 yourself with no subagents at all. Fan out
only when the reading or verification volume genuinely exceeds what you can
hold. Never launch a subagent whose assignment you could finish faster
yourself.

**Work-separation law (all stages):** you are the ONLY writer and the only
committer. Subagents read, verify, and draft in their reports; they never
edit repo files, never commit, never delegate. Partition assignments so no
two subagents own the same doc or surface for the same purpose — overlap is
reserved for deliberate cross-verification of the riskiest claims. Every
assignment states its bounded reading budget: named docs in full, source only
at named entry points (configs, manifests, route/handler entries), never
walking trees.

### Stage 0 — scoping (orchestrator, solo)

Read the skill, this prompt's preamble, AGENTS.md/CLAUDE.md, the family
README if any, and the docs index. Inventory: every doc, every product
surface (routes, pages, commands), every configured hostname. Count candidate
BRD chains and rank them by business value. **Cap: at most 5 BRD chains in
this run; one agent carries at most 5 BRDs.** If real scope exceeds 5, take
the top 5 and record the ordered remainder for the report. Decide what gets
delegated and what you do directly; write the partition down before
launching anything.

### Stage 1 — truth sweep (parallel read-only subagents)

One subagent per doc cluster or surface from the partition: each verifies
that cluster's claims against source entry points and returns findings with
file:line citations — stale claims, invented facts, doc-vs-code mismatches,
unknowns. Where a live host exists, one subagent exercises the live surface
and reports what is actually served. Put two subagents with overlapping
scope on the riskiest claims so they verify each other. Subagent reports are
not authoritative: verify cited evidence yourself, then rewrite the docs to
current state and commit Phase 1 before any design work starts.

### Stage 2 — business and product framing (drafting subagents)

For the selected chains (family business re-evaluation first when the
preamble assigns a 00 prompt): one drafting subagent per chain — or one
carrying several, never more than 5 BRDs per agent. Each receives the
Phase-1-verified current state for its scope and returns DRAFT content in
its report: business intent, outcomes, viability verdict with evidence,
stories in the grammar, generated state coverage. Drafts are raw material,
not canon.

### Stage 3 — convergence (orchestrator, solo)

Judge the drafts against the skill and against each other. Resolve
contradictions, deduplicate against the index, enforce the block hierarchy
and the craft rules, then author the canon HTML yourself and relink
many-to-many. No document enters canon that you have not read end to end.

### Stage 4 — the single review round

One review round for this task, total, across all sessions and models: one
subagent that authored nothing reads the finished chain end-to-end against
the skill's definition of done and reports defects. Resolve its material
findings directly. No review-of-review, no "until aligned", no
re-inspection after fixes. Small changes skip this stage and use ordinary
review.

### Stage 5 — delivered, not executed

The task is done when the result holds up, not when steps ran. If this run
commits to user-facing behavior, exercise the real path — success, failure,
recovery, interruption, return, narrow width — against the real surface: an
instrumented walk verifies commitments, a human judges feel, and when the
human disagrees with a passing walk, the human is right and the design was
missing a commitment. Docs-only runs instead verify every rewritten claim
against the live surface. Then final commits and the report.

## COST CEILING

Design effort must cost materially less than implementing the change twice.
Any artifact or field that fails to force a decision gets dropped. No
manifests, hashes, statuses, approval or conformance records, evidence
taxonomies, or document validators wired into any gate. On a defect, remove
the unreliable claim — never add a process layer.

## HARD RULES

- **EXECUTION AUTHORITY** — you run one-shot; never stop to ask approval. For
  any blocker, make the safe choice, proceed, and report the choice. Work
  left uncommitted is a failed run.
- **SAFEGUARDS ARE NEVER DELETABLE** — owner gates, numeric thresholds,
  validation criteria, security/setup runbooks, and stop rules are CONTENT,
  not format. Never delete or dilute them; format questions go to the owner
  in the report.
- **LEGAL OUT OF SCOPE — ABSOLUTE** — never read, analyze, or report on
  privacy policies, ToS, cookie/consent policies, legal entities, trademarks,
  or compliance. A separate lane owns them. One line only: "legal-surface
  item observed at <path> — out of scope, legal lane owns it." Functional
  claims only.
- **Committed secrets** — report presence and location only; NEVER reproduce
  values in docs, reports, or commits.
- **Shared tree only** — work on the current branch in this checkout. Never
  create branches, worktrees, alternate clones, or isolated copies.
- **Coexistence** — read `hey.md` (repo root) before starting; other agents
  may be active. Leave a note there for anything they must know; never block
  on them. Never stage files you did not author.
- **Scratch discipline** — keep working notes outside the repo. Any temp file
  that must land in-repo is registered in `TEMP_ARTIFACTS.md` the same turn
  it is created and deleted the same session once absorbed.
- **Browser hygiene** — inspect open tabs first and reuse a suitable one;
  close every tab you open before finishing; never orphan an authenticated
  tab.
- Commit in THIS repo only, message prefix `docs(chain):`. NEVER push.

## REPORT

Commit hashes; per-doc summary of what changed and why; functional findings
with file:line citations; owner-only questions; the ordered remainder list if
the 5-chain cap was hit; every subagent launched, its assignment, and whether
you accepted or rejected its claims.
