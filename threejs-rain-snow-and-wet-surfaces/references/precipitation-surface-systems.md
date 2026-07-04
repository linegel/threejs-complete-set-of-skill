# Precipitation Surface Systems

Precipitation reads as real only when particles, surface masks, normals,
roughness, residue, lighting, and diagnostics share the same weather envelope.
This reference teaches one implementation path: latest Three.js with
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

Start from the highest-throughput design, then reduce quality only when the
backend or device budget demands it:

```text
weather envelope
  -> storage instance seeds and dynamic state
  -> compute dispatch updates camera-wrapped precipitation positions
  -> one draw per rain/snow family through storage-backed attributes
  -> TSL material fields for snow, wetness, puddles, normals, and roughness
  -> GPU impact buffers or generated ripple-normal variants
  -> RenderPipeline node presentation
```

Static work is done once: spawn seeds, random phase, size, material variant,
surface sampler data, and mesh bindings. Per-frame work is limited to weather
uniform updates, compute dispatches for dynamic state, material field evaluation,
and the necessary draw calls.

## Physics Contracts And Visible Signatures

Use physically named quantities even when art direction scales them. Rain
terminal velocity is typically treated as `4-9 m/s` in inspection-scale scenes;
snow is usually `0.8-3.5 m/s`. Clamp `deltaTime` before integrating weather so
tab suspends do not create streak jumps. Wind is horizontal world units per
second. Capillary ripple rings assume shallow surface disturbances; do not use
them as a bounded water simulation. Snow coverage is upward-normal gated, so
vertical faces should remain clear unless an explicit art override is enabled.
Wetness changes porosity/roughness/F0 response before ripple normals appear.

Visible signature: rain streak length tracks fall speed, wind drift aligns with
wetness/ripple motion, ripples form expanding rings rather than unrelated
noise, snow does not stick to vertical faces, and wet asphalt roughness changes
before heavy-rain ripple normals. Wrong output: slow beads for heavy rain,
particle/wetness drift, vertical-face snow, roughness tied only to ripple masks,
or splash residue on hidden/downward faces.

## r185 Import Table

| Domain | Import |
| --- | --- |
| Renderer/pipeline | `RenderPipeline` from `three/webgpu` |
| TSL compute/material nodes | `Fn`, `instancedArray`, `storage`, `textureStore`, `pass`, `mrt` from `three/tsl` |
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
progress, and quality tier; if you see drift, the likely mistake is separate
clocks.

Checkpoint 2: storage buffer debug. You must see packed position/life,
velocity/life, and seed/flags records; if you see CPU matrix uploads, the
likely mistake is a per-drop object loop.

Checkpoint 3: camera-wrap edge test. You must see no emitter bounds entering
the frame; if you see straight volume edges, inspect seed-space wrapping.

Checkpoint 4: wetness mask. You must see roughness respond before ripple
normals; if ripples appear on dry asphalt, inspect progress bands.

Checkpoint 5: normals. You must see snow displacement and snow normals from one
field; if silhouettes rise but normals stay flat, inspect field ownership.

Checkpoint 6: impact occupancy. You must see impact position, normal/tangent
frame, progress/lifetime, atlas, and opacity in storage; if splashes appear on
vertical/hidden faces, inspect world-space normal and depth gates.

Checkpoint 7: final. You must see one `RenderPipeline` output owner; if color
shifts, inspect double output transform.

Trap: camera volume must wrap in world/camera volume space, not screen space.
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

if (renderer.backend.isWebGPUBackend) {
  // High tier: compute, storage buffers, storage textures, dynamic fields.
} else {
  // Reduced tier: same weather envelope, lower counts, generated variants.
}
```

Tiers:

- `high`: 100k+ precipitation instances on desktop discrete GPUs, dynamic
  storage buffers, optional `StorageTexture` event accumulation with
  `textureStore()`, dynamic TSL ripple or snow fields, and node post.
- `medium`: lower instance counts, fewer material-field octaves, pregenerated
  ripple normals from `assets/generated-variants/`, and reduced-resolution
  post nodes.
- `reduced`: static coverage masks, generated ripple normals, fewer instances,
  and no custom parallel renderer path.

Use the generated normal maps as the cheap rain tier and as diagnostics:

- `assets/generated-variants/ripple-normal-a.png`
- `assets/generated-variants/ripple-normal-b.png`
- `assets/generated-variants/ripple-normal-c.png`

## Shared Weather Envelope

One weather envelope feeds particles and surfaces. It should be exposed as
shared TSL uniform nodes or uniform references, then grouped by the app so every
consumer reads the same time, wind, progress, and quality state.

```js
const weather = {
  time: uniform(0),
  deltaTime: uniform(0),
  wind: uniform(new THREE.Vector3(1.2, 0, 0.5)),
  progress: uniform(0),
  precipitationRate: uniform(1),
  debugMode: uniform(0),
};

