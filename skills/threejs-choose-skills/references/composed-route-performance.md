# Composed Route Performance

Use this contract only when the route claims frame time, latency, peak live
memory, adaptive quality, or sustained performance.

- For frame-time or sustained-performance claims, derive the frame interval as
  `1000 ms / target Hz`. Freeze only the applicable CPU, GPU, presentation,
  memory, and latency bounds.
- Accept performance from the full composed route on the target device,
  viewport, DPR, quality state, camera/input trace, and sustained thermal state.
- For frame-time, latency, or sustained-performance claims, trace the measured
  critical path across state advance, CPU preparation, uploads, GPU queues,
  synchronization, and presentation; it must satisfy the applicable bound.
- For frame-time, latency, or sustained-performance claims, treat CPU and GPU
  work as overlapping unless a measured dependency serializes them.
  Independent percentiles and standalone totals do not form a valid sum.
- For pass or dispatch cost, count each semantic operation once. A shared signal
  has one producer; encoding or resolution conversion has its own cost.
- For attachment memory or traffic, derive physical extent from CSS extent,
  renderer DPR, and pass scale, and logical payload from format, samples, and
  live slots. Measure actual allocation and traffic separately.
- When shared MRT is a candidate, compare it with minimal-forward rendering on
  representative target hardware; every attachment needs a named consumer.
- For marginal-cost claims, use paired feature-on/off samples from the same
  composed trace. GPU verdicts require timestamps; otherwise report them as
  `unmeasurable`.
- For adaptive-quality claims, give one hysteretic controller ownership of DPR
  and subsystem tiers. Each transition updates dependent resources, histories,
  resets, and disposal as one transaction.

A composed performance claim is complete when it satisfies its applicable bound
on the declared target and, when adaptive, each transition is one owned
transaction.
