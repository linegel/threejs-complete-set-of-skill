import { NoColorSpace, REVISION, RenderTarget, UnsignedByteType } from 'three/webgpu';

import {
	EXPOSURE_MECHANISM_ROUTES,
	createExposureColorPipeline,
	resolveExposureMechanismRoute
} from './main.js';
import { EXPOSURE_QUALITY_TIERS } from './constants.js';

const LAB_ID = 'webgpu-exposure-color-pipeline';

const canvas = document.querySelector( '#view' );
const status = document.querySelector( '#status' );
let resolvePublishedController;
const publishedController = new Promise( ( resolve ) => { resolvePublishedController = resolve; } );
window.labController = publishedController;
window.__LAB_CONTROLLER__ = publishedController;

function routeOptions() {

	const url = new URL( location.href );
	const locked = globalThis.__LAB_LOCKED_ROUTE__ ?? null;
	const segments = url.pathname.split( '/' ).filter( Boolean );
	const mechanismIndex = segments.lastIndexOf( 'mechanism' );
	const tierIndex = segments.lastIndexOf( 'tier' );
	const mechanism = url.searchParams.get( 'mechanism' ) ?? ( mechanismIndex >= 0 ? segments[ mechanismIndex + 1 ] : null );
	const tier = url.searchParams.get( 'tier' ) ?? ( tierIndex >= 0 ? segments[ tierIndex + 1 ] : null );
	if ( locked ) {

		const requested = {
			mechanism: url.searchParams.get( 'mechanism' ),
			tier: url.searchParams.get( 'tier' ),
			mode: url.searchParams.get( 'mode' ),
			scenario: url.searchParams.get( 'scenario' ),
			toneMappingVariant: url.searchParams.get( 'tone' ),
			lutVariant: url.searchParams.get( 'lut' )
		};
		for ( const [ key, value ] of Object.entries( requested ) ) {

			if ( value !== null && value !== locked[ key ] ) throw new Error( `Locked exposure route rejects ${ key } override "${ value }".` );

		}
		if ( locked.mechanism ) {

			const expected = resolveExposureMechanismRoute( locked.mechanism );
			if ( expected.tier !== locked.tier || expected.mode !== locked.mode ) throw new Error( `Locked exposure route "${ locked.mechanism }" has inconsistent startup state.` );

		}
		if ( ! EXPOSURE_QUALITY_TIERS[ locked.tier ] ) throw new Error( `Unknown locked exposure tier "${ locked.tier }".` );
		return Object.freeze( { ...locked } );

	}
	const route = mechanism ? resolveExposureMechanismRoute( mechanism ) : null;
	const selectedTier = tier ?? route?.tier ?? 'full-histogram';
	if ( ! EXPOSURE_QUALITY_TIERS[ selectedTier ] ) throw new Error( `Unknown exposure tier "${ selectedTier }".` );
	return {
		mechanism,
		tier: selectedTier,
		mode: url.searchParams.get( 'mode' ) ?? route?.mode ?? 'final',
		scenario: url.searchParams.get( 'scenario' ) ?? route?.scenario ?? 'emitter',
		toneMappingVariant: url.searchParams.get( 'tone' ) ?? route?.toneMappingVariant ?? 'Neutral',
		lutVariant: url.searchParams.get( 'lut' ) ?? route?.lutVariant ?? undefined
	};

}

function alignedBytesPerRow( width, height, byteLength ) {

	const compact = width * 4;
	if ( byteLength === compact * height ) return compact;
	const aligned = Math.ceil( compact / 256 ) * 256;
	if ( byteLength !== aligned * height && byteLength !== aligned * ( height - 1 ) + compact ) throw new Error( `Unexpected readback byte length ${ byteLength }.` );
	return aligned;

}

