# Precipitation Surface Systems

Precipitation reads as real only when particles, surface masks, normals,
roughness, residue, lighting, and diagnostics share the same weather envelope.
This reference teaches one renderer path: pinned Three.js r185 with
`WebGPURenderer`, TSL, `NodeMaterial`, node post, compute, and storage-backed
instance data.

## Contents

- Architecture
- Capability gate and tiers
- Shared weather envelope
- Compute precipitation volume
- Snow accumulation and object capping
- Wet puddles and ripple normals
- Rain streaks, impacts, and splashes
- Node presentation, color, and output
- Budgets
- Debug outputs
- Replaced techniques
- Boundaries and failure modes

## Architecture

Select analytic, recurrent, and persistent state independently before building
the frame graph:

```text
weather envelope
  -> immutable seeds + analytic camera-wrapped precipitation, OR
     recurrent storage + compute when forces/collisions require state
  -> one draw per rain/snow family through storage-backed attributes
  -> independently integrated world-stable snow/wetness/puddle state
  -> sparse impact buffers/dirty tiles or explicitly stylized ripple variants
  -> RenderPipeline node presentation
```

Static work is done once: spawn seeds, random phase, size, material variant,
surface sampler data, and mesh bindings. Per-frame work is limited to changed
forcing/state, the selected analytic or recurrent motion path, material field
evaluation, and necessary draws.

Before allocating dynamic particle state, classify motion:

- Constant fall plus constant wind is analytic: derive position from immutable
  seed, world-cell origin, and time in vertex TSL. For authored time-varying
  wind use accumulated displacement `integral v_wind(t) dt` or an analytic
  antiderivative. `currentWind * elapsedTime` teleports the field when wind
  changes. Spatially varying, stochastic, or history-dependent wind is
  recurrent state unless an exact trajectory integral exists.
- Turbulence, collision, or feedback is recurrent: update storage in compute.
- Camera-wrapped particles are visual density only. Physical impacts and
  accumulation use world-stable hashed cells/tiles so camera translation cannot
  move causes across the surface.
- Sparse impact events update only affected receiver tiles or a bounded event
  pool.

## Physics Contracts And Visible Signatures

Use physically named quantities even when art direction scales them. If a
particle uses a terminal-speed claim, state diameter/mass, fluid density, drag
coefficient, projected area, and model; for quadratic drag,
`v_t = sqrt(2 m g / (rho_air C_D A))`. Real drops and snow aggregates need
shape/Reynolds-dependent drag, so authored fall speeds are not universal
physics constants. Wind is horizontal world length units per second under the
declared scene scale. Capillary ripple rings are a bounded surface-response
approximation, not a water simulation. Snow deposition needs exposure,
occlusion, slope/adhesion, transport/melt, and capacity policy; an upward-normal
gate alone is only a stylized mask. Wetness first changes roughness,
absorption/base-color response, and layered dielectric Fresnel; do not
arbitrarily animate metalness or a bare-material F0 scalar.

A suspend policy is explicit: freeze the weather clock, analytically catch up
rate equations, or bounded-substep recurrent state. Clamping `deltaTime` while
advancing wall time silently loses deposition and is not deterministic.

Visible signature: rain streak length tracks fall speed, wind drift aligns with
wetness/ripple motion, ripples form expanding rings rather than unrelated
noise, snow does not stick to vertical faces, and wet asphalt roughness changes
before heavy-rain ripple normals. Wrong output: slow beads for heavy rain,
particle/wetness drift, vertical-face snow, roughness tied only to ripple masks,
or splash residue on hidden/downward faces.

## r185 Import Table

| Domain | Import |
| --- | --- |
| Renderer/pipeline/storage | `WebGPURenderer`, `RenderPipeline`, `StorageInstancedBufferAttribute`, `StorageBufferAttribute` from `three/webgpu` |
| TSL compute/material nodes | `Fn`, `instanceIndex`, `uniform`, `vec4`, `instancedArray`, `storage`, `textureStore`, `pass`, `mrt`, `renderOutput` from `three/tsl` |
| AO grounding | `three/addons/tsl/display/GTAONode.js` |
| Bloom highlights | `three/addons/tsl/display/BloomNode.js` |
| Temporal stability | `three/addons/tsl/display/TRAANode.js` |
| Large-scene shadows | `three/addons/csm/CSMShadowNode.js` |
| Tiled shadows | `three/addons/tsl/shadows/TileShadowNode.js` |

