# WebGPU directional shadow architecture bench

This bench loads the same seeded receiver/caster fixture through one bounded
directional shadow, r185 `CSMShadowNode`, r185 `TileShadowNode`, or the
receiver-backed cached clipmap. It reports actual runtime resource identities;
timing fields remain `null` and the verdict remains `INSUFFICIENT_EVIDENCE`
until current-adapter timestamp capture runs.

Select the public scenario with `?scenario=bounded|csm|tiled|cached`. The page
maps that scenario to the internal shadow architecture and reports the public
selection through `labController.getMetrics().routeSelection`.
