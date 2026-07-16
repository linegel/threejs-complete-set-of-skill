# Cloud Temporal Reconstruction

Read this reference for reduced-resolution current sampling, sparse phases,
representative depth, cloud velocity, history rejection, response time, or
depth-aware upsampling.

## Contents

- Architecture selection
- Current-frame data
- Representative depth
- Reprojection
- Response and rejection
- Upsampling
- Verification

## Architecture selection

Choose one current/history topology:

| Evidence | Topology |
| --- | --- |
| Small projected volume or low reuse | full-resolution current march without cloud history |
| Broad cloud, coherent motion, unimodal depth | full reduced-resolution current grid plus one history |
| Strict current-sample budget and very high coherence | sparse/checkerboard logical grid with explicit phase, age, and missing-sample reconstruction |
| Separated layers or independent winds | separate current products and histories by layer/depth cluster |
| Persistent high rejection | spend work on current resolution/samples instead of longer history |

A full reduced grid jitters each low-resolution ray inside its corresponding
full-resolution footprint; every low texel is current. Sparse/checkerboard
sampling updates only one logical phase and must reconstruct the missing
locations explicitly. Keep those algorithms distinct.

## Current-frame data

Store:

- premultiplied scene-linear HDR cloud radiance and transmittance;
- representative depth with its encoding and interval;
- cloud velocity from the advected cloud point;
- depth spread or front depth when one depth may be insufficient;
- rejection hints, current phase, and confidence where required.

Use explicit storage formats and filtering. Binary16 reaches only `65,504`
as a finite value. For interval-normalized R16F depth, derive world-space
quantization from the interval length and reject that encoding when its
round-to-nearest error consumes the temporal/upsample depth tolerance. Use R32F,
a shorter interval, logarithmic encoding, or another tested mapping when needed.

Reset sampling phase and invalidate incompatible history when the depth encoding
or interval changes.

## Representative depth

Use opacity-deposition weights:

```text
w_i = T_i*(1-T_step_i)
zMean = sum(w_i*s_i)/max(sum(w_i),epsilon)
zVariance = sum(w_i*(s_i-zMean)^2)/max(sum(w_i),epsilon)
```

`T_i` alone weights empty space and is not a contribution depth. Keep front
contribution depth when it improves silhouettes or disocclusion.

Select the history representation from measured depth structure:

| Distribution | History state |
| --- | --- |
| Narrow/unimodal | mean depth, one velocity, one history |
| Broad but connected | front depth plus mean/variance and lower history confidence |
| Separated layers | split histories |
| High topology residual | current result with history confidence zero |

Use the full march for radiance and transmittance; representative depth guides
reprojection rather than replacing transport.

## Reprojection

Reconstruct the representative point, map it through the immutable current and
previous origin/frame transforms, and reverse its cloud motion:

```text
xCurrentRender   = rayOrigin + rayDirection*zMean
xCurrentPhysics  = currentRenderToPhysics(xCurrentRender)
xPreviousPhysics = advectBackward(xCurrentPhysics, macroVelocity, relativeLayerVelocity, dt)
xPreviousRender  = previousPhysicsToRender(xPreviousPhysics)
historyUV         = project(previousViewProjection, xPreviousRender)
```

For changing velocity, integrate or use the same motion approximation that
advanced the density. Opaque-surface velocity is valid only if it demonstrably
represents the same advected cloud point. Version both transforms and set
history confidence to zero when either mapping is missing, nonfinite, or
incompatible with the history generation.

Resolve in this order:

1. Reconstruct the current cloud point and previous UV.
2. Reject UV outside the viewport before sampling or clamping.
3. Sample history through the declared bilinear/manual filter.
4. Compare reprojected history depth with current depth, spread, and encoding
   uncertainty.
5. Evaluate motion, camera, projection, topology, weather, and tier/reset
   causes.
6. Variance-clip accepted premultiplied HDR history against the current
   neighborhood.
7. Blend radiance and transmittance separately; update age/confidence; write the
   next history generation.

For sparse phases, choose a current proxy from a defined neighborhood with
depth/confidence rules before history blending. Full grids skip that operation.

## Response and rejection

Define `alphaCurrent` as the current-frame weight:

```text
alphaCurrent = 1-exp(-dt/responseTime)
resolved = alphaCurrent*current + (1-alphaCurrent)*clippedHistory
```

This preserves real-time response across frame rates. Increase current weight
under disocclusion, large motion, depth spread, topology residual, low
confidence, or approaching the maximum accepted ghost age.

Set history confidence to zero for:

- camera cuts or incompatible view/projection changes;
- missing or incompatible current-render-to-physics or
  previous-physics-to-render mappings;
- depth encoding or interval changes;
- resolution, render-scale, or history-layout changes;
- density recipe/seed, layer topology, or discontinuous weather changes;
- out-of-viewport UV;
- incompatible shadow/lighting state when it materially changes current
  radiance;
- nonfinite data or a resource generation mismatch.

Ordinary continuous camera/cloud motion and a rebase with valid
current-render-to-physics and previous-physics-to-render mappings should
reproject rather than reset. Track mapping versions, reset reason, and
current/history resource generations.

Define depth acceptance from all known uncertainty:

```text
depthResidual <= baseTolerance
                 + currentDepthSpread
                 + historyDepthSpread
                 + currentEncodingError
                 + historyEncodingError
                 + motionProjectionError
```

Variance clipping should operate in a stable HDR representation such as
log-luminance plus chroma or another decorrelated space. Clamp transmittance
independently to `[0,1]`.

## Upsampling

For reduced current/history products:

1. Gather the resolved low-resolution neighborhood.
2. Reconstruct or decode each cloud depth with its interval/error.
3. Compare cloud depth with full-resolution opaque depth and neighboring cloud
   depths.
4. Weight by depth agreement, confidence, transmittance, and spatial distance.
5. Composite `L_cloud + T_cloud*C_scene` in linear HDR.

Preserve opaque boundaries: samples whose cloud contribution lies behind the
nearest opaque surface receive zero weight. At thin cloud silhouettes, prefer
front depth or depth spread to a mean that falls behind the edge.

Host TAA can stabilize the final image, but it does not infer cloud advection,
cloud depth topology, or cloud history resets. Keep cloud reconstruction
state-owned and run the host output transform after composition.

## Verification

Use deterministic controls:

- a translating density slab with known world displacement and expected
  previous UV;
- static camera/static cloud accumulation;
- ordinary camera motion with low rejection;
- camera cut, projection change, topology change, and resolution change with
  confidence exactly zero;
- floating-origin rebase with a valid mapping, then an incompatible mapping
  with confidence exactly zero;
- two separated layers demonstrating the single-depth failure and split-history
  correction;
- depth encoding round-trip at every admitted interval;
- opaque-depth edge and disocclusion;
- frame-rate sweep demonstrating the same response time;
- HDR impulse/topology change measuring ghost decay;
- repeated resize/tier-switch/reset/dispose cycles.

Record current/history generations, origin-mapping versions, UV, depths,
spread, encoding error, velocity, rejection reason, response weight,
confidence, and upsample weights.
Completion requires reprojection residual, ghost decay, edge leakage, and
resource lifetime to fit their declared gates.
