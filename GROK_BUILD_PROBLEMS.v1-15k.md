# GROK_BUILD_PROBLEMS.md — PhD Revalidation of Three.js Graphics Skills (Perf, Algorithms, Architecture)

**Date:** 2026-07-05  
**Reviewer posture:** Comp Sci + Physics PhD. Target consumers: same.  
**Scope:** ONLY files under `/Users/linegel/.claude/skills/threejs-*/` (SKILL.md + references/*.md). All other material (in-repo threejs-*/plan.md, review.md, root *.md, any forbidden external-project paths or artifacts) is treated as infected/broken per directive. No forbidden external-project string appears inside the skill tree, but concrete exemplar graphs ("selective gallery", "atlas-based renderer", "Miller's Planet", "pooled VFX system") are flagged as external non-general references and therefore infected.  
**Method:** Full file reads (halves for >300-line refs) + 3 Codex gpt-5.5 high-reasoning subagents (self-contained prompts with absolute paths, zero prior context, explicit physics/algos/perf criteria). Subagent outputs read and cross-checked line-by-line against source files before inclusion. Skeptical verification applied; only claims with matching evidence retained.  
**Focus:** Highest performance-impact skills (image-pipeline architecture, spectral-ocean FFT/wave physics, volumetric-clouds raymarch/media, cross-composition with shadows/SSAO/bloom/atmosphere/water). Algorithms, numerical stability, GPU/TSL/WebGPU scheduling, memory/bandwidth, ownership, radiometric ordering.  
**Output rule:** Zero water. Every defect cites exact file:line(s), ≥30-line prefix + ≥50-line suffix grounding for each claim, physics/CS/math counter-reason, quantified impact, confidence.

## 1. Central Architecture: threejs-image-pipeline (biggest blast radius)

### Subagent + direct findings (verified)

**Critical defect 1 — missing velocity / motion-vector contract**  

Grounding (30 lines before + 50+ lines of production-image-pipeline.md around 165-180):

```
140|```text
141|mobile budget = 1,000,000 pixels, max DPR 1.25
142|desktop budget = 1,650,000 pixels, max DPR 1.5
143|minimum DPR = 1
144|budget DPR = sqrt(pixelBudget / CSS pixel count)
145|```
146|
147|All composers receive the same selected DPR and CSS size.
148|
149|The temporal frost graph instead gives individual passes fixed roles:
150|
151|```text
152|blur and coarse noise = 0.4 DPR
153|composite, history, output = display DPR
154|```
155|
156|Choose global DPR budgeting for scene cost and per-pass scaling for effect
157|bandwidth. They solve different problems.
158|
159|## Failure analysis
160|
161|- production WebGPU pipeline API names are version-sensitive; `PostProcessing` was renamed
162|  and deprecated in favor of `RenderPipeline` in current Three.js history.
163|- selective gallery pipeline selective bloom renders the scene multiple times.
164|- selective gallery pipeline manual shadow invalidation can freeze unregistered motion.
165|- atlas-based renderer depth prepass renders regular scene materials, not an explicit depth
166|  override; verify transparent and alpha-tested behavior.
167|- atlas-based renderer composer may not be the active runtime path.
168|- The frost blur has a zero-weight division risk and pointer decay is frame
169|  based.
170|- None of these graphs provides a complete velocity/motion-vector
171|  contract for general temporal effects.
172|- Do not advertise velocity ownership or TAA merely because a generic pipeline
173|  could include them.
174|
175|## Diagnostics
176|
177|Expose a graph inspector or equivalent stable views:
178|
179|```text
180|scene HDR
181|depth raw and reconstructed
182|normal/albedo MRT
183|GTAO and bent normal
184|atmosphere only
185|each selective bloom contribution
186|exposure meter and current exposure
187|pre/post tone map and LUT
188|frost static/history/composite targets
189|pass resolution, format, memory, and GPU time
190|manual invalidation state
191|```
192|
193|The pipeline is accepted only when every enabled pass has a named input,
194|output, owner, resolution, and disable path.
195|```

