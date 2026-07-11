import { createNodeSelectiveBloomExample } from './index.js';
import { resolveBloomRoute } from './routes.js';

const canvas = document.querySelector( '#lab-canvas' );
const status = document.querySelector( '#lab-status' );
const route = resolveBloomRoute( location.pathname, location.search );
const automatedCapture = new URLSearchParams( location.search ).get( 'capture' ) === '1';
let controller;
let requestId = 0;
let previous = 0;

function viewport() {

	return { width: Math.max( 1, Math.round( innerWidth ) ), height: Math.max( 1, Math.round( innerHeight ) ), pixelRatio: devicePixelRatio || 1 };

}

function updateStatus() {

	const metrics = controller.getMetrics();
	const graph = controller.describePipeline();
	status.textContent = [
		'native WebGPU selective BloomNode lab',
		`backend: ${ metrics.backend } / Three ${ metrics.threeRevision }`,
		`scenario: ${ metrics.scenario }`,
		`mechanism route: ${ metrics.mechanism ?? 'none' }`,
		`mode: ${ metrics.mode }`,
		`tier: ${ metrics.tier }`,
		`production MRT: ${ graph.productionMRT.join( ' + ' ) }`,
		`validation-only MRT: ${ graph.validationOnlyMRT.join( ' + ' ) || 'none' }`,
		`GPU timing: ${ metrics.gpuTiming.verdict }`
	].join( '\n' );

}

async function animate( milliseconds ) {

	const seconds = milliseconds * 0.001;
	const delta = previous === 0 ? 0 : Math.min( 0.1, seconds - previous );
	previous = seconds;
	await controller.step( delta );
	await controller.renderOnce();
	if ( automatedCapture !== true ) requestId = requestAnimationFrame( animate );

}

try {

	if ( navigator.gpu === undefined ) throw new Error( 'WebGPU is unavailable. Canonical bloom does not activate a fallback.' );
	controller = await createNodeSelectiveBloomExample( {
		canvas,
		...viewport(),
		quality: route.tier,
		scenario: route.scenario,
		debugMode: route.mode,
		seed: route.seed,
		validationDiagnostics: route.validationDiagnostics
	} );
	await controller.setCamera( route.camera );
	await controller.setTime( route.time );
	window.__LAB_CONTROLLER__ = controller;
	window.__LAB_READY__ = controller.ready();
	updateStatus();
	if ( automatedCapture !== true ) requestId = requestAnimationFrame( animate );
	addEventListener( 'resize', async () => {

		await controller.resize( ...Object.values( viewport() ) );
		updateStatus();

	} );
	addEventListener( 'pagehide', () => {

		cancelAnimationFrame( requestId );
		controller.dispose();

	}, { once: true } );

} catch ( error ) {

	status.classList.add( 'error' );
	status.textContent = `BLOCKED\n${ error.stack ?? error.message }`;
	window.__LAB_ERROR__ = String( error.stack ?? error.message );
	throw error;

}
