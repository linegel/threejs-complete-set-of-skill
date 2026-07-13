import { NoColorSpace, RenderTarget, UnsignedByteType, Vector3 } from 'three/webgpu';

import {
	IMAGE_PIPELINE_MECHANISM_ROUTES,
	IMAGE_PIPELINE_TIERS,
	createCanonicalImagePipeline,
	resolveImagePipelineRoute
} from './canonical-main.js';
import { resolveImagePipelineLabId } from './lab-identity.js';

const LAB_ID = resolveImagePipelineLabId( globalThis.__IMAGE_PIPELINE_LAB_ID__ );

const canvas = document.querySelector( '#view' );
const status = document.querySelector( '#status' );
let resolvePublishedController;
const publishedController = new Promise( ( resolve ) => { resolvePublishedController = resolve; } );
window.labController = publishedController;
window.__LAB_CONTROLLER__ = publishedController;
const CAMERA_BOOKMARKS = Object.freeze( {
	near: [ 0, 1.1, 3.5 ],
	design: [ 0, 1.3, 5.5 ],
	far: [ 0, 1.7, 8.2 ]
} );

function startupRoute() {

	const url = new URL( location.href );
	const locked = globalThis.__LAB_LOCKED_ROUTE__ ?? null;
	const segments = url.pathname.split( '/' ).filter( Boolean );
	const mechanismIndex = segments.lastIndexOf( 'mechanism' );
	const tierIndex = segments.lastIndexOf( 'tier' );
	const mechanism = url.searchParams.get( 'mechanism' ) ?? ( mechanismIndex >= 0 ? segments[ mechanismIndex + 1 ] : null );
	if ( locked ) {

		const requested = {
			mechanism: url.searchParams.get( 'mechanism' ),
			tierId: url.searchParams.get( 'tier' ),
			mode: url.searchParams.get( 'mode' )
		};
		for ( const [ key, value ] of Object.entries( requested ) ) {

			if ( value !== null && value !== locked[ key ] ) throw new Error( `Locked image-pipeline route rejects ${ key } override "${ value }".` );

		}
		if ( locked.mechanism ) {

			const expected = resolveImagePipelineRoute( locked.mechanism );
			if ( expected.tier !== locked.tierId || expected.mode !== locked.mode ) throw new Error( `Locked image-pipeline route "${ locked.mechanism }" has inconsistent startup state.` );

		}
		if ( ! IMAGE_PIPELINE_TIERS[ locked.tierId ] ) throw new Error( `Unknown locked image-pipeline tier "${ locked.tierId }".` );
		return Object.freeze( { ...locked } );

	}
	const route = mechanism ? resolveImagePipelineRoute( mechanism ) : null;
	const tierId = url.searchParams.get( 'tier' ) ?? ( tierIndex >= 0 ? segments[ tierIndex + 1 ] : null ) ?? route?.tier ?? 'full';
	if ( ! IMAGE_PIPELINE_TIERS[ tierId ] ) throw new Error( `Unknown image-pipeline tier "${ tierId }".` );
	return { mechanism, tierId, mode: url.searchParams.get( 'mode' ) ?? route?.mode ?? 'final' };

}

function bytesPerRow( width, height, length ) {

	const compact = width * 4;
	if ( length === compact * height ) return compact;
	const aligned = Math.ceil( compact / 256 ) * 256;
	if ( length !== aligned * height && length !== aligned * ( height - 1 ) + compact ) throw new Error( `Unexpected WebGPU readback length ${ length }.` );
	return aligned;

}

