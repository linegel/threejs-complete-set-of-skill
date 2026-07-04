# Router Recipes

Use these recipes as examples of the required route manifest shape. They are not
presets; each brief still needs the mandatory WebGPU preflight, API proof, and
acceptance evidence. Each recipe names the minimal skill set, deferred skills,
and omitted skills.

## ocean planet

Input brief: orbit-to-horizon planet with spectral ocean, atmosphere, clouds,
and final cinematic grading.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-procedural-planets
  - $threejs-spectral-ocean
  - $threejs-sky-atmosphere-and-haze
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-planets
deferredSkills:
  - $threejs-exposure-color-grading
  - $threejs-volumetric-clouds
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: not used by this route
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - $threejs-water-optics: bounded pool/refraction ownership is not the horizon-scale cause
  - $threejs-bloom: defer until ocean/atmosphere HDR signal is proven
acceptanceEvidence:
  - no-post planet/ocean/atmosphere captures
  - field diagnostics for height, coast, ocean derivatives, atmosphere depth
```

## rainy city street

Input brief: wet asphalt, rain streaks, splashes, reflective puddles, buildings,
street lights, and shared post.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-procedural-buildings-and-cities
  - $threejs-rain-snow-and-wet-surfaces
  - $threejs-water-optics
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-rain-snow-and-wet-surfaces
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: $threejs-rain-snow-and-wet-surfaces
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - $threejs-volumetric-clouds: sky volume is not requested
  - $threejs-spectral-ocean: large-water spectra are not the cause
acceptanceEvidence:
  - wetness mask, ripple normal, impact occupancy, puddle thickness, no-post street
```

## forest flythrough

Input brief: dense grass, trees, wind, terrain masks, camera path, and temporal
stability through foliage.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-procedural-vegetation
  - $threejs-procedural-fields
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-vegetation
deferredSkills:
  - $threejs-scalable-real-time-shadows
  - $threejs-ambient-contact-shading
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: not used by this route
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - $threejs-procedural-geometry: general mesh writing is secondary to growth/wind
  - $threejs-bloom: no HDR emission cause yet
acceptanceEvidence:
  - roots attached, wind deformation, alpha/depth policy, no-post foliage silhouette
```

## black-hole shot

Input brief: curved-ray black hole with accretion disk, stars, bloom, exposure,
and camera push-in.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-black-holes-and-space-effects
  - $threejs-camera-controls-and-rigs
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-black-holes-and-space-effects
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: not used by this route
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - $threejs-particles-trails-and-effects: no time-local particle event is requested
  - $threejs-sky-atmosphere-and-haze: planetary scattering is not the light transport cause
acceptanceEvidence:
  - step count, steering magnitude, transmittance, termination ID, no-post lensing
```

## product scene

Input brief: glTF product viewer with procedural material polish, shadows,
reflections, and color-managed output.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-procedural-materials
  - $threejs-scalable-real-time-shadows
  - $threejs-image-pipeline
  - $threejs-visual-validation
primaryOwner: $threejs-procedural-materials
deferredSkills:
  - $threejs-bloom
  - $threejs-exposure-color-grading
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: not used by this route
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - asset pipeline: glTF/KTX2/DRACO setup routes to official docs or project tooling
  - $threejs-procedural-geometry: imported mesh silhouette is not being authored
acceptanceEvidence:
  - material diagnostic views, color-space ledger, shadow map diagnostics, final/no-post captures
```

## post-heavy dashboard

Input brief: 3D operational dashboard with UI overlay, glow, depth fog, AO, and
grading.

minimal skill set:

```yaml
selectedSkills:
  - $threejs-image-pipeline
  - $threejs-ambient-contact-shading
  - $threejs-bloom
  - $threejs-exposure-color-grading
  - $threejs-visual-validation
primaryOwner: $threejs-image-pipeline
deferredSkills:
  - $threejs-sky-atmosphere-and-haze
sharedResourceOwners:
  gbuffer: $threejs-image-pipeline
  depth: $threejs-image-pipeline
  normal: $threejs-image-pipeline
  velocity: $threejs-image-pipeline
  history: $threejs-image-pipeline
  weatherEnvelope: not used by this route
  toneMap: $threejs-image-pipeline
  outputTransform: $threejs-image-pipeline
  adaptiveResolution: $threejs-image-pipeline
omittedSkills:
  - UI overlays: DOM/app UI stays outside flagship graphics skills
  - $threejs-procedural-materials: load only if material identity is the missing signal
acceptanceEvidence:
  - no-post readability, UI exclusion mask, AO contribution, bloom source, tone/output owner proof
```
