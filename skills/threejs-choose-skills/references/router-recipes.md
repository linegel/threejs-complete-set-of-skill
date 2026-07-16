# Router Recipes

Use a recipe only when its workload matches the request. Each row supplies an
ownership pattern, not a preset: start with the named owner, keep the initial
set minimal, add conditional skills only when their cause is observable, and
close every handoff and verification point through the router.

| Workload | Primary owner and smallest initial set | Conditional additions | Boundary and proof |
| --- | --- | --- | --- |
| Reference-image object reconstruction | `$threejs-object-sculptor` | `$threejs-procedural-geometry`, `$threejs-procedural-materials`, `$threejs-procedural-motion-systems`, `$threejs-camera-controls-and-rigs`, `$threejs-image-pipeline`, and `$threejs-visual-validation` only for the selected implementation branch | Preserve the reference's identity features; route photogrammetry and exact extraction outside the skill. Compare silhouette, proportions, joints, and material regions coarse-to-fine. |
| Local terrain or coastal scene | `$threejs-procedural-fields` + `$threejs-procedural-geometry` + `$threejs-procedural-materials` + `$threejs-water-optics` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-procedural-vegetation` or `$threejs-procedural-buildings-and-cities` for requested populations; `$threejs-spectral-ocean` for an observable open-water horizon; `$threejs-sky-atmosphere-and-haze` for aerial depth | One field owner supplies elevation, bathymetry, coast/support frames, material regions, and placement validity. Water owns shoreline behavior; consumers reuse the same coast. |
| Ocean planet | `$threejs-procedural-planets` + `$threejs-spectral-ocean` + `$threejs-sky-atmosphere-and-haze` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-volumetric-clouds` for an observable volume; `$threejs-exposure-color-grading` for an authored final-image transform | Planet owns body scale, spherical precision, horizon, and LOD. Ocean owns periodic surface bands; atmosphere owns radiometric transport. Verify orbit-to-horizon transitions and origin resets. |
| Wet built environment | `$threejs-rain-snow-and-wet-surfaces` + `$threejs-procedural-buildings-and-cities` + `$threejs-water-optics` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-scalable-real-time-shadows` for observable occlusion; `$threejs-bloom` or `$threejs-exposure-color-grading` after HDR sources and output policy exist | A supplied environment owner produces forcing. Rain owns transport/deposition and receiver accumulation; water owns puddle optics. Verify accumulation independently from visible drop count. |
| Vegetated flythrough | `$threejs-procedural-vegetation` + `$threejs-procedural-fields` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-scalable-real-time-shadows`, `$threejs-sky-atmosphere-and-haze`, or `$threejs-ambient-contact-shading` only for proven depth cues | Vegetation owns distribution, allometry, deformation, and stable population identity. Fields own support; camera owns origin/frustum changes. Verify chunk seams, LOD invariance, wind reset, and sustained traversal. |
| External body coupled to bounded water | Project solver + `$threejs-water-optics` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-particles-trails-and-effects` only for an independently required event layer | The project solver owns body dynamics; water owns fluid state. Declare one-way sampling or two-way reaction, versioned interval exchange, GPU completion, and immutable presentation samples. |
| Black-hole shot | `$threejs-black-holes-and-space-effects` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-bloom` and `$threejs-exposure-color-grading` only after HDR transport and exposure are correct | Space-effects owns ray transport and accretion emission. Verify mechanism diagnostics before final-image consumers. |
| Imported product/configurator | Project asset layer + `$threejs-procedural-materials` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-scalable-real-time-shadows` and `$threejs-exposure-color-grading` for explicit product-lighting/output contracts | Preserve imported hierarchy, dimensions, variant IDs, silhouette, and material assignments. Route ingestion, compression, and general lighting outside the pack. |
| Dense data dashboard | Project data layer + `$threejs-procedural-geometry` + `$threejs-procedural-materials` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-ambient-contact-shading` or final-image effects only when they preserve quantitative display semantics | Data layer owns values and stable IDs; geometry/materials own visual encoding. Verify transfer functions, selection identity, projected density, and output conversion. |
| Scientific field inspection | Scientific data/numerics layer + `$threejs-procedural-geometry` + `$threejs-procedural-materials` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-procedural-fields` may author a declared derived field while measured input remains authoritative | Preserve units, topology, uncertainty, and numerical error. Verify against trusted probes and fixed transfer-function diagnostics. |
| Imported AEC/BIM coordination | Project BIM layer + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-scalable-real-time-shadows` or `$threejs-ambient-contact-shading` only for an accepted legibility need | BIM layer owns dimensions, semantics, sections, picking, and LOD. Verify coordinate precision, clipping, identity, and navigation over the admitted scale range. |
| Digital twin | Application twin/data layer + the required field/geometry/material owners + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | Domain effects only when telemetry drives their declared inputs | Application owns entity identity, update age, interpolation, and stale-data policy. Rendering consumes immutable versions and verifies burst, gap, reset, and long-run behavior. |
| Procedural cinematic subject | `$threejs-procedural-geometry` + `$threejs-procedural-materials` + `$threejs-procedural-motion-systems` + `$threejs-camera-controls-and-rigs` + `$threejs-image-pipeline` + `$threejs-visual-validation` | `$threejs-particles-trails-and-effects`, `$threejs-bloom`, `$threejs-exposure-color-grading`, `$threejs-scalable-real-time-shadows`, `$threejs-sky-atmosphere-and-haze`, or `$threejs-volumetric-clouds` only for authored causal layers | Geometry owns silhouette, motion owns state evolution, and camera owns the shot. Prove the subject without post, then add each final-image consumer with a disable control. |

## Composing a recipe

1. Union requested causes, then remove every skill that owns none.
2. Assign one producer to each shared signal and one owner to each pass,
   temporal state, reset, and output conversion.
3. Declare conditional additions as deferred until their source signal or
   observable exists.
4. Freeze the same seed/data trace, camera path, target, and quality state for
   candidate A/B comparisons.
5. Accept from composed CPU/GPU/presentation tails, peak live memory, error,
   and sustained behavior; use standalone skill numbers only to choose what to
   measure.

A recipe is adapted when each selected skill owns a requested cause, each
external dependency is an explicit gap or supplied owner, and each proof tests
the actual composition.
