const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./three.webgpu-Du3nux7o.js","./three.webgpu-Bjfb9xWU.js","./compatibility-renderer-BHplG0Ms.js","./fallback-core-BxY89vzU.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Dezn_h7o.js";import{i as e,n as t,r as n,t as r}from"./fallback-core-BxY89vzU.js";import{t as i}from"./preload-helper-DYl5dUZ5.js";async function a(){let e=null;try{let{WebGPURenderer:t,REVISION:n}=await i(async()=>{let{WebGPURenderer:e,REVISION:t}=await import(`./three.webgpu-Du3nux7o.js`);return{WebGPURenderer:e,REVISION:t}},__vite__mapDeps([0,1]),import.meta.url);return e=new t({antialias:!1}),await e.init(),{tested:!0,webgpu:e.backend.isWebGPUBackend===!0,compatibilityMode:e.backend.compatibilityMode===!0,threeRevision:n,backendName:e.backend.constructor.name}}catch(e){return{tested:!1,webgpu:null,compatibilityMode:null,threeRevision:null,backendName:null,error:e instanceof Error?e.message:String(e)}}finally{e?.dispose()}}var o=new URL(``+new URL(`fallback-fixtures-C__puiF4.json`,import.meta.url).href,``+import.meta.url),s=new URL(`./scenario/`,``+import.meta.url);function c(){return document.querySelector(`meta[name="lab-scenario"]`)?.content??new URL(location.href).searchParams.get(`scenario`)??`blocked-default`}function l(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#039;`})[e])}function u(e){return`${e.value} ${e.unit} [${e.label}]`}function d(e,n,r){let i=e.getContext(`2d`,{alpha:!1}),{width:a,height:o}=e,s=i.createImageData(a,o),c=.91;for(let e=0;e<o;e++)for(let i=0;i<a;i++){let l=-2+4*i/(a-1),u=-2+4*e/(o-1),d=t(`canonical-budget-reduction`,l,u,c),f=t(n,l,u,c),p=4*(i+e*a);if(r===`error`){let e=Math.min(1,Math.abs(f-d)/.32);s.data[p]=Math.round(255*e),s.data[p+1]=Math.round(75*(1-e)),s.data[p+2]=Math.round(210*(1-e))}else{let e=Math.max(0,Math.min(1,.5+(r===`reference`?d:f)/.55));s.data[p]=Math.round(15+45*e),s.data[p+1]=Math.round(50+145*e),s.data[p+2]=Math.round(95+150*e)}s.data[p+3]=255}i.putImageData(s,0,0)}var f=class{#e;#t;#n=!1;#r=null;#i=null;#a=null;#o=!1;constructor(e,t){this.#e=e,this.#t=t}async ready(){this.#s(),this.#r=await a(),await this.renderOnce()}async authorizeExplicitRequest(){this.#s(),this.#n=!0,await this.renderOnce()}async setScenario(e){this.#s(),n(this.#e,e),this.#t=e,this.#n=!1,await this.renderOnce()}async setMode(e){if(e!==`plan`)throw RangeError(`Unknown mode: ${e}`)}async setTier(e){throw RangeError(`Compatibility branches are not canonical quality tiers: ${e}`)}async setSeed(e){if(e!==0)throw RangeError(`Only deterministic seed 0 is supported, received ${e}`)}async setCamera(e){if(e!==`comparison`)throw RangeError(`Unknown camera: ${e}`)}async setTime(e){if(e!==.91)throw RangeError(`The fixture has one frozen comparison time: 0.91 seconds.`)}async step(e){if(e!==0)throw RangeError(`The fallback planner has no advancing history.`)}async resetHistory(){}async resize(){}async renderOnce(){this.#s(),this.#a?.dispose(),this.#a=null;let t=n(this.#e,this.#t),a=structuredClone(t);if(this.#n){if(this.#r?.tested!==!0){this.#i={status:`BLOCKED`,code:r.CAPABILITY,message:`The live backend could not be tested; compatibility remains inactive.`,details:{activated:!1,liveCapabilities:this.#r}},m(this,t,this.#i);return}a.actualCapabilities.webgpu=this.#r.webgpu}this.#i=e(a,{explicitRequest:this.#n}),m(this,t,this.#i);let o=this.#i.details?.branch;if(this.#i.details?.activated===!0&&o){p(o);let{createCompatibilityRepresentation:e}=await i(async()=>{let{createCompatibilityRepresentation:e}=await import(`./compatibility-renderer-BHplG0Ms.js`);return{createCompatibilityRepresentation:e}},__vite__mapDeps([2,3,1]),import.meta.url);this.#a=await e(document.querySelector(`#branch-runtime`),o,{explicitRequest:!0,testedUnavailable:this.#r.tested&&this.#r.webgpu===!1})}else this.#i.code===r.COMPARISON&&p(`maintained-legacy`)}async capturePixels(e){this.#s();let t=document.querySelector(`canvas[data-target="${CSS.escape(e)}"]`);if(!t)throw RangeError(`Unknown or unavailable capture target: ${e}`);return{target:e,width:t.width,height:t.height,pixels:t.getContext(`2d`).getImageData(0,0,t.width,t.height).data}}describePipeline(){return{owners:{canonical:`threejs-water-optics`,compatibility:`threejs-compatibility-fallbacks`},signals:[],sceneSubmissions:[],computeDispatches:[],resources:[],finalToneMapOwner:this.#i?.details?.activated?`compatibility-branch`:null,finalOutputTransformOwner:this.#i?.details?.activated?`compatibility-branch`:null}}describeResources(){return{branch:this.#i?.details?.branch??null,liveCompatibilityRenderer:this.#a!==null}}getMetrics(){return{scenarioId:this.#t,explicitRequest:this.#n,liveCapabilities:this.#r,compatibilityRuntime:this.#a?{backend:this.#a.backend,isWebGPUBackend:this.#a.isWebGPUBackend}:null,result:this.#i}}async dispose(){this.#a?.dispose(),this.#a=null,this.#o=!0}get catalog(){return this.#e}get liveCapabilities(){return this.#r}get explicitRequest(){return this.#n}#s(){if(this.#o)throw Error(`FallbackLabController is disposed.`)}};function p(e){for(let[t,n]of[[`canonical-reference`,`reference`],[`selected-branch`,`selected`],[`error-map`,`error`]]){let r=document.querySelector(`canvas[data-target="${t}"]`);r&&d(r,e,n)}}function m(e,t,n){let r=e.catalog.scenarios.map(e=>`<option value="${l(e.id)}" ${e.id===t.id?`selected`:``}>${l(e.id)}</option>`).join(``),i=t.desiredBranch!==null&&t.desiredBranch!==`canonical-budget-reduction`&&e.explicitRequest!==!0,a=e.catalog.scenarios.map(e=>`<li><a href="${new URL(`${e.id}/`,s).href}">${l(e.id)}</a></li>`).join(``),o=t.invariants.map(e=>`<li><code>${l(e.domain)}</code> — ${l(e.status)}; ${l(e.diagnostic)}</li>`).join(``),c=t.decisionTrace.map(e=>`<li><code>${l(e.branch)}</code> · ${l(e.changedAxes[0])} · ${l(e.outcome)}<br><span class="muted">${l(e.reason)}</span></li>`).join(``),d=document.querySelector(`#app`);d.innerHTML=`
		<p class="eyebrow">Quarantined compatibility teaching · schema v2</p>
		<h1>Explicit-request-only fallback harness</h1>
		<p class="lede">The canonical owner remains <code>threejs-water-optics</code>. Native WebGPU quality scaling returns to that owner. This harness may construct a forceWebGL branch only after a tested unavailable-WebGPU condition and a direct user action.</p>
		<div class="warning"><strong>Compatibility is inactive by default.</strong> A route URL never authorizes a fallback. The button below is the explicit request signal.</div>
		<div class="toolbar">
			<label for="scenario">Scenario</label>
			<select id="scenario">${r}</select>
			<button id="authorize" ${i?``:`disabled`}>Explicitly request this fallback teaching</button>
			<span class="status ${n.status.toLowerCase()}">${l(n.status)} · ${l(n.code)}</span>
		</div>
		<section class="grid">
			<article class="card">
				<h2>Capability and activation</h2>
				<div class="metric-row"><span class="muted">Fixture WebGPU</span><code>${l(t.actualCapabilities.webgpu)}</code></div>
				<div class="metric-row"><span class="muted">Live probe tested</span><code>${l(e.liveCapabilities?.tested)}</code></div>
				<div class="metric-row"><span class="muted">Live WebGPU</span><code>${l(e.liveCapabilities?.webgpu)}</code></div>
				<div class="metric-row"><span class="muted">Explicit request</span><code>${l(e.explicitRequest)}</code></div>
				<div class="metric-row"><span class="muted">Branch activated</span><code>${l(n.details?.activated??!1)}</code></div>
			</article>
			<article class="card">
				<h2>Independent evidence domains</h2>
				<div class="metric-row"><span class="muted">Visible loss</span><code>${n.details?.visibleLoss?l(u(n.details.visibleLoss)):`not measured`}</code></div>
				<div class="metric-row"><span class="muted">CPU fixture timing</span><code>${n.details?.timing?l(u(n.details.timing)):`not measured`}</code></div>
				<div class="metric-row"><span class="muted">GPU timing</span><code>INSUFFICIENT_EVIDENCE_GPU_TIMING</code></div>
				<div class="metric-row"><span class="muted">Target frame</span><code>${l(u(t.budgetEvidence.targetFrameMs))}</code></div>
			</article>
			<article class="card">
				<h2>Ordered decision trace</h2>
				<ol>${c||`<li>No compatibility decision is authorized.</li>`}</ol>
			</article>
			<article class="card">
				<h2>Invariant ledger</h2>
				<ul>${o||`<li>Canonical blocker only; no loss ledger applies.</li>`}</ul>
			</article>
			<article class="card wide">
				<h2>Render-target-style diagnostic captures</h2>
				<div class="capture-grid">
					<figure><canvas width="240" height="160" data-target="canonical-reference"></canvas><figcaption>canonical-reference</figcaption></figure>
					<figure><canvas width="240" height="160" data-target="selected-branch"></canvas><figcaption>selected-branch</figcaption></figure>
					<figure><canvas width="240" height="160" data-target="error-map"></canvas><figcaption>error-map</figcaption></figure>
				</div>
			</article>
			<article class="card wide">
				<h2>Authorized compatibility renderer</h2>
				<div id="branch-runtime"><p class="muted">No compatibility renderer is active.</p></div>
			</article>
			<article class="card">
				<h2>Standalone routes</h2><ul>${a}</ul>
			</article>
			<article class="card">
				<h2>Machine result</h2><pre>${l(JSON.stringify(n,null,2))}</pre>
			</article>
		</section>`,d.querySelector(`#scenario`).addEventListener(`change`,t=>e.setScenario(t.target.value)),d.querySelector(`#authorize`).addEventListener(`click`,()=>e.authorizeExplicitRequest())}var h=new f(await(await fetch(o)).json(),c());window.labController=h,await h.ready();