# Generated Asset Domain Validation Plan

## Goal

Move generated asset review from static contact-sheet inspection to
skill-local domain evidence. Each generated asset family must prove that it
supports the actual promise of its owning skill in the smallest realistic
applied demo, with screenshots, machine-checked artifacts, and explicit channel
contracts.

This plan covers the current state of the repository, not prior intent. Phase 0
has been run once in this workspace and must be rerun whenever generated assets
or pilot validators change.

Current baseline:

- `.agent/tools/generate_asset_variants.py` writes three-channel arrays as RGBA
  with opaque alpha.
- All 30 checked generated PNGs have been regenerated and verified as
  `512x512` 8-bit RGBA.
- Alpha is semantic for weather, lava, meadow, biome, and crater families.
- Alpha is opaque padding for caustic, ocean seed, ripple normal, frost, and
  starfield families.
- Rain ripple and planet crater pilot validators are restored as example-local
  source files and wired into package `validate` scripts.
- `artifacts/` and `.agent/` are ignored, so durable README-facing screenshots
  live under `docs/visual-validation/`.

## Non-Negotiable Acceptance Rules

1. A contact sheet is an index only. It never proves domain quality.
2. Static metrics are preflight only. They never prove a skill promise.
3. Every generated PNG must have an exact channel contract:
   - dimensions;
   - PNG color type;
   - semantic channel meanings;
   - `NoColorSpace` versus `SRGBColorSpace`;
   - alpha meaning, including whether it is semantic data or required opaque
     padding.
4. Every validator must fail clearly on:
   - missing assets;
   - wrong dimensions;
   - wrong PNG color type or alpha contract;
   - wrong color-space declaration;
   - missing variants;
   - blank captures;
   - final-only evidence bundles;
   - missing diagnostics;
   - unavailable primary WebGPU backend when the domain gate requires WebGPU.
5. Every skill gets a smallest real applied demo. No flat thumbnails count.
6. Every accepted family writes a visual-validation bundle with:
   - `images/final.design.png`;
   - `images/no-post.design.png`;
   - `images/diagnostics.mosaic.png`;
   - `images/camera.near.png`;
   - `images/camera.design.png`;
   - `images/camera.far.png`;
   - `images/seed-0001.final.png`;
   - `images/seed-stress.final.png`;
   - `images/temporal.t000.png`;
   - `images/temporal.t001.png` or an equivalent state-comparison pair where
     temporal behavior is not the domain mechanism;
   - `visual-contract.json`;
   - `evidence-manifest.json`;
   - `renderer-info.json`;
   - `render-targets.json`;
   - `storage-resources.json`;
   - `timings.json`;
   - `leak-loop.json`.
7. Manual screenshot inspection is part of acceptance. If the evidence bundle
   passes mechanically but the screenshot does not demonstrate the promised
   mechanism, the validator or asset must be fixed before sign-off.

## Phase 0: Repair And Baseline Current State

### 0.1 Regenerate And Verify Global PNG Contract

Run the deterministic generator and verify every generated PNG is `512x512`
RGBA:

```bash
python3 .agent/tools/generate_asset_variants.py
python3 - <<'PY'
from pathlib import Path
from PIL import Image
bad = []
for path in sorted(Path('.').glob('threejs-*/assets/generated-variants/*.png')):
    image = Image.open(path)
    if image.mode != 'RGBA' or image.size != (512, 512):
        bad.append((str(path), image.mode, image.size))
print('bad', bad)
raise SystemExit(1 if bad else 0)
PY
```

Expected outcome:

- All 30 generated PNGs are `RGBA`.
- Alpha is semantic for:
  - cloud weather maps;
  - lava cause maps;
  - meadow density masks;
  - biome field maps;
  - crater masks.
- Alpha is opaque padding for:
  - water caustic fields;
  - directional wave seeds;
  - ripple normals;
  - frost crystal maps;
  - starfield tiles.

Current pass:

- Passed after regeneration.
- The repair changed the 15 previously RGB families to RGBA:
  - water caustic fields;
  - directional wave seeds;
  - ripple normals;
  - frost crystal maps;
  - starfield tiles.

### 0.2 Restore Or Rebuild The Two Existing Pilots

Before adding the remaining eight gates, restore the two pilot validators so
the docs describe real current files:

- Rain:
  - `threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/generated-ripples.html`
  - `generated-ripples-browser.mjs`
  - `validate-generated-ripples.mjs`
  - package scripts:
    - `validate`
    - `validate:generated-assets`
- Planets:
  - `threejs-procedural-planets/examples/webgpu-quadtree-planet/generated-craters.html`
  - `generated-craters-browser.mjs`
  - `validate-generated-craters.mjs`
  - package scripts:
    - `validate`
    - `validate:generated-assets`

