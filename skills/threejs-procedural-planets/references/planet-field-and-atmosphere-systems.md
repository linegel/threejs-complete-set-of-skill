# Planet Field, LOD, and Atmosphere Systems

Use this file as the branch index and common contract. Load only the direct
reference for the selected branch:

- [body-model-mapping-and-lod.md](body-model-mapping-and-lod.md) — body-scale
  gate, sphere/ellipsoid semantics, cube mapping, quadtree, clipmap, hybrid,
  projected error, transitions, and submission.
- [solid-fields-and-coast.md](solid-fields-and-coast.md) — solid causal fields,
  cache/parity, geology, normals, materials, and coast/water handoff.
- [gas-cloud-deck.md](gas-cloud-deck.md) — wrapped gas-band coordinates,
  advection, storm identity, bounds, and reset behavior.
- [surface-atmosphere-handoff.md](surface-atmosphere-handoff.md) — shared
  surface geometry, units, transforms, radiometric basis, and atmosphere
  validity.

## Common Contract

One body-space cause set drives geometry, normals, material identity, queries,
diagnostics, coast/water handoffs, and atmosphere inputs. Every published value
states producer, consumer, owner, units, frame/origin, sample time or interval,
support/filter, validity/staleness, version, and error.

A global patch identity is
`(bodyId, mappingVersion, face, level, x, y)`. A clipmap cell identity is
`(bodyId, mappingVersion, level, bodySpaceCellCoordinates)`. Frontier order,
visibility, draw bin, physical allocation slot, and cache address are not
identity. Rebinding a physical slot to another identity resets every
slot-bound temporal, simulation, query-cache, and diagnostic state before the
new record becomes valid.

Render-origin changes alter presentation transforms only. They do not change
body-space coordinates, source versions, field identity, stable patch/cell
identity, or coast identity.

Completion requires direct evidence for every selected architecture branch and
every published field or handoff. Unsupported branches remain explicit gaps.

## Common Validation

Gate:

```text
body-scale route versus local approximation
mapping forward/inverse, winding, Jacobian, area, seams, and corners
restricted 2:1 quadtree across every cube-face transform
all 16 transition masks and continuous morph
clipmap ring/recenter error and hybrid ownership
projected support error for every view
direct/cache and CPU/TSL field parity
independent derivative value, direction, and scale
crater support/overflow and geological cause views
coast metric, sign, frame, LOD invariance, and uncertainty
atmosphere geometry, units, altitude, and radiometric basis
triangle, record-stride, cache, indirect, attachment, and peak-live bytes
full-frame plus paired planet on/off CPU/GPU p50/p95
zero frame-critical readbacks and stable resize/disposal lifetime
```

Inspect fixed orbit, horizon, and close cameras; silhouette; flat albedo without
atmosphere; grazing light; mapping distortion; face-neighbor orientation;
transition mask and crack distance; patch error; cache/version; field parity;
normal/roughness; coast; and atmosphere handoff.
