# Three.js r185 Compatibility API Map

Use this map only after fallback activation and reverify each symbol against the
installed Three.js revision. Source paths are anchors; line numbers are not.

| API | Role | Source anchor | Compatibility rule |
| --- | --- | --- | --- |
| `WebGPURenderer` | initialized capability probe and renderer family | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | call `await renderer.init()` before backend inspection |
| `renderer.backend.isWebGPUBackend` | initialized backend truth | `node_modules/three/src/renderers/webgpu/WebGPUBackend.js` | false satisfies only the technical half of activation |
| `WebGPURenderer({ forceWebGL: true })` | isolated legacy branch | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | construct after explicit activation and maintenance acceptance |
| `WebGPURenderer({ trackTimestamp: true })` | timing opt-in | `node_modules/three/src/renderers/common/Backend.js` | set before initialization when GPU timing is required |
| `renderer.resolveTimestampsAsync()` | timing resolution | `node_modules/three/src/renderers/common/Renderer.js` | resolve render/compute scopes outside the steady-state window |
| `RenderPipeline` / `outputColorTransform` | post and output ownership | `node_modules/three/src/renderers/common/RenderPipeline.js` | keep one branch-owned graph and one output conversion |
| `pass()` / `mrt()` / `renderOutput()` | canonical signal/output nodes | `node_modules/three/src/nodes/` and `node_modules/three/src/Three.TSL.js` | inventory serialized or removed signals rather than implying parity |
| `ShaderMaterial` / `EffectComposer` / `WebGLRenderTarget` | legacy primitives | `node_modules/three/src/materials/` and `node_modules/three/examples/jsm/postprocessing/` | keep inside the isolated branch and own lifetime/disposal |
| `InstancedMesh` | static/baked representation | `node_modules/three/src/objects/InstancedMesh.js` | batching does not imply compute/storage parity |
| `SRGBColorSpace` / `NoColorSpace` | color/data domains | `node_modules/three/src/constants.js` | color inputs use sRGB; computational data stays linear |

API limits and alignments are `Gated` facts from the installed API. Runtime
observations are `Measured`; copy neither across devices nor revisions.