Run:

```bash
npm --prefix threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces run validate
npm --prefix threejs-procedural-planets/examples/webgpu-quadtree-planet run validate
```

Acceptance:

- Both validators pass.
- Both evidence bundles exist under `artifacts/visual-validation/`.
- Manual inspection shows wet-surface ripple response and spherical crater
  behavior, not flat texture previews.

Current pass:

- Rain validator passes and writes
  `artifacts/visual-validation/rain-generated-ripples/r185/native-budgeted/seed-180185/`.
- Planet validator passes and writes
  `artifacts/visual-validation/planet-generated-craters/r185/native-budgeted/seed-180185/`.
- Manual inspection accepted `final.design.png` and
  `diagnostics.mosaic.png` for both pilots.
- Durable README screenshots have been refreshed under
  `docs/visual-validation/rain-generated-ripples/` and
  `docs/visual-validation/planet-generated-craters/`.

### 0.3 Restore README Catalog

Add or verify:

- `docs/generated-asset-contact-sheet.png`
- README section `Generated Asset Suggestions`

The README must say:

- assets can be used directly by agents for simple demos;
- assets can be replaced or regenerated by agents when the user asks for a
  different style, resolution, channel contract, or domain-specific look;
- only families with skill-local domain validators are domain-accepted.

Current pass:

- README catalog and contact sheet are present.
- README marks water caustic fields, rain ripple normals, and planet crater
  masks as screenshot-backed domain-covered families.

## Shared Validator Architecture

Each new family should follow a local pattern, not a central generic composite
gate:

```text
<skill>/examples/<existing-or-smallest-demo>/
  generated-<family>.html
  generated-<family>-browser.mjs
  validate-generated-<family>.mjs
```

Package scripts:

```json
{
  "scripts": {
    "validate": "node <existing-validator> && node validate-generated-<family>.mjs",
    "validate:generated-assets": "node validate-generated-<family>.mjs"
  }
}
```

The browser surface may use Canvas2D for deterministic capture after a
`WebGPURenderer` primary-backend gate, but the rendered content must be an
applied domain model. It must not be a thumbnail grid.

All validators should reuse the visual-validation harness schema where possible:

- `createRgbaPng`
- `validateArtifactBundle`

## Skill Order

The work should proceed from highest risk of misleading validation to lower
risk. Water optics is complete; the remaining order is:

1. `threejs-spectral-ocean` directional wave seeds
2. `threejs-volumetric-clouds` weather maps
3. `threejs-dynamic-surface-effects` frost crystal maps
4. `threejs-procedural-materials` lava cause maps
5. `threejs-procedural-vegetation` meadow density masks
6. `threejs-black-holes-and-space-effects` starfield tiles
7. `threejs-procedural-fields` biome field maps

## Per-Skill Plans

### 1. Water Optics: Caustic Fields

Status: complete. Validator:
`threejs-water-optics/examples/webgpu-bounded-water/validate-generated-caustics.mjs`.
Evidence:
`artifacts/visual-validation/water-generated-caustics/r185/native-budgeted/seed-180185/`.
Durable screenshots:
`docs/visual-validation/water-generated-caustics/`.

Skill promise:

- Bounded water, local ripples, caustics, depth refraction, absorption,
  Fresnel, and crest/floor response.

Assets:

- `caustic-field-a.png`
- `caustic-field-b.png`
- `caustic-field-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- RGB: caustic intensity/color source;
- A: opaque padding, must be `255`;
- tileable edge seam must stay below the preflight threshold.

Smallest real demo:

- A shallow pool or tank with a refractive water plane and a visible floor.
- Render dry/no-caustic floor, water without caustics, water with each caustic
  variant, caustic-only diagnostic, and tiled seam-stress projection.

Required screenshots:

- `final.design.png`: water surface over floor with variants applied.
- `no-post.design.png`: same scene with caustic contribution disabled.
- `diagnostics.mosaic.png`: caustic-only, floor depth/thickness, tile-stress.
- `camera.near.png`: close floor/water contact.
- `camera.design.png`: standard pool composition.
- `camera.far.png`: minified floor projection.
- `seed-0001.final.png`: variant/phase baseline.
- `seed-stress.final.png`: high tiling and high contrast floor stress.
- `temporal.t000.png` / `temporal.t001.png`: caustic drift phase comparison.

Acceptance metrics:

- caustic contribution materially changes lit floor luminance;
- contribution is absent when caustics are disabled;
- caustics remain tied to water/floor projection, not screen-space color;
- no obvious tile seams under stress;
- no color-space misuse.

### 2. Spectral Ocean: Directional Wave Seeds

Skill promise:

- Directional wave spectra, FFT cascades, choppy displacement, derivative
  normals, foam/Jacobian diagnostics, and large-water validation.

Assets:

- `directional-wave-seed-a.png`
- `directional-wave-seed-b.png`
- `directional-wave-seed-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- R: preview height seed;
- G/B: slope or derivative hint channels;
- A: opaque padding, must be `255`.

