const NUMERIC_LABELS = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );

export const NumericLabel = Object.freeze( {
	AUTHORED: 'Authored',
	DERIVED: 'Derived',
	MEASURED: 'Measured',
	GATED: 'Gated'
} );

function requireFiniteNumber( value, label ) {

	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) {

		throw new Error( `${ label } must be a finite number.` );

	}

}

function requireNonEmptyString( value, label ) {

	if ( typeof value !== 'string' || value.length === 0 ) {

		throw new Error( `${ label } must be a non-empty string.` );

	}

}

export function numericDatum( value, unit, label, source, uncertainty = undefined ) {

	const datum = { value, unit, label, source };
	if ( uncertainty !== undefined ) datum.uncertainty = uncertainty;
	validateNumericDatum( datum, 'numericDatum' );
	return datum;

}

export function numericArray( values, unit, label, source, uncertainty = undefined ) {

	const datum = { values: [ ...values ], unit, label, source };
	if ( uncertainty !== undefined ) datum.uncertainty = uncertainty;
	validateNumericArray( datum, 'numericArray' );
	return datum;

}

export function isNumericDatum( value ) {

	return value !== null && typeof value === 'object' && Array.isArray( value ) === false &&
		Object.hasOwn( value, 'value' ) && Object.hasOwn( value, 'unit' ) &&
		Object.hasOwn( value, 'label' ) && Object.hasOwn( value, 'source' );

}

export function isNumericArray( value ) {

	return value !== null && typeof value === 'object' && Array.isArray( value ) === false &&
		Object.hasOwn( value, 'values' ) && Object.hasOwn( value, 'unit' ) &&
		Object.hasOwn( value, 'label' ) && Object.hasOwn( value, 'source' );

}

export function validateNumericDatum( datum, path = 'numeric datum' ) {

	if ( isNumericDatum( datum ) === false ) {

		throw new Error( `${ path } must use { value, unit, label, source } numeric evidence.` );

	}

	requireFiniteNumber( datum.value, `${ path }.value` );
	requireNonEmptyString( datum.unit, `${ path }.unit` );
	requireNonEmptyString( datum.label, `${ path }.label` );
	requireNonEmptyString( datum.source, `${ path }.source` );

	if ( NUMERIC_LABELS.has( datum.label ) === false ) {

		throw new Error( `${ path}.label must be Authored, Derived, Measured, or Gated.` );

	}

	if ( datum.uncertainty !== undefined ) requireNonEmptyString( datum.uncertainty, `${ path }.uncertainty` );
	return true;

}

export function validateNumericArray( datum, path = 'numeric array' ) {

	if ( isNumericArray( datum ) === false ) {

		throw new Error( `${ path } must use { values, unit, label, source } numeric evidence.` );

	}

	if ( Array.isArray( datum.values ) === false || datum.values.length === 0 ) {

		throw new Error( `${ path }.values must be a non-empty array.` );

	}

	for ( const [ index, value ] of datum.values.entries() ) {

		requireFiniteNumber( value, `${ path }.values[${ index }]` );

	}

	requireNonEmptyString( datum.unit, `${ path }.unit` );
	requireNonEmptyString( datum.label, `${ path }.label` );
	requireNonEmptyString( datum.source, `${ path }.source` );

	if ( NUMERIC_LABELS.has( datum.label ) === false ) {

		throw new Error( `${ path}.label must be Authored, Derived, Measured, or Gated.` );

	}

	if ( datum.uncertainty !== undefined ) requireNonEmptyString( datum.uncertainty, `${ path }.uncertainty` );
	return true;

}

/**
 * Reject every bare finite number in evidence JSON. Schema metadata may opt in
 * to specific paths (for example schemaVersion). Numbers inside NumericDatum
 * and NumericArray records are validated by their own provenance records.
 */
export function assertLabelledNumerics( value, options = {} ) {

	const allowedBarePaths = new Set( options.allowedBarePaths ?? [ '$.schemaVersion' ] );

	function visit( entry, path ) {

		if ( typeof entry === 'number' ) {

			if ( Number.isFinite( entry ) === false ) throw new Error( `${ path } is non-finite.` );
			if ( allowedBarePaths.has( path ) === false ) {

				throw new Error( `${ path } is an unlabelled numeric value; use { value, unit, label, source }.` );

			}

			return;

		}

		if ( entry === null || typeof entry !== 'object' ) return;

		if ( isNumericDatum( entry ) ) {

			validateNumericDatum( entry, path );
			return;

		}

		if ( isNumericArray( entry ) ) {

			validateNumericArray( entry, path );
			return;

		}

		if ( Array.isArray( entry ) ) {

			for ( const [ index, child ] of entry.entries() ) visit( child, `${ path }[${ index }]` );
			return;

		}

		for ( const [ key, child ] of Object.entries( entry ) ) visit( child, `${ path }.${ key }` );

	}

	visit( value, '$' );
	return true;

}

export function numericValue( datum, path = 'numeric datum' ) {

	validateNumericDatum( datum, path );
	return datum.value;

}