async function initialize() {

	if ( ! navigator.gpu ) throw new Error( 'Native WebGPU is unavailable; this canonical lab is blocked and will not activate fallback.' );
	const startup = routeOptions();
	const app = await createExposureColorPipeline( canvas, startup );
	if ( app.renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Canonical exposure lab requires renderer.backend.isWebGPUBackend === true.' );

	const resize = ( width = innerWidth, height = innerHeight, dpr = devicePixelRatio || 1 ) => app.resize( width, height, dpr );
	resize();
	addEventListener( 'resize', () => resize() );

	const captureTarget = new RenderTarget( innerWidth, innerHeight, { samples: 1, type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.colorSpace = NoColorSpace;
	let timeSeconds = 0;
	let disposed = false;

	async function renderOnce() {

		if ( disposed ) throw new Error( 'Exposure lab is disposed.' );
		app.render( 0 );

	}

	async function capturePixels( target = 'final' ) {

		app.setMode( target );
		const width = Math.max( 1, Math.floor( innerWidth ) );
		const height = Math.max( 1, Math.floor( innerHeight ) );
		captureTarget.setSize( width, height );
		app.renderer.setRenderTarget( captureTarget );
		await renderOnce();
		const pixels = await app.renderer.readRenderTargetPixelsAsync( captureTarget, 0, 0, width, height );
		app.renderer.setRenderTarget( null );
		return { width, height, bytesPerRow: alignedBytesPerRow( width, height, pixels.length ), pixels };

	}

	const controller = {
		get labId() { return LAB_ID; },
		async ready() {},
		async setScenario( id ) { return app.setScenario( id ); },
		async setMode( id ) { return app.setMode( id ); },
		async setTier( id ) {

			if ( id !== app.tierId ) throw new Error( `Tier changes rebuild resources; load the locked tier route "${ id }".` );
			return id;

		},
		async setSeed( seed ) {

			return app.setSeed( seed );

		},
		async setCamera( id ) {

			if ( id !== 'design' ) throw new Error( `Unknown exposure camera "${ id }".` );
			return id;

		},
		async setTime( seconds ) { timeSeconds = Number( seconds ); return timeSeconds; },
		async step( deltaSeconds ) { timeSeconds += deltaSeconds; app.render( deltaSeconds ); },
		async resetHistory( cause ) { return { cause, status: 'not-applicable; exposure state is not temporal color history' }; },
		async resetMeterState( cause ) { return app.resetMeterState( cause ); },
		async resize( width, height, dpr ) { resize( width, height, dpr ); },
		renderOnce,
		capturePixels,
		describePipeline: () => app.describePipeline(),
		describeResources: () => app.describeResources(),
		getExposureReadback: () => app.readbackExposureState(),
		getMetrics: () => {

			const pipeline = app.describePipeline();
			return {
				labId: LAB_ID,
				renderer: 'WebGPURenderer',
				backend: {
					name: app.renderer.backend?.constructor?.name ?? 'unknown',
					isWebGPUBackend: app.renderer.backend?.isWebGPUBackend === true
				},
				threeRevision: REVISION,
				verdict: 'INSUFFICIENT_EVIDENCE',
				reason: 'No named-adapter timestamp capture has been accepted.',
				tier: app.tierId,
				tierId: app.tierId,
				mode: pipeline.mode,
				scenario: pipeline.scenario,
				seed: pipeline.seed,
				mechanism: startup.mechanism,
				routeSelection: { mechanism: startup.mechanism, tier: app.tierId, mode: pipeline.mode, scenario: pipeline.scenario, seed: pipeline.seed },
				meterMode: app.meterMode,
				rendererInfo: app.renderer.info
			};

		},
		async dispose() { if ( disposed ) return; disposed = true; captureTarget.dispose(); app.dispose(); }
	};

	window.__labController = controller;
	window.__LAB_CONTROLLER__ = controller;
	window.labController = controller;
	resolvePublishedController( controller );
	window.__exposureLab = { app, controller, startup, mechanisms: Object.keys( EXPOSURE_MECHANISM_ROUTES ) };
	await controller.renderOnce();
	status.textContent = `ready | tier=${ startup.tier } | mechanism=${ startup.mechanism ?? 'canonical' } | mode=${ startup.mode }\nperformance: INSUFFICIENT_EVIDENCE until named-adapter capture`;

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
