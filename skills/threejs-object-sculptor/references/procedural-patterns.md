# Procedural Object Patterns

Read only the sections selected in stage 3. Each section couples a representation decision to the proof needed before refinement can continue.

## Analytic primitives

Use boxes, spheres/ellipsoids, cylinders, cones, capsules, and tori when one analytic support describes the part and the primitive seam is real. Add a bevel or rounded profile when its radius changes the silhouette or highlight footprint.

Freeze the primitive axis, dimensions, cap policy, bevel radius, and segment count. Verify final bounds and the closest-view silhouette. Switch representation when overlap produces a false silhouette, attachment gap, unintended interior surface, or unstable semantic boundary.

## Lathe

Use a lathe for a surface of revolution with an authored axis and radial profile. Off-axis identity features remain separate parts or select another support.

Classify each profile endpoint before tessellation:

- a closed zero-radius pole emits one topological pole and a nondegenerate fan;
  duplicate render-corner poles only where normals, tangents, or UVs require it;
- an open nonzero rim emits one boundary loop;
- a capped nonzero rim emits an explicit cap with exterior winding;
- a UV or material seam duplicates only the vertices needed for that discontinuity.

Reject coincident pole rings, degenerate triangles, accidental profile self-intersection, and physical cracks at duplicated UV seams. Verify the authored boundary-loop count, finite outward normals, nonzero triangle area, final bounds, and the closest pole/rim view.

## Parallel-transport sweep

Use a sweep for handles, cables, pipes, roots, horns, rails, and other parts defined by a path and cross-section. Sample the path by arc length or a declared chord-error bound; consecutive centers must remain distinct.

Carry a rotation-minimizing frame along the path. Reject zero tangents and
project a deterministic initial normal into the first tangent plane; if the
projection is ill-conditioned, use the least-aligned coordinate axis with fixed
ties. Transport by the shortest tangent rotation, re-orthogonalize, and derive
the binormal with a right-handed cross product. Subdivide near an antiparallel tangent; an intentional cusp starts a named deterministic frame seam.

For a closed path, correct base holonomy before applying closure-compatible
authored twist. Radius/curvature and nonadjacent-section intersection tests are
separate from frame continuity. State cross-section seam policy and whether
each endpoint is open, capped, collared, or embedded. Verify finite unit tangents/normals/binormals, pairwise orthogonality, right-handedness, twist continuity, endpoint frames, radius bounds, and attachment overlap.

## Shape extrusion and CSG

Use extrusion when a planar outline plus depth defines the part. Freeze outer-loop and hole orientation, cap/side material slots, bevel policy, and triangulation. Verify non-self-intersection, intended hole count, exterior winding, finite normals, and bounds.

Use CSG only when a union or subtraction creates an identity-defining volume that a stable profile or assembly cannot express. Preserve semantic remapping across the result. Verify deterministic topology, the intended manifold/boundary contract, nondegenerate faces, and worst-case build cost. Interpenetration hidden by a boolean is still an attachment or decomposition failure.

## Repeated detail

Choose from the update and identity contract, then measure the complete draw path:

| Representation | Select when | Preserve | Reject when |
| --- | --- | --- | --- |
| `InstancedMesh` | Geometry/material are shared and transforms or declared instance fields carry variation | logical element IDs/count, per-instance bounds, deterministic seed | per-element topology/material/hierarchy or transparency sorting is required |
| `BatchedMesh` or merged clusters | Compatible ranges share storage/draw management | semantic range table, cluster bounds, material slots; per-instance transform ownership when supported | one edit rebuilds too much or movable/detachable parts lose ownership |
| Opaque proxy | Distant detail reads as volume | envelope and identity-critical negative space | the closest required view resolves individual silhouettes |
| Alpha cards | Thin detail and measured coverage beat geometry | alpha/shadow policy, orientation, mip chain | sorting, overdraw, tile traffic, or shadow aliasing dominates |

Report draw submissions, drawable objects, and multiplicity-expanded logical elements/triangles separately. A single instance batch is not a single detail element. Verify deterministic placement, culling bounds, stable identity where required, alpha/shadow behavior, and visual parity at every retained tier.

## Seams, caps, and normals

For each triangle `(a,b,c)`, use `cross(p_b - p_a, p_c - p_a)` to test nonzero
area and exterior winding. A closed manifold needs two oppositely oriented
uses per topological edge and a connected manifold link at each vertex; these
are stronger requirements than a nonzero signed volume. Check connected
components, self-intersections, and intended boundary loops too. Build adjacency
from declared topological identities across render seams without merging their
normal/UV/material attributes. Never weld unrelated coincident surfaces.

Recompute local bounds and degeneracy after final f32 positions. Validate
normals with the inverse-transpose under nonsingular nonuniform scale. When
baking a reflection into geometry, repair winding and tangent handedness as
well; do not apply the renderer's negative-object-scale correction a second
time. Reject singular transforms before inverse or normalization. Inspect a normal/winding diagnostic wherever a pole, cap, seam, boolean boundary, or custom writer can fail.

## Material response and footprint filtering

Implement named causes, not descriptive metadata:

- edge exposure may affect albedo wear, roughness, and small normal rounding;
- cavity/contact accumulation may affect local dirt, roughness, and occlusion response;
- directional grain follows the component frame through bends;
- bounded manufacturing or organic variation changes declared channels while preserving dimensions and identity.

Generate albedo, roughness, height/normal, and occlusion as independent responses; correlate them only through a named cause. Use geometry or displacement-capable topology when relief changes the closest-view silhouette.

Band-limit procedural frequencies to the pixel footprint. Texture paths use mipmaps and a declared UV/projection density; analytic noise terminates or attenuates octaves above the reconstructible band. Normal variance uses specular antialiasing or bounded roughness compensation. Verify with a distance sweep: detail may fade, but it must not gain contrast, shimmer, swim, or expose a seam after projecting below the sampling limit.

## Representation completion

A selected representation is complete when its construction contract is explicit, its topology/frame/bounds checks pass, its closest-view identity anchors survive, repeated detail retains required ownership, and material frequencies remain stable through the required distance range.
