const OMIT = Symbol( 'omit-renderer-info-value' );

function pathKey( path, key ) {

	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test( key ) ? `${ path }.${ key }` : `${ path }[${ JSON.stringify( key ) }]`;

}

function copyJsonValue( value, path, state, depth ) {

	if ( value === null || typeof value === 'string' || typeof value === 'boolean' ) return value;
	if ( typeof value === 'number' ) {

		if ( Number.isFinite( value ) ) return value;
		state.omissions.push( { path, reason: 'non-finite-number' } );
		return null;

	}
	if ( typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ) {

		state.omissions.push( { path, reason: `unsupported-${ typeof value }` } );
		return OMIT;

	}
	if ( depth > state.maximumDepth ) {

		state.omissions.push( { path, reason: 'maximum-depth' } );
		return OMIT;

	}
	if ( state.seen.has( value ) ) {

		state.omissions.push( { path, reason: 'cycle-or-shared-reference' } );
		return OMIT;

	}
	state.seen.add( value );

	if ( ArrayBuffer.isView( value ) || value instanceof ArrayBuffer ) {

		state.omissions.push( { path, reason: 'binary-data' } );
		return OMIT;

	}
	if ( value instanceof Date ) return value.toISOString();

	if ( Array.isArray( value ) ) {

		const result = [];
		for ( let index = 0; index < value.length; index ++ ) {

			const copied = copyJsonValue( value[ index ], `${ path }[${ index }]`, state, depth + 1 );
			if ( copied !== OMIT ) result.push( copied );

		}
		return result;

	}

	const result = {};
	for ( const key of Reflect.ownKeys( value ) ) {

		if ( typeof key !== 'string' ) {

			state.omissions.push( { path, reason: 'symbol-key' } );
			continue;

		}
		const descriptor = Object.getOwnPropertyDescriptor( value, key );
		if ( descriptor?.enumerable !== true ) continue;
		const childPath = pathKey( path, key );
		if ( ! descriptor || ! Object.hasOwn( descriptor, 'value' ) ) {

			state.omissions.push( { path: childPath, reason: 'accessor' } );
			continue;

		}
		const copied = copyJsonValue( descriptor.value, childPath, state, depth + 1 );
		if ( copied !== OMIT ) result[ key ] = copied;

	}
	return result;

}

/**
 * Convert WebGPURenderer.info into a bounded, JSON-safe diagnostic snapshot.
 * r185 renderer-info objects contain callbacks and may contain shared object
 * references, so structuredClone() is not a valid automation boundary.
 */
export function snapshotRendererInfo( info, options = {} ) {

	if ( info === null || typeof info !== 'object' ) throw new TypeError( 'renderer.info must be an object.' );
	const maximumDepth = options.maximumDepth ?? 8;
	if ( Number.isInteger( maximumDepth ) === false || maximumDepth < 1 ) throw new RangeError( 'maximumDepth must be a positive integer.' );
	const state = { maximumDepth, omissions: [], seen: new WeakSet() };
	const snapshot = copyJsonValue( info, '$', state, 0 );
	return {
		...snapshot,
		serialization: {
			policy: 'enumerable-data-properties-json-safe-v1',
			omissions: state.omissions
		}
	};

}
