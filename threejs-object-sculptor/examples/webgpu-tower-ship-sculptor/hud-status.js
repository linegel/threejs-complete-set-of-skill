const MAX_REASON_LENGTH = 96;

export const TOWER_SHIP_HUD_STATES = Object.freeze({
  initializing: "INITIALIZING — NATIVE WEBGPU",
  ready: "READY — NATIVE WEBGPU",
});

export function boundedTowerShipReason(value, maxLength = MAX_REASON_LENGTH) {
  if (!Number.isInteger(maxLength) || maxLength <= 0) throw new RangeError("HUD reason length must be a positive integer");
  const raw = value instanceof Error ? value.message : value?.message ?? value?.reason ?? value;
  const normalized = String(raw ?? "unknown reason")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "unknown reason").slice(0, maxLength);
}

export function towerShipHudStatus(state, detail = null) {
  if (state === "initializing" || state === "ready") return TOWER_SHIP_HUD_STATES[state];
  if (state === "failed") return `FAILED — ${boundedTowerShipReason(detail)}`;
  if (state === "device-lost") return `DEVICE LOST — ${boundedTowerShipReason(detail)}`;
  throw new RangeError(`Unknown Tower Ship HUD state "${state}"`);
}