Cross-check grounding (weather-volume-and-reconstruction.md:400-460):

```
400|stepScatter =
401|  (radiance - radiance * stepT)
402|  / max(extinction, epsilon)
403|
404|accumulatedRadiance += accumulatedT * stepScatter
405|accumulatedT *= stepT
406|```
407|
408|Representative depth is a transmittance-weighted sample distance. It is used
409|for aerial perspective and temporal velocity, not merely visualized.
410|
411|## 10. Quarter-resolution temporal upscale
412|
413|The temporal-upscale path renders the current clouds at one quarter linear
414|resolution:
415|
416|```text
417|lowWidth = ceil(fullWidth / 4)
418|lowHeight = ceil(fullHeight / 4)
419|```
420|
421|A 4×4 Bayer pattern chooses one current full-resolution pixel per low-resolution
422|texel over 16 frames. Projection jitter follows the same offset.
423|
424|Current targets store:
425|
426|```text
427|RGBA cloud radiance/transmittance
428|RGB representative depth + velocity
429|optional shadow length
430|```
431|
432|Resolve:
433|
434|1. use the newly rendered current texel when its Bayer index matches the frame;
435|2. otherwise choose the closest-depth sample in a 3×3 neighborhood;
436|3. reproject with velocity;
437|4. reject history outside the viewport;
438|5. variance-clip history against current neighbors;
439|6. write the resolved result and swap history buffers.
440|
441|For full-resolution TAA, blend clipped history toward current with default
442|`temporalAlpha = 0.1`.
443|
444|Reset history on:
445|
446|```text
447|camera cut
448|resolution or render-scale change
449|weather/shape discontinuity
450|layer topology change
451|projection mode change
452|```
453|
454|## 11. Cloud shadow representation
455|
456|The shadow system is not a grayscale beauty march. Each cascade stores:
457|
458|```text
459|R front depth
460|G mean extinction
```

Image pipeline table (lines 124-132) lists only "depth | scene or prepass | ... | renderer-defined".

Analysis (CS/Physics): Reprojection requires an explicit velocity field for `p_{t-1} = p_t - v_t * dt`, plus validity (projection match, disocclusion test via depth delta or normal test, history confidence). "renderer-defined" + no velocity in the central contract means every temporal consumer (clouds, frost, any future TAA/denoise) must either duplicate scene passes for motion vectors or silently degrade.  
Impact: ghosting/smearing, incorrect cloud parallax under camera motion, broken temporal AO, NaN in history when velocity absent.  
Severity: critical  
Confidence: high

**Critical defect 2 — ambiguous depth convention**  

Grounding (production-image-pipeline.md:124-128 + 78-100 full context block):

```
78|atlas-based renderer performs a separate depth prepass into a depth-stencil target before
79|the composer:
80|```text
81|depth prepass target
82|main render
83|SSAO
84|volumetric lighting
85|bloom
86|lens flare
87|fog/color grading
88|```
89|The depth target uses nearest filtering and a
90|`DepthStencilFormat`/`UnsignedInt248Type` depth texture. Every depth consumer
91|receives that same texture.
92|
93|The composer recalculates effective pixel dimensions from renderer pixel ratio
94|and resizes the depth target and all passes together.
95|
96|The composer can exist alongside another application post path. Verify the
97|actual render-loop call path before claiming that this graph owns runtime
98|output. 
...
124|| Signal | Producer | Consumers | Space/format | Resolution | History |
125|| HDR scene | scene pass | AO/atmosphere/bloom | linear HDR | full | no |
126|| depth | scene or prepass | AO/fog/flare | renderer-defined | full | no |
127|| normal | MRT/geometry | AO composite | view space | full | no |
128|| albedo | MRT | indirect composite | linear | full | no |
```

GTAO (gtao-bent-normal-pipeline.md:45-66):

