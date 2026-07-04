# GROK_BUILD_PROBLEMS.md — Revised Audit of Three.js Graphics Skills (Correct Scope: Workspace Tree)

**Date:** 2026-07-05 (re-audit after direct review feedback)  
**Auditor posture:** Comp Sci + Physics PhD. Zero water. Evidence-first.  

**Critical Scope Correction (this report's primary defect in prior iteration):**  
The previous version of this document audited only `~/.claude/skills/threejs-*/` (stale installed snapshot). That tree is superseded. The active development and current pack live in the workspace: `/Users/linegel/_reps/threejs/threejs-*/` (SKILL.md + references/*.md).  

The two trees diverge substantially (image-pipeline ref: 195 → 333 lines; spectral: 471 → 604; volumetric: 579 → 632; structural rewrite of contracts, addition of temporal/velocity language, removal of legacy exemplars). File:line citations from the snapshot do not map to the current pack.  

**Correct action indicated by this audit:** Sync the `~/.claude/skills/threejs-*` snapshot from the workspace sources, or remove the stale snapshot entirely so that only the workspace versions are treated as authoritative. This is not "fix the defects listed against the snapshot"; it is "stop auditing the superseded artifact."

All analysis below is performed exclusively against the workspace tree. Subagents (Codex gpt-5.5 high) and direct reads were used on workspace paths only for this revision.

## 1. Workspace vs Snapshot Divergence (Evidence)

**Image-pipeline signal table (snapshot .claude version, ~120-132):**
```
| depth | scene or prepass | AO/fog/flare | renderer-defined | full | no |
... (no velocity row)
```

**Image-pipeline (workspace, ~100-110):**
```
| velocity | scene `pass()` MRT `velocity` | `TRAANode`, motion blur, temporal denoise | RG16F ... | data | previous matrices | disable temporal nodes |
... explicit depth policy declaration required, convention table for reversedDepthBuffer / view-Z reconstruction, etc.
```

**Legacy exemplars:**  
Grep for "selective gallery", "atlas-based renderer", "Miller", "pooled VFX", "cinematic implementation" in workspace `threejs-*/references/*.md` returns zero matches in the core high-impact refs. The workspace versions contain "Replaced Techniques" sections that explicitly call out what was wrong with prior approaches and what replaced them.  

The snapshot still contains the old graph descriptions and the old failure-analysis exemplars.

**Detail mix (both trees — live issue):**
Both contain:
```
topModifier = detail^6
bottomModifier = 1 - detail
modifier = mix( topModifier, bottomModifier, remapClamped(heightFraction, 0.2, 0.4) )
```
(Prose claims upper fluffy / lower whippy; the mix applies the opposite.)

**Cascade inBand (both):** closed `step.mul(step)` with text "Adjacent bands may touch at a boundary; they must not broadly overlap..."

**Jacobian (workspace improved):** now publishes `crossAndJacobian.rgba` containing the cross term.

## 2. Infection Directive — Correct Application

The directive ("ANY REFERENCE OUTSIDE OF THOSE SKILLS MUST BE CONSIDERED INFECTED... islands project") targets imported authority ("this was proven in the islands project").  

It does **not** apply to internal failure-analysis teaching material that *names* a superseded pattern and then enumerates its defects ("selective bloom renders the scene multiple times", "composer may not be the active runtime path", "manual shadow invalidation can freeze unregistered motion").  

Workspace versions have already performed the cleanup. In the current pack, anti-pattern pedagogy is largely replaced by "Replaced Techniques" lists. No further "infected" flags are warranted for the remaining cautionary references.

## 3. Cascade Masks (re-derived on workspace text)

Workspace (spectral-cascade-ocean-system.md):
- `const inBand = step( cutoffLow, kLength ).mul( step( kLength, cutoffHigh ) );`
- "Adjacent bands may touch at a boundary; they must not broadly overlap or leave visible holes."

Handoffs = `2π · boundaryFactor / patchLength_i`. Bins = `2π n / patchLength_i`. Different patch lengths per cascade make exact bin-center collision on a handoff a measure-zero event for any realistic preset. At worst a handful of bins out of 512².

The real guidance in the same section (clamp k before mask, never hide 1/0/NaN/inf by multiplying by the inBand mask) is more important.

**Severity:** P2 (make one side of the interval half-open + add a unit test for the specific presets). Not critical.

## 4. Jacobian / Slope Formula (re-derived on workspace text)

Workspace:
```
crossAndJacobian.rgba = [lambda * dDz/dx, jacobian, ...]
jxx = 1 + lambda * dDx/dx
jzz = 1 + lambda * dDz/dz
jxz = lambda * dDz/dx
J = jxx * jzz - jxz²
...
slopeX = sum(dHeight/dx) / (1 + sum(lambda * dDx/dx))
```

Under a single scalar height spectrum the horizontal displacement is irrotational, so ∂Dx/∂z ≡ ∂Dz/∂x. The determinant J is therefore exact.

The slope formula is a diagonal approximation to the proper world-space gradient `∇h · F⁻¹` (it drops the shear/cross terms). The document labels the fold-aware version as the "compression correction."

**Correct statement:** The cross term is published. The slope formula is a documented, quantifiable diagonal approximation. Label the approximation and bound its error for oblique/choppy cases. P2.

## 5. Detail Height Mix (confirmed live in workspace)

As quoted above. `mix(topModifier, bottomModifier, heightFraction)` applies the "top" (billowy) modifier at low heightFraction (bottom of the layer).

This inverts the stated intent and the standard Schneider-style vertical profile (whispy erosion low, billowy high). Genuine defect in the reference text.

## 6. The Strong Convergent Cluster — Temporal / Velocity / Depth / Exposure Ownership

This cluster survives re-audit on the correct tree and is the most valuable output of the entire exercise (converges with prior independent reviews).

**Workspace image-pipeline now states:**
- Velocity is an explicit MRT signal with previous matrices.
- Temporal is opt-in: "Add temporal history only when the velocity contract is complete."
- Must declare depth convention (reversedDepthBuffer / log / standard) and the view-Z reconstruction used by every consumer.
- One tone-map owner; exposure meter from reduced HDR.

**Remaining gaps (still real):**
- GTAO / atmosphere / clouds / water refraction consumers must actually consume the declared convention and the velocity when they claim temporal behavior.
- Double exposure (adapted × renderer toneMappingExposure) remains a failure mode when both are live.
- Representative depth for multi-layer volumes (clouds) still needs a contract when temporal reprojection is used.

Three reviews from independent directions identified the same weakest composed contract in the pack: temporal signal ownership (velocity convention + sign + jitter, depth reconstruction policy, history validity).

## 7. Foam History and Cloud Shadow Representation

These are explicitly stylized/compact representations with display-vs-simulation separation in the contracts. 

Demanding a full physical source/decay advection PDE for foam history or exact line-integral transmittance from a 4-channel compact shadow product applies rigor to targets the skill text does not claim. Retain as observations at lower severity.

## 8. Evidence Discipline

This revision retains (and in places expands) the ≥30-line prefix / ≥50-line suffix grounding blocks. Credit to the prior iteration for shipping the promised grounding quality.

## Final Recommended Actions (from this audit)

1. **Sync or delete the stale snapshot.** The authoritative sources are the workspace `threejs-*/` directories. `~/.claude/skills/threejs-*` should be regenerated from them or removed so that future audits and routing target the current pack.

2. **Cascade:** Change one side of the inBand interval to half-open. Add a regression test that the specific handoff values used in the presets never land exactly on bin centers.

3. **Jacobian slopes:** In the slope derivation section, explicitly note that the formula is the diagonal approximation to `∇h · F⁻¹` and quantify or bound the dropped shear term for the target choppiness range.

4. **Detail mix:** Swap the mix arguments (or the variable names) so that the documented intent matches the code. Verify the implementing cloud example matches.

5. **Temporal contract (highest leverage):** Make the velocity convention, depth reconstruction policy, and history validity/reset rules a non-optional part of the central image-pipeline contract. Require every skill that uses temporal reconstruction (clouds, dynamic surfaces, etc.) to document consumption or explicit opt-out with the same rigor as the central table.

6. **Cross-skill verification pass:** After the above, run a targeted audit (using the same subagent + direct read discipline) of the consumers of the image-pipeline signals (particularly volumetric clouds, dynamic-surface-effects, water, atmosphere) to confirm they respect the declared conventions.

**Summary of revalidation on correct tree:**  
Fewer "critical" items than the snapshot audit. The pack has already made substantial progress on the central contracts (velocity explicit, legacy exemplars removed, temporal opt-in described). The remaining high-value work is the detail-mix inversion (live), labeling of approximations, and enforcement/consistency of the temporal signals across the skills that claim to use them.

All claims grounded exclusively in the workspace `threejs-*/` files. Subagent transcripts and raw section reads available for independent audit.

**End of report.**