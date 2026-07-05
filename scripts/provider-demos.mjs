export const PROVIDER_DEMOS = [
  {
    id: "water-integration-surface",
    skill: "threejs-water-optics",
    title: "Water Integration Surface",
    sceneId: "water-integration-surface",
    purpose: "live host-integration demo",
    tier: "native WebGPU bounded-water integration",
    livePath: "demos/water-integration-surface/",
    poster: "visual-validation/water-integration-surface/integration-surface-readback.png",
    evidenceDir: "visual-validation/water-integration-surface/",
    sourceExample: "threejs-water-optics/EXPERIMENTAL/water-integration-surface",
    validationCommand:
      "npm --prefix threejs-water-optics/EXPERIMENTAL/water-integration-surface run validate",
    providerClaim:
      "The bounded-water core integrates into a host scene with presets, quality selection, buoyancy, spray probes, deterministic ticks, transparent ordering, and mask-gap evidence.",
    limitations: [
      "The mask registry is intentionally shown as incomplete until a screen-space mask texture and water-material hook are implemented.",
      "The host project owns post-processing, transparent ordering, and final output conversion.",
    ],
    debugModes: ["live", "preset-switch", "sync-tick"],
  },
  {
    id: "ambient-contact-shading-demo",
    skill: "threejs-ambient-contact-shading",
    title: "Ambient Contact Shading Lab",
    sceneId: "ambient-contact-shading-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier ambient-visibility scene",
    livePath: "demos/ambient-contact-shading-demo/",
    visual: { kind: "ao", label: "AO.r + direct light separation" },
    sourceExample: "threejs-ambient-contact-shading/examples/webgpu-node-gtao",
    validationCommand:
      "npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run validate",
    providerClaim:
      "Ambient contact visibility grounds nearby surfaces while direct light and emissive terms stay readable.",
    limitations: [
      "The docs page uses live contact-visibility geometry, not the production GTAONode path.",
      "The production skill remains RenderPipeline pass/MRT depth-normal sharing with material-context AO composition.",
    ],
    debugModes: ["final", "no-ao", "ao-debug"],
  },
  {
    id: "selective-bloom-demo",
    skill: "threejs-bloom",
    title: "Selective HDR Bloom Bench",
    sceneId: "selective-bloom-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier emissive-response scene",
    livePath: "demos/selective-bloom-demo/",
    visual: { kind: "bloom", label: "emissive source + bloom contribution" },
    sourceExample: "threejs-bloom/examples/node-selective-bloom",
    validationCommand:
      "node threejs-bloom/examples/node-selective-bloom/validate-node-selective-bloom.mjs",
    providerClaim:
      "Selective emissive signal is isolated from readable base materials before a bloom response is added back.",
    limitations: [
      "The live page uses additive response geometry for interaction and mode switching.",
      "The production skill remains MRT emissive output feeding BloomNode inside one RenderPipeline output path.",
    ],
    debugModes: ["final", "base-only", "bloom-only"],
  },
  {
    id: "exposure-color-grading-demo",
    skill: "threejs-exposure-color-grading",
    title: "Scene-Referred Exposure Rig",
    sceneId: "exposure-color-grading-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier exposure-meter scene",
    livePath: "demos/exposure-color-grading-demo/",
    visual: { kind: "exposure", label: "HDR meter + adapted exposure state" },
    sourceExample: "threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline",
    validationCommand:
      "npm --prefix threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline run validate",
    providerClaim:
      "A scene-referred meter drives asymmetric exposure adaptation before tone-map-domain grading.",
    limitations: [
      "The docs page simulates the meter state in live scene controls for readability.",
      "The production skill remains compute-reduced HDR luminance, storage-buffer exposure, explicit tone mapping, and post-tone-map LUT sampling.",
    ],
    debugModes: ["final", "identity-lut", "meter-debug"],
  },
  {
    id: "image-pipeline-framegraph-demo",
    skill: "threejs-image-pipeline",
    title: "Shared Signal Framegraph",
    sceneId: "image-pipeline-framegraph-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier signal-ownership scene",
    livePath: "demos/image-pipeline-framegraph-demo/",
    visual: { kind: "pipeline", label: "one pass feeding shared diagnostics" },
    sourceExample: "threejs-image-pipeline/examples/webgpu-image-pipeline",
    validationCommand:
      "npm --prefix threejs-image-pipeline/examples/webgpu-image-pipeline run validate",
    providerClaim:
      "One scene frame feeds owned color, depth, normal, emissive, and velocity-style signal views.",
    limitations: [
      "The docs page visualizes the signal contract with live panels rather than allocating production MRT targets.",
      "The production skill remains one RenderPipeline, one pass/MRT producer, and one tone-map/output conversion owner.",
    ],
    debugModes: ["final", "signals", "bypass-post"],
  },
  {
    id: "shadow-cascade-demo",
    skill: "threejs-scalable-real-time-shadows",
    title: "Scalable Shadow Coverage",
    sceneId: "shadow-cascade-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier shadow-coverage scene",
    livePath: "demos/shadow-cascade-demo/",
    visual: { kind: "shadow", label: "coverage levels + bounded shadow map" },
    sourceExample: "threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow",
    validationCommand:
      "node threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/validate.js --allow-missing-gpu",
    providerClaim:
      "Bounded, cascade-style, and cached-budget views expose coverage, update scope, and bias pressure.",
    limitations: [
      "The live page uses a single real shadow map plus debug coverage overlays.",
      "The production skill chooses one shadow, CSMShadowNode, TileShadowNode, or a measured custom cached clipmap from the target scene.",
    ],
    debugModes: ["final", "cascade-debug", "single-map"],
  },
  {
    id: "sky-atmosphere-haze-demo",
    skill: "threejs-sky-atmosphere-and-haze",
    title: "Atmosphere And Haze Stack",
    sceneId: "sky-atmosphere-haze-demo",
    purpose: "live directional provider demo",
    tier: "reduced-tier sky/haze scene",
    livePath: "demos/sky-atmosphere-haze-demo/",
    visual: { kind: "sky", label: "shared sky, sun, haze, and LUT views" },
    sourceExample: "threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere",
    validationCommand:
      "node threejs-sky-atmosphere-and-haze/examples/webgpu-lut-atmosphere/validation.js",
    providerClaim:
      "Shared sky, sun, depth haze, and LUT diagnostic views preserve one atmosphere parameter model.",
    limitations: [
      "The docs page uses procedural sky bands and haze layers for direct interaction.",
      "The production skill remains compute-generated transmittance, multiscatter, sky-view, and aerial-perspective LUT/froxel products.",
    ],
    debugModes: ["final", "no-haze", "lut-debug"],
  },
  {
    id: "water-generated-caustics",
    skill: "threejs-water-optics",
    title: "Bounded Water Caustic Projection",
    sceneId: "water-generated-caustics",
    purpose: "live directional provider demo",
    tier: "native-budgeted reduced-tier caustic source",
    livePath: "demos/water-generated-caustics/",
    poster: "visual-validation/water-generated-caustics/final.design.png",
    evidenceDir: "visual-validation/water-generated-caustics/",
    sourceExample: "threejs-water-optics/examples/webgpu-bounded-water",
    validationCommand:
      "npm --prefix threejs-water-optics/examples/webgpu-bounded-water run validate:generated-assets",
    providerClaim:
      "Generated caustic fields are used as live scene inputs for a bounded-water floor projection.",
    limitations: [
      "Generated caustic textures are reduced-tier source data.",
      "The production path remains compute differential-area caustics in the water skill.",
    ],
    debugModes: ["final", "no-caustics", "diagnostic"],
  },
  {
    id: "cloud-generated-weather-maps",
    skill: "threejs-volumetric-clouds",
    title: "Weather Map Cloud Layers",
    sceneId: "cloud-generated-weather-maps",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-weather-map tier",
    livePath: "demos/cloud-generated-weather-maps/",
    poster: "visual-validation/cloud-generated-weather-maps/final.design.png",
    evidenceDir: "visual-validation/cloud-generated-weather-maps/",
    sourceExample: "threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds",
    validationCommand:
      "npm --prefix threejs-volumetric-clouds/examples/webgpu-weather-volume-clouds run validate:generated-assets",
    providerClaim:
      "Generated weather maps are used as live scene inputs for layered cloud density and erosion response.",
    limitations: [
      "Generated weather maps are reduced-tier diagnostic inputs.",
      "The production cloud path remains bounded raymarch, temporal reprojection, and cloud-shadow storage products.",
    ],
    debugModes: ["final", "weather-debug", "shell-slice"],
  },
  {
    id: "fields-generated-biome-maps",
    skill: "threejs-procedural-fields",
    title: "Biome Field Terrain",
    sceneId: "fields-generated-biome-maps",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-field tier",
    livePath: "demos/fields-generated-biome-maps/",
    poster: "visual-validation/fields-generated-biome-maps/final.design.png",
    evidenceDir: "visual-validation/fields-generated-biome-maps/",
    sourceExample: "threejs-procedural-fields/examples/webgpu-field-bake",
    validationCommand:
      "npm --prefix threejs-procedural-fields/examples/webgpu-field-bake run validate:generated-assets",
    providerClaim:
      "Generated biome maps are used as live scene inputs for terrain height, placement markers, and material response.",
    limitations: [
      "Generated biome maps are reduced-tier diagnostics.",
      "The production field path remains shared CPU/TSL parity plus compute/storage bakes when reuse justifies it.",
    ],
    debugModes: ["final", "flat", "channel-debug"],
  },
  {
    id: "frost-generated-crystals",
    skill: "threejs-dynamic-surface-effects",
    title: "Frost Crystal Surface",
    sceneId: "frost-generated-crystals",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-structure tier",
    livePath: "demos/frost-generated-crystals/",
    poster: "visual-validation/frost-generated-crystals/final.design.png",
    evidenceDir: "visual-validation/frost-generated-crystals/",
    sourceExample: "threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost",
    validationCommand:
      "npm --prefix threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost run validate:generated-assets",
    providerClaim:
      "Generated frost crystal fields are used as live scene inputs for surface structure, tint, and thaw diagnostics.",
    limitations: [
      "Generated crystal maps are reduced-tier static inputs.",
      "The production frost path remains StorageTexture history, reduced blur, and TSL refraction.",
    ],
    debugModes: ["final", "structure", "thaw-band"],
  },
  {
    id: "materials-generated-lava-causes",
    skill: "threejs-procedural-materials",
    title: "Lava Cause Material",
    sceneId: "materials-generated-lava-causes",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-material-cause tier",
    livePath: "demos/materials-generated-lava-causes/",
    poster: "visual-validation/materials-generated-lava-causes/final.design.png",
    evidenceDir: "visual-validation/materials-generated-lava-causes/",
    sourceExample: "threejs-procedural-materials/examples/tsl-procedural-pbr",
    validationCommand:
      "npm --prefix threejs-procedural-materials/examples/tsl-procedural-pbr run validate:generated-assets",
    providerClaim:
      "Generated lava cause maps are used as live scene inputs for PBR crust, normal relief, and raw emissive response.",
    limitations: [
      "Generated lava maps are reduced-tier diagnostic inputs.",
      "The production material path remains NodeMaterial PBR slots with HDR emissive and BloomNode ownership.",
    ],
    debugModes: ["final", "cool-crust", "raw-emissive"],
  },
  {
    id: "ocean-generated-wave-seeds",
    skill: "threejs-spectral-ocean",
    title: "Directional Wave Seed Surface",
    sceneId: "ocean-generated-wave-seeds",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-wave-seed tier",
    livePath: "demos/ocean-generated-wave-seeds/",
    poster: "visual-validation/ocean-generated-wave-seeds/final.design.png",
    evidenceDir: "visual-validation/ocean-generated-wave-seeds/",
    sourceExample: "threejs-spectral-ocean/examples/webgpu-fft-ocean",
    validationCommand:
      "npm --prefix threejs-spectral-ocean/examples/webgpu-fft-ocean run validate:generated-assets",
    providerClaim:
      "Generated directional wave seeds are used as live scene inputs for reduced-tier displacement and slope diagnostics.",
    limitations: [
      "Generated wave seeds are reduced-tier preview/debug inputs.",
      "The production ocean path remains compute FFT cascades, derivative maps, and persistent foam history.",
    ],
    debugModes: ["final", "calm", "slope-debug"],
  },
  {
    id: "space-generated-starfields",
    skill: "threejs-black-holes-and-space-effects",
    title: "Curved-Ray Starfield Preview",
    sceneId: "space-generated-starfields",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-starfield tier",
    livePath: "demos/space-generated-starfields/",
    poster: "visual-validation/space-generated-starfields/final.design.png",
    evidenceDir: "visual-validation/space-generated-starfields/",
    sourceExample: "threejs-black-holes-and-space-effects/examples/tsl-curved-ray",
    validationCommand:
      "npm --prefix threejs-black-holes-and-space-effects/examples/tsl-curved-ray run validate:generated-assets",
    providerClaim:
      "Generated star tiles are used as live scene inputs for a repeatable background around a bounded lensing proxy.",
    limitations: [
      "Generated star tiles are distant/background-tier inputs.",
      "The production space path remains bounded adaptive ray integration and final-direction environment lookup.",
    ],
    debugModes: ["final", "no-lens", "star-debug"],
  },
  {
    id: "vegetation-generated-meadow-density",
    skill: "threejs-procedural-vegetation",
    title: "Meadow Density Placement",
    sceneId: "vegetation-generated-meadow-density",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-density tier",
    livePath: "demos/vegetation-generated-meadow-density/",
    poster: "visual-validation/vegetation-generated-meadow-density/final.design.png",
    evidenceDir: "visual-validation/vegetation-generated-meadow-density/",
    sourceExample: "threejs-procedural-vegetation/examples/webgpu-dense-grass",
    validationCommand:
      "npm --prefix threejs-procedural-vegetation/examples/webgpu-dense-grass run validate:generated-assets",
    providerClaim:
      "Generated meadow density maps are used as live scene inputs for placement, path clearing, flower tint, and LOD response.",
    limitations: [
      "Generated meadow maps are reduced-tier diagnostic inputs.",
      "The production vegetation path remains chunked compute/storage instance data, patch culling, and rooted wind.",
    ],
    debugModes: ["final", "density-debug", "low-lod"],
  },
  {
    id: "rain-generated-ripples",
    skill: "threejs-rain-snow-and-wet-surfaces",
    title: "Wet Surface Ripple Normals",
    sceneId: "rain-generated-ripples",
    purpose: "live directional provider demo",
    tier: "native-budgeted generated-normal tier",
    livePath: "demos/rain-generated-ripples/",
    poster: "visual-validation/rain-generated-ripples/final.design.png",
    evidenceDir: "visual-validation/rain-generated-ripples/",
    sourceExample:
      "threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces",
    validationCommand:
      "npm --prefix threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces run validate:generated-assets",
    providerClaim:
      "Generated ripple normal variants are used as live scene inputs for wet asphalt lighting response.",
    limitations: [
      "The rain streaks in this docs demo are visual context, not the high-tier storage-instanced precipitation path.",
      "Dynamic compute/event ripples remain the high-tier skill implementation.",
    ],
    debugModes: ["final", "wet-baseline", "normal-debug"],
  },
  {
    id: "planet-generated-craters",
    skill: "threejs-procedural-planets",
    title: "Reduced-Tier Crater Mask Planet",
    sceneId: "planet-generated-craters",
    purpose: "live directional provider demo",
    tier: "native-budgeted reduced-tier crater diagnostic",
    livePath: "demos/planet-generated-craters/",
    poster: "visual-validation/planet-generated-craters/final.design.png",
    evidenceDir: "visual-validation/planet-generated-craters/",
    sourceExample: "threejs-procedural-planets/examples/webgpu-quadtree-planet",
    validationCommand:
      "npm --prefix threejs-procedural-planets/examples/webgpu-quadtree-planet run validate:generated-assets",
    providerClaim:
      "Generated crater mask channels are used as live scene inputs for relief and material response on a WebGPU sphere.",
    limitations: [
      "Generated crater masks are reduced-tier diagnostics.",
      "The production planet path remains planetFields() plus cube-sphere quadtree LOD and parity checks.",
    ],
    debugModes: ["final", "flat", "diagnostic"],
  },
];

export function demosForSkill(skill) {
  return PROVIDER_DEMOS.filter((demo) => demo.skill === skill);
}

export function demoById(id) {
  return PROVIDER_DEMOS.find((demo) => demo.id === id) ?? null;
}
