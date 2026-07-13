import { canonicalUrlForRoute, getRouteLock } from './route-locks.js';
import { PLAYWRIGHT_CORRECTNESS_SURFACE } from './physical-runtime-profile.js';

export const PLAYWRIGHT_CORRECTNESS_HOST_GLOBAL = '__THREEJS_PLAYWRIGHT_CORRECTNESS_HOST__';

export function createPlaywrightCorrectnessHost( injectedProfile, lock ) {

	if ( injectedProfile?.id !== 'correctness' ) return null;
	if ( typeof injectedProfile.labId !== 'string' || injectedProfile.labId.length === 0 ) {

		throw new Error( 'Playwright correctness wrapper requires an injected lab identity.' );

	}
	return Object.freeze( {
		automationSurface: PLAYWRIGHT_CORRECTNESS_SURFACE,
		captureProfile: 'correctness',
		labId: injectedProfile.labId,
		routeKind: lock.kind,
		routeId: lock.id
	} );

}

function waitForController( frame ) {

	return new Promise( ( resolve, reject ) => {

		const started = performance.now();
		const poll = () => {

			const child = frame.contentWindow;
			if ( child?.__THREEJS_LAB__ ) {

				resolve( child.__THREEJS_LAB__ );
				return;

			}

			if ( child?.__THREEJS_LAB_ERROR__ ) {

				reject( child.__THREEJS_LAB_ERROR__ );
				return;

			}

			if ( performance.now() - started > 30000 ) {

				reject( new Error( 'Timed out waiting for canonical validation controller.' ) );
				return;

			}

			requestAnimationFrame( poll );

		};
		poll();

	} );

}

export function createLifecycleRunnerForwarder( frame ) {

	if ( frame === null || typeof frame !== 'object' ) throw new Error( 'Locked route lifecycle forwarding requires an iframe.' );

	return async ( ...args ) => {

		const child = frame.contentWindow;
		const runner = child?.__THREEJS_LAB_LIFECYCLE__;
		if ( typeof runner !== 'function' ) throw new Error( 'Canonical validation lifecycle runner is unavailable.' );
		return runner.apply( child, args );

	};

}

export function createControllerRealmBridge( controller, clone = structuredClone ) {

	if ( controller === null || typeof controller !== 'object' ) throw new Error( 'Controller realm bridge requires a child controller.' );
	if ( typeof clone !== 'function' ) throw new Error( 'Controller realm bridge requires a structured clone function.' );
	return new Proxy( Object.create( null ), {
		get( _target, property ) {

			if ( property === 'then' ) return undefined;
			const value = controller[ property ];
			if ( typeof value !== 'function' ) return clone( value );
			return async ( ...args ) => clone( await value.apply( controller, args ) );

		}
	} );

}

export async function mountLockedRoute( { kind, id, root = document.body } ) {

	const lock = getRouteLock( kind, id );
	const correctnessHost = createPlaywrightCorrectnessHost( window.__LAB_CAPTURE_PROFILE__ ?? null, lock );
	if ( correctnessHost !== null ) Object.defineProperty( window, PLAYWRIGHT_CORRECTNESS_HOST_GLOBAL, {
		configurable: false,
		enumerable: true,
		writable: false,
		value: correctnessHost
	} );
	const canonical = canonicalUrlForRoute( new URL( '../index.html', import.meta.url ), kind, id );
	const frame = document.createElement( 'iframe' );
	frame.title = `WebGPU validation ${ kind } ${ id }`;
	frame.src = canonical.href;
	frame.setAttribute( 'allow', 'fullscreen' );
	frame.style.cssText = 'display:block;width:100vw;height:100vh;border:0;background:#070b14';
	root.replaceChildren( frame );

	await new Promise( ( resolve, reject ) => {

		frame.addEventListener( 'load', resolve, { once: true } );
		frame.addEventListener( 'error', () => reject( new Error( `Failed to load canonical ${ kind } route ${ id }.` ) ), { once: true } );

	} );

	const controller = await waitForController( frame );
	const publishedController = createControllerRealmBridge( controller );
	window.__THREEJS_LAB__ = publishedController;
	window.__THREEJS_LAB_LIFECYCLE__ = createLifecycleRunnerForwarder( frame );
	window.__THREEJS_LAB_ROUTE_LOCK__ = lock;
	document.documentElement.dataset.ready = 'true';
	document.documentElement.dataset.routeKind = kind;
	document.documentElement.dataset.routeId = id;
	return publishedController;

}