async function initialize() {

	if ( ! navigator.gpu ) throw new Error( 'Native WebGPU unavailable; canonical image pipeline is blocked without fallback.' );
	const startup = startupRoute();
	const app = await createCanonicalImagePipeline( canvas, startup );
	app.resize( innerWidth, innerHeight, devicePixelRatio || 1 );
	addEventListener( 'resize', () => app.resize( innerWidth, innerHeight, devicePixelRatio || 1 ) );
	const target = new RenderTarget( innerWidth, innerHeight, { type: UnsignedByteType, samples: 1, depthBuffer: false } );
	target.texture.colorSpace = NoColorSpace;
	let time = 0;
	let cameraId = 'design';
	// Satellite labs (e.g. temporal-history) publish distinct scenario ids that capture locks.
	let scenarioId = LAB_ID === 'webgpu-temporal-history' ? 'moving-rigid-subject' : 'pipeline-fixture';

	function setCamera( id ) {

		const position = CAMERA_BOOKMARKS[ id ];
		if ( ! position ) throw new Error( `Unknown image-pipeline camera "${ id }".` );
		app.camera.position.fromArray( position );
		app.camera.lookAt( new Vector3() );
		app.camera.updateMatrixWorld( true );
		cameraId = id;
		return app.resetHistory( `camera-${ id }` );

	}

	async function capturePixels( captureTarget = 'presentation' ) {

		// Capture harness requests presentation/final RT readbacks; mode switches use setMode.
		const width = Math.max( 1, Math.floor( app.renderer.domElement.width || innerWidth ) );
		const height = Math.max( 1, Math.floor( app.renderer.domElement.height || innerHeight ) );
		target.setSize( width, height );
		app.renderer.setRenderTarget( target );
		app.render( 0 );
		const pixels = await app.renderer.readRenderTargetPixelsAsync( target, 0, 0, width, height );
		app.renderer.setRenderTarget( null );
		return {
			target: captureTarget,
			width,
			height,
			bytesPerRow: bytesPerRow( width, height, pixels.length ),
			bytesPerPixel: 4,
			format: 'rgba8unorm',
			outputColorSpace: app.renderer.outputColorSpace,
			pixels,
		};

	}

	const controller = {
		get labId() { return LAB_ID; },
		async ready() {},
		async setScenario( id ) {
			// Satellite labs publish their own scenario ids; parent lab keeps pipeline-fixture.
			const allowed = new Set( [
				'pipeline-fixture',
				'moving-rigid-subject', // webgpu-temporal-history
			] );
			if ( ! allowed.has( id ) ) throw new Error( `Unknown image-pipeline scenario "${ id }".` );
			scenarioId = id;
			return id;
		},
		async setMode( id ) { return app.setMode( id ); },
		async setTier( id ) { if ( id !== app.tierId ) throw new Error( `Load locked tier route "${ id }" to rebuild attachments.` ); return id; },
		async setSeed( seed ) { const selected = app.setSeed( seed ); await app.resetHistory( `seed-${ selected.toString( 16 ) }` ); return selected; },
		async setCamera( id ) { return setCamera( id ); },
		async setTime( seconds ) { time = Number( seconds ); return app.setTime( time ); },
		async step( dt ) { time += dt; app.setTime( time ); app.render( dt ); },
		async resetHistory( cause ) { return app.resetHistory( cause ); },
		async resize( width, height, dpr ) { app.resize( width, height, dpr ); },
		async renderOnce() { app.render( 0 ); },
		capturePixels,
		describePipeline: () => app.describePipeline(),
		describeResources: () => app.describeResources(),
		getExposureReadback: () => app.readbackExposureState(),
		getMetrics: () => {

			const pipeline = app.describePipeline();
			return {
				labId: LAB_ID,
				...app.getMetrics(),
				scenario: scenarioId,
				mechanism: startup.mechanism,
				tier: app.tierId,
				tierId: app.tierId,
				mode: pipeline.mode,
				seed: app.getMetrics().seed,
				camera: cameraId,
				time,
				routeSelection: { scenario: scenarioId, mechanism: startup.mechanism, tier: app.tierId, mode: pipeline.mode, seed: app.getMetrics().seed, camera: cameraId, time }
			};

		},
		async dispose() { target.dispose(); app.dispose(); }
	};
	window.__labController = controller;
	window.__LAB_CONTROLLER__ = controller;
	window.labController = controller;
	resolvePublishedController( controller );
	window.__canonicalImagePipeline = { app, controller, startup, mechanisms: Object.keys( IMAGE_PIPELINE_MECHANISM_ROUTES ) };
	await controller.renderOnce();
	status.textContent = `ready | tier=${ app.tierId } | mechanism=${ startup.mechanism ?? 'canonical' } | mode=${ startup.mode }\nruntime performance: INSUFFICIENT_EVIDENCE`;

}

initialize().catch( ( error ) => {

	console.error( error );
	status.textContent = error.message;
	const errorController = { ready: async () => { throw error; } };
	window.__labController = errorController;
	window.__LAB_CONTROLLER__ = errorController;
	window.labController = errorController;
	resolvePublishedController( errorController );

} );
