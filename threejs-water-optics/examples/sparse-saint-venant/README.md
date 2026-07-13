# Sparse Saint-Venant core

This directory starts the persistent wet/dry coastal route with a browser-free
float64 mechanism oracle. It is not yet the shipping GPU solver and makes no
native-WebGPU or performance claim.

`swe-core.js` implements first-order two-dimensional finite volumes with HLL
fluxes, hydrostatic reconstruction, reflective walls, dry-state momentum
reset, and an anisotropic CFL bound. State is `(h, h*u, h*w)` in metres and
SI momentum per unit width; bed elevation and free surface use +Y metres.

The first-order oracle was selected after six distinct solver-family scores.
It prioritizes lake-at-rest balance, wet/dry robustness, and a small GPU mapping
surface. Higher-order reconstruction, face-flux storage, sparse tile halos,
exact-once interaction sources, transactional GPU commit, and native Browser
evidence are required before the coastal route is source-complete.

`sparse-tile-domain.js` selects a fixed-capacity atlas with sorted compact tile
descriptors after comparing six residency families. Its prepare/commit boundary
keeps capacity failure atomic, retains atlas slots across active-front changes,
adds cardinal halo tiles for face fluxes, and delays dry deactivation by an
explicit tick count. Byte counts include three float32 conservative channels,
two ping-pong copies, core cells, and resident halo cells separately.

`gpu-swe-contract.js` selects the eight-dispatch reference graph after six GPU
execution architectures. It derives the unsplit CFL bound from each tier's
maximum represented depth and velocity, counts padded state, one canonical
flux plus two hydrostatic corrections per face, lookup/descriptor/display
records, and the validation ledger. These are logical bytes **[D]**; backend
alignment and residency remain Browser measurements **[M]**.

`gpu-swe-owner.js` implements that graph with native TSL storage buffers. The
committed buffer's interior cells are authoritative; its halo cells are derived
in a separate pass. Candidate cells remain separate until GPU validation has
checked finite values, nonnegative depth, and quantized closed-domain mass.
Only the final GPU commit dispatch copies a valid candidate and advances the
generation. Diagnostic readback is explicit and on-demand; the frame path has
zero readbacks.

Open `index.html?tier=budgeted&camera=hero` in Codex's in-app Browser for the
native diagnostic. Keys `1`, `2`, and `3` select hero, top, and profile views.
The button pauses solver admission before reading the eight-word GPU validation
ledger; no render-frame code invokes readback. `Run rollback mutation` inserts
one diagnostic-only pass between candidate update and validation. It must report
at least one negative candidate, hold committed generation and accepted count,
and advance only the rejection count. Normal stepping remains seven passes.
`Run 120-frame sustain` samples real presentation cadence and requires committed
generations to advance with zero invalid, negative, rejected, GPU-error, or
frame-readback events. It reports elapsed wall time but explicitly makes no GPU
timing claim. The HUD's resource byte count is the exact logical typed-array
inventory; backend alignment and physical residency remain unmeasured.

`?lifecycle=dispose` verifies the owned lifecycle after bootstrap: it stops the
animation loop, waits for `GPUQueue.onSubmittedWorkDone()`, disposes solver,
display, controls, and renderer resources, and requires the owned device-loss
reason to be `destroyed`. This is a single-owner disposal proof, not the later
50-cycle harness stress profile.

`offshore-boundary.js` is the float64 phase-resolved handoff oracle. It derives
finite-depth Airy elevation and wave discharge from the same absolute phase
clock, filters incident modes by a declared characteristic-impedance reflection
gate, injects only `q_n-c eta`, and preserves the coastal solver's outgoing
`q_n+c eta` plus tangential discharge. It does not claim that the one-way donor
renders coastal reflection beyond the coupling curve.

The native route wires the oracle's minimum-tier direct mode into west-edge
GPU halo cells. The halo reconstructs ghost depth and normal discharge from the
donor's incoming characteristic and the interior outgoing characteristic while
retaining interior tangential discharge. The mode advances on solver time, not
render time; there is no per-step CPU boundary upload or readback.
Open-domain transaction validation integrates canonical face-flux divergence
over every resident cell into separate net influx/outflux depth-sum quanta.
Candidate depth must reconcile against prior depth plus that exact discrete
exchange. A separate physical west-boundary ledger exposes exterior flux; its
difference from net flux reports sparse-interface cancellation residual. The
open boundary never disables mass validation or hides imbalance behind a larger
tolerance.

`foam-core.js` is the float64 coastal-foam oracle. It selects stable-physics-
frame conservative finite-volume coverage over five rejected representation
families, gates unsplit advection and explicit diffusion, and applies the exact
bounded source/decay reaction. The oracle keeps transport residual, source gain,
decay loss, and clamp count separate; foam appearance is not allowed to invent
coverage or breaking ownership.

The native graph carries committed/candidate foam coverage beside water state.
The shared halo pass transfers stable-frame coverage, one conservative upwind
pass transports it with depth-averaged carrier velocity and applies exact
source/decay reaction, validation gates coverage and carrier velocity, and the
water transaction commits or rejects both states together. The display samples
that coverage; unrelated texture noise cannot create whitewater.

`interaction-source-core.js` owns the moving-body-to-SWE momentum adapter
oracle. It compares six materially different representations and selects a
cell-in-cloud discrete-adjoint scatter for each hull quadrature point. A
complete four-cell receiving stencil gives nonnegative weights, exact total
horizontal impulse, and exact first moment about an arbitrary balance point.
The adapter converts N s into the conservative discharge increment with the
declared water density and cell area, validates the full batch before mutation,
advances exact-once keys only with the candidate, and emits the equal-opposite
reaction summary. Missing halo/receiver cells fail instead of renormalizing and
moving the force centroid. This source oracle does not claim a resolved solid
boundary; moving cut cells and Brinkman penalization remain separate obstacle
candidates.

The native owner prepares that same conservative per-cell field once and lets
each cell gather its source only while the committed batch sequence is older.
To remain inside the portable default limit of eight storage buffers per
compute stage, x and z source increments travel through the reserved `.w`
channels of the already-required west x-face and south z-face records. This was
selected over elevated device limits, another source pass/ping-pong, semantic
state aliasing, or record-times-cell gathering. The transaction ledger's
sequence advances only in the successful atomic commit, so rejection retries
the source without duplicate application. Open
`?tier=budgeted&interactionRollback=1` to reject the first sourced candidate,
prove the interaction cursor remains zero, then admit the identical source once.

`inundation-exchange-core.js` owns the water side of exposed-surface wetness.
It compares six exchange families and selects a capacity-, uptake-, and
available-water-limited mass transfer. The prepared water depth loses exactly
the kilograms delivered to the receiver; dry, unowned, and full receiver cells
do not create a transfer. Each interval-end `massTransfer` names both state
versions, its physical cell area, exact-once key, conservation/commit group,
and following-interval runoff rule. The weather/receiver owner consumes those
records into its separate `kg/m²` inventory. Water and receiver candidates must
commit all-or-none; a material never writes either state.

Run `node test-swe-core.mjs`. The test covers a non-flat 10,000-step lake at
rest, a 240-step wet/dry dam break, closed-domain volume, positivity, CFL
rejection, invalid-grid mutations, descriptor permutation, slot retention,
dry hysteresis, stale commit rejection, and capacity rollback.
