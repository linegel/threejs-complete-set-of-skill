import { CAMERA_MODES, CAMERA_TIERS } from "./CameraDirectionController.mjs";

export const CAMERA_MECHANISMS = Object.freeze([
  "scale-aware-framing",
  "handoff-and-replay",
  "pointer-orbit-and-collision",
  "floating-origin",
  "projection-and-depth",
  "shared-jitter-and-velocity",
]);

function routeSegment(pathname, label) {
  const pieces = pathname.split("/").filter(Boolean);
  const index = pieces.lastIndexOf(label);
  return index >= 0 ? pieces[index + 1] ?? null : null;
}

function exact(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`unknown camera ${label}: ${value}`);
  return value;
}

export function parseCameraRoute(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname ?? "/";
  const params = new URLSearchParams(locationLike?.search ?? "");
  const mechanism = routeSegment(pathname, "mechanism") ?? params.get("mechanism") ?? CAMERA_MECHANISMS[0];
  const tier = routeSegment(pathname, "tier") ?? params.get("tier") ?? "full";
  const mode = params.get("mode") ?? "overview";
  return Object.freeze({
    mechanism: exact(mechanism, CAMERA_MECHANISMS, "mechanism"),
    tier: exact(tier, Object.keys(CAMERA_TIERS), "tier"),
    mode: exact(mode, CAMERA_MODES, "mode"),
  });
}

export function assertCameraRouteLock(route, { mechanism = route.mechanism, tier = route.tier } = {}) {
  exact(mechanism, CAMERA_MECHANISMS, "mechanism");
  exact(tier, Object.keys(CAMERA_TIERS), "tier");
  if (mechanism !== route.mechanism) throw new Error(`camera mechanism route is locked to ${route.mechanism}`);
  if (tier !== route.tier) throw new Error(`camera tier route is locked to ${route.tier}`);
  return route;
}
