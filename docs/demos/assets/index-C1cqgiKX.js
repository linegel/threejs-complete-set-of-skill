const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./three.webgpu-Bxw5NSti.js","./three.webgpu-Dss1ekdK.js","./compatibility-renderer-CrxVRi9V.js","./fallback-core-BxY89vzU.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-Dezn_h7o.js";import{i as e,n as t,r as n,t as r}from"./fallback-core-BxY89vzU.js";import{t as i}from"./preload-helper-DYl5dUZ5.js";async function a({loadWebGPU:e=()=>i(()=>import(`./three.webgpu-Bxw5NSti.js`),__vite__mapDeps([0,1]),import.meta.url),forceWebGL:t=globalThis.__FALLBACK_FORCE_WEBGL_PROBE__===!0}={}){let n=null;try{let{WebGPURenderer:r,REVISION:i}=await e();n=new r({antialias:!1,forceWebGL:t}),await n.init();let a=n.backend.isWebGPUBackend===!0,o={tested:!0,webgpu:a,compatibilityMode:n.backend.compatibilityMode===!0,threeRevision:i,backendName:n.backend.constructor.name,forceWebGL:t};return a||(n.dispose(),n=null),{capabilities:o,renderer:n}}catch(e){return n?.dispose(),{capabilities:{tested:!1,webgpu:null,compatibilityMode:null,threeRevision:null,backendName:null,error:e instanceof Error?e.message:String(e)},renderer:null}}}var o=Object.freeze([`explicit-activation-gate`,`ordered-degradation-trace`,`bounded-water-loss-oracle`,`invariant-ledger`,`force-webgl-branch-isolation`,`maintenance-acceptance`]);function s({metadataId:e=null,search:t=``}={}){let n=new URLSearchParams(t).getAll(`mechanism`);if(n.length>1)throw RangeError(`Fallback mechanism route is duplicated.`);let r=n[0]??null;if(e!==null&&r!==null&&e!==r)throw RangeError(`Fallback mechanism route conflict: ${e} versus ${r}.`);let i=e??r;if(i===null)return null;if(!o.includes(i))throw RangeError(`Unknown fallback mechanism: ${i}`);return i}var c=new URL(``+new URL(`fallback-fixtures-C__puiF4.json`,import.meta.url).href,``+import.meta.url),l=new URL(`./scenario/`,``+import.meta.url),u=`browser-fallback-harness`;function d(){return document.querySelector(`meta[name="lab-scenario"]`)?.content??new URL(location.href).searchParams.get(`scenario`)??`blocked-default`}function f(){return s({metadataId:document.querySelector(`meta[name="lab-mechanism"]`)?.content??null,search:location.search})}function p(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#039;`})[e])}function m(e){return`${e.value} ${e.unit} [${e.label}]`}function h(e,n,r){let i=e.getContext(`2d`,{alpha:!1}),{width:a,height:o}=e,s=i.createImageData(a,o),c=.91;for(let e=0;e<o;e++)for(let i=0;i<a;i++){let l=-2+4*i/(a-1),u=-2+4*e/(o-1),d=t(`canonical-budget-reduction`,l,u,c),f=t(n,l,u,c),p=4*(i+e*a);if(r===`error`){let e=Math.min(1,Math.abs(f-d)/.32);s.data[p]=Math.round(255*e),s.data[p+1]=Math.round(75*(1-e)),s.data[p+2]=Math.round(210*(1-e))}else{let e=Math.max(0,Math.min(1,.5+(r===`reference`?d:f)/.55));s.data[p]=Math.round(15+45*e),s.data[p+1]=Math.round(50+145*e),s.data[p+2]=Math.round(95+150*e)}s.data[p+3]=255}i.putImageData(s,0,0)}var g=class{#e;#t;#n;#r=!1;#i=null;#a=null;#o=null;#s=null;#c=!1;constructor(e,t,n){this.#e=e,this.#t=t,this.#n=n}async ready(){if(this.#l(),this.#i===null){let e=await a();this.#i=e.capabilities,this.#a=e.renderer}await this.renderOnce()}async authorizeExplicitRequest(){this.#l(),this.#r=!0,await this.renderOnce()}async setScenario(e){this.#l(),n(this.#e,e),this.#t=e,this.#r=!1,await this.renderOnce()}async setMode(e){if(e!==`plan`)throw RangeError(`Unknown mode: ${e}`)}async setTier(e){throw RangeError(`Compatibility branches are not canonical quality tiers: ${e}`)}async setSeed(e){if(e!==0)throw RangeError(`Only deterministic seed 0 is supported, received ${e}`)}async setCamera(e){if(e!==`comparison`)throw RangeError(`Unknown camera: ${e}`)}async setTime(e){if(e!==.91)throw RangeError(`The fixture has one frozen comparison time: 0.91 seconds.`)}async step(e){if(e!==0)throw RangeError(`The fallback planner has no advancing history.`)}async resetHistory(){}async resize(){}async renderOnce(){this.#l(),this.#s?.dispose(),this.#s=null;let t=n(this.#e,this.#t),a=structuredClone(t);if(this.#r){if(this.#i?.tested!==!0){this.#o={status:`BLOCKED`,code:r.CAPABILITY,message:`The live backend could not be tested; compatibility remains inactive.`,details:{activated:!1,liveCapabilities:this.#i}},v(this,t,this.#o);return}a.actualCapabilities.webgpu=this.#i.webgpu}this.#o=e(a,{explicitRequest:this.#r}),v(this,t,this.#o);let o=this.#o.details?.branch;if(this.#o.details?.activated===!0&&o){_(o);let{createCompatibilityRepresentation:e}=await i(async()=>{let{createCompatibilityRepresentation:e}=await import(`./compatibility-renderer-CrxVRi9V.js`);return{createCompatibilityRepresentation:e}},__vite__mapDeps([2,3,1]),import.meta.url);this.#s=await e(document.querySelector(`#branch-runtime`),o,{explicitRequest:!0,testedUnavailable:this.#i.tested&&this.#i.webgpu===!1})}else this.#o.code===r.COMPARISON&&_(`maintained-legacy`)}async capturePixels(e){this.#l();let t=document.querySelector(`canvas[data-target="${CSS.escape(e)}"]`);if(!t)throw RangeError(`Unknown or unavailable capture target: ${e}`);return{target:e,width:t.width,height:t.height,pixels:t.getContext(`2d`).getImageData(0,0,t.width,t.height).data}}describePipeline(){return{owners:{canonical:`threejs-water-optics`,compatibility:`threejs-compatibility-fallbacks`},signals:[],sceneSubmissions:[],computeDispatches:[],resources:[],finalToneMapOwner:this.#o?.details?.activated?`compatibility-branch`:null,finalOutputTransformOwner:this.#o?.details?.activated?`compatibility-branch`:null}}describeResources(){return{branch:this.#o?.details?.branch??null,liveCompatibilityRenderer:this.#s!==null}}getMetrics(){return{labId:this.labId,scenarioId:this.#t,mechanismId:this.#n,explicitRequest:this.#r,liveCapabilities:this.#i,compatibilityRuntime:this.#s?{backend:this.#s.backend,isWebGPUBackend:this.#s.isWebGPUBackend}:null,result:this.#o}}async dispose(){this.#s?.dispose(),this.#s=null,this.#a?.dispose(),this.#a=null,this.#c=!0}get catalog(){return this.#e}get labId(){return u}get liveCapabilities(){return this.#i}get renderer(){return this.#a}get explicitRequest(){return this.#r}#l(){if(this.#c)throw Error(`FallbackLabController is disposed.`)}};function _(e){for(let[t,n]of[[`canonical-reference`,`reference`],[`selected-branch`,`selected`],[`error-map`,`error`]]){let r=document.querySelector(`canvas[data-target="${t}"]`);r&&h(r,e,n)}}function v(e,t,n){let r=e.catalog.scenarios.map(e=>`<option value="${p(e.id)}" ${e.id===t.id?`selected`:``}>${p(e.id)}</option>`).join(``),i=t.desiredBranch!==null&&t.desiredBranch!==`canonical-budget-reduction`&&e.explicitRequest!==!0,a=e.catalog.scenarios.map(e=>`<li><a href="${new URL(`${e.id}/`,l).href}">${p(e.id)}</a></li>`).join(``),o=t.invariants.map(e=>`<li><code>${p(e.domain)}</code> — ${p(e.status)}; ${p(e.diagnostic)}</li>`).join(``),s=t.decisionTrace.map(e=>`<li><code>${p(e.branch)}</code> · ${p(e.changedAxes[0])} · ${p(e.outcome)}<br><span class="muted">${p(e.reason)}</span></li>`).join(``),c=document.querySelector(`#app`);c.innerHTML=`
		<p class="eyebrow">Quarantined compatibility teaching · schema v2</p>
		<h1>Explicit-request-only fallback harness</h1>
		<p class="lede">The canonical owner remains <code>threejs-water-optics</code>. Native WebGPU quality scaling returns to that owner. This harness may construct a forceWebGL branch only after a tested unavailable-WebGPU condition and a direct user action.</p>
		<div class="warning"><strong>Compatibility is inactive by default.</strong> A route URL never authorizes a fallback. The button below is the explicit request signal.</div>
		<div class="toolbar">
			<label for="scenario">Scenario</label>
			<select id="scenario">${r}</select>
			<button id="authorize" ${i?``:`disabled`}>Explicitly request this fallback teaching</button>
			<span class="status ${n.status.toLowerCase()}">${p(n.status)} · ${p(n.code)}</span>
		</div>
		<section class="grid">
			<article class="card">
				<h2>Capability and activation</h2>
				<div class="metric-row"><span class="muted">Fixture WebGPU</span><code>${p(t.actualCapabilities.webgpu)}</code></div>
				<div class="metric-row"><span class="muted">Live probe tested</span><code>${p(e.liveCapabilities?.tested)}</code></div>
				<div class="metric-row"><span class="muted">Live WebGPU</span><code>${p(e.liveCapabilities?.webgpu)}</code></div>
				<div class="metric-row"><span class="muted">Explicit request</span><code>${p(e.explicitRequest)}</code></div>
				<div class="metric-row"><span class="muted">Branch activated</span><code>${p(n.details?.activated??!1)}</code></div>
			</article>
			<article class="card">
				<h2>Independent evidence domains</h2>
				<div class="metric-row"><span class="muted">Visible loss</span><code>${n.details?.visibleLoss?p(m(n.details.visibleLoss)):`not measured`}</code></div>
				<div class="metric-row"><span class="muted">CPU fixture timing</span><code>${n.details?.timing?p(m(n.details.timing)):`not measured`}</code></div>
				<div class="metric-row"><span class="muted">GPU timing</span><code>INSUFFICIENT_EVIDENCE_GPU_TIMING</code></div>
				<div class="metric-row"><span class="muted">Target frame</span><code>${p(m(t.budgetEvidence.targetFrameMs))}</code></div>
			</article>
			<article class="card">
				<h2>Ordered decision trace</h2>
				<ol>${s||`<li>No compatibility decision is authorized.</li>`}</ol>
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
				<h2>Machine result</h2><pre>${p(JSON.stringify(n,null,2))}</pre>
			</article>
		</section>`,c.querySelector(`#scenario`).addEventListener(`change`,t=>e.setScenario(t.target.value)),c.querySelector(`#authorize`).addEventListener(`click`,()=>e.authorizeExplicitRequest())}var y=new g(await(await fetch(c)).json(),d(),f());window.labController=y,await y.ready();