# Downgrade Decision Matrix

Use this matrix only after `SKILL.md`'s explicit activation record is complete.
For each feature, choose the first response that preserves the classified
invariants and passes its claim-specific gates.

| Unavailable capability | Static/precomputed | Bounded CPU/offline | Remove | Isolated legacy |
| --- | --- | --- | --- | --- |
| runtime compute | versioned canonical outputs when interaction is unnecessary | update at a measured cadence with bounded uploads and named latency | remove live dynamics | maintain a separate renderer branch only when interaction still warrants it |
| storage textures/buffers | immutable textures, attributes, pages, or baked animation | generate data with explicit layout, precision, cadence, and lifetime | remove stateful behavior | use branch-owned ping-pong or legacy resources with equivalent state tests |
| MRT/shared scene signals | pre-bake the dependent contribution | serialize inventoried passes only when timing and attachment gates pass | remove the dependent effect/diagnostic | own a separate pass graph; never claim canonical pass cost |
| scene-linear HDR/node post | pre-bake a display-referred look with its camera/lighting envelope | generate bounded LUTs or contributions in their declared domain | remove HDR-dependent behavior | retain one branch-owned HDR/output graph when supported |
| dynamic interaction | authored static states or precomputed transitions | approximate with explicit latency, support, and state-domain limits | remove interaction | accept a separately maintained interactive product |
| target memory/traffic limit | reduce stored intermediates, resolution, samples, or history under frozen error gates | stream bounded variants with measured uploads and peak liveness | remove the largest unsupported contributor | accept the legacy branch only after sustained target evidence |
| required GPU timestamps unavailable | use a target/browser that exposes timestamps | narrow the claim to end-to-end timing | remove the GPU-attribution claim | return `INSUFFICIENT_EVIDENCE` if attribution remains required |

Across all rows:

- preserve color/data domains and one output-transform owner;
- record every visible, temporal, interaction, and lifecycle loss;
- keep branch imports, artifacts, tests, deployment, and disposal isolated;
- treat native WebGPU quality scaling as canonical-owner work;
- select a higher-fidelity row or remove the feature when a frozen error gate
  fails.
