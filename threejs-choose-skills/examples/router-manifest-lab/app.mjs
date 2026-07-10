import { evaluateScenario, getScenario } from './router-core.mjs';

const catalogUrl = new URL( './router-fixtures.json', import.meta.url );
const scenarioBaseUrl = new URL( './scenario/', import.meta.url );

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
	const options = routes.map( ( route ) => `<option value="${ escapeHtml( route.id ) }" ${ route.id === fixture.id ? 'selected' : '' }>${ escapeHtml( route.id ) }</option>` ).join( '' );
	const routeLinks = routes.map( ( route ) => `<li><a href="${ new URL( `${ route.id }/`, scenarioBaseUrl ).href }">${ escapeHtml( route.id ) }</a></li>` ).join( '' );

	app.innerHTML = `
		<p class="eyebrow">Canonical non-rendering scenario suite · schema v2</p>
		<h1>WebGPU route manifest lab</h1>
		<p class="lede">The UI and contract tests consume the same fixture file. The router rejects capability, ownership, inventory, ordering, provenance, and budget violations with stable machine-readable reasons.</p>
		<div class="toolbar">
			<label for="scenario">Scenario</label>
			<select id="scenario">${ options }</select>
			<span class="status ${ result.verdict.toLowerCase() }">${ escapeHtml( result.verdict ) } · ${ escapeHtml( result.code ) }</span>
		</div>
		<section class="grid">
			<article class="card">
				<h2>Route</h2>
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
			<article class="card">
				<h2>Fixed route URLs</h2>
				<ul>${ routeLinks }</ul>
			</article>
			<article class="card wide">
				<h2>Machine result</h2>
				<pre>${ escapeHtml( JSON.stringify( result, null, 2 ) ) }</pre>
			</article>
		</section>`;

	app.querySelector( '#scenario' ).addEventListener( 'change', async ( event ) => {

		await controller.setScenario( event.target.value );

	} );

}

const catalog = await ( await fetch( catalogUrl ) ).json();
window.__routerCatalog = catalog;
const controller = new RouterLabController( catalog, readFixedScenario() );
window.labController = controller;
await controller.ready();
