# Planet Gas and Cloud Deck

Read this reference when the body-scale observable is an optically thick gas or
cloud deck rather than solid-terrain displacement.

Represent longitude continuously on the unit circle:

```text
longitude = atan(direction.z, direction.x)
advectedLongitude = longitude + time * jetSpeed(latitude)
longitudeVector = vec2(cos(advectedLongitude), sin(advectedLongitude))
gasCoordinate = vec3(longitudeVector.x, longitudeVector.y, latitude01)
```

Combine latitude-dependent advection, tangential warp, band records, turbulent
structure, bounded storm fields, limb response, and atmosphere coupling. This
branch uses cloud-deck density/color/velocity causes instead of crater, soil,
seabed, or rocky displacement fields.

Derive each storm identity from body ID, generator-schema version, stable seed,
and storm-record key rather than time, traversal, or visibility order. Version
its changing field state separately. Carry its support through the wrapped
longitude representation and publish a conservative bound over the advection/
update interval.

Validate value and derivative continuity across the longitude seam,
deterministic storm replay, and bounds under the maximum declared jet and storm
motion. Record field units, body frame, update interval, owner, version,
validity, error, and reset behavior for storm creation/removal, schema change,
provider discontinuity, and slot reuse.
