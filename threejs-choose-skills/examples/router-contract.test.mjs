import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVISION } from 'three/webgpu';

const here = dirname( fileURLToPath( import.meta.url ) );
const skillRoot = dirname( here );
const repoRoot = dirname( skillRoot );

const evidenceLabels = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );
const numericEvidenceKeys = [ 'value', 'unit', 'label', 'source' ];
const signalRegistryKeys = [
	'sceneColorRegistry',
	'depthRegistry',
	'normalRegistry',
	'velocityRegistry',
	'objectIdRegistry',
	'historyRegistry'
];
const sharedResourceOwnerKeys = [
	'gbuffer',
	'depth',
	'normal',
	'velocity',
	'history',
	'weatherEnvelope',
	'toneMap',
	'outputTransform',
	'adaptiveResolution'
];
const routeOwnerKeys = [
	'sourceOfTruth',
	'representation',
	'spatialFrame',
	'timebase',
	'semanticIds',
	'selectionPicking',
	'clipSection',
	'presentation',
	'validation'
];
async function readText( relativePath ) {

	return readFile( join( skillRoot, relativePath ), 'utf8' );

}

function escapeRegExp( value ) {

	return value.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

}

function extractSection( markdown, heading ) {

	const lines = markdown.split( '\n' );
	const start = lines.findIndex( ( line ) => line === `## ${ heading }` );

	assert.notEqual( start, - 1, `Missing section: ${ heading }` );

	let end = lines.length;
	for ( let i = start + 1; i < lines.length; i ++ ) {

		if ( lines[ i ].startsWith( '## ' ) ) {

			end = i;
			break;

		}

	}

	return lines.slice( start + 1, end ).join( '\n' );

}

function extractYamlBlock( markdown, label ) {

	const match = markdown.match( /```yaml\n([\s\S]*?)```/ );
	assert.ok( match, `${ label } is missing a YAML block` );
	return match[ 1 ];

}

function mappingBlock( yaml, key, indent = 0 ) {

	const lines = yaml.split( '\n' );
	const prefix = ' '.repeat( indent );
	const matcher = new RegExp( `^${ prefix }${ escapeRegExp( key ) }:\\s*(.*)$` );
	const start = lines.findIndex( ( line ) => matcher.test( line ) );

	assert.notEqual( start, - 1, `Missing YAML mapping: ${ key }` );

	const value = lines[ start ].match( matcher )[ 1 ].trim();
	let end = lines.length;

	for ( let i = start + 1; i < lines.length; i ++ ) {

		const line = lines[ i ];
		if ( line.trim() === '' || line.trimStart().startsWith( '#' ) ) continue;

		const currentIndent = line.match( /^ */ )[ 0 ].length;
		if ( currentIndent <= indent ) {

			end = i;
			break;

		}

	}

	return { value, lines: lines.slice( start + 1, end ), start, end };

}

function directChildren( yaml, key, indent = 0 ) {

	const block = mappingBlock( yaml, key, indent );
	const childIndent = indent + 2;
	const matcher = new RegExp( `^${ ' '.repeat( childIndent ) }([^\\s:#][^:]*):\\s*(.*)$` );
	const entries = new Map();

	for ( const line of block.lines ) {

		const match = line.match( matcher );
		if ( match ) entries.set( match[ 1 ].trim(), match[ 2 ].trim() );

	}

	return entries;

}

function topLevelKeys( yaml ) {

	return new Set( yaml.split( '\n' )
		.map( ( line ) => line.match( /^([A-Za-z][A-Za-z0-9]*):/ ) )
		.filter( Boolean )
		.map( ( match ) => match[ 1 ] ) );

}

function assertKeys( actualKeys, requiredKeys, label ) {

	for ( const key of requiredKeys ) {

		assert.ok( actualKeys.has( key ), `${ label } missing ${ key }` );

	}

}

function parseInlineList( value, label ) {

	assert.match( value, /^\[.*\]$/, `${ label } must be an inline list` );
	const body = value.slice( 1, - 1 ).trim();
	return body === '' ? [] : body.split( ',' ).map( ( entry ) => entry.trim() );

}

function assertUnique( values, label ) {

	assert.ok( Array.isArray( values ), `${ label } must be an array` );
	for ( const value of values ) assert.ok( typeof value === 'string' && value.trim() !== '', `${ label } contains an empty/non-string key` );
	assert.equal( new Set( values ).size, values.length, `${ label } contains duplicate keys` );

}

function isUnusedSignalValue( value ) {

	return /^not used\b/i.test( value ) || /^conditional\b/i.test( value );

}

function allocatedRegistryFromYaml( yaml, registryKey ) {

	const registry = directChildren( yaml, 'requiredSignals' ).get( registryKey );
	if ( registry === undefined || isUnusedSignalValue( registry ) ) return false;
	return registry === '';

}

function assertConsumedSignalsInYaml( yaml, label ) {

	const registries = directChildren( yaml, 'requiredSignals' );
	assert.deepEqual( [ ...registries.keys() ], signalRegistryKeys, `${ label } signal registry schema drift` );

	for ( const [ registryKey, value ] of registries ) {

		if ( isUnusedSignalValue( value ) ) continue;
		assert.equal( value, '', `${ label } ${ registryKey } scalar allocation has no consumer record` );

		const views = directChildren( yaml, registryKey, 2 );
		assert.ok( views.size > 0, `${ label } ${ registryKey } has no view-scoped signal` );

		for ( const [ viewKey, record ] of views ) {

			assert.match( record, /\bproducer:\s*[^,}]+/, `${ label } ${ registryKey}.${ viewKey } missing producer` );
			const consumers = record.match( /\bconsumers:\s*\[([^\]]*)\]/ );
			assert.ok( consumers, `${ label } ${ registryKey}.${ viewKey } missing consumers` );
			assert.notEqual( consumers[ 1 ].trim(), '', `${ label } ${ registryKey}.${ viewKey } is unconsumed` );

		}

	}

}

function assertInlineNumericEvidence( value, label ) {

	assert.match(
		value,
		/^\{\s*value:\s*[^,]+,\s*unit:\s*[^,]+,\s*label:\s*(Authored|Derived|Measured|Gated),\s*source:\s*[^}]+\}$/,
		`${ label } is malformed numeric evidence`
	);

}

function assertNoAutomaticGBufferInYaml( yaml, label ) {

	const shared = directChildren( yaml, 'sharedResourceOwners' );
	assert.deepEqual( [ ...shared.keys() ], sharedResourceOwnerKeys, `${ label } shared owner schema drift` );

	const registryBySharedKey = {
		depth: 'depthRegistry',
		normal: 'normalRegistry',
		velocity: 'velocityRegistry',
		history: 'historyRegistry'
	};

	for ( const [ sharedKey, registryKey ] of Object.entries( registryBySharedKey ) ) {

		if ( isUnusedSignalValue( shared.get( sharedKey ) ) ) continue;
		assert.ok(
			allocatedRegistryFromYaml( yaml, registryKey ),
			`${ label } allocates ${ sharedKey } without a consumed ${ registryKey } signal`
		);

	}

	if ( ! isUnusedSignalValue( shared.get( 'gbuffer' ) ) ) {

		const performance = directChildren( yaml, 'performanceContract' );
		assert.ok( performance.has( 'mrtDecision' ), `${ label } automatically allocates a G-buffer without an MRT decision` );
		assert.equal( performance.get( 'mrtDecision' ), '', `${ label } MRT decision must be a structured mapping` );
		const decision = directChildren( yaml, 'mrtDecision', 2 );
		assert.equal( decision.get( 'status' ), 'accepted', `${ label } G-buffer requires an accepted MRT decision` );
		assert.ok(
			parseInlineList( decision.get( 'consumerProof' ), `${ label } MRT consumerProof` ).length > 0,
			`${ label } G-buffer has no MRT consumer proof`
		);
		assert.ok(
			[ 'depthRegistry', 'normalRegistry', 'velocityRegistry', 'objectIdRegistry' ]
				.some( ( registryKey ) => allocatedRegistryFromYaml( yaml, registryKey ) ),
			`${ label } G-buffer has no consumed auxiliary signal`
		);

	}

}

function assertStructuredAcceptanceInYaml( yaml, label ) {

	const block = mappingBlock( yaml, 'acceptanceEvidence' );
	assert.equal( block.value, '', `${ label } acceptanceEvidence must be a mapping, not a flat value/list` );
	const fields = directChildren( yaml, 'acceptanceEvidence' );
	assertKeys(
		new Set( fields.keys() ),
		[ 'requiredDebugViews', 'requiredMetrics', 'requiredCommands', 'requiredArtifacts' ],
		`${ label } acceptanceEvidence`
	);

}

