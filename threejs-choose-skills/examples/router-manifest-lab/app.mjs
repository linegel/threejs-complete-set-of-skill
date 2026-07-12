import { evaluateScenario, getScenario } from './router-core.mjs';
import { scenarioHref } from './route-urls.mjs';
import { runnableDemosForFixture } from './runnable-demos.mjs';

const catalogUrl = new URL( './router-fixtures.json', import.meta.url );

function readFixedScenario() {

	const meta = document.querySelector( 'meta[name="lab-scenario"]' );
	if ( meta?.content ) return meta.content;
	return new URL( location.href ).searchParams.get( 'scenario' ) ?? 'ocean-planet';

}

function escapeHtml( value ) {

	return String( value ).replace( /[&<>"']/g, ( character ) => ( {
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
	} )[ character ] );

}

function evidenceValue( record ) {

	return `${ record.value } ${ record.unit } [${ record.label }]`;

}

export class RouterLabController {

	#catalog;
	#scenarioId;
	#result = null;
	#disposed = false;

	constructor( catalog, scenarioId ) {

		this.#catalog = catalog;
		this.#scenarioId = scenarioId;

	}

	async ready() { this.#assertLive(); await this.renderOnce(); }
	async setScenario( id ) { this.#assertLive(); getScenario( this.#catalog, id ); this.#scenarioId = id; await this.renderOnce(); }
	async setMode( id ) { if ( id !== 'route' ) throw new RangeError( `Unknown mode: ${ id }` ); }
	async setTier( id ) { throw new RangeError( `Routing scenarios do not define GPU quality tiers: ${ id }` ); }
	async setSeed( seed ) { if ( seed !== 0 ) throw new RangeError( `Routing is deterministic and accepts only seed 0, received ${ seed }` ); }
	async setCamera( id ) { if ( id !== 'manifest' ) throw new RangeError( `Unknown camera: ${ id }` ); }
	async setTime( seconds ) { if ( seconds !== 0 ) throw new RangeError( 'Routing scenarios have no temporal state.' ); }
	async step( deltaSeconds ) { if ( deltaSeconds !== 0 ) throw new RangeError( 'Routing scenarios cannot be stepped.' ); }
	async resetHistory() {}
	async resize() {}

	async renderOnce() {

		this.#assertLive();
		const fixture = getScenario( this.#catalog, this.#scenarioId );
		this.#result = evaluateScenario( this.#catalog, this.#scenarioId );
		renderApp( this, fixture, this.#result );

	}

	async capturePixels() { throw new Error( 'capturePixels is not applicable to this non-rendering routing suite.' ); }

	describePipeline() {

		this.#assertLive();
		const fixture = getScenario( this.#catalog, this.#scenarioId );
		return {
			owners: Object.fromEntries( fixture.ownershipClaims.map( ( claim ) => [ claim.semantic, claim.owner ] ) ),
			signals: fixture.requiredSignals,
			sceneSubmissions: [],
			computeDispatches: [],
			resources: [],
			finalToneMapOwner: fixture.ownershipClaims.find( ( claim ) => claim.semantic === 'tone-map' )?.owner ?? null,
			finalOutputTransformOwner: fixture.ownershipClaims.find( ( claim ) => claim.semantic === 'output-transform' )?.owner ?? null
		};

	}

	describeResources() { this.#assertLive(); return { resources: [], reason: 'non-rendering scenario suite' }; }
	getMetrics() { this.#assertLive(); return { scenarioId: this.#scenarioId, result: this.#result }; }
	async dispose() { this.#disposed = true; }

	#assertLive() {

		if ( this.#disposed ) throw new Error( 'RouterLabController is disposed.' );

	}

}

function renderApp( controller, fixture, result ) {

	const app = document.querySelector( '#app' );
	const catalog = controller._catalogForRender ?? null;
	const routes = catalog?.routes ?? window.__routerCatalog.routes;
	const stageTotal = fixture.performance.stages.reduce( ( sum, stage ) => sum + stage.budgetMs.value, 0 );
	const runnableDemos = runnableDemosForFixture( fixture );
	const routeResults = new Map( routes.map( ( route ) => [ route.id, evaluateScenario( window.__routerCatalog, route.id ) ] ) );
	const options = routes.map( ( route ) => {

		const routeResult = routeResults.get( route.id );
		return `<option value="${ escapeHtml( route.id ) }" ${ route.id === fixture.id ? 'selected' : '' }>${ escapeHtml( route.id ) } — ${ escapeHtml( routeResult.verdict ) }</option>`;

	} ).join( '' );
	const routeLinks = routes.map( ( route ) => {

		const routeResult = routeResults.get( route.id );
		const verdictClass = routeResult.verdict.toLowerCase();
		return `<li><a href="${ scenarioHref( route.id, location.href ) }"><span>${ escapeHtml( route.id ) }</span><span class="route-verdict ${ verdictClass }">${ escapeHtml( routeResult.verdict ) }</span></a></li>`;

	} ).join( '' );

	app.innerHTML = `
		<p class="eyebrow">Routing contract tests · no 3D rendering</p>
		<h1>WebGPU skill-routing lab</h1>
		<p class="lede">This is a decision test bench, not a gallery of rendered scenes. Each scenario asks which Three.js skills should own a workload, then checks that plan against capability, ownership, ordering, provenance, inventory, and frame-budget rules.</p>
		<aside class="explainer" aria-label="How to read this lab">
			<div><strong>Choose a fixture</strong><span>Each name represents a routing decision, including deliberately invalid ones.</span></div>
			<div><strong>Read the verdict</strong><span><code>PASS</code> is an accepted plan. <code>FAIL</code> is an intentional guardrail test, not a crashed demo.</span></div>
			<div><strong>Share the state</strong><span>Scenario permalinks reopen this lab locked to the same fixture.</span></div>
		</aside>
		<div class="toolbar">
			<label for="scenario">Scenario</label>
			<select id="scenario">${ options }</select>
			<span class="status ${ result.verdict.toLowerCase() }">${ escapeHtml( result.verdict ) } · ${ escapeHtml( result.code ) }</span>
		</div>
		<section class="demo-launcher" aria-labelledby="demo-launcher-title">
			<div class="demo-launcher-copy">
				<p class="demo-launcher-kicker">Loadable WebGPU implementation</p>
				<h2 id="demo-launcher-title">Open the primary owner’s canonical lab</h2>
				<p>This page validates the routing decision; it does not render the workload. The primary action opens the closest loadable implementation owned by <code>${ escapeHtml( fixture.route.primaryOwner ) }</code>. Its page exposes the current evidence status and remaining-fixes roadmap; loadable does not mean performance-accepted.</p>
			</div>
			<a class="run-demo-button" data-testid="run-primary-demo" href="${ escapeHtml( runnableDemos.primary.href ) }" target="_top" aria-label="Run ${ escapeHtml( runnableDemos.primary.title ) }">
				<span>Run demo</span>
				<strong>${ escapeHtml( runnableDemos.primary.title ) }</strong>
				<span aria-hidden="true">↗</span>
			</a>
			${ runnableDemos.supporting.length > 0 ? `<nav class="supporting-demos" aria-label="Supporting system demos">
				<span>Supporting systems</span>
				${ runnableDemos.supporting.map( ( demo ) => `<a href="${ escapeHtml( demo.href ) }" target="_top">${ escapeHtml( demo.title ) }<span aria-hidden="true">↗</span></a>` ).join( '' ) }
			</nav>` : '' }
		</section>
		<section class="grid">
			<article class="card">
				<h2>Selected skill plan</h2>
				<div class="metric-row"><span class="muted">Primary owner</span><code>${ escapeHtml( fixture.route.primaryOwner ) }</code></div>
				<div class="metric-row"><span class="muted">Native WebGPU observed</span><code>${ escapeHtml( fixture.observedCapabilities.webgpu ) }</code></div>
				<div class="metric-row"><span class="muted">Selected skill count</span><code>${ fixture.route.selectedSkills.length }</code></div>
				<ul>${ fixture.route.selectedSkills.map( ( skill ) => `<li><code>${ escapeHtml( skill ) }</code></li>` ).join( '' ) }</ul>
			</article>
			<article class="card">
				<h2>Budget derivation</h2>
				<div class="metric-row"><span class="muted">targetFrameMs</span><code>${ escapeHtml( evidenceValue( fixture.performance.targetFrameMs ) ) }</code></div>
				${ fixture.performance.stages.map( ( stage ) => `<div class="metric-row"><span class="muted">${ escapeHtml( stage.id ) }</span><code>${ escapeHtml( evidenceValue( stage.budgetMs ) ) }</code></div>` ).join( '' ) }
				<div class="metric-row"><span class="muted">Stage sum</span><code>${ stageTotal.toFixed( 2 ) } ms [Derived]</code></div>
			</article>
			<article class="card">
				<h2>Signals and exclusive owners</h2>
				<ul>${ fixture.requiredSignals.map( ( signal ) => `<li><code>${ escapeHtml( signal.id ) }</code>: ${ escapeHtml( signal.producer ) } → ${ escapeHtml( signal.consumers.join( ', ' ) ) }</li>` ).join( '' ) }</ul>
				<ul>${ fixture.ownershipClaims.map( ( claim ) => `<li><code>${ escapeHtml( claim.semantic ) }</code>: ${ escapeHtml( claim.owner ) }</li>` ).join( '' ) }</ul>
			</article>
			<article class="card wide">
				<h2>Scenario permalinks</h2>
				<p class="card-note">These are stable views of this same contract lab; they are not separate graphical demos.</p>
				<ul class="route-links">${ routeLinks }</ul>
			</article>
			<article class="card wide">
				<h2>Machine-readable verdict</h2>
				<pre>${ escapeHtml( JSON.stringify( result, null, 2 ) ) }</pre>
			</article>
		</section>`;

	app.querySelector( '#scenario' ).addEventListener( 'change', async ( event ) => {

		await controller.setScenario( event.target.value );

	} );

}

async function createController() {

	const catalog = await ( await fetch( catalogUrl ) ).json();
	window.__routerCatalog = catalog;
	const controller = new RouterLabController( catalog, readFixedScenario() );
	await controller.ready();
	return controller;

}

const controllerPromise = createController();
window.labController = controllerPromise;
const controller = await controllerPromise;
window.labController = controller;
