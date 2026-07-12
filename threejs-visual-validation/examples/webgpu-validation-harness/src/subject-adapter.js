export const LAB_CONTROLLER_METHODS = Object.freeze( [
	'ready',
	'setScenario',
	'setMode',
	'setTier',
	'setSeed',
	'setCamera',
	'setTime',
	'step',
	'resetHistory',
	'resize',
	'renderOnce',
	'capturePixels',
	'describePipeline',
	'describeResources',
	'getMetrics',
	'dispose'
] );

export function assertLabController( controller, label = 'LabController' ) {

	if ( controller === null || typeof controller !== 'object' ) throw new Error( `${ label } must be an object.` );

	for ( const method of LAB_CONTROLLER_METHODS ) {

		if ( typeof controller[ method ] !== 'function' ) throw new Error( `${ label } is missing required method ${ method}().` );

	}

	return controller;

}

function requirePixelCapture( capture, label ) {

	if ( capture === null || typeof capture !== 'object' ) throw new Error( `${ label } did not return a PixelCapture.` );
	if ( Number.isInteger( capture.width ) === false || Number.isInteger( capture.height ) === false ) throw new Error( `${ label } returned non-integer dimensions.` );
	if ( ArrayBuffer.isView( capture.pixels ) === false || capture.pixels.byteLength === 0 ) throw new Error( `${ label } returned no readback pixels.` );
	if ( capture.pixels.byteLength !== capture.width * capture.height * 4 ) throw new Error( `${ label } returned a non-tight RGBA8 payload.` );
	return capture;

}

/**
 * Exercises the standard correctness matrix through the subject's actual
 * controller. The caller owns PNG encoding and filesystem persistence.
 */
export async function captureCorrectnessProfile( controller ) {

	assertLabController( controller );
	await controller.ready();
	await controller.resize( 1200, 800, 1 );
	await controller.setTier( 'webgpu-correctness' );
	await controller.setSeed( 0x00000001 );
	await controller.setTime( 0 );

	const captures = new Map();
	const capture = async ( name, mode ) => {

		await controller.setMode( mode );
		await controller.renderOnce();
		captures.set( name, requirePixelCapture( await controller.capturePixels( mode ), name ) );

	};

	await controller.setCamera( 'design' );
	await capture( 'final.design', 'final' );
	await capture( 'no-post.design', 'no-post' );
	await capture( 'diagnostic.normal', 'normal' );
	await capture( 'diagnostic.emissive', 'emissive' );

	for ( const camera of [ 'near', 'design', 'far' ] ) {

		await controller.setCamera( camera );
		await capture( `camera.${ camera }`, 'final' );

	}

	for ( const seed of [ 0x00000001, 0x9e3779b9 ] ) {

		await controller.setSeed( seed );
		await controller.setCamera( 'design' );
		await capture( `seed-${ seed.toString( 16 ).padStart( 8, '0' ) }.final`, 'final' );

	}

	await controller.setSeed( 0x00000001 );
	await controller.resetHistory( 'correctness-profile-temporal-reset' );
	await controller.setTime( 0 );
	await capture( 'temporal.t000', 'final' );
	await controller.step( 1 / 60 );
	await capture( 'temporal.t001', 'final' );

	return {
		captures,
		pipeline: controller.describePipeline(),
		resources: controller.describeResources(),
		metrics: controller.getMetrics()
	};

}

export async function captureOddSizeReadbackProfile( controller ) {

	assertLabController( controller );
	await controller.resize( 641, 359, 1 );
	await controller.setMode( 'final' );
	await controller.renderOnce();
	const capture = requirePixelCapture( await controller.capturePixels( 'final' ), 'odd-size 641x359 capture' );

	if ( capture.width !== 641 || capture.height !== 359 ) {

		throw new Error( `Odd-size capture dimensions drifted: ${ capture.width }x${ capture.height }.` );

	}

	return capture;

}

/**
 * Runs actual create/render/resize/mode/tier/reset/dispose cycles. The factory
 * must return a fresh controller per cycle; a one-iteration placeholder is
 * explicitly rejected.
 */
