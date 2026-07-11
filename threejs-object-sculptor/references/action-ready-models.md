# Action-Ready Procedural Models

Use this reference when a procedural Three.js model may later need animation, transformation, physics, or destruction.

## Design Goal

The generated model should be a runtime-ready hierarchy, not a single decorative mesh. Future actions should be added by targeting named nodes, sockets, colliders, and destruction groups instead of rewriting the reconstruction.

When those actions become physical, use the canonical
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Runtime maps remain authoring metadata until a route adapter publishes SI,
generation-bearing `ColliderProxy` and `RigidBodyProperties` records. A selected
engine connects through `ExternalSolverAdapter`; canonical `InteractionRecord`
entries carry contact/impulse/fracture exchange, and solver-driven visibility
and transforms reach rendering through `PhysicsPresentationCandidate` and a
sealed per-view `PhysicsPresentationSnapshot`. Visual mesh LOD never changes a
physical proxy, body property, fracture identity, or committed state unless a
declared `QualityTransition` maps and atomically commits that change.

## Hierarchy Pattern

Use this structure:

- `root`: whole-object motion, visibility, global scale, runtime metadata.
- `component pivot Group`: stable transform node for each macro/meso component.
- `visual mesh`: child of the component pivot; holds geometry and material.
- `socket Object3D`: child of the relevant pivot; marks attachment, effect, grip, or joint positions.
- collider metadata/proxy: simplified runtime shape, not necessarily a visible mesh.
- destruction group metadata: semantic grouping for detach/break logic.

## Pivot Rules

- Use center pivots only when the object rotates around its center of mass.
- Use base pivots for trees, signs, bottles, poles, legs, and upright props.
- Use hinge pivots for lids, doors, handles, flaps, jaws, levers, and wings.
- Use branch/root pivots for organic appendages that bend from one end.
- Use custom pivots when the reference clearly implies a mechanical joint or socket.

## Collider Rules

- Use primitive proxies first: box, sphere, capsule, cylinder.
- Use compound proxies for complex silhouettes.
- Avoid visual mesh colliders unless the user explicitly asks for high-precision collision.
- Mark triggers separately from solid colliders.
- Store collider intent even when no physics engine is installed.
- Record source units, local frame, stable entity/component generation,
  approximation error, and physics-material identity before adapting collider
  intent into a canonical physical proxy.
- Require measured or source-backed mass, center of mass, inertia, and material
  properties before publishing a dynamic rigid-body claim; otherwise keep the
  asset static/kinematic or block that claim explicitly.

## Destruction Rules

- Break along existing seams, joints, material boundaries, weak points, or branch roots.
- Use detachable component groups for large fragments.
- Use procedural small fragments only where they improve readability.
- Attach impact, spark, dust, liquid, or debris effect sockets when destruction is expected.
- Preserve material continuity on exposed fracture faces where possible.

## Acceptance Criteria

An action-ready model passes when:

- Every major part has a stable ID and pivot node.
- Movable or breakable parts are not merged into unrelated geometry.
- Sockets are named and placed in local coordinates.
- Collider proxies exist for physics-relevant parts.
- Physics-facing proxies and body properties validate against the shared ABI,
  while solver-driven state uses the immutable presentation publication chain.
- Destruction groups and fracture seams are explicit.
- `root.userData.sculptRuntime` exposes maps that later code can target.