Smallest real demo:

- A narrow ocean strip or square water patch that converts the seed into
  displacement, normals, and directional wave bands.
- Must show the seed as an input to wave response, not as a color texture.

Required screenshots:

- final water strip with directional waves;
- no-displacement baseline;
- height/slope/Jacobian diagnostic mosaic;
- near grazing wave view;
- design view;
- far minification view;
- seed variant comparison;
- high wind or high tiling stress;
- two time samples showing wave phase progression.

Acceptance metrics:

- seeded height changes geometry or derived normals;
- slope channels affect lighting directionally;
- variants produce distinct wave direction/frequency behavior;
- no sRGB-as-data;
- no claim that preview seeds replace production FFT spectrum data.

### 3. Volumetric Clouds: Weather Maps

Skill promise:

- Weather-driven cloud density, cloud type/detail, vertical profiles, erosion,
  lighting, shadows, and temporal reconstruction.

Assets:

- `weather-map-a.png`
- `weather-map-b.png`
- `weather-map-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- R: coverage;
- G: cloud type/detail;
- B: vertical bias;
- A: erosion;
- all four channels are semantic and must be present.

Smallest real demo:

- A bounded slab or low-cost raymarched cloud layer driven by the weather map.
- Must show coverage/type/vertical/erosion diagnostics separately.

Required screenshots:

- final cloud layer;
- no-weather/default-density baseline;
- weather-channel diagnostic mosaic;
- near cloud edge;
- design view;
- far horizon/cloud-bank view;
- variant comparison;
- high erosion/low coverage stress;
- temporal camera-offset or weather-scroll pair.

Acceptance metrics:

- coverage changes cloud occupancy;
- vertical bias changes height/profile;
- erosion cuts detail instead of acting as color;
- cloud shape survives camera movement;
- no RGB fallback because alpha erosion is required.

### 4. Dynamic Surface Effects: Frost Crystal Maps

Skill promise:

- Frost/thaw history, crystalline structure targets, blur/thickness masks,
  refraction normals, and temporal clearing/decay.

Assets:

- `frost-crystal-a.png`
- `frost-crystal-b.png`
- `frost-crystal-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- RGB: crystalline structure intensity/normal derivation input;
- A: opaque padding, must be `255`.

Smallest real demo:

- A translucent pane or car-window patch with frost accumulation and a clear
  swipe/deposit mask.
- Must prove the crystal map affects frost structure and refraction normals,
  not only color.

Required screenshots:

- final frosted pane;
- no-structure baseline;
- structure/thickness/normal diagnostic mosaic;
- near crystal close-up;
- design view;
- far pane readability;
- variant comparison;
- heavy frost stress;
- before/after clear or thaw temporal pair.

Acceptance metrics:

- structure map changes frost edge/detail;
- refraction/normal diagnostic changes with variants;
- cleared areas remain clear;
- no frame-dependent decay claims without temporal evidence;
- no obvious tiling in stress view.

### 5. Procedural Materials: Lava Cause Maps

Skill promise:

- Cause-first procedural PBR material identity, rock/crack/emission/grain
  separation, NodeMaterial/TSL-friendly channels, and material diagnostics.

Assets:

- `lava-cause-a.png`
- `lava-cause-b.png`
- `lava-cause-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- R: rock;
- G: cracks;
- B: emission;
- A: grain;
- all four channels are semantic and must be present.

Smallest real demo:

- A lava slab or cracked rock material swatch with PBR channels driven by the
  cause map.
- Must include no-emission, channel diagnostic, and emissive/bloom-independent
  views.

Required screenshots:

- final material slab;
- no-emission/no-post baseline;
- rock/crack/emission/grain diagnostic mosaic;
- near crack detail;
- design view;
- far tiled material view;
- variant comparison;
- high emission stress;
- two phase or heat-state comparison images.

Acceptance metrics:

- B emission channel changes emissive signal, not base color only;
- G cracks affect roughness/emission boundary;
- A grain affects material microvariation;
- final remains readable with bloom/post disabled;
- no alpha loss, because A is semantic.

### 6. Procedural Vegetation: Meadow Density Masks

Skill promise:

- Grass and meadow placement, path clearing, clumps, flower scatter, chunked
  LOD, and density diagnostics.

Assets:

- `meadow-density-a.png`
- `meadow-density-b.png`
- `meadow-density-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- R: grass density;
- G: path or clearing;
- B: clump mask;
- A: flower mask;
- all four channels are semantic and must be present.

