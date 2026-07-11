const style = document.createElement("style");
style.textContent = `
  html, body { margin: 0; height: 100%; background: #07101d; color: #e3f2ff; font: 13px/1.4 ui-monospace, monospace; overflow: hidden; }
  canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
  aside { position: fixed; inset: 12px auto auto 12px; width: min(410px, calc(100vw - 48px)); padding: 12px; border: 1px solid #91c8ff35; border-radius: 8px; background: #081522df; backdrop-filter: blur(12px); }
  header { font-weight: 700; margin-bottom: 8px; }
  label { display: grid; grid-template-columns: 9.5rem 1fr; align-items: center; gap: 8px; margin: 6px 0; }
  select, button { width: 100%; color: inherit; background: #102237; border: 1px solid #7a9fc044; border-radius: 4px; padding: 5px; }
  pre { max-height: 26vh; overflow: auto; margin: 10px 0 0; color: #a9d8ff; font-size: 10px; }
  small { color: #a5b7c9; display: block; }
`;
document.head.append(style);
document.body.innerHTML = `
  <canvas aria-label="Native WebGPU touch-history frost lab"></canvas>
  <aside>
    <header>Touch-history frost — native WebGPU</header>
    <small>This route imports the canonical lab and locks the state named by its URL.</small>
    <label>mechanism <select data-mechanism></select></label>
    <label>tier <select data-tier></select></label>
    <label>diagnostic <select data-mode></select></label>
    <label>history <button data-clear type="button">clear both ping-pong textures</button></label>
    <pre data-status>initializing WebGPU…</pre>
  </aside>
`;
await import("./main.js");
