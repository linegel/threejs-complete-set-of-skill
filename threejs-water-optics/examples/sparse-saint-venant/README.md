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

Run `node test-swe-core.mjs`. The test covers a non-flat 10,000-step lake at
rest, a 240-step wet/dry dam break, closed-domain volume, positivity, CFL
rejection, invalid-grid mutations, descriptor permutation, slot retention,
dry hysteresis, stale commit rejection, and capacity rollback.
