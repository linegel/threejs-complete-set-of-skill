import assert from 'node:assert/strict';

const ENTRY_KEYS = new Set( [
	'accepts',
	'baseFixture',
	'check',
	'makeFixture',
	'rejects',
	'structuralRejects',
	'subjects',
	'validateRecord'
] );

function isPlainObject( value ) {

	if ( value === null || typeof value !== 'object' ) return false;
	const prototype = Object.getPrototypeOf( value );
	return prototype === Object.prototype || prototype === null;

}

function assertNonemptyString( value, label ) {

	assert.equal( typeof value, 'string', `${ label } must be a string` );
	assert.notEqual( value.trim(), '', `${ label } must not be empty` );

}

function fallbackClone( value, seen = new WeakMap() ) {

	if ( value === null || typeof value !== 'object' ) {

		assert.notEqual( typeof value, 'function', 'fixtures must not contain functions' );
		assert.notEqual( typeof value, 'symbol', 'fixtures must not contain symbols' );
		return value;

	}

	if ( seen.has( value ) ) return seen.get( value );

	if ( value instanceof Date ) return new Date( value.getTime() );
	if ( value instanceof RegExp ) return new RegExp( value.source, value.flags );
	if ( value instanceof ArrayBuffer ) return value.slice( 0 );
	if ( typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer ) {

		const copy = new SharedArrayBuffer( value.byteLength );
		new Uint8Array( copy ).set( new Uint8Array( value ) );
		return copy;

	}
	if ( ArrayBuffer.isView( value ) ) {

		if ( value instanceof DataView ) {

			const buffer = value.buffer.slice(
				value.byteOffset,
				value.byteOffset + value.byteLength
			);
			return new DataView( buffer );

		}
		return new value.constructor( value );

	}

	if ( Array.isArray( value ) ) {

		const copy = [];
		seen.set( value, copy );
		for ( const element of value ) copy.push( fallbackClone( element, seen ) );
		return copy;

	}

	if ( value instanceof Map ) {

		const copy = new Map();
		seen.set( value, copy );
		for ( const [ key, entryValue ] of value ) {

			copy.set( fallbackClone( key, seen ), fallbackClone( entryValue, seen ) );

		}
		return copy;

	}

	if ( value instanceof Set ) {

		const copy = new Set();
		seen.set( value, copy );
		for ( const entryValue of value ) copy.add( fallbackClone( entryValue, seen ) );
		return copy;

	}

	assert.ok( isPlainObject( value ), 'fixtures must contain structured-cloneable data records' );
	const copy = Object.create( Object.getPrototypeOf( value ) );
	seen.set( value, copy );
	for ( const key of Reflect.ownKeys( value ) ) {

		assert.equal( typeof key, 'string', 'fixtures must not contain symbol keys' );
		const descriptor = Object.getOwnPropertyDescriptor( value, key );
		assert.ok( descriptor && 'value' in descriptor, 'fixtures must not contain accessors' );
		copy[ key ] = fallbackClone( descriptor.value, seen );

	}
	return copy;

}

function cloneFixture( value ) {

	if ( typeof globalThis.structuredClone === 'function' ) return globalThis.structuredClone( value );
	return fallbackClone( value );

}

function keyedEntries( value, label ) {

	let entries;
	if ( value instanceof Map ) {

		entries = [ ...value.entries() ];

	} else {

		assert.ok( isPlainObject( value ), `${ label } must be a Map or plain object` );
		assert.equal(
			Object.getOwnPropertySymbols( value ).length,
			0,
			`${ label } must not contain symbol keys`
		);
		entries = Object.entries( value );

	}

	const result = new Map();
	for ( const [ key, entryValue ] of entries ) {

		assertNonemptyString( key, `${ label } key` );
		assert.ok( ! result.has( key ), `${ label } contains duplicate key ${ key }` );
		result.set( key, entryValue );

	}
	return result;

}

function exactKeyParity( actualKeys, expectedKeys, label ) {

	const actual = [ ...actualKeys ].sort();
	const expected = [ ...expectedKeys ].sort();
	assert.deepEqual( actual, expected, `${ label } keys must exactly match the schema` );

}

function assertSynchronousResult( result, label ) {

	assert.ok(
		result === null ||
			typeof result !== 'object' ||
			typeof result.then !== 'function',
		`${ label } must be synchronous`
	);

}

