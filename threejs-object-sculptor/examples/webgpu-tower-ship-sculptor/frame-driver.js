import { resolveFrameDeltaSeconds } from "./lab-controller.js";

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export function createTowerShipFrameDriver({
  controller,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  onMetrics,
  onError,
  hudIntervalMs = 240,
} = {}) {
  if (!controller) throw new TypeError("Tower Ship frame driver requires a controller");
  if (typeof now !== "function" || typeof requestFrame !== "function") throw new TypeError("Tower Ship frame timing callbacks are required");
  if (typeof onMetrics !== "function" || typeof onError !== "function") throw new TypeError("Tower Ship frame observers are required");
  if (!Number.isFinite(hudIntervalMs) || hudIntervalMs < 0) throw new RangeError("HUD interval must be finite and nonnegative");

  let active = false;
  let previous = now();
  let lastHudUpdate = previous;
  let operationTail = Promise.resolve();

  function publishMetrics() {
    onMetrics(controller.getMetrics());
  }

  function enqueue(operation) {
    const current = operationTail.then(operation, operation);
    operationTail = current.catch(() => {});
    return current;
  }

  function fail(value) {
    active = false;
    onError(asError(value));
  }

  async function frame(timestamp) {
    if (!active) return;
    const publishAfterRender = timestamp - lastHudUpdate >= hudIntervalMs
      || controller.getMetrics().firstFrameCompleted !== true;
    try {
      await enqueue(async () => {
        const deltaSeconds = resolveFrameDeltaSeconds(timestamp, previous);
        previous = timestamp;
        await controller.step(deltaSeconds);
        await controller.renderOnce();
      });
      if (publishAfterRender) {
        lastHudUpdate = timestamp;
        publishMetrics();
      }
    } catch (error) {
      fail(error);
      return;
    }
    if (active) requestFrame(frame);
  }

  return Object.freeze({
    start() {
      if (active) return;
      active = true;
      publishMetrics();
      requestFrame(frame);
    },
    stop() {
      active = false;
    },
    async mutate(operation) {
      if (typeof operation !== "function") throw new TypeError("Tower Ship mutation must be a function");
      try {
        await enqueue(operation);
        publishMetrics();
      } catch (error) {
        fail(error);
      }
    },
  });
}
