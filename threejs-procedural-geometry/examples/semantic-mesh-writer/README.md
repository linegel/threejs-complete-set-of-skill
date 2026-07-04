# Semantic Mesh Writer

Checkpoint `capacity pass`: must see exact vertex/index capacity before
allocation. if you see buffer growth during emission, the semantic plan did not
count caps, seams, or LOD overlays.

Checkpoint `top skin spans`: must see smooth profile-top vertices sharing only
compatible smoothing groups. if you see cap shading mush, hard-edge duplication
is missing.

Checkpoint `backing/walls/caps`: must see separate semantic surfaces and
material groups. if you see group holes, an index range was not assigned.

Checkpoint `hard-edge duplication`: must see duplicated vertices with
`boundaryReason`. if you see averaged normals across backing or caps, a vertex
was shared across incompatible surfaces.

Checkpoint `group coverage`: must see every index covered once. if you see
overlap, draw calls and material slots are unstable.

Checkpoint `UV checker`: must see production UV density from real distance and
debug `(s,t)` only in `debugUv`. if you see UV swimming across LOD, normalized
UVs leaked into production.

Checkpoint `normal debug`: must see unit normals and tangent `.w` of `1` or
`-1`. if you see mirrored normal-map seams, run MikkTSpace tangent generation.

Checkpoint `byte/draw report`: must see vertices, triangles, groups, bytes, and
draw calls per tier. if you see only triangle count, the complexity report is
not actionable.
