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
  "roughness-cause",
  "unresolved-normal-residual-variance",
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
        expected: `product obligation: render a stable, nonblank ${key} diagnostic`,
        wrongIf: `reject if ${key} flickers, aliases, or disagrees with its declared owner`,
        fixtureStatus: "not-rendered",
      },
    ]),
  );
}
