await Promise.all([
  import("./browser-webgpu-surface.js"),
  import("./browser-subject-adapter.js"),
  import("./subject-adapter.js"),
  import("./schema/dispatcher.js"),
]);

console.log("visual-validation import graph check passed");
