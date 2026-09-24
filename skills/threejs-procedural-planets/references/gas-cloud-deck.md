# Planet Gas and Cloud Deck

Read this reference when the body-scale observable is an optically thick gas or
cloud deck rather than solid-terrain displacement.

For a zonal jet with latitude fixed along its trajectory, declare positive
longitude as the motion direction and angular velocity in radians per second.
Sample the source field using inverse advection, not a forward displacement:

```text
latitude = asin(clamp(direction.y, -1, 1))
longitude = atan2(direction.z, direction.x)
angularDisplacement(latitude,t) = integral_t0^t angularVelocity(latitude,s) ds
advectedLongitude = longitude - angularDisplacement(latitude,t)
gasCoordinate = vec3(
  cos(latitude)*cos(advectedLongitude),
  sin(latitude),
  cos(latitude)*sin(advectedLongitude)
)
```

The direction must be finite and unit length before this mapping. At either
pole, assign a deterministic unused longitude without evaluating atan2(0,0).
The cosine-latitude factors collapse longitude to the same field point there.
A longitude unit circle paired with latitude stays azimuth-dependent at the
pole even though its wrap seam closes. Use a smooth field in the embedded
surface domain and verify tangent derivatives, not only seam endpoint values.

A physical eastward speed in meters per second needs conversion by the local
parallel radius, with an explicitly regular polar limit. Dividing a finite
speed by cos(latitude) and clamping the denominator does not prove a smooth
polar velocity field. Bounded smooth angular jets are an authored alternative.
Changing a jet's speed integrates its new contribution from that change time;
using the newest speed times all elapsed time creates a phase jump. Meridional
flow needs a coupled surface flow map rather than this fixed-latitude formula.

Combine latitude-dependent advection, tangential warp, band records, turbulent
structure, bounded storm fields, limb response, and atmosphere coupling. This
branch uses cloud-deck density/color/velocity causes instead of crater, soil,
seabed, or rocky displacement fields. Keep the coordinate, pole convention,
angular units, and sign in the field schema; changing them invalidates dependent
caches/history instead of relabeling old pixels as the new field.

Derive each storm identity from body ID, generator-schema version, stable seed,
and storm-record key rather than time, traversal, or visibility order. Version
its changing field state separately. Carry its support through the wrapped
surface domain and publish a conservative bound over the complete advection/
update interval. Pending old-generation products cannot replace current state.

Validate value and tangent-derivative continuity across longitude and at both
poles, the signed motion of a recognizable feature, changing-speed continuity,
deterministic storm replay, and the maximum declared jet/storm motion envelope.
Record field units, body frame, interval, owner, version, validity, error, and
reset behavior for creation/removal, schema or provider changes, and slot reuse.
