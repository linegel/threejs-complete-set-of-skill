# Attachment And Joint Correctness

Use this reference for every child part that touches, enters, hinges from, or follows a parent: limbs, handles, legs, horns, wings, cables, tubes, branches, sockets, panels, connectors, and decorative appendages.

## Attachment contract

Define the attachment in parent-local coordinates:

- parent semantic ID and named socket/contact region;
- child `localStart` and `localEnd`;
- base/end radius for a tube-like child;
- contact type: `embedded`, `socket`, `overlap`, `hinge`, `surface-contact`, or `glued`;
- positive embed depth or overlap where the contact requires penetration;
- maximum visible gap;
- image region or stated assumption supporting the contact.

When the image cannot determine a defining joint, route it to `ambiguity`: request the relevant view or state the assumed contact and reduced fidelity.

## Construction

Place the child pivot at `localStart`. Build endpoint geometry from `localStart` toward `localEnd`, with its longitudinal axis aligned to that vector. Use the parent socket's frame for both the child root and any hinge/animation axis. A collar or blend is a separate supported form, not a substitute for contact overlap.

Keep a separately addressable node when the child moves, detaches, changes material independently, needs picking/collision identity, or defines an identity anchor. Static merging is available only after those ownership needs are absent.

## Verification

Inspect the joint in the closest structural view and after every allowed parent/child transform. Verify:

1. the child root touches, overlaps, or embeds in the intended parent region;
2. the gap stays within its declared bound;
3. the pivot and deformation origin remain at the semantic joint;
4. socket and child-root frames remain coincident after rotation and scale;
5. a hinge moves only around its declared local axis and limits;
6. the child keeps its stable semantic identity across representation tiers.

Route missing or contradictory attachment data to `decomposition`; route correct data implemented with a floating, misoriented, or drifting joint to `implementation`.

The attachment branch is complete when every applicable child has the full contract, all six checks pass in every required view/state, and no identity-defining joint remains inferred silently.
