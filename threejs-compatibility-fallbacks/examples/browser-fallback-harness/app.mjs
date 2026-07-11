import {
	FALLBACK_REASON,
	evaluateBoundedWaterSample,
	getFallbackScenario,
	planFallback
} from './fallback-core.mjs';
import { probeCanonicalBackend } from './backend-probe.mjs';

const fixtureUrl = new URL( './fallback-fixtures.json', import.meta.url );
const scenarioBaseUrl = new URL( './scenario/', import.meta.url );

function fixedScenarioId() {

	return document.querySelector( 'meta[name="lab-scenario"]' )?.content
		?? new URL( location.href ).searchParams.get( 'scenario' )
		?? 'blocked-default';

}

function escapeHtml( value ) {

	return String( value ).replace( /[&<>"']/g, ( character ) => ( {
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
	} )[ character ] );

}

function evidenceText( evidence ) {

	return `${ evidence.value } ${ evidence.unit } [${ evidence.label }]`;

}

function drawDiagnostic( canvas, branch, mode ) {

	const context = canvas.getContext( '2d', { alpha: false } );
	const { width, height } = canvas;
	const image = context.createImageData( width, height );
	const time = 0.91;
	for ( let y = 0; y < height; y ++ ) {

		for ( let x = 0; x < width; x ++ ) {

			const worldX = - 2 + 4 * x / ( width - 1 );
			const worldZ = - 2 + 4 * y / ( height - 1 );
			const reference = evaluateBoundedWaterSample( 'canonical-budget-reduction', worldX, worldZ, time );
			const selected = evaluateBoundedWaterSample( branch, worldX, worldZ, time );
			const offset = 4 * ( x + y * width );
			if ( mode === 'error' ) {

				const error = Math.min( 1, Math.abs( selected - reference ) / 0.32 );
				image.data[ offset ] = Math.round( 255 * error );
				image.data[ offset + 1 ] = Math.round( 75 * ( 1 - error ) );
				image.data[ offset + 2 ] = Math.round( 210 * ( 1 - error ) );

			} else {

				const value = mode === 'reference' ? reference : selected;
				const normalized = Math.max( 0, Math.min( 1, 0.5 + value / 0.55 ) );
				image.data[ offset ] = Math.round( 15 + 45 * normalized );
				image.data[ offset + 1 ] = Math.round( 50 + 145 * normalized );
				image.data[ offset + 2 ] = Math.round( 95 + 150 * normalized );

			}
			image.data[ offset + 3 ] = 255;

		}

	}
	context.putImageData( image, 0, 0 );

}

export class FallbackLabController {

	#catalog;
	#scenarioId;
	#explicitRequest = false;
	#liveCapabilities = null;
	#result = null;
	#runtime = null;
	#disposed = false;

	constructor( catalog, scenarioId ) {

		this.#catalog = catalog;
		this.#scenarioId = scenarioId;

	}

	async ready() {

		this.#assertLive();
		this.#liveCapabilities = await probeCanonicalBackend();
		await this.renderOnce();

	}

	async authorizeExplicitRequest() {

		this.#assertLive();
		this.#explicitRequest = true;
		await this.renderOnce();

	}

