# Object Sculptor procedural corpus

This native WebGPU lab verifies that Object Sculptor can produce more than one ship-shaped result. It presents three deliberately different code-native assets:

- `articulated-desk-lamp`: product-scale hard-surface construction, serial hinge pivots, swept supports, cable attachment, and constrained procedural motion;
- `potted-bonsai`: asymmetric organic branching, rooted joints, repeated foliage, a ceramic vessel, and bounded wind motion;
- `ceramic-teapot`: a material-dominant rotational form with a lathed body, swept spout and handle, smooth normals, and a detachable lid.

The unrestricted route starts on `potted-bonsai`, `action-ready`, and `budgeted`. This makes animation visible immediately while starting from the middle geometry/DPR tier. Subject, mode, tier, and camera selectors remain interactive unless a pathname or query route locks that dimension.

## Runtime architecture

`object-catalog.js` owns the ordered target inventory and factory selection. `lab-controller.js` owns one native `WebGPURenderer`, one active target, cameras, lighting, tier DPR, target replacement, rendering, metrics, and disposal. Each factory returns a stable action-ready hierarchy backed by the shared `sculpt-runtime.js` maps for nodes, meshes, sockets, collider construction inputs, physics-material bindings, and destruction groups.

The page frame driver is the only live presentation owner. It serializes time steps, scene renders, control changes, target rebuilds, and resize mutations through one promise tail. A `?capture=1` route transfers frame ownership to the evidence harness, so the live page does not race a deterministic capture.

The presentation path is intentionally small: one active subject, one forward scene render, no MRT, no post stack, and no CSS animation or backdrop filter. Changing subject disposes the previous factory-owned geometry and materials before replacing it. Logical component identity remains independent of visual tessellation tier.

The HUD distinguishes quantities with different evidence:

- nodes and triangles come from the active procedural hierarchy;
- draw calls are shown only when the renderer exposes a numeric call count, otherwise `—`;
- submissions are controller-counted scene render submissions, not GPU completion or timing;
- motion time is the procedural display clock and is not solver time;
- DPR is the applied tier cap, not the device-requested DPR.

The authored DPR ceilings are `1.5` for `full`, `1.25` for `budgeted`, and `1.0` for `minimum`. These are starting policies, not measured acceptance proof. Triangle counts and representation density decrease by target and tier; no universal frame-time, draw-count, or thermal claim is inferred from those reductions. Sustained CPU/GPU/presentation timing still requires a named device, refresh rate, timestamp-query protocol, and an accepted evidence bundle.

## Modes

- `final`: complete procedural geometry and authored materials;
- `blockout`: identity-critical macro forms;
- `hierarchy`: diagnostic semantic ownership colors;
- `materials`: neutral, frozen look-development state;
- `action-ready`: deterministic procedural motion through named local pivots.

Review cameras are `design`, `profile`, `attachment`, and `close-material`. The attachment camera is for checking parent-local joints, sockets, embedded starts, and visible gaps; it does not prove collision behavior.

## Route locks

The page accepts generated pathname routes such as `/scenario/potted-bonsai/`, `/mechanism/action-ready/`, `/tier/minimum/`, and `/camera/attachment/`. The equivalent query keys are `scenario`, `mechanism`, `tier`, and `camera`. A value supplied by either surface disables that selector. Repeated conflicting values or path/query conflicts fail closed and publish `window.__LAB_ERROR__`.

`window.labController` exposes the deterministic controller after successful native-WebGPU initialization. `window.__LAB_ERROR__` is `null` on successful startup and becomes a frozen `{ name, message }` record when routing, initialization, frame execution, or a serialized mutation fails. Readiness is claimed only after the first completed native-WebGPU scene render.

## Physics claim boundary

These models publish `ColliderConstructionInput` records. They are deterministic, metre-denominated authoring inputs attached to stable component identities. They preserve simplified shape intent, a local authoring frame, physics-material identity, source revision, and an authored approximation envelope across visual tiers.

They are not canonical `ColliderProxy` or `RigidBodyProperties` records. This lab does not own a route `PhysicsContext`, registered live physics frame/origin/transform revision, committed pose signal, validity interval, collision/contact owner, density, mass, center of mass, inertia tensor, pair law, contact manifold, constraint solve, fracture solve, or `ExternalSolverAdapter`. The visible animation is procedural kinematic presentation, not a physics solution. Accordingly, the HUD reports collider handoffs as authoring inputs and the canonical physics handoff as blocked until a separate route adapter supplies and validates that missing evidence.

No visual mesh, PBR parameter, socket, collider-shaped debug object, plausible animation, or nonblank render is solver proof.