function assertNoAdditivePercentileText( text, label ) {

	assert.doesNotMatch(
		text,
		/selectedSkillMaxima|fixedOverhead|aggregateMs|subsystemPercentileSum|sumP50|sumP95|sum\s*\([^\n]*(p50|p95|percentile)/i,
		`${ label } contains additive subsystem-percentile accounting`
	);

}

function assertRecipeManifest( recipes, recipeName ) {

	const section = extractSection( recipes, recipeName );
	assert.match( section, /minimal skill set:/, `${ recipeName } missing minimal skill set` );
	const yaml = extractYamlBlock( section, recipeName );

	assertKeys(
		topLevelKeys( yaml ),
		[
			'backendManifest', 'workloadProfile', 'causeLedger', 'selectedSkills',
			'primaryOwner', 'deferredSkills', 'omittedSkills', 'owners',
			'requiredSignals', 'domainSignals', 'physicsContext', 'physicsGraph',
			'physicsCostLedger',
			'physicsSignals', 'physicsInteractions', 'physicsPresentationCandidate',
			'physicsCameraViewPublicationsByTarget',
			'physicsViewPreparationPublicationsByTarget',
			'physicsPresentationSnapshotsByTarget', 'frameExecutionRecord',
			'physicsPresentationSnapshot',
			'outputOwnersByPresentationTarget',
			'sharedResourceOwners', 'coverageStatus', 'performanceContract',
			'acceptanceEvidence'
		],
		recipeName
	);

	assertKeys(
		new Set( directChildren( yaml, 'workloadProfile' ).keys() ),
		[ 'domain', 'intent', 'truthContract', 'representation', 'interaction', 'temporal', 'scale', 'deployment' ],
		`${ recipeName } workloadProfile`
	);
	assertKeys(
		new Set( directChildren( yaml, 'causeLedger' ).keys() ),
		[ 'sourceOfTruth', 'primaryObservable', 'earliestMissingLayer', 'selectedAlgorithm', 'rejectedAlgorithms', 'noPostBaseline' ],
		`${ recipeName } causeLedger`
	);
	assert.deepEqual( [ ...directChildren( yaml, 'owners' ).keys() ], routeOwnerKeys, `${ recipeName } owner schema drift` );
	assert.match( yaml, /\$threejs-[a-z0-9-]+/, `${ recipeName } has no routed skill` );

	const performance = directChildren( yaml, 'performanceContract' );
	assertKeys( new Set( performance.keys() ), [ 'routeStatus', 'frameInterval', 'passKeys' ], `${ recipeName } performanceContract` );
	assertInlineNumericEvidence( performance.get( 'frameInterval' ), `${ recipeName } frameInterval` );
	assertUnique( parseInlineList( performance.get( 'passKeys' ), `${ recipeName } passKeys` ), `${ recipeName } passKeys` );

	assertConsumedSignalsInYaml( yaml, recipeName );
	assertPhysicsFieldsInYaml( yaml, recipeName );
	assertNoAutomaticGBufferInYaml( yaml, recipeName );
	assertStructuredAcceptanceInYaml( yaml, recipeName );
	assertNoAdditivePercentileText( yaml, recipeName );

}

function assertPhysicsFieldsInYaml( yaml, label ) {

	const context = mappingBlock( yaml, 'physicsContext' ).value;
	const graph = mappingBlock( yaml, 'physicsGraph' ).value;
	const cost = mappingBlock( yaml, 'physicsCostLedger' ).value;
	const signals = mappingBlock( yaml, 'physicsSignals' ).value;
	const interactions = mappingBlock( yaml, 'physicsInteractions' ).value;
	const candidate = mappingBlock( yaml, 'physicsPresentationCandidate' ).value;
	const cameras = mappingBlock( yaml, 'physicsCameraViewPublicationsByTarget' ).value;
	const preparations = mappingBlock( yaml, 'physicsViewPreparationPublicationsByTarget' ).value;
	const snapshots = mappingBlock( yaml, 'physicsPresentationSnapshotsByTarget' ).value;
	const execution = mappingBlock( yaml, 'frameExecutionRecord' ).value;
	const deprecatedSnapshot = mappingBlock( yaml, 'physicsPresentationSnapshot' ).value;
	const isPhysical = context === '';
	assert.match( deprecatedSnapshot, /^not used\b/i, `${ label } deprecated singular physicsPresentationSnapshot must remain not used` );

	if ( ! isPhysical ) {

		assert.match( context, /^not used\b/i, `${ label } nonphysical physicsContext must be not used` );
		assert.match( graph, /^not used\b/i, `${ label } nonphysical physicsGraph must be not used` );
		assert.match( cost, /^not used\b/i, `${ label } nonphysical physicsCostLedger must be not used` );
		assert.equal( signals, '{}', `${ label } nonphysical physicsSignals must be empty` );
		assert.equal( interactions, '[]', `${ label } nonphysical physicsInteractions must be empty` );
		assert.match( candidate, /^not used\b/i, `${ label } nonphysical physicsPresentationCandidate must be not used` );
		assert.equal( cameras, '{}', `${ label } nonphysical physicsCameraViewPublicationsByTarget must be empty` );
		assert.equal( preparations, '{}', `${ label } nonphysical physicsViewPreparationPublicationsByTarget must be empty` );
		assert.equal( snapshots, '{}', `${ label } nonphysical physicsPresentationSnapshotsByTarget must be empty` );
		assert.match( execution, /^not used\b/i, `${ label } nonphysical frameExecutionRecord must be not used` );
		return;

	}

	assert.equal( graph, '', `${ label } physical physicsGraph must be a mapping` );
	assert.equal( cost, '', `${ label } physical physicsCostLedger must be a mapping` );
	assert.equal( signals, '', `${ label } physical physicsSignals must be a mapping` );
	assert.ok( interactions === '' || /^\[\]/.test( interactions ), `${ label } physical physicsInteractions must be a sequence or explicit empty sequence` );
	assert.equal( candidate, '', `${ label } physical physicsPresentationCandidate must be a mapping` );
	assert.equal( cameras, '', `${ label } physical physicsCameraViewPublicationsByTarget must be a mapping` );
	assert.equal( preparations, '', `${ label } physical physicsViewPreparationPublicationsByTarget must be a mapping` );
	assert.equal( snapshots, '', `${ label } physical physicsPresentationSnapshotsByTarget must be a mapping` );
	assert.equal( execution, '', `${ label } physical frameExecutionRecord must be a mapping` );

}

function isPlainObject( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function typedAbsence( reason = 'not-applicable', authority = 'fixture-owner', effectiveTime = 'timeless', provenance = 'canonical-fixture' ) {

	return { kind: 'absent', reason, authority, schemaId: 'typed-absence-v1', effectiveTime, provenance };

}

function isTypedAbsence( value ) {

	return isPlainObject( value ) && value.kind === 'absent' && abiRecord( 'TypedAbsence' ).required.every( ( key ) => Object.hasOwn( value, key ) );

}

function requireObjectKeys( object, keys, label ) {

	assert.ok( isPlainObject( object ), `${ label } must be a mapping` );
	for ( const key of keys ) assert.ok( Object.hasOwn( object, key ), `${ label } missing ${ key }` );

}

function validateNumericEvidence( value, path = 'route' ) {

	if ( typeof value === 'number' || ( typeof value === 'string' && /^-?\d+(\.\d+)?$/.test( value ) ) ) {

		if ( ( /\.(tick|epochTick|numerator|denominator|requestSequence|producerSequence|executionSequence|firstSequence|lastSequence|lastSequenceInclusive|nextSequence|cursorBefore|cursorAfter|iterationIndex|producedIterationOffset|consumedIterationOffset|count|elementCount)$/.test( path ) || /\.perConsumerCursor\.[^.]+$/.test( path ) || /\.identitySlotMap\.[^.]+$/.test( path ) ) && Number.isInteger( Number( value ) ) ) return;
		throw new Error( `${ path } is a bare numeric value` );

	}

	if ( Array.isArray( value ) ) {

		for ( let i = 0; i < value.length; i ++ ) validateNumericEvidence( value[ i ], `${ path }[${ i }]` );
		return;

	}

	if ( ! isPlainObject( value ) ) return;

	const evidenceKeyCount = numericEvidenceKeys.filter( ( key ) => Object.hasOwn( value, key ) ).length;
	// Unit-bearing schema descriptors are not themselves numeric evidence. A
	// record enters the quantitative-evidence branch only when it carries a
	// value or evidence label.
	const declaresEvidence = [ 'value', 'label' ].some( ( key ) => Object.hasOwn( value, key ) );
	if ( declaresEvidence ) {

		assert.equal( evidenceKeyCount, numericEvidenceKeys.length, `${ path } malformed numeric evidence` );
		assert.deepEqual( Object.keys( value ).sort(), [ ...numericEvidenceKeys ].sort(), `${ path } numeric evidence has extra/missing fields` );
		assert.ok( evidenceLabels.has( value.label ), `${ path } has invalid evidence label` );
		assert.notEqual( String( value.unit ).trim(), '', `${ path } missing unit` );
		assert.notEqual( String( value.source ).trim(), '', `${ path } missing source` );
		return;

	}

	for ( const [ key, child ] of Object.entries( value ) ) validateNumericEvidence( child, `${ path}.${ key}` );

}

function validateSignalRegistries( route ) {

	requireObjectKeys( route.requiredSignals, signalRegistryKeys, 'requiredSignals' );

	for ( const registryKey of signalRegistryKeys ) {

		const registry = route.requiredSignals[ registryKey ];
		if ( typeof registry === 'string' && isUnusedSignalValue( registry ) ) continue;
		assert.ok( isPlainObject( registry ), `${ registryKey } must be a keyed registry or not used` );
		assert.ok( Object.keys( registry ).length > 0, `${ registryKey } is allocated without a view-scoped signal` );

		for ( const [ viewKey, record ] of Object.entries( registry ) ) {

			requireObjectKeys( record, [ 'producer', 'consumers' ], `${ registryKey }.${ viewKey}` );
			assert.notEqual( String( record.producer ).trim(), '', `${ registryKey }.${ viewKey } missing producer` );
			assert.ok( Array.isArray( record.consumers ) && record.consumers.length > 0, `${ registryKey }.${ viewKey } is unconsumed` );

		}

	}

}

function registryIsAllocated( registry ) {

	return isPlainObject( registry ) && Object.keys( registry ).length > 0;

}

function isNotUsedRecord( value ) {

	return typeof value === 'string' && /^not used\b/i.test( value );

}

function requireNonEmptyString( value, label ) {

	assert.ok( typeof value === 'string' && value.trim() !== '', `${ label } must be a non-empty string` );

}

function requireNonEmptyMapping( value, label ) {

	assert.ok( isPlainObject( value ) && Object.keys( value ).length > 0, `${ label } must be a non-empty mapping` );

}

function assertInlineNumericEvidenceObject( value, label ) {

	requireObjectKeys( value, numericEvidenceKeys, label );
	assert.deepEqual( Object.keys( value ).sort(), [ ...numericEvidenceKeys ].sort(), `${ label } numeric evidence has extra/missing fields` );
	assert.ok( evidenceLabels.has( value.label ), `${ label } has invalid evidence label` );
	requireNonEmptyString( String( value.unit ), `${ label }.unit` );
	requireNonEmptyString( String( value.source ), `${ label }.source` );

}

let physicsAbiSchema;
const clockMappingResourceFixtures = new Map();

function abiRecord( name ) {

	const record = physicsAbiSchema?.records?.[ name ] ?? physicsAbiSchema?.[ 'x-abi' ]?.records?.[ name ];
	assert.ok( record, `physics ABI schema missing records.${ name }` );
	const required = Array.isArray( record ) ? record : record.required;
	assert.ok( Array.isArray( required ), `physics ABI schema record ${ name } has no required-key list` );
	return { ...record, required };

}

function abiEnum( name ) {

	const abi = physicsAbiSchema?.[ 'x-abi' ];
	const values = physicsAbiSchema?.enums?.[ name ] ?? abi?.enums?.[ name ] ?? abi?.[ name ];
	assert.ok( Array.isArray( values ) && values.length > 0, `physics ABI schema missing enums.${ name }` );
	return values;

}

function requireAbiRecord( value, recordName, label ) {

	requireObjectKeys( value, abiRecord( recordName ).required, label );
	return value;

}

function requireAbiEnum( value, enumName, label ) {

	assert.ok( abiEnum( enumName ).includes( value ), `${ label } is not a canonical ${ enumName } value` );

}

function validateNonphysicalPhysicsContract( route ) {

	requireObjectKeys( route, [
		'physicsContext', 'physicsGraph', 'physicsCostLedger', 'physicsSignals',
		'physicsInteractions', 'physicsPresentationCandidate',
		'physicsCameraViewPublicationsByTarget',
		'physicsViewPreparationPublicationsByTarget',
		'physicsPresentationSnapshotsByTarget', 'frameExecutionRecord',
		'physicsPresentationSnapshot'
	], 'route physics contract' );
	assert.ok( isNotUsedRecord( route.physicsContext ), 'nonphysical physicsContext must be not used' );
	assert.ok( isNotUsedRecord( route.physicsGraph ), 'nonphysical physicsGraph must be not used' );
	assert.ok( isNotUsedRecord( route.physicsCostLedger ), 'nonphysical physicsCostLedger must be not used' );
	assert.deepEqual( route.physicsSignals, {}, 'nonphysical physicsSignals must be empty' );
	assert.deepEqual( route.physicsInteractions, [], 'nonphysical physicsInteractions must be empty' );
	assert.ok( isNotUsedRecord( route.physicsPresentationCandidate ), 'nonphysical physicsPresentationCandidate must be not used' );
	assert.deepEqual( route.physicsCameraViewPublicationsByTarget, {}, 'nonphysical camera publications must be empty' );
	assert.deepEqual( route.physicsViewPreparationPublicationsByTarget, {}, 'nonphysical view preparations must be empty' );
	assert.deepEqual( route.physicsPresentationSnapshotsByTarget, {}, 'nonphysical snapshots must be empty' );
	assert.ok( isNotUsedRecord( route.frameExecutionRecord ), 'nonphysical frameExecutionRecord must be not used' );
	assert.ok( isNotUsedRecord( route.physicsPresentationSnapshot ), 'deprecated singular snapshot must remain not used' );

}

function findForbiddenPerformanceKey( value, path = 'performanceContract' ) {

	if ( Array.isArray( value ) ) {

		for ( let i = 0; i < value.length; i ++ ) findForbiddenPerformanceKey( value[ i ], `${ path }[${ i }]` );
		return;

	}
	if ( ! isPlainObject( value ) ) return;

	for ( const [ key, child ] of Object.entries( value ) ) {

		assert.doesNotMatch(
			key,
			/selectedSkillMaxima|fixedOverhead|aggregateMs|subsystemPercentileSum|sumP50|sumP95/i,
			`${ path}.${ key} encodes additive subsystem accounting`
		);

		if ( [ 'basis', 'method', 'strategy', 'formula' ].includes( key ) && typeof child === 'string' ) {

			assert.doesNotMatch(
				child,
				/sum[-_ ]*(subsystem|skill)[-_ ]*(p50|p95|percentile)|additive[-_ ]*(subsystem|percentile)/i,
				`${ path}.${ key} adds subsystem percentiles`
			);

		}

		findForbiddenPerformanceKey( child, `${ path}.${ key}` );

	}

}

function validateRouteManifest( route ) {

	requireObjectKeys( route, [
		'backendManifest', 'workloadProfile', 'causeLedger', 'selectedSkills',
		'primaryOwner', 'deferredSkills', 'omittedSkills', 'owners',
		'requiredSignals', 'domainSignals', 'physicsContext', 'physicsGraph',
		'physicsCostLedger', 'physicsSignals', 'physicsInteractions',
		'physicsPresentationCandidate', 'physicsCameraViewPublicationsByTarget',
		'physicsViewPreparationPublicationsByTarget',
		'physicsPresentationSnapshotsByTarget', 'frameExecutionRecord',
		'physicsPresentationSnapshot',
		'outputOwnersByPresentationTarget',
		'sharedResourceOwners', 'performanceContract', 'coverageStatus',
		'acceptanceEvidence'
	], 'route' );
	requireObjectKeys( route.workloadProfile, [
		'domain', 'intent', 'truthContract', 'representation', 'interaction',
		'temporal', 'scale', 'deployment', 'updateLatencyBound'
	], 'workloadProfile' );
	requireObjectKeys( route.causeLedger, [
		'sourceOfTruth', 'primaryObservable', 'earliestMissingLayer',
		'selectedAlgorithm', 'rejectedAlgorithms', 'noPostBaseline'
	], 'causeLedger' );
	requireObjectKeys( route.owners, routeOwnerKeys, 'owners' );
	assert.ok( Array.isArray( route.selectedSkills ) && route.selectedSkills.length > 0, 'selectedSkills must be non-empty' );
	assert.notEqual( String( route.primaryOwner ).trim(), '', 'primaryOwner must be non-empty' );

	validateSignalRegistries( route );
	if ( isPlainObject( route.physicsContext ) && route.physicsContext.schemaId === physicsAbiSchema?.$id ) validateCanonicalPhysicsContract( route );
	else validateNonphysicalPhysicsContract( route );
	assert.ok( isPlainObject( route.outputOwnersByPresentationTarget ), 'outputOwnersByPresentationTarget must be a mapping' );
	assert.ok( Object.keys( route.outputOwnersByPresentationTarget ).length > 0, 'outputOwnersByPresentationTarget must be non-empty' );
	for ( const [ target, owners ] of Object.entries( route.outputOwnersByPresentationTarget ) ) {

		requireObjectKeys( owners, [ 'toneMap', 'outputTransform', 'adaptiveQuality' ], `outputOwnersByPresentationTarget.${ target }` );

	}
	requireObjectKeys( route.sharedResourceOwners, sharedResourceOwnerKeys, 'sharedResourceOwners' );

	const registryBySharedKey = {
		depth: 'depthRegistry',
		normal: 'normalRegistry',
		velocity: 'velocityRegistry',
		history: 'historyRegistry'
	};
	for ( const [ sharedKey, registryKey ] of Object.entries( registryBySharedKey ) ) {

		if ( isUnusedSignalValue( route.sharedResourceOwners[ sharedKey ] ) ) continue;
		assert.ok( registryIsAllocated( route.requiredSignals[ registryKey ] ), `${ sharedKey } owner has no consumed ${ registryKey }` );

	}

	requireObjectKeys( route.performanceContract, [
		'aggregationPolicy', 'drawAccounting', 'mrtDecision', 'passKeys',
		'passLedger', 'qualityController', 'routeStatus'
	], 'performanceContract' );
	assertUnique( route.performanceContract.passKeys, 'performanceContract.passKeys' );
	assertUnique( route.performanceContract.passLedger.map( ( pass ) => pass.key ), 'performanceContract.passLedger' );
	for ( const [ index, pass ] of route.performanceContract.passLedger.entries() ) requireObjectKeys( pass, [
		'key', 'runtimeRole', 'accountingOwner', 'viewScope', 'producer', 'consumers',
		'kind', 'clockId', 'cadence', 'substepMultiplicity',
		'executionsPerPresentedFrame', 'hotBytesPerExecution',
		'sourceReactionOrConservationGroups'
	], `performanceContract.passLedger[${ index }]` );
	if ( Array.isArray( route.performanceContract.workLedger ) ) {

		assertUnique( route.performanceContract.workLedger.map( ( work ) => work.workId ), 'performanceContract.workLedger' );

	}

	const batchedMeshModel = route.performanceContract.drawAccounting.batchedMeshModel;
	assert.doesNotMatch(
		batchedMeshModel,
		/(one|single).*draw.*batchedmesh|batchedmesh.*(one|single).*draw/i,
		'BatchedMesh cannot be budgeted as one GPU draw per material family'
	);

	if ( ! isUnusedSignalValue( route.sharedResourceOwners.gbuffer ) ) {

		assert.equal( route.performanceContract.mrtDecision.status, 'accepted', 'G-buffer allocation requires an accepted MRT decision' );
		assert.ok( route.performanceContract.mrtDecision.consumerProof.length > 0, 'G-buffer allocation requires consumer proof' );
		const auxiliaryRegistries = [ 'depthRegistry', 'normalRegistry', 'velocityRegistry', 'objectIdRegistry' ];
		assert.ok(
			auxiliaryRegistries.some( ( key ) => registryIsAllocated( route.requiredSignals[ key ] ) ),
			'G-buffer allocation requires a consumed auxiliary signal'
		);

	}

	assert.ok( isPlainObject( route.acceptanceEvidence ), 'acceptanceEvidence must be a mapping' );
	requireObjectKeys(
		route.acceptanceEvidence,
		[ 'requiredDebugViews', 'requiredMetrics', 'requiredCommands', 'requiredArtifacts' ],
		'acceptanceEvidence'
	);
	for ( const value of Object.values( route.acceptanceEvidence ) ) assert.ok( Array.isArray( value ), 'acceptanceEvidence fields must be arrays' );

	findForbiddenPerformanceKey( route.performanceContract );
	validateNumericEvidence( route );

}

function evidence( value, unit, label, source ) {

	return { value, unit, label, source };

}

function makePositiveFixture( spec ) {

	const sceneKey = `${ spec.domain }.main.scene`;
	const presentKey = `${ spec.domain }.main.present`;
	const requiredSignals = {
		sceneColorRegistry: {
			main: {
				producer: sceneKey,
				consumers: [ presentKey ],
				resolution: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport-and-dpr' )
			}
		},
		depthRegistry: 'not used',
		normalRegistry: 'not used',
		velocityRegistry: 'not used',
		objectIdRegistry: spec.objectIds ? {
			main: { producer: `${ spec.domain }.main.object-id`, consumers: [ 'selection' ] }
		} : 'not used',
		historyRegistry: 'not used'
	};

	return {
		backendManifest: {
			requiredReleaseBand: evidence( 185, 'revision', 'Gated', 'repository-contract' ),
			installedPackageVersion: evidence( '0.185.1', 'semver', 'Measured', 'installed-package' ),
			runtimeRevision: evidence( 185, 'revision', 'Measured', 'runtime-import' ),
			requiredBackend: evidence( 'WebGPU', 'backend', 'Gated', 'flagship-contract' ),
			actualBackend: evidence( 'WebGPU', 'backend', 'Measured', 'initialized-renderer' )
		},
		workloadProfile: {
			domain: spec.domain,
			intent: spec.intent,
			truthContract: spec.truthContract,
			representation: spec.representation,
			interaction: spec.interaction,
			temporal: spec.temporal,
			scale: spec.scale,
			deployment: [ 'representative-mobile-webgpu', 'representative-desktop-webgpu' ],
			updateLatencyBound: evidence( 50, 'ms', 'Gated', 'fixture-contract' )
		},
		causeLedger: {
			sourceOfTruth: spec.sourceOfTruth,
			primaryObservable: spec.primaryObservable,
			earliestMissingLayer: spec.earliestMissingLayer,
			selectedAlgorithm: spec.selectedAlgorithm,
			rejectedAlgorithms: [ 'post-before-source-signal' ],
			noPostBaseline: spec.noPostBaseline
		},
		selectedSkills: spec.selectedSkills,
		primaryOwner: spec.primaryOwner,
		deferredSkills: [],
		omittedSkills: [ 'automatic-full-gbuffer' ],
		owners: {
			sourceOfTruth: spec.sourceOfTruth,
			representation: spec.primaryOwner,
			spatialFrame: 'domain-frame-owner',
			timebase: 'domain-time-owner',
			semanticIds: spec.objectIds ? 'stable-id-owner' : 'not used',
			selectionPicking: spec.objectIds ? 'selection-owner' : 'not used',
			clipSection: 'not used',
			presentation: '$threejs-image-pipeline',
			validation: '$threejs-visual-validation'
		},
		requiredSignals,
		domainSignals: {},
		physicsContext: 'not used',
		physicsGraph: 'not used',
		physicsCostLedger: 'not used',
		physicsSignals: {},
		physicsInteractions: [],
		physicsPresentationCandidate: 'not used',
		physicsCameraViewPublicationsByTarget: {},
		physicsViewPreparationPublicationsByTarget: {},
		physicsPresentationSnapshotsByTarget: {},
		frameExecutionRecord: 'not used',
		physicsPresentationSnapshot: 'not used (deprecated compatibility projection)',
		outputOwnersByPresentationTarget: {
			main: {
				toneMap: 'fixed-domain-policy',
				outputTransform: '$threejs-image-pipeline',
				adaptiveQuality: 'truth-gated-controller'
			}
		},
		sharedResourceOwners: {
			gbuffer: 'not used',
			depth: 'not used',
			normal: 'not used',
			velocity: 'not used',
			history: 'not used',
			weatherEnvelope: 'not used',
			toneMap: 'fixed-domain-policy',
			outputTransform: '$threejs-image-pipeline',
			adaptiveResolution: 'truth-gated-controller'
		},
		performanceContract: {
			requestedRefresh: evidence( 60, 'Hz', 'Authored', 'fixture-brief' ),
			actualDisplayRefresh: evidence( 60, 'Hz', 'Measured', 'fixture-run' ),
			frozenTargetRefresh: evidence( 60, 'Hz', 'Gated', 'fixture-envelope' ),
			frameInterval: evidence( 16.6667, 'ms', 'Derived', 'frozen-target-refresh' ),
			cpuP95Budget: evidence( 8, 'ms', 'Gated', 'fixture-cpu-envelope' ),
			gpuP95Budget: evidence( 10, 'ms', 'Gated', 'fixture-gpu-envelope' ),
			presentedP95Budget: evidence( 16.6667, 'ms', 'Gated', 'fixture-presentation-contract' ),
			peakLiveMemoryBudget: evidence( 134217728, 'bytes', 'Gated', 'fixture-memory-contract' ),
			interactionReserve: evidence( 1, 'ms', 'Authored', 'planning-only' ),
			aggregationPolicy: {
				basis: 'composed-full-frame-plus-paired-sample-marginals',
				acceptance: 'measured-composed-frame',
				forbidden: [ 'standalone-total-addition', 'subsystem-percentile-addition', 'fixed-time-overhead' ]
			},
			drawAccounting: {
				source: 'renderer-info-plus-backend-trace',
				batchedMeshModel: 'backend-multidraw-entries-measured'
			},
			mrtDecision: {
				status: 'not-used',
				attachments: [],
				consumerProof: [],
				targetABEvidence: []
			},
			passKeys: [ sceneKey, presentKey ],
			passLedger: [
				{
					key: sceneKey,
					runtimeRole: 'shared',
					accountingOwner: spec.primaryOwner,
					producer: spec.primaryOwner,
					consumers: [ presentKey ],
					kind: 'render',
					clockId: 'not used', cadence: 'per-presented-frame', substepMultiplicity: 'not used', executionsPerPresentedFrame: evidence( 1, 'execution-per-frame', 'Authored', 'fixture-route' ),
					viewScope: {
						view: 'main',
						timeSample: evidence( 0, 'seconds', 'Authored', 'fixture-path' )
					},
					resolution: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport-and-dpr' ),
					sampleCount: evidence( 1, 'samples-per-pixel', 'Measured', 'fixture-pass' ),
					hotBytesPerExecution: evidence( 7372800, 'bytes-per-execution', 'Derived', 'fixture-pass-resources' ), sourceReactionOrConservationGroups: [],
					timing: {
						p50: evidence( 4, 'ms', 'Measured', 'fixture-gpu-trace' ),
						p95: evidence( 6, 'ms', 'Measured', 'fixture-gpu-trace' )
					}
				},
				{
					key: presentKey,
					runtimeRole: 'exclusive',
					accountingOwner: '$threejs-image-pipeline',
					producer: '$threejs-image-pipeline',
					consumers: [ 'display' ],
					kind: 'present',
					clockId: 'not used', cadence: 'per-presented-frame', substepMultiplicity: 'not used', executionsPerPresentedFrame: evidence( 1, 'execution-per-frame', 'Authored', 'fixture-route' ),
					viewScope: {
						view: 'main',
						timeSample: evidence( 0, 'seconds', 'Authored', 'fixture-path' )
					},
					resolution: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport-and-dpr' ),
					sampleCount: evidence( 1, 'samples-per-pixel', 'Measured', 'fixture-pass' ),
					hotBytesPerExecution: evidence( 7372800, 'bytes-per-execution', 'Derived', 'fixture-pass-resources' ), sourceReactionOrConservationGroups: [],
					timing: {
						p50: evidence( 0.5, 'ms', 'Measured', 'fixture-gpu-trace' ),
						p95: evidence( 0.8, 'ms', 'Measured', 'fixture-gpu-trace' )
					}
				}
			],
			workLedger: [
				{ workId: `${ spec.domain }.domain-update`, runtimeRole: 'exclusive' }
			],
			qualityController: {
				samplingWindow: evidence( 120, 'frames', 'Authored', 'fixture-controller' ),
				downgradePersistence: evidence( 2, 'windows', 'Authored', 'fixture-controller' ),
				upgradePersistence: evidence( 4, 'windows', 'Authored', 'fixture-controller' ),
				headroom: evidence( 0.15, 'budget-fraction', 'Authored', 'fixture-controller' ),
				cooldown: evidence( 3, 'windows', 'Authored', 'fixture-controller' )
			},
			routeStatus: 'provisional'
		},
		coverageStatus: spec.coverageStatus,
		acceptanceEvidence: {
			requiredDebugViews: [ 'truth-view', 'no-post' ],
			requiredMetrics: [ 'composed-p50-p95', 'domain-error' ],
			requiredCommands: [ 'fixture-validation' ],
			requiredArtifacts: [ 'pass-ledger', 'sustained-trace' ]
		}
	};

}

function clone( value ) {

	return JSON.parse( JSON.stringify( value ) );

}

function quantityValue( value, label ) {

	assertInlineNumericEvidenceObject( value, label );
	return value.value;

}

function integerGcd( a, b ) {

	a = Math.abs( a );
	b = Math.abs( b );
	while ( b !== 0 ) [ a, b ] = [ b, a % b ];
	return a;

}

function matrix3Value( value, label ) {

	const matrix = quantityValue( value, label );
	assert.ok( Array.isArray( matrix ) && matrix.length === 9 && matrix.every( Number.isFinite ), `${ label } must contain nine finite components` );
	return matrix;

}

function assertProperRotation( value, label ) {

	const m = matrix3Value( value, label );
	const dot = ( a, b ) => m[ a ] * m[ b ] + m[ a + 3 ] * m[ b + 3 ] + m[ a + 6 ] * m[ b + 6 ];
	for ( let column = 0; column < 3; column ++ ) {

		assert.ok( Math.abs( dot( column, column ) - 1 ) < 1e-12, `${ label } is not orthonormal` );
		for ( let other = column + 1; other < 3; other ++ ) assert.ok( Math.abs( dot( column, other ) ) < 1e-12, `${ label } is not orthogonal` );

	}
	const determinant =
		m[ 0 ] * ( m[ 4 ] * m[ 8 ] - m[ 5 ] * m[ 7 ] ) -
		m[ 1 ] * ( m[ 3 ] * m[ 8 ] - m[ 5 ] * m[ 6 ] ) +
		m[ 2 ] * ( m[ 3 ] * m[ 7 ] - m[ 4 ] * m[ 6 ] );
	assert.ok( Math.abs( determinant - 1 ) < 1e-12, `${ label } must have determinant +1` );

}

function canonicalClock( context, clockId, label ) {

	const clock = Object.values( context.physicsClockRegistry ).find( ( candidate ) => candidate.clockId === clockId );
	assert.ok( clock, `${ label } references unregistered clock ${ clockId }` );
	return clock;

}

function instantCoordinate( instantKey, label ) {

	requireObjectKeys( instantKey, [ 'tick', 'rationalSubstep' ], label );
	assert.ok( Number.isSafeInteger( instantKey.tick ), `${ label }.tick must be a structural integer` );
	requireObjectKeys( instantKey.rationalSubstep, [ 'numerator', 'denominator' ], `${ label }.rationalSubstep` );
	const { numerator, denominator } = instantKey.rationalSubstep;
	assert.ok( Number.isSafeInteger( numerator ) && Number.isSafeInteger( denominator ), `${ label }.rationalSubstep must be structural integers` );
	assert.ok( denominator > 0 && numerator >= 0 && numerator < denominator, `${ label }.rationalSubstep is outside canonical range` );
	assert.equal( integerGcd( numerator, denominator ), 1, `${ label }.rationalSubstep is not reduced` );
	return instantKey.tick + numerator / denominator;

}

function rationalQuantityValue( quantity, label ) {

	assertInlineNumericEvidenceObject( quantity, label );
	requireObjectKeys( quantity.value, [ 'numerator', 'denominator' ], `${ label }.value` );
	const { numerator, denominator } = quantity.value;
	assert.ok( Number.isSafeInteger( numerator ) && Number.isSafeInteger( denominator ) && numerator > 0 && denominator > 0, `${ label } must use an exact positive rational` );
	assert.equal( integerGcd( numerator, denominator ), 1, `${ label } rational is not reduced` );
	return numerator / denominator;

}

function inlineClockEntries( storage, label ) {

	requireAbiRecord( storage, 'ClockMappingTableStorage', label );
	requireAbiEnum( storage.storage, 'clockMappingStorageKinds', `${ label }.storage` );
	if ( storage.storage === 'inline' ) {

		assert.ok( Array.isArray( storage.inlineEntries ) && storage.inlineEntries.length >= 2, `${ label }.inlineEntries needs at least two entries` );
		assert.ok( isTypedAbsence( storage.resourceRef ), `${ label }.resourceRef must be typed absence for inline storage` );
		return storage.inlineEntries;

	}
	assert.ok( isTypedAbsence( storage.inlineEntries ), `${ label }.inlineEntries must be typed absence for immutable-resource storage` );
	requireObjectKeys( storage.resourceRef, [ 'contentDigest', 'byteLayout', 'elementCount' ], `${ label }.resourceRef` );
	const resolved = clockMappingResourceFixtures.get( storage.resourceRef.contentDigest );
	assert.ok( resolved, `${ label } cannot resolve content digest ${ storage.resourceRef.contentDigest }` );
	assert.equal( resolved.length, storage.resourceRef.elementCount, `${ label } content-addressed element count mismatch` );
	const canonicalBytes = JSON.stringify( resolved );
	assert.equal( `sha256:${ createHash( 'sha256' ).update( canonicalBytes ).digest( 'hex' ) }`, storage.resourceRef.contentDigest, `${ label } content digest mismatch` );
	return resolved;

}

function timestampMappingSeconds( mapping, coordinate, label ) {

	requireAbiRecord( mapping, 'ClockTimestampTableMapping', label );
	assert.equal( mapping.interpolationRule, 'piecewise-linear-seconds', `${ label } interpolation rule drift` );
	requireAbiEnum( mapping.outOfRangePolicy, 'clockOutOfRangePolicies', `${ label }.outOfRangePolicy` );
	const entries = inlineClockEntries( mapping.knotTable, `${ label }.knotTable` );
	const knots = entries.map( ( entry, index ) => ( {
		u: instantCoordinate( entry.instantKey, `${ label }.knotTable.inlineEntries[${ index }].instantKey` ),
		t: quantityValue( entry.timeSeconds, `${ label }.knotTable.inlineEntries[${ index }].timeSeconds` )
	} ) );
	for ( let i = 1; i < knots.length; i ++ ) {

		assert.ok( knots[ i ].u > knots[ i - 1 ].u, `${ label } knot coordinates must increase` );
		assert.ok( knots[ i ].t > knots[ i - 1 ].t, `${ label } knot seconds must increase` );

	}
	const lowerIndex = knots.findIndex( ( knot, index ) => index + 1 < knots.length && coordinate >= knot.u && coordinate <= knots[ index + 1 ].u );
	assert.notEqual( lowerIndex, - 1, `${ label } rejects an out-of-range instant` );
	const lower = knots[ lowerIndex ];
	const upper = knots[ lowerIndex + 1 ];
	return lower.t + ( coordinate - lower.u ) / ( upper.u - lower.u ) * ( upper.t - lower.t );

}

function piecewiseMappingSeconds( mapping, coordinate, label ) {

	requireAbiRecord( mapping, 'ClockPiecewiseMapping', label );
	requireAbiEnum( mapping.outOfRangePolicy, 'clockOutOfRangePolicies', `${ label }.outOfRangePolicy` );
	const entries = inlineClockEntries( mapping.segmentTable, `${ label }.segmentTable` );
	const segments = entries.map( ( segment, index ) => ( {
		start: instantCoordinate( segment.startInclusive, `${ label }.segmentTable.inlineEntries[${ index }].startInclusive` ),
		end: instantCoordinate( segment.endExclusive, `${ label }.segmentTable.inlineEntries[${ index }].endExclusive` ),
		secondsAtStart: quantityValue( segment.secondsAtStart, `${ label }.segmentTable.inlineEntries[${ index }].secondsAtStart` ),
		secondsPerTick: rationalQuantityValue( segment.secondsPerTick, `${ label }.segmentTable.inlineEntries[${ index }].secondsPerTick` )
	} ) );
	for ( let i = 0; i < segments.length; i ++ ) {

		assert.ok( segments[ i ].end > segments[ i ].start, `${ label } segment must be nonempty` );
		if ( i > 0 ) {

			assert.equal( segments[ i ].start, segments[ i - 1 ].end, `${ label } segments must be gap-free` );
			const priorEndSeconds = segments[ i - 1 ].secondsAtStart + ( segments[ i - 1 ].end - segments[ i - 1 ].start ) * segments[ i - 1 ].secondsPerTick;
			assert.ok( Math.abs( segments[ i ].secondsAtStart - priorEndSeconds ) <= 1e-12, `${ label } segments must be continuous` );

		}

	}
	const segment = segments.find( ( candidate ) => coordinate >= candidate.start && coordinate < candidate.end );
	assert.ok( segment, `${ label } rejects an out-of-range instant` );
	return segment.secondsAtStart + ( coordinate - segment.start ) * segment.secondsPerTick;

}

function canonicalInstantSeconds( instant, context, label ) {

	requireAbiRecord( instant, 'PhysicsInstant', label );
	assert.ok( Number.isSafeInteger( instant.tick ), `${ label }.tick must be a structural integer` );
	requireObjectKeys( instant.rationalSubstep, [ 'numerator', 'denominator' ], `${ label }.rationalSubstep` );
	const { numerator, denominator } = instant.rationalSubstep;
	assert.ok( Number.isSafeInteger( numerator ) && Number.isSafeInteger( denominator ), `${ label }.rationalSubstep must be structural integers` );
	assert.ok( denominator > 0 && numerator >= 0 && numerator < denominator, `${ label }.rationalSubstep is outside canonical range` );
	assert.equal( integerGcd( numerator, denominator ), 1, `${ label }.rationalSubstep is not reduced` );
	const clock = canonicalClock( context, instant.clockId, label );
	assert.equal( instant.clockMappingRevision, clock.mappingRevision, `${ label }.clockMappingRevision mismatch` );
	assert.equal( instant.discontinuityEpoch, clock.discontinuityEpoch, `${ label }.discontinuityEpoch mismatch` );
	const coordinate = instant.tick + numerator / denominator;
	let expected;
	if ( clock.mappingKind === 'fixed-rational' ) {

		const mapping = requireAbiRecord( clock.mapping.fixedRational, 'ClockFixedRationalMapping', `${ label }.clock.fixedRational` );
		const epochCoordinate = instantCoordinate( { tick: mapping.epochTick, rationalSubstep: mapping.epochRationalSubstep }, `${ label }.clock.fixedRational.epoch` );
		expected = quantityValue( mapping.epochSeconds, `${ label }.clock.epochSeconds` ) +
			( coordinate - epochCoordinate ) * rationalQuantityValue( mapping.secondsPerTick, `${ label }.clock.secondsPerTick` );

	} else if ( clock.mappingKind === 'timestamp-table' ) {

		expected = timestampMappingSeconds( clock.mapping.timestampTable, coordinate, `${ label }.clock.timestampTable` );

	} else if ( clock.mappingKind === 'piecewise-versioned' ) {

		expected = piecewiseMappingSeconds( clock.mapping.piecewiseVersioned, coordinate, `${ label }.clock.piecewiseVersioned` );

	} else {

		const mapping = requireAbiRecord( clock.mapping.external, 'ClockExternalMapping', `${ label }.clock.external` );
		assert.equal( mapping.unloggedQueryPolicy, 'reject', `${ label }.clock.external must reject unlogged evaluations` );
		expected = timestampMappingSeconds( mapping.frozenEvaluationTable, coordinate, `${ label }.clock.external.frozenEvaluationTable` );

	}
	const derived = quantityValue( instant.timeSecondsDerived, `${ label }.timeSecondsDerived` );
	assert.ok( Math.abs( derived - expected ) <= Math.max( 1e-12, Math.abs( expected ) * 1e-12 ), `${ label }.timeSecondsDerived disagrees with its versioned clock mapping` );
	return expected;

}

function compareCanonicalInstants( a, b, context, label ) {

	assert.equal( a.clockId, b.clockId, `${ label } clock mismatch` );
	return canonicalInstantSeconds( a, context, `${ label}.a` ) - canonicalInstantSeconds( b, context, `${ label}.b` );

}

function validateCanonicalInterval( interval, context, label ) {

	requireAbiRecord( interval, 'PhysicsTimeInterval', label );
	assert.equal( interval.start.clockId, interval.clockId, `${ label}.start clock mismatch` );
	assert.equal( interval.endExclusive.clockId, interval.clockId, `${ label}.endExclusive clock mismatch` );
	assert.equal( interval.start.clockMappingRevision, interval.intervalMappingRevision, `${ label}.start mapping revision mismatch` );
	assert.equal( interval.endExclusive.clockMappingRevision, interval.intervalMappingRevision, `${ label}.end mapping revision mismatch` );
	assert.ok( compareCanonicalInstants( interval.start, interval.endExclusive, context, label ) < 0, `${ label } must be nonempty and half-open` );
	return interval;

}

function intervalBoundsSeconds( interval, context, label ) {

	validateCanonicalInterval( interval, context, label );
	return [ canonicalInstantSeconds( interval.start, context, `${ label}.start` ), canonicalInstantSeconds( interval.endExclusive, context, `${ label}.endExclusive` ) ];

}

function assertIntervalContained( inner, outer, context, label ) {

	const [ innerStart, innerEnd ] = intervalBoundsSeconds( inner, context, `${ label}.inner` );
	const [ outerStart, outerEnd ] = intervalBoundsSeconds( outer, context, `${ label}.outer` );
	assert.ok( innerStart >= outerStart - 1e-12 && innerEnd <= outerEnd + 1e-12, `${ label } interval is outside its coordination/exchange interval` );

}

function validateCanonicalContext( context ) {

	requireAbiRecord( context, 'PhysicsContext', 'physicsContext' );
	assert.equal( context.worldTransformRevision, context.worldToPhysicsTransform.transformRevision, 'physicsContext world transform revision mismatch' );
	assert.ok( ! Object.hasOwn( context, 'worldUnitsPerMeter' ), 'physicsContext cannot serialize reciprocal scale' );
	assert.ok( quantityValue( context.metersPerWorldUnit, 'physicsContext.metersPerWorldUnit' ) > 0, 'physicsContext.metersPerWorldUnit must be positive' );
	requireAbiRecord( context.quantitySystem, 'PhysicsQuantitySystem', 'physicsContext.quantitySystem' );
	assert.deepEqual( [ context.quantitySystem.length, context.quantitySystem.mass, context.quantitySystem.time, context.quantitySystem.thermodynamicTemperature, context.quantitySystem.angle ], [ 'metre', 'kilogram', 'second', 'kelvin', 'radian' ], 'physicsContext.quantitySystem must use canonical SI physics base units' );
	requireAbiRecord( context.worldToPhysicsTransform, 'WorldPhysicsTransform', 'physicsContext.worldToPhysicsTransform' );
	assert.equal( context.worldToPhysicsTransform.scaleSource, 'metersPerWorldUnit', 'worldToPhysicsTransform must use the one canonical scale source' );
	assert.equal( context.worldToPhysicsTransform.physicsOriginEpoch, context.physicsOriginEpoch, 'worldToPhysicsTransform origin epoch mismatch' );
	assertProperRotation( context.worldToPhysicsTransform.properBasisRotation, 'worldToPhysicsTransform.properBasisRotation' );
	validateCanonicalInterval( context.worldToPhysicsTransform.validityInterval, context, 'worldToPhysicsTransform.validityInterval' );
	requireNonEmptyMapping( context.physicsFrameRegistry, 'physicsContext.physicsFrameRegistry' );
	for ( const [ frameKey, frame ] of Object.entries( context.physicsFrameRegistry ) ) {

		requireAbiRecord( frame, 'PhysicsFrameDescriptor', `physicsFrameRegistry.${ frameKey }` );
		assertProperRotation( frame.parentFromFrameRotation, `physicsFrameRegistry.${ frameKey }.parentFromFrameRotation` );
		validateCanonicalInterval( frame.validityInterval, context, `physicsFrameRegistry.${ frameKey }.validityInterval` );

	}
	requireNonEmptyMapping( context.physicsClockRegistry, 'physicsContext.physicsClockRegistry' );
	const mappingKinds = new Set();
	for ( const [ clockKey, clock ] of Object.entries( context.physicsClockRegistry ) ) {

		requireAbiRecord( clock, 'PhysicsClockDescriptor', `physicsClockRegistry.${ clockKey }` );
		requireAbiEnum( clock.mappingKind, 'clockMappingKinds', `physicsClockRegistry.${ clockKey }.mappingKind` );
		mappingKinds.add( clock.mappingKind );
		const armByKind = { 'fixed-rational': 'fixedRational', 'timestamp-table': 'timestampTable', 'piecewise-versioned': 'piecewiseVersioned', external: 'external' };
		const activeArm = armByKind[ clock.mappingKind ];
		for ( const arm of Object.values( armByKind ) ) {

			const present = isPlainObject( clock.mapping[ arm ] ) && ! isTypedAbsence( clock.mapping[ arm ] );
			assert.equal( present, arm === activeArm, `physicsClockRegistry.${ clockKey } must expose exactly its ${ activeArm } mapping arm` );
			if ( arm !== activeArm ) assert.ok( isTypedAbsence( clock.mapping[ arm ] ), `physicsClockRegistry.${ clockKey }.${ arm } must use typed absence` );

		}
		const activeRecordByKind = { 'fixed-rational': 'ClockFixedRationalMapping', 'timestamp-table': 'ClockTimestampTableMapping', 'piecewise-versioned': 'ClockPiecewiseMapping', external: 'ClockExternalMapping' };
		requireAbiRecord( clock.mapping[ activeArm ], activeRecordByKind[ clock.mappingKind ], `physicsClockRegistry.${ clockKey }.mapping.${ activeArm}` );
		if ( clock.mappingKind === 'fixed-rational' ) {

			instantCoordinate( { tick: clock.mapping.fixedRational.epochTick, rationalSubstep: clock.mapping.fixedRational.epochRationalSubstep }, `physicsClockRegistry.${ clockKey }.mapping.fixedRational.epoch` );
			rationalQuantityValue( clock.mapping.fixedRational.secondsPerTick, `physicsClockRegistry.${ clockKey }.mapping.fixedRational.secondsPerTick` );

		} else if ( clock.mappingKind === 'timestamp-table' ) {

			const first = inlineClockEntries( clock.mapping.timestampTable.knotTable, `physicsClockRegistry.${ clockKey }.mapping.timestampTable.knotTable` )[ 0 ];
			timestampMappingSeconds( clock.mapping.timestampTable, instantCoordinate( first.instantKey, `physicsClockRegistry.${ clockKey }.firstKnot` ), `physicsClockRegistry.${ clockKey }.mapping.timestampTable` );

		} else if ( clock.mappingKind === 'piecewise-versioned' ) {

			const first = inlineClockEntries( clock.mapping.piecewiseVersioned.segmentTable, `physicsClockRegistry.${ clockKey }.mapping.piecewiseVersioned.segmentTable` )[ 0 ];
			piecewiseMappingSeconds( clock.mapping.piecewiseVersioned, instantCoordinate( first.startInclusive, `physicsClockRegistry.${ clockKey }.firstSegment` ), `physicsClockRegistry.${ clockKey }.mapping.piecewiseVersioned` );

		} else {

			assert.equal( clock.mapping.external.unloggedQueryPolicy, 'reject', `physicsClockRegistry.${ clockKey }.mapping.external must reject unlogged evaluations` );
			const first = inlineClockEntries( clock.mapping.external.frozenEvaluationTable.knotTable, `physicsClockRegistry.${ clockKey }.mapping.external.frozenEvaluationTable.knotTable` )[ 0 ];
			timestampMappingSeconds( clock.mapping.external.frozenEvaluationTable, instantCoordinate( first.instantKey, `physicsClockRegistry.${ clockKey }.firstExternalKnot` ), `physicsClockRegistry.${ clockKey }.mapping.external.frozenEvaluationTable` );

		}

	}
	assert.ok( mappingKinds.has( 'fixed-rational' ) && mappingKinds.has( 'timestamp-table' ) && mappingKinds.has( 'piecewise-versioned' ), 'physicsContext fixture must cover fixed and nonuniform clocks' );
	requireAbiRecord( context.physicsMaterialRegistry, 'PhysicsMaterialRegistry', 'physicsMaterialRegistry' );
	requireNonEmptyString( context.physicsMaterialRegistry.registryId, 'physicsMaterialRegistry.registryId' );
	requireNonEmptyString( context.physicsMaterialRegistry.owner, 'physicsMaterialRegistry.owner' );
	requireNonEmptyString( context.physicsMaterialRegistry.registryVersion, 'physicsMaterialRegistry.registryVersion' );
	requireNonEmptyMapping( context.physicsMaterialRegistry.materials, 'physicsMaterialRegistry.materials' );
	requireNonEmptyMapping( context.physicsMaterialRegistry.pairLawResolver, 'physicsMaterialRegistry.pairLawResolver' );
	assert.doesNotMatch( JSON.stringify( context.physicsMaterialRegistry ), /"(?:roughness|metalness|baseColor)"/i, 'physics materials cannot be inferred from render PBR state' );

}

function validateCanonicalSignal( signalKey, descriptor, context ) {

	const label = `physicsSignals.${ signalKey }`;
	requireAbiRecord( descriptor, 'PhysicsSignalDescriptor', label );
	assert.equal( descriptor.contextId, context.contextId, `${ label }.contextId mismatch` );
	assert.ok( Object.values( context.physicsFrameRegistry ).some( ( frame ) => frame.frameId === descriptor.physicsFrameId ), `${ label } references an unregistered frame` );
	canonicalClock( context, descriptor.clockId, label );
	assert.equal( descriptor.physicsOriginEpoch, context.physicsOriginEpoch, `${ label }.physicsOriginEpoch mismatch` );
	requireNonEmptyMapping( descriptor.channels, `${ label }.channels` );
	assert.deepEqual( Object.keys( descriptor.perChannelError ).sort(), Object.keys( descriptor.channels ).sort(), `${ label } channel/error key sets differ` );
	for ( const [ channelId, channel ] of Object.entries( descriptor.channels ) ) {

		requireAbiRecord( channel, 'PhysicsChannelDescriptor', `${ label }.channels.${ channelId}` );
		requireNonEmptyString( channel.unit, `${ label }.channels.${ channelId}.unit` );
		assert.equal( channel.errorRef, `${ descriptor.signalId }/error/${ channelId }`, `${ label }.channels.${ channelId}.errorRef mismatch` );
		requireAbiRecord( descriptor.perChannelError[ channelId ], 'PhysicsErrorDescriptor', `${ label }.perChannelError.${ channelId}` );

	}
	requireAbiRecord( descriptor.representedFootprint, 'PhysicsSupportDescriptor', `${ label }.representedFootprint` );
	requireAbiRecord( descriptor.filter, 'PhysicsFilterDescriptor', `${ label }.filter` );
	requireAbiRecord( descriptor.validity, 'PhysicsValidityDescriptor', `${ label }.validity` );
	requireAbiRecord( descriptor.residency, 'PhysicsResidencyDescriptor', `${ label }.residency` );
	requireAbiRecord( descriptor.residency.mirror, 'PhysicsMirrorDescriptor', `${ label }.residency.mirror` );
	requireAbiRecord( descriptor.cadence, 'PhysicsCadenceDescriptor', `${ label }.cadence` );
	requireAbiRecord( descriptor.latency, 'PhysicsLatencyDescriptor', `${ label }.latency` );
	requireObjectKeys( descriptor.resourceGeneration, [ 'kind', 'generation' ], `${ label }.resourceGeneration` );
	if ( descriptor.resourceGeneration.kind === 'present' ) requireNonEmptyString( descriptor.resourceGeneration.generation, `${ label }.resourceGeneration.generation` );
	else assert.ok( isTypedAbsence( descriptor.resourceGeneration.generation ), `${ label }.resourceGeneration absent arm is not typed` );
	requireAbiEnum( descriptor.cadence.kind, 'cadenceKinds', `${ label }.cadence.kind` );
	assert.equal( descriptor.cadence.clockId, descriptor.clockId, `${ label } cadence clock mismatch` );
	assert.doesNotMatch( JSON.stringify( descriptor.residency ), /synchronous|same-frame-readback|frame-critical/i, `${ label } requests frame-critical readback` );

}

function accessIdentity( access, versionKey ) {

	return `${ access.signalId }@${ access[ versionKey ] }`;

}

function validateCanonicalGraph( graph, signals, context ) {

	requireAbiRecord( graph, 'PhysicsGraph', 'physicsGraph' );
	assert.equal( graph.contextId, context.contextId, 'physicsGraph.contextId mismatch' );
	validateCanonicalInterval( graph.coordinationInterval, context, 'physicsGraph.coordinationInterval' );
	assert.ok( Array.isArray( graph.stages ) && graph.stages.length > 0, 'physicsGraph.stages must be non-empty' );
	assert.ok( Array.isArray( graph.edges ), 'physicsGraph.edges must be an array' );
	assert.ok( Array.isArray( graph.loopMacros ), 'physicsGraph.loopMacros must be an array' );
	assert.ok( Array.isArray( graph.commitGroups ) && graph.commitGroups.length > 0, 'physicsGraph.commitGroups must be non-empty' );
	const stageOrder = abiEnum( 'stageKinds' );
	const stagesById = new Map();
	const writesByIdentity = new Map();
	const descriptorsById = new Map( Object.values( signals ).map( ( descriptor ) => [ descriptor.signalId, descriptor ] ) );
	for ( const [ index, stage ] of graph.stages.entries() ) {

		const label = `physicsGraph.stages[${ index }]`;
		requireAbiRecord( stage, 'PhysicsGraphStage', label );
		requireNonEmptyString( stage.stageId, `${ label }.stageId` );
		assert.ok( ! stagesById.has( stage.stageId ), `${ label } duplicates stageId ${ stage.stageId }` );
		stagesById.set( stage.stageId, stage );
		assert.ok( stageOrder.includes( stage.stageKind ), `${ label }.stageKind is noncanonical` );
		requireAbiEnum( stage.samplePhase, 'samplePhases', `${ label }.samplePhase` );
		canonicalClock( context, stage.clockId, label );
		assert.equal( stage.executionInterval.clockId, stage.clockId, `${ label } execution clock mismatch` );
		assertIntervalContained( stage.executionInterval, graph.coordinationInterval, context, label );
		requireAbiEnum( stage.nativeStepRule, 'nativeStepRules', `${ label }.nativeStepRule` );
		assert.ok( Array.isArray( stage.reads ) && Array.isArray( stage.writes ), `${ label } reads/writes must be arrays` );
		for ( const [ readIndex, read ] of stage.reads.entries() ) {

			requireObjectKeys( read, [ 'signalId', 'requiredStateVersion', 'requiredDisposition', 'samplePhase' ], `${ label }.reads[${ readIndex }]` );
			assert.ok( descriptorsById.has( read.signalId ), `${ label } reads unknown signal ${ read.signalId }` );

		}
		for ( const [ writeIndex, write ] of stage.writes.entries() ) {

			requireObjectKeys( write, [ 'signalId', 'producedStateVersion', 'disposition', 'commitGroupId' ], `${ label }.writes[${ writeIndex }]` );
			const descriptor = descriptorsById.get( write.signalId );
			assert.ok( descriptor, `${ label } writes unknown signal ${ write.signalId }` );
			assert.equal( stage.owner, descriptor.owner, `${ label } is not the state-equation owner for ${ write.signalId }` );
			assert.ok( [ 'provisional', 'committed-publication' ].includes( write.disposition ), `${ label } has invalid write disposition` );
			if ( write.disposition === 'provisional' ) assert.notEqual( write.producedStateVersion, descriptor.stateVersion, `${ label } leaks provisional state as a published descriptor version` );
			const identity = accessIdentity( write, 'producedStateVersion' );
			assert.ok( ! writesByIdentity.has( identity ), `${ identity } has duplicate writers` );
			writesByIdentity.set( identity, { stage, write } );

		}

	}
	const commitGroupsById = new Map();
	const committedPublicationIdentities = new Set();
	for ( const [ index, group ] of graph.commitGroups.entries() ) {

		const label = `physicsGraph.commitGroups[${ index }]`;
		requireAbiRecord( group, 'PhysicsCommitGroup', label );
		assert.equal( group.atomicity, 'all-or-none', `${ label } must commit atomically` );
		assert.ok( ! commitGroupsById.has( group.commitGroupId ), `${ label } duplicates commitGroupId` );
		commitGroupsById.set( group.commitGroupId, group );
		validateCanonicalInterval( group.interval, context, `${ label }.interval` );
		assert.equal( group.publicationLineage.length, group.committedPublications.length, `${ label } must have one lineage row per committed publication` );
		const lineageByCommitted = new Map();
		for ( const [ lineageIndex, lineage ] of group.publicationLineage.entries() ) {

			requireAbiRecord( lineage, 'CommitPublicationLineage', `${ label }.publicationLineage[${ lineageIndex }]` );
			const committedIdentity = `${ lineage.committedVersion.signalId }@${ lineage.committedVersion.stateVersion }`;
			assert.ok( ! lineageByCommitted.has( committedIdentity ), `${ label } duplicates lineage for ${ committedIdentity }` );
			lineageByCommitted.set( committedIdentity, lineage );
			assert.ok( group.provisionalVersions.some( ( provisional ) => provisional.signalId === lineage.provisionalVersion.signalId && provisional.stateVersion === lineage.provisionalVersion.stateVersion ), `${ label } lineage source is not in provisionalVersions` );
			assert.match( lineage.contentDigest, /^sha256:/, `${ label } lineage lacks a content digest` );
			canonicalInstantSeconds( lineage.publicationInstant, context, `${ label }.publicationLineage[${ lineageIndex }].publicationInstant` );

		}
		for ( const publication of group.committedPublications ) {

			const identity = `${ publication.signalId }@${ publication.stateVersion }`;
			assert.ok( writesByIdentity.has( identity ), `${ label } commits a version with no authoritative writer: ${ identity }` );
			assert.equal( writesByIdentity.get( identity ).write.disposition, 'committed-publication', `${ label } publishes a provisional write` );
			assert.equal( writesByIdentity.get( identity ).write.commitGroupId, group.commitGroupId, `${ label } contains a write assigned to another commit group` );
			assert.ok( ! committedPublicationIdentities.has( identity ), `${ identity } appears in multiple commit groups` );
			committedPublicationIdentities.add( identity );
			assert.equal( group.stateEquationOwners[ publication.stateEquation ], signals[ publication.signalKey ].owner, `${ label } state-equation owner mismatch` );
			assert.ok( lineageByCommitted.has( identity ), `${ label } publication ${ identity } lacks exact lineage` );

		}

	}
	for ( const { write } of writesByIdentity.values() ) {

		assert.ok( commitGroupsById.has( write.commitGroupId ), `write ${ accessIdentity( write, 'producedStateVersion' ) } references unknown commit group` );
		if ( write.disposition === 'committed-publication' ) assert.ok( committedPublicationIdentities.has( accessIdentity( write, 'producedStateVersion' ) ), `committed write ${ accessIdentity( write, 'producedStateVersion' ) } is absent from its atomic commit group` );

	}
	const edgesByConsumerRead = new Map();
	const predecessors = new Map( [ ...stagesById.keys() ].map( ( id ) => [ id, [] ] ) );
	for ( const [ index, edge ] of graph.edges.entries() ) {

		const label = `physicsGraph.edges[${ index }]`;
		requireAbiRecord( edge, 'PhysicsGraphEdge', label );
		const producer = stagesById.get( edge.producerStageId );
		const consumer = stagesById.get( edge.consumerStageId );
		assert.ok( producer && consumer, `${ label } references an unknown stage` );
		assert.ok( stageOrder.indexOf( producer.stageKind ) <= stageOrder.indexOf( consumer.stageKind ), `${ label } violates stage partial order` );
		const identity = `${ edge.payload.signalId }@${ edge.requiredVersionAndPhase.stateVersion }`;
		const producerWrite = producer.writes.find( ( write ) => accessIdentity( write, 'producedStateVersion' ) === identity );
		assert.ok( producerWrite, `${ label } has no matching producer write for ${ identity }` );
		const consumerRead = consumer.reads.find( ( read ) => accessIdentity( read, 'requiredStateVersion' ) === identity && read.samplePhase === edge.requiredVersionAndPhase.samplePhase );
		assert.ok( consumerRead, `${ label } has no matching consumer read for ${ identity }` );
		assert.equal( consumerRead.requiredDisposition, edge.requiredVersionAndPhase.disposition, `${ label } disposition mismatch` );
		const readKey = `${ edge.consumerStageId }|${ identity }|${ consumerRead.samplePhase }`;
		assert.ok( ! edgesByConsumerRead.has( readKey ), `${ label } duplicates a read dependency` );
		edgesByConsumerRead.set( readKey, edge.edgeId );
		validateCanonicalDuration( edge.maximumStaleness, context, `${ label }.maximumStaleness` );
		requireAbiEnum( edge.barrier, 'barrierKinds', `${ label }.barrier` );
		const producerResidency = producer.executionResidency.kind;
		const consumerResidency = consumer.executionResidency.kind;
		if ( producerResidency === 'gpu' && consumerResidency === 'gpu' ) assert.ok( [ 'gpu-pass-dispatch', 'same-queue-transition', 'cross-queue' ].includes( edge.barrier ), `${ label } lacks a GPU ordering barrier` );
		if ( producerResidency === 'external' || consumerResidency === 'external' ) assert.equal( edge.barrier, 'external-fence', `${ label } lacks an external fence` );
		predecessors.get( consumer.stageId ).push( producer.stageId );

	}
	for ( const stage of graph.stages ) for ( const read of stage.reads ) {

		const readKey = `${ stage.stageId }|${ accessIdentity( read, 'requiredStateVersion' ) }|${ read.samplePhase }`;
		assert.ok( edgesByConsumerRead.has( readKey ), `stage ${ stage.stageId } read ${ readKey } has no exact edge` );

	}
	const pending = new Set( stagesById.keys() );
	const visited = new Set();
	while ( pending.size > 0 ) {

		const ready = [ ...pending ].filter( ( id ) => predecessors.get( id ).every( ( predecessor ) => visited.has( predecessor ) ) );
		assert.ok( ready.length > 0, 'physicsGraph outer graph contains a cycle' );
		for ( const id of ready ) { pending.delete( id ); visited.add( id ); }

	}
	for ( const [ index, loop ] of graph.loopMacros.entries() ) {

		const label = `physicsGraph.loopMacros[${ index }]`;
		requireAbiRecord( loop, 'BoundedCouplingLoop', label );
		assert.ok( loop.orderedStageIds.length > 1 && loop.orderedStageIds.every( ( id ) => stagesById.has( id ) ), `${ label } references unknown loop stages` );
		assert.ok( quantityValue( loop.iterationBound, `${ label }.iterationBound` ) > 0, `${ label }.iterationBound must be positive` );
		assert.equal( loop.acceptedIteratePublication, 'atomic', `${ label } must publish an accepted iterate atomically` );
		assert.ok( loop.seedCommittedVersions.length > 0, `${ label } has no iteration-zero seed versions` );
		assert.ok( loop.iterationCarriedEdges.length > 0, `${ label } has no iteration-carried edges` );
		for ( const [ edgeIndex, edge ] of loop.iterationCarriedEdges.entries() ) {

			requireAbiRecord( edge, 'CouplingIterationEdge', `${ label }.iterationCarriedEdges[${ edgeIndex }]` );
			assert.equal( edge.producedIterationOffset, 0, `${ label } carried edge producer offset drift` );
			assert.equal( edge.consumedIterationOffset, 1, `${ label } carried edge must feed exactly the next iteration` );
			assert.ok( loop.orderedStageIds.includes( edge.producerStageId ) && loop.orderedStageIds.includes( edge.consumerStageId ), `${ label } carried edge leaves the loop` );

		}
		assert.ok( loop.perIterationLedger.length > 0, `${ label } has no per-iteration ledger` );
		let acceptedIterations = 0;
		for ( const [ iterationIndex, row ] of loop.perIterationLedger.entries() ) {

			requireAbiRecord( row, 'CouplingIterationLedger', `${ label }.perIterationLedger[${ iterationIndex }]` );
			assert.equal( row.iterationIndex, iterationIndex, `${ label } iteration ledger is not contiguous` );
			if ( row.accepted ) acceptedIterations ++;

		}
		assert.equal( acceptedIterations, 1, `${ label } must select exactly one accepted iterate` );
		assert.ok( loop.acceptedWrites.length > 0 && loop.acceptedWrites.every( ( ref ) => String( ref.stateVersion ).startsWith( `${ loop.provisionalVersionNamespace }/` ) ), `${ label } accepted writes must remain loop-scoped provisional versions` );

	}
	const rebaseIds = new Set();
	for ( const [ index, transaction ] of graph.originRebaseTransactions.entries() ) {

		const label = `physicsGraph.originRebaseTransactions[${ index }]`;
		requireAbiRecord( transaction, 'PhysicsOriginRebaseTransaction', label );
		assert.equal( transaction.contextId, context.contextId, `${ label }.contextId mismatch` );
		assert.ok( ! rebaseIds.has( transaction.transactionId ), `${ label } duplicates transactionId` );
		rebaseIds.add( transaction.transactionId );
		canonicalInstantSeconds( transaction.commitInstant, context, `${ label }.commitInstant` );
		assert.notEqual( transaction.fromPhysicsOriginEpoch, transaction.toPhysicsOriginEpoch, `${ label } does not change origin epoch` );
		requireObjectKeys( transaction.fromToTransform, [ 'transformRevision', 'properBasisRotation', 'translationMeters', 'error' ], `${ label }.fromToTransform` );
		assertProperRotation( transaction.fromToTransform.properBasisRotation, `${ label }.fromToTransform.properBasisRotation` );
		assert.equal( transaction.provisionalStateRequirement, 'none-live', `${ label } rebases with live provisional state` );
		assert.equal( transaction.atomicPublication, 'all-or-none', `${ label } is not atomic` );

	}
	const executionLedger = requireAbiRecord( graph.executionLedger, 'PhysicsExecutionLedger', 'physicsGraph.executionLedger' );
	assert.equal( executionLedger.graphId, graph.graphId, 'physicsGraph.executionLedger.graphId mismatch' );
	assert.equal( canonicalIntervalIdentity( executionLedger.coordinationInterval ), canonicalIntervalIdentity( graph.coordinationInterval ), 'physicsGraph.executionLedger interval mismatch' );
	assert.deepEqual( executionLedger.stageExecutions.map( ( row ) => row.stageId ).sort(), [ ...stagesById.keys() ].sort(), 'physicsGraph.executionLedger must record every stage exactly once in the fixture interval' );
	for ( const row of executionLedger.stageExecutions ) {

		assert.ok( stagesById.has( row.stageId ), `physicsGraph.executionLedger references unknown stage ${ row.stageId }` );
		validateCanonicalInterval( row.executionInterval, context, `physicsGraph.executionLedger.${ row.stageId }.executionInterval` );
		assert.equal( row.status, 'completed', `physicsGraph.executionLedger.${ row.stageId } is not complete` );

	}
	const successfulCommitIds = new Set( executionLedger.commitResults.filter( ( result ) => result.status === 'committed' ).map( ( result ) => result.commitGroupId ) );
	assert.deepEqual( [ ...successfulCommitIds ].sort(), [ ...commitGroupsById.keys() ].sort(), 'physicsGraph.executionLedger does not prove every fixture commit group' );
	assert.equal( executionLedger.discontinuityEpoch, graph.coordinationInterval.start.discontinuityEpoch, 'physicsGraph.executionLedger discontinuity epoch mismatch' );

}

function validateCanonicalDuration( duration, context, label ) {

	if ( duration === 'not-applicable' ) return;
	requireObjectKeys( duration, [ 'kind', 'seconds', 'clockSpan', 'secondsDerived', 'mappingError' ], label );
	assert.ok( [ 'seconds', 'clock-span' ].includes( duration.kind ), `${ label }.kind is invalid` );
	if ( duration.kind === 'seconds' ) {

		assertInlineNumericEvidenceObject( duration.seconds, `${ label }.seconds` );
		assert.ok( isTypedAbsence( duration.clockSpan ), `${ label } seconds duration cannot carry a clock span` );

	} else {

		validateCanonicalInterval( { clockId: duration.clockSpan.clockId, start: duration.clockSpan.start, endExclusive: duration.clockSpan.endExclusive, intervalMappingRevision: duration.clockSpan.mappingRevision }, context, `${ label }.clockSpan` );

	}

}

function canonicalInstantIdentity( instant ) {

	return `${ instant.clockId }:${ instant.tick }+${ instant.rationalSubstep.numerator }/${ instant.rationalSubstep.denominator }@${ instant.clockMappingRevision }#${ instant.discontinuityEpoch }`;

}

function canonicalIntervalIdentity( interval ) {

	return `[${ canonicalInstantIdentity( interval.start ) },${ canonicalInstantIdentity( interval.endExclusive ) })`;

}

function vectorQuantity( quantity, expectedUnit, label ) {

	const value = quantityValue( quantity, label );
	assert.equal( quantity.unit, expectedUnit, `${ label } has wrong unit` );
	assert.ok( Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite ), `${ label } must be a finite Vec3` );
	return value;

}

function addVector( target, value ) {

	for ( let i = 0; i < 3; i ++ ) target[ i ] += value[ i ];

}

function validateCanonicalInteraction( record, exchange, context, recordIds, label ) {

	requireAbiRecord( record, 'InteractionRecord', label );
	assert.ok( ! recordIds.has( record.interactionId ), `${ label } duplicates interactionId ${ record.interactionId }` );
	recordIds.add( record.interactionId );
	assert.ok( [ 'source', 'reaction' ].includes( record.role ), `${ label }.role is invalid` );
	validateCanonicalInterval( record.applicationInterval, context, `${ label }.applicationInterval` );
	assertIntervalContained( record.applicationInterval, exchange.applicationInterval, context, label );
	assert.equal( record.physicsFrameId, exchange.physicsFrameId, `${ label }.physicsFrameId mismatch` );
	assert.equal( record.physicsOriginEpoch, exchange.physicsOriginEpoch, `${ label }.physicsOriginEpoch mismatch` );
	assert.equal( record.transformRevision, exchange.transformRevision, `${ label }.transformRevision mismatch` );
	requireAbiEnum( record.payload.tag, 'interactionPayloadTags', `${ label }.payload.tag` );
	const payloadRecordByTag = {
		pointImpulse: 'PointImpulsePayload', wrenchImpulse: 'WrenchImpulsePayload', wrenchRate: 'WrenchRatePayload', surfaceTraction: 'SurfaceTractionPayload',
		massRate: 'MassRatePayload', massFlux: 'MassFluxPayload', massTransfer: 'MassTransferPayload', volumeRate: 'VolumeRatePayload', volumeFlux: 'VolumeFluxPayload',
		volumeTransfer: 'VolumeTransferPayload', momentumFlux: 'MomentumFluxPayload', momentumTransfer: 'MomentumTransferPayload', heatRate: 'HeatRatePayload',
		heatFlux: 'HeatFluxPayload', heatTransfer: 'HeatTransferPayload', energyTransfer: 'EnergyTransferPayload', movingBoundary: 'MovingBoundaryPayload', constraintTarget: 'ConstraintTargetPayload'
	};
	requireAbiRecord( record.payload, payloadRecordByTag[ record.payload.tag ], `${ label }.payload` );
	requireAbiEnum( record.payload.timeSemantics, 'interactionTimeSemantics', `${ label }.payload.timeSemantics` );
	assert.equal( record.signConvention, 'positive-source-to-receiver', `${ label }.signConvention mismatch` );
	const expectedKeyPrefix = `${ canonicalIntervalIdentity( record.applicationInterval ) }|stage=${ record.provenance.stageId }|producer=${ record.provenance.producerId }|sequence=${ record.provenance.producerSequence }|interaction=${ record.interactionId }`;
	assert.equal( record.exactOnceKey, expectedKeyPrefix, `${ label }.exactOnceKey does not bind exact interval/stage/producer/sequence/interaction identity` );
	assert.equal( record.applicationLedgerKey, `apply|${ expectedKeyPrefix }`, `${ label }.applicationLedgerKey mismatch` );
	requireAbiRecord( record.footprint, 'InteractionFootprint', `${ label }.footprint` );
	requireAbiEnum( record.footprint.kind, 'interactionFootprintKinds', `${ label }.footprint.kind` );
	requireAbiEnum( record.footprint.distributionKind, 'interactionDistributionKinds', `${ label }.footprint.distributionKind` );
	assert.equal( record.footprint.physicsFrameId, record.physicsFrameId, `${ label } footprint frame mismatch` );
	assert.equal( record.footprint.physicsOriginEpoch, record.physicsOriginEpoch, `${ label } footprint origin mismatch` );
	assert.equal( record.footprint.transformRevision, record.transformRevision, `${ label } footprint transform mismatch` );
	if ( record.payload.tag === 'momentumTransfer' ) {

		assert.equal( record.footprint.kind, 'area', `${ label } distributed momentum transfer requires an area footprint` );
		assert.equal( record.footprint.distributionKind, 'extensive-distributed', `${ label } distributed momentum transfer must use an extensive distribution` );
		assert.equal( record.footprint.kernelUnit, 'inverse-square-meter', `${ label } extensive area kernel has wrong dimension` );
		assert.equal( record.footprint.normalizationTarget, 'unity', `${ label } extensive area kernel must target unity` );
		assert.ok( Math.abs( quantityValue( record.footprint.normalizationIntegral, `${ label }.footprint.normalizationIntegral` ) - 1 ) < 1e-12, `${ label } footprint kernel is not normalized` );
		vectorQuantity( record.payload.linearMomentumNs, 'newton-second', `${ label }.payload.linearMomentumNs` );
		vectorQuantity( record.payload.angularMomentumNms, 'newton-metre-second', `${ label }.payload.angularMomentumNms` );
		vectorQuantity( record.payload.referencePointMeters, 'metre', `${ label }.payload.referencePointMeters` );

	}
	assert.equal( record.reactionToInteractionIds.length > 0, record.role === 'reaction', `${ label } reaction topology is inconsistent with role` );
	assert.ok( Array.isArray( record.conservationGroupIds ) && record.conservationGroupIds.length > 0, `${ label } must bind a conservation group` );

}

function validateCanonicalExchange( exchange, context, exchangeIndex ) {

	const label = `physicsInteractions[${ exchangeIndex }]`;
	requireAbiRecord( exchange, 'SurfaceExchange', label );
	assert.equal( exchange.contextId, context.contextId, `${ label }.contextId mismatch` );
	validateCanonicalInterval( exchange.applicationInterval, context, `${ label }.applicationInterval` );
	assert.equal( exchange.physicsOriginEpoch, context.physicsOriginEpoch, `${ label }.physicsOriginEpoch mismatch` );
	assert.ok( Object.values( context.physicsFrameRegistry ).some( ( frame ) => frame.frameId === exchange.physicsFrameId && frame.transformRevision === exchange.transformRevision ), `${ label } frame/revision is unregistered` );
	requireAbiEnum( exchange.mode, 'surfaceExchangeModes', `${ label }.mode` );
	const recordIds = new Set();
	const allRecords = [ ...exchange.interactions, ...exchange.reactions ];
	for ( let i = 0; i < exchange.interactions.length; i ++ ) validateCanonicalInteraction( exchange.interactions[ i ], exchange, context, recordIds, `${ label }.interactions[${ i }]` );
	for ( let i = 0; i < exchange.reactions.length; i ++ ) validateCanonicalInteraction( exchange.reactions[ i ], exchange, context, recordIds, `${ label }.reactions[${ i }]` );
	const recordsById = new Map( allRecords.map( ( record ) => [ record.interactionId, record ] ) );
	assert.ok( exchange.reactionGroups.length > 0, `${ label } two-way fixture requires a reaction group` );
	for ( const [ groupIndex, group ] of exchange.reactionGroups.entries() ) {

		const groupLabel = `${ label }.reactionGroups[${ groupIndex }]`;
		requireAbiRecord( group, 'InteractionReactionGroup', groupLabel );
		assert.equal( group.contextId, context.contextId, `${ groupLabel }.contextId mismatch` );
		assert.equal( group.exchangeId, exchange.exchangeId, `${ groupLabel }.exchangeId mismatch` );
		validateCanonicalInterval( group.applicationInterval, context, `${ groupLabel }.applicationInterval` );
		assert.equal( group.acceptance, 'all-or-none', `${ groupLabel } must accept atomically` );
		assert.ok( group.sourceInteractionIds.length > 1 && group.reactionInteractionIds.length > 1, `${ groupLabel } fixture must exercise a many-to-many relation` );
		for ( const id of [ ...group.sourceInteractionIds, ...group.reactionInteractionIds ] ) assert.ok( recordsById.has( id ), `${ groupLabel } references unknown interaction ${ id }` );
		assert.equal( group.physicsOriginEpoch, exchange.physicsOriginEpoch, `${ groupLabel }.physicsOriginEpoch mismatch` );
		assert.equal( group.balanceFrameId, exchange.physicsFrameId, `${ groupLabel }.balanceFrameId mismatch` );
		assert.equal( group.balanceTransformRevision, exchange.transformRevision, `${ groupLabel }.balanceTransformRevision mismatch` );
		const linear = [ 0, 0, 0 ];
		const angular = [ 0, 0, 0 ];
		for ( const id of [ ...group.sourceInteractionIds, ...group.reactionInteractionIds ] ) {

			const record = recordsById.get( id );
			assert.equal( record.reactionGroupId, group.reactionGroupId, `${ groupLabel } record ${ id } group mismatch` );
			addVector( linear, vectorQuantity( record.payload.linearMomentumNs, 'newton-second', `${ groupLabel}.${ id}.linear` ) );
			addVector( angular, vectorQuantity( record.payload.angularMomentumNms, 'newton-metre-second', `${ groupLabel}.${ id}.angular` ) );

		}
		assert.ok( Math.hypot( ...linear ) <= quantityValue( group.residualsAndBounds.linearMomentumBound, `${ groupLabel }.linearMomentumBound` ), `${ groupLabel } linear momentum does not close` );
		assert.ok( Math.hypot( ...angular ) <= quantityValue( group.residualsAndBounds.angularMomentumBound, `${ groupLabel }.angularMomentumBound` ), `${ groupLabel } angular momentum does not close` );

	}
	for ( const record of exchange.reactions ) for ( const sourceId of record.reactionToInteractionIds ) assert.ok( exchange.interactions.some( ( source ) => source.interactionId === sourceId ), `${ label } reaction ${ record.interactionId } references unknown source ${ sourceId }` );
	for ( const [ index, conservation ] of exchange.conservationGroups.entries() ) {

		const conservationLabel = `${ label }.conservationGroups[${ index }]`;
		requireNonEmptyString( conservation.conservationGroupId, `${ conservationLabel }.conservationGroupId` );
		assert.equal( conservation.contextId, context.contextId, `${ conservationLabel }.contextId mismatch` );
		validateCanonicalInterval( conservation.interval, context, `${ conservationLabel }.interval` );
		assert.equal( conservation.referencePhysicsFrameId, exchange.physicsFrameId, `${ conservationLabel }.referencePhysicsFrameId mismatch` );
		assert.equal( conservation.physicsOriginEpoch, exchange.physicsOriginEpoch, `${ conservationLabel }.physicsOriginEpoch mismatch` );
		assert.equal( conservation.transformRevision, exchange.transformRevision, `${ conservationLabel }.transformRevision mismatch` );

	}
	requireAbiRecord( exchange.batchLedger, 'InteractionBatchLedger', `${ label }.batchLedger` );
	assert.equal( exchange.batchLedger.exchangeId, exchange.exchangeId, `${ label }.batchLedger.exchangeId mismatch` );
	requireNonEmptyMapping( exchange.batchLedger.perConsumerCursor, `${ label }.batchLedger.perConsumerCursor` );
	assert.ok( exchange.batchLedger.overflowPolicy !== 'lossy-with-failed-conservation' || Object.keys( exchange.batchLedger.lostCommodities ).length > 0, `${ label } lossy overflow hides conserved commodities` );
	assert.equal( new Set( allRecords.map( ( record ) => record.exactOnceKey ) ).size, allRecords.length, `${ label } has a duplicate delivery key` );

}

function leaseRefIdentity( ref ) {

	return `${ ref.leaseId }|${ ref.deviceId }|${ ref.deviceLossGeneration }|${ ref.resourceGeneration }|${ ref.layoutRevision }`;

}

function validateStateHandle( handle, leasesById, label ) {

	requireAbiRecord( handle, 'PresentationStateHandle', label );
	const lease = leasesById.get( handle.leaseId );
	assert.ok( lease, `${ label } references unknown lease ${ handle.leaseId }` );
	for ( const key of [ 'resourceGeneration', 'deviceLossGeneration', 'layoutRevision' ] ) assert.equal( handle[ key ], lease[ key ], `${ label }.${ key} does not match its lease` );

}

function validateProvenance( provenance, context, label ) {

	requireAbiRecord( provenance, 'PresentationSampleProvenance', label );
	canonicalClock( context, provenance.sourceClockId, label );
	for ( const key of [ 'requestedPresentationInstant', 'mappedSourceInstant' ] ) canonicalInstantSeconds( provenance[ key ], context, `${ label }.${ key}` );
	assert.equal( provenance.mappedSourceInstant.clockId, provenance.sourceClockId, `${ label }.mappedSourceInstant clock mismatch` );
	for ( const bracketKey of [ 'lowerBracket', 'upperBracket' ] ) {

		const bracket = provenance[ bracketKey ];
		requireObjectKeys( bracket, [ 'stateVersion', 'sampleInstant', 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'resourceGeneration' ], `${ label }.${ bracketKey}` );
		canonicalInstantSeconds( bracket.sampleInstant, context, `${ label }.${ bracketKey}.sampleInstant` );

	}
	const lower = canonicalInstantSeconds( provenance.lowerBracket.sampleInstant, context, `${ label }.lowerBracket` );
	const upper = canonicalInstantSeconds( provenance.upperBracket.sampleInstant, context, `${ label }.upperBracket` );
	const mapped = canonicalInstantSeconds( provenance.mappedSourceInstant, context, `${ label }.mappedSourceInstant` );
	assert.ok( lower <= mapped && mapped <= upper && upper > lower, `${ label } mapped instant is outside its bracket` );
	const alpha = quantityValue( provenance.interpolation.alpha, `${ label }.interpolation.alpha` );
	assert.ok( Math.abs( alpha - ( mapped - lower ) / ( upper - lower ) ) < 1e-12, `${ label } interpolation alpha disagrees with its own bracket` );

}

function validatePresentedPair( pair, context, signals, leasesById, rebaseTransactionsById, label ) {

	requireAbiRecord( pair, 'PresentedStatePair', label );
	const descriptor = Object.values( signals ).find( ( signal ) => signal.signalId === pair.signalId );
	assert.ok( descriptor && descriptor.providerId === pair.providerId, `${ label } provider/signal descriptor mismatch` );
	for ( const armKey of [ 'previousPresented', 'currentPresented' ] ) {

		const arm = pair[ armKey ];
		requireAbiRecord( arm, 'PresentedStateArm', `${ label }.${ armKey}` );
		validateProvenance( arm.provenance, context, `${ label }.${ armKey}.provenance` );
		canonicalInstantSeconds( arm.presentedInstant, context, `${ label }.${ armKey}.presentedInstant` );
		assert.equal( canonicalInstantIdentity( arm.presentedInstant ), canonicalInstantIdentity( arm.provenance.mappedSourceInstant ), `${ label }.${ armKey}.presentedInstant mismatch` );
		validateStateHandle( arm.stateHandle, leasesById, `${ label }.${ armKey}.stateHandle` );
		requireAbiRecord( arm.globalBinding, 'PresentationSpatialBinding', `${ label }.${ armKey}.globalBinding` );
		assert.ok( Object.values( context.physicsFrameRegistry ).some( ( frame ) => frame.frameId === arm.globalBinding.sourcePhysicsFrameId && frame.transformRevision === arm.globalBinding.transformRevision ), `${ label }.${ armKey}.globalBinding frame/revision is unregistered` );
		assert.equal( arm.provenance.lowerBracket.physicsOriginEpoch, arm.globalBinding.physicsOriginEpoch, `${ label }.${ armKey} lower bracket origin mismatch` );
		assert.equal( arm.provenance.upperBracket.physicsOriginEpoch, arm.globalBinding.physicsOriginEpoch, `${ label }.${ armKey} upper bracket origin mismatch` );
		if ( arm.globalBinding.physicsOriginEpoch === context.physicsOriginEpoch ) assert.ok( isTypedAbsence( arm.originEpochBridge ), `${ label }.${ armKey} must not invent an origin bridge` );
		else {

			requireAbiRecord( arm.originEpochBridge, 'PhysicsOriginEpochBridge', `${ label }.${ armKey}.originEpochBridge` );
			assert.equal( arm.originEpochBridge.fromPhysicsOriginEpoch, arm.globalBinding.physicsOriginEpoch, `${ label }.${ armKey} bridge source epoch mismatch` );
			assert.equal( arm.originEpochBridge.toPhysicsOriginEpoch, context.physicsOriginEpoch, `${ label }.${ armKey} bridge destination epoch mismatch` );
			assert.equal( arm.originEpochBridge.transformedStateVersion, arm.provenance.upperBracket.stateVersion, `${ label }.${ armKey} bridge state-version proof mismatch` );
			const transaction = rebaseTransactionsById.get( arm.originEpochBridge.transactionId );
			assert.ok( transaction, `${ label }.${ armKey} bridge does not resolve to an accepted origin-rebase transaction` );
			assert.deepEqual( [ transaction.fromPhysicsOriginEpoch, transaction.toPhysicsOriginEpoch, transaction.fromToTransform.transformRevision ], [ arm.originEpochBridge.fromPhysicsOriginEpoch, arm.originEpochBridge.toPhysicsOriginEpoch, arm.originEpochBridge.fromToTransformRevision ], `${ label }.${ armKey} bridge transaction mismatch` );

		}

	}
	assert.notEqual( pair.previousPresented.provenance, pair.currentPresented.provenance, `${ label } aliases previous/current provenance` );
	requireAbiRecord( pair.motionBinding, 'MotionBinding', `${ label }.motionBinding` );
	requireAbiEnum( pair.motionBinding.kind, 'motionKinds', `${ label }.motionBinding.kind` );
	requireAbiEnum( pair.motionBinding.motionVectorValidity, 'motionValidity', `${ label }.motionBinding.motionVectorValidity` );
	assert.deepEqual( pair.motionBinding.previousStateHandle, pair.previousPresented.stateHandle, `${ label } previous motion handle mismatch` );
	assert.deepEqual( pair.motionBinding.currentStateHandle, pair.currentPresented.stateHandle, `${ label } current motion handle mismatch` );

}

function validateRenderSimilarityTransform( transform, context, label, expectedInstant, expectedBinding ) {

	requireAbiRecord( transform, 'RenderSimilarityTransform', label );
	assert.ok( Object.values( context.physicsFrameRegistry ).some( ( frame ) => frame.frameId === transform.sourcePhysicsFrameId && frame.transformRevision === transform.sourceTransformRevision ), `${ label } source frame/revision is unregistered` );
	canonicalInstantSeconds( transform.referenceInstant, context, `${ label }.referenceInstant` );
	assert.equal( canonicalInstantIdentity( transform.referenceInstant ), canonicalInstantIdentity( expectedInstant ), `${ label }.referenceInstant does not bind the camera sample instant` );
	assert.deepEqual( [ transform.sourcePhysicsFrameId, transform.sourceTransformRevision, transform.sourcePhysicsOriginEpoch ], [ expectedBinding.sourcePhysicsFrameId, expectedBinding.transformRevision, expectedBinding.physicsOriginEpoch ], `${ label } source binding mismatch` );
	assertProperRotation( transform.properBasisRotation, `${ label }.properBasisRotation` );
	const presentationScale = quantityValue( transform.presentationScale, `${ label }.presentationScale` );
	const renderUnitsPerMeter = quantityValue( transform.renderUnitsPerMeter, `${ label }.renderUnitsPerMeter` );
	const metersPerWorldUnit = quantityValue( context.metersPerWorldUnit, 'physicsContext.metersPerWorldUnit' );
	assert.ok( Math.abs( renderUnitsPerMeter - presentationScale / metersPerWorldUnit ) < 1e-12, `${ label }.renderUnitsPerMeter violates the exact mapping formula` );
	assert.equal( transform.translationRenderUnits.unit, 'render-unit', `${ label }.translationRenderUnits must be expressed in output render units` );

}

function validateLeaseRef( ref, leasesById, label ) {

	requireAbiRecord( ref, 'PresentationResourceLeaseRef', label );
	const lease = leasesById.get( ref.leaseId );
	assert.ok( lease, `${ label } references unknown lease ${ ref.leaseId }` );
	assert.equal( leaseRefIdentity( ref ), leaseRefIdentity( lease ), `${ label } lease generation/layout mismatch` );

}

function validateAffectedRegion( region, allowedLeases, camera, label ) {

	requireAbiRecord( region, 'AffectedRegionDescriptor', label );
	requireAbiEnum( region.kind, 'affectedRegionKinds', `${ label }.kind` );
	const armByKind = { 'full-frame': 'fullFrame', 'entity-set': 'entitySet', 'physics-bounds': 'physicsBounds', 'screen-mask': 'screenMask' };
	for ( const arm of Object.values( armByKind ) ) {

		if ( arm === armByKind[ region.kind ] ) assert.ok( isPlainObject( region[ arm ] ), `${ label }.${ arm} must be the active affected-region arm` );
		else assert.ok( isTypedAbsence( region[ arm ] ), `${ label }.${ arm} must use typed absence` );

	}
	if ( region.kind === 'entity-set' ) assert.ok( Array.isArray( region.entitySet.entityIds ) && region.entitySet.entityIds.length > 0, `${ label }.entitySet requires stable IDs` );
	if ( region.kind === 'physics-bounds' ) requireObjectKeys( region.physicsBounds, [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'boundType', 'boundsMeters', 'error' ], `${ label }.physicsBounds` );
	if ( region.kind === 'screen-mask' ) {

		const mask = requireAbiRecord( region.screenMask, 'ReactiveMaskDescriptor', `${ label }.screenMask` );
		assert.deepEqual( [ mask.presentationTargetId, mask.viewId, mask.cameraId, mask.cameraProjectionRevision ], [ camera.presentationTargetId, camera.viewId, camera.cameraId, camera.cameraProjectionRevision ], `${ label }.screenMask camera/target scope mismatch` );
		assert.ok( allowedLeases.has( mask.resourceLeaseId ), `${ label }.screenMask references an unavailable lease` );

	}

}

function validateCanonicalPresentation( route ) {

	const { physicsContext: context, physicsSignals: signals } = route;
	const candidate = route.physicsPresentationCandidate;
	requireAbiRecord( candidate, 'PhysicsPresentationCandidate', 'physicsPresentationCandidate' );
	assert.equal( candidate.contextId, context.contextId, 'physicsPresentationCandidate.contextId mismatch' );
	assert.equal( candidate.physicsOriginEpoch, context.physicsOriginEpoch, 'physicsPresentationCandidate.physicsOriginEpoch mismatch' );
	canonicalInstantSeconds( candidate.requestedPresentationInstant, context, 'physicsPresentationCandidate.requestedPresentationInstant' );
	for ( const forbidden of [ 'cameraId', 'viewId', 'presentationTargetId', 'renderOriginEpoch', 'globalToRenderCurrent', 'globalToRenderPrevious', 'viewMatrix', 'projectionMatrix' ] ) assert.ok( ! Object.hasOwn( candidate, forbidden ), `physicsPresentationCandidate is not view-independent: ${ forbidden }` );
	const candidateLeasesById = new Map();
	for ( const [ index, lease ] of candidate.resourceLeases.entries() ) {

		requireAbiRecord( lease, 'PresentationResourceLease', `physicsPresentationCandidate.resourceLeases[${ index }]` );
		assert.ok( ! candidateLeasesById.has( lease.leaseId ), `duplicate presentation lease ${ lease.leaseId }` );
		requireAbiRecord( lease.reuseProhibitedUntil, 'ConsumerCompletionJoin', `physicsPresentationCandidate.resourceLeases[${ index }].reuseProhibitedUntil` );
		candidateLeasesById.set( lease.leaseId, lease );

	}
	const pairIds = new Set();
	const rebaseTransactionsById = new Map( route.physicsGraph.originRebaseTransactions.map( ( transaction ) => [ transaction.transactionId, transaction ] ) );
	for ( const [ index, pair ] of candidate.presentedStatePairs.entries() ) {

		assert.ok( ! pairIds.has( pair.bindingId ), `duplicate candidate binding ${ pair.bindingId }` );
		pairIds.add( pair.bindingId );
		validatePresentedPair( pair, context, signals, candidateLeasesById, rebaseTransactionsById, `physicsPresentationCandidate.presentedStatePairs[${ index }]` );

	}
	const bindingSignature = ( binding ) => `${ binding.sourcePhysicsFrameId }|${ binding.transformRevision }|${ binding.physicsOriginEpoch }`;
	const previousBindings = new Map( candidate.presentedStatePairs.map( ( pair ) => [ bindingSignature( pair.previousPresented.globalBinding ), pair.previousPresented.globalBinding ] ) );
	const currentBindings = new Map( candidate.presentedStatePairs.map( ( pair ) => [ bindingSignature( pair.currentPresented.globalBinding ), pair.currentPresented.globalBinding ] ) );
	assert.equal( previousBindings.size, 1, 'candidate previous arms cannot share one camera transform across different source bindings' );
	assert.equal( currentBindings.size, 1, 'candidate current arms cannot share one camera transform across different source bindings' );
	const previousBinding = previousBindings.values().next().value;
	const currentBinding = currentBindings.values().next().value;
	const cameras = route.physicsCameraViewPublicationsByTarget;
	const preparations = route.physicsViewPreparationPublicationsByTarget;
	const snapshots = route.physicsPresentationSnapshotsByTarget;
	requireNonEmptyMapping( cameras, 'physicsCameraViewPublicationsByTarget' );
	requireNonEmptyMapping( preparations, 'physicsViewPreparationPublicationsByTarget' );
	requireNonEmptyMapping( snapshots, 'physicsPresentationSnapshotsByTarget' );
	const cameraIds = new Set();
	const preparationIds = new Set();
	const snapshotIds = new Set();
	const leasesById = new Map( candidateLeasesById );
	const allowedLeasesByTargetView = new Map();
	for ( const [ targetViewKey, camera ] of Object.entries( cameras ) ) {

		const label = `physicsCameraViewPublicationsByTarget.${ targetViewKey }`;
		requireAbiRecord( camera, 'CameraViewPublication', label );
		assert.equal( camera.candidateId, candidate.candidateId, `${ label }.candidateId mismatch` );
		assert.equal( targetViewKey, `${ camera.presentationTargetId }/${ camera.viewId }`, `${ label } registry key mismatch` );
		assert.ok( ! cameraIds.has( camera.cameraPublicationId ), `${ label } duplicates cameraPublicationId` );
		cameraIds.add( camera.cameraPublicationId );
		canonicalInstantSeconds( camera.previousRenderSampleInstant, context, `${ label }.previousRenderSampleInstant` );
		canonicalInstantSeconds( camera.currentRenderSampleInstant, context, `${ label }.currentRenderSampleInstant` );
		validateRenderSimilarityTransform( camera.globalToRenderPrevious, context, `${ label }.globalToRenderPrevious`, camera.previousRenderSampleInstant, previousBinding );
		validateRenderSimilarityTransform( camera.globalToRenderCurrent, context, `${ label }.globalToRenderCurrent`, camera.currentRenderSampleInstant, currentBinding );

	}
	for ( const [ targetViewKey, preparation ] of Object.entries( preparations ) ) {

		const label = `physicsViewPreparationPublicationsByTarget.${ targetViewKey }`;
		requireAbiRecord( preparation, 'ViewPreparationPublication', label );
		const camera = cameras[ targetViewKey ];
		assert.ok( camera, `${ label } has no matching camera publication` );
		assert.equal( preparation.candidateId, candidate.candidateId, `${ label }.candidateId mismatch` );
		assert.equal( preparation.cameraPublicationId, camera.cameraPublicationId, `${ label }.cameraPublicationId mismatch` );
		assert.equal( preparation.presentationTargetId, camera.presentationTargetId, `${ label } target mismatch` );
		assert.equal( preparation.viewId, camera.viewId, `${ label } view mismatch` );
		assert.ok( ! preparationIds.has( preparation.viewPreparationId ), `${ label } duplicates viewPreparationId` );
		preparationIds.add( preparation.viewPreparationId );
		const allowedLeases = new Map( candidateLeasesById );
		for ( const [ index, lease ] of preparation.resourceLeases.entries() ) {

			requireAbiRecord( lease, 'PresentationResourceLease', `${ label }.resourceLeases[${ index }]` );
			assert.ok( ! leasesById.has( lease.leaseId ), `${ label } duplicates or imports another publication's full lease ${ lease.leaseId }` );
			requireAbiRecord( lease.reuseProhibitedUntil, 'ConsumerCompletionJoin', `${ label }.resourceLeases[${ index }].reuseProhibitedUntil` );
			leasesById.set( lease.leaseId, lease );
			allowedLeases.set( lease.leaseId, lease );

		}
		allowedLeasesByTargetView.set( targetViewKey, allowedLeases );
		for ( const [ index, ref ] of preparation.resourceLeaseRefs.entries() ) validateLeaseRef( ref, allowedLeases, `${ label }.resourceLeaseRefs[${ index }]` );
		for ( const [ index, shadowRef ] of preparation.shadowViewPublicationRefs.entries() ) {

			const shadowLabel = `${ label }.shadowViewPublicationRefs[${ index }]`;
			requireAbiRecord( shadowRef, 'ShadowViewPublicationRef', shadowLabel );
			assert.deepEqual( [ shadowRef.presentationTargetId, shadowRef.receiverViewId, shadowRef.cameraPublicationId, shadowRef.cameraProjectionRevision ], [ camera.presentationTargetId, camera.viewId, camera.cameraPublicationId, camera.cameraProjectionRevision ], `${ shadowLabel } camera/target scope mismatch` );
			for ( const [ refIndex, ref ] of shadowRef.resourceLeaseRefs.entries() ) validateLeaseRef( ref, allowedLeases, `${ shadowLabel }.resourceLeaseRefs[${ refIndex }]` );
			if ( ! isTypedAbsence( shadowRef.boundedDelay ) ) validateCanonicalDuration( shadowRef.boundedDelay, context, `${ shadowLabel }.boundedDelay` );

		}
		const actionIds = new Set( preparation.resetDependencies.map( ( action ) => action.actionId ) );
		for ( const [ index, publication ] of preparation.reactivePublications.entries() ) {

			const publicationLabel = `${ label }.reactivePublications[${ index }]`;
			requireAbiRecord( publication, 'ReactivePublication', publicationLabel );
			requireAbiEnum( publication.kind, 'reactiveKinds', `${ publicationLabel }.kind` );
			assert.deepEqual( [ publication.presentationTargetId, publication.viewId ], [ camera.presentationTargetId, camera.viewId ], `${ publicationLabel } target/view mismatch` );
			validateAffectedRegion( publication.affectedRegion, allowedLeases, camera, `${ publicationLabel }.affectedRegion` );
			if ( ! isTypedAbsence( publication.resourceLeaseId ) ) assert.ok( allowedLeases.has( publication.resourceLeaseId ), `${ publicationLabel } references an unavailable lease` );
			assert.ok( publication.plannedConsumerActions.every( ( actionId ) => actionIds.has( actionId ) ), `${ publicationLabel } references an unknown reset action` );

		}
		for ( const [ index, action ] of preparation.resetDependencies.entries() ) {

			const actionLabel = `${ label }.resetDependencies[${ index }]`;
			requireAbiRecord( action, 'ScopedResetAction', actionLabel );
			requireAbiEnum( action.policy, 'resetPolicies', `${ actionLabel }.policy` );
			assert.deepEqual( [ action.presentationTargetId, action.viewId ], [ camera.presentationTargetId, camera.viewId ], `${ actionLabel } target/view mismatch` );
			validateAffectedRegion( action.affectedRegion, allowedLeases, camera, `${ actionLabel }.affectedRegion` );
			assert.ok( action.dependencies.every( ( dependency ) => actionIds.has( dependency ) && dependency !== action.actionId ), `${ actionLabel } has an unknown/self dependency` );
			if ( ! isTypedAbsence( action.resourceLeaseId ) ) assert.ok( allowedLeases.has( action.resourceLeaseId ), `${ actionLabel } references an unavailable lease` );

		}

	}
	assert.deepEqual( Object.keys( preparations ).sort(), Object.keys( cameras ).sort(), 'every camera publication must have exactly one keyed view-preparation publication' );
	for ( const targetViewKey of Object.keys( cameras ) ) if ( ! Object.hasOwn( snapshots, targetViewKey ) ) {

		const failedTarget = route.frameExecutionRecord.targetExecutions[ targetViewKey ];
		assert.ok( failedTarget && [ 'failed', 'aborted', 'device-lost' ].includes( failedTarget.status ) && isTypedAbsence( failedTarget.snapshotId ), `camera/preparation ${ targetViewKey } has neither a sealed snapshot nor typed failed-target execution` );

	}
	for ( const targetViewKey of Object.keys( snapshots ) ) assert.ok( Object.hasOwn( cameras, targetViewKey ) && Object.hasOwn( preparations, targetViewKey ), `snapshot ${ targetViewKey } has no exact camera/preparation chain` );
	const snapshotConsumersByLeaseId = new Map( [ ...leasesById.keys() ].map( ( leaseId ) => [ leaseId, [] ] ) );
	for ( const [ targetViewKey, snapshot ] of Object.entries( snapshots ) ) {

		const label = `physicsPresentationSnapshotsByTarget.${ targetViewKey }`;
		requireAbiRecord( snapshot, 'PhysicsPresentationSnapshot', label );
		const camera = cameras[ targetViewKey ];
		const preparation = preparations[ targetViewKey ];
		assert.ok( camera && preparation, `${ label } has no camera/preparation publication chain` );
		assert.equal( snapshot.candidateId, candidate.candidateId, `${ label }.candidateId mismatch` );
		assert.equal( snapshot.cameraPublicationId, camera.cameraPublicationId, `${ label }.cameraPublicationId mismatch` );
		assert.equal( snapshot.viewPreparationId, preparation.viewPreparationId, `${ label }.viewPreparationId mismatch` );
		assert.deepEqual( [ snapshot.presentationTargetId, snapshot.viewId ], [ camera.presentationTargetId, camera.viewId ], `${ label } target/view mismatch` );
		assert.ok( snapshot.presentedStatePairRefs.every( ( id ) => pairIds.has( id ) ), `${ label } references unknown candidate pair` );
		const allowedLeases = allowedLeasesByTargetView.get( targetViewKey );
		for ( const [ index, ref ] of snapshot.resourceLeaseRefs.entries() ) {

			validateLeaseRef( ref, allowedLeases, `${ label }.resourceLeaseRefs[${ index }]` );
			snapshotConsumersByLeaseId.get( ref.leaseId ).push( snapshot.snapshotId );

		}
		for ( const forbidden of [ 'presentedStatePairs', 'globalToRenderCurrent', 'globalToRenderPrevious', 'cameraPublication', 'reactivePublications', 'resetDependencies' ] ) assert.ok( ! Object.hasOwn( snapshot, forbidden ), `${ label } copies mutable ${ forbidden } instead of referencing prior publications` );
		assert.ok( ! snapshotIds.has( snapshot.snapshotId ), `${ label } duplicates snapshotId` );
		snapshotIds.add( snapshot.snapshotId );

	}
	return { leasesById, snapshotIds, snapshotConsumersByLeaseId };

}

function validateCanonicalExecution( execution, route, presentation ) {

	requireAbiRecord( execution, 'FrameExecutionRecord', 'frameExecutionRecord' );
	assert.equal( execution.candidateId, route.physicsPresentationCandidate.candidateId, 'frameExecutionRecord.candidateId mismatch' );
	requireAbiEnum( execution.overallStatus, 'executionStatuses', 'frameExecutionRecord.overallStatus' );
	assert.deepEqual( Object.keys( execution.targetExecutions ).sort(), Object.keys( route.physicsCameraViewPublicationsByTarget ).sort(), 'frameExecutionRecord must contain exactly one target execution per camera target/view' );
	assert.ok( execution.snapshotIds.every( ( id ) => presentation.snapshotIds.has( id ) ), 'frameExecutionRecord references unknown snapshot' );
	assert.deepEqual( [ ...execution.snapshotIds ].sort(), Object.values( route.physicsPresentationSnapshotsByTarget ).map( ( snapshot ) => snapshot.snapshotId ).sort(), 'frameExecutionRecord.snapshotIds must equal every actually sealed route snapshot' );
	const targetSnapshotIds = Object.values( execution.targetExecutions ).filter( ( target ) => ! isTypedAbsence( target.snapshotId ) ).map( ( target ) => target.snapshotId ).sort();
	assert.deepEqual( [ ...execution.snapshotIds ].sort(), targetSnapshotIds, 'frameExecutionRecord.snapshotIds must equal successful target snapshot IDs exactly' );
	for ( const [ key, target ] of Object.entries( execution.targetExecutions ) ) {

		const label = `frameExecutionRecord.targetExecutions.${ key}`;
		requireAbiRecord( target, 'TargetExecution', label );
		requireAbiEnum( target.status, 'targetExecutionStatuses', `${ label }.status` );
		const keyedSnapshot = route.physicsPresentationSnapshotsByTarget[ key ];
		if ( [ 'aborted', 'device-lost', 'failed' ].includes( target.status ) && isTypedAbsence( target.snapshotId ) ) {

			assert.deepEqual( target.submittedPasses, [], `${ label } pre-seal failure cannot submit passes` );
			assert.deepEqual( target.completionTokens, [], `${ label } pre-seal failure cannot fabricate completion tokens` );

		} else {

			assert.ok( keyedSnapshot, `${ label } has no snapshot chain for its target/view key` );
			assert.ok( presentation.snapshotIds.has( target.snapshotId ), `${ label } references unknown snapshot` );
			assert.equal( target.snapshotId, keyedSnapshot.snapshotId, `${ label } swaps another target/view snapshot` );

		}

	}
	assert.deepEqual( Object.keys( execution.leaseDispositionById ).sort(), [ ...presentation.leasesById.keys() ].sort(), 'frameExecutionRecord must disposition every candidate lease by leaseId' );
	for ( const [ leaseId, disposition ] of Object.entries( execution.leaseDispositionById ) ) {

		const label = `frameExecutionRecord.leaseDispositionById.${ leaseId}`;
		requireAbiRecord( disposition, 'LeaseDisposition', label );
		requireAbiEnum( disposition.disposition, 'leaseDispositions', `${ label }.disposition` );
		requireAbiRecord( disposition.completionJoin, 'ConsumerCompletionJoin', `${ label }.completionJoin` );
		assert.ok( disposition.consumingSnapshotIds.every( ( id ) => presentation.snapshotIds.has( id ) ), `${ label } references unknown consuming snapshot` );
		assert.deepEqual( [ ...disposition.consumingSnapshotIds ].sort(), [ ...presentation.snapshotConsumersByLeaseId.get( leaseId ) ].sort(), `${ label } completion join omits or invents a snapshot consumer` );
		if ( execution.overallStatus === 'device-lost' ) {

			const lease = presentation.leasesById.get( leaseId );
			assert.equal( disposition.disposition, 'invalidated-by-device-loss', `${ label } must invalidate on device loss` );
			assert.deepEqual( disposition.completionJoin.presentationConsumers, [], `${ label } cannot wait for normal presentation completion after device loss` );
			assert.equal( execution.deviceLossGeneration, lease.deviceLossGeneration, `${ label } does not identify the lost device generation` );
			requireObjectKeys( disposition.retirementEvidence, [ 'lostDeviceLossGeneration', 'lostResourceGeneration' ], `${ label }.retirementEvidence` );
			assert.equal( disposition.retirementEvidence.lostDeviceLossGeneration, lease.deviceLossGeneration, `${ label } loss-generation evidence mismatch` );
			assert.equal( disposition.retirementEvidence.lostResourceGeneration, lease.resourceGeneration, `${ label } resource-generation evidence mismatch` );

		}

	}
	if ( execution.overallStatus === 'device-lost' ) for ( const [ key, target ] of Object.entries( execution.targetExecutions ) ) assert.equal( target.status, 'device-lost', `frameExecutionRecord.targetExecutions.${ key} must identify the affected target as device-lost` );

}

function validateCanonicalCostLedger( ledger, graph, context ) {

	requireAbiRecord( ledger, 'PhysicsCostLedger', 'physicsCostLedger' );
	assert.equal( ledger.contextId, graph.contextId, 'physicsCostLedger.contextId mismatch' );
	assert.equal( ledger.graphId, graph.graphId, 'physicsCostLedger.graphId mismatch' );
	assert.equal( ledger.graphRevision, graph.executionLedger.graphRevision, 'physicsCostLedger.graphRevision mismatch' );
	validateCanonicalInterval( ledger.measurementInterval, context, 'physicsCostLedger.measurementInterval' );
	assert.equal( ledger.measurementClockId, ledger.measurementInterval.clockId, 'physicsCostLedger measurement clock mismatch' );
	assert.equal( ledger.status, 'active', 'physicsCostLedger is not active' );
	assert.ok( ledger.presentationTargetsAndViews.length >= 2 && ledger.measurementProtocolRefs.length >= 2, 'physicsCostLedger omits multiview/protocol trace identity' );
	assert.match( ledger.targetAndHarness, /mobile|low-end|tile/i, 'physicsCostLedger must name the sustained mobile/low-end harness' );
	assert.ok( ledger.graphStageCosts.length > 0, 'physicsCostLedger.graphStageCosts must be active' );
	const stageIds = new Set( graph.stages.map( ( stage ) => stage.stageId ) );
	for ( const cost of ledger.graphStageCosts ) {

		assert.ok( stageIds.has( cost.stageId ), `physicsCostLedger references unknown stage ${ cost.stageId }` );
		assert.ok( quantityValue( cost.sampleCount, `physicsCostLedger.${ cost.stageId }.sampleCount` ) >= 120, `physicsCostLedger.${ cost.stageId } is not a sustained sample` );

	}
	for ( const key of [
		'coordinationIntervalsPerSecond', 'stageExecutionsPerCoordinationInterval',
		'stageExecutionsPerSecond', 'coordinationIntervalsPerPresentedFrame',
		'subcyclesAndCouplingIterationsPerPresentedFrame', 'executionsPerPresentedFrame'
	] ) requireNonEmptyMapping( ledger[ key ], `physicsCostLedger.${ key}` );
	const intervalsPerSecond = quantityValue( ledger.coordinationIntervalsPerSecond.p50, 'physicsCostLedger.coordinationIntervalsPerSecond.p50' );
	const intervalsPerFrame = quantityValue( ledger.coordinationIntervalsPerPresentedFrame.p95, 'physicsCostLedger.coordinationIntervalsPerPresentedFrame.p95' );
	assert.ok( intervalsPerSecond > 0 && intervalsPerFrame > 0, 'physicsCostLedger interval cadences must be positive' );
	requireObjectKeys( ledger.traceTotals, [ 'coordinationIntervals', 'presentedFrames', 'stageExecutions' ], 'physicsCostLedger.traceTotals' );
	const exactIntervals = quantityValue( ledger.traceTotals.coordinationIntervals, 'physicsCostLedger.traceTotals.coordinationIntervals' );
	const exactFrames = quantityValue( ledger.traceTotals.presentedFrames, 'physicsCostLedger.traceTotals.presentedFrames' );
	assert.ok( Number.isInteger( exactIntervals ) && Number.isInteger( exactFrames ) && exactIntervals > 0 && exactFrames > 0, 'physicsCostLedger exact trace totals must be positive integers' );
	for ( const stageId of stageIds ) {

		const perInterval = quantityValue( ledger.stageExecutionsPerCoordinationInterval[ stageId ].count, `physicsCostLedger.stageExecutionsPerCoordinationInterval.${ stageId }` );
		const perSecond = quantityValue( ledger.stageExecutionsPerSecond[ stageId ].count, `physicsCostLedger.stageExecutionsPerSecond.${ stageId }` );
		const perFrame = quantityValue( ledger.executionsPerPresentedFrame[ stageId ].count, `physicsCostLedger.executionsPerPresentedFrame.${ stageId }` );
		assert.ok( perInterval > 0 && perSecond > 0 && perFrame > 0, `physicsCostLedger ${ stageId } cadence must be positive` );
		assert.ok( Math.abs( perSecond - perInterval * intervalsPerSecond ) <= 1e-9, `physicsCostLedger ${ stageId } per-second cadence is inconsistent with its per-interval cadence` );
		const exactExecutions = quantityValue( ledger.traceTotals.stageExecutions[ stageId ], `physicsCostLedger.traceTotals.stageExecutions.${ stageId }` );
		assert.equal( exactExecutions, perInterval * exactIntervals, `physicsCostLedger ${ stageId } exact trace totals are inconsistent` );

	}
	for ( const [ owner, count ] of Object.entries( ledger.subcyclesAndCouplingIterationsPerPresentedFrame ) ) assert.ok( quantityValue( count, `physicsCostLedger.subcycles.${ owner }` ) > 0, `physicsCostLedger ${ owner } subcycle count must be positive` );
	requireObjectKeys( ledger.worstPermittedCatchUpBurst, [ 'triggerAndIntervalDebt', 'executionsDispatchesAndTraffic', 'latencyMemoryAndErrorGate' ], 'physicsCostLedger.worstPermittedCatchUpBurst' );
	requireNonEmptyMapping( ledger.hotBytesReadWrittenPerExecution, 'physicsCostLedger.hotBytesReadWrittenPerExecution' );
	for ( const stageId of stageIds ) assert.ok( Object.hasOwn( ledger.hotBytesReadWrittenPerExecution, stageId ), `physicsCostLedger lacks hot-byte traffic for ${ stageId }` );
	requireObjectKeys( ledger.tileGpuTraffic, [ 'attachmentStoreLoadResolveBytes', 'tileSpillEvidence', 'renderComputePassBreaks' ], 'physicsCostLedger.tileGpuTraffic' );
	assert.ok( ledger.bindingAndDeviceLimits.length > 0, 'physicsCostLedger must gate binding/device limits' );
	for ( const [ index, limit ] of ledger.bindingAndDeviceLimits.entries() ) {

		const demand = quantityValue( limit.demand, `physicsCostLedger.bindingAndDeviceLimits[${ index }].demand` );
		const deviceLimit = quantityValue( limit.deviceLimit, `physicsCostLedger.bindingAndDeviceLimits[${ index }].deviceLimit` );
		const headroom = quantityValue( limit.requiredHeadroom, `physicsCostLedger.bindingAndDeviceLimits[${ index }].requiredHeadroom` );
		assert.ok( demand + headroom <= deviceLimit, `physicsCostLedger.bindingAndDeviceLimits[${ index }] exceeds the device limit/headroom gate` );

	}
	assert.equal( quantityValue( ledger.hostCompletionsReadbacksPerPresentedFrame, 'physicsCostLedger.hostCompletionsReadbacksPerPresentedFrame' ), 0, 'physicsCostLedger steady runtime contains frame-critical host readback' );
	for ( const key of [ 'hotState', 'peakTransient', 'migrationOverlap' ] ) {

		requireObjectKeys( ledger[ key ], [ 'logicalBytes', 'physicalBytesMeasured', 'includedResources' ], `physicsCostLedger.${ key}` );
		assert.ok( ledger[ key ].includedResources.length > 0, `physicsCostLedger.${ key } omits live resources` );

	}
	requireObjectKeys( ledger.multiviewAndFramesInFlightMultipliers, [ 'viewCount', 'framesInFlight', 'resourceMultiplier', 'workMultiplier' ], 'physicsCostLedger.multiviewAndFramesInFlightMultipliers' );
	assert.ok( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.viewCount, 'physicsCostLedger.viewCount' ) >= 2, 'physicsCostLedger fixture must cover multiview multiplication' );
	assert.ok( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.framesInFlight, 'physicsCostLedger.framesInFlight' ) >= 2, 'physicsCostLedger fixture must cover frames-in-flight multiplication' );
	assert.equal( graph.executionLedger.physicsCostLedgerId, ledger.ledgerId, 'physicsGraph.executionLedger does not bind the active PhysicsCostLedger' );

}