Smallest real demo:

- A small meadow patch with instanced blades/cards and flowers placed from the
  packed map.
- Must show placement masks, not just the texture.

Required screenshots:

- final meadow patch;
- no-map uniform distribution baseline;
- density/path/clump/flower diagnostic mosaic;
- near blade/flower placement;
- design view;
- far LOD/minification view;
- variant comparison;
- overdraw/density stress;
- two wind or LOD-state comparison images.

Acceptance metrics:

- R controls blade density;
- G clears a path;
- B changes clump grouping;
- A places flowers;
- no alpha loss, because A is semantic;
- final density matches diagnostic masks.

### 7. Black Holes And Space Effects: Starfield Tiles

Skill promise:

- Curved-ray space backgrounds, starfield lookup direction, accretion/wormhole
  integration context, and bounded raymarch diagnostics.

Assets:

- `starfield-tile-a.png`
- `starfield-tile-b.png`
- `starfield-tile-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- likely `SRGBColorSpace` if used as visible star color/environment input;
- RGB: visible star/nebula color;
- A: opaque padding, must be `255`.

Smallest real demo:

- A curved-ray or lensing background sample that uses the tile as a background
  lookup around a compact lensing object.
- Must show unlensed background, lensed background, lookup-direction diagnostic,
  and tile seam stress.

Required screenshots:

- final lensed space view;
- no-lensing background baseline;
- lookup direction / integration diagnostic mosaic;
- near high-curvature view;
- design view;
- far/low-curvature view;
- variant comparison;
- seam/stress lookup;
- two camera-offset comparison images.

Acceptance metrics:

- stars are sampled as color, not `NoColorSpace` data;
- lensing changes lookup direction without breaking tile continuity;
- no obvious seams under wrap/stress;
- star density remains sparse and readable;
- validator does not pretend the tile is a physically modeled galaxy.

### 8. Procedural Fields: Biome Field Maps

Skill promise:

- Shared scalar/vector fields, biome/material masks, wear/altitude/moisture
  channels, CPU/GPU parity, and field diagnostics.

Assets:

- `biome-field-a.png`
- `biome-field-b.png`
- `biome-field-c.png`

Channel contract:

- RGBA PNG, `512x512`;
- `NoColorSpace`;
- R: altitude;
- G: moisture;
- B: wear;
- A: biome selector/style;
- all four channels are semantic and must be present.

Smallest real demo:

- A terrain patch or field-driven material bands demo using the packed biome
  field for height, moisture color, wear, and biome classification.
- Must include CPU/GPU parity or sampled-point diagnostic output.

Required screenshots:

- final terrain/material patch;
- flat/no-field baseline;
- altitude/moisture/wear/biome diagnostic mosaic;
- near material transition;
- design view;
- far/minified terrain view;
- variant comparison;
- threshold/seam stress;
- two state images showing biome threshold or wetness variation.

Acceptance metrics:

- R affects height or terrain banding;
- G affects wet/dry or color/material response;
- B affects wear/ridge/path material;
- A affects biome classification;
- no alpha loss, because A is semantic;
- sampled diagnostics match declared channel meanings.

## Documentation Updates Per Family

After each family passes:

1. Update `ASSET_VARIANT_REVIEW.md`:
   - change the family verdict from preflight-only to domain pilot covered;
   - link the skill-local validator path;
   - record manual screenshot inspection decision.
2. Update `FINAL_REPORT.md`:
   - add the family to domain-quality coverage;
   - keep remaining uncovered families explicitly listed.
3. Update `README.md`:
   - keep the generated asset catalog current;
   - mark only accepted families as domain-covered.
4. Preserve contact sheets as overview artifacts only.

## Stop Conditions

Do not move to the next skill if:

- the current family has unresolved channel-contract ambiguity;
- the example only displays thumbnails;
- a required screenshot is missing or blank;
- a diagnostic does not correspond to a real mechanism;
- primary WebGPU is unavailable and the gate requires it;
- package `validate` does not include `validate:generated-assets`;
- manual screenshot inspection fails.

## Completion Criteria

The full goal is complete only when:

- Phase 0 current-state repairs are done and verified;
- all eight remaining families have skill-local validators;
- all eight validators run through package `validate`;
- every evidence bundle passes schema and nonblank checks;
- screenshots for every family have been manually inspected;
- docs and README accurately distinguish domain-covered families from
  preflight-only families;
- no generated asset family is described as accepted without matching
  skill-local evidence.
