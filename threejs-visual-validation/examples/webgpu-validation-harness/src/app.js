import { createNativeWebGPUValidationSubject, nativeSubjectContract } from './browser-subject-adapter.js';
import { resolvePhysicalRuntimeProfile } from './physical-runtime-profile.js';
import { createLockedController, resolveRouteLockFromParameters } from './route-locks.js';
import { runLifecycleProfile } from './subject-adapter.js';

const canvas = document.querySelector( '#validation-canvas' );
const status = document.querySelector( '#status' );

async function start() {

	status.textContent = 'Initializing native WebGPU…';
	const parameters = new URLSearchParams( location.search );
	const routeLock = resolveRouteLockFromParameters( parameters );
	let parentHost = null;
	try {

		if ( window.parent !== window ) parentHost = window.parent.__THREEJS_PHYSICAL_EVIDENCE_HOST__
			?? window.parent.__THREEJS_PLAYWRIGHT_CORRECTNESS_HOST__
			?? null;

	} catch {

		parentHost = null;

	}
	const runtime = resolvePhysicalRuntimeProfile( {
		parameters,
		routeLock,
		injectedProfile: window.__LAB_CAPTURE_PROFILE__ ?? null,
		environment: {
			webdriver: navigator.webdriver === true,
			parentIsSelf: window.parent === window,
			parentHost
		}
	} );
	const { runtimeProfile } = runtime;
	const controller = await createNativeWebGPUValidationSubject( canvas, { runtimeProfile, routeLock } );
	const startup = routeLock?.startup ?? {};
	await controller.setScenario( startup.scenario ?? parameters.get( 'scenario' ) ?? 'browser-capture' );
	await controller.setTier( startup.tier ?? parameters.get( 'tier' ) ?? 'webgpu-correctness' );
	await controller.setMode( startup.mode ?? parameters.get( 'mode' ) ?? 'final' );
	await controller.setCamera( startup.camera ?? parameters.get( 'camera' ) ?? 'design' );
	await controller.setSeed( startup.seed ?? Number( parameters.get( 'seed' ) ?? 0x00000001 ) );
	await controller.setTime( startup.timeSeconds ?? Number( parameters.get( 'timeSeconds' ) ?? 0 ) );
	await controller.resize(
		startup.width ?? Number( parameters.get( 'width' ) ?? 1200 ),
		startup.height ?? Number( parameters.get( 'height' ) ?? 800 ),
		startup.dpr ?? Number( parameters.get( 'dpr' ) ?? 1 )
	);
	await controller.ready();

	const publishedController = routeLock === null ? controller : createLockedController( controller, routeLock );
	window.labController = publishedController;
	window.__LAB_CONTROLLER__ = publishedController;
	window.__THREEJS_LAB__ = publishedController;
	window.__THREEJS_LAB_CONTRACT__ = nativeSubjectContract;
	window.__THREEJS_LAB_ROUTE_LOCK__ = routeLock;
	window.__THREEJS_LAB_RUNTIME__ = runtime;
	window.__THREEJS_LAB_LIFECYCLE__ = ( cycles = 50 ) => runLifecycleProfile(
		() => createNativeWebGPUValidationSubject( document.createElement( 'canvas' ), { runtimeProfile } ),
		{ cycles }
	);
	status.textContent = `Native WebGPU validation subject ready · ${ runtimeProfile }`;
	document.documentElement.dataset.ready = 'true';
	document.documentElement.dataset.runtimeProfile = runtimeProfile;
	document.documentElement.dataset.automationSurface = runtime.automationSurface;

}

start().catch( ( error ) => {

	status.textContent = error.message;
	document.documentElement.dataset.ready = 'error';
	window.__THREEJS_LAB_ERROR__ = error;
	throw error;

} );
