function requireFunction( value, label ) {

	if ( typeof value !== 'function' ) throw new TypeError( `${ label } must be a function.` );
	return value;

}

function requireRecipeIdentity( recipe ) {

	if ( recipe === null || typeof recipe !== 'object' || Array.isArray( recipe ) ) throw new TypeError( 'Capture transaction requires a recipe object.' );
	if ( typeof recipe.id !== 'string' || recipe.id.length === 0 ) throw new Error( 'Capture transaction recipe ID is required.' );
	return recipe;

}

function freezeRecord( value ) {

	if ( value === null || typeof value !== 'object' || Object.isFrozen( value ) ) return value;
	for ( const child of Object.values( value ) ) freezeRecord( child );
	return Object.freeze( value );

}

function errorMessage( error ) {

	return String( error?.message ?? error );

}

export function createFailClosedCaptureCoordinator( dependencies ) {

	if ( dependencies === null || typeof dependencies !== 'object' || Array.isArray( dependencies ) ) throw new TypeError( 'Capture coordinator dependencies must be an object.' );
	const snapshotState = requireFunction( dependencies.snapshotState, 'snapshotState' );
	const digestState = requireFunction( dependencies.digestState, 'digestState' );
	const restoreState = requireFunction( dependencies.restoreState, 'restoreState' );
	const settleRestoration = requireFunction( dependencies.settleRestoration, 'settleRestoration' );
	const verifyRestoration = requireFunction( dependencies.verifyRestoration, 'verifyRestoration' );
	const onPoison = dependencies.onPoison ?? ( () => {} );
	requireFunction( onPoison, 'onPoison' );

	let active = null;
	let poisoned = null;
	let nextSequence = 1;

	function assertAvailable( operation, options = {} ) {

		const label = typeof operation === 'string' && operation.length > 0 ? operation : 'operation';
		if ( active !== null ) throw new Error( `Cannot start ${ label }; capture transaction ${ active.id } is active.` );
		if ( poisoned !== null && options.allowPoisoned !== true ) throw new Error( `Cannot start ${ label }; capture controller is poisoned after ${ poisoned.recipeId }: ${ poisoned.reason }` );
		return true;

	}

	async function poison( record ) {

		poisoned = freezeRecord( { ...record } );
		await onPoison( poisoned );

	}

	async function run( recipeValue, execute ) {

		const recipe = requireRecipeIdentity( recipeValue );
		requireFunction( execute, 'capture transaction execute' );
		assertAvailable( `capture recipe ${ recipe.id }` );
		const sequence = nextSequence ++;
		active = freezeRecord( { id: `capture-${ sequence }`, recipeId: recipe.id, sequence } );

		let entryState = null;
		let entryStateDigest = null;
		let restoredState = null;
		let restoredStateDigest = null;
		let captureResult = null;
		let captureError = null;
		let restorationError = null;
		let restorationVerdict = 'NOT_ATTEMPTED';
		try {

			entryState = await snapshotState( { recipe, sequence } );
			if ( entryState === null || typeof entryState !== 'object' || Array.isArray( entryState ) ) throw new Error( 'Capture transaction entry snapshot must be an object.' );
			entryStateDigest = await digestState( entryState );
			if ( typeof entryStateDigest !== 'string' || entryStateDigest.length === 0 ) throw new Error( 'Capture transaction entry-state digest is required.' );
			captureResult = await execute( {
				recipe,
				sequence,
				transactionId: active.id,
				entryState,
				entryStateDigest
			} );

		} catch ( error ) {

			captureError = error;

		} finally {

			if ( entryState !== null ) {

				try {

					await restoreState( entryState, { recipe, sequence, captureError } );
					await settleRestoration( entryState, { recipe, sequence, captureError } );
					restoredState = await snapshotState( { recipe, sequence, phase: 'restored' } );
					restoredStateDigest = await digestState( restoredState );
					const verified = await verifyRestoration( {
						recipe,
						sequence,
						entryState,
						entryStateDigest,
						restoredState,
						restoredStateDigest
					} );
					if ( verified !== true ) throw new Error( 'Capture restoration verifier did not return true.' );
					restorationVerdict = 'PASS';

				} catch ( error ) {

					restorationError = error;
					restorationVerdict = 'FAIL';
					try {

						await poison( {
							recipeId: recipe.id,
							sequence,
							reason: errorMessage( error ),
							entryStateDigest,
							restoredStateDigest
						} );

					} catch ( poisonError ) {

						restorationError = new AggregateError( [ error, poisonError ], `Capture restoration and poison notification both failed for ${ recipe.id }.` );

					}

				}

			}
			active = null;

		}

		if ( captureError !== null && restorationError !== null ) throw new AggregateError(
			[ captureError, restorationError ],
			`Capture recipe ${ recipe.id } failed and restoration could not be proven.`
		);
		if ( captureError !== null ) throw captureError;
		if ( restorationError !== null ) throw restorationError;
		if ( captureResult === null || typeof captureResult !== 'object' || Array.isArray( captureResult ) ) throw new Error( `Capture recipe ${ recipe.id } returned no result object.` );

		return {
			...captureResult,
			transaction: freezeRecord( {
				schemaVersion: 1,
				status: 'COMMITTED',
				transactionId: `capture-${ sequence }`,
				sequence,
				recipeId: recipe.id,
				entryStateDigest,
				restoredStateDigest,
				restorationVerdict,
				phaseVerdicts: {
					capture: 'PASS',
					restore: 'PASS',
					settle: 'PASS',
					verify: 'PASS'
				}
			} )
		};

	}

	function status() {

		return freezeRecord( {
			active: active === null ? null : { ...active },
			poisoned: poisoned === null ? null : { ...poisoned },
			nextSequence
		} );

	}

	return Object.freeze( { assertAvailable, run, status } );

}