function validateCanonicalPhysicsContract( route ) {

	validateCanonicalContext( route.physicsContext );
	assert.ok( isPlainObject( route.physicsSignals ) && Object.keys( route.physicsSignals ).length >= 3, 'physical route requires registered gravity/water/body signals' );
	for ( const [ key, descriptor ] of Object.entries( route.physicsSignals ) ) validateCanonicalSignal( key, descriptor, route.physicsContext );
	const gravity = Object.values( route.physicsSignals ).find( ( descriptor ) => descriptor.signalId === route.physicsContext.gravityProvider.signalId );
	assert.ok( gravity, 'physicsContext.gravityProvider does not resolve to a registered descriptor' );
	assert.equal( gravity.stateVersion, route.physicsContext.gravityProvider.stateVersion, 'physicsContext.gravityProvider version mismatch' );
	validateCanonicalGraph( route.physicsGraph, route.physicsSignals, route.physicsContext );
	assert.ok( Array.isArray( route.physicsInteractions ) && route.physicsInteractions.length > 0, 'physical route requires an interaction exchange' );
	for ( let i = 0; i < route.physicsInteractions.length; i ++ ) validateCanonicalExchange( route.physicsInteractions[ i ], route.physicsContext, i );
	const presentation = validateCanonicalPresentation( route );
	validateCanonicalExecution( route.frameExecutionRecord, route, presentation );
	validateCanonicalCostLedger( route.physicsCostLedger, route.physicsGraph, route.physicsContext );
	assert.ok( isNotUsedRecord( route.physicsPresentationSnapshot ), 'deprecated singular physicsPresentationSnapshot must remain not used' );
	validateNumericEvidence( route );

}

