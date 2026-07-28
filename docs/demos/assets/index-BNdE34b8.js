const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-pPOLtyEv.js","./three.webgpu-Dss1ekdK.js","./three.tsl--5AYqKVA.js","./frost-surface-effect-DC3Wu82M.js","./lifecycle-profile-CbPBnctU.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Dezn_h7o.js";import{t as e}from"./preload-helper-DYl5dUZ5.js";var t=`
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #07101d; color: #e3f2ff; font: 13px/1.4 ui-monospace, monospace; overflow: hidden; }
  canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
  aside { position: fixed; inset: 12px auto auto 12px; width: min(350px, calc(100vw - 48px)); border: 1px solid #91c8ff35; border-radius: 8px; background: #081522f2; box-shadow: 0 12px 34px #02081466; }
  [data-controls] { margin: 0; }
  [data-controls] > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 8px 12px; font-weight: 700; cursor: pointer; user-select: none; list-style: none; }
  [data-controls] > summary::-webkit-details-marker { display: none; }
  [data-controls] > summary::after { content: "+"; color: #9cdbbd; font-size: 16px; line-height: 1; }
  [data-controls][open] > summary::after { content: "−"; }
  [data-control-panel] { padding: 4px 12px 12px; border-top: 1px solid #91c8ff2b; }
  output { flex: none; color: #9cdbbd; font-size: 10px; font-weight: 600; }
  label { display: grid; grid-template-columns: 9.5rem 1fr; align-items: center; gap: 8px; margin: 6px 0; }
  select, button { width: 100%; min-height: 30px; color: inherit; background: #102237; border: 1px solid #7a9fc066; border-radius: 4px; padding: 5px; }
  select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #9cdbbd; outline-offset: 2px; }
  button:active { transform: translateY(1px); }
  [data-metrics] { margin-top: 10px; border-top: 1px solid #91c8ff2b; padding-top: 8px; }
  [data-metrics] > summary { color: #b8c9d9; cursor: pointer; user-select: none; }
  [data-metrics][open] > summary { color: #e3f2ff; }
  pre { max-height: min(32vh, 280px); overflow: auto; margin: 8px 0 0; color: #a9d8ff; font-size: 10px; }
  small { color: #a5b7c9; display: block; }
  @media (max-width: 560px) {
    aside { inset: 8px; width: auto; }
    label { grid-template-columns: 7rem 1fr; }
    small { display: none; }
  }
`,n=`
  <canvas aria-label="Native WebGPU touch-history frost lab"></canvas>
  <aside>
    <details data-controls>
      <summary><span>Touch-history frost</span><output data-readiness>initializing</output></summary>
      <div data-control-panel>
        <small>Drag across the viewport. Pointer capsules update RGBA16F ping-pong history before the same frame’s frost/refraction composite.</small>
        <label>mechanism <select data-mechanism></select></label>
        <label>tier <select data-tier></select></label>
        <label>diagnostic <select data-mode></select></label>
        <label>history <button data-clear type="button">clear both ping-pong textures</button></label>
        <details data-metrics>
          <summary>runtime metrics</summary>
          <pre data-status>Metrics update while this drawer is open.</pre>
        </details>
      </div>
    </details>
  </aside>
`;function r(){if(document.querySelector(`canvas`)||document.querySelector(`[data-readiness]`))throw Error(`Frost lab shell cannot install over an existing runtime surface`);let e=document.createElement(`style`);if(e.dataset.frostLabShell=`true`,e.textContent=t,document.head.append(e),!document.querySelector(`link[rel="icon"]`)){let e=document.createElement(`link`);e.rel=`icon`,e.href=`data:,`,document.head.append(e)}document.body.innerHTML=n}r(),await e(()=>import(`./physical-observer-D7GsB6KH.js`),[],import.meta.url),await e(()=>import(`./main-pPOLtyEv.js`),__vite__mapDeps([0,1,2,3,4]),import.meta.url);