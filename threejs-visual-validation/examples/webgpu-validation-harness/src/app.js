import { createNativeWebGPUValidationSubject, nativeSubjectContract } from './browser-subject-adapter.js';
import { createLockedController, getRouteLock } from './route-locks.js';

const canvas = document.querySelector( '#validation-canvas' );
const status = document.querySelector( '#status' );

async function start() {

	status.textContent = 'Initializing native WebGPU…';
	const controller = await createNativeWebGPUValidationSubject( canvas );
	const parameters = new URLSearchParams( location.search );
	const lockKind = parameters.get( 'lockKind' );
	const lockId = parameters.get( 'lockId' );
	const routeLock = lockKind === null && lockId === null ? null : getRouteLock( lockKind, lockId );
	await controller.setScenario( routeLock?.startup.scenario ?? parameters.get( 'scenario' ) ?? 'browser-capture' );
	await controller.setTier( routeLock?.startup.tier ?? parameters.get( 'tier' ) ?? 'webgpu-correctness' );
	await controller.setMode( routeLock?.startup.mode ?? parameters.get( 'mode' ) ?? 'final' );
	await controller.setCamera( parameters.get( 'camera' ) ?? 'design' );
	const seedText = parameters.get( 'seed' );
	await controller.setSeed( seedText === null ? 0x00000001 : Number( seedText ) );
	await controller.resize( 1200, 800, 1 );
	await controller.ready();

	window.__THREEJS_LAB__ = routeLock === null ? controller : createLockedController( controller, routeLock );
	window.__THREEJS_LAB_CONTRACT__ = nativeSubjectContract;
	window.__THREEJS_LAB_ROUTE_LOCK__ = routeLock;
	status.textContent = 'Native WebGPU validation subject ready';
	document.documentElement.dataset.ready = 'true';

}

start().catch( ( error ) => {

	status.textContent = error.message;
	document.documentElement.dataset.ready = 'error';
	window.__THREEJS_LAB_ERROR__ = error;
	throw error;

} );
