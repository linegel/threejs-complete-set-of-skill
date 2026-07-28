# Chain revalidation — threejs

## Unit preamble

NOT rebaselined on 2026-07-28 (held batch). Step zero: verify every doc claim
against current source and live state, fix stale docs, THEN do chain work.

## Task — revalidate and repair the product chain

Read `.claude/skills/product-from-scratch/SKILL.md` in this repo FULLY before any
other work. It is the binding method. Then revalidate, improve, and fix this
repo's BRD → PRD → UX/XDS → SD chain:

1. **BRD** — business intent: why this exists, target audience, outcomes,
   non-tradables, viability. Ads-monetized content (guides, databases, news) is
   a viable business model. If no BRD exists, author a proportional one — a
   placeholder repo gets ONE page answering "why does this exist and what would
   make it worth building", never a four-document chain.
2. **PRD** — falsifiable product stories and rules, only for surfaces that
   actually exist or are concretely planned. PRD owns WHAT; design owns HOW;
   design never mints requirements.
3. **UX/XDS** — only where a material experience decision exists.
4. **SD/SDD** — only where a material technical decision exists.

Proportionality and the budget law govern size: design work must be materially
cheaper than implementing twice. Reuse and relink existing docs instead of
duplicating. Docs are CLEAN HTML, RFC-like, anchor links, many-to-many
relinking (a README.md index pointing into the HTML corpus is fine).

The repo's docs were rebaselined to current state on 2026-07-28 (unless the
preamble above says otherwise). Items marked "unknown" or "unresolved" in those
docs are your revalidation targets: verify from source where the context budget
allows, otherwise record them as owner-only questions in your report — never
guess, never delete them.

**Cap: at most 5 BRD chains in this run.** If real scope exceeds 5, complete 5
and end your report with the ordered remainder list.

## Hard rules

- **EXECUTION AUTHORITY** — you run one-shot; never stop to ask approval. For
  any blocker, make the safe choice, proceed, and report the choice. Work left
  uncommitted is a failed run.
- **CONTEXT BUDGET** — read docs fully; read source only at entry points
  (configs, package manifests, route/handler entry files); NEVER walk whole
  source or data trees.
- **SAFEGUARDS ARE NEVER DELETABLE** — owner gates, numeric thresholds,
  validation criteria, security/setup runbooks, and stop rules are CONTENT, not
  format. Never delete or dilute them, even when embedded in files whose format
  you are changing. Format questions go to the owner in the report.
- **LEGAL OUT OF SCOPE — ABSOLUTE** — never read, analyze, or report on privacy
  policies, ToS, cookie/consent policies, legal entities, trademarks, or
  compliance. A separate agent lane owns legal. If work runs into a legal
  surface, write one line — "legal-surface item observed at <path> — out of
  scope, legal lane owns it" — and move on. Functional claims only.
- **No bureaucracy** — no statuses, hashes, approval records, resolvers,
  registers, or merge gates. Document validity is human review.
- **No subagents** — complete all work directly yourself.
- Commit your changes in THIS repo only, message prefix `docs(chain):`. NEVER
  push. Never stage files you did not author (other agents may have uncommitted
  work here).
- Report: commit hashes, per-doc summary of what changed and why, functional
  findings with file:line citations, owner-only questions, remainder list if
  the 5-chain cap was hit.
