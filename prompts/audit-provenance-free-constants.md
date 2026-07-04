# Audit: Provenance-Free Constants and Laundered Implementation Fingerprints

**Audience calibration**  
You are reviewing technical contracts written for Comp Sci and Physics majors and PhDs. That audience will re-derive every number. Your job is to find the numbers that cannot be re-derived — because they are not facts about the problem; they are facts about some prior implementation that leaked into the doc and lost its attribution.

**Scope**  
<TARGET_PATHS> (the skill pack under review). Any reference to code, measurements, or "proven" results outside these paths is contamination by definition — the external source is presumed broken and untrustworthy. Treat de-attributed residue of such sources as equally contaminated: stripping the name while keeping the constants is laundering, not cleanup.

---

## The Core Test

For every quantitative or categorical claim, force it into exactly one bucket:

1. **Derived** — reproducible from the doc's own stated parameters and standard theory, with the derivation visible or one obvious step away.  
   Examples of correct form:  
   - verts/slot = (2 + 2c)r + 2  
   - FD gradient cost = 7 field taps (center + 6 offsets)  
   - RGBA16F @ 1080p = 2,073,600 × 8 B ≈ 16.6 MB  
   - retention form 1 − pow(k, dt) is the unique dt-invariant expression for exponential decay under per-frame compounding.

2. **Gated** — declared as a threshold that an implementation must satisfy, accompanied by a verification mechanism (numeric gate tables, budget ceilings stated as design inputs, "measure in the lab" claims with explicit harness or parity test). Acceptable only if the gate names its verification procedure.

3. **Orphaned** — a specific number, ratio, benchmark, or "sane default" that has no derivation, no gate, and no stated principle. These are the findings. Every orphan is either (a) a fingerprint of a dead implementation, (b) a benchmark run on an untrusted codebase, or (c) a decision from the sky.

---

## Fingerprint Signatures — What Laundering Looks Like

- **Arithmetic echoes of a foreign constant.**  
  Example: 24 × 3 where 24 was one project's budget. Detect by factoring: if a number decomposes cleanly through a constant that should be a parameter (maxParts, grid size, tier count), the doc has hardcoded someone else's doctrine.  
  Fix: replace with the closed-form expression in the doc's own parameters; demote the constant to an explicitly-named default.

- **Cost figures with hidden operands.**  
  "~720 evaluations per vertex for a 24-part creature." A real cost model shows the product: (snapSteps + 1) · 7 · maxParts. A bare number without its formula is a measurement of an unnamed shader.  
  Fix: publish the counting argument; keep example instantiations only when they are clearly labeled as such.

- **Comparative benchmarks against a ghost.**  
  "9 creatures vs 200", "difference between X and Y fps." Any A-vs-B performance ratio where B is an implementation (not a theoretical bound) and is not reproducible from the doc is inadmissible — doubly so when B's provenance is a condemned codebase whose least trustworthy artifacts are its performance numbers.  
  Fix: delete, or replace with a construction (ALU/bandwidth counting) plus a deferral to the pack's measurement harness.

- **Anti-pattern tables that are diffs.**  
  A "regression ledger" whose left column enumerates one specific project's mistakes, row by row, is that project's ghost even with the name removed. Legitimate anti-patterns are stated as violated invariants (order-dependent smooth-min, variable dt, O(budget) work where O(actual) suffices), not as inventory of a corpse.  
  Fix: generalize each row to the invariant it violates, or delete the table.

- **Authority phrases without a verifier.**  
  "Proven in production", "the proven implementation", "battle-tested", provenance ledgers, absolute paths (/Users/...), monorepo package names (@scope/pkg), sibling-repo references. In a self-contained contract these are authority laundering — the reader cannot audit the source.  
  Fix: the formula's derivability and the gate table are the only admissible authorities. Any external implementation may serve as test input, never as provenance.

- **Physics-shaped numbers that aren't physics.**  
  A tolerance like 0.95–1.05 on a gradient magnitude is only valid on the domain where the underlying field actually satisfies |∇d| = √(1 + s²) for a tapered capsule. When a threshold encodes an unstated domain restriction (e.g. |s| ≤ 0.32), either state the bound or normalize the quantity.  
  Same discipline for any "standard approximation" label: check it. Some are exact (polynomial-smin gradient mix in the unclamped interior — the ∇h cross terms cancel identically) and mislabeling them is also a defect.

---

## Procedure

1. **Grep before reading.**  
   Search for: absolute paths, ~/, /Users/, production-proven|shipped|battle-tested, and every literal with ≥2 significant figures that appears more than once. Repeated magic numbers are the strongest fingerprint signal.

2. **Read each hit with full context and run the three-bucket test.**  
   For bucket-1 claims, actually redo the arithmetic (texture bytes, vertex counts, dispatch products, gradient derivations). Wrong derivations are a separate finding class from orphans.

3. **Factor every suspicious constant.**  
   Ask: does this number decompose? Is the factor a parameter declared in the doc, a named default, or a foreign constant?

4. **For each orphan, propose the generalization path:**  
   closed-form expression in declared parameters → named default with the expression visible → executable gate with deferral to measurement → deletion.  
   Never "soften the wording" — a hedged orphan is still an orphan.

5. **Report per finding:**  
   file:line, the claim, its bucket, the factoring/derivation that exposes it, and the exact replacement text. Rank by how load-bearing the claim is (cost models and field equations before flavor text or example values).

---

## Non-Goals

- Do not pad findings with style complaints.
- Do not attack legitimately gated thresholds or honest design inputs.
- Do not delete worked examples that are clearly labeled instantiations of a published formula.
- The target is unearned specificity and hidden provenance, not specificity itself.

---

**Output format (strict)**

For each finding produce a block of this form:

```
<file:line>
Claim: "..."
Bucket: Orphaned | Derived (but incorrect) | Gated (but unverifiable)
Evidence: [factoring or failed re-derivation]
Impact: [why this matters for performance, correctness, or auditability]
Replacement: exact text or deletion instruction
```

End with a short ranked list of the highest-load-bearing orphans and a one-sentence summary of the pack's overall provenance hygiene.

This prompt is self-contained. Hand it to a zero-context agent together with the absolute paths of the skill(s) under review.