	async setScenario( id ) {

		this.#assertLive();
		getFallbackScenario( this.#catalog, id );
		this.#scenarioId = id;
		this.#explicitRequest = false;
		await this.renderOnce();

	}

	async setMode( id ) { if ( id !== 'plan' ) throw new RangeError( `Unknown mode: ${ id }` ); }
	async setTier( id ) { throw new RangeError( `Compatibility branches are not canonical quality tiers: ${ id }` ); }
	async setSeed( seed ) { if ( seed !== 0 ) throw new RangeError( `Only deterministic seed 0 is supported, received ${ seed }` ); }
	async setCamera( id ) { if ( id !== 'comparison' ) throw new RangeError( `Unknown camera: ${ id }` ); }
	async setTime( seconds ) { if ( seconds !== 0.91 ) throw new RangeError( 'The fixture has one frozen comparison time: 0.91 seconds.' ); }
	async step( deltaSeconds ) { if ( deltaSeconds !== 0 ) throw new RangeError( 'The fallback planner has no advancing history.' ); }
	async resetHistory() {}
	async resize() {}

	async renderOnce() {

		this.#assertLive();
		this.#runtime?.dispose();
		this.#runtime = null;
		const scenario = getFallbackScenario( this.#catalog, this.#scenarioId );
		const evaluatedScenario = structuredClone( scenario );

		if ( this.#explicitRequest ) {

			if ( this.#liveCapabilities?.tested !== true ) {

				this.#result = {
					status: 'BLOCKED',
					code: FALLBACK_REASON.CAPABILITY,
					message: 'The live backend could not be tested; compatibility remains inactive.',
					details: { activated: false, liveCapabilities: this.#liveCapabilities }
				};
				renderApp( this, scenario, this.#result );
				return;

			}
			evaluatedScenario.actualCapabilities.webgpu = this.#liveCapabilities.webgpu;

		}

		this.#result = planFallback( evaluatedScenario, { explicitRequest: this.#explicitRequest } );
		renderApp( this, scenario, this.#result );

		const branch = this.#result.details?.branch;
		if ( this.#result.details?.activated === true && branch ) {

			drawEvidenceCanvases( branch );
			const { createCompatibilityRepresentation } = await import( './compatibility-renderer.mjs' );
			this.#runtime = await createCompatibilityRepresentation(
				document.querySelector( '#branch-runtime' ),
				branch,
				{ explicitRequest: true, testedUnavailable: this.#liveCapabilities.tested && this.#liveCapabilities.webgpu === false }
			);

		} else if ( this.#result.code === FALLBACK_REASON.COMPARISON ) {

			drawEvidenceCanvases( 'maintained-legacy' );

		}

	}

	async capturePixels( target ) {

		this.#assertLive();
		const canvas = document.querySelector( `canvas[data-target="${ CSS.escape( target ) }"]` );
		if ( ! canvas ) throw new RangeError( `Unknown or unavailable capture target: ${ target }` );
		return {
			target,
			width: canvas.width,
			height: canvas.height,
			pixels: canvas.getContext( '2d' ).getImageData( 0, 0, canvas.width, canvas.height ).data
		};

	}

	describePipeline() {

		return {
			owners: { canonical: 'threejs-water-optics', compatibility: 'threejs-compatibility-fallbacks' },
			signals: [], sceneSubmissions: [], computeDispatches: [], resources: [],
			finalToneMapOwner: this.#result?.details?.activated ? 'compatibility-branch' : null,
			finalOutputTransformOwner: this.#result?.details?.activated ? 'compatibility-branch' : null
		};

	}

	describeResources() { return { branch: this.#result?.details?.branch ?? null, liveCompatibilityRenderer: this.#runtime !== null }; }
	getMetrics() {

		return {
			scenarioId: this.#scenarioId,
			explicitRequest: this.#explicitRequest,
			liveCapabilities: this.#liveCapabilities,
			compatibilityRuntime: this.#runtime ? {
				backend: this.#runtime.backend,
				isWebGPUBackend: this.#runtime.isWebGPUBackend
			} : null,
			result: this.#result
		};

	}

	async dispose() {

		this.#runtime?.dispose();
		this.#runtime = null;
		this.#disposed = true;

	}

	get catalog() { return this.#catalog; }
	get liveCapabilities() { return this.#liveCapabilities; }
	get explicitRequest() { return this.#explicitRequest; }

	#assertLive() { if ( this.#disposed ) throw new Error( 'FallbackLabController is disposed.' ); }

}

function drawEvidenceCanvases( branch ) {

	const entries = [
		[ 'canonical-reference', 'reference' ],
		[ 'selected-branch', 'selected' ],
		[ 'error-map', 'error' ]
	];
	for ( const [ target, mode ] of entries ) {

		const canvas = document.querySelector( `canvas[data-target="${ target }"]` );
		if ( canvas ) drawDiagnostic( canvas, branch, mode );

	}

}

function renderApp( controller, scenario, result ) {

	const options = controller.catalog.scenarios.map( ( candidate ) => `<option value="${ escapeHtml( candidate.id ) }" ${ candidate.id === scenario.id ? 'selected' : '' }>${ escapeHtml( candidate.id ) }</option>` ).join( '' );
	const canAuthorize = scenario.desiredBranch !== null && scenario.desiredBranch !== 'canonical-budget-reduction' && controller.explicitRequest !== true;
	const routeLinks = controller.catalog.scenarios.map( ( candidate ) => `<li><a href="${ new URL( `${ candidate.id }/`, scenarioBaseUrl ).href }">${ escapeHtml( candidate.id ) }</a></li>` ).join( '' );
	const invariantRows = scenario.invariants.map( ( invariant ) => `<li><code>${ escapeHtml( invariant.domain ) }</code> — ${ escapeHtml( invariant.status )}; ${ escapeHtml( invariant.diagnostic ) }</li>` ).join( '' );
	const traceRows = scenario.decisionTrace.map( ( step ) => `<li><code>${ escapeHtml( step.branch ) }</code> · ${ escapeHtml( step.changedAxes[ 0 ] ) } · ${ escapeHtml( step.outcome )}<br><span class="muted">${ escapeHtml( step.reason ) }</span></li>` ).join( '' );
	const app = document.querySelector( '#app' );

	app.innerHTML = `
		<p class="eyebrow">Quarantined compatibility teaching · schema v2</p>
		<h1>Explicit-request-only fallback harness</h1>
		<p class="lede">The canonical owner remains <code>threejs-water-optics</code>. Native WebGPU quality scaling returns to that owner. This harness may construct a forceWebGL branch only after a tested unavailable-WebGPU condition and a direct user action.</p>
		<div class="warning"><strong>Compatibility is inactive by default.</strong> A route URL never authorizes a fallback. The button below is the explicit request signal.</div>
		<div class="toolbar">
			<label for="scenario">Scenario</label>
			<select id="scenario">${ options }</select>
			<button id="authorize" ${ canAuthorize ? '' : 'disabled' }>Explicitly request this fallback teaching</button>
			<span class="status ${ result.status.toLowerCase() }">${ escapeHtml( result.status ) } · ${ escapeHtml( result.code ) }</span>
		</div>
		<section class="grid">
			<article class="card">
				<h2>Capability and activation</h2>
				<div class="metric-row"><span class="muted">Fixture WebGPU</span><code>${ escapeHtml( scenario.actualCapabilities.webgpu ) }</code></div>
				<div class="metric-row"><span class="muted">Live probe tested</span><code>${ escapeHtml( controller.liveCapabilities?.tested ) }</code></div>
				<div class="metric-row"><span class="muted">Live WebGPU</span><code>${ escapeHtml( controller.liveCapabilities?.webgpu ) }</code></div>
				<div class="metric-row"><span class="muted">Explicit request</span><code>${ escapeHtml( controller.explicitRequest ) }</code></div>
				<div class="metric-row"><span class="muted">Branch activated</span><code>${ escapeHtml( result.details?.activated ?? false ) }</code></div>
			</article>
			<article class="card">
				<h2>Independent evidence domains</h2>
				<div class="metric-row"><span class="muted">Visible loss</span><code>${ result.details?.visibleLoss ? escapeHtml( evidenceText( result.details.visibleLoss ) ) : 'not measured' }</code></div>
				<div class="metric-row"><span class="muted">CPU fixture timing</span><code>${ result.details?.timing ? escapeHtml( evidenceText( result.details.timing ) ) : 'not measured' }</code></div>
				<div class="metric-row"><span class="muted">GPU timing</span><code>INSUFFICIENT_EVIDENCE_GPU_TIMING</code></div>
				<div class="metric-row"><span class="muted">Target frame</span><code>${ escapeHtml( evidenceText( scenario.budgetEvidence.targetFrameMs ) ) }</code></div>
			</article>
			<article class="card">
				<h2>Ordered decision trace</h2>
				<ol>${ traceRows || '<li>No compatibility decision is authorized.</li>' }</ol>
			</article>
			<article class="card">
				<h2>Invariant ledger</h2>
				<ul>${ invariantRows || '<li>Canonical blocker only; no loss ledger applies.</li>' }</ul>
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
				<h2>Standalone routes</h2><ul>${ routeLinks }</ul>
			</article>
			<article class="card">
				<h2>Machine result</h2><pre>${ escapeHtml( JSON.stringify( result, null, 2 ) ) }</pre>
			</article>
		</section>`;

	app.querySelector( '#scenario' ).addEventListener( 'change', ( event ) => controller.setScenario( event.target.value ) );
	app.querySelector( '#authorize' ).addEventListener( 'click', () => controller.authorizeExplicitRequest() );

}

const catalog = await ( await fetch( fixtureUrl ) ).json();
const controller = new FallbackLabController( catalog, fixedScenarioId() );
window.labController = controller;
await controller.ready();
