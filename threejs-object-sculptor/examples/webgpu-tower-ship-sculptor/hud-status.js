const MAX_REASON_LENGTH = 96;

export const TOWER_SHIP_HUD_STATES = Object.freeze({
  initializing: "INITIALIZING — NATIVE WEBGPU",
  ready: "READY — NATIVE WEBGPU",
});
export const TOWER_SHIP_TERMINAL_HUD_STATES = Object.freeze(["failed", "device-lost"]);
const ALL_HUD_STATES = Object.freeze([...Object.keys(TOWER_SHIP_HUD_STATES), ...TOWER_SHIP_TERMINAL_HUD_STATES]);

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

export function resolveTowerShipHudState(currentState, requestedState) {
  if (!ALL_HUD_STATES.includes(requestedState)) throw new RangeError(`Unknown requested Tower Ship HUD state "${requestedState}"`);
  if (currentState !== null && !ALL_HUD_STATES.includes(currentState)) throw new RangeError(`Unknown current Tower Ship HUD state "${currentState}"`);
  if (currentState === "device-lost" || requestedState === "device-lost") return "device-lost";
  if (currentState === "failed" || requestedState === "failed") return "failed";
  return requestedState;
}
