# Attachment And Joint Correctness

Use this reference for every child part that touches, enters, hinges from, or follows a parent: limbs, handles, legs, horns, wings, cables, tubes, branches, sockets, panels, connectors, and decorative appendages.

## Attachment contract

Define the attachment in parent-local coordinates:

- parent semantic ID and named socket/contact region;
- child `localStart` and `localEnd`;
- base/end radius for a tube-like child;
- contact type: `embedded`, `socket`, `overlap`, `hinge`, `surface-contact`, or `glued`;
- positive embed depth or overlap where the contact requires penetration;
- maximum visible gap and the metric frame/units in which it is bounded;
- parent transform admission, rest socket frame, motion axis/limits, and which
  position/orientation constraints each contact type actually preserves;
- image region or stated assumption supporting the contact.

When the image cannot determine a defining joint, route it to `ambiguity`: request the relevant view or state the assumed contact and reduced fidelity.

## Construction

Place the child pivot at parent-local `localStart`. With child rest rotation `R`
and unit child-local scale, emit its geometry from child-local zero toward
`R^-1 * (localEnd - localStart)`; its world transform is
`M_parent * T(localStart) * R`. Do not embed parent-local start coordinates in
that child geometry a second time. Alternatively keep geometry in the parent
frame with an identity child transform, but never mix the two conventions.
For a non-unit child transform use the inverse of its complete nonsingular
linear part instead of `R^-1`; reject zero-length tube directions or provide a
separate explicitly authored joint axis.

Use the parent socket's rest frame and declared axis for joint construction.
A hinge preserves the pivot and aligned axis while its transverse child axes
rotate; full frame coincidence is a rigid/glued constraint, not a hinge rule.
Update ancestor matrices before world/local conversion. Under nonuniform or
reflected transforms, use the full affine map for endpoints and gap measurement;
a decomposed quaternion/scale can lose shear. Admit positive uniform rig scale
or explicitly preserve and validate the affine representation. A collar or blend
is a separate supported form, not a substitute for contact overlap.

Keep separately addressable semantic identity and transform ownership when the
child moves, detaches, changes material, needs picking/collision identity, or
defines an anchor. Use a node or an admitted semantic-to-instance mapping;
static merging is eligible only when it preserves every required operation.

## Verification

Inspect the joint in the closest structural view and after every allowed parent/child transform. Verify:

1. the child root touches, overlaps, or embeds in the intended parent region;
2. the gap stays within its declared bound;
3. the pivot and deformation origin remain at the semantic joint;
4. socket and child-root preserve the constraints declared for that contact type
   after rotation and scale; hinge pivot/axis agreement does not require equal
   transverse frames;
5. a hinge moves only around its declared local axis and limits;
6. the child keeps its stable semantic identity across representation tiers.

For a guarantee over a continuous motion range, use analytic clearance bounds or
a conservative swept/adaptive collision check. A few inspected poses establish
only those poses, not every intermediate clearance. Keep image-based attachment
approximation separate from a solver/contact claim.

Route missing or contradictory attachment data to `decomposition`; route correct data implemented with a floating, misoriented, or drifting joint to `implementation`.

The attachment branch is complete when every applicable child has the full contract, all six checks pass in every required view/state, and no identity-defining joint remains inferred silently.
