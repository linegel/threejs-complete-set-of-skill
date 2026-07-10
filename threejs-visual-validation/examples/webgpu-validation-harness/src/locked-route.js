import { canonicalUrlForRoute, getRouteLock } from './route-locks.js';

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

export async function mountLockedRoute( { kind, id, root = document.body } ) {

	const lock = getRouteLock( kind, id );
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
	window.__THREEJS_LAB__ = controller;
	window.__THREEJS_LAB_ROUTE_LOCK__ = lock;
	document.documentElement.dataset.ready = 'true';
	document.documentElement.dataset.routeKind = kind;
	document.documentElement.dataset.routeId = id;
	return controller;

}
