# TSL Procedural PBR Materials

Canonical WebGPU/TSL example for authored procedural PBR identities in this
skill folder. It demonstrates one shared cause graph driving `colorNode`,
`roughnessNode`, `metalnessNode`, `clearcoatNode`, derivative `normalNode`,
per-instance dissolve, and lava `emissiveNode` without replacing Three.js
physical lighting.

## What It Demonstrates

- `createWalnutPbrMaterial()` for oiled walnut.
- `createAntiqueGoldPbrMaterial()` for antique gold.
- `createEbonyFramePbrMaterial()` for ebony lacquer.
- `createLavaEmissivePbrMaterial()` for lava crust plus exposed HDR heat.
- Optional `loadLavaCauseMaps()` inputs from `../../assets/generated-variants/`;
  maps are configured as `NoColorSpace` data textures.
- `createInstancedDissolveAttributes()` for `instanceDissolve` and
  `instanceVariant`, read by one material graph through TSL attributes.
- `createTriplanarProjectionNode()` with the explicit cost note: full
  triplanar projection costs 3 texture samples per channel before filtering.

## Pipeline Graph

```text
explicit seed + stable object/world/UV coordinates
  -> shared structural fields: macro, grain, ridge, cavity, height
  -> authored identity bundle: walnut, gold, ebony, or lava crust/heat
  -> causal modifiers: tarnish, lacquer polish, lava exposure, dissolve
  -> filtered microstructure: fwidth-gated detail
  -> derivative normal: bumpMap(shared height)
  -> specular AA: dFdx/dFdy(final normal) widens roughness
  -> NodeMaterial PBR slots
  -> app-owned RenderPipeline / BloomNode / output transform
```

No compute dispatch is required for the default materials. Optional generated
cause-map or instance-state compute should run before rendering, then feed the
same slots. `initializeProceduralPbrMaterialData()` shows the capability gate
and restores the renderer render target after compute.

## Quality Tiers

| Tier | Material data | Sampling | Intended target |
| --- | --- | --- | --- |
| Ultra | 1024-2048 generated cause maps plus storage instanced attributes | TSL fields, optional hero triplanar, derivative normals, specular AA | desktop discrete |
| High | 512-1024 packed/generated cause maps | UV or object-space fields first, limited triplanar | desktop integrated |
| Reduced | 256-512 maps from `assets/generated-variants/` | no dynamic triplanar on repeats, static dissolve attributes | explicit request for how to apply fallback when WebGPU is unavailable |

## Budgets

- One hero material family: <= 0.8 ms at 1440p on desktop discrete.
- Common PBR path: keep under 8-12 texture/noise samples per pixel.
- Triplanar hero path: 18+ samples must be justified by close inspection.
- Storage: keep generated material textures and attributes <= 128 MB on Ultra,
  <= 64 MB on High, <= 32 MB on Reduced.
- Draws: one material per identity family; variants come from attributes.

## Debug Modes

`final`, `coordinates`, `identity`, `height`, `roughness`, `roughness-aa`,
`normal-variance`, `metalness`, `clearcoat`, `dissolve`, `emission`,
`triplanar-weights`, and `cause-map`.

Use `setProceduralPbrDebugMode(material, mode)` to switch modes.

## Checkpoints

1. Checkpoint 1: coordinates.
   you must see object/world/UV scale change without channel disagreement; if you see swimming fields, fix coordinate ownership.
2. Checkpoint 2: identity weights.
   you must see walnut/gold/ebony/lava masks drive color, roughness, metalness, and clearcoat together; if you see unrelated noise per channel, fix the shared cause graph.
3. Checkpoint 3: structural fields.
   you must see macro/grain/ridge/cavity reused by every PBR slot; if you see duplicated field calls, fix the cache.
4. Checkpoint 4: height and normal.
   you must see one shared height feeding the final normal; if you see normal detail unrelated to color or roughness, fix the normal source.
5. Checkpoint 5: roughness before and after AA.
   you must see normal-variance roughness widening; if you see sparkle at distance, fix specular AA.
6. Checkpoint 6: dissolve and shadow mask.
   you must see opacity and `maskShadowNode` change together; if you see visible/shadow mismatch, fix mask ownership.
7. Checkpoint 7: emission.
   you must see raw lava emissive in scene-linear HDR; if you see gray emission, fix output/color-space ownership.
8. Checkpoint 8: MRT and bloom.
   you must see lava emission feed bloom through the app pipeline; if you see material-owned glow encoding, move it to BloomNode.
9. Checkpoint 9: final output.
   you must see one output transform owner; if you see washed fields or double color conversion, remove duplicate `renderOutput()` or material display encoding.

## Minimal Usage

```js
import {
  createAntiqueGoldPbrMaterial,
  createInstancedDissolveAttributes,
  createLavaEmissivePbrMaterial,
  loadLavaCauseMaps,
  setLavaFlowTime,
} from "./procedural-pbr-materials.js";

const gold = createAntiqueGoldPbrMaterial({ seed: 23 });
mesh.material = gold;

const attributes = createInstancedDissolveAttributes(instancedMesh.count, {
  initialDissolve: 0.0,
  variantSeed: 7,
});
attributes.attachTo(instancedMesh.geometry);

const lavaMaps = await loadLavaCauseMaps();
const lava = createLavaEmissivePbrMaterial({
  seed: 41,
  causeMap: lavaMaps.a,
});

function frame(elapsedSeconds) {
  setLavaFlowTime(lava, elapsedSeconds);
  renderer.render(scene, camera);
}
```

Bloom, tone mapping, and output conversion belong to the app-level node
rendering pipeline, not these materials.
