if (!document.querySelector("#lab")) {
  document.body.insertAdjacentHTML("afterbegin", '<canvas id="lab"></canvas><div id="status">initializing native WebGPU…</div>');
}
await import("./browser-app.js");