## Space Contract

| Space | Contract |
| --- | --- |
| Seed space | Immutable per-instance normalized spawn state. |
| Storage-record space | Packed `positionLife`, `velocityLife`, and `seedFlags` records. |
| World space | Weather wind, surface normals, splash impact positions. |
| Camera-wrapped volume | Volume centered around camera with no visible emitter edge. |
| View space | Presentation and depth/MRT consumers only. |
| Model space | Object snow coverage locks to model coordinates. |
| Decal/UV space | Puddle/decal masks declare UV origin and texel-center rule. |
| Storage-texture texels | Impact/ripple targets use explicit texel centers. |
| Normal matrix | Splash normals and snow normals are transformed before upward gating. |
| Depth/MRT owner | Shared image pipeline owns depth, normals, velocity, and output. |

## Checkpointed Build Order

Checkpoint 1: weather debug. You must see shared time, `deltaTime`, wind,
forcing, response-state ages, and quality tier; if you see drift, the likely
mistake is separate clocks.

Checkpoint 2: storage buffer debug. You must see packed position/life,
velocity/life, and seed/flags records; if you see CPU matrix uploads, the
likely mistake is a per-drop object loop.

Checkpoint 3: precipitation-domain test. Unbounded visual weather must show no
camera-streaming seam or phase jump; localized weather must show an intentional
world-anchored boundary/transition. Impacts remain fixed under camera motion.

Checkpoint 4: wetness mask. You must see roughness respond before ripple
normals; if ripples appear on a dry receiver, inspect forcing-to-response
integration and impact occupancy.

Checkpoint 5: normals. You must see snow displacement and snow normals from one
field; if silhouettes rise but normals stay flat, inspect field ownership.

Checkpoint 6: impact occupancy. You must see impact position, normal/tangent
frame, progress/lifetime, atlas, and opacity in storage; if splashes appear on
vertical/hidden faces, inspect world-space normal and depth gates.

Checkpoint 7: final. You must see one `RenderPipeline` output owner; if color
shifts, inspect double output transform.

Trap: unbounded camera-centred cells are world-hashed and only streamed around
the camera, never screen-UV wrapped. Localized volumes stay world-anchored.
Trap: model snow slides when coverage is sampled in world instead of model
space. Trap: splash normal tests must use transformed world normals. Trap:
roughness is tied to wetness before ripple masks. Trap: sRGB-as-data breaks
generated normal maps. Trap: output conversion belongs to the image pipeline.
Trap: CPU matrix upload breaks the storage-instance budget.

## Capability Gate And Tiers

Call `await renderer.init()` before probing the backend or creating resources
that require compute/storage.

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical weather path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Native WebGPU tiers preserve the weather cause and change representation:

- `full`: analytic or recurrent precipitation as required, world-stable sparse
  impacts, integrated receiver state, and measured reconstruction/post.
- `balanced`: lower projected density/history extent and fewer field bands,
  with response conservation and image-error gates intact.
- `budgeted`: analytic precipitation where possible, bounded sparse impacts,
  lower-rate/reduced receiver fields, and optional explicitly stylized ripple
  normals; no custom parallel renderer path.

Use the generated normal maps as the cheap rain tier and as diagnostics:

- `assets/generated-variants/ripple-normal-a.png`
- `assets/generated-variants/ripple-normal-b.png`
- `assets/generated-variants/ripple-normal-c.png`

## Shared Weather Envelope

One weather state feeds particles and surfaces. It exposes shared time, wind,
temperature, precipitation forcing, and quality nodes. Wetness, puddle fill,
and snow coverage are response states: integrate deposition against
drainage/evaporation/melt rather than assigning every surface to one progress
scalar.

