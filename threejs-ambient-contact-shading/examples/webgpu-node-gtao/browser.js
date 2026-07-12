import { createWebGPUNodeGTAO } from './main.js';
import { resolveAORoute } from './routes.js';

const canvas = document.querySelector( '#lab-canvas' );
const status = document.querySelector( '#lab-status' );
const route = resolveAORoute( location.pathname, location.search );
const automatedCapture = new URLSearchParams( location.search ).get( 'capture' ) === '1';

let controller;
let animationFrame = 0;
let previousTime = 0;

function physicalSize() {

	return {
		width: Math.max( 1, Math.round( innerWidth ) ),
		height: Math.max( 1, Math.round( innerHeight ) ),
		dpr: Math.min( devicePixelRatio || 1, 2 )
	};

}

function updateStatus() {

	const metrics = controller.getMetrics();
	const graph = controller.describePipeline();
	status.textContent = [
		'native WebGPU GTAO canonical lab',
		`backend: ${ metrics.backend } / Three ${ metrics.threeRevision }`,
		`scenario: ${ metrics.scenario }`,
		`mechanism route: ${ metrics.mechanism ?? 'none' }`,
		`mode: ${ metrics.mode }`,
		`tier: ${ metrics.tier }`,
		`scene submissions: ${ graph.sceneSubmissionCount } (prepass ${ graph.gbufferPrepassCount}, lit ${ graph.litScenePassCount })`,
		'GPU acceptance: incomplete until capture + timing run on an authorized adapter'
	].join( '\n' );

}

async function frame( milliseconds ) {

	const seconds = milliseconds * 0.001;
	const delta = previousTime === 0 ? 0 : Math.min( 0.1, seconds - previousTime );
	previousTime = seconds;
	await controller.step( delta );
	await controller.renderOnce();
	if ( automatedCapture !== true ) animationFrame = requestAnimationFrame( frame );

}

try {

	if ( navigator.gpu === undefined ) throw new Error( 'WebGPU is unavailable. Canonical GTAO does not activate a fallback.' );
	const size = physicalSize();
	controller = await createWebGPUNodeGTAO( {
		canvas,
		...size,
		tier: route.tier,
		scenario: route.scenario,
		mode: route.mode,
		seed: route.seed
	} );
	await controller.setCamera( route.camera );
	await controller.setTime( route.time );
	window.labController = controller;
	window.__LAB_CONTROLLER__ = controller;
	window.__LAB_READY__ = controller.ready();
	updateStatus();
	if ( automatedCapture !== true ) animationFrame = requestAnimationFrame( frame );

	addEventListener( 'resize', async () => {

		const next = physicalSize();
		await controller.resize( next.width, next.height, next.dpr );
		updateStatus();

	} );

	addEventListener( 'pagehide', () => {

		cancelAnimationFrame( animationFrame );
		controller.dispose();

	}, { once: true } );

} catch ( error ) {

	status.classList.add( 'error' );
	status.textContent = `BLOCKED\n${ error.stack ?? error.message }`;
	window.__LAB_ERROR__ = String( error.stack ?? error.message );
	throw error;

}
