# Three.js r185 API Map

Anchors are from the checked-in `node_modules/three` source. Use them to avoid
invented compatibility APIs.

| API | Status | Import/source proof | Compatibility note |
| --- | --- | --- | --- |
| `WebGPURenderer` | canonical gate owner | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js:28` | Use `await renderer.init()` before reading backend truth. |
| `renderer.backend.isWebGPUBackend` | canonical backend flag | `node_modules/three/src/renderers/webgpu/WebGPUBackend.js:88` | If false and user did not explicitly ask for fallback, report blocker. |
| `WebGPURenderer({ forceWebGL: true })` | quarantined branch/test | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js:41,57` | Use only for explicit fallback teaching, never as canonical. |
| `RenderPipeline` | canonical post graph | `node_modules/three/src/renderers/common/RenderPipeline.js:22` | Keep one tone/output owner. |
| `RenderPipeline.outputColorTransform` | output ownership switch | `node_modules/three/src/renderers/common/RenderPipeline.js:66,208` | Do not double-convert in fallback tiers. |
| `pass()` | canonical pass node | `node_modules/three/src/nodes/display/PassNode.js:1024`, `node_modules/three/src/Three.TSL.js:433` | Prefer host pass graph over per-effect renderers. |
| `mrt()` | canonical multi-output node | `node_modules/three/src/nodes/core/MRTNode.js:201`, `node_modules/three/src/Three.TSL.js:335` | If unavailable, validation evidence must say which diagnostic is lost. |
| `renderOutput()` | explicit output conversion node | `node_modules/three/src/nodes/display/RenderOutputNode.js:157`, `node_modules/three/src/Three.TSL.js:474` | Only one owner. |
| `ShaderMaterial` | legacy/quarantined | `node_modules/three/src/materials/ShaderMaterial.js:45` | Allowed only inside the requested compatibility branch. |
| `EffectComposer` | legacy/quarantined | `node_modules/three/examples/jsm/postprocessing/EffectComposer.js:42` | Do not reintroduce as flagship post path. |
| `WebGLRenderTarget` | legacy/quarantined | `node_modules/three/src/renderers/WebGLRenderTarget.js:8` | Use only for explicit fallback branch inventories. |
| `InstancedMesh` | neutral primitive | `node_modules/three/src/objects/InstancedMesh.js:28` | Valid for static/baked fallback data; not a compute substitute by itself. |
| `HalfFloatType` | data/target constant | `node_modules/three/src/constants.js:698` | Record precision loss when downgraded. |
| `NoColorSpace` | data texture domain | `node_modules/three/src/constants.js:1300` | Required for fields, masks, normals, LUT data unless explicitly color. |
| `SRGBColorSpace` | color texture domain | `node_modules/three/src/constants.js:1308` | Use for color/albedo/emissive input maps only. |
