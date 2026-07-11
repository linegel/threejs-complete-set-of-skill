# Creature Habitat integration

This route now has a real host-owned native-WebGPU controller. It composes the
procedural creature stage, dense vegetation adapter, scale-executed
bounded-water compute stage, shared weather envelope with visible canonical
rain/snow/wet-surface/splash mechanisms, body-relative camera controller, one host
directional-shadow owner, and one final `RenderPipeline`.

Creature stance transitions write a bounded immutable contact snapshot. The
same frozen array identity is delivered to vegetation and water consumers.
Vegetation touch uniforms are mutable; placement storage is hashed before
contact fanout and checked after the first runtime contact in the explicit
`vegetation-trampling` validation mode (never in the performance route). The final outline
is derived from the creature-only emissive attachment in the same primary MRT,
so culling, visible geometry, shadow deformation, outline, and water contact
events originate from the same creature-stage instances.

Mechanism routes lock both their diagnostic mode and quality tier. Tier policy
is executable: `sceneScale` changes the live PassNode resolution, `waterScale`
changes the real heightfield dimensions and water mesh segments, and shadow/DPR
limits change live renderer resources. The runtime resource ledger reconciles
labelled resident, transient, and lower-bound bandwidth records. The quality
governor consumes only finite positive GPU render+compute timestamp durations,
uses a 30-sample nearest-rank p95, and cannot transition on missing timestamps.

`capturePixels("outline-mask")` reads the actual emissive MRT attachment.
`capturePixels("shadow-atlas")` samples the allocated directional-shadow target
and returns a color-managed RGBA8 render-target readback with explicit padded
row stride. `capture.mjs` uses the shared local Vite/Playwright harness and
supports both correctness and performance profiles; it is not an external URL
or status-only command.

The lab remains `incomplete`: no current-adapter timing, render-target capture
bundle, lifecycle trace, or manual visual review has been recorded. The capture
hook therefore labels its session non-publishable, while `validate:artifacts`
continues to return `INSUFFICIENT_EVIDENCE` until a complete v2 bundle exists.
