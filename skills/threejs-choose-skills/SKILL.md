---
name: threejs-choose-skills
description: Route multi-system Three.js WebGPU/TSL work to the smallest causal skill set. Use when a request spans multiple systems, needs shared pass/output ownership, or needs scene-wide performance coordination.
---

# Route Three.js WebGPU/TSL Work

Route for Three.js r185 with `WebGPURenderer` from `three/webgpu`, TSL from
`three/tsl`, and node materials. The installed package and initialized renderer
are the source of truth for APIs, backend, attachment limits, and timing
support.

## Route in four steps

### 1. Fix the contract

Record the installed revision and initialized backend. Then state:

- the primary observable and whether its contract is metric, identity,
  physically plausible, or perceptual;
- the authoritative input, units, coordinate frame, scale, topology, time
  behavior, target views, and interaction;
- each applicable deployment target and checkable bound for error, latency,
  frame time, and peak live memory;
- the reproducible seed, input trace, or camera path required by any comparison
  or replay.

Treat missing authoritative inputs as explicit gaps. Canonical claims require an
initialized WebGPU backend. Route compatibility teaching only when the user
explicitly asks how to apply a fallback.

When the route claims frame time, latency, peak live memory, adaptive quality,
or sustained performance, read
[composed-route-performance.md](references/composed-route-performance.md)
before freezing those bounds.

**Complete when:** the requested result, source of truth, and every applicable
target and acceptance bound are explicit and mutually consistent.

### 2. Select causal owners

Find the earliest missing cause: data/topology, geometry, field, material,
illumination, transport volume, motion, camera/projection, or image transform.
When more than one viable mechanism remains, compare the least-complex
candidates and name the evidence that rejects each losing candidate. Assign one
primary owner to the earliest missing cause, then add only skills that own a
requested cause, required input, or verification method.

When LOD, tessellation, impostors, field bands, or simulation extent depend on
screen error, read [projected-error-contract.md](references/projected-error-contract.md)
before choosing the representation.

**Complete when:** every requested observable has one owner or an explicit gap,
and every selected skill owns at least one necessary item.

### 3. Close handoffs and presentation ownership

When selected systems exchange physical state, events, or GPU resources, read [cross-system-handoffs.md](references/cross-system-handoffs.md) and close every applicable row before implementation.

Name every producer, consumer, version, execution order, lifetime, and
invalidation rule. Allocate depth, normal, velocity, identifiers, histories, or
MRT attachments only for named consumers. Reuse one scene render when the
shared `RenderPipeline` already exposes the required signals.

Assign one final-output owner per presentation target. Choose exactly one output
conversion:

- scene-linear `outputNode` with `outputColorTransform = true`; or
- explicit `renderOutput(...)` with `outputColorTransform = false`.

Set `renderPipeline.needsUpdate = true` after changing `outputNode` or
`outputColorTransform`. Key temporal state by semantic signal, view, encoding,
resolution, jitter, cadence, and reset policy.

**Complete when:** every cross-system edge closes every applicable handoff row,
every allocated resource has a consumer, and each target has one
tone-map/output path.

### 4. Prove the composed route

Verify the no-post or minimum-mechanism baseline first, then inspect the field,
geometry, material, depth, velocity, history, and output diagnostics that prove
the selected causes. Use mutation or disable controls where a plausible image
could hide a disconnected mechanism. Measure the full composition on the target
matrix and classify unavailable evidence as `unmeasurable`.

Read [router-recipes.md](references/router-recipes.md) only when a listed
multi-system workload matches the request; adapt its ownership pattern rather
than treating it as a preset. Add `$threejs-visual-validation` whenever a route
makes quantitative, temporal, adaptive, compute, or sustained-performance
claims.

**Complete when:** every acceptance bound has direct evidence from the composed
route, or the unsupported claim is narrowed and reported.

## Installed-skill boundary

Intersect the destination map with the skills actually installed. Report
missing owners; keep their requested causes outside the implementation until
an owner is supplied.

## Destination map