function schemaInvariants( schema ) {

	assert.ok( isPlainObject( schema ), 'schema must be a plain object' );
	const invariants = schema[ 'x-semantic-invariants' ];
	assert.ok( Array.isArray( invariants ), 'schema.x-semantic-invariants must be an array' );
	assert.ok( invariants.length > 0, 'schema.x-semantic-invariants must not be empty' );

	const ids = new Set();
	const validators = new Set();
	for ( const [ index, invariant ] of invariants.entries() ) {

		const prefix = `schema.x-semantic-invariants[${ index }]`;
		assert.ok( isPlainObject( invariant ), `${ prefix } must be a record` );
		assertNonemptyString( invariant.id, `${ prefix }.id` );
		assertNonemptyString( invariant.validator, `${ prefix }.validator` );
		assert.ok( ! ids.has( invariant.id ), `duplicate semantic invariant id ${ invariant.id }` );
		assert.ok(
			! validators.has( invariant.validator ),
			`duplicate semantic invariant validator ${ invariant.validator }`
		);
		ids.add( invariant.id );
		validators.add( invariant.validator );

		assert.ok( Array.isArray( invariant.appliesTo ), `${ prefix }.appliesTo must be an array` );
		assert.ok( invariant.appliesTo.length > 0, `${ prefix }.appliesTo must not be empty` );
		const appliesTo = new Set();
		for ( const [ subjectIndex, subjectName ] of invariant.appliesTo.entries() ) {

			assertNonemptyString( subjectName, `${ prefix }.appliesTo[${ subjectIndex }]` );
			assert.ok(
				! appliesTo.has( subjectName ),
				`${ prefix }.appliesTo contains duplicate ${ subjectName }`
			);
			appliesTo.add( subjectName );

		}

		assert.ok( isPlainObject( invariant.fixtures ), `${ prefix }.fixtures must be a record` );
		exactKeyParity(
			Object.keys( invariant.fixtures ),
			[ 'accept', 'reject' ],
			`${ prefix }.fixtures`
		);
		const allLabels = new Set();
		for ( const kind of [ 'accept', 'reject' ] ) {

			const labels = invariant.fixtures[ kind ];
			assert.ok( Array.isArray( labels ), `${ prefix }.fixtures.${ kind } must be an array` );
			assert.ok( labels.length > 0, `${ prefix }.fixtures.${ kind } must not be empty` );
			for ( const [ labelIndex, caseLabel ] of labels.entries() ) {

				assertNonemptyString(
					caseLabel,
					`${ prefix }.fixtures.${ kind }[${ labelIndex }]`
				);
				assert.ok(
					! allLabels.has( caseLabel ),
					`${ prefix } reuses fixture label ${ caseLabel }`
				);
				allLabels.add( caseLabel );

			}

		}

	}

	return invariants;

}

function assertRegistryEntry( invariant, entry ) {

	const label = `registry.${ invariant.validator }`;
	assert.ok( isPlainObject( entry ), `${ label } must be a plain object` );
	assert.equal(
		Object.getOwnPropertySymbols( entry ).length,
		0,
		`${ label } must not contain symbol keys`
	);
	for ( const key of Object.keys( entry ) ) {

		assert.ok( ENTRY_KEYS.has( key ), `${ label } has unsupported key ${ key }` );

	}

	assert.equal( typeof entry.check, 'function', `${ label }.check must be a function` );
	assert.equal(
		typeof entry.validateRecord,
		'function',
		`${ label }.validateRecord must be a function`
	);
	const hasFactory = Object.hasOwn( entry, 'makeFixture' );
	const hasBase = Object.hasOwn( entry, 'baseFixture' );
	assert.notEqual(
		hasFactory,
		hasBase,
		`${ label } must provide exactly one of makeFixture or baseFixture`
	);
	if ( hasFactory ) {

		assert.equal( typeof entry.makeFixture, 'function', `${ label }.makeFixture must be a function` );

	} else {

		assert.ok(
			entry.baseFixture !== null && typeof entry.baseFixture === 'object',
			`${ label }.baseFixture must be a data record`
		);

	}
	if ( Object.hasOwn( entry, 'subjects' ) ) {

		assert.equal( typeof entry.subjects, 'function', `${ label }.subjects must be a function` );

	}

	const accepts = keyedEntries( entry.accepts, `${ label }.accepts` );
	const rejects = keyedEntries( entry.rejects, `${ label }.rejects` );
	exactKeyParity( accepts.keys(), invariant.fixtures.accept, `${ label }.accepts` );
	exactKeyParity( rejects.keys(), invariant.fixtures.reject, `${ label }.rejects` );
	for ( const [ caseLabel, buildCase ] of [ ...accepts, ...rejects ] ) {

		assert.equal(
			typeof buildCase,
			'function',
			`${ label } fixture case ${ caseLabel } must be a function`
		);

	}
	const structuralRejects = keyedEntries( entry.structuralRejects ?? {}, `${ label }.structuralRejects` );
	for ( const [ caseLabel, declaration ] of structuralRejects ) {

		assert.ok( rejects.has( caseLabel ), `${ label }.structuralRejects names undeclared reject case ${ caseLabel}` );
		assert.ok( isPlainObject( declaration ), `${ label }.structuralRejects.${ caseLabel } must be a record` );
		exactKeyParity( Object.keys( declaration ), [ 'justification', 'subject' ], `${ label }.structuralRejects.${ caseLabel }` );
		assertNonemptyString( declaration.subject, `${ label }.structuralRejects.${ caseLabel }.subject` );
		assert.ok( invariant.appliesTo.includes( declaration.subject ), `${ label }.structuralRejects.${ caseLabel }.subject is not an appliesTo record` );
		assertNonemptyString( declaration.justification, `${ label }.structuralRejects.${ caseLabel }.justification` );
		assert.ok( declaration.justification.length <= 240, `${ label }.structuralRejects.${ caseLabel }.justification must remain concise` );

	}

	return { accepts, rejects, structuralRejects };

}

