import { createCameraRigDemo } from "./main.mjs";

const canvas = document.querySelector("#scene");
const demo = await createCameraRigDemo({ canvas });
globalThis.__LAB_CONTROLLER__ = demo.labController;
