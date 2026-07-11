import { createImagePipelineAOIntegration } from './main.js';

const canvas = document.querySelector( '#lab-canvas' );
const status = document.querySelector( '#lab-status' );
const parts = location.pathname.split( '/' ).filter( Boolean );
const tierIndex = parts.lastIndexOf( 'tier' );
const mechanismIndex = parts.lastIndexOf( 'mechanism' );
const tier = tierIndex >= 0 ? parts[ tierIndex + 1 ] : 'ultra';
const mechanism = mechanismIndex >= 0 ? parts[ mechanismIndex + 1 ] : null;
const mechanismModes = Object.freeze( {
	'shared-gbuffer': 'normal',
	'indirect-only-application': 'indirect-visibility',
	'owner-graph': 'owner-graph'
} );
if ( mechanism !== null && mechanismModes[ mechanism ] === undefined ) throw new Error( `Unknown AO integration mechanism route: ${ mechanism }` );
const automatedCapture = new URLSearchParams( location.search ).get( 'capture' ) === '1';

let controller;
let animationId = 0;
let previousTime = 0;

function extent() {

	return { width: Math.max( 1, Math.round( innerWidth ) ), height: Math.max( 1, Math.round( innerHeight ) ), dpr: Math.min( devicePixelRatio || 1, 2 ) };

}

function updateStatus() {

	const metrics = controller.getMetrics();
	const graph = controller.describePipeline();
	status.textContent = [
		'image-pipeline + material-context AO integration',
		`backend: ${ metrics.backend } / Three ${ metrics.threeRevision }`,
		`tier: ${ metrics.tier } | mode: ${ metrics.mode }`,
		`scene submissions: ${ graph.sceneSubmissions.length }`,
		`prepass owner: ${ graph.owners.primaryScenePass }`,
		`lit pass owner: ${ graph.owners.litScenePass }`,
		`tone/output: ${ graph.finalToneMapOwner }`,
		`GPU timing: ${ metrics.gpuTiming.verdict }`
	].join( '\n' );

}

async function animate( milliseconds ) {

	const seconds = milliseconds * 0.001;
	const delta = previousTime === 0 ? 0 : Math.min( 0.1, seconds - previousTime );
	previousTime = seconds;
	await controller.step( delta );
	await controller.renderOnce();
	animationId = requestAnimationFrame( animate );

}

try {

	if ( navigator.gpu === undefined ) throw new Error( 'WebGPU unavailable. Integration remains blocked; no fallback is activated.' );
	controller = await createImagePipelineAOIntegration( { canvas, ...extent(), tier, mode: mechanism === null ? 'final' : mechanismModes[ mechanism ] } );
	window.__LAB_CONTROLLER__ = controller;
	window.__LAB_READY__ = controller.ready();
	updateStatus();
	if ( automatedCapture !== true ) animationId = requestAnimationFrame( animate );
	addEventListener( 'resize', async () => {

		const next = extent();
		await controller.resize( next.width, next.height, next.dpr );
		updateStatus();

	} );
	addEventListener( 'pagehide', () => {

		cancelAnimationFrame( animationId );
		controller.dispose();

	}, { once: true } );

} catch ( error ) {

	status.classList.add( 'error' );
	status.textContent = `BLOCKED\n${ error.stack ?? error.message }`;
	window.__LAB_ERROR__ = String( error.stack ?? error.message );
	throw error;

}