```js
const weather = {
  time: uniform(0),
  deltaTime: uniform(0),
  wind: uniform(new THREE.Vector3(1.2, 0, 0.5)),
  temperatureC: uniform(5),
  forcing: uniform(0),
  precipitationRate: uniform(1),
  debugMode: uniform(0),
};

function updateWeather(delta, targetForcing) {
  weather.time.value += delta;
  weather.deltaTime.value = delta;
  weather.forcing.value = THREE.MathUtils.damp(
    weather.forcing.value,
    targetForcing,
    0.9,
    delta,
  );
}
```

The wind vector is horizontal in world units per second. `forcing` coordinates
the event, while response fields integrate their own physically named rates.
They share causes and time ownership without becoming identical curves.

## Recurrent Compute Precipitation

Use `StorageInstancedBufferAttribute` or TSL `instancedArray()` storage nodes
for dynamic instance state. The documented pattern is a TSL `Fn()` compute node
that writes storage data, then renders from that data via attribute nodes.

```js
const positionBuffer = instancedArray(maxInstances, "vec4");
const velocityLifeBuffer = instancedArray(maxInstances, "vec4");
const deltaTime = uniform(0);

const updatePrecipitation = Fn(() => {
  const i = instanceIndex;
  const positionLife = positionBuffer.element(i);
  const velocityLife = velocityLifeBuffer.element(i);
  positionLife.assign(
    vec4(
      positionLife.xyz.add(velocityLife.xyz.mul(deltaTime)),
      positionLife.w.add(deltaTime)
    )
  );
})().compute(maxInstances, [64]);

renderer.compute(updatePrecipitation);
```

This is only the r185 writable-node shape; constant velocity should normally be
evaluated analytically. A real recurrent solver adds its named force/integrator,
extent guards, lifecycle transition, and convergence gates. Use `storage()` over `StorageBufferAttribute` or
`StorageInstancedBufferAttribute` when you need explicit buffer ownership.
In r185 `computeAsync()` only awaits renderer initialization before enqueueing
compute and is not a GPU-completion fence. Reserve barriers/atomics for their
valid scope; global bins, scans, and compaction stages use ordered dispatches.

Choose the domain. Unbounded visual precipitation streams world-hashed cells
around the camera so finite pool bounds never appear; camera translation does
not change a cell's phase. Localized weather stays in a world-anchored bounded
volume with a physical/soft boundary. Rain may use streak sprites or instanced
capsules; snow may use soft sprites with seeded size/sway. Neither visual pool
owns impacts or accumulation.

Recommended dynamic records:

- `positionLife`: world position plus normalized life/opacity;
- `velocityLife`: fall velocity, wind contribution, and phase;
- `seedFlags`: seed, size, material variant, and active flag.

Keep static random values immutable. Only dynamic fields update in compute.

## Flux And Tier Conservation

Declare precipitation forcing as a world-space exposed-area flux `F` with
units such as water-equivalent length/time or mass/(area*time). Rendered
particle density is a sampling choice. For `N` deterministic accepted impact
samples representing receiver area `A` over interval `dt`, sample weights sum
to `F*A*dt`; changing visual particle count, simulation cadence, or LOD cannot
change total deposition. Use stratified world-cell samples, deterministic
overflow/drop accounting, and integrate the complete elapsed forcing,
drainage, evaporation, and melt interval when receiver cadence changes.

## Snow Accumulation And Object Capping

Ground snow needs one height field. The same field controls coverage,
displacement, material blend, sparkle mask, and normal reconstruction. In TSL,
author the field as reusable nodes and assign material slots:

- `positionNode` or displacement path: world-space snow height;
- `normalNode`: normal reconstructed from the same height field;
- `colorNode`: base albedo blended toward cool snow inside the mask;
- `roughnessNode`: high roughness inside settled snow, typically near `0.8`;
- `emissiveNode` or sparkle contribution: sparse and masked by snow coverage.

Do not create a separate normal field for snow. If the terrain cannot afford
dynamic field evaluation, bake the coverage mask and still derive displacement
and normal response from that same mask.

