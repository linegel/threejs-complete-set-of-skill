# Downgrade Decision Matrix

Use the first viable row. Do not skip to a legacy branch because it is easier.
Every selected row needs a loss ledger entry and validation delta.

| Missing or constrained primitive | First choice | Second choice | Third choice | Last resort |
| --- | --- | --- | --- | --- |
| WebGPU backend unavailable | Report blocker unless user explicitly asked for fallback | Precompute/static assets from canonical outputs | CPU/offline bake or feature removal | Legacy branch with explicit maintenance acceptance |
| Storage textures | Smaller native WebGPU storage format or fewer fields if available | Pack to storage buffers or render targets | Precompute baked textures | Remove dynamic feature |
| Storage buffers | Lower instance/particle count | Static instanced attributes | CPU-generated geometry/fields | Remove dynamic feature |
| MRT | Fewer diagnostics or serial passes in WebGPU | Precomputed diagnostic artifacts | Single final with explicit missing evidence | Reject validation claim |
| Timestamp queries | Label CPU-only proxy timing | Shorter fixed sample window | Browser/device matrix exclusion | Never claim zero GPU cost |
| Node post pipeline | Drop optional post effect | Use host output owner only | Prebaked look in textures with domain label | Do not duplicate tone/output conversion |
| Float HDR target | Lower resolution or lower precision WebGPU target | Clamp effect domain and name loss | Disable HDR-dependent feature | Never fake HDR with display-space math |
| Built-in node unavailable | Use documented TSL equivalent | Drop feature or lower quality | Precompute contribution | Avoid invented APIs |
| Memory cap | Reduce resolution/grid/cascade/count first | Lower update cadence | Static variants | Feature removal before legacy |
| Thermal cap | Adaptive update cadence with hysteresis | Fewer live effects | Static/baked branch | Feature removal before legacy |

Order of preference:

1. Same WebGPU architecture at lower quality.
2. Precomputed/static data with accurate color-space and loss labels.
3. CPU/offline bake.
4. Feature removal with honest UI/documentation.
5. Legacy WebGL branch only when the user explicitly asked how to apply
   fallback when WebGPU is unavailable and accepts maintenance cost.
