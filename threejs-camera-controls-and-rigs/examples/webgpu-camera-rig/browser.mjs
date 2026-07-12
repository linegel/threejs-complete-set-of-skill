import { createCameraRigDemo } from "./main.mjs";

const canvas = document.querySelector("#scene");
const demo = await createCameraRigDemo({ canvas });
globalThis.labController = demo.labController;
globalThis.__LAB_CONTROLLER__ = demo.labController;
