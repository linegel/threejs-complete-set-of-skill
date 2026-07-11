import { createProceduralTimelineDemo } from "./main.js";

const demo = createProceduralTimelineDemo();
await demo.initialize({ canvas: document.querySelector("#scene") });
globalThis.__LAB_CONTROLLER__ = demo.labController;
