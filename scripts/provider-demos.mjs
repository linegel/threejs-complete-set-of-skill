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
