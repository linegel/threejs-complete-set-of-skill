# Segmented Coastal Crab Reference

This reference is for a procedural, hard-shelled coastal crab rendered with
Three.js `WebGPURenderer`. It is not a license to replace continuous creatures
with disconnected capsules. A crab is a suitable segmented-rigid workload
because exoskeleton plates are visibly separate, joints are occluded by dark
membranes, and locomotion is dominated by rigid link motion.

## Representation decision

Score every project against its actual camera, count, interaction, and target
device. The reference decision uses five 1--5 axes: topology truth, motion fit,
mobile cost, generated authoring, and evidence feasibility. A hard gate defeats
the numeric total.

| Candidate family | Scores | Result |
|---|---:|---|
| per-slot snapped SDF shells | 1/3/2/4/3 | reject: coincident diagnostic sheets are not production topology |
| unified field-extracted skin | 3/3/2/3/2 | reject here: adds blend, weighting, and correction cost without a continuous-skin benefit |
| runtime dynamic extraction | 4/2/1/3/1 | reject: topology work is unnecessary per pose and unsuitable for the low-end target |
| imported glTF skinned asset | 5/5/4/1/4 | reject for this route: violates the procedural-source contract |
| offline baked/VAT asset | 4/3/4/2/3 | reject: cannot preserve support-relative feet across arbitrary coast geometry |
| closed segmented rigid reference | 5/5/5/5/5 | select: stable topology, exact link motion, bounded O(slots) update |

If the brief requires soft abdominal deformation, shell cracking, continuous
muscle bulges, or a close macro camera across joints, rescore. A hybrid closed
shell plus locally deformed membrane or a unified reference skin can then win.

## Dimensioned source contract

Use metres, seconds, +Y up, and a right-handed local frame. The canonical body
is 0.180 m long, 0.125 m wide, and 0.052 m high with a 0.420 m total leg span.
The supported habitat envelope is 0--0.100 m water depth and at most 28 degrees
of resolved support slope. Lateral speed is 0.12 m/s, step trigger distance is
0.065 m, swing clearance is 0.018 m, and authoritative gait time is fixed at
1/60 s. These are validation values, not shader-friendly unitless knobs.

Five morphology profiles may change shell proportions, leg and claw scale,
lobe amplitude, and material colors. They must not change stable slot IDs,
parentage, material-zone identity, or buffer capacity.

## Stable rig and geometry

Compile 40 used slots into a 48-slot single-crab page or a 64-slot packed
profile page:

- 2 body slots: closed four-lobe superellipsoid carapace and closed underside
  membrane;
- 2 eye slots: one closed stalk-plus-eye assembly per side;
- 24 walking-leg slots: left/right, four legs per side, and closed capped coxa,
  merus, and dactyl segments;
- 12 claw slots: six closed links per side, ending in fixed and hinged fingers.

Slots are dense, stable, and semantic. Do not encode identity from traversal
order after compilation. Keep shell, membrane, dactyl, and eye as explicit
material zones. Capped frusta, swept fingers, and closed palms must have
consistent winding and finite normals; an open cylinder hidden by overlap is
still an invalid production mesh.

The hinged finger rotates around local +Y. Rest and threat openings are 8 and
42 degrees. The hinge origin belongs to the palm/wrist frame, never to the
world frame. Preserve the same transform path for visible, shadow, bounds, and
motion-vector evaluation.

## Alternating-tetrapod gait

The authoritative groups are:

```text
A = { L1, L3, R2, R4 }
B = { R1, R3, L2, L4 }
```

Advance them in fixed 1/60 s blocks. At every tick issue one atomic batch with
all eight foot queries. A support sample carries point, normal, point velocity,
support ID, feature ID, identity generation, actual tick, state version, water
depth, and error. Reject partial or mixed-version batches.

