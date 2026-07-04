# WebGPU Material-Slot Compiler

Canonical procedural buildings fixture.

1. Topology blocks.
   Must see serialized `footprintPieces` and `tiers`; if you see sliver tiers,
   fix bay/floor constants and mass validation.
   Runnable command: `node validate-fixtures.mjs`.

2. Exposed-edge overlay.
   Must see `exposedEdges` only on surviving intervals; if you see courtyard
   facade placements, fix blocker subtraction.
   Runnable command: `node validate-fixtures.mjs`.

3. Placements-only JSON.
   Must see module IDs with ownership rectangles; if you see unlabeled boxes,
   fix placement grammar before geometry.
   Runnable command: `node validate-fixtures.mjs`.

4. Ownership/overlap gate.
   Must see empty duplicate keys and overlap pairs; if you see overlap pairs,
   fix interval ownership before ornament.
   Runnable command: `node validate-fixtures.mjs`.

5. Minimal kit.
   Must see builders for plinth, window, glassShaft, cornerPier, cornice, roof,
   and finial; if you see missing builders, fail before emission.
   Runnable command: `node validate-fixtures.mjs`.

6. Slot geometry.
   Must see one merged indexed BufferGeometry per material slot; if draw calls
   exceed semantic slots, fix compiler grouping.
   Runnable command: `node validate-fixtures.mjs`.

7. UV-density.
   Must see no span over the 1.45 m atlas-cell rule; if stone stretches, fix
   subdivision before material tuning.
   Runnable command: `node validate-fixtures.mjs`.

8. NodeMaterials.
   Must see albedo textures as SRGBColorSpace and normal/data textures as
   NoColorSpace; if color spaces are wrong, fix material wiring.
   Runnable command: `node validate-fixtures.mjs`.

9. Chunk metrics.
   Must see draw-call, triangle, slot, bounds, LOD-tier, and cache-hit counts;
   if budgets fail, strip ornament or split chunks before changing grammar.
   Runnable command: `node validate-fixtures.mjs`.
