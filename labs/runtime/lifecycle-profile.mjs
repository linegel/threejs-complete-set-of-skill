export const LIFECYCLE_CONTROLLER_METHODS = Object.freeze( [
	'ready',
	'setMode',
	'setTier',
	'resetHistory',
	'resize',
	'renderOnce',
	'describeResources',
	'getMetrics',
	'dispose'
] );

export function assertLifecycleController( controller, label = 'Lifecycle controller' ) {

	if ( controller === null || typeof controller !== 'object' ) throw new Error( `${ label } must be an object.` );
	for ( const method of LIFECYCLE_CONTROLLER_METHODS ) {

		if ( typeof controller[ method ] !== 'function' ) throw new Error( `${ label } is missing required method ${ method }().` );

	}
	return controller;

}

function defaultCyclePlan( cycle ) {

	return {
		width: cycle % 2 === 0 ? 641 : 1200,
		height: cycle % 2 === 0 ? 359 : 800,
		dpr: cycle % 3 === 0 ? 1.5 : 1,
		tier: cycle % 2 === 0 ? 'governor-stress' : 'webgpu-correctness',
		mode: cycle % 3 === 0 ? 'normal' : 'final',
		resetCause: `lifecycle-cycle-${ cycle }`
	};

}

async function defaultSettle() {

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

}

function deviceMessages( metrics ) {

	return [
		...( Array.isArray( metrics?.uncapturedErrors ) ? metrics.uncapturedErrors : [] ),
		...( Array.isArray( metrics?.deviceErrors ) ? metrics.deviceErrors : [] ),
		...( metrics?.lastDeviceError ? [ metrics.lastDeviceError ] : [] )
	].map( String );

}

function requireCyclePlan( plan, cycle ) {

	if ( plan === null || typeof plan !== 'object' || Array.isArray( plan ) ) throw new Error( `Lifecycle cycle ${ cycle } plan must be an object.` );
	for ( const key of [ 'width', 'height', 'dpr' ] ) {

		if ( Number.isFinite( plan[ key ] ) === false || plan[ key ] <= 0 ) throw new Error( `Lifecycle cycle ${ cycle } plan has invalid ${ key }.` );

	}
	for ( const key of [ 'tier', 'mode', 'resetCause' ] ) {

		if ( typeof plan[ key ] !== 'string' || plan[ key ].length === 0 ) throw new Error( `Lifecycle cycle ${ cycle } plan has invalid ${ key }.` );

	}
	return plan;

}

/**
 * Runs real create/render/resize/mode/tier/reset/dispose cycles. The factory
 * must return a fresh controller per cycle. Callers can select valid lab state
 * through planCycle without weakening the common settlement evidence.
 */
export async function runLifecycleProfile( createController, options = {} ) {

	if ( typeof createController !== 'function' ) throw new Error( 'Lifecycle profile requires a controller factory.' );
	const cycles = options.cycles ?? 50;
	if ( Number.isInteger( cycles ) === false || cycles < 50 || cycles > 100 ) throw new Error( 'Lifecycle cycles must be an integer in [50, 100].' );
	const settle = options.settle ?? defaultSettle;
	if ( typeof settle !== 'function' ) throw new Error( 'Lifecycle settle must be a function.' );
	const planCycle = options.planCycle ?? defaultCyclePlan;
	if ( typeof planCycle !== 'function' ) throw new Error( 'Lifecycle planCycle must be a function.' );
	const assertController = options.assertController ?? assertLifecycleController;
	if ( typeof assertController !== 'function' ) throw new Error( 'Lifecycle assertController must be a function.' );

	const snapshots = [];
	for ( let cycle = 0; cycle < cycles; cycle ++ ) {

		const controller = assertController( await createController( cycle ), `Lifecycle controller cycle ${ cycle }` );
		const plan = requireCyclePlan( await planCycle( cycle, controller ), cycle );
		await controller.ready();
		await controller.resize( plan.width, plan.height, plan.dpr );
		await controller.setTier( plan.tier );
		await controller.setMode( plan.mode );
		await controller.resetHistory( plan.resetCause );
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
		settleRecord.delayedErrors.push( ...deviceMessages( afterDispose ).filter( ( message ) => beforeMessages.has( message ) === false ) );
		snapshots.push( {
			rowType: 'settled-lifecycle-cycle-v2',
			cycle,
			plan: { ...plan },
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