function makeCanonicalClocks() {

	const absentMapping = ( owner = 'route-physics-coordinator' ) => typedAbsence( 'not-applicable', owner, 'fixture clock coverage', 'inactive clock-mapping arm' );
	const instantKey = ( tick, numerator = 0, denominator = 1 ) => ( { tick, rationalSubstep: { numerator, denominator } } );
	const inlineEntries = ( entries ) => ( { storage: 'inline', inlineEntries: entries, resourceRef: absentMapping() } );
	const timestampMapping = ( tableVersion, rows, source ) => ( {
		tableVersion,
		coveredInstantRange: { startInclusive: instantKey( rows[ 0 ][ 0 ] ), endInclusive: instantKey( rows.at( - 1 )[ 0 ] ) },
		knotTable: inlineEntries( rows.map( ( [ tick, seconds ] ) => ( { instantKey: instantKey( tick ), timeSeconds: evidence( seconds, 'second', 'Derived', source ) } ) ) ),
		interpolationRule: 'piecewise-linear-seconds', outOfRangePolicy: 'reject', error: fixtureError( 'second', 1e-9, `${ tableVersion }-error` )
	} );
	const segment = ( startTick, endTick, secondsAtStart, numerator, denominator ) => ( {
		startInclusive: instantKey( startTick ), endExclusive: instantKey( endTick ),
		secondsAtStart: evidence( secondsAtStart, 'second', 'Derived', 'water-segments-v5' ),
		secondsPerTick: evidence( { numerator, denominator }, 'second-per-tick', 'Derived', 'water-segments-v5' )
	} );
	const weatherTable = timestampMapping( 'weather-table-v3', [ [ 9, 0.69 ], [ 10, 0.7 ], [ 11, 0.706 ], [ 12, 0.7166666666666667 ], [ 13, 0.728 ] ], 'weather-table-v3' );
	const externalTable = timestampMapping( 'event-frozen-table-v2', [ [ 6, 0.69 ], [ 7, 0.7 ], [ 8, 0.7166666666666667 ], [ 9, 0.73 ] ], 'event-adapter-v2:frozen-response-digests' );
	const externalEntries = externalTable.knotTable.inlineEntries;
	const externalDigest = `sha256:${ createHash( 'sha256' ).update( JSON.stringify( externalEntries ) ).digest( 'hex' ) }`;
	clockMappingResourceFixtures.set( externalDigest, externalEntries );
	externalTable.knotTable = { storage: 'immutable-resource', inlineEntries: absentMapping( 'contact-event-owner' ), resourceRef: { contentDigest: externalDigest, byteLayout: 'canonical-json-clock-knot-table-v1', elementCount: externalEntries.length } };
	return {
		fixed: {
			clockId: 'physics-fixed', owner: 'route-physics-coordinator', mappingRevision: 'fixed-map-v1', discontinuityEpoch: 'time-continuity-1',
			mappingKind: 'fixed-rational',
			mapping: {
				fixedRational: { epochTick: 0, epochRationalSubstep: { numerator: 0, denominator: 1 }, epochSeconds: evidence( 0, 'second', 'Authored', 'fixture-clock' ), secondsPerTick: evidence( { numerator: 1, denominator: 60 }, 'second-per-tick', 'Gated', 'fixture-clock' ) },
				timestampTable: absentMapping(), piecewiseVersioned: absentMapping(), external: absentMapping()
			},
			pauseSeekPolicy: 'atomic discontinuity epoch', timeScalePolicy: 'unit scale', coordinationClockMap: 'identity fixed-map-v1'
		},
		nonuniform: {
			clockId: 'weather-nonuniform', owner: 'environment-owner', mappingRevision: 'weather-table-v3', discontinuityEpoch: 'time-continuity-1',
			mappingKind: 'timestamp-table',
			mapping: { fixedRational: absentMapping( 'environment-owner' ), timestampTable: weatherTable, piecewiseVersioned: absentMapping( 'environment-owner' ), external: absentMapping( 'environment-owner' ) },
			pauseSeekPolicy: 'publish discontinuity', timeScalePolicy: 'timestamp authority', coordinationClockMap: 'weather-to-fixed-v3 with bounded error'
		},
		adaptive: {
			clockId: 'water-adaptive', owner: '$threejs-water-optics', mappingRevision: 'water-segments-v5', discontinuityEpoch: 'time-continuity-1',
			mappingKind: 'piecewise-versioned',
			mapping: { fixedRational: absentMapping( '$threejs-water-optics' ), timestampTable: absentMapping( '$threejs-water-optics' ), piecewiseVersioned: {
				segmentTableVersion: 'water-segments-v5', coveredInstantRange: { startInclusive: instantKey( 98 ), endExclusive: instantKey( 104 ) },
				segmentTable: inlineEntries( [ segment( 98, 99, 0.69, 3, 500 ), segment( 99, 100, 0.696, 1, 250 ), segment( 100, 101, 0.7, 1, 250 ), segment( 101, 102, 0.704, 3, 500 ), segment( 102, 103, 0.71, 1, 150 ), segment( 103, 104, 0.7166666666666667, 11, 1500 ) ] ),
				outOfRangePolicy: 'reject', error: fixtureError( 'second', 1e-9, 'water-clock-error-v1' )
			}, external: absentMapping( '$threejs-water-optics' ) },
			pauseSeekPolicy: 'rollback segment transaction', timeScalePolicy: 'adaptive error controller', coordinationClockMap: 'water-to-fixed-v5 with bounded error'
		},
		event: {
			clockId: 'contact-event', owner: 'contact-event-owner', mappingRevision: 'event-adapter-v2', discontinuityEpoch: 'time-continuity-1',
			mappingKind: 'external',
			mapping: { fixedRational: absentMapping( 'contact-event-owner' ), timestampTable: absentMapping( 'contact-event-owner' ), piecewiseVersioned: absentMapping( 'contact-event-owner' ), external: {
				adapterId: 'contact-event-adapter', adapterVersion: 'event-adapter-build-2', mappingHandle: 'event-map-2',
				coveredInstantRange: { startInclusive: instantKey( 6 ), endInclusive: instantKey( 9 ) }, frozenEvaluationTable: externalTable,
				onlineQueryProtocol: 'request-instant-response-seconds-adapter-revision-response-digest-v1', unloggedQueryPolicy: 'reject', error: fixtureError( 'second', 1e-9, 'event-clock-error-v1' )
			} },
			pauseSeekPolicy: 'drain or reject queued events', timeScalePolicy: 'external event authority', coordinationClockMap: 'event-to-fixed-v2 with bounded error'
		}
	};

}

