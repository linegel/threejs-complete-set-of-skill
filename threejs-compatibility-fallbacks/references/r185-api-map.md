# Three.js Compatibility API Map

The filename's revision identifier is a `Gated` source-revision string for this
map, not transferable numeric evidence. Reverify every symbol against the
checked-in Three.js source before use. Source paths are intentionally used
without unstable line-number anchors.

This map remains inactive unless the current user explicitly requests teaching
how to apply fallback when WebGPU is unavailable. Canonical skills must not
import its legacy recommendations.

| API | Classification | Checked-in source | Compatibility rule |
| --- | --- | --- | --- |
| `WebGPURenderer` | canonical gate owner | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | Call `await renderer.init()` before reading backend truth. |
| `renderer.backend.isWebGPUBackend` | canonical backend flag | `node_modules/three/src/renderers/webgpu/WebGPUBackend.js` | If false, report a blocker unless the user explicitly activated unavailable-WebGPU fallback. |
| `WebGPURenderer({ forceWebGL: true })` | quarantined branch/test | `node_modules/three/src/renderers/webgpu/WebGPURenderer.js` | Construct only after explicit activation; never use as the canonical path. |
| `WebGPURenderer({ trackTimestamp: true })` | timing opt-in | `node_modules/three/src/renderers/common/Backend.js`, `node_modules/three/src/renderers/webgpu/WebGPUBackend.js` | Request before initialization when GPU timing is required; feature absence leaves the GPU claim insufficient. |
| `renderer.resolveTimestampsAsync()` | timestamp resolution | `node_modules/three/src/renderers/common/Renderer.js` | Resolve render and compute scopes separately and outside the steady-state timing window. |
| `RenderPipeline` | canonical post owner | `node_modules/three/src/renderers/common/RenderPipeline.js` | Preserve one pass graph and one output owner. |
| `RenderPipeline.outputColorTransform` | output ownership switch | `node_modules/three/src/renderers/common/RenderPipeline.js` | Do not duplicate conversion in a compatibility branch. |
| `pass()` | canonical pass node | `node_modules/three/src/nodes/display/PassNode.js`, `node_modules/three/src/Three.TSL.js` | Prefer the canonical shared graph; a compatibility branch documents every serialized or removed signal. |
| `mrt()` | canonical multi-output node | `node_modules/three/src/nodes/core/MRTNode.js`, `node_modules/three/src/Three.TSL.js` | If absent in the authorized branch, narrow diagnostics or inventory serial passes; never imply equivalent cost. |
| `renderOutput()` | canonical explicit output node | `node_modules/three/src/nodes/display/RenderOutputNode.js`, `node_modules/three/src/Three.TSL.js` | Retain exactly one tone-map/output-conversion owner. |
| `ShaderMaterial` | legacy, quarantined | `node_modules/three/src/materials/ShaderMaterial.js` | Allowed only inside the explicitly requested compatibility branch. |
| `EffectComposer` | legacy, quarantined | `node_modules/three/examples/jsm/postprocessing/EffectComposer.js` | Never reintroduce into canonical WebGPU/TSL guidance. |
| `WebGLRenderTarget` | legacy, quarantined | `node_modules/three/src/renderers/WebGLRenderTarget.js` | Inventory lifetime, attachment traffic, resolves, and disposal inside the branch. |
| `InstancedMesh` | representation primitive | `node_modules/three/src/objects/InstancedMesh.js` | Valid for static/baked branch data; not evidence of compute or storage parity. |
| `HalfFloatType` | data/target constant | `node_modules/three/src/constants.js` | Record precision and radiance error when replaced. |
| `NoColorSpace` | data-domain constant | `node_modules/three/src/constants.js` | Required for fields, masks, normals, and LUT data unless the datum is explicitly color. |
| `SRGBColorSpace` | color-domain constant | `node_modules/three/src/constants.js` | Use for color/albedo/emissive input maps, not computational data. |

Numeric limits read from adapters, APIs, or target contracts use
`{ value, unit, label, source }`. API-mandated values are `Gated`; runtime
observations are `Measured`. Do not copy limits between devices or revisions.
