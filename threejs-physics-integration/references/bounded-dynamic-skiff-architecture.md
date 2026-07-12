# Bounded Dynamic Skiff Architecture Decision

This decision covers one small floating hull in bounded, mild, single-valued
water. It does not cover planing craft, capsize, slamming, green water,
overturning breakers, entrained air, propellers, or general rigid-body contact.
Those observables require a different route.

## Frozen observable and gates

The required observable is a visibly translating and rotating skiff whose
closed hydrostatic proxy exchanges equal-and-opposite linear impulse, angular
impulse, and interface work with persistent water at one fixed physics time.
Render transforms consume a committed presentation pair; the render loop does
not integrate either state.

The following gates are frozen before implementation:

- no synchronous frame-critical GPU readback;
- a closed hull proxy with positive mass and positive-definite inertia;
- exact-once source/reaction application and atomic commit;
- force and torque reaction residuals at or below their labelled gates;
- fixed, scheduler-bounded correction count and an added-mass stability gate;
- deterministic replay under the reference reduction order;
- explicit memory, dispatch, and sustained target timing evidence before a
  mobile-performance claim;
- no SWE, diffraction, slamming, or three-dimensional-flow claim from the
  bounded linear-water reference.

## Six materially different candidates

Scores use `0..5`, higher is better. Axes are truth fidelity, target cost,
integration simplicity, determinism, recovery, and evidence feasibility.

| Candidate | Scores | Pros | Cons | Gate result |
| --- | --- | --- | --- | --- |
| Analytic one-way bobbing | `1/5/5/5/5/4` | Cheapest route; exact surface query; excellent low-end behavior | Water cannot react; no conserved interaction; visual wake is only authored presentation | Reject: reaction closure |
| CPU rigid body plus staged GPU water | `4/2/2/4/4/3` | Mature CPU debugging; easy rigid-state inspection; good hull algorithms | Readback/staging latency changes the coupling bracket; duplicated CPU/GPU water mirrors; transfer tail and peak overlap dominate a tiny hull | Reject: frame-critical staging tail |
| External rigid engine plus shared GPU resource | `5/3/2/4/5/3` | Mature contacts/constraints and recovery; scales to many rigid features | Adapter ownership, unit/frame conversion, fences, checkpointing, and external-tail evidence are unnecessary for one bounded hull | Eligible, ranked second |
| Offline CFD/FSI playback | `5/1/2/5/5/2` | Can reproduce expensive free-surface effects and is deterministic at playback | Cannot respond to live state; large sequences; interpolation and compression errors; no interactive recovery | Reject: live interaction |
| Monolithic 3D particle or VOF FSI | `5/1/1/2/2/2` | Represents topology change, aeration, jets, and full pressure loads | Excess state, bandwidth, synchronization, boundary complexity, thermal load, and validation surface for the required mild-water image | Reject: target memory and thermal gates |
| Bounded GPU rigid body plus conservative local water coupling | `5/4/3/4/4/4` | Hot state remains GPU-resident; exact fixed-step bracket; small bounded state; source/reaction scatter can share the water queue | Specialist solver needs explicit hull validity, deterministic reduction, added-mass gate, rollback, and its own validation oracles | Selected top candidate |

The selected route wins because it is the smallest representation that retains
the required feedback without a frame-critical transfer. It is not a claim
that GPU physics is generally superior. Dense contact/joint workloads route to
an external engine; non-interactive hero water may route to offline FSI.

## Selected partition

```text
site compiler
  -> stable skiff asset/body/hull/proxy records

physics integration owner
  -> fixed-step body prediction
  -> footprint-filtered water sampling
  -> hydrostatic/drag source InteractionRecords

water owner
  -> deterministic gather and conservative source application
  -> bounded water advance
  -> equal-and-opposite reaction reduction

physics integration owner
  -> bounded correction and stability/conservation checks
  -> atomic body + water commit
  -> view-independent presentation candidate
```

The nine-point oracle is a convergence reference, not the final GPU
representation. Each point carries a body-frame location and displaced-volume
weight. Buoyancy uses the free-surface geometry/density channels; drag uses
material-current velocity relative to the complete body point velocity,
including `omega cross r`. It must never use surface-point velocity as fluid
current.

A nine-column clip under-resolves the continuous waterplane second moment.
The bounded GPU reference therefore carries explicit linearized roll/pitch
righting moments and angular damping as versioned hull-law terms. Their units
are `N m rad^-1` and `N m s rad^-1`; they are not camera animation. The route
must measure them against a denser clipped-hull reference before promoting the
hydrostatic approximation beyond its declared heel/trim envelope.

The bounded water mode stores a perturbation about a pre-balanced hydrostatic
reference. Static hull reaction is balanced by the bed/reference pressure
owner. Only departure from equilibrium excites the perturbation mode, while
the complete hydrostatic source/reaction pair still closes in the conservation
ledger. This subtraction must remain explicit so a static boat does not
continuously pump the water grid.

## Quality and failure boundaries

Low-end tiers first reduce water extent, represented band, hull quadrature, and
display detail through measured error; they do not change the physics proxy
from closed hull to render bounds. A physics-facing tier transition occurs only
at a coordinator-approved tick boundary, migrates state, drains interaction
queues, and retains exactly one reaction emitter.

The route fails closed on an open hull, negative or indefinite mass properties,
stale water state, missing canonical channel, duplicate application key,
half-committed reaction group, residual outside its gate, unbounded private
iteration, added-mass instability, non-finite state, or any frame-critical
readback.

## Visual assets and image generation

The coupling oracle needs no raster texture: generating one would add no causal
or validation information. The rendered skiff unit must separately compare at
least five hull/material strategies. GPT Image generation is eligible for
scale-labelled wood grain, painted-hull color, roughness-height source, foam
microstructure, or composition reference—not for the hydrostatic proxy. Any
generated image is accepted only after inspection for physical scale, seamless
edges where required, channel meaning, color/data space, mip behavior,
provenance, and visible applicability on the actual hull. A beautiful square
image with baked lighting or an unknown texel scale is rejected.