Object snow must be model-locked. Transform the world position into the host
object's stable model space for coverage sampling, then gate by the declared
world-space support-up direction. For ordinary gravity,
`upHat = -normalize(gravityWorld)`; planetary/local fields supply their local
gravity direction per sample:

```text
topMask = smoothstep(flatThreshold, 1.0,
                     saturate(dot(worldNormal, upHat)))
coverage = topMask * modelSpaceCoverage(modelPosition.xz)
```

Select `flatThreshold`, thickness, coverage, and edge softness from the named
surface/scale contract. Displace along the object normal and convert world
thickness to local units when needed.

## Wet Puddles And Ripple Normals

Wet asphalt is a material transition driven by rain progress. Split it into
separate bands:

- Early wetness: darken albedo slightly and move roughness toward a wet range.
- Puddle mask: form low areas from a world- or decal-space TSL field, not an
  undocumented hardcoded world-origin clip.
- Heavy rain: add ripple normals only after wetness is established.

Use `MeshPhysicalNodeMaterial` when clearcoat, IOR, or extra specular controls
matter; otherwise use `MeshStandardNodeMaterial`. Assign node slots directly:

```js
const material = new THREE.MeshPhysicalNodeMaterial({
  metalness: 0,
});

material.colorNode = wetColorNode;
material.roughnessNode = wetRoughnessNode;
material.normalNode = blendedNormalNode;
material.opacityNode = decalOpacityNode;
```

Ripple normals have two valid tiers:

- High tier: dynamic TSL or compute-derived ripple field tied to the shared
  weather envelope and impact/event buffers.
- Medium/reduced tier: preload one of the generated normal variants, mark it as
  data/normal content, and animate UV or blend weight from the shared envelope.

The cheap tier is the default for broad wet roads because it avoids evaluating
expensive ring fields for every wet pixel. Use dynamic ripples only for hero
closeups, bounded puddles, or explicit impact interaction.

## Rain Streaks, Impacts, And Splashes

Rain streaks are storage-instanced sprites or capsules. The compute dispatch
updates world position, life, velocity, opacity, and active state. Rendering is
one draw for the rain family through `SpriteNodeMaterial`, `MeshBasicNodeMaterial`,
or a narrow instanced geometry using node material alpha.

Splash placement should be GPU-owned when counts are high. Build candidate
surface data once, with weights from `dot(worldNormal, upHat)` and optional
authored masks. Gate the support-normal threshold from the receiver contract;
add depth or occlusion rejection when hidden surfaces can receive splashes.

Splash animation data belongs in storage:

- impact position;
- normal or tangent frame;
- progress and lifetime;
- atlas tile or variant;
- opacity.

Flipbook progress maps to a splash atlas in the node material. Billboarding
should rotate around the surface normal or camera-facing axis appropriate to
the shot, but instance transforms should not be rewritten every frame on the
CPU.

## Node Presentation, Color, And Output

Use a single `RenderPipeline` for the final chain:

```js
const pipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);
pipeline.outputNode = scenePass;
```

Use MRT only when later nodes reuse the same pass data, such as depth, normals,
wetness, velocity, or mask data. Use built-in nodes before custom effects:

- `GTAONode` or `ao()` for contact grounding under wet/snowy surfaces;
- `BloomNode` or `bloom()` only for bright splash highlights or stylized ice;
- `TRAANode` or `traa()` for temporal stability when rain streaks shimmer;
- `CSMShadowNode` or `TileShadowNode` for large scenes with weather-visible
  directional shadows.

Color and output rules:

- LDR albedo/base-color textures encoded as sRGB use `SRGBColorSpace`; HDR/EXR
  radiance remains loader-declared linear;
- normal, roughness, AO, masks, weather fields, generated ripple normals, and
  LUTs use `NoColorSpace` or linear treatment;
- keep HDR buffers as `HalfFloatType` until tone mapping;
- the pipeline owns the only tone map and output conversion with
  `outputColorTransform` or explicit `renderOutput()`;
