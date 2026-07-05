# Deprecated Weather Volume Clouds

This legacy WebGL example violates three active `threejs-volumetric-clouds` rules:

- Step count: it uses 320 primary march steps, above the tier table cap of 96-160 for Ultra.
- Same-UV history: it blends history at the current UV without velocity/depth-aware rejection.
- Local tone-map: it applies local tone mapping and gamma inside the cloud composite instead of leaving output conversion to the host pipeline.

Do not use this example as a pattern for new work.
