# Shared Framegraph Static Contract

This folder is an executable validator for a **static integration manifest**.
It proves ownership and declaration rules in
[`integration-manifest.json`](integration-manifest.json); it does not construct,
compile, render, time, or visually validate a Three.js graph.

Run:

```bash
npm --prefix threejs-image-pipeline/examples/integration-shared-framegraph run check
```

## Claim boundary

The check proves only that the manifest declares:

- one renderer owner, one `RenderPipeline` owner, and one primary scene-pass
  owner `[Authored: single-owner integration constraints, not runtime counts]`;
- a required primary scene-color signal owned by `scenePass`;
- depth from `scenePass.getTextureNode('depth')`, never from an MRT color output;
- no preselected named MRT outputs;
- `normal`, explicitly mapped `albedo`, `emissive`, and `velocity` as separate
  `conditional-unselected` candidates;
- one graph owner for temporal, exposure, tone-map, grading, and output ordering;
- no private sibling post/output owner.

It does **not** prove renderer initialization, graph compilation, shader producer
coverage, pixels, physical formats, target allocation, memory, bandwidth,
timings, temporal stability, exposure quality, LUT correctness, or acceptance
on any browser/GPU class. The browser evidence list is an acceptance checklist,
not evidence present in this folder. The linked Wave C status is historical
context for an earlier attempt, not a runtime result produced here.

## Signal contract

The primary scene pass has two required products with different attachment
semantics:

```text
primary color = scenePass.getTextureNode('output')  (primary pass color)
depth         = scenePass.getTextureNode('depth')   (depth texture, not MRT color)
```

The static contract selects no named MRT attachment. For each candidate signal
`a`, a concrete implementation must compare:

```text
costMRT(a) = fragment export + attachment store + downstream reads
costAlt(a) = reconstruction or narrow rerender + its memory traffic
```

Both sides require `[Measured]` paired evidence on the named browser, GPU,
physical pixels, and complete enabled graph. A saved traversal is not sufficient
evidence on a tile-based GPU. Velocity is admitted only with an enabled temporal
consumer plus validated rigid, instanced, skinned, and procedural-deformation
coverage. `albedo` requires an explicit `diffuseColor.rgb` mapping.

## Color and temporal order

The manifest checks the default dependency order, without claiming that any
optional stage is implemented:

```text
stable scene-linear radiance
  -> optional temporal reconstruction in a stable pre-exposure domain
  -> layers excluded from temporal history
  -> optional exposure meter tap from resolved pre-bloom HDR
  -> optional bloom
  -> optional adapted exposure in EV/log space
  -> tone map
  -> optional grade in its declared domain
  -> one output conversion
```

Dynamic exposure must remain GPU-driven; CPU readback is diagnostic only. A LUT
remains unselected until its primaries, transfer, shaper, legal range,
interpolation, and tone-map dependency are declared.

## Numeric provenance

Every numeric literal in the manifest is stored in a record tagged as one of:

- `Derived`: formula, layout, or verified API consequence;
- `Gated`: valid after a named capability/correctness gate;
- `Measured`: captured on a named target and complete graph;
- `Authored`: deliberate contract or quality input, not a performance fact.

The only manifest numeric values are the authored single-owner counts. The
validator recursively rejects any numeric value outside a tagged provenance
record and rejects static counts mislabeled as measurements.

## Rejected contracts

The self-test proves rejection of:

- duplicate primary-pass writers;
- a private sibling post owner;
- depth promoted to an MRT color output;
- an unconditional named MRT set;
- a browser-proof claim without browser evidence;
- an untagged frame budget.
