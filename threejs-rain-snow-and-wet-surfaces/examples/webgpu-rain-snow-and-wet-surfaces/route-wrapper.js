const style = document.createElement("style");
style.textContent = `
  html, body { margin: 0; height: 100%; background: #080d14; color: #dbeaff; font: 13px/1.4 ui-monospace, monospace; overflow: hidden; }
  canvas { width: 100%; height: 100%; display: block; }
  aside { position: fixed; inset: 12px auto auto 12px; width: min(390px, calc(100vw - 48px)); padding: 12px; border: 1px solid #7594b533; border-radius: 8px; background: #08111dde; backdrop-filter: blur(12px); }
  header { font-weight: 700; margin-bottom: 8px; }
  label { display: grid; grid-template-columns: 9.5rem 1fr; align-items: center; gap: 8px; margin: 6px 0; }
  select, input { width: 100%; color: inherit; background: #111d2b; border: 1px solid #6682a144; border-radius: 4px; padding: 4px; }
  pre { max-height: 28vh; overflow: auto; margin: 10px 0 0; color: #9fc7ed; font-size: 10px; }
  small { color: #93a9bd; display: block; }
`;
document.head.append(style);
document.body.innerHTML = `
  <canvas aria-label="Native WebGPU coupled weather lab"></canvas>
  <aside>
    <header>Coupled weather — native WebGPU</header>
    <small>This route imports the canonical lab and locks the state named by its URL.</small>
    <label>mechanism <select data-mechanism></select></label>
    <label>tier <select data-tier></select></label>
    <label>diagnostic <select data-mode></select></label>
    <label>forcing <input data-forcing type="range" min="0" max="1" step="0.01" value="0.72"></label>
    <pre data-status>initializing WebGPU…</pre>
  </aside>
`;
await import("./main.js");
