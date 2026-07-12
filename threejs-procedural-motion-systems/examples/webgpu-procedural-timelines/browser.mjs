import { createProceduralTimelineDemo } from "./main.js";

const demo = createProceduralTimelineDemo();
const captureValues = new URLSearchParams(globalThis.location?.search ?? "").getAll("capture");
if (captureValues.length > 1) throw new RangeError("duplicate motion capture flags are not allowed");
const captureMode = captureValues[0] === "1";
await demo.initialize({
  canvas: document.querySelector("#scene"),
  startAnimationLoop: !captureMode,
});
globalThis.__LAB_CONTROLLER__ = demo.labController;
