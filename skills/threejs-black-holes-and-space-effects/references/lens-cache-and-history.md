# Lens Cache and History

Read this reference only after selecting a lens map, compute cache, reduced
effect pass, or temporal reconstruction.

## Cache the reusable cause

Cache bent direction, geometric termination class, exterior side, event
summary, and an optional direction Jacobian. Resample the current environment
and transfer inputs from that geometry cache. Cached tone-mapped color couples
unrelated environment, exposure, and output lifetimes.

Classify temporal records as direction-only or evaluated-radiance. A
direction-only record stores the bent direction and any geometric crossings
needed to reevaluate transfer; it resamples the current environment, emitter,
medium, and transfer inputs. An evaluated-radiance record keys each environment,
emitter, medium, and transfer identity by revision and sample instant; any
mismatch rejects that radiance sample.

Use a nonuniform critical-split transfer table for a static spherical Ellis or
Schwarzschild lens. Split at `B = 1` or `b = 3*sqrt(3)M`, concentrate samples
in `log(abs(impact-impact_critical))`, and keep the two termination sides
separate. Resolve a critical pixel footprint by integration or controlled
supersampling; one sample of a divergent mapping aliases regardless of solver
accuracy.

Each cache key includes the model and revision, nondimensional scale, lens
transform, camera event/frame, projection, viewport, integration bound,
tolerance, and map layout. Refresh when their change moves the mapped direction
beyond the declared fraction of an environment texel or changes a discrete
termination/event class.

**Cache criterion:** independent direct rays match cached termination,
exterior, event state, final direction, and Jacobian within their output-space
gates, including both sides of every critical split.

## Immutable history pairs

Give the history owner a stable view identity and immutable `previous` and
`current` records for the complete frame. Each record contains or can
reconstruct:

- model/revision and lens transform;
- camera transform, projection, origin epoch, viewport, and sample instant;
- bent direction, geometric termination/exterior class, representative depth,
  and ordered disk-crossing geometry;
- critical/Jacobian, disocclusion, invalid-state, and reactive masks;
- for evaluated radiance, radiance, transmittance, opacity termination, and
  environment, emitter, medium, and transfer revisions with their sample
  instants.

Rotate records only after all consumers of `previous` complete. Resize,
camera cuts, origin rebases, model/revision changes, transform or projection
discontinuities, termination/exterior/event changes, and large bent-direction
residuals produce scoped rejection or a full reset. Evaluated-radiance input
revision or sample-instant mismatches reject that radiance history; direction-
only history resamples the current inputs. Generic mesh depth and velocity are
insufficient because the visible sample follows a curved environment ray.

Temporal reconstruction amortizes interleaved pixels, stochastic footprints,
or low-rate cache updates. Reblending the same under-integrated deterministic
ray preserves its truncation bias. One history owner feeds the selected
reconstruction stage.

**History criterion:** mutation checks reject every discrete discontinuity,
evaluated-radiance tests reject every input revision or sample-instant mismatch,
direction-only tests resample current inputs, stable samples converge without
ghosting, and reset/resize/dispose leaves no stale resource reachable by the
next frame.

## GPU lifetime and cost

Create compute/storage resources only when measured reuse repays their traffic.
Declare format, dimensions, color space, filtering, mip policy, live count,
owner, and disposal point. Keep frame-critical results GPU-resident; validation
readback is an explicit asynchronous evidence path. In Three.js r185,
`renderer.computeAsync()` enqueues work after initialization but is not a GPU
completion fence, so resource reuse follows actual render-graph dependencies
or an explicit completion operation.

For a target with scale `s`, account for each allocation as:

```text
bytes = ceil(width*s) * ceil(height*s) * bytesPerTexel * liveTextureCount
```

Measure matched direct and cached frames on the target device, including cache
refreshes, rejection rate, accepted/rejected ray work, live bytes, and
whole-frame latency. A cache whose invalidation rate erases its saved work
returns to the direct branch.

**Resource criterion:** every allocation has one owner and retirement point,
GPU dependencies prevent overwrite, the frame path performs no synchronous
readback, and matched measurements show a net benefit at the required quality.