function fixtureClockById( clocks, clockId ) {

	return Object.values( clocks ).find( ( clock ) => clock.clockId === clockId );

}

function fixtureInstant( clocks, clockId, tick, numerator = 0, denominator = 1 ) {

	const clock = fixtureClockById( clocks, clockId );
	assert.ok( clock, `fixture clock ${ clockId } missing` );
	let seconds;
	const coordinate = tick + numerator / denominator;
	if ( clock.mappingKind === 'fixed-rational' ) {

		const mapping = clock.mapping.fixedRational;
		seconds = mapping.epochSeconds.value + ( coordinate - mapping.epochTick - mapping.epochRationalSubstep.numerator / mapping.epochRationalSubstep.denominator ) * mapping.secondsPerTick.value.numerator / mapping.secondsPerTick.value.denominator;

	} else if ( clock.mappingKind === 'timestamp-table' ) seconds = timestampMappingSeconds( clock.mapping.timestampTable, coordinate, 'fixture.timestampTable' );
	else if ( clock.mappingKind === 'piecewise-versioned' ) seconds = piecewiseMappingSeconds( clock.mapping.piecewiseVersioned, coordinate, 'fixture.piecewiseVersioned' );
	else seconds = timestampMappingSeconds( clock.mapping.external.frozenEvaluationTable, coordinate, 'fixture.external.frozenEvaluationTable' );
	return {
		clockId, tick, rationalSubstep: { numerator, denominator },
		clockMappingRevision: clock.mappingRevision, discontinuityEpoch: clock.discontinuityEpoch,
		timeSecondsDerived: evidence( seconds, 'second', 'Derived', `${ clock.mappingRevision}:tick-and-canonical-rational` )
	};

}

function fixtureInterval( clocks, clockId, startTick, endTick, startRational = [ 0, 1 ], endRational = [ 0, 1 ] ) {

	const clock = fixtureClockById( clocks, clockId );
	return {
		clockId,
		start: fixtureInstant( clocks, clockId, startTick, ...startRational ),
		endExclusive: fixtureInstant( clocks, clockId, endTick, ...endRational ),
		intervalMappingRevision: clock.mappingRevision
	};

}

function fixtureDurationSeconds( seconds, source = 'fixture-scheduler' ) {

	return { kind: 'seconds', seconds: evidence( seconds, 'second', 'Gated', source ), clockSpan: typedAbsence( 'not-applicable', source ), secondsDerived: typedAbsence( 'not-applicable', source ), mappingError: typedAbsence( 'not-applicable', source ) };

}

function fixtureError( unit, bound, source ) {

	return {
		errorId: `${ source }/${ unit }/error`, quantityOrChannelId: `${ source }/${ unit }`, classification: 'hard-bound', norm: 'L-infinity',
		basisFrameId: typedAbsence( 'not-applicable', source ), support: typedAbsence( 'not-applicable', source ),
		boundOrStatistic: evidence( bound, unit, 'Gated', source ), confidenceOrCoverage: typedAbsence( 'not-applicable', source ),
		correlationModel: 'bounded-adversarial', combinationRule: 'triangle', source,
		validity: { status: 'valid', domain: 'canonical fixture domain', validTime: 'timeless', staleAfter: typedAbsence( 'not-applicable', source ), reason: typedAbsence( 'not-applicable', source ), acceptanceGate: 'finite dimension-compatible bound' }
	};

}

function fixtureFrame( clocks, fields ) {

	return {
		frameId: fields.frameId, parentFrameId: fields.parentFrameId, owner: fields.owner,
		transformRevision: fields.transformRevision,
		referenceInstant: fixtureInstant( clocks, 'physics-fixed', 42 ),
		parentFromFrameRotation: evidence( fields.rotation, 'matrix3', 'Derived', fields.source ),
		parentFromFrameTranslationMeters: evidence( fields.translation, 'metre', 'Derived', fields.source ),
		originCoordinateRateInParentMps: evidence( fields.linearRate, 'metre-per-second', 'Derived', fields.source ),
		angularRateOfFrameRelativeToParentInParentRadPerS: evidence( fields.angularRate, 'radian-per-second', 'Derived', fields.source ),
		originCoordinateAccelerationInParentMps2: typedAbsence( 'unavailable', fields.owner ), angularAccelerationInParentRadPerS2: typedAbsence( 'unavailable', fields.owner ),
		validityInterval: fixtureInterval( clocks, 'physics-fixed', 40, 45 ), uncertainty: fixtureError( 'metre', 1e-9, fields.source )
	};

}

function fixturePhysicsSignal( fields ) {

	const support = {
		supportId: `${ fields.signalId }/support`, kind: 'area', physicsFrameId: fields.physicsFrameId, physicsOriginEpoch: 'physics-origin-17', transformRevision: fields.transformRevision,
		chartId: typedAbsence( 'not-applicable', fields.owner ), geometry: 'bounded physical support v1', orientation: 'physics-frame oriented area', measureUnit: 'square-metre',
		representedMeasure: evidence( 64, 'square-metre', 'Derived', 'fixture-domain' ), error: fixtureError( 'square-metre', 1e-6, 'fixture-support' )
	};
	const filter = {
		filterId: `${ fields.signalId }/filter`, supportMeasure: 'area', kernelOrTransferFunction: 'fixture reconstruction transfer v1',
		spatialBandwidth: 'fixture spatial band', temporalBandwidth: 'fixture temporal band', phaseSemantics: 'phase-resolved', normalization: 'unit DC gain over declared support',
		causality: 'causal', error: fixtureError( 'ratio', 1e-5, 'fixture-filter' )
	};
	const validity = {
		status: 'valid', domain: 'fixture spatial/temporal/version domain', validTime: { kind: 'interval', instant: typedAbsence( 'not-applicable', fields.owner ), interval: fields.sampleInterval },
		staleAfter: fixtureDurationSeconds( 0.05, 'fixture-staleness-gate' ), reason: typedAbsence( 'not-applicable', fields.owner ), acceptanceGate: 'inside support/version and staleness bound'
	};
	const channels = Object.fromEntries( fields.channels.map( ( channel ) => [ channel.id, {
		channelId: channel.id, valueType: channel.valueType, tensorRankAndShape: channel.kind, unit: channel.unit, basisBehavior: channel.basisBehavior,
		quantityClass: channel.classification, samplingMeasure: channel.kind === 'point' ? 'point' : 'area', declaredSupport: support, declaredFilter: filter,
		timeSemantics: 'state-over-interval', validity, errorRef: `${ fields.signalId }/error/${ channel.id }`
	} ] ) );
	return {
		signalId: fields.signalId, providerId: fields.providerId, schemaId: fields.schemaId, contextId: 'coastal-coupling-context', owner: fields.owner,
		consumers: fields.consumers, channels, physicsFrameId: fields.physicsFrameId, physicsOriginEpoch: 'physics-origin-17', transformRevision: fields.transformRevision,
		chartId: typedAbsence( 'not-applicable', fields.owner ), clockId: fields.clockId, samplePhase: 'committed-publication',
		representedFootprint: support, filter, validity,
		perChannelError: Object.fromEntries( fields.channels.map( ( channel ) => [ channel.id, fixtureError( channel.unit, channel.errorBound, 'fixture-signal-error' ) ] ) ),
		residency: { kind: 'gpu', deviceId: 'fixture-webgpu-device', queueId: 'default-queue', bindingIdentity: `${ fields.signalId }-binding`, sameQueueAvailability: 'after producing dispatch', hostVisibility: 'not-host-visible', mirror: { kind: 'absent', sourceStateVersion: typedAbsence( 'unavailable', fields.owner ), mirrorStateVersion: typedAbsence( 'unavailable', fields.owner ), availableAt: typedAbsence( 'unavailable', fields.owner ), age: typedAbsence( 'unavailable', fields.owner ), error: typedAbsence( 'unavailable', fields.owner ), synchronization: typedAbsence( 'unavailable', fields.owner ) }, readbackPolicy: 'diagnostic-delayed-only' },
		cadence: { kind: fields.cadenceKind, clockId: fields.clockId, intervalOrTrigger: fields.cadenceParameters, samplePhase: fields.cadenceKind === 'analytic-on-demand' ? 'analytic-at-request' : 'substep-stage', jitterBound: fixtureDurationSeconds( 0.001, 'fixture-cadence' ), maximumBurst: evidence( 4, 'execution', 'Gated', 'fixture-cadence' ), evidence: 'fixture graph/cost trace' },
		latency: { productionDelay: fixtureDurationSeconds( 0 ), consumerAvailability: 'same-queue dependency', maximumStaleness: fixtureDurationSeconds( 0.05 ), hostVisibleDelay: typedAbsence( 'unavailable', fields.owner ), clockMappingRevision: fields.sampleInterval.intervalMappingRevision, error: fixtureError( 'second', 1e-6, 'fixture-latency' ) },
		stateVersion: fields.stateVersion, resourceGeneration: { kind: 'present', generation: fields.resourceGeneration }, missingChannelPolicy: 'report-absent'
	};

}

function attachCanonicalGraph( route, fixedInterval, adaptiveInterval, eventInterval ) {

	const signalId = ( key ) => route.physicsSignals[ key ].signalId;
	const read = ( key, version, disposition = 'provisional' ) => ( { signalId: signalId( key ), requiredStateVersion: version, requiredDisposition: disposition, samplePhase: 'stage-input' } );
	const write = ( key, version, disposition, commitGroupId ) => ( { signalId: signalId( key ), producedStateVersion: version, disposition, commitGroupId } );
	const phaseByStageKind = { ingest: 'interval-start', 'sample-forcing': 'interval-start', predict: 'substep-stage', 'emit-interactions': 'substep-stage', 'solve-subcycles': 'substep-stage', 'reduce-reactions': 'substep-stage', correct: 'substep-stage', commit: 'interval-end', 'publish-presentation': 'interval-end' };
	const makeStage = ( id, kind, owner, interval, reads, writes, nativeStepRule ) => ( {
		stageId: id, stageKind: kind, owner, clockId: interval.clockId, executionInterval: interval, samplePhase: phaseByStageKind[ kind ], reads, writes,
		immutableSubstepParameters: { parameterRecordId: `${ id }-parameters`, version: 'parameters-v1' }, nativeStepRule,
		executionResidency: { kind: 'gpu', deviceId: 'fixture-webgpu-device', queueId: 'default-queue', hostReadbackPolicy: 'diagnostic-delayed-only' },
		failurePolicy: 'rollback provisional namespace and preserve prior commit'
	} );
	const stages = [
		makeStage( 'ingest-gravity', 'ingest', 'environment-owner', eventInterval, [], [ write( 'gravity', 'forcing-42/gravity-prepared', 'provisional', 'forcing-commit' ), write( 'gravity', 'gravity-42', 'committed-publication', 'forcing-commit' ) ], 'event' ),
		makeStage( 'sample-water', 'sample-forcing', '$threejs-water-optics', adaptiveInterval, [ read( 'gravity', 'gravity-42', 'committed-publication' ) ], [ write( 'waterSurface', 'loop-42/water-predict', 'provisional', 'coupled-commit' ) ], 'adaptive' ),
		makeStage( 'predict-body', 'predict', '$threejs-procedural-motion-systems', fixedInterval, [ read( 'waterSurface', 'loop-42/water-predict' ) ], [ write( 'bodyState', 'loop-42/body-predict', 'provisional', 'coupled-commit' ) ], 'fixed' ),
		makeStage( 'emit-body-water', 'emit-interactions', '$threejs-procedural-motion-systems', fixedInterval, [ read( 'waterSurface', 'loop-42/water-predict' ), read( 'bodyState', 'loop-42/body-predict' ) ], [], 'event' ),
		makeStage( 'solve-water', 'solve-subcycles', '$threejs-water-optics', adaptiveInterval, [ read( 'bodyState', 'loop-42/body-predict' ) ], [ write( 'waterSurface', 'loop-42/water-solved', 'provisional', 'coupled-commit' ) ], 'adaptive' ),
		makeStage( 'reduce-coupling', 'reduce-reactions', 'route-physics-coordinator', fixedInterval, [ read( 'waterSurface', 'loop-42/water-solved' ), read( 'bodyState', 'loop-42/body-predict' ) ], [], 'event' ),
		makeStage( 'correct-water', 'correct', '$threejs-water-optics', adaptiveInterval, [ read( 'waterSurface', 'loop-42/water-solved' ) ], [ write( 'waterSurface', 'loop-42/water-accepted', 'provisional', 'coupled-commit' ), write( 'waterSurface', 'water-42', 'committed-publication', 'coupled-commit' ) ], 'adaptive' ),
		makeStage( 'correct-body', 'correct', '$threejs-procedural-motion-systems', fixedInterval, [ read( 'bodyState', 'loop-42/body-predict' ) ], [ write( 'bodyState', 'loop-42/body-accepted', 'provisional', 'coupled-commit' ), write( 'bodyState', 'body-42', 'committed-publication', 'coupled-commit' ) ], 'fixed' ),
		makeStage( 'commit-coupled', 'commit', 'route-physics-coordinator', fixedInterval, [ read( 'waterSurface', 'water-42', 'committed-publication' ), read( 'bodyState', 'body-42', 'committed-publication' ) ], [ write( 'commitToken', 'loop-42/commit-token-prepared', 'provisional', 'coupled-commit' ), write( 'commitToken', 'commit-42', 'committed-publication', 'coupled-commit' ) ], 'event' ),
		makeStage( 'publish-presentation', 'publish-presentation', 'route-physics-coordinator', fixedInterval, [ read( 'commitToken', 'commit-42', 'committed-publication' ) ], [], 'analytic' )
	];
	const makeEdge = ( id, producerStageId, consumerStageId, key, stateVersion, disposition = 'provisional' ) => ( {
		edgeId: id, producerStageId, consumerStageId, payload: { kind: 'state-version-ref', signalId: signalId( key ) },
		requiredVersionAndPhase: { stateVersion, disposition, samplePhase: 'stage-input' }, interpolationExtrapolation: 'not-used', maximumStaleness: fixtureDurationSeconds( 0.05 ),
		latency: { productionDelay: fixtureDurationSeconds( 0 ), consumerAvailability: 'same-queue after transition', maximumStaleness: fixtureDurationSeconds( 0.05 ), hostVisibleDelay: 'unavailable' }, barrier: 'same-queue-transition', absencePolicy: 'block'
	} );
	const edges = [
		makeEdge( 'gravity-to-water', 'ingest-gravity', 'sample-water', 'gravity', 'gravity-42', 'committed-publication' ),
		makeEdge( 'water-to-body', 'sample-water', 'predict-body', 'waterSurface', 'loop-42/water-predict' ),
		makeEdge( 'water-to-emission', 'sample-water', 'emit-body-water', 'waterSurface', 'loop-42/water-predict' ),
		makeEdge( 'body-to-emission', 'predict-body', 'emit-body-water', 'bodyState', 'loop-42/body-predict' ),
		makeEdge( 'body-to-water-solve', 'predict-body', 'solve-water', 'bodyState', 'loop-42/body-predict' ),
		makeEdge( 'water-to-reduction', 'solve-water', 'reduce-coupling', 'waterSurface', 'loop-42/water-solved' ),
		makeEdge( 'body-to-reduction', 'predict-body', 'reduce-coupling', 'bodyState', 'loop-42/body-predict' ),
		makeEdge( 'water-to-correction', 'solve-water', 'correct-water', 'waterSurface', 'loop-42/water-solved' ),
		makeEdge( 'body-to-correction', 'predict-body', 'correct-body', 'bodyState', 'loop-42/body-predict' ),
		makeEdge( 'water-to-commit', 'correct-water', 'commit-coupled', 'waterSurface', 'water-42', 'committed-publication' ),
		makeEdge( 'body-to-commit', 'correct-body', 'commit-coupled', 'bodyState', 'body-42', 'committed-publication' ),
		makeEdge( 'commit-to-presentation', 'commit-coupled', 'publish-presentation', 'commitToken', 'commit-42', 'committed-publication' )
	];
	route.physicsGraph = {
		graphId: 'coastal-coupling-graph', contextId: route.physicsContext.contextId, coordinationInterval: fixedInterval, stages, edges,
		loopMacros: [ { loopId: 'body-water-loop', orderedStageIds: [ 'sample-water', 'predict-body', 'emit-body-water', 'solve-water', 'reduce-coupling' ], iterationBound: evidence( 4, 'iteration', 'Gated', 'added-mass-stability-gate' ), residuals: [ 'linear-momentum', 'angular-momentum' ], convergenceBounds: [ evidence( 0.001, 'newton-second', 'Gated', 'coupling-gate' ) ], conservationGroupIds: [ 'body-water-momentum' ], provisionalVersionNamespace: 'loop-42', seedCommittedVersions: [ { signalId: signalId( 'waterSurface' ), stateVersion: 'water-41' }, { signalId: signalId( 'bodyState' ), stateVersion: 'body-41' } ], externalReads: [ { signalId: signalId( 'gravity' ), stateVersion: 'gravity-42' } ], iterationCarriedEdges: [ { edgeId: 'water-iterate-carry', producerStageId: 'solve-water', consumerStageId: 'sample-water', signalOrExchangeId: signalId( 'waterSurface' ), producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: 'fixed coupling bracket 42-to-43', requiredProvisionalVersionPattern: 'loop-42/iteration-{i}/water', barrier: 'same-queue-transition' }, { edgeId: 'body-iterate-carry', producerStageId: 'reduce-coupling', consumerStageId: 'predict-body', signalOrExchangeId: signalId( 'bodyState' ), producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: 'fixed coupling bracket 42-to-43', requiredProvisionalVersionPattern: 'loop-42/iteration-{i}/body', barrier: 'same-queue-transition' } ], iterationVersionRule: 'iteration 0 reads seeds; iteration i+1 reads only i at identical bracket', acceptedWrites: [ { signalId: signalId( 'waterSurface' ), stateVersion: 'loop-42/water-solved' }, { signalId: signalId( 'bodyState' ), stateVersion: 'loop-42/body-predict' } ], perIterationLedger: [ 0, 1, 2 ].map( ( iterationIndex ) => ( { loopId: 'body-water-loop', iterationIndex, bracket: 'fixed coupling bracket 42-to-43', inputVersions: [ `loop-42/iteration-${ iterationIndex }/water-input`, `loop-42/iteration-${ iterationIndex }/body-input` ], outputVersions: [ `loop-42/iteration-${ iterationIndex }/water`, `loop-42/iteration-${ iterationIndex }/body` ], interactionSequenceRanges: [ `body-water-iteration-${ iterationIndex }-range` ], residualValues: [ evidence( 0.001 / ( iterationIndex + 1 ), 'newton-second', 'Measured', 'fixture-coupling' ) ], conservationResults: [ { conservationGroupId: 'body-water-momentum', status: 'within-gate' } ], accepted: iterationIndex === 2, dependencyCompletionRefs: [ `iteration-${ iterationIndex }-complete` ] } ) ), acceptedIteratePublication: 'atomic', divergenceFallback: 'rollback' } ],
		commitGroups: [
			{ commitGroupId: 'forcing-commit', owner: 'environment-owner', interval: eventInterval, provisionalVersions: [ { signalId: signalId( 'gravity' ), stateVersion: 'forcing-42/gravity-prepared' } ], committedPublications: [ { signalKey: 'gravity', signalId: signalId( 'gravity' ), stateVersion: 'gravity-42', stateEquation: 'gravity-field' } ], publicationLineage: [ { provisionalVersion: { signalId: signalId( 'gravity' ), stateVersion: 'forcing-42/gravity-prepared' }, committedVersion: { signalId: signalId( 'gravity' ), stateVersion: 'gravity-42' }, contentDigest: 'sha256:fixture-gravity-42', semanticEquivalenceProof: 'immutable-handle-promotion', ownerApproval: 'environment-owner@v1', publicationInstant: eventInterval.endExclusive } ], stateEquationOwners: { 'gravity-field': 'environment-owner' }, conservationAndErrorGates: [ 'gravity-error' ], atomicity: 'all-or-none', failureDisposition: 'preserve-prior-commit' },
			{ commitGroupId: 'coupled-commit', owner: 'route-physics-coordinator', interval: fixedInterval, provisionalVersions: [ { signalId: signalId( 'waterSurface' ), stateVersion: 'loop-42/water-predict' }, { signalId: signalId( 'waterSurface' ), stateVersion: 'loop-42/water-solved' }, { signalId: signalId( 'waterSurface' ), stateVersion: 'loop-42/water-accepted' }, { signalId: signalId( 'bodyState' ), stateVersion: 'loop-42/body-predict' }, { signalId: signalId( 'bodyState' ), stateVersion: 'loop-42/body-accepted' }, { signalId: signalId( 'commitToken' ), stateVersion: 'loop-42/commit-token-prepared' } ], committedPublications: [ { signalKey: 'waterSurface', signalId: signalId( 'waterSurface' ), stateVersion: 'water-42', stateEquation: 'water-state' }, { signalKey: 'bodyState', signalId: signalId( 'bodyState' ), stateVersion: 'body-42', stateEquation: 'body-state' }, { signalKey: 'commitToken', signalId: signalId( 'commitToken' ), stateVersion: 'commit-42', stateEquation: 'commit-token' } ], publicationLineage: [ [ 'water-surface-state', 'loop-42/water-accepted', 'water-42', '$threejs-water-optics' ], [ 'rigid-body-state', 'loop-42/body-accepted', 'body-42', '$threejs-procedural-motion-systems' ], [ 'coupled-commit-token', 'loop-42/commit-token-prepared', 'commit-42', 'route-physics-coordinator' ] ].map( ( [ signalIdValue, provisionalStateVersion, committedStateVersion, owner ] ) => ( { provisionalVersion: { signalId: signalIdValue, stateVersion: provisionalStateVersion }, committedVersion: { signalId: signalIdValue, stateVersion: committedStateVersion }, contentDigest: `sha256:fixture-${ committedStateVersion }`, semanticEquivalenceProof: 'immutable-handle-promotion', ownerApproval: `${ owner }@fixture-v1`, publicationInstant: fixedInterval.endExclusive } ) ), stateEquationOwners: { 'water-state': '$threejs-water-optics', 'body-state': '$threejs-procedural-motion-systems', 'commit-token': 'route-physics-coordinator' }, conservationAndErrorGates: [ 'body-water-momentum', 'finite-state' ], atomicity: 'all-or-none', failureDisposition: 'rollback' }
		],
		originRebaseTransactions: [],
		catchUpPolicy: { owner: 'route-physics-coordinator', maximumDebt: fixtureDurationSeconds( 0.05 ) }, discontinuityPolicy: { owner: 'route-physics-coordinator', action: 'one graph-wide discontinuity' },
		executionLedger: {
			ledgerId: 'physics-execution-42', graphId: 'coastal-coupling-graph', graphRevision: 'coastal-coupling-graph-v42', coordinationInterval: fixedInterval,
			stageExecutions: stages.map( ( stage, executionSequence ) => ( { stageId: stage.stageId, executionInterval: stage.executionInterval, executionSequence, inputVersions: stage.reads.map( ( readRef ) => readRef.requiredStateVersion ), provisionalOutputVersions: stage.writes.filter( ( writeRef ) => writeRef.disposition === 'provisional' ).map( ( writeRef ) => writeRef.producedStateVersion ), committedOutputVersions: stage.writes.filter( ( writeRef ) => writeRef.disposition === 'committed-publication' ).map( ( writeRef ) => writeRef.producedStateVersion ), status: 'completed', dependencyCompletionRefs: [ `${ stage.stageId }-same-queue-complete` ] } ) ),
			loopResults: [ { loopId: 'body-water-loop', iterations: evidence( 3, 'iteration', 'Measured', 'fixture-execution' ), residuals: 'within gate', acceptedIterate: 'loop-42' } ],
			commitResults: [ { commitGroupId: 'forcing-commit', status: 'committed', publishedVersions: [ 'gravity-42' ] }, { commitGroupId: 'coupled-commit', status: 'committed', publishedVersions: [ 'water-42', 'body-42', 'commit-42' ] } ],
			catchUpDebtBeforeAfter: { before: fixtureDurationSeconds( 0.01 ), after: fixtureDurationSeconds( 0 ) }, discontinuityEpoch: 'time-continuity-1', physicsCostLedgerId: 'mobile-cost-ledger-42'
		}
	};

}

