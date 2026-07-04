export const REQUIRED_DEBUG_VIEWS = Object.freeze([
  "height",
  "macroHeight",
  "patch-level",
  "patch-error",
  "patch-min-max",
  "parity-error",
  "tangential-warp",
  "detail-weights",
  "crater-channels",
  "biome-weights",
  "physical-water-classification",
  "roughness-variance",
  "atmosphere-masks",
]);

export function createPlanetDebugRegistry() {
  return Object.fromEntries(
    REQUIRED_DEBUG_VIEWS.map((key) => [
      key,
      {
        key,
        output:
          key === "crater-channels"
            ? "craterFloor/craterWall/craterRim/ejectaStrength"
            : key,
        expected: `render debug ${key}; expected a stable, nonblank diagnostic`,
        wrongIf: `wrong if ${key} flickers, aliases, or disagrees with the shared field schema`,
      },
    ]),
  );
}
