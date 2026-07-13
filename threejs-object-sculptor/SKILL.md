---
name: threejs-object-sculptor
description: Reconstruct an object from an attached image, screenshot, URL, or local image as a quality-gated, action-ready procedural Three.js model. Use for image suitability checks, ObjectSculptSpec extraction, geometry/material/lighting planning, code-native model implementation, staged visual comparison, animation-ready hierarchy, or destruction-ready component design. Adapted from Three.js Object Sculptor by Vinh Hiển.
---

# Three.js Object Sculptor

## Origin And Attribution

This standalone skill adapts [Three.js Object Sculptor](https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin) by [Vinh Hiển](https://github.com/vinhhien112), imported from upstream commit `4194e9ad436a0dff4e1ec982fac1ac64dfded241`. The original and this adaptation retain the upstream MIT license in `LICENSE`.

Use this skill when the user wants to turn a reference image of an object into a procedural Three.js model, visual spec, reconstruction plan, animation plan, destruction plan, or code implementation. This skill is for code-native reconstruction, not photogrammetry or exact mesh extraction.

## Core Promise

Treat the task like sculpting from a photo:

1. Validate whether the image contains a suitable 3D object target.
2. Extract the object as a structured visual and physical description.
3. Decompose it from coarse forms to small features.
4. Rebuild it with procedural Three.js geometry, generated materials, lighting, and optional animation/destruction.
5. Verify visually and technically before calling it done.

Do not pretend a single image can produce an exact production mesh. Be explicit when the output will be an approximate, stylized, low-poly, or physically simplified reconstruction.

## Required Inputs

At minimum:

- one image path, screenshot, URL, or attached image
- the intended use: standalone model, game prop, scene dressing, hero render, playable object, destructible object, or animation rig

If the image is missing or unreadable, ask for it. If the intended use is missing, assume a browser-real-time Three.js prop with performance suitable for interactive use.

## Helper Scripts

Use the bundled scripts when they make the loop faster or more reliable:

These scripts live inside this standalone skill folder. Resolve each command from the skill root as `scripts/...`.

- `scripts/probe_reference_image.py <image>` checks image type, dimensions, aspect ratio, and obvious technical issues. It does not replace visual inspection.
- `scripts/extract_reference_pbr.py <image> --out-dir <dir> --material-id <id> --target-threshold 0.7` extracts reference-derived albedo, roughness, height, normal, and AO maps from image pixels. It exits non-zero when confidence is below the target threshold.
- `scripts/extract_reference_pbr.py <image> --out-dir <dir> --material-id <id> --spec object-sculpt-spec.json --in-place` patches a material with usable `referencePbr` maps only when the confidence gate passes, unless `--allow-low-confidence` is explicitly used.
- `scripts/new_pre_spec_assessment.py "Object Name" --image <path> --complexity <simple|moderate|complex|ultra-complex> --out assessment.json` creates a pre-spec complexity assessment and quality contract skeleton.
- `scripts/new_sculpt_spec.py "Object Name" --image <path> --out object-sculpt-spec.json` creates a starter spec.
- `scripts/new_sculpt_spec.py "Object Name" --image <path> --assessment assessment.json --out object-sculpt-spec.json` creates a starter spec from a completed pre-spec assessment.
- `scripts/validate_sculpt_spec.py object-sculpt-spec.json` validates required fields, score ranges, material references, component IDs, parent links, transforms, and primitive names.
- `scripts/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality` fails when the spec is structurally valid but too shallow for its quality contract.
- `scripts/sculpt_pass_orchestrator.py status object-sculpt-spec.json` reports the current locked build pass and required evidence.
- `scripts/sculpt_pass_orchestrator.py check object-sculpt-spec.json --pass-id blockout` fails unless that pass is currently unlocked or already completed.
- `scripts/sculpt_pass_orchestrator.py sync object-sculpt-spec.json --in-place` refreshes `sculptPipeline` from `reviewHistory`.
- `scripts/generate_threejs_factory.py object-sculpt-spec.json --out src/createObjectModel.ts` creates a TypeScript Three.js factory for the current unlocked build pass only.
- `scripts/generate_threejs_factory.py object-sculpt-spec.json --pass-id structural-pass --out src/createObjectModel.ts` creates a deeper pass only after earlier passes were reviewed with `action=continue`.
- `scripts/make_visual_comparison_sheet.py --reference <image> --render <screenshot> --out <comparison.png> --json` creates one full reference/render comparison pair. AI vision scores the global result and every selected semantic feature from this same pair.
- `scripts/append_sculpt_review.py object-sculpt-spec.json --pass-id <pass> --fidelity <0-1> --action <continue|refine-spec|refine-code|request-input|stop> --summary "..." --render-screenshot <path> --comparison-image <path> --ai-vision-score <0-1> --layer-scores-json '{"silhouetteProportion":0.8}' --feature-reviews-json <reviews.json> --ai-vision-notes "..." --camera-view <view> --in-place` records each self-correction review plus global and feature-level AI vision evidence.

Prefer this loop for implementation tasks:

1. Probe the image if it is local.
2. Run the Pre-Spec Assessment Gate: classify the object softly, score complexity, and write the quality contract before authoring the full spec.
3. Create or revise `ObjectSculptSpec` from the completed assessment and quality contract.
   Replace generic starter `featureReviewTargets` with the object's actual identity-defining semantic systems before strict validation. Keep at most five critical and three important targets per pass.
4. When material fidelity matters and a source image is available, run `extract_reference_pbr.py` for each important material crop/region before material-pass. Treat confidence below `0.7` as a stop/refine-input signal, not as a pass.
5. Validate the spec with normal validation, then run `--strict-quality` before code generation.
6. Generate a factory skeleton only after the strict quality gate passes or after explicitly documenting accepted fidelity limits.
7. Hand-refine geometry, materials, animation anchors, and destruction anchors one pass at a time. Do not generate or implement a deeper pass until `sculpt_pass_orchestrator.py check` passes for that pass.
8. After each visual pass, capture a browser screenshot, create one full reference/render comparison pair, inspect it once with AI vision, then update `reviewHistory` with overall, layer, and semantic feature scores.
9. Run the target project's typecheck/build and review the result in an available browser or application surface. Use whichever screenshot or capture mechanism the project already provides.

## 3D Terminology Discipline

Descriptions must be clear, concrete, and compatible with real-time 3D graphics language. When describing the object, prefer terms from `references/3d-graphics-terminology.md`.

Do not rely on vague descriptions such as "nice", "realistic", "smooth", "rough", "bumpy", "shiny", "dark", or "dirty" unless they are translated into technical terms:

- geometry: silhouette, topology intent, primitive family, bevel radius, chamfer, taper, bend, twist, boolean cut, edge loop, local deformation, displacement amplitude
- material/PBR: albedo/baseColor, roughness, metalness, normal map, bump map, displacement map, ambient occlusion, cavity dirt, edge wear, clearcoat, transmission, alpha
- surface locality: local mask, procedural noise scale, scratch cluster, chip, dent, seam, recessed groove, raised ridge, stain, dirt accumulation, contact wear
- lighting/rendering: key/fill/rim light, environment reflection, contact shadow, shadow softness, color temperature, exposure, tone mapping
- animation/destruction: pivot, hinge, joint, socket, collider, rigid body, fracture seam, detachable fragment, impulse direction

Every important visual claim should name the layer it belongs to: geometry, topology, material, texture, shader parameter, lighting, animation, collision, or destruction. For complex objects, include `terminologyProfile` in the spec and keep local details attached to `viewEvidence`.

## Image Validation Gate

Before planning or coding, inspect the image and return a suitability verdict:

- `pass`: clear object, readable silhouette, reconstructable with procedural primitives
- `conditional`: possible, but needs assumptions, stylization, extra angles, or reduced fidelity
- `reject`: not enough object information for a useful procedural reconstruction

Score these 0-3:

- `object_isolation`: one main object, not a crowded scene
- `silhouette_readability`: outer shape and proportions are clear
- `depth_inference`: enough cues to infer front/back/side thickness
- `primitive_decomposition`: can be built from spheres, boxes, cylinders, tubes, lathe/extrude shapes, curves, instancing, or deformed surfaces
- `material_procedurality`: material can be approximated with colors, roughness, metalness, normals, procedural noise, decals, or vertex colors
- `occlusion_risk`: hidden parts are limited or can be inferred
- `interaction_fit`: object can support requested animation, physics, or destruction

Reject or ask for another image when:

- the target object is not identifiable
- multiple objects compete and the target is ambiguous
- the object is heavily cropped or hidden
- the goal requires exact likeness from a single image
- the subject is mostly text, transparent glass, fur, smoke, liquids, or fine fabric where procedural approximation would dominate the result
- the requested output is a rigged organic character but only one flat view is available

## Extraction Pass

Before writing the full spec, create a pre-spec assessment. Do not use hardcoded domain profiles. Use observed traits and complexity to decide how deep the spec must be.

### Pre-Spec Assessment Gate

This gate exists to prevent shallow specs. It must happen before `componentTree` and materials are finalized.

Use `references/pre-spec-assessment.md` for the complexity scoring and quality-contract checklist.

Assess:

- object class, using soft descriptors such as organic, hard-surface, mechanical, architectural, botanical-like, character-like, amorphous, repeated-structure, static prop, articulated, deformable, or destructible
- complexity tier: `simple`, `moderate`, `complex`, or `ultra-complex`
- silhouette complexity
- expected component count
- hierarchy depth
- repetition density
- material layer count
- local detail density
- occlusion/hidden-structure risk
- animation/destruction readiness need

Then write a `qualityContract` that states what "good enough" means for this exact object. The contract must include:

- definition of done
- minimum spec depth: macro components, meso components, micro feature groups, material layers, repetition systems, review viewpoints
- required feature groups with quality criteria, evidence refs, and failure modes
- visual delta checks for screenshot review
- anti-shallow rules that block code generation if the spec is too vague

For a simple object, this can stay compact. For a complex object, the contract must force a deep component hierarchy, repeated systems, material local overrides, and multiple screenshot viewpoints. If the quality contract is still generic enough that it could apply to any object, refine it before generating code.

After passing the pre-spec gate, produce an `ObjectSculptSpec` in prose or JSON-like form. Use schema v2 for complex objects:

```ts
type ObjectSculptSpec = {
  targetName: string;
  schemaVersion: "2.0";
  terminologyProfile: TerminologyProfile;
  suitability: "pass" | "conditional" | "reject";
  assumptions: string[];
  preSpecAssessment: PreSpecAssessment;
  qualityContract: QualityContract;
  coordinateFrame: {
    front: string;
    up: string;
    scaleReference: string;
  };
  silhouette: {
    boundingShape: string;
    aspectRatios: string[];
    symmetry: string;
    dominantCurves: string[];
  };
  viewEvidence: ViewEvidence[];
  componentTree: SculptComponent[];
  materials: SculptMaterial[];
  qualityTargets: QualityTargets;
  selfCorrectLoop: SelfCorrectLoop;
  sculptPipeline: SculptPipeline;
  actionReadiness: ActionReadiness;
  repetitionSystems: RepetitionSystem[];
  buildPasses: BuildPass[];
  visualEvidence: VisualEvidence[];
  reviewHistory: SculptReview[];
  lodPlan: LodPlan[];
  performanceBudget: PerformanceBudget;
  lightingFromPhoto: string[];
  proceduralStrategy: string[];
  animationAnchors: string[];
  destructionAnchors: string[];
  risks: string[];
};
```

For every major component, capture:

- role: body, base, limb, handle, cap, shell, ornament, connector, surface detail
- level: macro, meso, or micro
- importance and confidence from 0 to 1
- primitive base: box, sphere, cylinder, cone, torus, capsule, tube, lathe, extrude, curve sweep, plane cards, instanced cluster
- geometry descriptor: topology intent, edge treatment, bevel radius, deformation stack, UV strategy, normal strategy
- dimensions: width, height, depth, radius, length, taper ratios, and confidence
- transforms: position, rotation, scale, taper, bend, twist, bevel, boolean cut, noise displacement
- joints: parent component, overlap, seam, hinge, socket, embedded, glued, floating
- action profile: animation role, pivot mode/local position/axis, transform channels, sockets, collider construction intent/input, constraints, destruction behavior
- material layers: base color, palette variation, roughness, metalness, normal, bump, displacement, transparency, edge wear, dirt, moss, scratches, chips, wetness, grain
- local features: per-region marks, dents, holes, seams, stains, ridges, raised details, carved lines, decals, chips, and wear patches
- evidence refs: which image region supports this component or local feature
- fidelity tier: blockout, mid detail, close-up detail

For complex objects, do not flatten everything into one `details` string. Use:

- `viewEvidence` to record image regions and observed local traits.
- `terminologyProfile` to keep descriptions aligned with 3D graphics vocabulary.
- `material.localOverrides` to describe local color/roughness/bump differences.
- `component.localFeatures` for geometry-visible details.
- `component.surfaceDetail` for macro roughness, micro roughness, bump amplitude, normal pattern, and displacement pattern.
- `repetitionSystems` for repeated screws, leaves, scales, teeth, beads, panels, rivets, holes, or stitches.
- `buildPasses` to state the sculpt order and acceptance criteria from coarse to fine.

Anti-shallow rule: a complex object with only one root component, no repetition systems, no material local overrides, and no micro feature groups is not implementation-ready even if the JSON schema validates.

Before selecting geometry, repetition, hierarchy, motion, physics handoff, material, or mobile representations, read [multi-subject algorithm and architecture selection](references/multi-subject-algorithm-and-architecture.md). It contains the falsifiable selection matrices and exact topology, normal, frame, bounds, collider-error, seed, motion, diagnostic, and lifecycle tests. Do not choose an algorithm from object category alone; choose per semantic component from the frozen view, action, tier-invariant, and target contracts.

## Action-Ready Model Contract

Build every generated model as if the user may later ask for animation, transformation, physics, or destruction. Do not generate a beautiful but inert lump of meshes.

Use `references/action-ready-models.md` for pivot, socket, collider, and destruction hierarchy rules.

### Shared physics boundary

For any physics-facing action-ready route, first read the shared
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
The sculpt specification and `root.userData.sculptRuntime` maps are authoring
inputs, not an independent solver ABI. Convert source dimensions once through
the route's SI `PhysicsContext`, preserve stable component/entity generations,
and keep visual geometry LOD separate from physical representation.

The object factory publishes a `ColliderConstructionInput` for every
physics-relevant solid, trigger, sensor, boundary, or query shape. It contains
stable semantic and live-instance identity, explicit authoring units, a local
authored frame, analytic or compound shape intent, physics-material binding
request, source revision, and a conservative authored approximation envelope.
It has no contact, rigid-body, frame-registration, or solver authority.

An articulated factory may also publish a `ConstraintConstructionInput` with
stable parent/child identities, parent- and child-local anchor frames, authored
axis/limits/compliance intent, source units, and revision. It is not an active
constraint, state equation, or solve claim until the selected route owner
adapts and commits it.

Only the selected route adapter may publish a canonical `ColliderProxy`, after
it supplies the versioned `PhysicsContext`, performs the one explicit unit
conversion, registers frame/origin/transform revisions, binds committed pose,
cadence, validity, filters, and residency, and validates the approximation
error. It publishes a canonical `RigidBodyProperties` record only when mass,
center of mass, inertia, and material evidence are sufficient. A decorative
mesh or collider-shaped `userData` object is not collision authority. Missing
scale, density, inertia, material, or approximation evidence blocks the
corresponding dynamic claim instead of inventing defaults.

When a route-native engine or domain solver owns motion, contact, constraints,
or fracture, register it directly as the relevant `PhysicsGraph` state owner
with the route's ordinary versioned cost, state, and commit records. When an
external library, process, or device owns that work, bind it through the
canonical `ExternalSolverAdapter`, which maps exact context/frame/unit/clock/
state versions. Contact lifecycle publishes `ContactManifoldRecord`; closed
dimensional payloads such as impulse or `constraintTarget` publish the matching
`InteractionRecord`. Fracture remains a named state equation or transition owned
by the selected solver; only its supported dimensional exchanges use an
`InteractionRecord` arm. The object-sculptor owns semantic pivots, sockets,
collider and constraint construction inputs, fracture groups, and visual
component identity; it does not become a contact or rigid-body solver merely
because a model is action-ready.

The adapter owner publishes `PhysicsExternalAdapterCost` in the same route
opportunity rows as solver-driven state and presentation. Evidence includes
request/response/batch counts, logical and physical bytes, serialization plus
frame/unit conversion, queue/transport/ownership/fence dependencies, remote
solve and commit tail, retries/exact-once results, in-flight/recovery memory,
clock mapping, and process/device-loss witnesses. Geometry build time or the
external solver's compute time alone is not the end-to-end adapter cost.

Solver-driven transforms and fracture visibility contribute stable bindings as
`PresentedStatePair` entries in a view-independent
`PhysicsPresentationCandidate`. Rendering consumes the sealed per-target/view
`PhysicsPresentationSnapshot`; `FrameExecutionRecord` closes actual target
execution and resource-lease disposition. Visual meshes, shadows, bounds,
motion vectors, picking IDs, and detachable fragments resolve the same
presented entity/component generation instead of sampling live solver state.

A physics-facing collider/body/fracture/ID or presentation-representation tier
change uses the canonical `QualityTransition` and commits at a safe route
boundary. A render-only tessellation or material change stays local only when
it preserves every collider, body property, interaction identity, committed
state, presented binding, physical error bound, and stable component ID.

The spec should include `actionReadiness`, and every macro/meso component should include `actionProfile`:

- `animationRole`: root, static, articulated, deformable, detachable, breakable, effect-emitter, or socket-only.
- `pivot`: mode, local position, axis, and confidence. Use a semantic pivot such as base, hinge, joint, center of mass, branch root, handle socket, or custom.
- `transformChannels`: whether translate, rotate, scale, bend, twist, detach, visibility, or material-state changes are expected.
- `sockets`: named attachment points for hands, tools, branches, wheels, lids, projectiles, effects, or later child objects.
- `colliderConstructionInput`: authoring shape intent such as box, sphere, capsule, cylinder, convex hull, compound, trigger, query, boundary, or none; include source units, local authored frame, stable identities, material-binding request, source revision, and conservative authored error envelope.
- `constraints`: a `ConstraintConstructionInput` for authored hinge, slide, bend, spring, or parent-lock intent with stable participants, local anchor frames, axis/limits, units, and revision; it is not a solver constraint until the selected route owner adapts and commits it.
- `destruction`: breakable flag, fracture group, seam refs, detachable fragments, break impulse, debris material, and effect anchors.

Generation rules:

- Put each independently transformable part under a stable `THREE.Group` pivot node; put the visual mesh as its child.
- Store runtime maps in `root.userData.sculptRuntime`: `nodes`, `meshes`, `sockets`, `colliders`, and `destructionGroups`. Values in the `colliders` map are `ColliderConstructionInput` records, not canonical `ColliderProxy` records.
- Avoid merging parts that may move, detach, bend, break, swap materials, or receive independent collision later.
- Use procedural seams and component boundaries as future break lines; do not rely on random explosions.
- If the object truly has no moving parts, still include a root pivot, whole-object collider construction input, and destruction policy so later whole-object actions remain easy.

## Self-Correction Loop

Construction must be a feedback loop, not a blind one-way generation.

After every build pass, pause and review against the source image, user requirements, `qualityTargets.mustMatch`, and the current `ObjectSculptSpec`.

Use this review shape:

```text
passId:
estimatedFidelity: 0..1
matched:
mismatches:
rootCause: spec gap | code gap | rendering/lighting gap | reference ambiguity | performance tradeoff
decision: continue | refine-spec | refine-code | request-input | stop
specFixes:
codeFixes:
evidence:
visualEvidence:
  referenceScreenshot:
  renderScreenshot:
  comparisonImage:
  cameraView:
  notes:
  aiVisionNotes:
aiVisionScore: 0..1
visualAcceptanceThreshold: 0..1
layerScores:
  silhouetteProportion: 0..1
  componentStructure: 0..1
  formDetail: 0..1
  materialSurface: 0..1
  lightingCamera: 0..1
featureReviews:
  - id:
    score: 0..1
    visible: true
    notes:
```

Decision rules:

- `continue`: current pass meets its acceptance criteria and does not threaten later quality.
- `refine-spec`: the implementation revealed the spec is wrong, incomplete, ambiguous, or missing component/material/local feature detail.
- `refine-code`: the spec is adequate, but the generated geometry/material/lighting does not match it.
- `request-input`: required information is hidden in the image or user expectations conflict with the available evidence.
- `stop`: target fidelity is reached, user accepted the approximation, or remaining gaps require new references/manual art.

When the decision is `refine-spec`, revise the spec first, re-run `scripts/validate_sculpt_spec.py`, then continue implementation. Do not patch code around a bad spec. When the decision is `refine-code`, keep the spec stable and fix the factory/material/render code.

Record review entries with `scripts/append_sculpt_review.py` whenever there is a spec file. If there is no spec file yet, write the same review summary in the response before continuing.

### Screenshot Feedback Gate

For browser-renderable construction, screenshots are mandatory feedback, not optional decoration. Codex should not decide that a visual pass is good enough from code inspection alone. Code must not be the final image-comparison authority: the final pass decision comes from AI vision inspecting a side-by-side reference/render sheet.

Use `references/browser-screenshot-feedback.md` for the detailed screenshot comparison checklist.
Use `references/material-lighting-realism.md` when the shape is acceptable but material, color, texture, or lighting fidelity is still weak.
Use `references/attachment-joint-correctness.md` when parts attach to parents: branches, limbs, handles, legs, horns, wings, cables, tubes, sockets, hinged parts, or decorative appendages.

Use this order:

1. Render the current model in the browser or project preview.
2. Capture a screenshot at the relevant review viewpoint from `qualityTargets.reviewViewpoints`.
3. Select semantic review targets for this pass:
   - `critical`: at most five identity-defining or high-risk systems; every one must pass independently.
   - `important`: review adaptively, at most three suspicious systems; their reviewed average must pass.
   - `detail`: note mismatches without blocking the pass.
   Group repeated parts into one semantic system. Do not create a target for every mesh.
4. Create one comparison artifact with `scripts/make_visual_comparison_sheet.py --reference <image> --render <screenshot> --out <comparison.png>`.
5. Inspect the comparison image with Codex AI vision and score it by layer:
   - silhouette/proportion
   - component placement and hierarchy
   - local geometry features
   - material albedo, roughness, metalness, normal/bump/displacement
   - lighting, shadows, exposure, and camera angle
6. From that same full image pair, score every critical semantic feature independently. A failed critical feature fails the pass even when the global score is high.
7. Classify each mismatch as a spec gap, code gap, rendering/lighting gap, reference ambiguity, or performance tradeoff.
8. Record the screenshot pair, comparison image, overall AI vision score, layer scores, feature scores, and critique in `reviewHistory.visualEvidence` and `visualEvidence`.

Use an available project capture surface. If no screenshot can be captured, no comparison sheet exists, visual review has not been performed, the global score is below threshold, or any critical semantic feature is below its threshold, do not choose `continue`; choose `refine-spec`, `refine-code`, `request-input`, or explain the blocker.

Minimum gates:

1. `blockout`: screenshot proves silhouette, proportions, primitive family, and coordinate frame.
2. `structural-pass`: screenshot proves component hierarchy, parent/child placement, joints, seams, repeated systems, and stable action-ready node boundaries.
3. `form-refinement`: screenshot proves bevel/chamfer/taper/bend/deformation, local geometry features, and no floating child joints.
4. `material-pass`: screenshot proves albedo, roughness, metalness, normal/bump/displacement, AO, dirt, wear, local overrides.
5. `lighting-pass`: screenshot proves reference-independent material readability plus optional reference lighting match.
6. `interaction-pass`: screenshot or short render capture demonstrates authored preview motion, pivots, sockets, construction-input overlays, fracture seams, and detachable fragments. Structural tests—not pixels—validate IDs, local frames, exact reset, records, and tier invariants; physical validity remains blocked until the canonical route gates pass.
7. `optimization-pass`: visual-error-qualified geometry/material tiers plus sustained CPU, GPU, presentation, memory, traffic, binding, and lifecycle gates on each named device/browser/backend target.

### Locked Build Pass Gate

The construction loop is sequential. Codex must not jump from a completed spec directly to a polished model.

Before each implementation pass:

1. Run `scripts/sculpt_pass_orchestrator.py status object-sculpt-spec.json`.
2. Run `scripts/sculpt_pass_orchestrator.py check object-sculpt-spec.json --pass-id <pass>`.
3. Generate or edit only the unlocked pass.
4. Render in the target application or an available browser and capture the comparison view.
5. Build one full reference/render comparison sheet with `scripts/make_visual_comparison_sheet.py`.
6. Inspect it once with AI vision and record overall, layer, and critical semantic feature scores plus concrete mismatch notes.
7. Append review with `scripts/append_sculpt_review.py ... --pass-id <pass> --action continue --render-screenshot <path> --comparison-image <path> --ai-vision-score <0-1> --layer-scores-json '<json>' --feature-reviews-json <reviews.json> --ai-vision-notes "..." --camera-view <view> --in-place`.
8. Run `scripts/sculpt_pass_orchestrator.py sync object-sculpt-spec.json --in-place` when review history was edited manually.

The default generator is pass-gated. Calling `generate_threejs_factory.py` without `--pass-id` uses `sculptPipeline.currentPass`. Calling it with a future `--pass-id` must fail until prior passes are completed. This is intentional: first sculpt the blockout, then structure, then form, then material and surface detail.

Material and lighting passes have extra look-dev gates. `material-pass` must not proceed with only flat base colors; it needs palette, roughness variation, normal/bump/displacement intent, and local masks. `lighting-pass` must not proceed with ambient-only lighting; it needs key/fill/rim or environment light, exposure, tone mapping, background, shadow softness, and contact shadow behavior.

When `lookDevTargets.qualityPriority` is `reference-fidelity`, apply the quality-first gate:

- important close-up materials use independent albedo, roughness, height/normal, and AO channels
- surface response is decomposed into macro, meso, and micro frequency bands
- important procedural maps are at least 1024px, preferably 2048px
- if a source image exists, important close-up materials have usable `referencePbr` pixel extraction with confidence >= the configured target threshold, default `0.7`
- UV/projection and texel-density intent are explicit
- silhouette-affecting relief uses geometry or displacement-capable topology
- material review includes neutral, grazing-light close-up, and reference-matched screenshots
- optimization happens after fidelity is accepted; do not remove reference-critical geometry merely to hit an arbitrary polygon floor

Reference PBR extraction is an inference gate, not a magic guarantee. From one photo, Codex cannot uniquely recover true physical albedo, roughness, height, normal, and AO. If the extractor confidence is below the target threshold or the rendered material still fails screenshot review, choose `request-input`, `refine-spec`, or `refine-code` instead of pretending the material reached the requested fidelity.

Structural and form passes have an attachment gate. Child appendages such as branches, limbs, handles, legs, horns, wings, tubes, cables, connectors, and hinged parts must include `attachment.parentSocket`, `localStart`, `localEnd`, `contactType`, `embedDepth` or `overlap`, and `gapTolerance`. The generator should build these parts from root endpoint to tip endpoint instead of centering them at an arbitrary transform.

The agent should be willing to say: "This cannot reach the requested fidelity from the current image." That is a valid self-correction result.

## Reconstruction Strategy

Use a layered sculpting workflow:

1. `blockout`: build the silhouette with simple primitives and correct proportions.
2. `structural pass`: add child components, sockets, supports, hinges, handles, legs, branches, fins, or ribs.
3. `form refinement`: bevel hard edges, taper cylinders, bend tubes, add curve sweeps, add organic noise, and break perfect symmetry where the image demands it.
4. `surface pass`: add generated normal maps, procedural noise, vertex colors, bark/stone/metal/plastic/cloth patterns, scratches, wetness, dirt, edge highlights, and small repeated geometry only where it matters.
5. `material pass`: tune roughness/metalness/clearcoat/transmission/alpha so surfaces do not look like plastic unless they should.
6. `lighting pass`: separate actual object material from photo lighting; create a neutral turntable light plus optional reference-matching light.
7. `interaction pass`: add pivots, bones, collider construction inputs, animation handles, break points, and detachable fragments only when the user needs motion or destruction.
8. `optimization pass`: instance repeated details, merge static pieces where safe, and derive candidates from projected visual error before measuring the complete sustained workload on each named target.

## Three.js Implementation Rules

- Prefer TypeScript and plain Three.js unless the existing project uses another Three wrapper.
- Use `Group` factories such as `createObjectNameModel(spec, options)` rather than scattered mesh creation.
- Keep reconstruction data separate from renderer objects so the spec can be revised without rewriting the scene.
- Use deterministic seeds for procedural noise, surface variation, and repeated details.
- Generate unrelated PBR channels from independent deterministic fields. Never alias the albedo texture into roughness, height, normal, or AO.
- Use macro/meso/micro frequency bands for tactile materials; single-frequency random marks usually read as synthetic.
- For quality-first targets, spend polygons on silhouette-affecting relief and use 1024-2048px maps for close-up materials before reducing quality for performance.
- Preserve local material traits in code metadata (`userData`) even when the first generated geometry is only a blockout.
- For real-time scenes, prioritize silhouette and material believability over hidden micro-geometry.
- Use geometry primitives, `Shape` extrusions, curve/tube geometry, instancing, displacement/noise, and generated canvas textures before importing external art.
- Use mesh hierarchy for future animation: body root, movable limbs, hinged parts, detachable pieces, and effect emitters.
- For attached children, place the pivot at the attachment root/socket and orient geometry from `attachment.localStart` to `attachment.localEnd`.
- For destruction, define fracture groups and seams explicitly instead of randomly exploding the entire object.
- Add a simple reference camera/turntable or screenshot angle for visual comparison.

## Lessons From The Pine Forest Prototype

Apply these hard-won patterns:

- Vague "make it better" feedback is weak. Convert visual critique into named resets: `Material Realism Reset`, `Silhouette Reset`, `Water Surface Reset`, `Vegetation Structure Reset`, etc.
- A believable model needs geometry, material, lighting, and scale to agree. Fixing only one layer usually makes the result look artificial.
- Avoid perfect procedural smoothness. Add controlled unevenness: bevel variation, color mottling, roughness variation, micro normals, dirt at seams, edge wear, and asymmetry.
- Keep visual progress visible in the browser. Small loops beat large invisible rewrites.
- Protect performance: instance repeated details, keep collision simplified, and avoid geometry that only exists to hide a bad material.
- When the user compares against a reference image, explicitly name the mismatch before changing code.

## Output Format

For analysis-only requests, return:

1. Suitability verdict and scores.
2. Target object extraction.
3. Component hierarchy from macro to micro.
4. Geometry strategy.
5. Material and lighting recipe.
6. Animation/destruction feasibility.
7. Implementation plan and risks.

For implementation requests, do the same briefly, then edit code. Verify with typecheck/build and, when a browser scene exists, inspect screenshots or render output.

## Failure Handling

If reconstruction is not feasible from the provided image, do not fake confidence. Explain the blocker and ask for one of:

- front/side/back reference images
- cleaner image with isolated object
- acceptance of a stylized approximation
- permission to use generated placeholder interpretation
- a narrower target such as only silhouette, only material study, or only animation/destruction design
