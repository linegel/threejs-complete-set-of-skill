# WebGPU Weather Volume Clouds

This is the canonical Phase 1 contract for `threejs-volumetric-clouds`. The
legacy `../weather-volume-clouds/` sample remains a deprecated WebGL baseline;
new work targets `WebGPURenderer`, TSL, storage textures, reduced-resolution
temporal reconstruction, compact cloud-shadow cascades, and linear HDR output
into the host image pipeline.

## Checkpointed Build Order

1. Field load: read `../../assets/weather-volume-clouds/manifest.json`, verify
   byte lengths and hashes, then load weather/noise/depth data as
   `NoColorSpace` data. A color-space mismatch is a hard failure.
2. Layer packing: create CPU `CloudLayer` controls, merge occupied layer bands,
   and pack complementary empty gaps. The default occupied bands are
   `750-2200 m` and `7500-8000 m`; the default skipped gap is `2200-7500 m`.
3. Interval debug: expose packed empty intervals separately from occupied
   bands. If clouds disappear between low and high layers, the implementation
   probably skipped occupied bands.
4. Capability gate: initialize one `WebGPURenderer` with `await renderer.init()`
   and use compute/storage tiers only when the WebGPU backend is active.
5. Shadow RGBA: update `cloudShadowCascade` storage textures on their own
   cadence. Channels are `frontDepth`, `meanExtinction`, `maxOpticalDepth`, and
   `tailEstimate`.
6. Beauty march counts: dispatch a half/quarter linear-resolution cloud pass,
   skip packed empty gaps, adapt step length through low density, and write
   radiance/transmittance plus representative depth and velocity.
7. Temporal rejection: reconstruct with `historyUV`, viewport rejection,
   `depthReject`, velocity spike rejection, `varianceClip`, camera-cut reset,
   and layer/weather discontinuity reset.
8. Upsample weights: composite from low resolution to full resolution with
   representative-depth agreement, transmittance confidence, and opaque scene
   depth.
9. Final composite: output linear HDR cloud radiance/transmittance only. The
   host `RenderPipeline` owns the single `renderOutput` or output transform.

## Must See

- `node validation.js` passes.
- The layer interval debug view labels `2200-7500 m` as skipped empty space.
- Storage budget output stays below the selected tier budget.
- Shadow debug views show all four RGBA optical-depth channels.
- Temporal diagnostics show representative depth, velocity, `historyUV`,
  rejection, and variance bounds.

## If You See

- `shape.bin` identified as an unrelated binary type by `file`: rely on this
  manifest, byte length, and hash instead of MIME guessing.
- Ghosting during camera motion: inspect velocity and representative-depth
  rejection before lowering temporal alpha.
- Bright flat interiors: verify short sun optical depth and
  `cloudShadowCascade` lookup before raising primary steps.
- Unexpected color shift: check that the cloud composite is still linear HDR
  and that only the host pipeline applies final output conversion.