function makeCaseFixture( entry, buildCase, context ) {

	let fixture;
	if ( Object.hasOwn( entry, 'makeFixture' ) ) {

		const made = entry.makeFixture( context );
		assertSynchronousResult( made, `${ context.validator }.makeFixture` );
		fixture = cloneFixture( made );

	} else {

		fixture = cloneFixture( entry.baseFixture );

	}
	assert.ok( fixture !== null && typeof fixture === 'object', `${ context.invocation } fixture must be an object` );

	const built = buildCase( fixture, context );
	assertSynchronousResult( built, `${ context.invocation } case builder` );
	if ( built !== undefined ) fixture = built;
	assert.ok( fixture !== null && typeof fixture === 'object', `${ context.invocation } case must yield an object` );
	return fixture;

}

function subjectMapping( entry, invariant, fixture, context ) {

	let mapping;
	if ( entry.subjects ) {

		mapping = entry.subjects( fixture, context );
		assertSynchronousResult( mapping, `${ context.invocation } subjects` );

	} else if ( isPlainObject( fixture.subjects ) ) {

		mapping = fixture.subjects;

	} else {

		mapping = Object.fromEntries(
			invariant.appliesTo.map( ( subjectName ) => [ subjectName, fixture[ subjectName ] ] )
		);

	}

	const keyed = keyedEntries( mapping, `${ context.invocation } subjects` );
	exactKeyParity( keyed.keys(), invariant.appliesTo, `${ context.invocation } subjects` );
	return keyed;

}

const subjectSchemaRejections = new WeakMap();

function validateSubjects( entry, invariant, fixture, context ) {

	const mapping = subjectMapping( entry, invariant, fixture, context );
	let count = 0;
	for ( const subjectName of invariant.appliesTo ) {

		const supplied = mapping.get( subjectName );
		const records = Array.isArray( supplied ) ? supplied : [ supplied ];
		assert.ok( records.length > 0, `${ context.invocation } ${ subjectName } subjects must not be empty` );
		for ( const [ recordIndex, record ] of records.entries() ) {

			assert.ok(
				record !== null && typeof record === 'object' && ! Array.isArray( record ),
				`${ context.invocation } ${ subjectName }[${ recordIndex }] must be a record`
			);
			let result;
			try {

				result = entry.validateRecord( subjectName, record, context );

			} catch ( error ) {

				if ( error !== null && typeof error === 'object' ) subjectSchemaRejections.set( error, Object.freeze( { recordIndex, subjectName } ) );
				throw error;

			}
			assertSynchronousResult(
				result,
				`${ context.invocation } validateRecord(${ subjectName })`
			);
			if ( result === false ) {

				const error = new assert.AssertionError( { message: `${ context.invocation } ${ subjectName }[${ recordIndex }] failed record validation` } );
				subjectSchemaRejections.set( error, Object.freeze( { recordIndex, subjectName } ) );
				throw error;

			}
			count += 1;

		}

	}
	return count;

}