- reduced-resolution effects use `PassNode.setResolutionScale()`.

## Performance contract

Select the state model before allocating a tier:

| Visible requirement | State cost |
| --- | --- |
| camera-relative streaks/flakes only | immutable seeds + analytic TSL position; zero simulation dispatch/storage mutation |
| recurrent forces or particle collisions | GPU-resident state and one measured solver dispatch per family |
| sparse world impacts | bounded event pool plus dirty tiles; cost scales with events/touched tiles |
| persistent wet/snow field | reduced-resolution state, update cadence and catch-up error declared |

Detailed constraints:

- one draw per precipitation family and one draw per splash pool;
- an explicit ordered dispatch ledger per family: solver, event binning,
  mark/scan/scatter or indirect-count stages only when selected; no universal
  one-dispatch cap;
- no per-drop object creation;
- no full-population CPU upload for dense recurrent transforms; sparse dirty
  authoritative ranges are allowed when cheaper than compute;
- use generated normal variants when dynamic ripple fields exceed the material
  budget;
- field octave count is selected by projected-frequency/error analysis; do not
  evaluate bands above pixel Nyquist or below visible contrast.

Record `{visibleInstances, coveredPixels, layersPerPixel, solverKind,
storageBytes, eventCount, dirtyTiles, fieldExtent, renderExtent, sampleCount}`.
Validate contemporaneous full-frame and paired-marginal p50/p95, transparent
overdraw, hot traffic, impact-field work, peak live bytes, and thermal behavior
against the product's scene allocation. A fixed instance count or device label
is not a performance proof.

## Debug Outputs

Expose at least:

- `final`: complete weather and surface response;
- `mask`: snow, wetness, puddle, or impact coverage;
- `normals`: accumulated snow normal or ripple normal tier;
- `particles`: precipitation density, wrapping, and active instance count;
- `events`: splash or impact buffer occupancy;
- `progress`: shared weather envelope.

Diagnostics should report backend tier, instance count, dispatch count, storage
size, generated variant selection, coverage percentage, and whether particles
and surfaces read the same weather envelope.

## Replaced Techniques

- CPU-updated rain and splash transforms were replaced with
  compute-updated storage instance data, because upload bandwidth and matrix
  mutation become the bottleneck at useful precipitation counts.
- Independent particle, puddle, and splash timers were replaced with one
  weather envelope, because coupled weather must not drift across systems.
- String-patched material customization was replaced with TSL node slots on
  `NodeMaterial`, because the node path is the current renderer architecture and
  composes with node post.
- Always-evaluated analytic ripple rings were replaced by generated ripple
  normal variants as the default road tier; dynamic ripple fields are reserved
  for closeups or interactive impacts where the extra cost buys visible value.
- Local-space splash weighting was replaced with world-space normal gating and
  optional depth or occlusion rejection, because transformed meshes otherwise
  spawn residue on invalid faces.
- Hardcoded circular wet decals were replaced with explicit material mode:
  either full-surface wetness driven by world/decal coordinates or a documented
  decal mask.

## Boundaries And Failure Modes

Use `$threejs-water-optics` when the system needs refraction through a bounded
water body, caustics, Fresnel, or Beer-Lambert thickness. Use
`$threejs-particles-trails-and-effects` for non-weather particles. Use
`$threejs-dynamic-surface-effects` for screen-space touch history, frost clearing, or
similar temporal surface buffers. Use `$threejs-image-pipeline` when the
precipitation effect must integrate with a larger HDR post stack. Use
`$threejs-scalable-real-time-shadows` when large-scene shadow allocation dominates weather
visibility.

Known failure modes:

- snow silhouettes rise but normals stay flat;
- object snow uses world coordinates and slides under animation;
- particles and surfaces read different time, wind, or progress values;
- puddle masks are independent of roughness and normal changes;
- roughness collapse is tied only to heavy-rain ripple masks;
- splashes sample all triangles and appear under objects or on vertical faces;
- data textures are tagged as color textures;
- the post stage double-applies output conversion;
- generated ripple-normal assets are used without preserving their normal-map
  interpretation.
