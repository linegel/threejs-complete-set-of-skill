# Three.js r185 Compatibility API Map

Use this map only after fallback activation and reverify each symbol against the
installed Three.js revision. Source paths are anchors; line numbers are not.

| API | Role | Source anchor | Compatibility rule |
| --- | --- | --- | --- |
| `WebGPURenderer` | initialized capability probe and renderer family | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | call `await renderer.init()` before backend inspection |
| `renderer.backend.isWebGPUBackend` / `isWebGLBackend` | initialized backend identity | `node_modules/three/src/renderers/webgpu/WebGPUBackend.js` and `webgl-fallback/WebGLBackend.js` | use positive identity after successful initialization; missing flags or rejected initialization stay unknown |
| `WebGPURenderer({ forceWebGL: true })` | isolated legacy branch | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | construct after explicit activation and maintenance acceptance |
| `WebGPURenderer({ trackTimestamp: true })` | timing opt-in | `node_modules/three/src/renderers/common/Backend.js` | set before initialization when GPU timing is required |
| `renderer.resolveTimestampsAsync()` | timing resolution | `node_modules/three/src/renderers/common/Renderer.js` | resolve fresh render/compute scopes with bounded query capacity and off-critical-path waits; follow visual-validation timing rules |
| `RenderPipeline` / `outputColorTransform` | post and output ownership | `node_modules/three/src/renderers/common/RenderPipeline.js` | keep one branch-owned graph and one output conversion |
| `pass()` / `mrt()` / `renderOutput()` | canonical signal/output nodes | `node_modules/three/src/nodes/` and `node_modules/three/src/Three.TSL.js` | inventory serialized or removed signals rather than implying parity |
| `WebGLRenderer` / `ShaderMaterial` / `EffectComposer` / `WebGLRenderTarget` | classic WebGL stack, not the node renderer's WebGL backend | `node_modules/three/src/materials/` and `node_modules/three/examples/jsm/postprocessing/` | use together inside their isolated classic-renderer branch; `forceWebGL` alone does not make this stack compatible |
| `InstancedMesh` | static/baked representation | `node_modules/three/src/objects/InstancedMesh.js` | batching does not imply compute/storage parity |
| `SRGBColorSpace` / `LinearSRGBColorSpace` / `NoColorSpace` | color/data domains | `node_modules/three/src/constants.js` | color textures declare their actual sRGB or Linear-sRGB space; non-color data textures use `NoColorSpace` |

API limits and alignments are `Gated` facts from the installed API. Runtime
observations are `Measured`; copy neither across devices nor revisions.