export async function runLifecycleProfile( createController, options = {} ) {

	if ( typeof createController !== 'function' ) throw new Error( 'Lifecycle profile requires a controller factory.' );
	const cycles = options.cycles ?? 50;
	if ( Number.isInteger( cycles ) === false || cycles < 50 || cycles > 100 ) throw new Error( 'Lifecycle cycles must be an integer in [50, 100].' );
	const settle = options.settle ?? ( async () => {

		let observedAnimationFrames = 0;
		for ( let frame = 0; frame < 2; frame ++ ) {

			if ( typeof requestAnimationFrame === 'function' ) await new Promise( ( resolve ) => requestAnimationFrame( () => {

				observedAnimationFrames ++;
				resolve();

			} ) );
			else {

				await Promise.resolve();
				observedAnimationFrames ++;

			}

		}
		return { observedAnimationFrames, queueSettled: true, delayedErrors: [] };

	} );
	if ( typeof settle !== 'function' ) throw new Error( 'Lifecycle settle must be a function.' );
	const deviceMessages = ( metrics ) => [
		...( Array.isArray( metrics?.uncapturedErrors ) ? metrics.uncapturedErrors : [] ),
		...( Array.isArray( metrics?.deviceErrors ) ? metrics.deviceErrors : [] ),
		...( metrics?.lastDeviceError ? [ metrics.lastDeviceError ] : [] )
	].map( String );

	const snapshots = [];
	for ( let cycle = 0; cycle < cycles; cycle ++ ) {

		const controller = assertLabController( await createController( cycle ), `LabController cycle ${ cycle }` );
		await controller.ready();
		await controller.resize( cycle % 2 === 0 ? 641 : 1200, cycle % 2 === 0 ? 359 : 800, cycle % 3 === 0 ? 1.5 : 1 );
		await controller.setTier( cycle % 2 === 0 ? 'governor-stress' : 'webgpu-correctness' );
		await controller.setMode( cycle % 3 === 0 ? 'normal' : 'final' );
		await controller.resetHistory( `lifecycle-cycle-${ cycle }` );
		await controller.renderOnce();
		const beforeDispose = controller.getMetrics();
		const resourcesBeforeDispose = controller.describeResources();
		let dispose = { status: 'PASS', completed: false, error: null, evidence: null };
		try {

			const evidence = await controller.dispose();
			dispose = { status: 'PASS', completed: true, error: null, evidence: evidence ?? null };

		} catch ( error ) {

			dispose = { status: 'FAIL', completed: false, error: String( error?.message ?? error ), evidence: null };

		}
		let settleRecord = { status: 'PASS', policyAnimationFrames: 2, observedAnimationFrames: 0, queueSettled: false, delayedErrors: [] };
		try {

			const observed = await settle( cycle, controller );
			if ( observed === null || typeof observed !== 'object' || Array.isArray( observed ) ) throw new Error( 'Lifecycle settle must return observed settlement evidence.' );
			if ( Number.isInteger( observed.observedAnimationFrames ) === false || observed.observedAnimationFrames < 0 ) throw new Error( 'Lifecycle settle did not report observed animation-frame callbacks.' );
			settleRecord = {
				status: 'PASS',
				policyAnimationFrames: 2,
				observedAnimationFrames: observed.observedAnimationFrames,
				queueSettled: observed.queueSettled === true && dispose.evidence?.queueSettlement?.status === 'PASS',
				delayedErrors: [ ...( observed.delayedErrors ?? [] ) ].map( String )
			};

		} catch ( error ) {

			settleRecord = { status: 'FAIL', policyAnimationFrames: 2, observedAnimationFrames: 0, queueSettled: false, delayedErrors: [ String( error?.message ?? error ) ] };

		}
		let afterDispose;
		let resourcesAfterDispose;
		try {

			afterDispose = controller.getMetrics();
			resourcesAfterDispose = controller.describeResources();

		} catch ( error ) {

			afterDispose = { captureError: String( error?.message ?? error ) };
			resourcesAfterDispose = { captureError: String( error?.message ?? error ) };

		}
		const beforeMessages = new Set( deviceMessages( beforeDispose ) );
		const delayedDeviceErrors = deviceMessages( afterDispose ).filter( ( message ) => beforeMessages.has( message ) === false );
		settleRecord.delayedErrors.push( ...delayedDeviceErrors );
		snapshots.push( {
			rowType: 'settled-lifecycle-cycle-v2',
			cycle,
			beforeDispose,
			afterDispose,
			resourcesBeforeDispose,
			resourcesAfterDispose,
			dispose,
			settle: settleRecord
		} );

	}

	return { cycles, snapshots };

}