function updateWeather(delta, targetProgress) {
  weather.time.value += delta;
  weather.deltaTime.value = delta;
  weather.progress.value = THREE.MathUtils.damp(
    weather.progress.value,
    targetProgress,
    0.9,
    delta,
  );
}
```

The wind vector is horizontal in world units per second. `progress` is the
event envelope: wetness, snow coverage, splash intensity, and particle opacity
derive from it instead of maintaining unrelated clocks.

## Compute Precipitation Volume

Use `StorageInstancedBufferAttribute` or TSL `instancedArray()` storage nodes
for dynamic instance state. The documented pattern is a TSL `Fn()` compute node
that writes storage data, then renders from that data via attribute nodes.

```js
const positionBuffer = instancedArray(maxInstances, "vec4");
const velocityLifeBuffer = instancedArray(maxInstances, "vec4");
const seedBuffer = instancedArray(maxInstances, "vec4");

const updatePrecipitation = Fn(() => {
  const i = instanceIndex;
  const positionLife = positionBuffer.element(i);
  const velocityLife = velocityLifeBuffer.element(i);
  const seed = seedBuffer.element(i);

  // Update fall speed, wind drift, lifetime, wrapping, and opacity tier here.
  // Keep all state in storage; do not mirror dynamic values back to the CPU.
})().compute(maxInstances);

renderer.compute(updatePrecipitation);
```

Use `renderer.computeAsync()` when later render work must wait on the dispatch
outside the frame loop. Use `storage()` over `StorageBufferAttribute` or
`StorageInstancedBufferAttribute` when you need explicit buffer ownership.
Reserve `workgroupBarrier` and `atomic*` operations for compaction, counters,
or event bins that truly need cross-invocation coordination.

Camera wrapping is mandatory. The wrapped volume is centered from the camera,
volume dimensions, and a vertical offset so finite emitter bounds never become
visible. Use seed-space positions plus wind and fall displacement, then wrap
with the volume extent. Rain uses long narrow streak sprites or instanced
capsules; snow uses soft sprites with size and sway derived from seed values.

Recommended dynamic records:

- `positionLife`: world position plus normalized life/opacity;
- `velocityLife`: fall velocity, wind contribution, and phase;
- `seedFlags`: seed, size, material variant, and active flag.

Keep static random values immutable. Only dynamic fields update in compute.

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
object's stable model space for coverage sampling, then gate by a world-space
upward normal:

```text
topMask = smoothstep(flatThreshold, 1.0, saturate(worldNormal.y))
coverage = topMask * modelSpaceCoverage(modelPosition.xz)
```

Typical controls: `flatThreshold` around `0.35`, thickness around `0.06`,
coverage around `0.7`, and edge softness around `0.15`. Displace along the
object normal and convert world thickness to local units when needed.

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
surface data once, with weights from world-space upward normals and optional
artist masks. Accept only surfaces above a threshold such as `worldNormal.y >
0.35`; add depth or occlusion rejection when hidden surfaces can receive
splashes.

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

- albedo/base-color textures use `SRGBColorSpace`;
- normal, roughness, AO, masks, weather fields, generated ripple normals, and
  LUTs use `NoColorSpace` or linear treatment;
- keep HDR buffers as `HalfFloatType` until tone mapping;
- the pipeline owns the only tone map and output conversion with
  `outputColorTransform` or explicit `renderOutput()`;
- reduced-resolution effects use `PassNode.setResolutionScale()`.

## Budgets

Set budgets before implementation:

| Tier | Instances | Dynamic storage | Dispatches | Weather target |
| --- | ---: | ---: | ---: | ---: |
| Desktop discrete | 100k-300k | 5-20 MB | 1-3 | 2.5-3.5 ms |
| Desktop integrated | 40k-100k | 2-8 MB | 1-2 | 3.5-5.0 ms |
| Mobile/reduced | 8k-40k | 0.5-3 MB | 0-1 | <= 3.0 ms |

Detailed constraints:

- one draw per precipitation family and one draw per splash pool;
- one compute dispatch per family, plus one optional impact/event dispatch;
- no per-drop object creation;
- no per-frame CPU upload for dynamic instance transforms;
- use generated normal variants when dynamic ripple fields exceed the material
  budget;
- surface fields should stay at 2 to 4 noise octaves unless a hero closeup
  justifies more.

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