Keep the inactive tetrapod planted in the support frame. Move the active feet
from their captured start positions to targets predicted at the end of the
swing block, using a sinusoidal 0.018 m vertical arc. Each leg has a fixed coxa
link followed by a two-bone merus/dactyl solve. Gate segment-length residual,
minimum four-foot stance, support identity, deterministic replay, and the
one-batch/eight-sample count. On a moving support, advect planted anchors with
the support transform/point velocity rather than freezing world coordinates.

The simple planar provider in the reference core is a deterministic mechanism
oracle, not a terrain implementation. A coastal route must consume the shared
terrain/water provider descriptor and declare its error/version envelope.

## Water interaction

The baseline crab route is one-way: water supplies depth and surface/support
observations; the crab may render local ripples or foam, but it emits no
authoritative reaction into the water solver. This is permitted only when an
omitted-feedback comparison against the chosen coupled reference remains at or
below 0.002 m surface displacement and 1 degree surface-normal difference, and
the crab trajectory hash is unchanged.

If any gate fails, select two-way coupling. Then emit versioned interaction
records through the shared physics graph; apply each record exactly once and
conserve the declared momentum/energy quantity. Never write directly from a
creature render loop into a water storage texture.

## Performance tiers

Measure triangle/vertex counts after geometry compilation and GPU time with
timestamp queries when available. Do not claim GPU milliseconds from CPU wall
time. Initial per-crab geometry ceilings are:

| Tier | Triangles | Vertices | Intended use |
|---|---:|---:|---|
| full | 3,200 | 5,600 | near inspection, one or a few crabs |
| budgeted | 1,700 | 2,900 | mid-distance/mobile hero |
| minimum | 780 | 1,250 | distant or low-end presentation |

All tiers retain 40 semantic slots and gait identity. Reduce radial/longitudinal
tessellation, eye detail, and lobe sampling; do not remove feet or claws and
silently change behavior. Use one material variant per compatible signature,
fixed-capacity pose storage, posed bounds, and population pages. Update cost is
O(used slots) per active crab per fixed step; inactive/distant pages may reduce
pose frequency only under an explicit temporal-error gate.

## Texture and generated-image decision

The canonical core needs no raster texture: profile colors, bounded shell
roughness variation, edge darkening, and membrane response are cheaper and
more controllable as procedural material signals. Before adding any generated
asset, compare at least these five families: analytic TSL signal, small authored
tile, GPT Image generated tile, scanned/photo source with provenance, and
vertex/procedural geometry detail. Score semantic control, seam risk, memory,
filtering stability, authoring time, and license/provenance. A generated image
does not win merely because it looks detailed in a preview.

When GPT Image is selected, prompt for a flat orthographic material sample,
explicit physical scale, uniform illumination, no cast shadows, no highlights,
no perspective, no objects, edge-to-edge seamless continuity, and the intended
material zone. Generate color appearance separately from data maps. Never
interpret a painted normal/roughness/depth-looking RGB image as calibrated
linear data.

Inspect the returned image directly at 1:1 and tiled 3x3. Reject directional
lighting, baked occlusion, visible repeats, mismatched crab scale, border seams,
compression ringing, anatomy baked into a reusable tile, or ambiguous rights.
Record generator/model, prompt, seed or reproducibility limits, dimensions,
physical texel scale, crop/tiling edits, provenance, channel meaning, and color
space. Color assets decode from sRGB; scalar/normal/mask data is `NoColorSpace`.
Re-run minification and mobile-memory tests before accepting it into a tier.

## Required evidence

At minimum retain hero, side, and top beauty views; shell/membrane/slot-ID
diagnostics; planted-foot and support-normal overlays; rest/threat claw poses;
all five profile silhouettes; all three tiers; a sustained moving capture; and
the one-way omitted-feedback comparison. Mutation controls must catch slot
count, profile count, habitat envelope, fixed step, hinge axis, surface gate,
normal gate, and trajectory changes. A nonblank screenshot is not proof of
closed geometry, gait correctness, or WebGPU initialization.

Executable source and gates live in
`examples/webgpu-procedural-creature-lab/src/crab/` and
`examples/webgpu-procedural-creature-lab/src/validation/gates/crab-gates.mjs`.
