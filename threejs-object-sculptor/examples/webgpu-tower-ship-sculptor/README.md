# Tower Ship Object Sculptor demo

This is the canonical interactive WebGPU demo for `threejs-object-sculptor`. It reconstructs the Tower Ship reference as a procedural, action-ready Three.js hierarchy rather than a merged decorative mesh.

The visible demo exposes five modes:

- `final`: authored geometry, material zones, and lighting;
- `blockout`: identity-critical masses before detail;
- `hierarchy`: semantic ownership colors for hull, tower, rig, oars, and deck details;
- `materials`: a deterministic neutral motion state for look development;
- `interaction`: 24 hinge-rooted oars plus sail and lantern motion.

The factory publishes `root.userData.sculptRuntime` maps for stable nodes, meshes, sockets, simplified colliders, and destruction groups. Geometry tiers reduce tessellation and secondary ornament density while preserving the tower-ship silhouette, semantic IDs, and all 24 oars.

The single composite reference cannot establish hidden geometry or exact PBR channels. Port-side and lower-hull forms are explicitly inferred; material response is image-informed procedural look development, not photogrammetric recovery.

## Attribution

The original Three.js Object Sculptor Codex Plugin, its workflow, and the Tower Ship reference are by [Vinh Hiển (`vinhhien112`)](https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin), used under the upstream MIT license. This repository adapts that work into its standalone skill/plugin structure and canonical WebGPU demo/lab contract.

## Validation

```bash
npm --prefix threejs-object-sculptor/examples/webgpu-tower-ship-sculptor run validate:quick
npm --prefix threejs-object-sculptor/examples/webgpu-tower-ship-sculptor run capture
npm --prefix threejs-object-sculptor/examples/webgpu-tower-ship-sculptor run validate:artifacts
```