| Trigger | Load | Boundary |
| --- | --- | --- |
| Contact-scale occlusion, GTAO, bent normals, or bilateral AO reconstruction | `$threejs-ambient-contact-shading` | Requires owned depth and scale; normals are conditional. Preserve quantitative color semantics. |
| Curved rays, black holes, wormholes, or accretion transport | `$threejs-black-holes-and-space-effects` | Bloom and grading consume its HDR result after the transport mechanism passes. |
| Full-frame or selective HDR glow | `$threejs-bloom` | Requires proven HDR emission and exposure; bloom does not create emissive meaning. |
| Projection, orbit/free navigation, framing, floating origin, or control handoff | `$threejs-camera-controls-and-rigs` | Owns camera policy and reset signals, not subject motion. |
| Explicit teaching for an unavailable WebGPU backend | `$threejs-compatibility-fallbacks` | Load only for a user-requested fallback lesson after identifying the canonical WebGPU owner. |
| Reproducible runtime/API failure, source/docs disagreement, regression, or upgrade triage | `$threejs-debugging` | Add domain skills only when isolating the failing mechanism requires them. |
| Persistent screen-space frost, clearing, blur, or history masks | `$threejs-dynamic-surface-effects` | Owns screen-space history surfaces; world/object weather belongs to its domain owner. |
| Exposure, tone mapping, LUT grading, and display conversion | `$threejs-exposure-color-grading` | Quantitative displays may require a fixed transfer function; one output conversion remains exclusive. |
| Shared pass signals, MRT, histories, ordering, and final presentation | `$threejs-image-pipeline` | Load early for shared ownership and late for assembly; it owns no missing scene cause. |
| Reference-image feasibility, decomposition, or code-native object reconstruction | `$threejs-object-sculptor` | Photogrammetry, exact mesh extraction, and imported-asset production remain outside the skill. |
| Particles, trails, event layers, plasma, or shockwaves | `$threejs-particles-trails-and-effects` | Object transforms belong to motion; stable application/data identities remain authoritative. |
| Procedural building, facade, roof, ornament, or city grammar | `$threejs-procedural-buildings-and-cities` | Imported BIM/AEC representation and source-asset preparation remain external. |
| Procedural fauna, generated bodies, rigs, locomotion, or crowds | `$threejs-procedural-creatures` | Imported skinned-asset pipelines remain external. |
| Reusable scalar/vector fields, causal masks, domain warps, or derived normals | `$threejs-procedural-fields` | Measured scientific data stays authoritative in its data layer. |
| Generated vertices, indices, profiles, rails, topology, UVs, or material groups | `$threejs-procedural-geometry` | CAD/glTF ingestion, mesh repair, compression, and generic asset optimization remain external. |
| BRDF identity, filtered patterns/atlases, frame fields, semantic surface masks, or specular AA | `$threejs-procedural-materials` | Geometry owns silhouette; fields own shared causal masks. |
| Authored transform phases, rotating frames, springs, kinematics, or analytic motion | `$threejs-procedural-motion-systems` | Live-data interpolation stays in the application data layer. |
| Spherical bodies, planetary horizon/precision, craters, biomes, or spherical LOD | `$threejs-procedural-planets` | Local planar terrain stays with fields and geometry. |
| Plant growth, distribution, allometry, roots, canopies, or rooted wind | `$threejs-procedural-vegetation` | Terrain/support fields and environmental forcing keep their own authority. |
| Rain/snow transport, receiver accumulation, wetness, puddles, or splashes | `$threejs-rain-snow-and-wet-surfaces` | Consumes supplied environmental forcing; meteorological-state synthesis remains a gap. |
| Dynamic, cascaded, tiled-coverage, or cached real-time shadows | `$threejs-scalable-real-time-shadows` | Start with ordinary light shadows; add complexity only for a measured coverage/invalidation need. |
| Sky scattering, atmospheric shells, aerial perspective, or haze | `$threejs-sky-atmosphere-and-haze` | Image skills own final exposure/output, not radiometric transport. |
| Horizon-scale homogeneous directional sea across wavelength bands | `$threejs-spectral-ocean` | Periodic deep/open water ends at the coastal boundary owned by water optics. |
| Deterministic captures, diagnostics, sweeps, temporal checks, budgets, or regression evidence | `$threejs-visual-validation` | A report is evidence only when its required artifacts and controls were actually inspected. |
| Volumetric cloud density, lighting, transport, advection, or cloud shadows | `$threejs-volumetric-clouds` | Consumes environmental forcing; generic volume rendering and meteorology remain gaps. |
| Analytic, bounded, or coastal water, shore transformation, ripples, caustics, refraction, or absorption | `$threejs-water-optics` | Open-water spectra belong to spectral ocean; select the least solver that preserves the observable. |

## Explicit gaps

Keep these owners outside the public skill set unless the project supplies one:

| Request | Owner boundary |
| --- | --- |
| glTF/CAD/BIM/scientific ingestion, mesh repair, UV baking, compression, and source-asset LOD | Project asset/data pipeline and official Three.js tooling. |
| General lighting design, studio IBL/PMREM, reflection probes, and cube capture | Project lighting owner and official Three.js guidance. |
| Generic volume rendering, point-cloud/octree streaming, graph layout, and tensor visualization | Dedicated domain implementation. |
| Live transport, databases, telemetry schemas, and interpolation services | Application data layer. |
| Picking, selection, annotation, DOM UI, and accessibility | Application interaction/UI layer. |
| WebXR | Official Three.js/WebXR guidance or a dedicated skill. |
| Physics-engine selection and engine-internal simulation | The supplied engine or domain solver. Route only declared Three.js consumers; unsupported coupling channels stay explicit gaps. |
| Meteorological-state synthesis | A supplied environment coordinator. Weather and cloud skills consume its state. |
| Framework, deployment, editor, and generic application architecture | Project conventions. |

## Route result

Return a compact result shaped like this; include only fields the request uses:

```yaml
route:
  backend: { required: WebGPU, installedRevision: "", actualBackend: "" }
  contract: { observable: "", truth: "", units: "", frame: "", bounds: [] }
  primaryOwner: ""
  selected: []
  deferred: []
  gaps: []
  handoffs: []
  resources: []
  passes: []
  output: { owner: "", toneMap: "", conversion: "" }
  verification: []
  status: provisional | proven | blocked | unmeasurable
```

`selected` is minimal; `deferred` names a condition that would make each skill
necessary. Every handoff closes the applicable quantity/units, frame, time,
authority/version, validity/error, ordering, lifetime, and reset rows in
[cross-system-handoffs.md](references/cross-system-handoffs.md). Every resource
names its format, physical extent, lifetime, and consumers. `verification`
tests the selected cause rather than image plausibility alone.

Routing is complete when every requested observable or constraint has exactly
one owning skill or an explicit gap; every selected skill owns at least one
item; every cross-skill dependency closes every applicable handoff row; and
every verification point tests the selected cause.