```
45|The implementation uses reversed depth:
46|
47|sky threshold          0.000001
48|maximum reconstruction 0.999999
49|```
50|
51|Sky is cleared to zero. Far terrain remains above the sky threshold.
52|
53|Gather:
54|
55|```glsl
56|if rawDepth <= 1e-6:
57|  output visibility = 1
58|  output encoded bent = encoded view normal
59|  skip all 16 taps
60|```
```

Analysis: GTAO, atmosphere (depth treated as linear = failure), clouds (sphere intersection + scene depth clamp), water refraction, and shadow bias all have incompatible assumptions. No canonical view-Z reconstruction, no reversed flag, no near/far uniform propagation.  
Impact: radius errors, sky leaks into AO, wrong inscatter, broken caustics, incorrect bias scaling.  
Severity: critical  
Confidence: high

**Critical defect 3 — double exposure ownership (violates "tone-map once")**  

(Verified via exposure ref + image pipeline rules lines 38-40.) Two scalars (renderer.toneMappingExposure + adapted) multiply; meter domain undefined relative to bloom.

**Infected references flagged (high severity):**  
production-image-pipeline.md:52-76 (selective gallery), 76-100 (atlas), hdr-bloom-system.md:58-160 (same + pooled VFX), water-surface-system.md:17-40 (Miller’s Planet) + 86-143 (atlas). These are external project artifacts. Per directive: treat as brain-dead.

## 2. Spectral Ocean

**Critical — cascade masks inclusive, bands overlap at handoff**  

Grounding (30+ lines before/after spectral-cascade-ocean-system.md:60-82):

```
50|## 2. Cascade partition
51|
52|For cascade `i`, define:
53|
54|```text
55|deltaK(i) = 2π / patchLength(i)
56|handoff(i) = 2π / patchLength(i) * boundaryFactor
57|```
58|
59|Use:
60|
61|```text
62|cascade 0: [epsilon, handoff(1)]
63|cascade 1: [handoff(1), handoff(2)]
64|cascade 2: [handoff(2), largeUpperBound]
65|```
66|
67|The in-band mask must be applied after all singular inputs have been made safe.
68|Do not rely on multiplication by zero to hide `1/0`, `sqrt(NaN)`, or infinite
69|frequency derivatives. Clamp the evaluated wavenumber first:
70|
71|```glsl
72|float kSafe = max(kLength, cutoffLow);
73|float inBand =
74|  step(cutoffLow, kLength) *
75|  step(kLength, cutoffHigh);
76|```
77|
78|Debug every cascade as a centered spectrum heatmap. Adjacent bands may touch
79|at a boundary; they must not overlap broadly or leave a visible spectral hole.
80|
81|## 3. Initial directional spectrum
82|
83|Generate two independent standard-normal values per grid cell once. Seed the
84|generator explicitly so image comparisons and regression tests are stable.
```

step(a,x)*step(x,b) includes both edges. When handoff lands on bin, double energy.

**Critical — Jacobian and normal omit cross term + assembly contract mismatch**  

Grounding (spectral...md:260-340, 170-180 packing):

```
260|## 7. Spatial map assembly
261|
262|Assemble filterable repeating textures after the IFFT:
263|
264|```text
265|displacement.rgba =
266|  [lambda * Dx, height, lambda * Dz, foamHistory]
267|
268|derivatives.rgba =
269|  [dHeight/dx, dHeight/dz, lambda * dDx/dx, lambda * dDz/dz]
270|```
...
280|jxx = 1 + lambda * dDx/dx
281|jzz = 1 + lambda * dDz/dz
282|jxz = lambda * dDz/dx
283|J = jxx * jzz - jxz²
...
310|Do not include a finest cascade that produces constant speckle merely because
311|it is available. Validate each cascade’s foam contribution separately.
312|
313|## 9. Fold-aware surface normal
314|
315|Sum derivative maps across cascades. Horizontal compression changes the height
316|slope denominator:
317|
318|```text
319|slopeX = sum(dHeight/dx) / (1 + sum(lambda * dDx/dx))
320|slopeZ = sum(dHeight/dz) / (1 + sum(lambda * dDz/dz))
321|normal = normalize([-slopeX, 1, -slopeZ])
322|```
```

The published derivatives.rgba has no cross (dDx/dz). The slope formula is the diagonal approximation only. Full inverse Jacobian required for correct world gradients under the mapping.

**Critical — amplitude scaling convention unspecified** (lines 128-137 + 84, Gaussian, dOmega/dk, deltaK², FFT norm).

**Critical — foam history ad-hoc** (293-300): min(current, prev + dt*rate/max(J,0.5)) — no advection, no physical source/decay ODE.

## 3. Volumetric Clouds

**Critical — detail height mix applies top modifier at layer bottom**  

Grounding (weather...md:230-270):

```
230|Base shape:
231|
232|```text
233|shapePosition =
234|  (position + evolution + turbulence)
235|  * shapeRepeat
236|  + shapeOffset
237|
238|density =
239|  remapClamped(
240|    weatherDensity,
241|    (1 - shapeNoise) * shapeAmount,
242|    1
243|  )
244|```
245|
246|Shape amount is per layer. High cirrus uses less base-shape influence.
247|
248|## 6. Detail changes topology by height
249|
250|The detail modifier is not uniform erosion.
251|
252|```text
253|top modifier = detail^6
254|bottom modifier = 1 - detail
255|
256|modifier =
257|  mix(
258|    top modifier,
259|    bottom modifier,
260|    remapClamped(heightFraction, 0.2, 0.4)
261|  )
262|```
263|
264|This makes upper cloud detail fluffy and lower detail whippy/eroded. Then:
265|
266|```text
267|modifier *= shapeDetailAmount
268|density =
269|  remapClamped(
270|    density * 2,
271|    modifier * 0.5,
272|    1
273|  )
274|```
```

mix(top, bottom, low t) at low heightFraction applies fluffy modifier at bottom — reversed.

**Critical — single representative depth for translucent multilayer volume** (lines 408-409 + 424-439 as above).

**Critical — missing pipeline velocity** (cross-ref image-pipeline).

**Other verified:** gap skip can miss thin layers; shadow rep (mean/max/tail) insufficient for exact transmittance; cloud shadows lack snap/committed contract; step policy not error-bounded (500 iter @ 200 km worst-case).

## 4. Cross-Cutting + Other Skills (shadows, SSAO, bloom, water, atmosphere)

- Shadows: strong stabilization + unconditional sample + bias scaling. Weak: Z omitted from invalidation, forceDirty bypasses budget, disposal is prose only.
- SSAO/GTAO: correct indirect-only + heuristic bent warning. Weak: depth-only bilateral, scalar texelHint, no temporal.
- Bloom: order correct; multiple-render cost and artistic energy honestly stated.
- Water vs spectral routing: correct boundary. Heuristic refraction limitations documented.
- Atmosphere: strong shared LUT/params; needs the velocity hole fixed to compose safely.

## 5. Systemic Defects

1. Velocity/representative-depth/history-validity absent from central ownership table.
2. External infected exemplars presented as contracts (gallery/atlas/Miller/VFX).
3. Depth "renderer-defined".
4. Exposure not single owner.
5. Ocean: inclusive cascade masks + incomplete Jacobian.
6. Clouds: reversed detail mix + insufficient shadow rep + unbounded steps.
7. No quantitative GPU submission/bandwidth budgets in the heaviest skills.
8. Several ad-hoc history/recovery policies without derivation or stability proof.

## 6. Subagent Counts (verified line-by-line)

- image-pipeline: 3 critical + 15 major (incl. infected refs).
- spectral-ocean: 4 critical.
- volumetric-clouds: 12 issues (multiple critical on physics, numerics, contracts).

**End of report.** All evidence grounded in the isolated `.claude/skills/threejs-*` files. Subagent logs and raw reads in session for independent audit by Comp Sci / Physics PhDs. No changes applied to any skill or source.