/**
 * Execute every schema-declared semantic invariant fixture through its named,
 * domain-specific validator. This function only orchestrates supplied
 * validators; it intentionally contains no generic semantic fallback.
 *
 * Registry entries are keyed by the exact `validator` string in the schema and
 * have this shape:
 *
 *     {
 *       check(fixture, context),
 *       makeFixture(context) | baseFixture,
 *       accepts: { "schema-case-label": buildCase },
 *       rejects: { "schema-case-label": buildCase },
 *       structuralRejects?: {
 *         "reject-label": {
 *           subject: "ExactAppliesToRecord",
 *           justification: "Why this invariant is identical to schema structure."
 *         }
 *       },
 *       validateRecord(recordName, record, context),
 *       subjects?(fixture, context)
 *     }
 *
 * A case builder mutates its fresh fixture or returns a replacement. Subjects
 * default to `fixture.subjects` or the fixture properties named by `appliesTo`.
 */
export function runSemanticInvariantRegistry( schema, registry ) {

	const invariants = schemaInvariants( schema );
	const entries = keyedEntries( registry, 'semantic invariant registry' );
	exactKeyParity(
		entries.keys(),
		invariants.map( ( invariant ) => invariant.validator ),
		'semantic invariant registry'
	);

	const prepared = new Map();
	for ( const invariant of invariants ) {

		prepared.set( invariant.validator, assertRegistryEntry( invariant, entries.get( invariant.validator ) ) );

	}

	const expectedInvocations = new Set();
	const actualInvocations = new Set();
	let acceptCaseCount = 0;
	let rejectCaseCount = 0;
	let subjectRecordValidationCount = 0;

	for ( const invariant of invariants ) {

		const entry = entries.get( invariant.validator );
		const cases = prepared.get( invariant.validator );
		for ( const [ kind, caseMap ] of [ [ 'accept', cases.accepts ], [ 'reject', cases.rejects ] ] ) {

			for ( const [ caseLabel, buildCase ] of caseMap ) {

				const invocation = `${ invariant.validator }:${ kind }:${ caseLabel }`;
				expectedInvocations.add( invocation );
				const context = Object.freeze( {
					caseLabel,
					invariant,
					invariantId: invariant.id,
					invocation,
					kind,
					schema,
					validator: invariant.validator
				} );
				const fixture = makeCaseFixture( entry, buildCase, context );
				if ( kind === 'accept' ) {

					subjectRecordValidationCount += validateSubjects(
						entry,
						invariant,
						fixture,
						context
					);

					const result = entry.check( fixture, context );
					assertSynchronousResult( result, `${ invocation } check` );
					assert.notEqual( result, false, `${ invocation } returned false` );
					acceptCaseCount += 1;

				} else {

					let subjectRejection;
					try {

						subjectRecordValidationCount += validateSubjects(
							entry,
							invariant,
							fixture,
							context
						);

					} catch ( error ) {

						subjectRejection = error;

					}
					if ( cases.structuralRejects.has( caseLabel ) ) {

						assert.ok( subjectRejection, `${ invocation } declares a structural rejection but its mutated subjects remain schema-valid` );
						assert.equal( subjectRejection?.name, 'AssertionError', `${ invocation } subject validation must reject with AssertionError` );
						const schemaRejection = subjectSchemaRejections.get( subjectRejection );
						assert.ok( schemaRejection, `${ invocation } structural rejection must fail validateRecord for its exact subject schema` );
						assert.equal( schemaRejection.subjectName, cases.structuralRejects.get( caseLabel ).subject, `${ invocation } failed a different subject schema than declared` );

					} else if ( subjectRejection ) {

						throw new assert.AssertionError( { message: `${ invocation } mutated an applicable subject structurally; declare and justify it as structural or keep the reject fixture schema-valid: ${ subjectRejection.message }` } );

					}
					let rejection;
					let result;
					try {

						result = entry.check( fixture, context );

					} catch ( error ) {

						rejection = error;

					}
					assertSynchronousResult( result, `${ invocation } check` );
					assert.ok( rejection, `${ invocation } must throw` );
					assert.equal( rejection?.name, 'AssertionError', `${ invocation } must reject through an assertion, not ${ rejection?.name ?? typeof rejection }` );
					assertNonemptyString( rejection?.message, `${ invocation } rejection message` );
					rejectCaseCount += 1;

				}

				actualInvocations.add( invocation );

			}

		}

	}

	exactKeyParity(
		actualInvocations,
		expectedInvocations,
		'semantic invariant invocation closure'
	);

	return Object.freeze( {
		acceptCaseCount,
		caseCount: acceptCaseCount + rejectCaseCount,
		invariantCount: invariants.length,
		invocationCount: actualInvocations.size,
		rejectCaseCount,
		subjectRecordValidationCount,
		validatorCount: entries.size
	} );

}