function attachCanonicalExchange( route, interval ) {

	const footprint = { footprintId: 'hull-water-footprint-v4', kind: 'area', physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', chartId: typedAbsence( 'not-applicable', 'distributed-coupler' ), supportGeometry: 'generation-bearing hull-water patch', orientation: 'hull-to-water', measureUnit: 'square-meter', representedMeasure: evidence( 12, 'square-metre', 'Derived', 'fixture-quadrature' ), distributionKind: 'extensive-distributed', kernel: 'normalized compact area kernel v4', kernelUnit: 'inverse-square-meter', normalizationTarget: 'unity', normalizationIntegral: evidence( 1, 'ratio', 'Gated', 'fixture-quadrature' ), quadrature: 'fixed deterministic patch quadrature with physical weights/Jacobians', referencePointMeters: evidence( [ 0, 0, 0 ], 'metre', 'Authored', 'balance-origin' ), approximationError: fixtureError( 'square-metre', 1e-4, 'fixture-quadrature' ) };
	const makeRecord = ( fields ) => {

		const key = `${ canonicalIntervalIdentity( interval ) }|stage=${ fields.stage }|producer=${ fields.producer }|sequence=${ fields.sequence }|interaction=${ fields.id }`;
		return { interactionId: fields.id, exactOnceKey: key, role: fields.role, sourceOwner: fields.sourceOwner, sourceEntityId: fields.sourceEntity, sourceStateVersions: fields.sourceVersions, targetOwner: fields.targetOwner, targetEntityId: fields.targetEntity, targetStateVersionExpected: fields.targetVersion, targetStateEquation: fields.targetEquation, applicationInterval: interval, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', footprint, payload: { tag: 'momentumTransfer', timeSemantics: 'interval-integrated', linearMomentumNs: evidence( fields.linear, 'newton-second', 'Derived', 'fixture-distributed-coupling' ), angularMomentumNms: evidence( fields.angular, 'newton-metre-second', 'Derived', 'fixture-distributed-coupling' ), referencePointMeters: evidence( [ 0, 0, 0 ], 'metre', 'Authored', 'balance-origin' ) }, signConvention: 'positive-source-to-receiver', applicationLedgerKey: `apply|${ key }`, reactionGroupId: 'body-water-reaction-group', reactionToInteractionIds: fields.reactionTo, conservationGroupIds: [ 'body-water-momentum' ], validity: 'exact interval/frame/epoch/revision', error: { momentum: fixtureError( 'newton-second', 1e-6, 'fixture-exchange' ) }, provenance: { adapterRevision: 'distributed-coupler-v4', stageId: fields.stage, producerId: fields.producer, producerSequence: fields.sequence } };

	};
	const sources = [
		makeRecord( { id: 'source-bow', role: 'source', sourceOwner: '$threejs-procedural-motion-systems', sourceEntity: 'hull#g4', sourceVersions: [ 'body-42', 'hull-material-1@materials-v5' ], targetOwner: '$threejs-water-optics', targetEntity: 'water#g2', targetVersion: 'water-41', targetEquation: 'water-momentum', stage: 'emit-body-water', producer: 'body-provider', sequence: 1001, linear: [ 4, 0, 0 ], angular: [ 0, 0, 1 ], reactionTo: [] } ),
		makeRecord( { id: 'source-stern', role: 'source', sourceOwner: '$threejs-procedural-motion-systems', sourceEntity: 'hull#g4', sourceVersions: [ 'body-42', 'hull-material-1@materials-v5' ], targetOwner: '$threejs-water-optics', targetEntity: 'water#g2', targetVersion: 'water-41', targetEquation: 'water-momentum', stage: 'emit-body-water', producer: 'body-provider', sequence: 1002, linear: [ 0, 2, 0 ], angular: [ 0, 0, - 0.5 ], reactionTo: [] } )
	];
	const sourceIds = sources.map( ( record ) => record.interactionId );
	const reactions = [
		makeRecord( { id: 'reaction-a', role: 'reaction', sourceOwner: '$threejs-water-optics', sourceEntity: 'water#g2', sourceVersions: [ 'water-42', 'water-material-1@materials-v5' ], targetOwner: '$threejs-procedural-motion-systems', targetEntity: 'hull#g4', targetVersion: 'body-41', targetEquation: 'body-momentum', stage: 'reduce-coupling', producer: 'water-provider', sequence: 1003, linear: [ - 1, - 1, 0 ], angular: [ 0, 0, - 0.2 ], reactionTo: sourceIds } ),
		makeRecord( { id: 'reaction-b', role: 'reaction', sourceOwner: '$threejs-water-optics', sourceEntity: 'water#g2', sourceVersions: [ 'water-42', 'water-material-1@materials-v5' ], targetOwner: '$threejs-procedural-motion-systems', targetEntity: 'hull#g4', targetVersion: 'body-41', targetEquation: 'body-momentum', stage: 'reduce-coupling', producer: 'water-provider', sequence: 1004, linear: [ - 3, - 1, 0 ], angular: [ 0, 0, - 0.3 ], reactionTo: sourceIds } )
	];
	route.physicsInteractions = [ { exchangeId: 'body-water-exchange', contextId: route.physicsContext.contextId, applicationInterval: interval, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', mode: 'two-way-iterated', participants: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], sourceDescriptors: [ { signalId: 'water-surface-state', stateVersion: 'water-42' }, { signalId: 'rigid-body-state', stateVersion: 'body-42' } ], interactions: sources, reactions, reactionGroups: [ { reactionGroupId: 'body-water-reaction-group', contextId: route.physicsContext.contextId, exchangeId: 'body-water-exchange', applicationInterval: interval, sourceInteractionIds: sourceIds, reactionInteractionIds: reactions.map( ( record ) => record.interactionId ), acceptance: 'all-or-none', orderedReduction: 'fixed binary tree', balanceFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', balanceTransformRevision: 'physics-frame-transform-3', balanceReferencePoint: evidence( [ 0, 0, 0 ], 'metre', 'Authored', 'balance-origin' ), conservationGroupIds: [ 'body-water-momentum' ], residualsAndBounds: { linearMomentumBound: evidence( 1e-9, 'newton-second', 'Gated', 'fixture-conservation' ), angularMomentumBound: evidence( 1e-9, 'newton-metre-second', 'Gated', 'fixture-conservation' ) } } ], conservationGroups: [ { conservationGroupId: 'body-water-momentum', contextId: route.physicsContext.contextId, interval, participants: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], referencePhysicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', angularMomentumReference: { kind: 'fixed-inertial-point', pointAtStartMeters: evidence( [ 0, 0, 0 ], 'metre', 'Authored', 'balance-origin' ) }, commodities: [ 'linear-momentum', 'angular-momentum' ], explicitConstraints: [], initialInventory: 'typed-map', finalInventory: 'typed-map', externalSources: 'typed-map', boundaryFluxes: 'typed-map', modeledInternalTransfers: 'equal-and-opposite participant transfer map', modeledConversions: {}, modeledDissipation: {}, numericalResidual: 'typed-map', residualNorms: 'typed-map', acceptanceBounds: 'typed-map' } ], couplingLoopId: 'body-water-loop', stabilityGate: 'added-mass gate accepted', convergence: 'bounded loop converged', batchLedger: { batchId: 'body-water-batch', exchangeId: 'body-water-exchange', producerId: 'route-physics-coordinator', publishedSequenceRange: { firstSequence: 1001, lastSequence: 1004 }, perConsumerCursor: { water: 1005, body: 1005 }, acceptedRejectedLateDuplicate: { accepted: evidence( 4, 'record', 'Measured', 'fixture-replay' ), rejected: evidence( 0, 'record', 'Measured', 'fixture-replay' ), late: evidence( 0, 'record', 'Measured', 'fixture-replay' ), duplicate: evidence( 0, 'record', 'Measured', 'fixture-replay' ) }, overflowPolicy: 'block', overflowSequenceRanges: [], lostCommodities: {}, deferredCommodities: {}, exactOnceApplicationLedgerVersion: 'delivery-ledger-v42' } } ];

}

function attachCanonicalPresentation( route, clocks ) {

	const fixed41Half = fixtureInstant( clocks, 'physics-fixed', 41, 1, 2 );
	const fixed42Half = fixtureInstant( clocks, 'physics-fixed', 42, 1, 2 );
	const completionToken = ( tokenId, consumerKey, consumerKind, targetViewKey ) => {

		const [ presentationTargetId, viewId ] = targetViewKey ? targetViewKey.split( '/' ) : [ undefined, undefined ];
		return { tokenId, consumerKey, consumerKind, executionId: targetViewKey ? 'execution-42' : typedAbsence( 'not-applicable', consumerKey ), presentationTargetId: presentationTargetId ?? typedAbsence( 'not-applicable', consumerKey ), viewId: viewId ?? typedAbsence( 'not-applicable', consumerKey ), snapshotId: targetViewKey ? `snapshot-${ targetViewKey }` : typedAbsence( 'not-applicable', consumerKey ), queueSubmissionEpoch: targetViewKey ? 'submit-42' : typedAbsence( 'not-applicable', consumerKey ), backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', completionSemantics: targetViewKey ? 'queue completion covers all submitted target passes' : 'owner completion covers the leased immutable state read' };

	};
	const completionJoin = ( id, scope ) => {

		const targetKeys = scope === 'candidate' ? [ 'main/main-view', 'minimap/map-view' ] : [ scope ];
		const simulationConsumers = [ completionToken( `simulation-${ id }`, `simulation/${ id }`, 'simulation' ) ];
		const couplingConsumers = [ completionToken( `coupling-${ id }`, `coupling/${ id }`, 'coupling' ) ];
		const presentationConsumers = targetKeys.map( ( targetKey ) => completionToken( `presentation-${ targetKey}/${ id }`, `presentation/${ targetKey}/${ id }`, 'presentation', targetKey ) );
		const requiredConsumerKeys = [ ...simulationConsumers, ...couplingConsumers, ...presentationConsumers ].map( ( ref ) => ref.consumerKey ).sort();
		return { joinId: `join-${ id }`, leaseId: id, requiredConsumerKeys, simulationConsumers, couplingConsumers, externalConsumers: [], presentationConsumers, joinPredicate: 'all-required-consumers-complete-or-loss-invalidated', joinDigest: `sha256:join-${ id }-${ requiredConsumerKeys.join( '|' ) }`, deviceLossRetirementPath: 'invalidate only matching device/loss/resource generation' };

	};
	const makeLease = ( id, generation, owner, scope ) => ( { leaseId: id, resourceId: `${ id }-resource`, deviceId: 'fixture-webgpu-device', deviceLossGeneration: 'device-generation-1', resourceGeneration: generation, layoutRevision: `${ id }-layout-v1`, entitySlotMapVersion: `${ id }-slots-v1`, residency: 'gpu', slotRangeStrideCount: { count: evidence( 64, 'slot', 'Derived', 'fixture-layout' ), stride: evidence( 64, 'byte', 'Derived', 'fixture-layout' ) }, owner, leaseScope: scope === 'candidate' ? 'candidate' : 'view-preparation', access: 'read', submissionAvailability: 'after physics publication', leaseBegin: scope === 'candidate' ? 'candidate-sequence-42' : `preparation-${ scope }-sequence-42`, reuseProhibitedUntil: completionJoin( id, scope ) } );
	const candidateLeases = [
		makeLease( 'water-previous', 'water-presented-g1', '$threejs-water-optics', 'candidate' ), makeLease( 'water-current', 'water-presented-g2', '$threejs-water-optics', 'candidate' ),
		makeLease( 'body-previous', 'body-presented-g1', '$threejs-procedural-motion-systems', 'candidate' ), makeLease( 'body-current', 'body-presented-g2', '$threejs-procedural-motion-systems', 'candidate' )
	];
	const viewLeases = { 'main/main-view': makeLease( 'main-view', 'main-view-g1', '$threejs-camera-controls-and-rigs', 'main/main-view' ), 'minimap/map-view': makeLease( 'map-view', 'map-view-g1', '$threejs-camera-controls-and-rigs', 'minimap/map-view' ) };
	const allLeases = [ ...candidateLeases, ...Object.values( viewLeases ) ];
	const leasesById = new Map( allLeases.map( ( lease ) => [ lease.leaseId, lease ] ) );
	const handle = ( id ) => { const lease = leasesById.get( id ); return { leaseId: id, resourceGeneration: lease.resourceGeneration, deviceLossGeneration: lease.deviceLossGeneration, layoutRevision: lease.layoutRevision, subresourceOrCpuSlice: `${ id }:all` }; };
	const provenance = ( f ) => ( { sourceClockId: f.clockId, requestedPresentationInstant: f.requested, mappedSourceInstant: f.mapped, clockMapRevision: f.mapRevision, clockMapError: fixtureError( 'second', 0.001, 'presentation-clock-map' ), lowerBracket: { stateVersion: f.lowerVersion, sampleInstant: f.lower, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', resourceGeneration: `${ f.lowerVersion }-generation` }, upperBracket: { stateVersion: f.upperVersion, sampleInstant: f.upper, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', resourceGeneration: `${ f.upperVersion }-generation` }, interpolation: { policy: 'linear physical-state interpolation', alpha: evidence( f.alpha, 'ratio', 'Derived', 'independent-bracket' ), error: fixtureError( 'metre', 0.002, 'presentation-interpolation' ) }, extrapolation: typedAbsence( 'not-applicable', 'presentation-sampler' ) } );
	const makeArm = ( p, leaseId, kind, payload ) => ( { provenance: p, presentedInstant: clone( p.mappedSourceInstant ), stateHandle: handle( leaseId ), globalBinding: { kind, sourcePhysicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', bindingPayload: payload }, originEpochBridge: typedAbsence( 'not-applicable', 'presentation-sampler' ) } );
	const makePair = ( f ) => { const previousPresented = makeArm( f.previous, f.previousLease, f.kind, f.payload ); const currentPresented = makeArm( f.current, f.currentLease, f.kind, f.payload ); return { bindingId: f.bindingId, entityId: f.entityId, providerId: route.physicsSignals[ f.signalKey ].providerId, signalId: route.physicsSignals[ f.signalKey ].signalId, previousPresented, currentPresented, motionBinding: { kind: f.kind, storageRepresentation: f.storage, previousStateHandle: clone( previousPresented.stateHandle ), currentStateHandle: clone( currentPresented.stateHandle ), identitySlotMap: f.slotMap, motionVectorValidity: 'valid' } }; };
	const waterPrevious = provenance( { clockId: 'water-adaptive', requested: fixed41Half, mapped: fixtureInstant( clocks, 'water-adaptive', 98, 1, 3 ), mapRevision: 'water-presentation-map-v6', lower: fixtureInstant( clocks, 'water-adaptive', 98 ), upper: fixtureInstant( clocks, 'water-adaptive', 99 ), lowerVersion: 'water-40', upperVersion: 'water-41', alpha: 1 / 3 } );
	const waterCurrent = provenance( { clockId: 'water-adaptive', requested: fixed42Half, mapped: fixtureInstant( clocks, 'water-adaptive', 101, 1, 2 ), mapRevision: 'water-presentation-map-v7', lower: fixtureInstant( clocks, 'water-adaptive', 101 ), upper: fixtureInstant( clocks, 'water-adaptive', 102 ), lowerVersion: 'water-42a', upperVersion: 'water-42b', alpha: 0.5 } );
	const bodyPrevious = provenance( { clockId: 'physics-fixed', requested: fixed41Half, mapped: fixed41Half, mapRevision: 'fixed-map-v1', lower: fixtureInstant( clocks, 'physics-fixed', 41 ), upper: fixtureInstant( clocks, 'physics-fixed', 42 ), lowerVersion: 'body-41', upperVersion: 'body-42', alpha: 0.5 } );
	const bodyCurrent = provenance( { clockId: 'physics-fixed', requested: fixed42Half, mapped: fixed42Half, mapRevision: 'fixed-map-v1', lower: fixtureInstant( clocks, 'physics-fixed', 42 ), upper: fixtureInstant( clocks, 'physics-fixed', 43 ), lowerVersion: 'body-42', upperVersion: 'body-43', alpha: 0.5 } );
	const pairs = [
		makePair( { bindingId: 'water-binding', entityId: 'water#g2', signalKey: 'waterSurface', kind: 'field', storage: 'texture-field', previousLease: 'water-previous', currentLease: 'water-current', payload: 'water-field-layout-v3', slotMap: 'water-map-v2', previous: waterPrevious, current: waterCurrent } ),
		makePair( { bindingId: 'body-binding', entityId: 'hull#g4', signalKey: 'bodyState', kind: 'rigid', storage: 'gpu-structured-buffer', previousLease: 'body-previous', currentLease: 'body-current', payload: 'rigid-state-layout-v2', slotMap: 'body-map-v5', previous: bodyPrevious, current: bodyCurrent } )
	];
	route.physicsPresentationCandidate = { candidateId: 'physics-candidate-42', contextId: route.physicsContext.contextId, presentationEpoch: 'presentation-42', requestedPresentationInstant: fixed42Half, physicsOriginEpoch: 'physics-origin-17', candidateScope: 'committed brackets, leases, and event ranges only', presentedStatePairs: pairs, resourceLeases: candidateLeases, eventSequenceRanges: [ { rangeId: 'body-water-events-1001-1004', producerId: 'route-physics-coordinator', consumerId: 'shared-presentation-views', streamId: 'body-water-exchange', firstSequence: 1001, lastSequenceInclusive: 1004, sourceStateVersion: 'commit-42', interval: fixtureInterval( clocks, 'physics-fixed', 42, 43 ), cursorBefore: 1001, cursorAfter: 1005, payloadDigest: 'sha256:fixture-body-water-events-1001-1004' } ] };
	const matrix3 = evidence( [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], 'matrix3', 'Derived', 'render-map' );
	const matrix4 = evidence( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ], 'matrix4', 'Derived', 'camera' );
	const renderMap = ( id, epoch, instant, translation ) => ( { sourcePhysicsFrameId: 'physics-world-y-up', sourceTransformRevision: 'physics-frame-transform-3', sourcePhysicsOriginEpoch: 'physics-origin-17', destinationRenderFrameId: `render-${ id }`, renderOriginEpoch: epoch, referenceInstant: instant, properBasisRotation: matrix3, presentationScale: evidence( 1, 'ratio', 'Authored', 'presentation-scale' ), renderUnitsPerMeter: evidence( 2, 'render-unit-per-metre', 'Derived', 'presentationScale/metersPerWorldUnit' ), translationRenderUnits: evidence( translation, 'render-unit', 'Derived', 'camera-relative-origin' ), transformRevision: `render-transform-${ id }`, error: fixtureError( 'render-unit', 1e-6, 'render-map' ) } );
	const camera = ( target, view, id, translation ) => ( { cameraPublicationId: `camera-${ id}`, candidateId: 'physics-candidate-42', owner: '$threejs-camera-controls-and-rigs', presentationTargetId: target, viewId: view, cameraId: `${ id}-camera`, viewScope: `${ target } layers`, cameraStateVersion: `${ id}-state-42`, cameraProjectionRevision: `${ id}-projection-42`, previousRenderSampleInstant: fixed41Half, currentRenderSampleInstant: fixed42Half, globalToRenderPrevious: renderMap( `${ id}-previous`, `${ id}-origin-7`, fixed41Half, translation ), globalToRenderCurrent: renderMap( `${ id}-current`, `${ id}-origin-8`, fixed42Half, translation ), previousUnjitteredViewMatrix: matrix4, currentUnjitteredViewMatrix: matrix4, previousUnjitteredProjectionMatrix: matrix4, currentUnjitteredProjectionMatrix: matrix4, jitterSampleAndConvention: { sample: evidence( [ 0.25, - 0.25 ], 'physical-pixel', 'Authored', 'jitter' ), convention: 'motion uses unjittered matrices' }, viewport: { physical: evidence( [ 0, 0, 1280, 720 ], 'physical-pixel', 'Derived', 'viewport' ) }, rendererDpr: evidence( 1, 'ratio', 'Authored', 'target' ), renderExtent: evidence( [ 1280, 720 ], 'physical-pixel', 'Derived', 'viewport' ), depthConvention: 'reversed-depth', projectionValidityAndError: { validity: 'valid', error: fixtureError( 'ndc', 1e-7, 'camera' ) } } );
	route.physicsCameraViewPublicationsByTarget = { 'main/main-view': camera( 'main', 'main-view', 'main', [ - 2000, 0, 1000 ] ), 'minimap/map-view': camera( 'minimap', 'map-view', 'map', [ - 1800, 0, 900 ] ) };
	const leaseRef = ( id ) => { const lease = leasesById.get( id ); return { leaseId: id, deviceId: lease.deviceId, deviceLossGeneration: lease.deviceLossGeneration, resourceGeneration: lease.resourceGeneration, layoutRevision: lease.layoutRevision, subresourceOrCpuSlice: `${ id }:all` }; };
	const prepare = ( key, viewLease ) => {

		const c = route.physicsCameraViewPublicationsByTarget[ key ];
		const affectedRegion = key === 'main/main-view' ? {
			kind: 'screen-mask', fullFrame: typedAbsence( 'not-applicable', 'view-preparation' ), entitySet: typedAbsence( 'not-applicable', 'view-preparation' ), physicsBounds: typedAbsence( 'not-applicable', 'view-preparation' ),
			screenMask: { presentationTargetId: c.presentationTargetId, viewId: c.viewId, cameraId: c.cameraId, cameraProjectionRevision: c.cameraProjectionRevision, jitterKey: 'fixture-jitter-key', physicalExtent: evidence( [ 1280, 720 ], 'physical-pixel', 'Derived', 'fixture-viewport' ), resolutionScale: evidence( 0.5, 'ratio', 'Authored', 'fixture-reactive-mask' ), encodingFormat: 'conservative-r8unorm-mask', conservativeCoverage: 'outside', dilationAndError: { dilation: evidence( 2, 'physical-pixel', 'Gated', 'temporal-neighborhood' ), error: fixtureError( 'physical-pixel', 0.5, 'mask-conservatism' ) }, resourceLeaseId: viewLease }
		} : { kind: 'full-frame', fullFrame: { reason: 'map-view consumer lacks conservative mask support' }, entitySet: typedAbsence( 'not-applicable', 'view-preparation' ), physicsBounds: typedAbsence( 'not-applicable', 'view-preparation' ), screenMask: typedAbsence( 'not-applicable', 'view-preparation' ) };
		const actionId = `reset-water-history-${ key}`;
		return {
			viewPreparationId: `preparation-${ key}`, candidateId: 'physics-candidate-42', cameraPublicationId: c.cameraPublicationId, presentationTargetId: c.presentationTargetId, viewId: c.viewId,
			visibilityPublicationRefs: [ `visibility-${ key}` ], accelerationPublicationRefs: [ `acceleration-${ key}` ],
			shadowViewPublicationRefs: [ { shadowOwner: '$threejs-scalable-real-time-shadows', shadowViewId: `shadow-${ key}`, presentationTargetId: c.presentationTargetId, receiverViewId: c.viewId, cameraPublicationId: c.cameraPublicationId, cameraProjectionRevision: c.cameraProjectionRevision, shadowContentEpoch: `shadow-${ key}-42`, resourceLeaseRefs: [ leaseRef( viewLease ) ], boundedDelay: typedAbsence( 'not-applicable', '$threejs-scalable-real-time-shadows' ) } ],
			cachePublicationRefs: [ `cache-${ key}` ], reactiveEpochs: [ `water-${ key}-42` ],
			reactivePublications: [ { sourceId: 'water-surface-state', sourceVersion: 'water-42', reactiveEpoch: `water-${ key}-42`, kind: 'optical', presentationTargetId: c.presentationTargetId, viewId: c.viewId, affectedRegion: clone( affectedRegion ), resourceLeaseId: viewLease, validity: 'valid for sealed preparation', error: fixtureError( 'ratio', 0.01, 'reactive-publication' ), plannedConsumerActions: [ actionId ] } ],
			resetDependencies: [ { actionId, owner: '$threejs-image-pipeline', historyKey: `${ key}/water-history/r185`, presentationTargetId: c.presentationTargetId, viewId: c.viewId, causeEpochs: [ `water-${ key}-42` ], affectedRegion: clone( affectedRegion ), policy: 'reset', capabilityGate: 'mask-capable-or-full-frame-promoted', dependencies: [], executionStrategy: 'history-clear-before-temporal-consumer', resourceLeaseId: viewLease } ],
			resourceLeases: [ viewLeases[ key ] ], resourceLeaseRefs: [ leaseRef( 'water-current' ), leaseRef( 'body-current' ), leaseRef( viewLease ) ]
		};

	};
	route.physicsViewPreparationPublicationsByTarget = { 'main/main-view': prepare( 'main/main-view', 'main-view' ), 'minimap/map-view': prepare( 'minimap/map-view', 'map-view' ) };
	const seal = ( key, viewLease ) => {

		const c = route.physicsCameraViewPublicationsByTarget[ key ];
		const p = route.physicsViewPreparationPublicationsByTarget[ key ];
		const pairStateHandleLeaseIds = [ 'water-previous', 'water-current', 'body-previous', 'body-current' ];
		const exactRequiredLeaseIds = [ ...pairStateHandleLeaseIds, viewLease ].sort();
		const exactEventRangeIds = route.physicsPresentationCandidate.eventSequenceRanges.map( ( range ) => range.rangeId ).sort();
		const snapshotId = `snapshot-${ key }`;
		return { snapshotId, candidateId: 'physics-candidate-42', cameraPublicationId: c.cameraPublicationId, viewPreparationId: p.viewPreparationId, presentationTargetId: c.presentationTargetId, viewId: c.viewId, presentedStatePairRefs: [ 'water-binding', 'body-binding' ], resourceLeaseRefs: exactRequiredLeaseIds.map( leaseRef ), eventSequenceRanges: clone( route.physicsPresentationCandidate.eventSequenceRanges ), closureManifest: { snapshotId, pairStateHandleLeaseIds, preparationDependencyLeaseIds: [ viewLease ], reactiveAndResetLeaseIds: [ viewLease ], shadowCacheVisibilityLeaseIds: [ viewLease ], exactRequiredLeaseIds, exactEventRangeIds, dependencyDagDigest: `sha256:fixture-dependency-dag-${ key }`, closureDigest: `sha256:fixture-closure-${ key }-${ exactRequiredLeaseIds.join( '|' ) }-${ exactEventRangeIds.join( '|' ) }` }, sealVersion: `seal-${ key }-42` };

	};
	route.physicsPresentationSnapshotsByTarget = { 'main/main-view': seal( 'main/main-view', 'main-view' ), 'minimap/map-view': seal( 'minimap/map-view', 'map-view' ) };
	const mainId = route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId;
	const mapId = route.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ].snapshotId;
	const targetExecution = ( key, id, viewLease ) => {

		const [ presentationTargetId, viewId ] = key.split( '/' );
		const consumedLeaseIds = [ 'water-previous', 'water-current', 'body-previous', 'body-current', viewLease ];
		const completionTokens = consumedLeaseIds.map( ( leaseId ) => leasesById.get( leaseId ).reuseProhibitedUntil.presentationConsumers.find( ( ref ) => ref.presentationTargetId === presentationTargetId && ref.viewId === viewId ) );
		return { snapshotId: id, presentationTargetId, viewId, status: 'completed', submittedPasses: [ 'scene', 'motion', 'present' ], queueSubmissionEpochs: [ 'submit-42' ], actionResults: [], completionTokens, presentedTimestamp: clone( fixed42Half ), failure: typedAbsence( 'not-applicable', '$threejs-image-pipeline' ) };

	};
	route.frameExecutionRecord = { executionId: 'execution-42', candidateId: 'physics-candidate-42', requiredTargetViewKeys: [ 'main/main-view', 'minimap/map-view' ], snapshotIds: [ mainId, mapId ], overallStatus: 'completed', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', targetExecutions: { 'main/main-view': targetExecution( 'main/main-view', mainId, 'main-view' ), 'minimap/map-view': targetExecution( 'minimap/map-view', mapId, 'map-view' ) }, leaseDispositionById: Object.fromEntries( allLeases.map( ( lease ) => [ lease.leaseId, { disposition: 'retained-until-join', consumingSnapshotIds: lease.leaseId === 'main-view' ? [ mainId ] : lease.leaseId === 'map-view' ? [ mapId ] : [ mainId, mapId ], completionJoin: clone( lease.reuseProhibitedUntil ), retirementEvidence: { joinId: lease.reuseProhibitedUntil.joinId, joinDigest: lease.reuseProhibitedUntil.joinDigest, status: 'all required consumers completed' } } ] ) ) };

}

function attachCanonicalCostLedger( route ) {

	const stages = route.physicsGraph.stages;
	const perStage = ( value, unit ) => Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, { count: evidence( value( stage ), unit, 'Measured', 'mobile-sustained-trace' ) } ] ) );
	const measurementInterval = fixtureInterval( route.physicsContext.physicsClockRegistry, 'physics-fixed', 0, 18000 );
	const exactIntervals = 18000;
	const exactFrames = 9000;
	route.physicsCostLedger = {
		ledgerId: 'mobile-cost-ledger-42', contextId: route.physicsContext.contextId, graphId: route.physicsGraph.graphId, graphRevision: route.physicsGraph.executionLedger.graphRevision,
		measurementInterval, measurementClockId: 'physics-fixed', qualityEpoch: 'quality-epoch-3', presentationTargetsAndViews: [ 'main/main-view', 'minimap/map-view' ], measurementProtocolRefs: [ 'sha256:fixture-mobile-sustained-protocol', 'sha256:fixture-mobile-sustained-trace' ], status: 'active',
		targetAndHarness: 'low-end mobile tile-GPU Chromium WebGPU, two views, 300 second sustained run', qualityState: 'mobile-quality-v3',
		graphStageCosts: stages.map( ( stage ) => ( { stageId: stage.stageId, cpuP95: evidence( 0.08, 'millisecond', 'Measured', 'mobile-sustained-trace' ), gpuP95: evidence( 0.12, 'millisecond', 'Measured', 'mobile-sustained-trace' ), sampleCount: evidence( 18000, 'sample', 'Measured', 'mobile-sustained-trace' ) } ) ),
		coordinationIntervalsPerSecond: { p50: evidence( 60, 'interval-per-second', 'Measured', 'mobile-sustained-trace' ) },
		stageExecutionsPerCoordinationInterval: perStage( ( stage ) => stage.nativeStepRule === 'adaptive' ? 3 : 1, 'execution-per-interval' ),
		stageExecutionsPerSecond: perStage( ( stage ) => stage.nativeStepRule === 'adaptive' ? 180 : 60, 'execution-per-second' ),
		coordinationIntervalsPerPresentedFrame: { p95: evidence( 2, 'interval-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		subcyclesAndCouplingIterationsPerPresentedFrame: { water: evidence( 3, 'subcycle-per-frame', 'Measured', 'mobile-sustained-trace' ), coupling: evidence( 3, 'iteration-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		executionsPerPresentedFrame: perStage( ( stage ) => stage.nativeStepRule === 'adaptive' ? 6 : 2, 'execution-per-frame' ),
		traceTotals: { coordinationIntervals: evidence( exactIntervals, 'interval', 'Measured', 'mobile-sustained-trace' ), presentedFrames: evidence( exactFrames, 'frame', 'Measured', 'mobile-sustained-trace' ), stageExecutions: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, evidence( ( stage.nativeStepRule === 'adaptive' ? 3 : 1 ) * exactIntervals, 'execution', 'Measured', 'mobile-sustained-trace' ) ] ) ) },
		worstPermittedCatchUpBurst: { triggerAndIntervalDebt: { debt: fixtureDurationSeconds( 0.05 ) }, executionsDispatchesAndTraffic: { executions: evidence( 30, 'execution', 'Derived', 'catch-up-policy' ), bytes: evidence( 8388608, 'byte', 'Derived', 'resource-ledger' ) }, latencyMemoryAndErrorGate: { latency: evidence( 12, 'millisecond', 'Gated', 'mobile-gate' ), memory: evidence( 100663296, 'byte', 'Gated', 'mobile-gate' ), error: evidence( 0.01, 'metre', 'Gated', 'mobile-gate' ) } },
		hotBytesReadWrittenPerExecution: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, { read: evidence( 262144, 'byte', 'Derived', 'resource-layout' ), written: evidence( 131072, 'byte', 'Derived', 'resource-layout' ) } ] ) ),
		solverDispatches: [ { owner: '$threejs-water-optics', cadence: evidence( 180, 'dispatch-per-second', 'Measured', 'mobile-sustained-trace' ) } ],
		queueSubmissionsAndPassBreaks: { submissions: evidence( 1, 'submission-per-frame', 'Measured', 'mobile-sustained-trace' ), breaks: evidence( 2, 'break-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		dependencyCriticalPaths: [ { path: 'water-solve-to-atomic-commit', p95: evidence( 2.4, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ],
		tileGpuTraffic: { attachmentStoreLoadResolveBytes: { p95: evidence( 12582912, 'byte-per-frame', 'Measured', 'tile-counters' ) }, tileSpillEvidence: 'no spill observed', renderComputePassBreaks: { p95: evidence( 2, 'break-per-frame', 'Measured', 'mobile-sustained-trace' ) } },
		bindingAndDeviceLimits: [ { limit: 'storage-bindings', demand: evidence( 6, 'binding', 'Derived', 'layouts' ), deviceLimit: evidence( 8, 'binding', 'Measured', 'adapter-limits' ), requiredHeadroom: evidence( 1, 'binding', 'Gated', 'mobile-gate' ) } ],
		cpuWork: [ { task: 'graph-schedule', p95: evidence( 0.5, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ], allocationGcAndCompilation: [ { category: 'steady-runtime', allocations: evidence( 0, 'allocation-per-frame', 'Measured', 'mobile-sustained-trace' ) } ],
		uploadsCopiesMaps: [ { producer: 'descriptor-table', consumers: [ 'gpu-stages' ], logicalBytes: evidence( 4096, 'byte-per-interval', 'Derived', 'descriptor-layout' ), readbackMapBehavior: 'none' } ],
		hostCompletionsReadbacksPerPresentedFrame: evidence( 0, 'readback-per-frame', 'Measured', 'mobile-sustained-trace' ), synchronization: [ { kind: 'same-queue', p95: evidence( 0, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ],
		hotState: { logicalBytes: evidence( 50331648, 'byte', 'Derived', 'resource-ledger' ), physicalBytesMeasured: evidence( 54525952, 'byte', 'Measured', 'adapter-memory' ), includedResources: [ 'solver versions', 'contacts', 'events', 'descriptor tables', 'stable IDs', 'previous/current presentation', 'two views', 'two frames in flight' ] },
		peakTransient: { logicalBytes: evidence( 75497472, 'byte', 'Derived', 'resource-ledger' ), physicalBytesMeasured: evidence( 83886080, 'byte', 'Measured', 'adapter-memory' ), includedResources: [ 'hot state', 'catch-up transients' ] },
		migrationOverlap: { logicalBytes: evidence( 94371840, 'byte', 'Derived', 'old-plus-new' ), physicalBytesMeasured: evidence( 100663296, 'byte', 'Measured', 'transition-trace' ), includedResources: [ 'old quality state', 'new quality state', 'leases' ] },
		multiviewAndFramesInFlightMultipliers: { viewCount: evidence( 2, 'view', 'Measured', 'fixture-route' ), framesInFlight: evidence( 2, 'frame', 'Measured', 'backend-trace' ), resourceMultiplier: evidence( 1.4, 'ratio', 'Derived', 'resource-ledger' ), workMultiplier: evidence( 1.25, 'ratio', 'Measured', 'mobile-sustained-trace' ) }, thermalPowerState: { state: 'sustained nominal', duration: evidence( 300, 'second', 'Measured', 'mobile-sustained-trace' ) }
	};

}

function makeCanonicalCoupledPhysicsFixture() {

	const route = makePositiveFixture( {
		domain: 'other', intent: 'present', truthContract: 'physically-plausible', representation: 'hybrid', interaction: 'direct-manipulation', temporal: 'simulation',
		scale: 'city-terrain', sourceOfTruth: 'versioned-water-and-rigid-body-state', objectIds: true,
		primaryObservable: 'distributed water-body momentum closes across one atomic commit', earliestMissingLayer: 'motion',
		selectedAlgorithm: 'multi-rate bounded coupling with typed many-to-many reactions', noPostBaseline: 'coupled displacement and body response remain visible',
		selectedSkills: [ '$threejs-water-optics', '$threejs-procedural-motion-systems', '$threejs-camera-controls-and-rigs', '$threejs-image-pipeline', '$threejs-visual-validation' ],
		primaryOwner: '$threejs-water-optics', coverageStatus: 'complete'
	} );
	const clocks = makeCanonicalClocks();
	const identity3 = [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
	route.owners.timebase = 'route-physics-coordinator';
	route.physicsContext = {
		contextId: 'coastal-coupling-context', schemaId: physicsAbiSchema.$id, contextVersion: 'context-17',
		metersPerWorldUnit: evidence( 0.5, 'metre-per-world-unit', 'Gated', 'fixture-context' ),
		quantitySystem: { systemId: 'canonical-SI-physics-v1', registryRevision: 'SI-dimensions-v1', length: 'metre', mass: 'kilogram', time: 'second', thermodynamicTemperature: 'kelvin', angle: 'radian', amountOfSubstance: 'mole', electricCurrent: 'ampere', luminousIntensity: 'candela', derivedQuantityRegistry: 'physics-derived-dimensions-v1' },
		worldFrameId: 'threejs-world-y-up', physicsRootFrameId: 'physics-world-y-up',
		worldToPhysicsTransform: {
			transformRevision: 'world-physics-transform-3', referenceInstant: fixtureInstant( clocks, 'physics-fixed', 42 ), physicsOriginEpoch: 'physics-origin-17',
			scaleSource: 'metersPerWorldUnit', properBasisRotation: evidence( identity3, 'matrix3', 'Derived', 'fixture-world-physics-adapter' ),
			translationMeters: evidence( [ 1000, 0, - 500 ], 'metre', 'Authored', 'fixture-world-physics-adapter' ),
			originCoordinateRateMps: evidence( [ 0, 0, 0 ], 'metre-per-second', 'Authored', 'stationary-world-adapter' ),
			angularRateOfWorldRelativeToPhysicsRadPerS: evidence( [ 0, 0, 0 ], 'radian-per-second', 'Authored', 'stationary-world-adapter' ),
			originCoordinateAccelerationMps2: typedAbsence( 'unavailable', 'fixture-world-physics-adapter' ), angularAccelerationRadPerS2: typedAbsence( 'unavailable', 'fixture-world-physics-adapter' ),
			validityInterval: fixtureInterval( clocks, 'physics-fixed', 40, 45 ), error: fixtureError( 'metre', 1e-9, 'fixture-world-physics-adapter' )
		},
		worldTransformRevision: 'world-physics-transform-3',
		physicsFrameRegistry: {
			root: fixtureFrame( clocks, { frameId: 'physics-world-y-up', parentFrameId: 'root', owner: 'route-physics-coordinator', transformRevision: 'physics-frame-transform-3', rotation: identity3, translation: [ 0, 0, 0 ], linearRate: [ 0, 0, 0 ], angularRate: [ 0, 0, 0 ], source: 'fixture-root-frame' } ),
			body: fixtureFrame( clocks, { frameId: 'body-frame-1', parentFrameId: 'physics-world-y-up', owner: '$threejs-procedural-motion-systems', transformRevision: 'body-frame-transform-8', rotation: identity3, translation: [ 2, 0.5, - 1 ], linearRate: [ 1, 0, 0 ], angularRate: [ 0, 0.3, 0 ], source: 'fixture-body-frame' } )
		},
		chartRegistry: {}, physicsClockRegistry: clocks,
		gravityProvider: { signalId: 'gravity-acceleration', descriptorTableId: 'gravity-descriptor-1', stateVersion: 'gravity-42' },
		physicsOriginEpoch: 'physics-origin-17',
		idNamespaces: { entity: 'entity-id-v1 with generation', provider: 'provider-id-v1', signal: 'signal-id-v1', collider: 'collider-id-v1 with generation', shape: 'shape-id-v1 with generation', support: 'support-id-v1', feature: 'feature-id-v1', contactManifold: 'manifold-id-v1 with generation', physicsMaterial: 'physics-material-id-v1', interaction: 'interaction-id-v1', conservationGroup: 'conservation-id-v1' },
		physicsMaterialRegistry: {
			registryId: 'physics-material-registry-1', owner: 'physics-material-owner', registryVersion: 'materials-v5',
			materials: {
				'water-material-1': { densityKgPerM3: evidence( 1025, 'kilogram-per-cubic-metre', 'Measured', 'fixture-seawater' ), contactLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), frictionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), restitutionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), complianceDampingLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), adhesionCohesionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), permeabilityPorosityLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), wettingContactAngleLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), dragRoughnessLaw: 'water-drag-law-v2', thermalConductivityWPerMK: typedAbsence( 'unsupported', 'physics-material-owner' ), specificHeatJPerKgK: typedAbsence( 'unsupported', 'physics-material-owner' ), emissivitySpectrum: typedAbsence( 'unsupported', 'physics-material-owner' ), phaseChangeLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), uncertainty: 'density-and-drag-error-map', provenance: 'fixture-water-material' },
				'hull-material-1': { densityKgPerM3: evidence( 600, 'kilogram-per-cubic-metre', 'Measured', 'fixture-hull' ), contactLaw: 'hull-contact-v3', frictionLaw: 'hull-friction-v2', restitutionLaw: 'hull-restitution-v1', complianceDampingLaw: 'hull-compliance-v1', adhesionCohesionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), permeabilityPorosityLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), wettingContactAngleLaw: 'hull-wetting-v1', dragRoughnessLaw: 'hull-drag-v4', thermalConductivityWPerMK: typedAbsence( 'unsupported', 'physics-material-owner' ), specificHeatJPerKgK: typedAbsence( 'unsupported', 'physics-material-owner' ), emissivitySpectrum: typedAbsence( 'unsupported', 'physics-material-owner' ), phaseChangeLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), uncertainty: 'hull-property-error-map', provenance: 'fixture-hull-material' }
			},
			materialStateDescriptors: [],
			pairLawResolver: { resolverIdAndVersion: 'ordered-pair-resolver-v4', participantOrdering: 'ordered-A-B-with-contact-frame', explicitPairOverrides: { 'water-material-1|hull-material-1': 'water-hull-coupling-v2' }, perLawCompositionRules: 'no implicit scalar averaging', missingPairPolicy: 'block' },
			renderBindings: typedAbsence( 'not-requested', 'physics-material-owner' )
		}
	};
	const fixedInterval = fixtureInterval( clocks, 'physics-fixed', 42, 43 );
	const adaptiveInterval = fixtureInterval( clocks, 'water-adaptive', 100, 103 );
	const eventInterval = fixtureInterval( clocks, 'contact-event', 7, 8 );
	route.physicsSignals = {
		gravity: fixturePhysicsSignal( { signalId: 'gravity-acceleration', providerId: 'environment-provider', schemaId: 'physics/gravity/v1', owner: 'environment-owner', consumers: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], channels: [ { id: 'acceleration', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second-squared', basisBehavior: 'physical polar vector', classification: 'intensive', errorBound: 1e-6 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'contact-event', cadenceKind: 'event-driven', cadenceParameters: { eventStream: 'gravity-change-events' }, sampleInterval: eventInterval, stateVersion: 'gravity-42', resourceGeneration: 'gravity-generation-4' } ),
		waterSurface: fixturePhysicsSignal( { signalId: 'water-surface-state', providerId: 'water-provider', schemaId: 'physics/water-surface/v1', owner: '$threejs-water-optics', consumers: [ '$threejs-procedural-motion-systems', 'route-physics-coordinator' ], channels: [ { id: 'freeSurfacePoint', valueType: 'Vec3', kind: 'point', unit: 'metre', basisBehavior: 'point in physics frame', classification: 'intensive', errorBound: 0.002 }, { id: 'materialCurrentVelocityMps', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'physical polar vector', classification: 'intensive', errorBound: 0.01 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'water-adaptive', cadenceKind: 'adaptive', cadenceParameters: { errorController: 'CFL-and-truncation-v3' }, sampleInterval: adaptiveInterval, stateVersion: 'water-42', resourceGeneration: 'water-generation-42' } ),
		bodyState: fixturePhysicsSignal( { signalId: 'rigid-body-state', providerId: 'body-provider', schemaId: 'physics/rigid-body/v1', owner: '$threejs-procedural-motion-systems', consumers: [ '$threejs-water-optics', 'route-physics-coordinator' ], channels: [ { id: 'centerOfMassPositionMeters', valueType: 'Vec3', kind: 'point', unit: 'metre', basisBehavior: 'point in physics frame', classification: 'intensive', errorBound: 0.001 }, { id: 'linearVelocityMps', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'physical polar vector', classification: 'intensive', errorBound: 0.005 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'physics-fixed', cadenceKind: 'fixed', cadenceParameters: { interval: fixtureDurationSeconds( 1 / 60 ) }, sampleInterval: fixedInterval, stateVersion: 'body-42', resourceGeneration: 'body-generation-42' } ),
		commitToken: fixturePhysicsSignal( { signalId: 'coupled-commit-token', providerId: 'route-physics-coordinator', schemaId: 'physics/commit-token/v1', owner: 'route-physics-coordinator', consumers: [ '$threejs-camera-controls-and-rigs', '$threejs-image-pipeline' ], channels: [ { id: 'commitEpoch', valueType: 'opaque-version', kind: 'scalar', unit: 'dimensionless', basisBehavior: 'frame invariant scalar', classification: 'intensive', errorBound: 0 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'physics-fixed', cadenceKind: 'event-driven', cadenceParameters: { eventStream: 'atomic-commit-events' }, sampleInterval: fixedInterval, stateVersion: 'commit-42', resourceGeneration: 'commit-token-generation-42' } )
	};
	attachCanonicalGraph( route, fixedInterval, adaptiveInterval, eventInterval );
	attachCanonicalExchange( route, fixedInterval );
	attachCanonicalPresentation( route, clocks );
	attachCanonicalCostLedger( route );
	route.physicsPresentationSnapshot = 'not used (deprecated compatibility projection)';
	return route;

}

const skill = await readText( 'SKILL.md' );
const recipes = await readText( 'references/router-recipes.md' );
const template = await readText( 'examples/router-preflight-template.md' );
physicsAbiSchema = JSON.parse( await readText( 'references/physics-domain-and-interaction-contract.schema.json' ) );
assert.equal( physicsAbiSchema.$id, 'threejs-physics-domain-and-interaction-abi/v1', 'unexpected physics ABI schema revision' );
const webgpuBackendSource = await readFile(
	join( repoRoot, 'node_modules/three/src/renderers/webgpu/WebGPUBackend.js' ),
	'utf8'
);

assert.equal( REVISION, '185', 'router contract test requires installed Three.js r185' );
const batchedMeshBackendBlock = webgpuBackendSource.match(
	/if \( object\.isBatchedMesh === true \) \{([\s\S]*?)\n\t\t\} else if \( hasIndex === true \) \{/
);
assert.ok( batchedMeshBackendBlock, 'installed WebGPUBackend BatchedMesh branch not found' );
assert.match( batchedMeshBackendBlock[ 1 ], /object\._multiDrawCount/, 'BatchedMesh branch does not read _multiDrawCount' );
assert.match( batchedMeshBackendBlock[ 1 ], /for \( let i = 0; i < drawCount; i \+\+ \)/, 'BatchedMesh branch does not loop draw entries' );
assert.match( batchedMeshBackendBlock[ 1 ], /passEncoderGPU\.drawIndexed|passEncoderGPU\.draw\(/, 'BatchedMesh branch does not submit per-entry draws' );
assert.match( batchedMeshBackendBlock[ 1 ], /info\.update\( object, counts\[ i \], 1 \)/, 'BatchedMesh branch does not update renderer info per entry' );

const recipeNames = [
	'stylized coastal archipelago',
	'ocean planet',
	'rainy city street',
	'forest flythrough',
	'external rigid-body water coupling',
	'black-hole shot',
	'product scene',
	'post-heavy dashboard',
	'scientific field inspection',
	'AEC BIM coordination',
	'digital twin operations',
	'cinematic procedural sculpture'
];

for ( const recipeName of recipeNames ) assertRecipeManifest( recipes, recipeName );

assert.match( skill, /BatchedMesh[^\n]*measured backend draw entries|BatchedMesh[\s\S]*_multiDrawCount/, 'SKILL missing r185 BatchedMesh draw-accounting gate' );
assert.match( skill, /fallback[^\n]*quarantined/i, 'SKILL missing fallback quarantine' );
assertNoAdditivePercentileText( skill, 'SKILL' );

const templateSections = [
	'input brief',
	'preflight',
	'routeManifest',
	'performance contract',
	'route blockers',
	'acceptance evidence'
];
for ( const heading of templateSections ) extractSection( template, heading );

const templatePreflightYaml = extractYamlBlock( extractSection( template, 'preflight' ), 'template preflight' );
const templateRouteYaml = extractYamlBlock( extractSection( template, 'routeManifest' ), 'template routeManifest' );
const templatePerformanceYaml = extractYamlBlock( extractSection( template, 'performance contract' ), 'template performance contract' );
const templateAcceptanceYaml = extractYamlBlock( extractSection( template, 'acceptance evidence' ), 'template acceptance evidence' );

assertKeys( topLevelKeys( templatePreflightYaml ), [ 'backendManifest', 'workloadProfile', 'causeLedger' ], 'template preflight' );
assertKeys(
	topLevelKeys( templateRouteYaml ),
	[
		'selectedSkills', 'omittedSkills', 'primaryOwner', 'deferredSkills', 'owners',
		'requiredSignals', 'domainSignals', 'physicsContext', 'physicsGraph',
		'physicsCostLedger', 'physicsSignals', 'physicsInteractions',
		'physicsPresentationCandidate', 'physicsCameraViewPublicationsByTarget',
		'physicsViewPreparationPublicationsByTarget',
		'physicsPresentationSnapshotsByTarget', 'frameExecutionRecord',
		'physicsPresentationSnapshot',
		'outputOwnersByPresentationTarget', 'sharedResourceOwners', 'spaceAndOwnerHandoff'
	],
	'template routeManifest'
);
assert.deepEqual( [ ...directChildren( templateRouteYaml, 'owners' ).keys() ], routeOwnerKeys, 'template owner schema drift' );
assert.deepEqual( [ ...directChildren( templateRouteYaml, 'requiredSignals' ).keys() ], signalRegistryKeys, 'template signal schema drift' );
assert.deepEqual( [ ...directChildren( templateRouteYaml, 'sharedResourceOwners' ).keys() ], sharedResourceOwnerKeys, 'template shared owner schema drift' );
assert.equal( directChildren( templateRouteYaml, 'sharedResourceOwners' ).get( 'gbuffer' ), 'not used', 'template must not allocate a G-buffer automatically' );
assertPhysicsFieldsInYaml( templateRouteYaml, 'template routeManifest' );

assertKeys( topLevelKeys( templatePerformanceYaml ), [ 'performanceContract', 'coverageStatus' ], 'template performance contract' );
const templatePerformanceFields = directChildren( templatePerformanceYaml, 'performanceContract' );
assertKeys(
	new Set( templatePerformanceFields.keys() ),
	[ 'aggregationPolicy', 'drawAccounting', 'mrtDecision', 'passKeys', 'costRecords', 'passLedger', 'qualityLadder', 'qualityController', 'routeStatus' ],
	'template performanceContract'
);
assertInlineNumericEvidence( templatePerformanceFields.get( 'frameInterval' ), 'template frameInterval' );
for ( const field of [ 'clockId', 'cadence', 'substepMultiplicity', 'executionsPerPresentedFrame', 'hotBytesPerExecution', 'sourceReactionOrConservationGroups' ] ) assert.match( templatePerformanceYaml, new RegExp( `\\n      ${ field }:` ), `template pass records omit ${ field }` );
assert.match( mappingBlock( templatePerformanceYaml, 'qualityController', 2 ).lines.join( '\n' ), /\n?    qualityLadder:/, 'template qualityController must use qualityLadder' );
assertStructuredAcceptanceInYaml( templateAcceptanceYaml, 'template' );

for ( const pattern of [
	/backendManifest:/,
	/workloadProfile:/,
	/causeLedger:/,
	/owners:/,
	/requiredSignals:/,
	/physicsContext:/,
	/physicsGraph:/,
	/physicsCostLedger:/,
	/physicsSignals:/,
	/physicsInteractions:/,
	/physicsPresentationCandidate:/,
	/physicsCameraViewPublicationsByTarget:/,
	/physicsViewPreparationPublicationsByTarget:/,
	/physicsPresentationSnapshotsByTarget:/,
	/frameExecutionRecord:/,
	/physicsPresentationSnapshot:/,
	/outputOwnersByPresentationTarget:/,
	/sharedResourceOwners:/,
	/spaceAndOwnerHandoff:/,
	/performanceContract:/,
	/aggregationPolicy:/,
	/drawAccounting:/,
	/backend-multidraw-entries-measured/,
	/mrtDecision:/,
	/costRecords:/,
	/passLedger:/,
	/qualityController:/,
	/coverageStatus:/,
	/acceptanceEvidence:/,
	/validationEvidence:/,
	/fallbackTeaching:/,
	/value:.*unit:.*label:.*source:/
] ) assert.match( template, pattern, `template missing ${ pattern }` );

assert.doesNotMatch( template, /^physicalCause:/m, 'template retains legacy physicalCause' );
assert.doesNotMatch( template, /^budgetTable:/m, 'template retains additive budgetTable' );
assert.doesNotMatch( template, /^ownershipMap:/m, 'template retains legacy ownershipMap' );
assertNoAdditivePercentileText( template, 'template' );

const positiveSpecs = [
	{
		domain: 'scientific-visualization', intent: 'explain', truthContract: 'metric',
		representation: 'hybrid', interaction: 'direct-manipulation', temporal: 'static',
		scale: 'object', sourceOfTruth: 'trusted-sampled-field', objectIds: true,
		primaryObservable: 'reference-consistent isosurface and probes', earliestMissingLayer: 'geometry',
		selectedAlgorithm: 'dataset-preserving isosurface and glyphs', noPostBaseline: 'truth layers remain readable',
		selectedSkills: [ '$threejs-procedural-geometry', '$threejs-visual-validation' ],
		primaryOwner: '$threejs-procedural-geometry', coverageStatus: 'partial'
	},
	{
		domain: 'product-configurator', intent: 'configure', truthContract: 'identity',
		representation: 'imported-hierarchy', interaction: 'direct-manipulation', temporal: 'sparse-events',
		scale: 'object', sourceOfTruth: 'product-asset-and-variant-table', objectIds: true,
		primaryObservable: 'stable part and material variant identity', earliestMissingLayer: 'material',
		selectedAlgorithm: 'retained hierarchy with material-state updates', noPostBaseline: 'product identity remains readable',
		selectedSkills: [ '$threejs-procedural-materials', '$threejs-image-pipeline', '$threejs-visual-validation' ],
		primaryOwner: '$threejs-procedural-materials', coverageStatus: 'partial'
	},
	{
		domain: 'architecture-aec', intent: 'coordinate', truthContract: 'metric',
		representation: 'imported-hierarchy', interaction: 'free-navigation', temporal: 'static',
		scale: 'building', sourceOfTruth: 'bim-hierarchy-and-units', objectIds: true,
		primaryObservable: 'correct section measurement and semantic selection', earliestMissingLayer: 'geometry',
		selectedAlgorithm: 'semantic chunking with source-preserving transforms', noPostBaseline: 'sections remain measurable',
		selectedSkills: [ '$threejs-camera-controls-and-rigs', '$threejs-visual-validation' ],
		primaryOwner: 'project-bim-layer-outside-pack', coverageStatus: 'partial'
	},
	{
		domain: 'digital-twin', intent: 'monitor', truthContract: 'metric',
		representation: 'hybrid', interaction: 'free-navigation', temporal: 'streamed-deltas',
		scale: 'building', sourceOfTruth: 'versioned-assets-and-telemetry', objectIds: true,
		primaryObservable: 'entity state matches stable ID and timestamp', earliestMissingLayer: 'field',
		selectedAlgorithm: 'retained representation with bounded dirty updates', noPostBaseline: 'state age and alarms remain readable',
		selectedSkills: [ '$threejs-procedural-fields', '$threejs-image-pipeline', '$threejs-visual-validation' ],
		primaryOwner: '$threejs-procedural-fields', coverageStatus: 'partial'
	},
	{
		domain: 'data-scene', intent: 'monitor', truthContract: 'metric',
		representation: 'points-glyphs', interaction: 'direct-manipulation', temporal: 'streamed-deltas',
		scale: 'multiscale', sourceOfTruth: 'versioned-operational-dataset', objectIds: true,
		primaryObservable: 'faithful value and identity mapping', earliestMissingLayer: 'geometry',
		selectedAlgorithm: 'stable-ID instanced glyphs', noPostBaseline: 'mapping and selection remain readable',
		selectedSkills: [ '$threejs-procedural-geometry', '$threejs-image-pipeline', '$threejs-visual-validation' ],
		primaryOwner: '$threejs-procedural-geometry', coverageStatus: 'partial'
	}
];
const positiveFixtures = positiveSpecs.map( makePositiveFixture );
for ( const fixture of positiveFixtures ) validateRouteManifest( fixture );
const coupledPhysicsFixture = makeCanonicalCoupledPhysicsFixture();
validateRouteManifest( coupledPhysicsFixture );

const crossOriginPresentationFixture = clone( coupledPhysicsFixture );
const priorOriginEpoch = 'physics-origin-16';
	crossOriginPresentationFixture.physicsGraph.originRebaseTransactions.push( {
		transactionId: 'origin-rebase-16-to-17', contextId: crossOriginPresentationFixture.physicsContext.contextId,
		commitInstant: clone( crossOriginPresentationFixture.physicsGraph.coordinationInterval.start ),
		fromContextVersion: 'context-16', toContextVersion: crossOriginPresentationFixture.physicsContext.contextVersion,
		fromPhysicsOriginEpoch: priorOriginEpoch, toPhysicsOriginEpoch: crossOriginPresentationFixture.physicsContext.physicsOriginEpoch,
		fromWorldTransformRevision: 'world-physics-transform-2', toWorldTransformRevision: crossOriginPresentationFixture.physicsContext.worldTransformRevision,
		fromFrameRegistryRevision: 'physics-frames-16', toFrameRegistryRevision: 'physics-frames-17',
		fromChartRegistryRevision: 'physics-charts-16', toChartRegistryRevision: 'physics-charts-17',
		fromToTransform: { transformRevision: 'origin-rebase-transform-16-17', properBasisRotation: evidence( [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], 'matrix3', 'Derived', 'rebase-transaction' ), translationMeters: evidence( [ 1024, 0, 0 ], 'metre', 'Derived', 'rebase-transaction' ), error: fixtureError( 'metre', 1e-9, 'rebase-round-trip' ) },
	affectedOwnersAndCommittedVersions: {}, transformedStateKinds: [ 'point', 'coordinate-rate', 'physical-vector', 'axial-vector', 'tensor', 'collider', 'contact', 'cache' ],
	interactionAndEventQueueAction: 'drain-before-boundary', provisionalStateRequirement: 'none-live', conservationRoundTripAndErrorGates: [ 'round-trip', 'finite', 'conservation' ], presentationResetPlan: [], atomicPublication: 'all-or-none', rollback: 'preserve-from-epoch'
} );
for ( const pair of crossOriginPresentationFixture.physicsPresentationCandidate.presentedStatePairs ) {

	const arm = pair.previousPresented;
	arm.globalBinding.physicsOriginEpoch = priorOriginEpoch;
	arm.provenance.lowerBracket.physicsOriginEpoch = priorOriginEpoch;
	arm.provenance.upperBracket.physicsOriginEpoch = priorOriginEpoch;
	arm.originEpochBridge = { transactionId: 'origin-rebase-16-to-17', fromPhysicsOriginEpoch: priorOriginEpoch, toPhysicsOriginEpoch: 'physics-origin-17', fromToTransformRevision: 'origin-rebase-transform-16-17', transformedStateVersion: arm.provenance.upperBracket.stateVersion, roundTripAndErrorGates: [ 'round-trip', 'finite', 'conservation' ] };
	crossOriginPresentationFixture.physicsGraph.originRebaseTransactions[ 0 ].affectedOwnersAndCommittedVersions[ pair.providerId ] = [ arm.provenance.upperBracket.stateVersion ];

}
for ( const camera of Object.values( crossOriginPresentationFixture.physicsCameraViewPublicationsByTarget ) ) camera.globalToRenderPrevious.sourcePhysicsOriginEpoch = priorOriginEpoch;
validateRouteManifest( crossOriginPresentationFixture );

let negativeCaseCount = 0;
function expectReject( name, mutate, pattern ) {

	const fixture = clone( positiveFixtures[ 0 ] );
	mutate( fixture );
	assert.throws( () => validateRouteManifest( fixture ), pattern, name );
	negativeCaseCount ++;

}

function expectPhysicsReject( name, mutate, pattern ) {

	const fixture = clone( coupledPhysicsFixture );
	mutate( fixture );
	assert.throws( () => validateRouteManifest( fixture ), pattern, name );
	negativeCaseCount ++;

}

expectReject( 'missing workload profile', ( route ) => delete route.workloadProfile, /workloadProfile/ );
expectReject( 'missing cause ledger', ( route ) => delete route.causeLedger, /causeLedger/ );
expectReject( 'missing owner records', ( route ) => delete route.owners, /owners/ );
expectReject( 'flat acceptance evidence', ( route ) => { route.acceptanceEvidence = [ 'capture' ]; }, /acceptanceEvidence.*mapping/ );
expectReject( 'unconsumed signal', ( route ) => { route.requiredSignals.sceneColorRegistry.main.consumers = []; }, /unconsumed/ );
expectReject( 'duplicate pass key', ( route ) => { route.performanceContract.passLedger.push( clone( route.performanceContract.passLedger[ 0 ] ) ); }, /duplicate keys/ );
expectReject( 'duplicate compact work key', ( route ) => { route.performanceContract.passKeys.push( route.performanceContract.passKeys[ 0 ] ); }, /duplicate keys/ );
expectReject( 'duplicate work-ledger key', ( route ) => { route.performanceContract.workLedger.push( clone( route.performanceContract.workLedger[ 0 ] ) ); }, /duplicate keys/ );
expectReject( 'malformed numeric evidence', ( route ) => { delete route.performanceContract.cpuP95Budget.source; }, /malformed numeric evidence/ );
expectReject( 'bare numeric evidence', ( route ) => { route.performanceContract.subsystemBudget = 4; }, /bare numeric value/ );
expectReject( 'automatic unconsumed depth signal', ( route ) => { route.sharedResourceOwners.depth = '$threejs-image-pipeline'; }, /depth owner has no consumed depthRegistry/ );
expectReject( 'automatic G-buffer', ( route ) => { route.sharedResourceOwners.gbuffer = '$threejs-image-pipeline'; }, /G-buffer allocation requires an accepted MRT decision/ );
expectReject( 'additive subsystem percentile logic', ( route ) => {

	delete route.performanceContract.aggregationPolicy;
	route.performanceContract.aggregationPolicy = { basis: 'sum-subsystem-p95' };
	route.performanceContract.selectedSkillMaxima = [];

}, /additive subsystem accounting|adds subsystem percentiles/ );
expectReject( 'BatchedMesh single-draw assumption', ( route ) => {

	route.performanceContract.drawAccounting.batchedMeshModel = 'one-draw-per-batchedmesh-material-family';

}, /BatchedMesh cannot be budgeted as one GPU draw/ );

const abortedExecutionFixture = clone( coupledPhysicsFixture );
const abortedMapSnapshotId = abortedExecutionFixture.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ].snapshotId;
delete abortedExecutionFixture.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ];
abortedExecutionFixture.frameExecutionRecord.overallStatus = 'partial-failure';
abortedExecutionFixture.frameExecutionRecord.snapshotIds = [ abortedExecutionFixture.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId ];
abortedExecutionFixture.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ] = { snapshotId: typedAbsence( 'aborted-before-seal', 'frame-execution-owner' ), presentationTargetId: 'minimap', viewId: 'map-view', status: 'aborted', submittedPasses: [], queueSubmissionEpochs: [], actionResults: [], completionTokens: [], presentedTimestamp: typedAbsence( 'not-presented', 'frame-execution-owner' ), failure: { code: 'validation-abort', cause: 'fixture pre-seal abort' } };
for ( const disposition of Object.values( abortedExecutionFixture.frameExecutionRecord.leaseDispositionById ) ) disposition.consumingSnapshotIds = disposition.consumingSnapshotIds.filter( ( id ) => id !== abortedMapSnapshotId );
abortedExecutionFixture.frameExecutionRecord.leaseDispositionById[ 'map-view' ].disposition = 'retired-after-abort';
abortedExecutionFixture.frameExecutionRecord.leaseDispositionById[ 'map-view' ].completionJoin.presentationConsumers = [];
validateRouteManifest( abortedExecutionFixture );

const deviceLossExecutionFixture = clone( coupledPhysicsFixture );
deviceLossExecutionFixture.frameExecutionRecord.overallStatus = 'device-lost';
for ( const target of Object.values( deviceLossExecutionFixture.frameExecutionRecord.targetExecutions ) ) {

	target.status = 'device-lost';
	target.completionTokens = [];

}
const deviceLossFullLeases = [ ...deviceLossExecutionFixture.physicsPresentationCandidate.resourceLeases, ...Object.values( deviceLossExecutionFixture.physicsViewPreparationPublicationsByTarget ).flatMap( ( preparation ) => preparation.resourceLeases ) ];
const deviceLossLeaseById = new Map( deviceLossFullLeases.map( ( lease ) => [ lease.leaseId, lease ] ) );
for ( const [ leaseId, disposition ] of Object.entries( deviceLossExecutionFixture.frameExecutionRecord.leaseDispositionById ) ) {

	disposition.disposition = 'invalidated-by-device-loss';
	disposition.completionJoin.presentationConsumers = [];
	const lease = deviceLossLeaseById.get( leaseId );
	disposition.retirementEvidence = { lostDeviceLossGeneration: lease.deviceLossGeneration, lostResourceGeneration: lease.resourceGeneration };

}
validateRouteManifest( deviceLossExecutionFixture );

const recoveredAfterDeviceLossFixture = clone( coupledPhysicsFixture );
const recoveredCandidateId = 'physics-candidate-43-rebuilt';
recoveredAfterDeviceLossFixture.physicsPresentationCandidate.candidateId = recoveredCandidateId;
recoveredAfterDeviceLossFixture.physicsPresentationCandidate.presentationEpoch = 'presentation-43';
const recoveredFullLeases = [ ...recoveredAfterDeviceLossFixture.physicsPresentationCandidate.resourceLeases, ...Object.values( recoveredAfterDeviceLossFixture.physicsViewPreparationPublicationsByTarget ).flatMap( ( preparation ) => preparation.resourceLeases ) ];
const recoveredLeaseById = new Map();
for ( const lease of recoveredFullLeases ) {

	lease.deviceLossGeneration = 'device-generation-2';
	lease.resourceGeneration = `${ lease.resourceGeneration }-recovered`;
	lease.resourceId = `${ lease.resourceId }-recovered`;
	lease.leaseBegin = 'recovery-candidate-sequence-43';
	recoveredLeaseById.set( lease.leaseId, lease );

}
const refreshHandle = ( handle ) => {

	const lease = recoveredLeaseById.get( handle.leaseId );
	handle.deviceLossGeneration = lease.deviceLossGeneration;
	handle.resourceGeneration = lease.resourceGeneration;

};
const refreshRef = ( ref ) => {

	const lease = recoveredLeaseById.get( ref.leaseId );
	ref.deviceLossGeneration = lease.deviceLossGeneration;
	ref.resourceGeneration = lease.resourceGeneration;

};
for ( const pair of recoveredAfterDeviceLossFixture.physicsPresentationCandidate.presentedStatePairs ) {

	refreshHandle( pair.previousPresented.stateHandle );
	refreshHandle( pair.currentPresented.stateHandle );
	refreshHandle( pair.motionBinding.previousStateHandle );
	refreshHandle( pair.motionBinding.currentStateHandle );

}
const recoveredSnapshotIdByOldId = new Map();
for ( const [ key, camera ] of Object.entries( recoveredAfterDeviceLossFixture.physicsCameraViewPublicationsByTarget ) ) {

	camera.candidateId = recoveredCandidateId;
	camera.cameraPublicationId = `${ camera.cameraPublicationId }-recovered`;
	const preparation = recoveredAfterDeviceLossFixture.physicsViewPreparationPublicationsByTarget[ key ];
	preparation.candidateId = recoveredCandidateId;
	preparation.cameraPublicationId = camera.cameraPublicationId;
	preparation.viewPreparationId = `${ preparation.viewPreparationId }-recovered`;
	for ( const ref of preparation.resourceLeaseRefs ) refreshRef( ref );
	for ( const shadowRef of preparation.shadowViewPublicationRefs ) {

		shadowRef.cameraPublicationId = camera.cameraPublicationId;
		for ( const ref of shadowRef.resourceLeaseRefs ) refreshRef( ref );

	}
	const snapshot = recoveredAfterDeviceLossFixture.physicsPresentationSnapshotsByTarget[ key ];
	const oldSnapshotId = snapshot.snapshotId;
	snapshot.snapshotId = `${ oldSnapshotId }-recovered`;
	recoveredSnapshotIdByOldId.set( oldSnapshotId, snapshot.snapshotId );
	snapshot.candidateId = recoveredCandidateId;
	snapshot.cameraPublicationId = camera.cameraPublicationId;
	snapshot.viewPreparationId = preparation.viewPreparationId;
	for ( const ref of snapshot.resourceLeaseRefs ) refreshRef( ref );

}
const recoveredExecution = recoveredAfterDeviceLossFixture.frameExecutionRecord;
recoveredExecution.executionId = 'execution-43-rebuilt';
recoveredExecution.candidateId = recoveredCandidateId;
recoveredExecution.backendGeneration = 'backend-generation-2';
recoveredExecution.deviceLossGeneration = 'device-generation-2';
recoveredExecution.snapshotIds = recoveredExecution.snapshotIds.map( ( id ) => recoveredSnapshotIdByOldId.get( id ) );
for ( const target of Object.values( recoveredExecution.targetExecutions ) ) target.snapshotId = recoveredSnapshotIdByOldId.get( target.snapshotId );
for ( const disposition of Object.values( recoveredExecution.leaseDispositionById ) ) disposition.consumingSnapshotIds = disposition.consumingSnapshotIds.map( ( id ) => recoveredSnapshotIdByOldId.get( id ) );
validateRouteManifest( recoveredAfterDeviceLossFixture );
assert.notEqual( recoveredAfterDeviceLossFixture.physicsPresentationCandidate.candidateId, coupledPhysicsFixture.physicsPresentationCandidate.candidateId, 'device-loss recovery must rebuild the Candidate chain' );
assert.notEqual( recoveredExecution.backendGeneration, coupledPhysicsFixture.frameExecutionRecord.backendGeneration, 'device-loss recovery must use a replacement backend generation' );
assert.ok( recoveredFullLeases.every( ( lease ) => lease.deviceLossGeneration === 'device-generation-2' && lease.resourceGeneration.endsWith( '-recovered' ) ), 'device-loss recovery must rebuild every leased resource generation' );

expectPhysicsReject( 'physics schema required context key', ( route ) => {

	delete route.physicsContext.physicsRootFrameId;

}, /physicsContext missing physicsRootFrameId/ );
expectPhysicsReject( 'physics context exposes authoring temperature units', ( route ) => {

	route.physicsContext.quantitySystem.thermodynamicTemperature = 'celsius';

}, /canonical SI physics base units/ );
expectPhysicsReject( 'noncanonical rational range', ( route ) => {

	route.physicsGraph.coordinationInterval.start.rationalSubstep = { numerator: 2, denominator: 2 };

}, /outside canonical range/ );
expectPhysicsReject( 'unreduced rational', ( route ) => {

	route.physicsGraph.coordinationInterval.start.rationalSubstep = { numerator: 2, denominator: 4 };

}, /not reduced/ );
expectPhysicsReject( 'derived time disagrees with mapping', ( route ) => {

	route.physicsGraph.coordinationInterval.start.timeSecondsDerived.value += 0.2;

}, /disagrees with its versioned clock mapping/ );
expectPhysicsReject( 'nonuniform clock activates two mapping arms', ( route ) => {

	route.physicsContext.physicsClockRegistry.nonuniform.mapping.fixedRational = { epochSeconds: evidence( 0, 'second', 'Authored', 'mutation' ), secondsPerTick: evidence( 1, 'second-per-tick', 'Authored', 'mutation' ) };

}, /exactly its timestampTable mapping arm/ );
expectPhysicsReject( 'nonuniform clock deletes its active mapping arm', ( route ) => {

	delete route.physicsContext.physicsClockRegistry.nonuniform.mapping.timestampTable;

}, /exactly its timestampTable mapping arm/ );
expectPhysicsReject( 'timestamp clock changes normative interpolation', ( route ) => {

	route.physicsContext.physicsClockRegistry.nonuniform.mapping.timestampTable.interpolationRule = 'cubic-spline';

}, /interpolation rule drift/ );
expectPhysicsReject( 'external clock permits unlogged evaluation', ( route ) => {

	route.physicsContext.physicsClockRegistry.event.mapping.external.unloggedQueryPolicy = 'best-effort';

}, /must reject unlogged evaluations/ );
expectPhysicsReject( 'external clock content-addressed table has wrong digest', ( route ) => {

	route.physicsContext.physicsClockRegistry.event.mapping.external.frozenEvaluationTable.knotTable.resourceRef.contentDigest = 'sha256:missing';

}, /cannot resolve content digest/ );
expectPhysicsReject( 'adaptive signal uses unregistered clock', ( route ) => {

	route.physicsSignals.waterSurface.clockId = 'missing-adaptive-clock';

}, /unregistered clock/ );
expectPhysicsReject( 'frame shear is not a rotation', ( route ) => {

	route.physicsContext.physicsFrameRegistry.root.parentFromFrameRotation.value[ 1 ] = 0.25;

}, /not orthogonal|not orthonormal/ );
expectPhysicsReject( 'gravity provider version mismatch', ( route ) => {

	route.physicsContext.gravityProvider.stateVersion = 'gravity-stale';

}, /gravityProvider version mismatch/ );
expectPhysicsReject( 'render PBR state leaks into physics material registry', ( route ) => {

	route.physicsContext.physicsMaterialRegistry.materials[ 'hull-material-1' ].roughness = 0.2;

}, /physics materials cannot be inferred/ );
expectPhysicsReject( 'provisional version escapes descriptor', ( route ) => {

	route.physicsSignals.waterSurface.stateVersion = 'loop-42/water-predict';

}, /leaks provisional state/ );
expectPhysicsReject( 'commit group is not atomic', ( route ) => {

	route.physicsGraph.commitGroups[ 1 ].atomicity = 'partial';

}, /must commit atomically/ );
expectPhysicsReject( 'committed publication missing from group', ( route ) => {

	route.physicsGraph.commitGroups[ 1 ].committedPublications = route.physicsGraph.commitGroups[ 1 ].committedPublications.filter( ( publication ) => publication.signalKey !== 'waterSurface' );

}, /one lineage row per committed publication|committed write .* absent from its atomic commit group/ );
expectPhysicsReject( 'committed write points at another existing commit group', ( route ) => {

	const write = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-water' ).writes.find( ( candidate ) => candidate.producedStateVersion === 'water-42' );
	write.commitGroupId = 'forcing-commit';

}, /assigned to another commit group/ );
expectPhysicsReject( 'duplicate graph writer', ( route ) => {

	const stage = route.physicsGraph.stages.find( ( entry ) => entry.stageId === 'correct-body' );
	stage.writes.push( { signalId: 'rigid-body-state', producedStateVersion: 'body-42', disposition: 'committed-publication', commitGroupId: 'coupled-commit' } );

}, /duplicate writers/ );
expectPhysicsReject( 'graph read has no edge', ( route ) => {

	route.physicsGraph.edges = route.physicsGraph.edges.filter( ( edge ) => edge.edgeId !== 'body-to-water-solve' );

}, /has no exact edge/ );
expectPhysicsReject( 'graph edge version mismatch', ( route ) => {

	route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'water-to-body' ).requiredVersionAndPhase.stateVersion = 'water-wrong';

}, /no matching producer write/ );
expectPhysicsReject( 'graph stage clock mismatch', ( route ) => {

	route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'predict-body' ).clockId = 'water-adaptive';

}, /execution clock mismatch/ );
expectPhysicsReject( 'stage interval outside coordination interval', ( route ) => {

	const stage = route.physicsGraph.stages.find( ( entry ) => entry.stageId === 'predict-body' );
	stage.executionInterval.start.tick = 41;
	stage.executionInterval.start.timeSecondsDerived.value = 41 / 60;

}, /outside its coordination\/exchange interval/ );
expectPhysicsReject( 'GPU edge lacks ordering barrier', ( route ) => {

	route.physicsGraph.edges[ 0 ].barrier = 'none';

}, /lacks a GPU ordering barrier/ );
expectPhysicsReject( 'outer graph cycle', ( route ) => {

	const correctWater = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-water' );
	const correctBody = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-body' );
	correctWater.reads.push( { signalId: 'rigid-body-state', requiredStateVersion: 'loop-42/body-accepted', requiredDisposition: 'provisional', samplePhase: 'stage-input' } );
	correctBody.reads.push( { signalId: 'water-surface-state', requiredStateVersion: 'loop-42/water-accepted', requiredDisposition: 'provisional', samplePhase: 'stage-input' } );
	const bodyToWater = clone( route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'body-to-correction' ) );
	bodyToWater.edgeId = 'correct-body-to-correct-water'; bodyToWater.producerStageId = 'correct-body'; bodyToWater.consumerStageId = 'correct-water'; bodyToWater.requiredVersionAndPhase.stateVersion = 'loop-42/body-accepted';
	const waterToBody = clone( route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'water-to-correction' ) );
	waterToBody.edgeId = 'correct-water-to-correct-body'; waterToBody.producerStageId = 'correct-water'; waterToBody.consumerStageId = 'correct-body'; waterToBody.requiredVersionAndPhase.stateVersion = 'loop-42/water-accepted';
	route.physicsGraph.edges.push( bodyToWater, waterToBody );

}, /contains a cycle/ );
expectPhysicsReject( 'loop publication is non-atomic', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].acceptedIteratePublication = 'streaming';

}, /accepted iterate atomically/ );
expectPhysicsReject( 'loop accepted write escapes namespace', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].acceptedWrites[ 0 ].stateVersion = 'water-42';

}, /loop-scoped provisional versions/ );
expectPhysicsReject( 'distributed transfer uses point footprint', ( route ) => {

	route.physicsInteractions[ 0 ].interactions[ 0 ].footprint.kind = 'point';

}, /requires an area footprint/ );
expectPhysicsReject( 'many-to-many reaction group collapses to one source', ( route ) => {

	route.physicsInteractions[ 0 ].reactionGroups[ 0 ].sourceInteractionIds.pop();

}, /exercise a many-to-many relation/ );
expectPhysicsReject( 'reaction group acceptance is not atomic', ( route ) => {

	route.physicsInteractions[ 0 ].reactionGroups[ 0 ].acceptance = 'partial';

}, /must accept atomically/ );
expectPhysicsReject( 'distributed momentum does not close', ( route ) => {

	route.physicsInteractions[ 0 ].reactions[ 0 ].payload.linearMomentumNs.value[ 0 ] += 1;

}, /linear momentum does not close/ );
expectPhysicsReject( 'interaction interval leaves exchange interval', ( route ) => {

	const record = route.physicsInteractions[ 0 ].interactions[ 0 ];
	record.applicationInterval.start.tick = 41; record.applicationInterval.start.timeSecondsDerived.value = 41 / 60;

}, /outside its coordination\/exchange interval/ );
expectPhysicsReject( 'interaction frame mismatch', ( route ) => {

	route.physicsInteractions[ 0 ].interactions[ 0 ].physicsFrameId = 'body-frame-1';

}, /physicsFrameId mismatch/ );
expectPhysicsReject( 'interaction epoch mismatch', ( route ) => {

	route.physicsInteractions[ 0 ].interactions[ 0 ].physicsOriginEpoch = 'physics-origin-stale';

}, /physicsOriginEpoch mismatch/ );
expectPhysicsReject( 'interaction transform revision mismatch', ( route ) => {

	route.physicsInteractions[ 0 ].interactions[ 0 ].transformRevision = 'stale-transform';

}, /transformRevision mismatch/ );
expectPhysicsReject( 'delivery key omits exact time identity', ( route ) => {

	route.physicsInteractions[ 0 ].interactions[ 0 ].exactOnceKey = 'short-key';

}, /exactOnceKey does not bind exact interval/ );
expectPhysicsReject( 'candidate contains camera state', ( route ) => {

	route.physicsPresentationCandidate.cameraId = 'illegal-camera';

}, /not view-independent/ );
expectPhysicsReject( 'previous state loses independent provenance', ( route ) => {

	delete route.physicsPresentationCandidate.presentedStatePairs[ 0 ].previousPresented.provenance;

}, /missing provenance/ );
expectPhysicsReject( 'presentation alpha disagrees with bracket', ( route ) => {

	route.physicsPresentationCandidate.presentedStatePairs[ 0 ].currentPresented.provenance.interpolation.alpha.value = 0.1;

}, /interpolation alpha disagrees/ );
expectPhysicsReject( 'cross-origin presented arm lacks accepted bridge', ( route ) => {

	const arm = route.physicsPresentationCandidate.presentedStatePairs[ 0 ].previousPresented;
	arm.globalBinding.physicsOriginEpoch = 'physics-origin-16';
	arm.provenance.lowerBracket.physicsOriginEpoch = 'physics-origin-16';
	arm.provenance.upperBracket.physicsOriginEpoch = 'physics-origin-16';

}, /originEpochBridge.*missing transactionId|originEpochBridge must be a mapping/ );
expectPhysicsReject( 'render transform source revision is stale', ( route ) => {

	route.physicsCameraViewPublicationsByTarget[ 'main/main-view' ].globalToRenderCurrent.sourceTransformRevision = 'stale';

}, /source frame\/revision is unregistered/ );
expectPhysicsReject( 'render transform reference instant drifts from camera sample', ( route ) => {

	route.physicsCameraViewPublicationsByTarget[ 'main/main-view' ].globalToRenderPrevious.referenceInstant = clone( route.physicsCameraViewPublicationsByTarget[ 'main/main-view' ].currentRenderSampleInstant );

}, /does not bind the camera sample instant/ );
expectPhysicsReject( 'render units per metre violates exact transform', ( route ) => {

	route.physicsCameraViewPublicationsByTarget[ 'main/main-view' ].globalToRenderCurrent.renderUnitsPerMeter.value = 1;

}, /violates the exact mapping formula/ );
expectPhysicsReject( 'view preparation references wrong camera publication', ( route ) => {

	route.physicsViewPreparationPublicationsByTarget[ 'main/main-view' ].cameraPublicationId = 'wrong-camera';

}, /cameraPublicationId mismatch/ );
expectPhysicsReject( 'camera registry duplicates a publication ID', ( route ) => {

	route.physicsCameraViewPublicationsByTarget[ 'minimap/map-view' ].cameraPublicationId = route.physicsCameraViewPublicationsByTarget[ 'main/main-view' ].cameraPublicationId;

}, /duplicates cameraPublicationId/ );
expectPhysicsReject( 'camera target omits view preparation', ( route ) => {

	delete route.physicsViewPreparationPublicationsByTarget[ 'minimap/map-view' ];

}, /exactly one keyed view-preparation publication|no camera\/preparation publication chain/ );
expectPhysicsReject( 'view preparation imports sibling full lease', ( route ) => {

	route.physicsViewPreparationPublicationsByTarget[ 'main/main-view' ].resourceLeases.push( clone( route.physicsViewPreparationPublicationsByTarget[ 'minimap/map-view' ].resourceLeases[ 0 ] ) );

}, /duplicates or imports another publication's full lease/ );
expectPhysicsReject( 'shadow publication ref drifts from its camera', ( route ) => {

	route.physicsViewPreparationPublicationsByTarget[ 'main/main-view' ].shadowViewPublicationRefs[ 0 ].cameraProjectionRevision = 'stale-projection';

}, /camera\/target scope mismatch/ );
expectPhysicsReject( 'reactive affected region activates two union arms', ( route ) => {

	route.physicsViewPreparationPublicationsByTarget[ 'main/main-view' ].reactivePublications[ 0 ].affectedRegion.fullFrame = { reason: 'illegal second arm' };

}, /fullFrame must use typed absence/ );
expectPhysicsReject( 'sealed snapshot copies state pairs', ( route ) => {

	route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].presentedStatePairs = [];

}, /copies mutable presentedStatePairs/ );
expectPhysicsReject( 'snapshot references unknown lease', ( route ) => {

	route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].resourceLeaseRefs[ 0 ].leaseId = 'missing-lease';

}, /references unknown lease/ );
expectPhysicsReject( 'target execution swaps multiview snapshots', ( route ) => {

	route.frameExecutionRecord.targetExecutions[ 'main/main-view' ].snapshotId = route.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ].snapshotId;
	route.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ].snapshotId = route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId;

}, /swaps another target\/view snapshot/ );
expectPhysicsReject( 'target execution uses overall-only partial-failure status', ( route ) => {

	route.frameExecutionRecord.targetExecutions[ 'main/main-view' ].status = 'partial-failure';

}, /not a canonical targetExecutionStatuses/ );
expectPhysicsReject( 'frame execution omits lease disposition', ( route ) => {

	delete route.frameExecutionRecord.leaseDispositionById[ 'water-current' ];

}, /disposition every candidate lease/ );
expectPhysicsReject( 'frame execution omits a camera target', ( route ) => {

	delete route.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ];

}, /exactly one target execution per camera target\/view/ );
expectPhysicsReject( 'shared lease completion join omits one snapshot', ( route ) => {

	route.frameExecutionRecord.leaseDispositionById[ 'water-current' ].consumingSnapshotIds.pop();

}, /completion join omits or invents a snapshot consumer/ );
expectPhysicsReject( 'aborted target fabricates completion token', ( route ) => {

	const abortedSnapshotId = route.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ].snapshotId;
	delete route.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ];
	route.frameExecutionRecord.overallStatus = 'partial-failure';
	route.frameExecutionRecord.snapshotIds = [ route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId ];
	route.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ] = { snapshotId: typedAbsence( 'aborted-before-seal', 'frame-execution-owner' ), presentationTargetId: 'minimap', viewId: 'map-view', status: 'aborted', submittedPasses: [], queueSubmissionEpochs: [], actionResults: [], completionTokens: [ 'fake-complete' ], presentedTimestamp: typedAbsence( 'not-presented', 'frame-execution-owner' ), failure: { code: 'validation-abort', cause: 'fixture pre-seal abort' } };
	for ( const disposition of Object.values( route.frameExecutionRecord.leaseDispositionById ) ) disposition.consumingSnapshotIds = disposition.consumingSnapshotIds.filter( ( id ) => id !== abortedSnapshotId );
	route.frameExecutionRecord.leaseDispositionById[ 'map-view' ].disposition = 'retired-after-abort';
	route.frameExecutionRecord.leaseDispositionById[ 'map-view' ].completionJoin.presentationConsumers = [];

}, /cannot fabricate completion tokens/ );
expectPhysicsReject( 'device loss keeps normal lease retirement', ( route ) => {

	route.frameExecutionRecord.overallStatus = 'device-lost';

}, /must invalidate on device loss/ );
expectPhysicsReject( 'cost ledger omits per-second execution evidence', ( route ) => {

	delete route.physicsCostLedger.stageExecutionsPerSecond;

}, /physicsCostLedger missing stageExecutionsPerSecond/ );
expectPhysicsReject( 'cost ledger accepts zero stage cadence', ( route ) => {

	route.physicsCostLedger.stageExecutionsPerSecond[ 'predict-body' ].count.value = 0;

}, /cadence must be positive/ );
expectPhysicsReject( 'cost ledger accepts inconsistent stage cadence', ( route ) => {

	route.physicsCostLedger.stageExecutionsPerSecond[ 'predict-body' ].count.value = 61;

}, /per-second cadence is inconsistent/ );
expectPhysicsReject( 'cost ledger allows frame-critical readback', ( route ) => {

	route.physicsCostLedger.hostCompletionsReadbacksPerPresentedFrame.value = 1;

}, /frame-critical host readback/ );
expectPhysicsReject( 'cost ledger misses stage hot bytes', ( route ) => {

	delete route.physicsCostLedger.hotBytesReadWrittenPerExecution[ 'solve-water' ];

}, /lacks hot-byte traffic/ );
expectPhysicsReject( 'cost ledger exceeds device binding limit', ( route ) => {

	route.physicsCostLedger.bindingAndDeviceLimits[ 0 ].demand.value = 8;

}, /exceeds the device limit/ );
expectPhysicsReject( 'cost ledger is not mobile-targeted', ( route ) => {

	route.physicsCostLedger.targetAndHarness = 'desktop workstation';

}, /mobile\/low-end harness/ );
expectPhysicsReject( 'cost ledger is not sustained', ( route ) => {

	route.physicsCostLedger.graphStageCosts[ 0 ].sampleCount.value = 20;

}, /not a sustained sample/ );

console.log( JSON.stringify( {
	pass: true,
	recipeCount: recipeNames.length,
	positiveFixtureDomains: positiveSpecs.map( ( spec ) => spec.domain ),
	coupledPhysicsFixture: true,
	negativeCaseCount,
	templateSections: templateSections.length
}, null, 2 ) );
