# Object Sculptor procedural corpus

This native WebGPU lab verifies that Object Sculptor can produce more than one ship-shaped result. It presents three deliberately different code-native assets:

- `articulated-desk-lamp`: product-scale hard-surface construction, serial hinge pivots, swept supports, cable attachment, and constrained procedural motion;
- `potted-bonsai`: asymmetric organic branching, rooted joints, repeated foliage, a ceramic vessel, and bounded wind motion;
- `ceramic-teapot`: a material-dominant rotational form with a lathed body, swept spout and handle, smooth normals, and a detachable lid.

The unrestricted route starts on `potted-bonsai`, `action-ready`, and `budgeted`. This makes animation visible immediately while starting from the middle geometry/DPR tier. Subject, mode, tier, and camera selectors remain interactive unless a pathname or query route locks that dimension.

## Runtime architecture

`object-catalog.js` owns the ordered target inventory and factory selection. `lab-controller.js` owns one native `WebGPURenderer`, one active target, cameras, lighting, tier DPR, target replacement, rendering, metrics, and disposal. Each factory returns a stable action-ready hierarchy backed by the shared `sculpt-runtime.js` maps for nodes, meshes, sockets, collider construction inputs, physics-material bindings, and destruction groups.

The page frame driver is the only live presentation owner. It serializes time steps, scene renders, control changes, target rebuilds, and resize mutations through one promise tail. A `?capture=1` route transfers frame ownership to the evidence harness, so the live page does not race a deterministic capture.

The presentation path is intentionally small: one active subject, one forward scene render, no MRT, no post stack, and no CSS animation or backdrop filter. Changing subjects first prepares and validates the candidate while the prior target remains active; after presentation plans apply, the controller retires the prior target and commits the candidate, reconstructing the prior state if a later transaction step fails. Logical component identity remains independent of visual tessellation tier.

The HUD distinguishes quantities with different evidence:

- nodes and triangles come from the active procedural hierarchy;
- draw calls are shown only when the renderer exposes a numeric call count, otherwise `—`;
- submissions are controller-counted scene render submissions, not GPU completion or timing;
- motion is a measured procedural pose-delta witness, reporting active channels and maximum translation, rotation, or scale change; it is kinematic evidence, not solver time or physics proof;
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

## Codex in-app Browser route evidence

`npm run capture:routes:prepare` is a browser-free preparation check. It regenerates a content-addressed manifest from the complete trusted runtime source list, validates the runner against those current local bytes, and prints the one canonical URL to open manually in Codex's in-app Browser. It does not launch Playwright, Chrome, or any other browser process. Open exactly:

`http://127.0.0.1:4174/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.html`

The runner rejects every other origin or base path. It automatically visits all 15 physical routes in one same-origin iframe, in canonical order, with the exact `?capture=1` ownership query. Before assigning each iframe URL, the parent synchronously installs `load` and `error` observers and records nondecreasing monotonic timestamps plus a SHA-256 attestation; equal timestamps are valid on coarse browser clocks, while source order and the attested ordering flag prove installation came first. It also verifies an HTTP `200` response without redirects. Each physical route installs page, console, unhandled-rejection, resource, uncaptured-GPU-error, and device-loss observers in `<head>` before `app.js`; initialization fails closed if those observers are late or inactive. Explicit renderer disposal arms a narrow teardown marker, so only a subsequent `GPUDevice.lost` result with reason `destroyed` is classified as expected destruction; every unarmed or differently reasoned loss still fails the route.

For every route, the runner proves zero initial submissions, disables camera interaction, performs one explicit native-WebGPU frame, requires the HUD to read the exact `Ready · <subject> · correctness WebGPU` state, exercises the locked UI and public-controller methods, proves every unlocked dimension changes and restores both controller and selector state, then uses `capturePixels("presentation")` as the second render. The camera pose must remain byte-for-byte stable before the first frame, after it, after all probes, and after readback. The record binds the trusted local route/runtime source closure, camera pose, normalized pipeline descriptor, and padded native readback with SHA-256 digests. The outer document separately binds the canonical correctness-capture source revision and exact native-WebGPU backend fingerprint. A route is disposed before the next one starts.

No export is enabled until all 15 records pass. Each JSON readback reference points to retained raw padded bytes under `route-readbacks/*.rgba8unorm.bin`; binary data is never expanded as base64 or dumped into the page. On success the exact document is shown and exposed as `window.__CORPUS_ROUTE_EVIDENCE_RESULT__`. `window.__CORPUS_ROUTE_EVIDENCE_ARTIFACTS__` provides bounded `list()`, `getArtifact(path)`, and `buildTar()` methods. The page can save JSON alone or a deterministic, at-most-256-MiB TAR containing the JSON and all 15 readbacks. `bundleId` and `runId` remain visible inputs because a later evidence manifest must bind the same identities. A failure leaves the result and artifact API `null` and publishes a short diagnostic as `window.__CORPUS_ROUTE_EVIDENCE_ERROR__`.

`npm run capture` is browser-free preparation for the canonical correctness run. It prints three exact Codex in-app Browser URLs, one for each subject. Each URL auto-runs its bounded 21-readback segment: 16 presentation states and 5 target masks at exactly 1200×800, DPR 1. The page retains the renderer's actual transport bytes and an independently allocated, fully padded normalization using the recorded integer row stride. It then validates those bytes, emits a DOM-visible 21/21 summary, and exposes a TAR download capped at 192 MiB. Collecting one subject per page bounds live retained byte arrays instead of holding all 63 readbacks at once.

After saving all three TAR files, run `npm run capture:import -- --segment <lamp.tar> --segment <bonsai.tar> --segment <teapot.tar> --output <directory>`. The offline importer rejects missing, duplicate, cross-source, non-WebGPU, reordered, hash-mismatched, stride-mismatched, flat presentation, and non-binary mask evidence. It reconstructs compact RGBA only from each normalized artifact's recorded row stride, writes 48 presentation PNGs plus 15 mask PNGs, preserves transport and normalized byte artifacts, and writes `correctness-in-app-import.json`. `--check` performs the same validation and PNG reconstruction without writing output.

The physical-route runner is a separate lane. It establishes physical-route, WebGPU initialization, HUD, lock, pipeline, readback, observer, and teardown facts. Neither correctness lane replaces authored visual review, sustained named-device timing, or final release assembly.

## Physics claim boundary

These models publish `ColliderConstructionInput` records. They are deterministic, metre-denominated authoring inputs attached to stable component identities. They preserve simplified shape intent, a local authoring frame, physics-material identity, source revision, and an authored approximation envelope across visual tiers.

They are not canonical `ColliderProxy` or `RigidBodyProperties` records. This lab does not own a route `PhysicsContext`, registered live physics frame/origin/transform revision, committed pose signal, validity interval, collision/contact owner, density, mass, center of mass, inertia tensor, pair law, contact manifold, constraint solve, fracture solve, or `ExternalSolverAdapter`. The visible animation is procedural kinematic presentation, not a physics solution. Accordingly, the HUD reports collider handoffs as authoring inputs and the canonical physics handoff as blocked until a separate route adapter supplies and validates that missing evidence.

No visual mesh, PBR parameter, socket, collider-shaped debug object, plausible animation, or nonblank render is solver proof.
