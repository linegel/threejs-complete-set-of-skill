import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVISION } from 'three/webgpu';
import { buildContactIdentityBundle, contactIdentityRejectMutations, validateContactIdentityBundle } from './router-contract-contact-identity-fixtures.mjs';
import { buildExternalGpuFixtureBundle, externalGpuRejectMutations, validateExternalGpuFixtureBundle, validateExternalSolverAdapterFixture } from './router-contract-external-gpu-fixtures.mjs';
import { buildPhysicalImpactPartitionBundle, physicalImpactPartitionRejectMutations, validatePhysicalImpactPartitionBundle } from './router-contract-partition-fixtures.mjs';
import { buildProviderWaterBundle, providerWaterRejectMutations, validateProviderWaterBundle } from './router-contract-provider-water-fixtures.mjs';
import { buildQualityTransitionBundle, qualityTransitionRejectMutations, validateQualityTransitionBundle } from './router-contract-quality-fixtures.mjs';
import { runSemanticInvariantRegistry } from './router-contract-semantic-invariant-registry.mjs';

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

function extractYamlBlocks( markdown, label ) {

	const openingCount = [ ...markdown.matchAll( /```yaml(?:\r?\n|$)/g ) ].length;
	const blocks = [ ...markdown.matchAll( /```yaml\n([\s\S]*?)```/g ) ].map( ( match ) => match[ 1 ] );
	assert.equal( blocks.length, openingCount, `${ label } has an unterminated YAML fence` );
	return blocks;

}

function assertNoDuplicateFlowMapKeys( yaml, label ) {

	const stack = [];
	let quote = null;
	let escaped = false;
	for ( let index = 0; index < yaml.length; index ++ ) {

		const character = yaml[ index ];
		if ( quote !== null ) {

			if ( escaped ) escaped = false;
			else if ( character === '\\' && quote === '"' ) escaped = true;
			else if ( character === quote ) quote = null;
			continue;

		}
		if ( character === '"' || character === "'" ) { quote = character; continue; }
		if ( character === '{' ) {

			stack.push( { kind: 'map', keys: new Set(), segmentStart: index + 1, sawColon: false } );
			continue;

		}
		if ( character === '[' ) { stack.push( { kind: 'sequence' } ); continue; }
		const frame = stack.at( - 1 );
		if ( character === ':' && frame?.kind === 'map' && ! frame.sawColon ) {

			const key = yaml.slice( frame.segmentStart, index ).trim().replace( /^(?:"([^"]*)"|'([^']*)')$/, '$1$2' );
			assert.ok( key.length > 0, `${ label } contains an empty flow-map key` );
			assert.ok( ! frame.keys.has( key ), `${ label } duplicates YAML flow-map key ${ key}` );
			frame.keys.add( key );
			frame.sawColon = true;
			continue;

		}
		if ( character === ',' && frame?.kind === 'map' ) {

			assert.ok( frame.sawColon, `${ label } contains a malformed flow-map entry` );
			frame.segmentStart = index + 1;
			frame.sawColon = false;
			continue;

		}
		if ( character === '}' ) {

			assert.equal( frame?.kind, 'map', `${ label } has an unbalanced flow map` );
			const terminal = yaml.slice( frame.segmentStart, index ).trim();
			assert.ok( frame.sawColon || terminal === '', `${ label } contains a malformed terminal flow-map entry: ${ terminal.slice( 0, 80 ) }` );
			stack.pop();
			continue;

		}
		if ( character === ']' ) {

			assert.equal( frame?.kind, 'sequence', `${ label } has an unbalanced flow sequence` );
			stack.pop();

		}

	}
	assert.equal( stack.length, 0, `${ label } has an unterminated YAML flow collection` );

}

function assertNoDuplicateYamlKeys( yaml, label ) {

	assertNoDuplicateFlowMapKeys( yaml, label );
	const frames = [];
	for ( const [ lineIndex, sourceLine ] of yaml.split( '\n' ).entries() ) {

		assert.doesNotMatch( sourceLine, /\t/, `${ label } line ${ lineIndex + 1 } contains a YAML tab` );
		const withoutComment = sourceLine.replace( /\s+#.*$/, '' );
		if ( withoutComment.trim() === '' ) continue;
		const indent = withoutComment.match( /^ */ )[ 0 ].length;
		const trimmed = withoutComment.trimStart();
		const sequenceItem = trimmed.startsWith( '- ' );
		const body = sequenceItem ? trimmed.slice( 2 ) : trimmed;
		const keyMatch = body.match( /^([^\s:#][^:]*):(?:\s|$)/ );

		while ( frames.length > 0 && frames.at( - 1 ).indent > indent ) frames.pop();
		if ( sequenceItem ) {

			while ( frames.length > 0 && frames.at( - 1 ).indent >= indent ) frames.pop();

		}
		if ( ! keyMatch ) continue;

		let frame = frames.findLast( ( candidate ) => candidate.indent === indent );
		if ( ! frame ) {

			frame = { indent, keys: new Set() };
			frames.push( frame );

		}
		const key = keyMatch[ 1 ].trim();
		assert.ok( ! frame.keys.has( key ), `${ label } line ${ lineIndex + 1 } duplicates YAML key ${ key } at indent ${ indent }` );
		frame.keys.add( key );

	}

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
	const yamlBlocks = extractYamlBlocks( section, recipeName );
	for ( const [ index, block ] of yamlBlocks.entries() ) assertNoDuplicateYamlKeys( block, `${ recipeName} YAML block ${ index + 1 }` );
	const manifestFences = [ ...section.matchAll( /```(yaml|text)\n([\s\S]*?)```/g ) ].map( ( match ) => ( { language: match[ 1 ], block: match[ 2 ] } ) );
	const manifestFence = manifestFences.find( ( fence ) => topLevelKeys( fence.block ).has( 'backendManifest' ) );
	assert.ok( manifestFence, `${ recipeName } has no fenced manifest sketch with backendManifest` );
	const yaml = manifestFence.block;
	if ( manifestFence.language === 'yaml' ) assertNoDuplicateYamlKeys( yaml, `${ recipeName } manifest` );

	assertKeys(
		topLevelKeys( yaml ),
		[
			'backendManifest', 'workloadProfile', 'causeLedger', 'selectedSkills',
			'primaryOwner', 'deferredSkills', 'omittedSkills', 'owners',
			'requiredSignals', 'domainSignals', 'physicsContext', 'physicsGraph',
			'physicsCoordinationAdvanceRecords', 'physicsCostLedger',
			'physicsSignals', 'physicsErrorPropagationLedgers', 'physicsInteractions',
			'physicsInteractionApplicationLedgers', 'physicsCommitTransactions',
			'physicsExternalSolverAdaptersById',
			'physicsQualityRequests', 'physicsQualityStates', 'physicsQualityTransitions', 'physicsPresentationTimeCohortsById', 'physicsPresentationCandidate',
			'physicsCameraViewPublicationsByTarget',
			'physicsViewPreparationPublicationsByTarget',
			'physicsPresentationSnapshotsByTarget', 'physicsPresentationRenderPlansByTarget',
			'frameExecutionRecord',
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

	const physicsBlocks = manifestFences.map( ( fence ) => fence.block ).filter( ( block ) => topLevelKeys( block ).has( 'physicsContext' ) );
	assert.ok( physicsBlocks.length > 0, `${ recipeName } has no explicit physics-contract decision` );
	for ( const [ index, block ] of physicsBlocks.entries() ) assertPhysicsFieldsInYaml( block, `${ recipeName } physical YAML block ${ index + 1 }` );

}

function assertPhysicsFieldsInYaml( yaml, label ) {

	const context = mappingBlock( yaml, 'physicsContext' ).value;
	const graph = mappingBlock( yaml, 'physicsGraph' ).value;
	const advances = mappingBlock( yaml, 'physicsCoordinationAdvanceRecords' ).value;
	const cost = mappingBlock( yaml, 'physicsCostLedger' ).value;
	const signals = mappingBlock( yaml, 'physicsSignals' ).value;
	const errorLedgers = mappingBlock( yaml, 'physicsErrorPropagationLedgers' ).value;
	const interactions = mappingBlock( yaml, 'physicsInteractions' ).value;
	const applicationLedgers = mappingBlock( yaml, 'physicsInteractionApplicationLedgers' ).value;
	const commitTransactions = mappingBlock( yaml, 'physicsCommitTransactions' ).value;
	const externalAdapters = mappingBlock( yaml, 'physicsExternalSolverAdaptersById' ).value;
	const qualityRequests = mappingBlock( yaml, 'physicsQualityRequests' ).value;
	const qualityStates = mappingBlock( yaml, 'physicsQualityStates' ).value;
	const qualityTransitions = mappingBlock( yaml, 'physicsQualityTransitions' ).value;
	const timeCohorts = mappingBlock( yaml, 'physicsPresentationTimeCohortsById' ).value;
	const candidate = mappingBlock( yaml, 'physicsPresentationCandidate' ).value;
	const cameras = mappingBlock( yaml, 'physicsCameraViewPublicationsByTarget' ).value;
	const preparations = mappingBlock( yaml, 'physicsViewPreparationPublicationsByTarget' ).value;
	const snapshots = mappingBlock( yaml, 'physicsPresentationSnapshotsByTarget' ).value;
	const renderPlans = mappingBlock( yaml, 'physicsPresentationRenderPlansByTarget' ).value;
	const execution = mappingBlock( yaml, 'frameExecutionRecord' ).value;
	const deprecatedSnapshot = mappingBlock( yaml, 'physicsPresentationSnapshot' ).value;
	const isPhysical = context === '';
	assert.match( deprecatedSnapshot, /^not used\b/i, `${ label } deprecated singular physicsPresentationSnapshot must remain not used` );

	if ( ! isPhysical ) {

		assert.match( context, /^not used\b/i, `${ label } nonphysical physicsContext must be not used` );
		assert.match( graph, /^not used\b/i, `${ label } nonphysical physicsGraph must be not used` );
		assert.equal( advances, '[]', `${ label } nonphysical physicsCoordinationAdvanceRecords must be empty` );
		assert.match( cost, /^not used\b/i, `${ label } nonphysical physicsCostLedger must be not used` );
		assert.equal( signals, '{}', `${ label } nonphysical physicsSignals must be empty` );
		assert.equal( errorLedgers, '{}', `${ label } nonphysical physicsErrorPropagationLedgers must be empty` );
		assert.equal( interactions, '[]', `${ label } nonphysical physicsInteractions must be empty` );
		assert.equal( applicationLedgers, '{}', `${ label } nonphysical physicsInteractionApplicationLedgers must be empty` );
		assert.equal( commitTransactions, '{}', `${ label } nonphysical physicsCommitTransactions must be empty` );
		assert.equal( externalAdapters, '{}', `${ label } nonphysical physicsExternalSolverAdaptersById must be empty` );
		assert.equal( qualityRequests, '{}', `${ label } nonphysical physicsQualityRequests must be empty` );
		assert.equal( qualityStates, '{}', `${ label } nonphysical physicsQualityStates must be empty` );
		assert.equal( qualityTransitions, '[]', `${ label } nonphysical physicsQualityTransitions must be empty` );
		assert.equal( timeCohorts, '{}', `${ label } nonphysical physicsPresentationTimeCohortsById must be empty` );
		assert.match( candidate, /^not used\b/i, `${ label } nonphysical physicsPresentationCandidate must be not used` );
		assert.equal( cameras, '{}', `${ label } nonphysical physicsCameraViewPublicationsByTarget must be empty` );
		assert.equal( preparations, '{}', `${ label } nonphysical physicsViewPreparationPublicationsByTarget must be empty` );
		assert.equal( snapshots, '{}', `${ label } nonphysical physicsPresentationSnapshotsByTarget must be empty` );
		assert.equal( renderPlans, '{}', `${ label } nonphysical physicsPresentationRenderPlansByTarget must be empty` );
		assert.match( execution, /^not used\b/i, `${ label } nonphysical frameExecutionRecord must be not used` );
		return;

	}

	assert.equal( graph, '', `${ label } physical physicsGraph must be a mapping` );
	assert.equal( advances, '', `${ label } physical physicsCoordinationAdvanceRecords must be a sequence` );
	assert.equal( cost, '', `${ label } physical physicsCostLedger must be a mapping` );
	assert.equal( signals, '', `${ label } physical physicsSignals must be a mapping` );
	assert.equal( errorLedgers, '', `${ label } physical physicsErrorPropagationLedgers must be a mapping` );
	assert.ok( interactions === '' || /^\[\]/.test( interactions ), `${ label } physical physicsInteractions must be a sequence or explicit empty sequence` );
	assert.equal( applicationLedgers, '', `${ label } physical physicsInteractionApplicationLedgers must be a mapping` );
	assert.equal( commitTransactions, '', `${ label } physical physicsCommitTransactions must be a mapping` );
	assert.ok( externalAdapters === '' || externalAdapters === '{}', `${ label } physical physicsExternalSolverAdaptersById must be a mapping or explicit empty mapping` );
	assert.equal( qualityRequests, '', `${ label } physical physicsQualityRequests must be a mapping` );
	assert.equal( qualityStates, '', `${ label } physical physicsQualityStates must be a mapping` );
	assert.ok( qualityTransitions === '' || /^\[\]/.test( qualityTransitions ), `${ label } physical physicsQualityTransitions must be a sequence` );
	assert.equal( timeCohorts, '', `${ label } physical physicsPresentationTimeCohortsById must be a mapping` );
	assert.equal( candidate, '', `${ label } physical physicsPresentationCandidate must be a mapping` );
	assert.equal( cameras, '', `${ label } physical physicsCameraViewPublicationsByTarget must be a mapping` );
	assert.equal( preparations, '', `${ label } physical physicsViewPreparationPublicationsByTarget must be a mapping` );
	assert.equal( snapshots, '', `${ label } physical physicsPresentationSnapshotsByTarget must be a mapping` );
	assert.equal( renderPlans, '', `${ label } physical physicsPresentationRenderPlansByTarget must be a mapping` );
	assert.equal( execution, '', `${ label } physical frameExecutionRecord must be a mapping` );

}

function isPlainObject( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function typedAbsence( reason = 'not-applicable', authority = 'fixture-owner', effectiveTime = 'timeless', provenance = 'canonical-fixture' ) {

	return { kind: 'absent', reason, authority, schemaId: 'typed-absence-v1', effectiveTime, provenance };

}

function isTypedAbsence( value ) {

	if ( ! isPlainObject( value ) || value.kind !== 'absent' ) return false;
	const required = abiRecord( 'TypedAbsence' ).required;
	if ( ! required.every( ( key ) => Object.hasOwn( value, key ) ) ) return false;
	if ( Object.keys( value ).length !== required.length ) return false;
	if ( ! abiEnum( 'typedAbsenceReasons' ).includes( value.reason ) ) return false;
	if ( typeof value.authority !== 'string' || value.authority.trim() === '' ) return false;
	if ( value.schemaId !== 'typed-absence-v1' ) return false;
	if ( typeof value.provenance !== 'string' || value.provenance.trim() === '' ) return false;
	if ( value.effectiveTime === 'timeless' ) return true;
	if ( ! isPlainObject( value.effectiveTime ) || ! abiEnum( 'physicsTimeKinds' ).includes( value.effectiveTime.kind ) ) return false;
	const activeKey = value.effectiveTime.kind === 'instant' ? 'instant' : 'interval';
	const inactiveKey = activeKey === 'instant' ? 'interval' : 'instant';
	return Object.hasOwn( value.effectiveTime, activeKey ) && isPlainObject( value.effectiveTime[ activeKey ] ) && isTypedAbsence( value.effectiveTime[ inactiveKey ] );

}

function requireObjectKeys( object, keys, label ) {

	assert.ok( isPlainObject( object ), `${ label } must be a mapping` );
	for ( const key of keys ) assert.ok( Object.hasOwn( object, key ), `${ label } missing ${ key }` );

}

let abiNativeNumericFieldKindsCache;

function abiNativeNumericFieldKinds() {

	if ( abiNativeNumericFieldKindsCache ) return abiNativeNumericFieldKindsCache;
	const kinds = new Map();
	const structuralArrays = new Set( [ 'Vec2', 'Vec3', 'Mat3', 'Mat4' ] );
	const classify = ( schema, visited = new Set() ) => {

		if ( ! isPlainObject( schema ) || visited.has( schema ) ) return null;
		visited.add( schema );
		if ( typeof schema.$ref === 'string' ) {

			const definitionName = schema.$ref.split( '/' ).at( - 1 );
			if ( structuralArrays.has( definitionName ) ) return 'finite-number';
			const target = physicsAbiSchema?.$defs?.[ definitionName ];
			if ( target ) return classify( target, visited );

		}
		if ( schema.type === 'integer' ) return 'integer';
		for ( const branchKey of [ 'oneOf', 'anyOf', 'allOf' ] ) {

			const branchKinds = ( schema[ branchKey ] ?? [] ).map( ( branch ) => classify( branch, new Set( visited ) ) ).filter( Boolean );
			if ( branchKinds.includes( 'finite-number' ) ) return 'finite-number';
			if ( branchKinds.includes( 'integer' ) ) return 'integer';

		}
		return null;

	};
	for ( const definition of Object.values( physicsAbiSchema?.$defs ?? {} ) ) for ( const [ fieldName, fieldSchema ] of Object.entries( definition?.properties ?? {} ) ) {

		const kind = classify( fieldSchema );
		if ( kind === 'finite-number' || ( kind === 'integer' && kinds.get( fieldName ) !== 'finite-number' ) ) kinds.set( fieldName, kind );

	}
	abiNativeNumericFieldKindsCache = kinds;
	return kinds;

}

function validateNumericEvidence( value, path = 'route' ) {

	if ( path === 'route.physicsExternalSolverAdaptersById' ) return;
	if ( typeof value === 'number' || ( typeof value === 'string' && /^-?\d+(\.\d+)?$/.test( value ) ) ) {

		const structuralComponent = path.match( /\.([A-Za-z][A-Za-z0-9]*)(?:\[\d+\])*$/ );
		if ( structuralComponent ) {

			const nativeKind = abiNativeNumericFieldKinds().get( structuralComponent[ 1 ] );
			if ( nativeKind === 'finite-number' && Number.isFinite( Number( value ) ) ) return;
			if ( nativeKind === 'integer' && Number.isInteger( Number( value ) ) ) return;

		}
		if ( ( /\.(generation|tick|epochTick|numerator|denominator|requestSequence|producerSequence|executionSequence|coordinationSequence|presentationOpportunitySequence|targetFrameSequence|subcycleIndex|nativeSubcycleIndex|frameSlotIndex|allocationCursor|firstSequence|lastSequence|lastSequenceInclusive|nextSequence|cursorBefore|cursorAfter|iterationIndex|producedIterationOffset|consumedIterationOffset|count|elementCount|configuredMaximumFramesInFlight|observedFramesInFlightAtAdmission)$/.test( path ) || /\.(perConsumerCursor|identitySlotMap|configuredMaximumFramesInFlightByTarget|observedFramesInFlightByTarget)\.[^.]+$/.test( path ) || /\.sourceCursorBeforeAfter\.(before|after)$/.test( path ) ) && Number.isInteger( Number( value ) ) ) return;
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

function assertNoUndefinedAbiValues( value, path = 'route', visited = new WeakSet() ) {

	assert.notEqual( value, undefined, `${ path } contains undefined, which is not an ABI value` );
	if ( value === null || typeof value !== 'object' || visited.has( value ) ) return;
	visited.add( value );
	if ( Array.isArray( value ) ) {

		for ( const [ index, entry ] of value.entries() ) assertNoUndefinedAbiValues( entry, `${ path }[${ index }]`, visited );
		return;

	}
	for ( const [ key, entry ] of Object.entries( value ) ) assertNoUndefinedAbiValues( entry, `${ path }.${ key}`, visited );

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
const costOpportunityTableResourceFixtures = new Map();

function abiRecord( name ) {

	const record = physicsAbiSchema?.$defs?.[ name ] ?? physicsAbiSchema?.[ 'x-abi-records' ]?.[ name ] ?? physicsAbiSchema?.records?.[ name ] ?? physicsAbiSchema?.[ 'x-abi' ]?.records?.[ name ];
	assert.ok( record, `physics ABI schema missing records.${ name }` );
	const required = Array.isArray( record ) ? record : record.required;
	assert.ok( Array.isArray( required ), `physics ABI schema record ${ name } has no required-key list` );
	return { ...record, required };

}

function abiEnum( name ) {

	const abi = physicsAbiSchema?.[ 'x-abi' ];
	const values = physicsAbiSchema?.[ 'x-abi-enums' ]?.[ name ] ?? physicsAbiSchema?.enums?.[ name ] ?? abi?.enums?.[ name ] ?? abi?.[ name ] ?? physicsAbiSchema?.$defs?.[ name ]?.enum;
	assert.ok( Array.isArray( values ) && values.length > 0, `physics ABI schema missing enums.${ name }` );
	return values;

}

function resolveSchemaReference( reference, rootSchema, label ) {

	assert.match( reference, /^#\//, `${ label } supports only local schema references` );
	let value = rootSchema;
	for ( const token of reference.slice( 2 ).split( '/' ).map( ( part ) => part.replaceAll( '~1', '/' ).replaceAll( '~0', '~' ) ) ) {

		assert.ok( isPlainObject( value ) && Object.hasOwn( value, token ), `${ label } cannot resolve ${ reference }` );
		value = value[ token ];

	}
	return value;

}

function schemaTypeMatches( value, type ) {

	if ( type === 'object' ) return isPlainObject( value );
	if ( type === 'array' ) return Array.isArray( value );
	if ( type === 'integer' ) return Number.isInteger( value );
	if ( type === 'number' ) return typeof value === 'number' && Number.isFinite( value );
	if ( type === 'null' ) return value === null;
	return typeof value === type;

}

function schemaBranchMatches( value, schema, rootSchema, label ) {

	try {

		validateSchemaSubset( value, schema, rootSchema, label );
		return true;

	} catch {

		return false;

	}

}

function schemaRuntimeTypeSet( schema, rootSchema, seen = new Set() ) {

	if ( schema === true || schema === false || ! isPlainObject( schema ) || seen.has( schema ) ) return null;
	seen.add( schema );
	if ( schema.$ref ) return schemaRuntimeTypeSet( resolveSchemaReference( schema.$ref, rootSchema, 'schema type preflight' ), rootSchema, seen );
	if ( schema.type !== undefined ) return new Set( Array.isArray( schema.type ) ? schema.type : [ schema.type ] );
	if ( Array.isArray( schema.allOf ) ) {

		let intersection = null;
		for ( const branch of schema.allOf ) {

			const types = schemaRuntimeTypeSet( branch, rootSchema, new Set( seen ) );
			if ( types === null ) continue;
			intersection = intersection === null ? new Set( types ) : new Set( [ ...intersection ].filter( ( type ) => types.has( type ) || ( type === 'integer' && types.has( 'number' ) ) || ( type === 'number' && types.has( 'integer' ) ) ) );

		}
		return intersection;

	}
	for ( const unionKey of [ 'oneOf', 'anyOf' ] ) if ( Array.isArray( schema[ unionKey ] ) ) {

		const union = new Set();
		for ( const branch of schema[ unionKey ] ) {

			const types = schemaRuntimeTypeSet( branch, rootSchema, new Set( seen ) );
			if ( types === null ) return null;
			for ( const type of types ) union.add( type );

		}
		return union;

	}
	return null;

}

function schemaRuntimeTypeMatches( value, types ) {

	if ( types === null ) return true;
	return [ ...types ].some( ( type ) => schemaTypeMatches( value, type ) );

}

const supportedSchemaAssertionKeywords = new Set( [
	'$ref', 'const', 'enum', 'type', 'oneOf', 'allOf', 'anyOf', 'not', 'if', 'then', 'else',
	'minLength', 'pattern', 'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum',
	'minItems', 'maxItems', 'uniqueItems', 'items', 'required', 'properties',
	'additionalProperties', 'propertyNames', 'minProperties', 'maxProperties'
] );
const supportedSchemaAnnotationKeywords = new Set( [ '$id', '$schema', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly' ] );

function assertSupportedSchemaVocabulary( schema, label = 'physics ABI schema', visited = new Set() ) {

	if ( typeof schema === 'boolean' || schema === undefined ) return;
	assert.ok( isPlainObject( schema ), `${ label } must be a schema mapping or boolean` );
	if ( visited.has( schema ) ) return;
	visited.add( schema );
	for ( const key of Object.keys( schema ) ) assert.ok( supportedSchemaAssertionKeywords.has( key ) || supportedSchemaAnnotationKeywords.has( key ) || key === '$defs' || key.startsWith( 'x-' ), `${ label } uses unsupported assertion keyword ${ key}` );
	for ( const mapKey of [ '$defs', 'properties' ] ) for ( const [ key, child ] of Object.entries( schema[ mapKey ] ?? {} ) ) assertSupportedSchemaVocabulary( child, `${ label}.${ mapKey}.${ key}`, visited );
	for ( const childKey of [ 'not', 'if', 'then', 'else', 'items', 'additionalProperties', 'propertyNames' ] ) if ( isPlainObject( schema[ childKey ] ) || typeof schema[ childKey ] === 'boolean' ) assertSupportedSchemaVocabulary( schema[ childKey ], `${ label}.${ childKey}`, visited );
	for ( const listKey of [ 'oneOf', 'allOf', 'anyOf' ] ) for ( const [ index, child ] of ( schema[ listKey ] ?? [] ).entries() ) assertSupportedSchemaVocabulary( child, `${ label}.${ listKey}[${ index }]`, visited );

}

function validateSchemaSubset( value, schema, rootSchema, label ) {

	if ( schema === true ) return;
	assert.notEqual( schema, false, `${ label } is rejected by schema` );
	assert.ok( isPlainObject( schema ), `${ label } schema must be a mapping or boolean` );
	if ( schema.$ref ) validateSchemaSubset( value, resolveSchemaReference( schema.$ref, rootSchema, label ), rootSchema, label );
	if ( schema.const !== undefined ) assert.deepEqual( value, schema.const, `${ label } violates const` );
	if ( Array.isArray( schema.enum ) ) assert.ok( schema.enum.some( ( candidate ) => JSON.stringify( candidate ) === JSON.stringify( value ) ), `${ label } is outside enum` );
	if ( schema.type !== undefined ) {

		const types = Array.isArray( schema.type ) ? schema.type : [ schema.type ];
		assert.ok( types.some( ( type ) => schemaTypeMatches( value, type ) ), `${ label } has wrong schema type` );

	}
	if ( Array.isArray( schema.oneOf ) ) {

		const candidateBranches = schema.oneOf.filter( ( branch ) => schemaRuntimeTypeMatches( value, schemaRuntimeTypeSet( branch, rootSchema ) ) );
		const matchingBranches = candidateBranches.filter( ( branch, index ) => schemaBranchMatches( value, branch, rootSchema, `${ label}.oneOf[${ index }]` ) );
		assert.equal( matchingBranches.length, 1, `${ label } must match exactly one oneOf arm` );

	}
	if ( Array.isArray( schema.allOf ) ) for ( const [ index, branch ] of schema.allOf.entries() ) validateSchemaSubset( value, branch, rootSchema, `${ label}.allOf[${ index }]` );
	if ( Array.isArray( schema.anyOf ) ) assert.ok( schema.anyOf.filter( ( branch ) => schemaRuntimeTypeMatches( value, schemaRuntimeTypeSet( branch, rootSchema ) ) ).some( ( branch, index ) => schemaBranchMatches( value, branch, rootSchema, `${ label}.anyOf[${ index }]` ) ), `${ label } matches no anyOf arm` );
	if ( schema.not !== undefined ) assert.ok( ! schemaBranchMatches( value, schema.not, rootSchema, `${ label}.not` ), `${ label } matches forbidden schema` );
	if ( schema.if !== undefined ) {

		const condition = schemaBranchMatches( value, schema.if, rootSchema, `${ label}.if` );
		if ( condition && schema.then !== undefined ) validateSchemaSubset( value, schema.then, rootSchema, `${ label}.then` );
		if ( ! condition && schema.else !== undefined ) validateSchemaSubset( value, schema.else, rootSchema, `${ label}.else` );

	}
	if ( typeof value === 'string' ) {

		if ( schema.minLength !== undefined ) assert.ok( value.length >= schema.minLength, `${ label } is shorter than minLength` );
		if ( schema.pattern !== undefined ) assert.match( value, new RegExp( schema.pattern ), `${ label } violates pattern` );

	}
	if ( typeof value === 'number' ) {

		if ( schema.minimum !== undefined ) assert.ok( value >= schema.minimum, `${ label } is below minimum` );
		if ( schema.exclusiveMinimum !== undefined ) assert.ok( value > schema.exclusiveMinimum, `${ label } is below exclusiveMinimum` );
		if ( schema.maximum !== undefined ) assert.ok( value <= schema.maximum, `${ label } exceeds maximum` );
		if ( schema.exclusiveMaximum !== undefined ) assert.ok( value < schema.exclusiveMaximum, `${ label } exceeds exclusiveMaximum` );

	}
	if ( Array.isArray( value ) ) {

		if ( schema.minItems !== undefined ) assert.ok( value.length >= schema.minItems, `${ label } has too few items` );
		if ( schema.maxItems !== undefined ) assert.ok( value.length <= schema.maxItems, `${ label } has too many items` );
		if ( schema.uniqueItems === true ) assert.equal( new Set( value.map( ( entry ) => JSON.stringify( entry ) ) ).size, value.length, `${ label } has duplicate items` );
		if ( schema.items !== undefined ) for ( const [ index, entry ] of value.entries() ) validateSchemaSubset( entry, schema.items, rootSchema, `${ label }[${ index }]` );

	}
	if ( isPlainObject( value ) ) {

		for ( const key of schema.required ?? [] ) assert.ok( Object.hasOwn( value, key ), `${ label } missing ${ key }` );
		if ( schema.minProperties !== undefined ) assert.ok( Object.keys( value ).length >= schema.minProperties, `${ label } has too few properties` );
		if ( schema.maxProperties !== undefined ) assert.ok( Object.keys( value ).length <= schema.maxProperties, `${ label } has too many properties` );
		if ( schema.propertyNames !== undefined ) for ( const key of Object.keys( value ) ) validateSchemaSubset( key, schema.propertyNames, rootSchema, `${ label} property name ${ key}` );
		const properties = schema.properties ?? {};
		for ( const [ key, child ] of Object.entries( value ) ) {

			if ( Object.hasOwn( properties, key ) ) validateSchemaSubset( child, properties[ key ], rootSchema, `${ label }.${ key}` );
			else if ( schema.additionalProperties === false ) assert.fail( `${ label } has forbidden additional property ${ key }` );
			else if ( isPlainObject( schema.additionalProperties ) ) validateSchemaSubset( child, schema.additionalProperties, rootSchema, `${ label}.${ key}` );

		}

	}

}

function requireAbiRecord( value, recordName, label ) {

	const record = abiRecord( recordName );
	requireObjectKeys( value, record.required, label );
	if ( record.type || record.properties || record.oneOf || record.$ref || record.allOf || record.if ) validateSchemaSubset( value, record, physicsAbiSchema, label );
	return value;

}

function requireAbiEnum( value, enumName, label ) {

	assert.ok( abiEnum( enumName ).includes( value ), `${ label } is not a canonical ${ enumName } value` );

}

function validateAbiVocabularyCoverage() {

	const recordEntries = Object.entries( physicsAbiSchema[ 'x-abi-records' ] ?? physicsAbiSchema.records ?? physicsAbiSchema[ 'x-abi' ]?.records ?? physicsAbiSchema.$defs ?? {} )
		.filter( ( [ , record ] ) => Array.isArray( Array.isArray( record ) ? record : record.required ) );
	const enumEntries = Object.entries( physicsAbiSchema[ 'x-abi-enums' ] ?? physicsAbiSchema.enums ?? physicsAbiSchema[ 'x-abi' ]?.enums ?? {} )
		.filter( ( [ , values ] ) => Array.isArray( values ) );
	let requiredKeyMutationCount = 0;

	for ( const [ recordName ] of recordEntries ) {

		const required = abiRecord( recordName ).required;
		const envelope = Object.fromEntries( required.map( ( key ) => [ key, `structural:${ recordName }.${ key }` ] ) );
		requireObjectKeys( envelope, required, `structural ${ recordName } envelope` );
		for ( const key of required ) {

			const mutation = { ...envelope };
			delete mutation[ key ];
			assert.throws( () => requireObjectKeys( mutation, required, `structural ${ recordName } envelope` ), new RegExp( `missing ${ escapeRegExp( key ) }` ) );
			requiredKeyMutationCount ++;

		}

	}

	for ( const [ enumName, values ] of enumEntries ) {

		for ( const value of values ) requireAbiEnum( value, enumName, `structural enum ${ enumName }` );
		assert.throws( () => requireAbiEnum( `__invalid_${ enumName }__`, enumName, `structural enum ${ enumName }` ), /not a canonical/ );

	}

	return { recordCount: recordEntries.length, enumCount: enumEntries.length, requiredKeyMutationCount };

}

function validateNonphysicalPhysicsContract( route ) {

	requireObjectKeys( route, [
		'physicsContext', 'physicsGraph', 'physicsCoordinationAdvanceRecords',
		'physicsCostLedger', 'physicsSignals', 'physicsErrorPropagationLedgers',
		'physicsInteractions', 'physicsInteractionApplicationLedgers',
		'physicsCommitTransactions', 'physicsExternalSolverAdaptersById', 'physicsQualityRequests', 'physicsQualityStates', 'physicsQualityTransitions', 'physicsPresentationTimeCohortsById', 'physicsPresentationCandidate',
		'physicsCameraViewPublicationsByTarget',
		'physicsViewPreparationPublicationsByTarget',
		'physicsPresentationSnapshotsByTarget', 'physicsPresentationRenderPlansByTarget',
		'frameExecutionRecord',
		'physicsPresentationSnapshot'
	], 'route physics contract' );
	assert.ok( isNotUsedRecord( route.physicsContext ), 'nonphysical physicsContext must be not used' );
	assert.ok( isNotUsedRecord( route.physicsGraph ), 'nonphysical physicsGraph must be not used' );
	assert.deepEqual( route.physicsCoordinationAdvanceRecords, [], 'nonphysical coordination advances must be empty' );
	assert.ok( isNotUsedRecord( route.physicsCostLedger ), 'nonphysical physicsCostLedger must be not used' );
	assert.deepEqual( route.physicsSignals, {}, 'nonphysical physicsSignals must be empty' );
	assert.deepEqual( route.physicsErrorPropagationLedgers, {}, 'nonphysical error ledgers must be empty' );
	assert.deepEqual( route.physicsInteractions, [], 'nonphysical physicsInteractions must be empty' );
	assert.deepEqual( route.physicsInteractionApplicationLedgers, {}, 'nonphysical application ledgers must be empty' );
	assert.deepEqual( route.physicsCommitTransactions, {}, 'nonphysical commit transactions must be empty' );
	assert.deepEqual( route.physicsExternalSolverAdaptersById, {}, 'nonphysical external solver adapters must be empty' );
	assert.deepEqual( route.physicsQualityRequests, {}, 'nonphysical quality requests must be empty' );
	assert.deepEqual( route.physicsQualityStates, {}, 'nonphysical quality states must be empty' );
	assert.deepEqual( route.physicsQualityTransitions, [], 'nonphysical quality transitions must be empty' );
	assert.deepEqual( route.physicsPresentationTimeCohortsById, {}, 'nonphysical time cohorts must be empty' );
	assert.ok( isNotUsedRecord( route.physicsPresentationCandidate ), 'nonphysical physicsPresentationCandidate must be not used' );
	assert.deepEqual( route.physicsCameraViewPublicationsByTarget, {}, 'nonphysical camera publications must be empty' );
	assert.deepEqual( route.physicsViewPreparationPublicationsByTarget, {}, 'nonphysical view preparations must be empty' );
	assert.deepEqual( route.physicsPresentationSnapshotsByTarget, {}, 'nonphysical snapshots must be empty' );
	assert.deepEqual( route.physicsPresentationRenderPlansByTarget, {}, 'nonphysical render plans must be empty' );
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

	assertNoUndefinedAbiValues( route );
	requireObjectKeys( route, [
		'backendManifest', 'workloadProfile', 'causeLedger', 'selectedSkills',
		'primaryOwner', 'deferredSkills', 'omittedSkills', 'owners',
		'requiredSignals', 'domainSignals', 'physicsContext', 'physicsGraph',
		'physicsCoordinationAdvanceRecords', 'physicsCostLedger', 'physicsSignals',
		'physicsErrorPropagationLedgers', 'physicsInteractions',
		'physicsInteractionApplicationLedgers', 'physicsCommitTransactions',
		'physicsExternalSolverAdaptersById',
		'physicsQualityRequests', 'physicsQualityStates', 'physicsQualityTransitions', 'physicsPresentationTimeCohortsById',
		'physicsPresentationCandidate', 'physicsCameraViewPublicationsByTarget',
		'physicsViewPreparationPublicationsByTarget',
		'physicsPresentationSnapshotsByTarget', 'physicsPresentationRenderPlansByTarget',
		'frameExecutionRecord',
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
	if ( isPlainObject( route.physicsContext ) && route.physicsContext.schemaId === physicsAbiSchema?.$id ) validatePhysicalRouteManifest( route );
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
		physicsCoordinationAdvanceRecords: [],
		physicsCostLedger: 'not used',
		physicsSignals: {},
		physicsErrorPropagationLedgers: {},
		physicsInteractions: [],
		physicsInteractionApplicationLedgers: {},
		physicsCommitTransactions: {},
		physicsExternalSolverAdaptersById: {},
		physicsQualityRequests: {},
		physicsQualityStates: {},
		physicsQualityTransitions: [],
		physicsPresentationTimeCohortsById: {},
		physicsPresentationCandidate: 'not used',
		physicsCameraViewPublicationsByTarget: {},
		physicsViewPreparationPublicationsByTarget: {},
		physicsPresentationSnapshotsByTarget: {},
		physicsPresentationRenderPlansByTarget: {},
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

function canonicalJson( value ) {

	if ( Array.isArray( value ) ) return `[${ value.map( canonicalJson ).join( ',' ) }]`;
	if ( isPlainObject( value ) ) return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ canonicalJson( value[ key ] ) }` ).join( ',' ) }}`;
	return JSON.stringify( value );

}

function sha256Canonical( value ) {

	return `sha256:${ createHash( 'sha256' ).update( canonicalJson( value ) ).digest( 'hex' ) }`;

}

function sha256CanonicalExcluding( value, excludedKeys ) {

	const payload = clone( value );
	for ( const key of excludedKeys ) delete payload[ key ];
	return sha256Canonical( payload );

}

function assertAcyclicDependencies( records, idKey, dependenciesKey, label ) {

	const byId = new Map( records.map( ( record ) => [ record[ idKey ], record ] ) );
	assert.equal( byId.size, records.length, `${ label } contains duplicate IDs` );
	const pending = new Set( byId.keys() );
	const complete = new Set();
	while ( pending.size > 0 ) {

		const ready = [ ...pending ].filter( ( id ) => byId.get( id )[ dependenciesKey ].every( ( dependencyId ) => complete.has( dependencyId ) ) );
		for ( const id of pending ) for ( const dependencyId of byId.get( id )[ dependenciesKey ] ) assert.ok( byId.has( dependencyId ), `${ label}.${ id} references unknown dependency ${ dependencyId }` );
		assert.ok( ready.length > 0, `${ label } contains a dependency cycle` );
		for ( const id of ready ) { pending.delete( id ); complete.add( id ); }

	}

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

	assert.ok( Array.isArray( value ) && value.length === 9 && value.every( Number.isFinite ), `${ label } must contain nine finite components` );
	return value;

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

	const clock = Object.values( context.physicsClockRegistry.clocksById ).find( ( candidate ) => candidate.clockId === clockId );
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

function externalMappingSeconds( mapping, coordinate, label ) {

	return timestampMappingSeconds( mapping.frozenEvaluationTable, coordinate, label );

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
		expected = externalMappingSeconds( mapping, coordinate, `${ label }.clock.external.frozenEvaluationTable` );

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
	requireAbiRecord( context.physicsFrameRegistry, 'PhysicsFrameRegistry', 'physicsContext.physicsFrameRegistry' );
	requireNonEmptyMapping( context.physicsFrameRegistry.framesById, 'physicsContext.physicsFrameRegistry.framesById' );
	assert.equal( context.physicsFrameRegistry.rootFrameId, context.physicsRootFrameId, 'physics frame registry root mismatch' );
	for ( const [ frameKey, frame ] of Object.entries( context.physicsFrameRegistry.framesById ) ) {

		requireAbiRecord( frame, 'PhysicsFrameDescriptor', `physicsFrameRegistry.${ frameKey }` );
		assertProperRotation( frame.parentFromFrameRotation, `physicsFrameRegistry.${ frameKey }.parentFromFrameRotation` );
		validateCanonicalInterval( frame.validityInterval, context, `physicsFrameRegistry.${ frameKey }.validityInterval` );

	}
	requireAbiRecord( context.chartRegistry, 'PhysicsChartRegistry', 'physicsContext.chartRegistry' );
	requireAbiRecord( context.physicsClockRegistry, 'PhysicsClockRegistry', 'physicsContext.physicsClockRegistry' );
	requireNonEmptyMapping( context.physicsClockRegistry.clocksById, 'physicsContext.physicsClockRegistry.clocksById' );
	assert.ok( Object.values( context.physicsClockRegistry.clocksById ).some( ( clock ) => clock.clockId === context.physicsClockRegistry.coordinationClockId ), 'physics clock registry coordination clock is missing' );
	for ( const [ clockKey, clock ] of Object.entries( context.physicsClockRegistry.clocksById ) ) {

		requireAbiRecord( clock, 'PhysicsClockDescriptor', `physicsClockRegistry.${ clockKey }` );
		assert.equal( clockKey, clock.clockId, `physicsClockRegistry key ${ clockKey } does not match clockId` );
		requireAbiEnum( clock.mappingKind, 'clockMappingKinds', `physicsClockRegistry.${ clockKey }.mappingKind` );
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
			externalMappingSeconds( clock.mapping.external, instantCoordinate( first.instantKey, `physicsClockRegistry.${ clockKey }.firstExternalKnot` ), `physicsClockRegistry.${ clockKey }.mapping.external.frozenEvaluationTable` );

		}

	}
	requireAbiRecord( context.physicsMaterialRegistry, 'PhysicsMaterialRegistry', 'physicsMaterialRegistry' );
	requireAbiRecord( context.idNamespaces, 'PhysicsIdentityRegistry', 'physicsContext.idNamespaces' );
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
	assert.ok( Object.values( context.physicsFrameRegistry.framesById ).some( ( frame ) => frame.frameId === descriptor.physicsFrameId ), `${ label } references an unregistered frame` );
	canonicalClock( context, descriptor.clockId, label );
	assert.equal( descriptor.physicsOriginEpoch, context.physicsOriginEpoch, `${ label }.physicsOriginEpoch mismatch` );
	requireNonEmptyMapping( descriptor.channels, `${ label }.channels` );
	assert.deepEqual( Object.keys( descriptor.perChannelError ).sort(), Object.keys( descriptor.channels ).sort(), `${ label } channel/error key sets differ` );
	for ( const [ channelId, channel ] of Object.entries( descriptor.channels ) ) {

		requireAbiRecord( channel, 'PhysicsChannelDescriptor', `${ label }.channels.${ channelId}` );
		requireNonEmptyString( channel.unit, `${ label }.channels.${ channelId}.unit` );
		requireAbiEnum( channel.basisBehavior, 'basisBehaviors', `${ label }.channels.${ channelId}.basisBehavior` );
		requireAbiEnum( channel.quantityClass, 'quantityClasses', `${ label }.channels.${ channelId}.quantityClass` );
		requireAbiEnum( channel.samplingMeasure, 'samplingMeasures', `${ label }.channels.${ channelId}.samplingMeasure` );
		requireAbiEnum( channel.validity.status, 'validityStatuses', `${ label }.channels.${ channelId}.validity.status` );
		const channelError = requireAbiRecord( descriptor.perChannelError[ channelId ], 'PhysicsErrorDescriptor', `${ label }.perChannelError.${ channelId}` );
		assert.deepEqual( [ channel.channelId, channel.errorRef, channelError.errorId, channelError.quantityOrChannelId ], [ channelId, `${ descriptor.signalId }/error/${ channelId }`, `${ descriptor.signalId }/error/${ channelId }`, channelId ], `${ label }.channels.${ channelId} channel/error reference closure mismatch` );
		requireAbiEnum( channelError.classification, 'errorClassifications', `${ label }.perChannelError.${ channelId}.classification` );
		requireAbiEnum( channelError.correlationModel, 'errorCorrelationModels', `${ label }.perChannelError.${ channelId }.correlationModel` );
		requireAbiEnum( channelError.combinationRule, 'errorCombinationRules', `${ label }.perChannelError.${ channelId }.combinationRule` );

	}
	requireAbiRecord( descriptor.representedFootprint, 'PhysicsSupportDescriptor', `${ label }.representedFootprint` );
	requireAbiRecord( descriptor.filter, 'PhysicsFilterDescriptor', `${ label }.filter` );
	requireAbiRecord( descriptor.validity, 'PhysicsValidityDescriptor', `${ label }.validity` );
	requireAbiRecord( descriptor.residency, 'PhysicsResidencyDescriptor', `${ label }.residency` );
	requireAbiRecord( descriptor.residency.mirror, 'PhysicsMirrorDescriptor', `${ label }.residency.mirror` );
	requireAbiRecord( descriptor.cadence, 'PhysicsCadenceDescriptor', `${ label }.cadence` );
	requireAbiRecord( descriptor.latency, 'PhysicsLatencyDescriptor', `${ label }.latency` );
	requireAbiEnum( descriptor.validity.status, 'validityStatuses', `${ label }.validity.status` );
	requireAbiEnum( descriptor.residency.kind, 'residencyKinds', `${ label }.residency.kind` );
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
	assert.deepEqual( [ ...new Set( executionLedger.stageExecutions.map( ( row ) => row.stageId ) ) ].sort(), [ ...stagesById.keys() ].sort(), 'physicsGraph.executionLedger must cover every stage in the fixture interval' );
	assertUnique( executionLedger.stageExecutions.map( ( row ) => String( row.executionSequence ) ), 'physicsGraph.executionLedger execution sequences' );
	for ( let index = 1; index < executionLedger.stageExecutions.length; index ++ ) assert.ok( executionLedger.stageExecutions[ index ].executionSequence > executionLedger.stageExecutions[ index - 1 ].executionSequence, 'physicsGraph.executionLedger execution sequence is not strictly increasing' );
	const executionRowsByStage = new Map( [ ...stagesById.keys() ].map( ( stageId ) => [ stageId, [] ] ) );
	for ( const row of executionLedger.stageExecutions ) {

		assert.ok( stagesById.has( row.stageId ), `physicsGraph.executionLedger references unknown stage ${ row.stageId }` );
		validateCanonicalInterval( row.executionInterval, context, `physicsGraph.executionLedger.${ row.stageId }.executionInterval` );
		assertIntervalContained( row.executionInterval, stagesById.get( row.stageId ).executionInterval, context, `physicsGraph.executionLedger.${ row.stageId }` );
		assert.equal( row.status, 'completed', `physicsGraph.executionLedger.${ row.stageId } is not complete` );
		assert.ok( Array.isArray( row.dependencyCompletionRefs ) && row.dependencyCompletionRefs.length > 0, `physicsGraph.executionLedger.${ row.stageId } lacks dependency completion evidence` );
		executionRowsByStage.get( row.stageId ).push( row );

	}
	for ( const [ stageId, rows ] of executionRowsByStage ) {

		rows.sort( ( a, b ) => intervalBoundsSeconds( a.executionInterval, context, `${ stageId}.sort-a` )[ 0 ] - intervalBoundsSeconds( b.executionInterval, context, `${ stageId}.sort-b` )[ 0 ] );
		const [ stageStart, stageEnd ] = intervalBoundsSeconds( stagesById.get( stageId ).executionInterval, context, `${ stageId}.declaredInterval` );
		const rowBounds = rows.map( ( row, index ) => intervalBoundsSeconds( row.executionInterval, context, `${ stageId}.executionRows[${ index }]` ) );
		assert.ok( Math.abs( rowBounds[ 0 ][ 0 ] - stageStart ) <= 1e-12, `physicsGraph.executionLedger.${ stageId } leaves an initial execution gap` );
		assert.ok( Math.abs( rowBounds.at( - 1 )[ 1 ] - stageEnd ) <= 1e-12, `physicsGraph.executionLedger.${ stageId } leaves a terminal execution gap` );
		for ( let index = 1; index < rowBounds.length; index ++ ) assert.ok( Math.abs( rowBounds[ index - 1 ][ 1 ] - rowBounds[ index ][ 0 ] ) <= 1e-12, `physicsGraph.executionLedger.${ stageId } has a gap or double-step overlap` );
		assert.deepEqual( rows.map( ( row ) => row.subexecutionIndex ), rows.map( ( _, index ) => index ), `physicsGraph.executionLedger.${ stageId } subexecution indices are not contiguous` );
		const committedVersions = rows.flatMap( ( row ) => row.committedOutputVersions );
		assertUnique( committedVersions, `physicsGraph.executionLedger.${ stageId } committed output versions` );

	}
	const successfulCommitIds = new Set( executionLedger.commitResults.filter( ( result ) => result.status === 'committed' ).map( ( result ) => result.commitGroupId ) );
	assert.deepEqual( [ ...successfulCommitIds ].sort(), [ ...commitGroupsById.keys() ].sort(), 'physicsGraph.executionLedger does not prove every fixture commit group' );
	for ( const result of executionLedger.commitResults.filter( ( candidate ) => candidate.status === 'committed' ) ) {

		const group = commitGroupsById.get( result.commitGroupId );
		assert.deepEqual( [ ...result.publishedVersions ].sort(), group.committedPublications.map( ( publication ) => publication.stateVersion ).sort(), `physicsGraph.executionLedger commit result ${ result.commitGroupId } has incomplete publication lineage` );

	}
	const catchUpBefore = quantityValue( executionLedger.catchUpDebtBeforeAfter.before.seconds, 'physicsGraph.executionLedger.catchUpDebtBeforeAfter.before.seconds' );
	const catchUpAfter = quantityValue( executionLedger.catchUpDebtBeforeAfter.after.seconds, 'physicsGraph.executionLedger.catchUpDebtBeforeAfter.after.seconds' );
	assert.ok( catchUpAfter >= 0 && catchUpAfter <= catchUpBefore, 'physicsGraph.executionLedger catch-up debt increases or becomes negative' );
	assert.equal( executionLedger.discontinuityEpoch, graph.coordinationInterval.start.discontinuityEpoch, 'physicsGraph.executionLedger discontinuity epoch mismatch' );

}

function versionRuleAccepts( producerRule, requiredRule ) {

	if ( producerRule === requiredRule ) return true;
	const pattern = `^${ escapeRegExp( producerRule ).replace( /\\\{[is]\\\}/g, '[^/]+' ) }$`;
	return new RegExp( pattern ).test( requiredRule );

}

function validateCanonicalGraphV2( graph, signals, context, route ) {

	requireAbiRecord( graph, 'PhysicsGraph', 'physicsGraph' );
	assert.equal( graph.contextId, context.contextId, 'physicsGraph.contextId mismatch' );
	validateCanonicalInterval( graph.coordinationInterval, context, 'physicsGraph.coordinationInterval' );
	const stageKinds = abiEnum( 'stageKinds' );
	const descriptorsById = new Map( Object.values( signals ).map( ( descriptor ) => [ descriptor.signalId, descriptor ] ) );
	const stagesById = new Map();
	const readsById = new Map();
	const writesById = new Map();
	for ( const [ index, stage ] of graph.stages.entries() ) {

		const label = `physicsGraph.stages[${ index }]`;
		requireAbiRecord( stage, 'PhysicsGraphStage', label );
		assert.ok( ! stagesById.has( stage.stageId ), `${ label} duplicates stageId` );
		stagesById.set( stage.stageId, stage );
		requireAbiEnum( stage.stageKind, 'stageKinds', `${ label}.stageKind` );
		requireAbiEnum( stage.samplePhase, 'samplePhases', `${ label}.samplePhase` );
		requireAbiEnum( stage.nativeStepRule, 'nativeStepRules', `${ label}.nativeStepRule` );
		assert.equal( stage.clockId, stage.executionInterval.clockId, `${ label} execution clock mismatch` );
		canonicalClock( context, stage.clockId, label );
		assertIntervalContained( stage.executionInterval, graph.coordinationInterval, context, label );
		requireAbiRecord( stage.executionRule, 'PhysicsStageExecutionRule', `${ label}.executionRule` );
		requireAbiEnum( stage.executionRule.activation, 'stageActivations', `${ label}.executionRule.activation` );
		requireAbiEnum( stage.executionRule.partition, 'stagePartitions', `${ label}.executionRule.partition` );
		assert.ok( quantityValue( stage.executionRule.maximumActivationsPerAdvance, `${ label}.executionRule.maximumActivationsPerAdvance` ) > 0, `${ label} has no permitted activations` );
		assert.ok( quantityValue( stage.executionRule.maximumExecutionsPerActivation, `${ label}.executionRule.maximumExecutionsPerActivation` ) > 0, `${ label} has no permitted executions` );
		for ( const [ readIndex, read ] of stage.reads.entries() ) {

			const readLabel = `${ label}.reads[${ readIndex }]`;
			requireAbiRecord( read, 'PhysicsStageRead', readLabel );
			assert.ok( ! readsById.has( read.readId ), `${ readLabel} duplicates readId` );
			readsById.set( read.readId, { stage, read } );
			assert.ok( descriptorsById.has( read.signalId ), `${ readLabel} references an unknown signal` );
			requireAbiEnum( read.requiredDisposition, 'stageReadDispositions', `${ readLabel}.requiredDisposition` );
			assert.equal( read.samplePhase, stage.samplePhase, `${ readLabel}.samplePhase mismatch` );
			requireAbiRecord( read.requestedTime, 'PhysicsTime', `${ readLabel}.requestedTime` );
			if ( ! isTypedAbsence( read.maximumStaleness ) ) validateCanonicalDuration( read.maximumStaleness, context, `${ readLabel}.maximumStaleness` );

		}
		for ( const [ writeIndex, write ] of stage.writes.entries() ) {

			const writeLabel = `${ label}.writes[${ writeIndex }]`;
			requireAbiRecord( write, 'PhysicsStageWrite', writeLabel );
			assert.ok( ! writesById.has( write.writeId ), `${ writeLabel} duplicates writeId` );
			writesById.set( write.writeId, { stage, write } );
			const descriptor = descriptorsById.get( write.signalId );
			assert.ok( descriptor, `${ writeLabel} writes an unknown signal` );
			assert.equal( stage.owner, descriptor.owner, `${ writeLabel} is not the unique state-equation owner` );
			requireAbiEnum( write.disposition, 'stageWriteDispositions', `${ writeLabel}.disposition` );
			requireAbiEnum( write.publicationEligibility, 'stagePublicationEligibility', `${ writeLabel}.publicationEligibility` );
			requireAbiRecord( write.producedTime, 'PhysicsTime', `${ writeLabel}.producedTime` );
			assert.notEqual( write.producedStateVersionRule, descriptor.stateVersion, `${ writeLabel} exposes a committed descriptor version directly` );

		}
		assertUnique( stage.writes.map( ( write ) => `${ write.signalId }|${ write.disposition}` ), `${ label} signal/disposition writer identities` );

	}
	assert.equal( stagesById.size, graph.stages.length, 'physicsGraph stage IDs are not unique' );
	{

		const rawPredecessors = new Map( [ ...stagesById.keys() ].map( ( stageId ) => [ stageId, [] ] ) );
		for ( const edge of graph.edges ) {

			assert.ok( stagesById.has( edge.producerStageId ) && stagesById.has( edge.consumerStageId ), `physicsGraph edge ${ edge.edgeId } references an unknown stage` );
			rawPredecessors.get( edge.consumerStageId ).push( edge.producerStageId );

		}
		const pending = new Set( stagesById.keys() );
		const completed = new Set();
		while ( pending.size > 0 ) {

			const ready = [ ...pending ].filter( ( stageId ) => rawPredecessors.get( stageId ).every( ( predecessor ) => completed.has( predecessor ) ) );
			assert.ok( ready.length > 0, 'physicsGraph outer graph contains a cycle' );
			for ( const stageId of ready ) { pending.delete( stageId ); completed.add( stageId ); }

		}

	}
	const dependenciesById = new Map();
	for ( const [ index, dependency ] of graph.dependencies.entries() ) {

		const label = `physicsGraph.dependencies[${ index }]`;
		requireAbiRecord( dependency, 'PhysicsDependency', label );
		requireAbiEnum( dependency.kind, 'barrierKinds', `${ label}.kind` );
		assert.notEqual( dependency.kind, 'none', `${ label} cannot omit ordering for a consumed produced state version` );
		assert.ok( stagesById.has( dependency.producerStageId ) && stagesById.has( dependency.consumerStageId ), `${ label} references unknown stages` );
		assert.ok( ! dependenciesById.has( dependency.dependencyId ), `${ label} duplicates dependencyId` );
		dependenciesById.set( dependency.dependencyId, dependency );

	}
	const readEdgeCount = new Map();
	const predecessors = new Map( [ ...stagesById.keys() ].map( ( stageId ) => [ stageId, [] ] ) );
	const edgeIds = new Set();
	const edgeDependencyIds = new Set();
	for ( const [ index, edge ] of graph.edges.entries() ) {

		const label = `physicsGraph.edges[${ index }]`;
		requireAbiRecord( edge, 'PhysicsGraphEdge', label );
		assert.ok( ! edgeIds.has( edge.edgeId ), `${ label} duplicates edgeId` );
		edgeIds.add( edge.edgeId );
		const producer = stagesById.get( edge.producerStageId );
		const consumer = stagesById.get( edge.consumerStageId );
		assert.ok( producer && consumer, `${ label} references unknown stages` );
		validateSchemaSubset( edge.payload, physicsAbiSchema.$defs.PhysicsGraphEdgePayload, physicsAbiSchema, `${ label}.payload` );
		assert.equal( edge.payload.kind, 'state-version-ref', `${ label}.payload must carry a state-version reference` );
		assert.equal( edge.payload.signalId, edge.requiredVersionAndPhase.signalId, `${ label}.payload signal does not match its version-and-phase requirement` );
		assert.ok( stageKinds.indexOf( producer.stageKind ) <= stageKinds.indexOf( consumer.stageKind ), `${ label} violates stage partial order` );
		const producerWrite = producer.writes.find( ( write ) => write.signalId === edge.requiredVersionAndPhase.signalId );
		const consumerRead = consumer.reads.find( ( read ) => read.signalId === edge.requiredVersionAndPhase.signalId && read.samplePhase === edge.requiredVersionAndPhase.samplePhase );
		assert.ok( producerWrite, `${ label} has no matching producer write` );
		assert.ok( consumerRead, `${ label} has no matching consumer read` );
		assert.equal( consumerRead.requiredDisposition, edge.requiredVersionAndPhase.disposition, `${ label} read disposition mismatch` );
		assert.equal( consumerRead.requiredStateVersionRule, consumerRead.requiredDisposition === 'loop-provisional' ? 'loop-seed-or-prior-iteration' : 'exact-named-version', `${ label} uses the wrong canonical read-version rule` );
		requireAbiRecord( edge.barrier, 'PhysicsDependencyRef', `${ label}.barrier` );
		const dependency = dependenciesById.get( edge.barrier.dependencyId );
		assert.ok( dependency, `${ label} has no dependency template` );
		assert.ok( ! edgeDependencyIds.has( edge.barrier.dependencyId ), `${ label} reuses a dependency template` );
		edgeDependencyIds.add( edge.barrier.dependencyId );
		assert.deepEqual( [ dependency.producerStageId, dependency.consumerStageId ], [ edge.producerStageId, edge.consumerStageId ], `${ label} dependency template stage mismatch` );
		assert.equal( consumerRead.dependencyId, dependency.dependencyId, `${ label} read does not bind its dependency` );
		readEdgeCount.set( consumerRead.readId, ( readEdgeCount.get( consumerRead.readId ) ?? 0 ) + 1 );
		predecessors.get( consumer.stageId ).push( producer.stageId );

	}
	assert.deepEqual( [ ...edgeDependencyIds ].sort(), [ ...dependenciesById.keys() ].sort(), 'physicsGraph contains an unused or missing dependency template' );
	for ( const { read } of readsById.values() ) assert.equal( readEdgeCount.get( read.readId ), 1, `stage read ${ read.readId } must have exactly one edge` );
	const pendingStages = new Set( stagesById.keys() );
	const completedStages = new Set();
	while ( pendingStages.size > 0 ) {

		const ready = [ ...pendingStages ].filter( ( stageId ) => predecessors.get( stageId ).every( ( predecessor ) => completedStages.has( predecessor ) ) );
		assert.ok( ready.length > 0, 'physicsGraph outer graph contains a cycle' );
		for ( const stageId of ready ) { pendingStages.delete( stageId ); completedStages.add( stageId ); }

	}
	const ledger = requireAbiRecord( graph.executionLedger, 'PhysicsExecutionLedger', 'physicsGraph.executionLedger' );
	assert.deepEqual( [ ledger.graphId, ledger.coordinationAdvanceId, canonicalIntervalIdentity( ledger.coordinationInterval ) ], [ graph.graphId, graph.coordinationAdvance.coordinationAdvanceId, canonicalIntervalIdentity( graph.coordinationInterval ) ], 'physicsGraph.executionLedger identity mismatch' );
	const acceptedIterationByLoop = new Map( graph.loopMacros.map( ( loop ) => [ loop.loopId, loop.acceptedIterationIndex ] ) );
	const instantiateExecutionVersion = ( edge, execution ) => {

		const template = edge.requiredVersionAndPhase.stateVersionRule;
		let producerExecutions = ledger.stageExecutions.filter( ( row ) => row.stageId === edge.producerStageId );
		if ( ! isTypedAbsence( execution.iterationIndex ) && producerExecutions.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) producerExecutions = producerExecutions.filter( ( row ) => row.iterationIndex === execution.iterationIndex );
		else if ( producerExecutions.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) producerExecutions = producerExecutions.filter( ( row ) => acceptedIterationByLoop.get( row.couplingLoopId ) === row.iterationIndex );
		if ( ! isTypedAbsence( execution.subcycleIndex ) && producerExecutions.some( ( row ) => ! isTypedAbsence( row.subcycleIndex ) ) ) producerExecutions = producerExecutions.filter( ( row ) => row.subcycleIndex === execution.subcycleIndex );
		const producerExecution = producerExecutions.sort( ( a, b ) => a.executionSequence - b.executionSequence ).at( - 1 );
		assert.ok( producerExecution, `version template ${ template } has no activated producer execution` );
		let iterationIndex = execution.iterationIndex;
		if ( isTypedAbsence( iterationIndex ) ) iterationIndex = producerExecution.iterationIndex;
		assert.ok( ! template.includes( '{i}' ) || ! isTypedAbsence( iterationIndex ), `version template ${ template } requires an unresolved coupling-loop iteration` );
		assert.ok( ! template.includes( '{s}' ) || ! isTypedAbsence( producerExecution.subcycleIndex ), `version template ${ template } requires an unresolved native-subcycle index` );
		return template.replaceAll( '{i}', String( iterationIndex ) ).replaceAll( '{s}', String( producerExecution.subcycleIndex ) );

	};
	const executionsById = new Map();
	let priorExecutionSequence = - 1;
	for ( const [ index, execution ] of ledger.stageExecutions.entries() ) {

		const label = `physicsGraph.executionLedger.stageExecutions[${ index }]`;
		requireAbiRecord( execution, 'PhysicsStageExecution', label );
		assert.ok( ! executionsById.has( execution.executionId ), `${ label} duplicates executionId` );
		executionsById.set( execution.executionId, execution );
		assert.equal( execution.coordinationAdvanceId, graph.coordinationAdvance.coordinationAdvanceId, `${ label}.coordinationAdvanceId mismatch` );
		assert.ok( execution.executionSequence > priorExecutionSequence, `${ label}.executionSequence is not globally monotonic` );
		priorExecutionSequence = execution.executionSequence;
		const stage = stagesById.get( execution.stageId );
		assert.ok( stage, `${ label} references an unknown stage` );
		validateCanonicalInterval( execution.executionInterval, context, `${ label}.executionInterval` );
		assertIntervalContained( execution.executionInterval, stage.executionInterval, context, label );
		assert.equal( canonicalIntervalIdentity( execution.coordinationCoverageInterval ), canonicalIntervalIdentity( graph.coordinationInterval ), `${ label}.coordinationCoverageInterval mismatch` );
		assert.equal( execution.status, 'completed', `${ label} is not completed` );
		if ( stage.executionRule.activation === 'per-loop-iteration' ) {

			const loop = graph.loopMacros.find( ( candidate ) => candidate.loopId === execution.couplingLoopId );
			assert.ok( ! isTypedAbsence( execution.iterationIndex ) && loop?.orderedStageIds.includes( stage.stageId ), `${ label} lacks a registered loop activation identity` );
			assert.ok( execution.iterationIndex >= 0 && execution.iterationIndex < loop.perIterationLedger.length, `${ label} iteration index is outside its executed loop ledger` );

		}
		else assert.ok( isTypedAbsence( execution.iterationIndex ) && isTypedAbsence( execution.couplingLoopId ), `${ label} invents loop activation identity` );
		if ( stage.executionRule.partition === 'exact-subcycle-tile' ) assert.ok( Number.isSafeInteger( execution.subcycleIndex ), `${ label} lacks subcycle identity` );
		else assert.ok( isTypedAbsence( execution.subcycleIndex ), `${ label} invents a subcycle index` );
		assertUnique( execution.readResolutions.map( ( resolution ) => resolution.readId ), `${ label}.readResolutions` );
		assert.deepEqual( execution.readResolutions.map( ( resolution ) => resolution.readId ).sort(), stage.reads.map( ( read ) => read.readId ).sort(), `${ label} read-resolution closure mismatch` );
		for ( const resolution of execution.readResolutions ) {

			const read = stage.reads.find( ( candidate ) => candidate.readId === resolution.readId );
			const edge = graph.edges.find( ( candidate ) => candidate.consumerStageId === stage.stageId && candidate.requiredVersionAndPhase.signalId === read.signalId && candidate.requiredVersionAndPhase.samplePhase === read.samplePhase );
			assert.ok( edge, `${ label}.${ resolution.readId } has no exact edge` );
			assert.equal( resolution.stateVersion, instantiateExecutionVersion( edge, execution ), `${ label}.${ resolution.readId } resolves the wrong state version` );
			assert.deepEqual( resolution.requestedTime, read.requestedTime, `${ label}.${ resolution.readId } requested-time mismatch` );

		}
		assertUnique( execution.writeResolutions.map( ( resolution ) => resolution.writeId ), `${ label}.writeResolutions` );
		assert.deepEqual( execution.writeResolutions.map( ( resolution ) => resolution.writeId ).sort(), stage.writes.map( ( write ) => write.writeId ).sort(), `${ label} write-resolution closure mismatch` );
		for ( const resolution of execution.writeResolutions ) {

			const write = stage.writes.find( ( candidate ) => candidate.writeId === resolution.writeId );
			requireNonEmptyString( resolution.preparedVersion, `${ label}.${ resolution.writeId }.preparedVersion` );
			requireNonEmptyString( resolution.contentDigest, `${ label}.${ resolution.writeId }.contentDigest` );
			if ( write.disposition === 'loop-provisional' ) {

				assert.ok( ! isTypedAbsence( execution.couplingLoopId ) && Number.isSafeInteger( execution.iterationIndex ), `${ label}.${ resolution.writeId } lacks loop identity` );
				const loop = graph.loopMacros.find( ( candidate ) => candidate.loopId === execution.couplingLoopId );
				assert.ok( loop && resolution.preparedVersion.startsWith( `${ loop.provisionalVersionNamespace }/iteration-${ execution.iterationIndex }/` ), `${ label}.${ resolution.writeId } escapes its loop namespace/iteration` );
				if ( stage.executionRule.partition === 'exact-subcycle-tile' ) assert.ok( resolution.preparedVersion.endsWith( `/subcycle-${ execution.subcycleIndex }` ), `${ label}.${ resolution.writeId } subcycle version mismatch` );
				assert.ok( isTypedAbsence( write.commitGroupId ), `${ label}.${ resolution.writeId } provisional write binds a commit group before acceptance` );

			} else {

				const group = graph.commitGroups.find( ( candidate ) => candidate.commitGroupId === write.commitGroupId );
				assert.ok( group, `${ label}.${ resolution.writeId } references unknown commit group` );
				const matchingPublications = group.preparedPublications.filter( ( publication ) => publication.signalOrStateEquationId === write.signalId );
				assert.equal( matchingPublications.length, 1, `${ label}.${ resolution.writeId } does not resolve exactly one prepared publication` );
				const allowedVersions = [ matchingPublications[ 0 ].provisionalVersion.stateVersion, matchingPublications[ 0 ].preparedVersion.stateVersion ];
				assert.ok( allowedVersions.includes( resolution.preparedVersion ), `${ label}.${ resolution.writeId } version is outside its prepared-publication lineage` );

			}

		}

	}
	assert.deepEqual( [ ...new Set( ledger.stageExecutions.map( ( execution ) => execution.stageId ) ) ].sort(), [ ...stagesById.keys() ].sort(), 'execution ledger omits a stage' );
	for ( const stage of graph.stages ) {

		const rows = ledger.stageExecutions.filter( ( execution ) => execution.stageId === stage.stageId );
		const activationGroups = new Map();
		for ( const row of rows ) {

			const key = stage.executionRule.activation === 'per-loop-iteration' ? `iteration-${ row.iterationIndex }` : stage.executionRule.activation;
			if ( ! activationGroups.has( key ) ) activationGroups.set( key, [] );
			activationGroups.get( key ).push( row );

		}
		assert.ok( activationGroups.size <= quantityValue( stage.executionRule.maximumActivationsPerAdvance, `${ stage.stageId}.maximumActivationsPerAdvance` ), `${ stage.stageId} exceeds activation bound` );
		for ( const [ activation, activationRows ] of activationGroups ) {

			assert.ok( activationRows.length <= quantityValue( stage.executionRule.maximumExecutionsPerActivation, `${ stage.stageId}.maximumExecutionsPerActivation` ), `${ stage.stageId}/${ activation} exceeds execution bound` );
			if ( stage.executionRule.partition === 'exact-subcycle-tile' ) {

				activationRows.sort( ( a, b ) => a.subcycleIndex - b.subcycleIndex );
				assert.deepEqual( activationRows.map( ( row ) => row.subcycleIndex ), activationRows.map( ( _, index ) => index ), `${ stage.stageId}/${ activation} subcycles are not contiguous` );
				const stageBounds = intervalBoundsSeconds( stage.executionInterval, context, `${ stage.stageId}.interval` );
				const rowBounds = activationRows.map( ( row, index ) => intervalBoundsSeconds( row.executionInterval, context, `${ stage.stageId}.${ activation}[${ index }]` ) );
				assert.ok( Math.abs( rowBounds[ 0 ][ 0 ] - stageBounds[ 0 ] ) <= 1e-12 && Math.abs( rowBounds.at( - 1 )[ 1 ] - stageBounds[ 1 ] ) <= 1e-12, `${ stage.stageId}/${ activation} does not cover its exact interval` );
				for ( let index = 1; index < rowBounds.length; index ++ ) assert.ok( Math.abs( rowBounds[ index - 1 ][ 1 ] - rowBounds[ index ][ 0 ] ) <= 1e-12, `${ stage.stageId}/${ activation} has a gap or double-step overlap` );

			} else assert.equal( activationRows.length, 1, `${ stage.stageId}/${ activation} must execute exactly once` );

		}

	}
	const executionsByStageId = new Map( [ ...stagesById.keys() ].map( ( stageId ) => [ stageId, ledger.stageExecutions.filter( ( execution ) => execution.stageId === stageId ).sort( ( a, b ) => a.executionSequence - b.executionSequence ) ] ) );
	const expectedCompletionInstances = new Map();
	for ( const edge of graph.edges ) for ( const consumerExecution of executionsByStageId.get( edge.consumerStageId ) ) {

		const consumerIteration = isTypedAbsence( consumerExecution.iterationIndex ) ? null : consumerExecution.iterationIndex;
		let candidates = executionsByStageId.get( edge.producerStageId );
		if ( consumerIteration !== null && candidates.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) candidates = candidates.filter( ( row ) => row.iterationIndex === consumerIteration );
		else if ( consumerIteration === null && candidates.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) candidates = candidates.filter( ( row ) => acceptedIterationByLoop.get( row.couplingLoopId ) === row.iterationIndex );
		if ( ! isTypedAbsence( consumerExecution.subcycleIndex ) && candidates.some( ( row ) => ! isTypedAbsence( row.subcycleIndex ) ) ) candidates = candidates.filter( ( row ) => row.subcycleIndex === consumerExecution.subcycleIndex );
		const producerExecution = candidates.at( - 1 );
		assert.ok( producerExecution, `dependency ${ edge.barrier.dependencyId } has no activated producer for ${ consumerExecution.executionId}` );
		const identity = `${ edge.barrier.dependencyId }|${ producerExecution.executionId }|${ consumerExecution.executionId }`;
		expectedCompletionInstances.set( identity, { edge, producerExecution, consumerExecution } );

	}
	const completionsById = new Map();
	const observedCompletionInstances = new Set();
	const dependencyGenerationByDevice = new Map();
	for ( const [ index, completion ] of ledger.dependencyCompletions.entries() ) {

		const label = `physicsGraph.executionLedger.dependencyCompletions[${ index }]`;
		requireAbiRecord( completion, 'PhysicsDependencyCompletion', label );
		assert.ok( ! completionsById.has( completion.completionId ), `${ label} duplicates completionId` );
		completionsById.set( completion.completionId, completion );
		const dependency = dependenciesById.get( completion.dependencyId );
		const producer = executionsById.get( completion.producerExecutionId );
		const consumer = executionsById.get( completion.consumerExecutionId );
		assert.ok( dependency && producer && consumer, `${ label} has unresolved template/executions` );
		assert.deepEqual( [ producer.stageId, consumer.stageId ], [ dependency.producerStageId, dependency.consumerStageId ], `${ label} execution pair violates dependency template` );
		const identity = `${ completion.dependencyId }|${ completion.producerExecutionId }|${ completion.consumerExecutionId }`;
		const expected = expectedCompletionInstances.get( identity );
		assert.ok( expected, `${ label} is not an activated dependency instance` );
		assert.ok( ! observedCompletionInstances.has( identity ), `${ label} duplicates an activated dependency instance` );
		observedCompletionInstances.add( identity );
		assert.deepEqual( completion.payloadAndVersion, { signalId: expected.edge.requiredVersionAndPhase.signalId, stateVersionRule: expected.edge.requiredVersionAndPhase.stateVersionRule }, `${ label}.payloadAndVersion mismatch` );
		assert.deepEqual( completion.producerResidency, stagesById.get( producer.stageId ).executionResidency, `${ label}.producerResidency mismatch` );
		assert.deepEqual( completion.consumerResidency, stagesById.get( consumer.stageId ).executionResidency, `${ label}.consumerResidency mismatch` );
		if ( isTypedAbsence( completion.deviceBackendResourceGenerations ) ) {

			assert.ok( isTypedAbsence( completion.producerResidency.deviceId ) && isTypedAbsence( completion.consumerResidency.deviceId ), `${ label} omits generations for a device-backed dependency` );

		} else {

			for ( const generationKey of [ 'deviceId', 'backendGeneration', 'deviceLossGeneration' ] ) requireNonEmptyString( completion.deviceBackendResourceGenerations[ generationKey ], `${ label}.deviceBackendResourceGenerations.${ generationKey}` );
			const endpointDeviceIds = [ completion.producerResidency.deviceId, completion.consumerResidency.deviceId ].filter( ( deviceId ) => ! isTypedAbsence( deviceId ) );
			assert.ok( endpointDeviceIds.length > 0, `${ label} invents device generations for a host-only dependency` );
			assert.ok( endpointDeviceIds.includes( completion.deviceBackendResourceGenerations.deviceId ), `${ label}.deviceId does not identify a device-backed endpoint` );
			const generationIdentity = `${ completion.deviceBackendResourceGenerations.backendGeneration }|${ completion.deviceBackendResourceGenerations.deviceLossGeneration }`;
			const priorGenerationIdentity = dependencyGenerationByDevice.get( completion.deviceBackendResourceGenerations.deviceId );
			if ( priorGenerationIdentity !== undefined ) assert.equal( generationIdentity, priorGenerationIdentity, `${ label}.device/backend/loss generation mismatch within one coordination advance` );
			else dependencyGenerationByDevice.set( completion.deviceBackendResourceGenerations.deviceId, generationIdentity );

		}
		assert.equal( completion.producerRelease.completionToken, producer.completionReceiptDigest, `${ label}.producer release token mismatch` );
		assert.equal( completion.consumerAcquire.waitToken, producer.completionReceiptDigest, `${ label}.consumer acquire token mismatch` );
		assert.equal( completion.consumerAcquire.firstUse, consumer.executionId, `${ label}.consumer first-use mismatch` );
		assert.equal( completion.status, 'completed', `${ label} is not completed` );

	}
	assert.deepEqual( [ ...observedCompletionInstances ].sort(), [ ...expectedCompletionInstances.keys() ].sort(), 'dependency completion ledger omits or invents activated instances' );
	for ( const execution of ledger.stageExecutions ) for ( const ref of execution.dependencyCompletions ) {

		requireAbiRecord( ref, 'PhysicsDependencyCompletionRef', `execution ${ execution.executionId} dependency ref` );
		const completion = completionsById.get( ref.completionId );
		assert.ok( completion && completion.consumerExecutionId === execution.executionId && completion.dependencyId === ref.dependencyId && completion.receiptDigest === ref.receiptDigest, `execution ${ execution.executionId} has a stale dependency completion ref` );

	}
	for ( const execution of ledger.stageExecutions ) {

		assertUnique( execution.dependencyCompletions.map( ( ref ) => ref.completionId ), `execution ${ execution.executionId } dependency-completion refs` );
		assert.deepEqual( execution.dependencyCompletions.map( ( ref ) => ref.completionId ).sort(), ledger.dependencyCompletions.filter( ( completion ) => completion.consumerExecutionId === execution.executionId ).map( ( completion ) => completion.completionId ).sort(), `execution ${ execution.executionId } dependency-completion reverse closure mismatch` );

	}
	const claimsById = new Map();
	const advanceKeys = new Set();
	const stateAdvanceIntervals = new Set();
	for ( const [ index, claim ] of ledger.stateAdvanceClaims.entries() ) {

		const label = `physicsGraph.executionLedger.stateAdvanceClaims[${ index }]`;
		requireAbiRecord( claim, 'StateAdvanceClaim', label );
		assert.ok( ! claimsById.has( claim.claimId ), `${ label} duplicates claimId` );
		claimsById.set( claim.claimId, claim );
		assert.ok( ! advanceKeys.has( claim.exactOnceAdvanceKey ), `${ label} duplicates exactOnceAdvanceKey` );
		advanceKeys.add( claim.exactOnceAdvanceKey );
		assert.deepEqual( [ claim.contextId, claim.coordinationAdvanceId ], [ context.contextId, graph.coordinationAdvance.coordinationAdvanceId ], `${ label} context/advance mismatch` );
		assertUnique( claim.nativeExecutionIds, `${ label}.nativeExecutionIds` );
		for ( const executionId of claim.nativeExecutionIds ) assert.ok( executionsById.has( executionId ), `${ label} references unknown native execution` );
		assert.ok( claim.nativeExecutionIds.every( ( executionId ) => stagesById.get( executionsById.get( executionId ).stageId ).owner === claim.owner ), `${ label} includes execution by another state-equation owner` );
		assert.equal( canonicalIntervalIdentity( claim.applicationInterval ), canonicalIntervalIdentity( graph.coordinationInterval ), `${ label} application interval mismatch` );
		assert.equal( claim.exactOnceAdvanceKey, `${ context.contextId }|${ graph.coordinationAdvance.coordinationAdvanceId }|${ claim.stateEquationId }|${ canonicalIntervalIdentity( claim.applicationInterval ) }`, `${ label}.exactOnceAdvanceKey mismatch` );
		assert.ok( claim.inputCommittedVersions.every( ( version ) => ! String( version.stateVersion ).includes( '/iteration-' ) && ! String( version.stateVersion ).endsWith( '/prepared' ) ), `${ label} consumes provisional/prepared state as committed input` );
		const equationOwnerGroups = graph.commitGroups.filter( ( group ) => group.stateEquationOwners[ claim.stateEquationId ] === claim.owner );
		assert.equal( equationOwnerGroups.length, 1, `${ label} state equation/owner does not resolve exactly one commit group` );
		const outputSignalId = claim.outputPreparedVersion.signalId;
		assert.ok( equationOwnerGroups[ 0 ].preparedPublications.some( ( publication ) => publication.signalOrStateEquationId === outputSignalId && [ publication.provisionalVersion.stateVersion, publication.preparedVersion.stateVersion ].includes( claim.outputPreparedVersion.stateVersion ) ), `${ label} output prepared version does not resolve its commit lineage` );
		if ( claim.kind === 'state-advance' ) {

			const identity = `${ claim.stateEquationId }|${ canonicalIntervalIdentity( claim.applicationInterval ) }`;
			assert.ok( ! stateAdvanceIntervals.has( identity ), `${ label} double-steps ${ identity }` );
			stateAdvanceIntervals.add( identity );

		}

	}
	for ( const execution of ledger.stageExecutions ) {

		assertUnique( execution.stateAdvanceClaimIds, `execution ${ execution.executionId } state-advance claims` );
		for ( const claimId of execution.stateAdvanceClaimIds ) assert.ok( claimsById.has( claimId ) && claimsById.get( claimId ).nativeExecutionIds.includes( execution.executionId ), `execution ${ execution.executionId} has an invalid state-advance claim` );
		assert.deepEqual( [ ...execution.stateAdvanceClaimIds ].sort(), ledger.stateAdvanceClaims.filter( ( claim ) => claim.nativeExecutionIds.includes( execution.executionId ) ).map( ( claim ) => claim.claimId ).sort(), `execution ${ execution.executionId } state-advance claim reverse closure mismatch` );

	}
	for ( const [ index, loop ] of graph.loopMacros.entries() ) {

		const label = `physicsGraph.loopMacros[${ index }]`;
		requireAbiRecord( loop, 'BoundedCouplingLoop', label );
		assert.equal( loop.coordinationAdvanceId, graph.coordinationAdvance.coordinationAdvanceId, `${ label}.coordinationAdvanceId mismatch` );
		assert.equal( canonicalIntervalIdentity( loop.couplingInterval ), canonicalIntervalIdentity( graph.coordinationInterval ), `${ label}.couplingInterval mismatch` );
		assert.ok( loop.perIterationLedger.length <= quantityValue( loop.iterationBound, `${ label}.iterationBound` ), `${ label}.executed iterations exceed iterationBound` );
		assertUnique( loop.orderedStageIds, `${ label}.orderedStageIds` );
		assert.deepEqual( loop.perIterationLedger.map( ( row ) => row.iterationIndex ), loop.perIterationLedger.map( ( _, iterationIndex ) => iterationIndex ), `${ label} iteration indices are not contiguous` );
		assert.equal( loop.perIterationLedger.filter( ( row ) => row.accepted ).length, 1, `${ label} must accept exactly one iterate` );
		const acceptedRow = loop.perIterationLedger.find( ( row ) => row.accepted );
		assert.equal( acceptedRow.iterationIndex, loop.acceptedIterationIndex, `${ label}.acceptedIterationIndex mismatch` );
		assert.equal( loop.acceptedIterationIndex, loop.perIterationLedger.length - 1, `${ label} canonical converged loop accepts before its final executed iteration` );
		assert.equal( loop.acceptedIteratePublication, 'atomic', `${ label} must publish its accepted iterate atomically` );
		assert.deepEqual( loop.perIterationLedger[ 0 ].inputVersions, loop.seedCommittedVersions, `${ label} iteration zero does not consume the exact committed seed set` );
		assert.equal( loop.residuals.length, loop.convergenceBounds.length, `${ label} residual/bound cardinality mismatch` );
		for ( let residualIndex = 0; residualIndex < loop.residuals.length; residualIndex ++ ) {

			const residual = loop.residuals[ residualIndex ];
			const bound = loop.convergenceBounds[ residualIndex ];
			assert.equal( residual.unit, bound.unit, `${ label} residual ${ residualIndex } and convergence bound use different units` );
			assert.ok( Math.abs( quantityValue( residual, `${ label}.residuals[${ residualIndex }]` ) ) <= quantityValue( bound, `${ label}.convergenceBounds[${ residualIndex }]` ), `${ label} residual ${ residualIndex } exceeds its convergence bound` );

		}
		for ( let iterationIndex = 1; iterationIndex < loop.perIterationLedger.length; iterationIndex ++ ) assert.deepEqual( loop.perIterationLedger[ iterationIndex ].inputVersions, loop.perIterationLedger[ iterationIndex - 1 ].outputVersions, `${ label} iteration ${ iterationIndex} does not consume the exact prior iterate` );
		assert.deepEqual( loop.acceptedWrites, acceptedRow.outputVersions, `${ label}.acceptedWrites do not equal the accepted row` );
		assertUnique( loop.acceptedWriteLineage.map( ( row ) => row.preparedPublicationId ), `${ label}.acceptedWriteLineage prepared IDs` );
		assert.deepEqual( loop.acceptedWriteLineage.map( ( row ) => row.provisionalVersion ), loop.acceptedWrites, `${ label}.acceptedWriteLineage is incomplete` );
		const preparedPublicationsById = new Map( graph.commitGroups.flatMap( ( group ) => group.preparedPublications ).map( ( publication ) => [ publication.preparedPublicationId, publication ] ) );
		for ( const lineage of loop.acceptedWriteLineage ) {

			assert.equal( lineage.loopId, loop.loopId, `${ label} accepted lineage loop mismatch` );
			assert.equal( lineage.acceptedIterationIndex, loop.acceptedIterationIndex, `${ label} accepted lineage iteration mismatch` );
			assert.equal( lineage.iterationOutputDigest, acceptedRow.outputContentDigest, `${ label} accepted lineage digest mismatch` );
			const prepared = preparedPublicationsById.get( lineage.preparedPublicationId );
			assert.ok( prepared, `${ label} accepted lineage references unknown prepared publication` );
			assert.deepEqual( lineage.preparedVersion, prepared.preparedVersion, `${ label} accepted lineage prepared version mismatch` );

		}
		for ( const row of loop.perIterationLedger ) {

			for ( const output of row.outputVersions ) assert.ok( output.stateVersion.startsWith( `${ loop.provisionalVersionNamespace }/iteration-${ row.iterationIndex }/` ), `${ label} iteration ${ row.iterationIndex } output escapes the provisional namespace` );
			assertUnique( row.stageExecutionIds, `${ label}.perIterationLedger[${ row.iterationIndex }].stageExecutionIds` );
			const exactIterationExecutionIds = ledger.stageExecutions.filter( ( execution ) => execution.couplingLoopId === loop.loopId && execution.iterationIndex === row.iterationIndex ).map( ( execution ) => execution.executionId ).sort();
			assert.deepEqual( [ ...row.stageExecutionIds ].sort(), exactIterationExecutionIds, `${ label} iteration ${ row.iterationIndex } stage-execution closure mismatch` );
			assert.deepEqual( [ ...new Set( row.stageExecutionIds.map( ( executionId ) => executionsById.get( executionId ).stageId ) ) ].sort(), [ ...loop.orderedStageIds ].sort(), `${ label} iteration ${ row.iterationIndex } stage coverage mismatch` );

		}
		assertUnique( loop.iterationCarriedEdges.map( ( edge ) => edge.edgeId ), `${ label}.iterationCarriedEdges` );
		for ( const edge of loop.iterationCarriedEdges ) {

			assert.deepEqual( [ edge.producedIterationOffset, edge.consumedIterationOffset ], [ 0, 1 ], `${ label} carried edge ${ edge.edgeId } has invalid iteration offsets` );
			assert.ok( loop.orderedStageIds.includes( edge.producerStageId ) && loop.orderedStageIds.includes( edge.consumerStageId ), `${ label} carried edge ${ edge.edgeId } references a stage outside the loop` );
			for ( let iterationIndex = 0; iterationIndex < loop.perIterationLedger.length - 1; iterationIndex ++ ) {

				const expectedVersion = edge.requiredProvisionalVersionPattern.replace( '{i}', String( iterationIndex ) );
				assert.ok( loop.perIterationLedger[ iterationIndex ].outputVersions.some( ( version ) => version.signalId === edge.signalOrExchangeId && version.stateVersion === expectedVersion ), `${ label} carried edge ${ edge.edgeId } producer version mismatch at iteration ${ iterationIndex}` );
				assert.ok( loop.perIterationLedger[ iterationIndex + 1 ].inputVersions.some( ( version ) => version.signalId === edge.signalOrExchangeId && version.stateVersion === expectedVersion ), `${ label} carried edge ${ edge.edgeId } consumer version mismatch at iteration ${ iterationIndex + 1}` );

			}

		}

	}
	const groupsById = new Map();
	const preparedById = new Map();
	const committedIdentities = new Set();
	for ( const [ index, group ] of graph.commitGroups.entries() ) {

		const label = `physicsGraph.commitGroups[${ index }]`;
		requireAbiRecord( group, 'PhysicsCommitGroup', label );
		assert.equal( group.atomicity, 'all-or-none', `${ label} must be atomic` );
		assert.ok( ! groupsById.has( group.commitGroupId ), `${ label} duplicates commitGroupId` );
		groupsById.set( group.commitGroupId, group );
		assert.equal( group.publicationLineage.length, group.committedPublications.length, `${ label} has incomplete publication lineage` );
		for ( const [ preparedIndex, prepared ] of group.preparedPublications.entries() ) {

			requireAbiRecord( prepared, 'PhysicsPreparedPublication', `${ label}.preparedPublications[${ preparedIndex }]` );
			assert.equal( prepared.commitGroupId, group.commitGroupId, `${ label} contains a prepared publication for another group` );
			assert.equal( prepared.visibility, 'transaction-private', `${ label} exposes prepared state` );
			assert.ok( ! preparedById.has( prepared.preparedPublicationId ), `${ label} duplicates preparedPublicationId` );
			preparedById.set( prepared.preparedPublicationId, prepared );

		}
		for ( const publication of group.committedPublications ) {

			const identity = `${ publication.signalId }@${ publication.stateVersion }`;
			assert.ok( ! committedIdentities.has( identity ), `${ label} duplicates committed publication ${ identity }` );
			committedIdentities.add( identity );
			assert.equal( group.stateEquationOwners[ publication.stateEquation ], signals[ publication.signalKey ].owner, `${ label} state-equation owner mismatch` );

		}
		for ( const [ lineageIndex, lineage ] of group.publicationLineage.entries() ) {

			requireAbiRecord( lineage, 'CommitPublicationLineage', `${ label}.publicationLineage[${ lineageIndex }]` );
			const prepared = group.preparedPublications.find( ( candidate ) => candidate.provisionalVersion.signalId === lineage.provisionalVersion.signalId && candidate.provisionalVersion.stateVersion === lineage.provisionalVersion.stateVersion );
			assert.ok( prepared, `${ label} lineage references unknown provisional version` );
			assert.deepEqual( [ lineage.contentDigest, lineage.ownerApproval ], [ prepared.contentDigest, prepared.ownerApproval ], `${ label} lineage content/owner approval mismatch` );
			assert.ok( group.committedPublications.some( ( publication ) => publication.signalId === lineage.committedVersion.signalId && publication.stateVersion === lineage.committedVersion.stateVersion ), `${ label} lineage committed version is not published` );

		}

	}
	const transactionsById = new Map();
	for ( const [ index, transaction ] of graph.commitTransactions.entries() ) {

		const label = `physicsGraph.commitTransactions[${ index }]`;
		requireAbiRecord( transaction, 'PhysicsCommitTransaction', label );
		assert.equal( transaction.contextId, context.contextId, `${ label}.contextId mismatch` );
		assert.equal( transaction.atomicPublicationProtocol, 'prepare-validate-single-registry-swap', `${ label} has a non-atomic publication protocol` );
		assert.equal( transaction.status, 'committed', `${ label} did not commit` );
		assert.deepEqual( [ ...transaction.commitGroupIds ].sort(), [ ...groupsById.keys() ].filter( ( id ) => groupsById.get( id ).commitTransactionId === transaction.commitTransactionId ).sort(), `${ label} commit-group closure mismatch` );
		assert.deepEqual( [ ...transaction.preparedPublicationIds ].sort(), [ ...preparedById.values() ].filter( ( prepared ) => transaction.commitGroupIds.includes( prepared.commitGroupId ) ).map( ( prepared ) => prepared.preparedPublicationId ).sort(), `${ label} prepared-publication closure mismatch` );
		const receipt = requireAbiRecord( transaction.receipt, 'PhysicsCommitReceipt', `${ label}.receipt` );
		assert.equal( receipt.status, 'committed', `${ label}.receipt is not committed` );
		assert.equal( receipt.receiptDigest, sha256CanonicalExcluding( receipt, [ 'receiptDigest' ] ), `${ label}.receipt digest mismatch` );
		assert.equal( receipt.commitTransactionId, transaction.commitTransactionId, `${ label}.receipt transaction mismatch` );
		assert.equal( receipt.publicationSetDigest, transaction.publicationSetDigest, `${ label}.receipt publication-set digest mismatch` );
		const exactTransactionPublications = transaction.commitGroupIds.flatMap( ( groupId ) => groupsById.get( groupId ).committedPublications.map( ( publication ) => ( { signalId: publication.signalId, stateVersion: publication.stateVersion } ) ) );
		assert.equal( transaction.publicationSetDigest, sha256Canonical( exactTransactionPublications ), `${ label}.publicationSetDigest is not canonical` );
		assert.deepEqual( receipt.committedPublications, exactTransactionPublications, `${ label}.receipt committed publication set/order is inexact` );
		assert.deepEqual( receipt.preparedToCommittedPublicationMap.map( ( row ) => row.preparedPublicationId ).sort(), transaction.preparedPublicationIds.slice().sort(), `${ label}.receipt prepared-to-committed map is incomplete` );
		for ( const row of receipt.preparedToCommittedPublicationMap ) {

			const prepared = preparedById.get( row.preparedPublicationId );
			assert.ok( prepared, `${ label}.receipt maps unknown prepared publication` );
			assert.deepEqual( row.preparedVersion, prepared.preparedVersion, `${ label}.receipt prepared version mismatch` );
			assert.ok( exactTransactionPublications.some( ( publication ) => publication.signalId === row.committedVersion.signalId && publication.stateVersion === row.committedVersion.stateVersion ), `${ label}.receipt committed mapping target is unpublished` );

		}
		transactionsById.set( transaction.commitTransactionId, transaction );

	}
	assert.deepEqual( ledger.commitReceipts, graph.commitTransactions.map( ( transaction ) => transaction.receipt ), 'execution ledger commit receipts do not exactly match transactions' );
	const advance = requireAbiRecord( graph.coordinationAdvance, 'PhysicsCoordinationAdvanceRecord', 'physicsGraph.coordinationAdvance' );
	assert.deepEqual( [ advance.graphId, advance.contextId, canonicalIntervalIdentity( advance.interval ), advance.status ], [ graph.graphId, context.contextId, canonicalIntervalIdentity( graph.coordinationInterval ), 'committed' ], 'coordination advance identity/status mismatch' );
	assert.deepEqual( [ ...advance.stageExecutionIds ].sort(), [ ...executionsById.keys() ].sort(), 'coordination advance stage-execution closure mismatch' );
	assert.deepEqual( [ ...advance.stateAdvanceClaimIds ].sort(), [ ...claimsById.keys() ].sort(), 'coordination advance state-claim closure mismatch' );
	assert.deepEqual( [ ...advance.commitTransactionIds ].sort(), [ ...transactionsById.keys() ].sort(), 'coordination advance commit-transaction closure mismatch' );
	assert.equal( advance.receiptDigest, sha256CanonicalExcluding( advance, [ 'receiptDigest' ] ), 'coordination advance receipt digest mismatch' );
	validateCatchUpSchedulerClosure( graph, context, advance, route, ledger );
	assert.equal( ledger.physicsCostLedgerId, route.physicsCostLedger.ledgerId, 'execution ledger does not bind the active cost ledger' );
	assert.deepEqual( Object.keys( route.physicsCommitTransactions ).sort(), [ ...transactionsById.keys() ].sort(), 'route commit-transaction inventory key closure mismatch' );
	for ( const [ transactionId, transaction ] of transactionsById ) assert.deepEqual( route.physicsCommitTransactions[ transactionId ], transaction, `route commit transaction ${ transactionId } differs from the graph transaction` );

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

function canonicalDurationSecondsValue( duration, context, label ) {

	validateCanonicalDuration( duration, context, label );
	if ( duration.kind === 'seconds' ) return quantityValue( duration.seconds, `${ label }.seconds` );
	return canonicalInstantSeconds( duration.clockSpan.endExclusive, context, `${ label }.clockSpan.endExclusive` ) - canonicalInstantSeconds( duration.clockSpan.start, context, `${ label }.clockSpan.start` );

}

function validateCatchUpSchedulerClosure( graph, context, advance, route, executionLedger ) {

	const policy = requireAbiRecord( graph.catchUpPolicy, 'PhysicsCatchUpPolicy', 'physicsGraph.catchUpPolicy' );
	requireNonEmptyString( policy.owner, 'physicsGraph.catchUpPolicy.owner' );
	assert.equal( policy.owner, graph.discontinuityPolicy.owner, 'catch-up and discontinuity policies have different coordinators' );
	canonicalClock( context, policy.debtClockId, 'physicsGraph.catchUpPolicy.debtClockId' );
	const maximumDebt = canonicalDurationSecondsValue( policy.maximumDebt, context, 'physicsGraph.catchUpPolicy.maximumDebt' );
	assert.ok( maximumDebt >= 0, 'catch-up policy maximum debt is negative' );
	const maximumAdvances = quantityValue( policy.maximumCoordinationAdvancesPerPresentationOpportunity, 'physicsGraph.catchUpPolicy.maximumCoordinationAdvancesPerPresentationOpportunity' );
	const maximumNativeExecutions = quantityValue( policy.maximumNativeExecutionsPerOpportunity, 'physicsGraph.catchUpPolicy.maximumNativeExecutionsPerOpportunity' );
	assert.ok( Number.isSafeInteger( maximumAdvances ) && maximumAdvances > 0, 'catch-up policy maximum coordination advances must be a positive integer' );
	assert.ok( Number.isSafeInteger( maximumNativeExecutions ) && maximumNativeExecutions > 0, 'catch-up policy maximum native executions must be a positive integer' );
	assert.ok( Array.isArray( policy.errorAndResourceGates ) && policy.errorAndResourceGates.length > 0, 'catch-up policy has no error/resource gates' );
	const advanceDebtBefore = canonicalDurationSecondsValue( advance.debtBefore, context, 'physicsGraph.coordinationAdvance.debtBefore' );
	const advanceDebtAfter = canonicalDurationSecondsValue( advance.debtAfter, context, 'physicsGraph.coordinationAdvance.debtAfter' );
	assert.ok( advanceDebtBefore >= 0 && advanceDebtAfter >= 0 && advanceDebtAfter <= maximumDebt, 'coordination advance debt violates the catch-up policy bound' );
	assert.deepEqual( executionLedger.catchUpDebtBeforeAfter, { before: advance.debtBefore, after: advance.debtAfter }, 'execution-ledger and coordination-advance catch-up debt endpoints differ' );
	assert.ok( Array.isArray( route.physicsCoordinationAdvanceRecords ) && route.physicsCoordinationAdvanceRecords.length > 0, 'route has no coordination-advance inventory' );
	const advancesById = new Map();
	for ( const [ index, record ] of route.physicsCoordinationAdvanceRecords.entries() ) {

		requireAbiRecord( record, 'PhysicsCoordinationAdvanceRecord', `physicsCoordinationAdvanceRecords[${ index }]` );
		assert.ok( ! advancesById.has( record.coordinationAdvanceId ), `duplicate route coordination advance ${ record.coordinationAdvanceId}` );
		assert.deepEqual( [ record.graphId, record.contextId ], [ graph.graphId, context.contextId ], `coordination advance ${ record.coordinationAdvanceId} graph/context mismatch` );
		validateCanonicalInterval( record.interval, context, `physicsCoordinationAdvanceRecords[${ index }].interval` );
		assert.equal( record.receiptDigest, sha256CanonicalExcluding( record, [ 'receiptDigest' ] ), `coordination advance ${ record.coordinationAdvanceId} receipt digest mismatch` );
		advancesById.set( record.coordinationAdvanceId, record );

	}
	assert.deepEqual( advancesById.get( advance.coordinationAdvanceId ), advance, 'route coordination-advance inventory differs from the graph advance' );
	if ( isTypedAbsence( graph.catchUpBatch ) ) {

		assert.ok( isTypedAbsence( advance.catchUpBatchId ), 'coordination advance references an absent catch-up batch' );
		return;

	}
	const batch = requireAbiRecord( graph.catchUpBatch, 'PhysicsCatchUpBatch', 'physicsGraph.catchUpBatch' );
	assert.deepEqual( [ batch.graphId, batch.contextId, batch.owner ], [ graph.graphId, context.contextId, policy.owner ], 'catch-up batch graph/context/owner mismatch' );
	assert.equal( advance.catchUpBatchId, batch.catchUpBatchId, 'coordination advance references another catch-up batch' );
	assertUnique( batch.coordinationAdvanceIds, 'physicsGraph.catchUpBatch.coordinationAdvanceIds' );
	assert.ok( batch.coordinationAdvanceIds.length > 0 && batch.coordinationAdvanceIds.length <= maximumAdvances, 'catch-up batch exceeds the policy advance-count bound' );
	assert.ok( batch.coordinationAdvanceIds.includes( advance.coordinationAdvanceId ), 'catch-up batch omits the serialized coordination advance' );
	const batchAdvances = batch.coordinationAdvanceIds.map( ( advanceId ) => {

		const record = advancesById.get( advanceId );
		assert.ok( record, `catch-up batch references unknown coordination advance ${ advanceId}` );
		assert.equal( record.catchUpBatchId, batch.catchUpBatchId, `coordination advance ${ advanceId} references another catch-up batch` );
		return record;

	} );
	const currentNativeExecutionIds = executionLedger.stageExecutions.map( ( execution ) => execution.executionId );
	assertUnique( currentNativeExecutionIds, 'physicsGraph.executionLedger catch-up native-execution IDs' );
	assert.ok( executionLedger.stageExecutions.every( ( execution ) => execution.coordinationAdvanceId === advance.coordinationAdvanceId ), 'execution ledger mixes native executions from different coordination advances' );
	assert.deepEqual( [ ...advance.stageExecutionIds ].sort(), [ ...currentNativeExecutionIds ].sort(), 'serialized coordination advance native-execution closure differs from the execution ledger' );
	const batchNativeExecutionIds = new Set();
	let batchNativeExecutionCount = 0;
	for ( const record of batchAdvances ) {

		assertUnique( record.stageExecutionIds, `coordination advance ${ record.coordinationAdvanceId} native-execution IDs` );
		batchNativeExecutionCount += record.stageExecutionIds.length;
		for ( const executionId of record.stageExecutionIds ) {

			assert.ok( ! batchNativeExecutionIds.has( executionId ), `catch-up native execution ${ executionId} belongs to more than one coordination advance` );
			batchNativeExecutionIds.add( executionId );

		}

	}
	assert.equal( batchNativeExecutionCount, batchNativeExecutionIds.size, 'catch-up batch native-execution cardinality is not the exact sum of its advances' );
	assert.ok( batchNativeExecutionCount <= maximumNativeExecutions, 'catch-up batch exceeds the policy native-execution bound' );
	assert.equal( batch.debtIdentity.graphId, graph.graphId, 'catch-up debt identity references another graph' );
	assert.equal( batch.debtIdentity.debtClockId, policy.debtClockId, 'catch-up debt identity uses another debt clock' );
	assert.equal( batch.debtIdentity.policyRevision, batch.policyRevision, 'catch-up batch/debt policy revisions differ' );
	canonicalInstantSeconds( batch.debtIdentity.observedAt, context, 'physicsGraph.catchUpBatch.debtIdentity.observedAt' );
	assert.equal( batch.debtIdentity.observedAt.clockId, policy.debtClockId, 'catch-up debt observation uses another clock' );
	assert.ok( isPlainObject( batch.debtIdentity.sourceCursorBeforeAfter ) && Number.isSafeInteger( batch.debtIdentity.sourceCursorBeforeAfter.before ) && Number.isSafeInteger( batch.debtIdentity.sourceCursorBeforeAfter.after ) && batch.debtIdentity.sourceCursorBeforeAfter.after >= batch.debtIdentity.sourceCursorBeforeAfter.before, 'catch-up debt identity cursor is not monotonic' );
	assert.equal( batch.admittedAdvanceIntervals.length, batch.coordinationAdvanceIds.length, 'catch-up batch advance interval/ID cardinality mismatch' );
	let priorEnd = - Infinity;
	let committedDurationFromIntervals = 0;
	for ( const [ index, interval ] of batch.admittedAdvanceIntervals.entries() ) {

		validateCanonicalInterval( interval, context, `physicsGraph.catchUpBatch.admittedAdvanceIntervals[${ index }]` );
		const bounds = intervalBoundsSeconds( interval, context, `physicsGraph.catchUpBatch.admittedAdvanceIntervals[${ index }]` );
		assert.ok( bounds[ 0 ] >= priorEnd - 1e-12, 'catch-up batch admitted advance intervals overlap or are out of order' );
		priorEnd = bounds[ 1 ];
		committedDurationFromIntervals += bounds[ 1 ] - bounds[ 0 ];
		assert.equal( canonicalIntervalIdentity( interval ), canonicalIntervalIdentity( batchAdvances[ index ].interval ), `catch-up batch interval ${ index} does not match coordination advance ${ batchAdvances[ index ].coordinationAdvanceId}` );

	}
	const debtBefore = canonicalDurationSecondsValue( batch.debtBefore, context, 'physicsGraph.catchUpBatch.debtBefore' );
	const elapsedDuringBatch = canonicalDurationSecondsValue( batch.elapsedDuringBatch, context, 'physicsGraph.catchUpBatch.elapsedDuringBatch' );
	const committedAdvanceDuration = canonicalDurationSecondsValue( batch.committedAdvanceDuration, context, 'physicsGraph.catchUpBatch.committedAdvanceDuration' );
	const explicitlyDroppedDuration = canonicalDurationSecondsValue( batch.explicitlyDroppedDuration, context, 'physicsGraph.catchUpBatch.explicitlyDroppedDuration' );
	const debtAfter = canonicalDurationSecondsValue( batch.debtAfter, context, 'physicsGraph.catchUpBatch.debtAfter' );
	for ( const [ label, value ] of Object.entries( { debtBefore, elapsedDuringBatch, committedAdvanceDuration, explicitlyDroppedDuration, debtAfter } ) ) assert.ok( value >= 0, `catch-up batch ${ label } is negative` );
	const tolerance = 1e-12 * Math.max( 1, debtBefore, elapsedDuringBatch, committedAdvanceDuration, explicitlyDroppedDuration, debtAfter );
	assert.ok( Math.abs( committedDurationFromIntervals - committedAdvanceDuration ) <= tolerance, 'catch-up batch committed duration differs from its admitted intervals' );
	assert.ok( Math.abs( debtAfter - ( debtBefore + elapsedDuringBatch - committedAdvanceDuration - explicitlyDroppedDuration ) ) <= tolerance, 'catch-up debt equation does not close' );
	assert.ok( debtAfter <= maximumDebt, 'catch-up batch debt exceeds the policy maximum' );
	if ( batch.coordinationAdvanceIds.length === 1 ) assert.ok( Math.abs( advanceDebtBefore - debtBefore ) <= tolerance && Math.abs( advanceDebtAfter - debtAfter ) <= tolerance, 'single-advance catch-up batch debt endpoints disagree with the coordination advance' );
	assert.equal( batch.status, advance.status === 'committed' ? 'completed' : batch.status, 'committed coordination advance belongs to an incomplete catch-up batch' );
	assert.ok( Array.isArray( batch.errorResourceAndExecutionGateResults ) && batch.errorResourceAndExecutionGateResults.length > 0, 'catch-up batch has no gate results' );
	assert.ok( batch.errorResourceAndExecutionGateResults.every( ( gate ) => gate === 'accepted' || gate?.status === 'accepted' ), 'catch-up batch contains a rejected or implicit gate result' );
	if ( explicitlyDroppedDuration <= tolerance ) {

		assert.ok( isTypedAbsence( batch.lossLedger ), 'zero-drop catch-up batch invents a loss ledger' );

	} else {

		assert.equal( policy.debtDisposition, 'drop-with-loss-ledger', 'catch-up batch drops time under a non-drop policy' );
		assert.equal( policy.discontinuityOnDrop, 'required', 'catch-up drop does not require a discontinuity' );
		const loss = requireAbiRecord( batch.lossLedger, 'PhysicsCatchUpLossLedger', 'physicsGraph.catchUpBatch.lossLedger' );
		assert.equal( loss.debtIdentityId, batch.debtIdentity.debtIdentityId, 'catch-up loss ledger references another debt identity' );
		let droppedDurationFromIntervals = 0;
		let priorDroppedEnd = - Infinity;
		for ( const [ index, interval ] of loss.droppedIntervals.entries() ) {

			validateCanonicalInterval( interval, context, `physicsGraph.catchUpBatch.lossLedger.droppedIntervals[${ index }]` );
			const bounds = intervalBoundsSeconds( interval, context, `physicsGraph.catchUpBatch.lossLedger.droppedIntervals[${ index }]` );
			assert.ok( bounds[ 0 ] >= priorDroppedEnd - 1e-12, 'catch-up loss intervals overlap or are out of order' );
			priorDroppedEnd = bounds[ 1 ];
			droppedDurationFromIntervals += bounds[ 1 ] - bounds[ 0 ];

		}
		assert.ok( Math.abs( droppedDurationFromIntervals - explicitlyDroppedDuration ) <= tolerance, 'catch-up loss intervals do not equal the explicitly dropped duration' );
		for ( const dropped of loss.droppedIntervals ) {

			const droppedBounds = intervalBoundsSeconds( dropped, context, 'physicsGraph.catchUpBatch.lossLedger.droppedIntervals' );
			for ( const admitted of batch.admittedAdvanceIntervals ) {

				const admittedBounds = intervalBoundsSeconds( admitted, context, 'physicsGraph.catchUpBatch.admittedAdvanceIntervals' );
				assert.ok( droppedBounds[ 1 ] <= admittedBounds[ 0 ] || droppedBounds[ 0 ] >= admittedBounds[ 1 ], 'catch-up dropped interval overlaps an admitted advance interval' );

			}

		}
		assert.ok( isPlainObject( loss.discontinuityEpochBeforeAfter ) && loss.discontinuityEpochBeforeAfter.before !== loss.discontinuityEpochBeforeAfter.after, 'catch-up loss ledger does not advance the discontinuity epoch' );
		assert.ok( loss.resetActions.length > 0, 'catch-up loss ledger has no reset actions' );
		assert.equal( loss.contentDigest, sha256CanonicalExcluding( loss, [ 'contentDigest' ] ), 'catch-up loss-ledger digest mismatch' );

	}
	assert.equal( batch.receiptDigest, sha256CanonicalExcluding( batch, [ 'receiptDigest' ] ), 'catch-up batch receipt digest mismatch' );

}

function canonicalInstantIdentity( instant ) {

	return `${ instant.clockId }:${ instant.tick }+${ instant.rationalSubstep.numerator }/${ instant.rationalSubstep.denominator }@${ instant.clockMappingRevision }#${ instant.discontinuityEpoch }`;

}

function canonicalIntervalIdentity( interval ) {

	return `[${ canonicalInstantIdentity( interval.start ) },${ canonicalInstantIdentity( interval.endExclusive ) })`;

}

function physicalVec3( value, impliedUnit, label ) {

	assert.ok( Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite ), `${ label } must be a finite Vec3 in ${ impliedUnit }` );
	return value;

}

function addVector( target, value ) {

	for ( let i = 0; i < 3; i ++ ) target[ i ] += value[ i ];

}

const conservationCommoditySpecs = Object.freeze( {
	'mass': Object.freeze( { ledgerKey: 'massKg', shape: 'scalar', unit: 'kilogram' } ),
	'linear-momentum': Object.freeze( { ledgerKey: 'linearMomentumNs', shape: 'vec3', unit: 'newton-second' } ),
	'angular-momentum': Object.freeze( { ledgerKey: 'angularMomentumNms', shape: 'vec3', unit: 'newton-metre-second' } ),
	'energy': Object.freeze( { ledgerKey: 'energyJ', shape: 'scalar', unit: 'joule' } ),
	'species': Object.freeze( { ledgerKey: 'speciesPhaseMassKg', shape: 'mapping', unit: 'kilogram' } )
} );

function finiteConservationScalar( value, spec, label ) {

	if ( typeof value === 'number' ) {

		assert.ok( Number.isFinite( value ), `${ label } must be finite` );
		return value;

	}
	assertInlineNumericEvidenceObject( value, label );
	assert.equal( value.unit, spec.unit, `${ label } has unit ${ value.unit }, expected ${ spec.unit }` );
	assert.ok( Number.isFinite( value.value ), `${ label }.value must be finite` );
	return value.value;

}

function conservationValue( value, spec, label ) {

	if ( spec.shape === 'scalar' ) return finiteConservationScalar( value, spec, label );
	if ( spec.shape === 'vec3' ) return [ ...physicalVec3( value, spec.unit, label ) ];
	requireNonEmptyMapping( value, label );
	return Object.fromEntries( Object.entries( value ).map( ( [ key, scalar ] ) => [ key, finiteConservationScalar( scalar, spec, `${ label }.${ key}` ) ] ) );

}

function zeroConservationValue( spec, exemplar ) {

	if ( spec.shape === 'scalar' ) return 0;
	if ( spec.shape === 'vec3' ) return [ 0, 0, 0 ];
	return Object.fromEntries( Object.keys( exemplar ).map( ( key ) => [ key, 0 ] ) );

}

function assertConservationShape( value, exemplar, spec, label ) {

	if ( spec.shape === 'mapping' ) assert.deepEqual( Object.keys( value ).sort(), Object.keys( exemplar ).sort(), `${ label } species/phase key closure mismatch` );

}

function addConservationValue( accumulator, value, spec, scale = 1 ) {

	if ( spec.shape === 'scalar' ) return accumulator + scale * value;
	if ( spec.shape === 'vec3' ) {

		for ( let axis = 0; axis < 3; axis ++ ) accumulator[ axis ] += scale * value[ axis ];
		return accumulator;

	}
	for ( const key of Object.keys( accumulator ) ) accumulator[ key ] += scale * value[ key ];
	return accumulator;

}

function conservationNorm( value, spec ) {

	if ( spec.shape === 'scalar' ) return Math.abs( value );
	if ( spec.shape === 'vec3' ) return Math.hypot( ...value );
	return Math.hypot( ...Object.values( value ) );

}

function conservationDifferenceNorm( actual, expected, spec ) {

	if ( spec.shape === 'scalar' ) return Math.abs( actual - expected );
	if ( spec.shape === 'vec3' ) return Math.hypot( ...actual.map( ( value, index ) => value - expected[ index ] ) );
	return Math.hypot( ...Object.keys( expected ).map( ( key ) => actual[ key ] - expected[ key ] ) );

}

function conservationRoundoffTolerance( values, spec ) {

	const scale = Math.max( 1, ...values.map( ( value ) => conservationNorm( value, spec ) ) );
	return Number.EPSILON * 64 * scale;

}

function payloadCommodityValue( payload, commodity, spec, exemplar, label ) {

	let value;
	if ( commodity === 'linear-momentum' ) value = payload.linearMomentumNs ?? payload.linearImpulseNs;
	else if ( commodity === 'angular-momentum' ) value = payload.angularMomentumNms ?? payload.angularImpulseNms;
	else if ( commodity === 'energy' ) value = payload.energyJ ?? payload.heatJ;
	else if ( commodity === 'species' ) value = payload.speciesPhaseMassKg;
	else if ( commodity === 'mass' ) {

		if ( payload.massKg !== undefined ) value = payload.massKg;
		else if ( isPlainObject( payload.speciesPhaseMassKg ) ) value = Object.values( payload.speciesPhaseMassKg ).reduce( ( sum, entry ) => sum + finiteConservationScalar( entry, spec, `${ label }.speciesPhaseMassKg` ), 0 );

	}
	if ( value === undefined ) return zeroConservationValue( spec, exemplar );
	const normalized = conservationValue( value, spec, label );
	assertConservationShape( normalized, exemplar, spec, label );
	return normalized;

}

function validateConservationResiduals( conservation, records, label = 'conservationGroup', exchangeMode = 'two-way-iterated' ) {

	requireAbiRecord( conservation, 'ConservationGroup', label );
	assert.ok( Array.isArray( conservation.commodities ) && conservation.commodities.length > 0, `${ label }.commodities must be nonempty` );
	assertUnique( conservation.commodities, `${ label }.commodities` );
	const commodityEntries = conservation.commodities.map( ( commodity ) => {

		const spec = conservationCommoditySpecs[ commodity ];
		assert.ok( spec, `${ label } declares unsupported commodity ${ commodity }` );
		return [ commodity, spec ];

	} );
	const ledgerKeys = commodityEntries.map( ( [ , spec ] ) => spec.ledgerKey );
	for ( const mapName of [ 'initialInventory', 'finalInventory', 'externalSources', 'boundaryFluxes', 'modeledConversions', 'numericalResidual', 'residualNorms', 'acceptanceBounds' ] ) {

		assert.ok( isPlainObject( conservation[ mapName ] ), `${ label }.${ mapName } must be a mapping` );
		assert.deepEqual( Object.keys( conservation[ mapName ] ).sort(), [ ...ledgerKeys ].sort(), `${ label }.${ mapName } commodity-key closure mismatch` );

	}
	assert.ok( isPlainObject( conservation.modeledDissipation ), `${ label }.modeledDissipation must be a mapping` );
	for ( const key of Object.keys( conservation.modeledDissipation ) ) assert.ok( ledgerKeys.includes( key ), `${ label }.modeledDissipation contains undeclared commodity key ${ key}` );
	const groupRecords = records.filter( ( record ) => record.conservationGroupIds.includes( conservation.conservationGroupId ) );
	assertUnique( groupRecords.map( ( record ) => record.interactionId ), `${ label } interaction IDs` );
	const recordById = new Map( groupRecords.map( ( record ) => [ record.interactionId, record ] ) );
	assert.ok( recordById.size > 0, `${ label } has no interaction records` );
	const expectedParticipants = exchangeMode === 'one-way' ? new Set( groupRecords.map( ( record ) => record.targetOwner ) ) : new Set( groupRecords.flatMap( ( record ) => [ record.sourceOwner, record.targetOwner ] ) );
	assertUnique( conservation.participants, `${ label }.participants` );
	assert.deepEqual( [ ...conservation.participants ].sort(), [ ...expectedParticipants ].sort(), `${ label } participant/owner closure mismatch` );
	const internalByInteractionId = conservation.modeledInternalTransfers?.byInteractionId;
	assert.ok( isPlainObject( internalByInteractionId ), `${ label }.modeledInternalTransfers.byInteractionId must be a mapping` );
	if ( exchangeMode === 'one-way' ) {

		assert.deepEqual( Object.keys( internalByInteractionId ), [], `${ label } one-way receiver ledger cannot classify prescribed ingress as an internal transfer` );

	} else {

		assert.deepEqual( Object.keys( internalByInteractionId ).sort(), [ ...recordById.keys() ].sort(), `${ label } internal-transfer interaction closure mismatch` );

	}
	const normalizedInitial = {};
	const internalSum = {};
	for ( const [ , spec ] of commodityEntries ) {

		const initial = conservationValue( conservation.initialInventory[ spec.ledgerKey ], spec, `${ label }.initialInventory.${ spec.ledgerKey }` );
		normalizedInitial[ spec.ledgerKey ] = initial;
		internalSum[ spec.ledgerKey ] = zeroConservationValue( spec, initial );

	}
	for ( const [ interactionId, transfer ] of Object.entries( internalByInteractionId ) ) {

		const record = recordById.get( interactionId );
		assert.ok( record, `${ label } contains an unbound internal transfer ${ interactionId}` );
		assert.deepEqual( Object.keys( transfer ).sort(), [ ...ledgerKeys ].sort(), `${ label }.modeledInternalTransfers.${ interactionId} commodity-key closure mismatch` );
		for ( const [ commodity, spec ] of commodityEntries ) {

			const key = spec.ledgerKey;
			const value = conservationValue( transfer[ key ], spec, `${ label }.modeledInternalTransfers.${ interactionId}.${ key}` );
			assertConservationShape( value, normalizedInitial[ key ], spec, `${ label }.modeledInternalTransfers.${ interactionId}.${ key}` );
			const applied = payloadCommodityValue( record.payload, commodity, spec, normalizedInitial[ key ], `${ label }.interactionPayload.${ interactionId}.${ key}` );
			assert.ok( conservationDifferenceNorm( value, applied, spec ) <= conservationRoundoffTolerance( [ value, applied ], spec ), `${ label } internal transfer ${ interactionId}.${ key} differs from its applied payload` );
			internalSum[ key ] = addConservationValue( internalSum[ key ], value, spec );

		}

	}
	for ( const [ , spec ] of commodityEntries ) {

		const key = spec.ledgerKey;
		const bound = conservation.acceptanceBounds[ key ];
		assertInlineNumericEvidenceObject( bound, `${ label }.acceptanceBounds.${ key}` );
		assert.equal( bound.unit, spec.unit, `${ label }.acceptanceBounds.${ key} has the wrong unit` );
		assert.equal( bound.label, 'Gated', `${ label }.acceptanceBounds.${ key} must be Gated` );
		assert.ok( bound.value >= 0, `${ label }.acceptanceBounds.${ key} must be nonnegative` );
		assert.ok( conservationNorm( internalSum[ key ], spec ) <= bound.value, `${ label } has a one-sided internal transfer for ${ key}` );

	}
	if ( exchangeMode === 'one-way' ) {

		for ( const [ commodity, spec ] of commodityEntries ) {

			const key = spec.ledgerKey;
			let prescribedIngress = zeroConservationValue( spec, normalizedInitial[ key ] );
			for ( const record of recordById.values() ) prescribedIngress = addConservationValue( prescribedIngress, payloadCommodityValue( record.payload, commodity, spec, normalizedInitial[ key ], `${ label }.prescribedIngress.${ record.interactionId}.${ key}` ), spec );
			const external = conservationValue( conservation.externalSources[ key ], spec, `${ label }.externalSources.${ key}` );
			assertConservationShape( external, normalizedInitial[ key ], spec, `${ label }.externalSources.${ key}` );
			assert.ok( conservationDifferenceNorm( external, prescribedIngress, spec ) <= conservationRoundoffTolerance( [ external, prescribedIngress ], spec ), `${ label } one-way external-source inventory differs from prescribed interaction ingress` );

		}

	}
	for ( const [ commodity, spec ] of commodityEntries ) {

		const key = spec.ledgerKey;
		const initial = normalizedInitial[ key ];
		const final = conservationValue( conservation.finalInventory[ key ], spec, `${ label }.finalInventory.${ key}` );
		const external = conservationValue( conservation.externalSources[ key ], spec, `${ label }.externalSources.${ key}` );
		const boundary = conservationValue( conservation.boundaryFluxes[ key ], spec, `${ label }.boundaryFluxes.${ key}` );
		const conversion = conservationValue( conservation.modeledConversions[ key ], spec, `${ label }.modeledConversions.${ key}` );
		const residual = conservationValue( conservation.numericalResidual[ key ], spec, `${ label }.numericalResidual.${ key}` );
		for ( const [ valueName, value ] of [ [ 'finalInventory', final ], [ 'externalSources', external ], [ 'boundaryFluxes', boundary ], [ 'modeledConversions', conversion ], [ 'numericalResidual', residual ] ] ) assertConservationShape( value, initial, spec, `${ label }.${ valueName}.${ key}` );
		let dissipation = zeroConservationValue( spec, initial );
		if ( Object.hasOwn( conservation.modeledDissipation, key ) ) {

			assert.ok( [ 'mass', 'energy', 'species' ].includes( commodity ), `${ label }.modeledDissipation.${ key} is not a nonnegative scalar/species sink` );
			dissipation = conservationValue( conservation.modeledDissipation[ key ], spec, `${ label }.modeledDissipation.${ key}` );
			assertConservationShape( dissipation, initial, spec, `${ label }.modeledDissipation.${ key}` );
			if ( spec.shape === 'scalar' ) assert.ok( dissipation >= 0, `${ label } has negative modeled dissipation for ${ key}` );
			else for ( const [ speciesId, value ] of Object.entries( dissipation ) ) assert.ok( value >= 0, `${ label } has negative modeled dissipation for ${ key}.${ speciesId}` );

		}
		let expected = zeroConservationValue( spec, initial );
		for ( const [ value, scale ] of [ [ final, 1 ], [ initial, - 1 ], [ external, - 1 ], [ boundary, 1 ], [ conversion, - 1 ], [ dissipation, 1 ] ] ) expected = addConservationValue( expected, value, spec, scale );
		assert.ok( conservationDifferenceNorm( residual, expected, spec ) <= conservationRoundoffTolerance( [ residual, expected, final, initial, external, boundary, conversion, dissipation ], spec ), `${ label } ${ key} residual equation does not close` );
		const norm = conservationNorm( residual, spec );
		const residualNorm = conservation.residualNorms[ key ];
		assertInlineNumericEvidenceObject( residualNorm, `${ label }.residualNorms.${ key}` );
		assert.equal( residualNorm.unit, spec.unit, `${ label }.residualNorms.${ key} has the wrong unit` );
		assert.ok( [ 'Derived', 'Measured' ].includes( residualNorm.label ), `${ label }.residualNorms.${ key} must be Derived or Measured` );
		assert.ok( Math.abs( residualNorm.value - norm ) <= Number.EPSILON * 64 * Math.max( 1, norm ), `${ label } ${ key} residual norm is inconsistent` );
		assert.ok( norm <= conservation.acceptanceBounds[ key ].value, `${ label } ${ key} residual exceeds its acceptance gate` );

	}

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
		physicalVec3( record.payload.linearMomentumNs, 'newton-second', `${ label }.payload.linearMomentumNs` );
		physicalVec3( record.payload.angularMomentumNms, 'newton-metre-second', `${ label }.payload.angularMomentumNms` );
		physicalVec3( record.payload.referencePointMeters, 'metre', `${ label }.payload.referencePointMeters` );

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
	assert.ok( Object.values( context.physicsFrameRegistry.framesById ).some( ( frame ) => frame.frameId === exchange.physicsFrameId && frame.transformRevision === exchange.transformRevision ), `${ label } frame/revision is unregistered` );
	requireAbiEnum( exchange.mode, 'surfaceExchangeModes', `${ label }.mode` );
	const recordIds = new Set();
	const allRecords = [ ...exchange.interactions, ...exchange.reactions ];
	for ( let i = 0; i < exchange.interactions.length; i ++ ) validateCanonicalInteraction( exchange.interactions[ i ], exchange, context, recordIds, `${ label }.interactions[${ i }]` );
	for ( let i = 0; i < exchange.reactions.length; i ++ ) validateCanonicalInteraction( exchange.reactions[ i ], exchange, context, recordIds, `${ label }.reactions[${ i }]` );
	const recordsById = new Map( allRecords.map( ( record ) => [ record.interactionId, record ] ) );
	if ( exchange.mode === 'one-way' ) {

		assert.equal( exchange.reactions.length, 0, `${ label } one-way exchange cannot publish reaction records` );
		assert.equal( exchange.reactionGroups.length, 0, `${ label } one-way exchange cannot allocate reaction groups` );
		assert.ok( isTypedAbsence( exchange.couplingLoopId ), `${ label } one-way exchange cannot reference a coupling loop` );
		requireObjectKeys( exchange.stabilityGate, [ 'omittedFeedbackUpperBound', 'validityRegime' ], `${ label }.stabilityGate` );
		assertInlineNumericEvidenceObject( exchange.stabilityGate.omittedFeedbackUpperBound, `${ label }.stabilityGate.omittedFeedbackUpperBound` );
		assert.ok( quantityValue( exchange.stabilityGate.omittedFeedbackUpperBound, `${ label }.stabilityGate.omittedFeedbackUpperBound` ) > 0, `${ label } one-way omitted-feedback bound must be positive` );
		requireNonEmptyString( exchange.stabilityGate.validityRegime, `${ label }.stabilityGate.validityRegime` );
		assert.equal( exchange.convergence, 'not-applicable', `${ label } one-way exchange cannot claim iterative convergence` );

	} else {

		assert.ok( exchange.reactionGroups.length > 0, `${ label } two-way exchange requires at least one reaction group` );

	}
	for ( const [ groupIndex, group ] of exchange.reactionGroups.entries() ) {

		const groupLabel = `${ label }.reactionGroups[${ groupIndex }]`;
		requireAbiRecord( group, 'InteractionReactionGroup', groupLabel );
		assert.equal( group.contextId, context.contextId, `${ groupLabel }.contextId mismatch` );
		assert.equal( group.exchangeId, exchange.exchangeId, `${ groupLabel }.exchangeId mismatch` );
		validateCanonicalInterval( group.applicationInterval, context, `${ groupLabel }.applicationInterval` );
		assert.equal( group.acceptance, 'all-or-none', `${ groupLabel } must accept atomically` );
		assert.ok( group.sourceInteractionIds.length > 0 && group.reactionInteractionIds.length > 0, `${ groupLabel } must contain at least one source and one reaction` );
		assertUnique( group.sourceInteractionIds, `${ groupLabel }.sourceInteractionIds` );
		assertUnique( group.reactionInteractionIds, `${ groupLabel }.reactionInteractionIds` );
		for ( const id of group.sourceInteractionIds ) assert.ok( exchange.interactions.some( ( record ) => record.interactionId === id ), `${ groupLabel } references unresolved source interaction ${ id }` );
		for ( const id of group.reactionInteractionIds ) assert.ok( exchange.reactions.some( ( record ) => record.interactionId === id ), `${ groupLabel } references unresolved reaction interaction ${ id }` );
		assert.ok( group.conservationGroupIds.length > 0, `${ groupLabel } must bind at least one conservation group` );
		assertUnique( group.conservationGroupIds, `${ groupLabel }.conservationGroupIds` );
		for ( const conservationGroupId of group.conservationGroupIds ) assert.ok( exchange.conservationGroups.some( ( conservation ) => conservation.conservationGroupId === conservationGroupId ), `${ groupLabel } references unresolved conservation group ${ conservationGroupId }` );
		assert.equal( group.physicsOriginEpoch, exchange.physicsOriginEpoch, `${ groupLabel }.physicsOriginEpoch mismatch` );
		assert.equal( group.balanceFrameId, exchange.physicsFrameId, `${ groupLabel }.balanceFrameId mismatch` );
		assert.equal( group.balanceTransformRevision, exchange.transformRevision, `${ groupLabel }.balanceTransformRevision mismatch` );
		for ( const id of [ ...group.sourceInteractionIds, ...group.reactionInteractionIds ] ) {

			const record = recordsById.get( id );
			assert.equal( record.reactionGroupId, group.reactionGroupId, `${ groupLabel } record ${ id } group mismatch` );

		}

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
		validateConservationResiduals( conservation, allRecords, conservationLabel, exchange.mode );

	}
	requireAbiRecord( exchange.batchLedger, 'InteractionBatchLedger', `${ label }.batchLedger` );
	assert.equal( exchange.batchLedger.exchangeId, exchange.exchangeId, `${ label }.batchLedger.exchangeId mismatch` );
	requireNonEmptyMapping( exchange.batchLedger.perConsumerCursor, `${ label }.batchLedger.perConsumerCursor` );
	assert.ok( exchange.batchLedger.overflowPolicy !== 'lossy-with-failed-conservation' || Object.keys( exchange.batchLedger.lostCommodities ).length > 0, `${ label } lossy overflow hides conserved commodities` );
	assert.equal( new Set( allRecords.map( ( record ) => record.exactOnceKey ) ).size, allRecords.length, `${ label } has a duplicate delivery key` );

}

function interactionApplicationContentDigestPayload( ledger ) {

	const payload = clone( ledger );
	delete payload.applicationContentDigest;
	delete payload.receiptDigest;
	return payload;

}

function interactionApplicationReceiptDigestPayload( ledger ) {

	return { applicationLedgerId: ledger.applicationLedgerId, applicationContentDigest: ledger.applicationContentDigest, disposition: ledger.disposition, replayEpoch: ledger.replayEpoch, cursorAfter: ledger.cursorAfter, targetPreparedVersion: ledger.targetPreparedVersion, commitTransactionId: ledger.commitTransactionId };

}

function validateExactOnceInteractionApplication( route ) {

	const topLevelLedgers = route.physicsInteractionApplicationLedgers;
	assert.ok( isPlainObject( topLevelLedgers ), 'physicsInteractionApplicationLedgers must be a keyed mapping' );
	const graphLedgers = route.physicsGraph.executionLedger.interactionApplicationLedgers;
	const graphLedgersById = new Map();
	for ( const [ index, ledger ] of graphLedgers.entries() ) {

		requireAbiRecord( ledger, 'InteractionApplicationLedger', `physicsGraph.executionLedger.interactionApplicationLedgers[${ index }]` );
		assert.ok( ! graphLedgersById.has( ledger.applicationLedgerId ), `duplicate application ledger ${ ledger.applicationLedgerId }` );
		graphLedgersById.set( ledger.applicationLedgerId, ledger );

	}
	assert.deepEqual( Object.keys( topLevelLedgers ).sort(), [ ...graphLedgersById.keys() ].sort(), 'top-level/graph application-ledger ID closure mismatch' );
	for ( const [ id, ledger ] of Object.entries( topLevelLedgers ) ) {

		assert.equal( ledger.applicationLedgerId, id, `application-ledger registry key ${ id } mismatch` );
		assert.deepEqual( ledger, graphLedgersById.get( id ), `top-level application ledger ${ id } differs from the execution ledger` );

	}
	const executionsById = new Map( route.physicsGraph.executionLedger.stageExecutions.map( ( execution ) => [ execution.executionId, execution ] ) );
	const claims = route.physicsGraph.executionLedger.stateAdvanceClaims;
	const transactionsById = new Map( route.physicsGraph.commitTransactions.map( ( transaction ) => [ transaction.commitTransactionId, transaction ] ) );
	const preparedStateVersions = new Set( route.physicsGraph.commitGroups.flatMap( ( group ) => group.preparedPublications.map( ( publication ) => publication.preparedVersion.stateVersion ) ) );
	const committedExactOnceKeys = new Set();
	const expectedAllLedgerIds = [];
	for ( const [ exchangeIndex, exchange ] of route.physicsInteractions.entries() ) {

		const label = `physicsInteractions[${ exchangeIndex }]`;
		const records = [ ...exchange.interactions, ...exchange.reactions ];
		const recordsById = new Map( records.map( ( record ) => [ record.interactionId, record ] ) );
		assert.equal( recordsById.size, records.length, `${ label } duplicates interaction IDs` );
		for ( const [ refIndex, ref ] of exchange.sourceDescriptors.entries() ) {

			const descriptor = Object.values( route.physicsSignals ).find( ( signal ) => signal.signalId === ref.signalId );
			assert.ok( descriptor, `${ label }.sourceDescriptors[${ refIndex }] does not resolve` );
			assert.deepEqual( [ ref.descriptorStateVersion, ref.schemaId, ref.contextId ], [ descriptor.stateVersion, descriptor.schemaId, descriptor.contextId ], `${ label }.sourceDescriptors[${ refIndex }] descriptor identity mismatch` );

		}
		for ( const group of exchange.reactionGroups ) {

			const exactSources = exchange.interactions.filter( ( record ) => record.reactionGroupId === group.reactionGroupId ).map( ( record ) => record.interactionId ).sort();
			const exactReactions = exchange.reactions.filter( ( record ) => record.reactionGroupId === group.reactionGroupId ).map( ( record ) => record.interactionId ).sort();
			assert.deepEqual( [ ...group.sourceInteractionIds ].sort(), exactSources, `${ label } reaction group ${ group.reactionGroupId } source topology is not exact` );
			assert.deepEqual( [ ...group.reactionInteractionIds ].sort(), exactReactions, `${ label } reaction group ${ group.reactionGroupId } reaction topology is not exact` );
			for ( const conservationGroupId of group.conservationGroupIds ) assert.ok( exchange.conservationGroups.some( ( conservation ) => conservation.conservationGroupId === conservationGroupId ), `${ label } reaction group references unknown conservation group ${ conservationGroupId}` );

		}
		const firstSequence = exchange.batchLedger.publishedSequenceRange.firstSequence;
		const lastSequence = exchange.batchLedger.publishedSequenceRange.lastSequence;
		assert.equal( lastSequence - firstSequence + 1, records.length, `${ label } published sequence range does not close over records` );
		assert.deepEqual( records.map( ( record ) => record.provenance.producerSequence ).sort( ( a, b ) => a - b ), Array.from( { length: records.length }, ( _, index ) => firstSequence + index ), `${ label } producer sequences have a gap or duplicate` );
		assert.equal( quantityValue( exchange.batchLedger.acceptedRejectedLateDuplicate.accepted, `${ label }.batchLedger.accepted` ), records.length, `${ label } accepted count mismatch` );
		for ( const key of [ 'rejected', 'late', 'duplicate' ] ) assert.equal( quantityValue( exchange.batchLedger.acceptedRejectedLateDuplicate[ key ], `${ label }.batchLedger.${ key}` ), 0, `${ label } canonical batch has nonzero ${ key } count` );
		for ( const cursor of Object.values( exchange.batchLedger.perConsumerCursor ) ) assert.equal( cursor, lastSequence + 1, `${ label } consumer cursor does not advance past the exact published range` );
		const exchangeLedgerIds = exchange.batchLedger.applicationLedgerIds;
		assertUnique( exchangeLedgerIds, `${ label }.batchLedger.applicationLedgerIds` );
		assert.equal( exchangeLedgerIds.length, records.length, `${ label } application-ledger cardinality mismatch` );
		for ( const record of records ) {

			const matching = exchangeLedgerIds.map( ( id ) => graphLedgersById.get( id ) ).filter( ( ledger ) => ledger?.interactionId === record.interactionId );
			assert.equal( matching.length, 1, `${ label } interaction ${ record.interactionId } must have exactly one application ledger` );
			const ledger = matching[ 0 ];
			expectedAllLedgerIds.push( ledger.applicationLedgerId );
			assert.deepEqual( [ ledger.contextId, ledger.exchangeId, ledger.exactOnceKey, ledger.targetOwner, ledger.targetEntityId, ledger.targetStateEquation, ledger.targetStateVersionExpected, ledger.payloadTimeSemantics ], [ route.physicsContext.contextId, exchange.exchangeId, record.exactOnceKey, record.targetOwner, record.targetEntityId, record.targetStateEquation, record.targetStateVersionExpected, record.payload.timeSemantics ], `${ ledger.applicationLedgerId } record identity mismatch` );
			assert.equal( canonicalIntervalIdentity( ledger.declaredApplicationInterval ), canonicalIntervalIdentity( record.applicationInterval ), `${ ledger.applicationLedgerId } declared interval mismatch` );
			assert.equal( ledger.disposition, 'committed', `${ ledger.applicationLedgerId } canonical application is not committed` );
			assert.ok( ! committedExactOnceKeys.has( ledger.exactOnceKey ), `exact-once key ${ ledger.exactOnceKey } was applied twice` );
			committedExactOnceKeys.add( ledger.exactOnceKey );
			const expectedAppliedPayload = Object.fromEntries( Object.entries( record.payload ).filter( ( [ key ] ) => ! [ 'tag', 'timeSemantics' ].includes( key ) ) );
			assert.deepEqual( ledger.appliedPayloadAmount, expectedAppliedPayload, `${ ledger.applicationLedgerId } applied payload differs from the interaction payload` );
			const execution = executionsById.get( ledger.stageExecutionId );
			assert.ok( execution, `${ ledger.applicationLedgerId } references unknown stage execution` );
			const declaredBounds = intervalBoundsSeconds( ledger.declaredApplicationInterval, route.physicsContext, `${ ledger.applicationLedgerId }.declaredApplicationInterval` );
			const executionBounds = intervalBoundsSeconds( execution.executionInterval, route.physicsContext, `${ ledger.applicationLedgerId }.executionInterval` );
			const expectedOverlapSeconds = Math.max( 0, Math.min( declaredBounds[ 1 ], executionBounds[ 1 ] ) - Math.max( declaredBounds[ 0 ], executionBounds[ 0 ] ) );
			assert.ok( Math.abs( quantityValue( ledger.overlapMeasureSeconds, `${ ledger.applicationLedgerId }.overlapMeasureSeconds` ) - expectedOverlapSeconds ) <= 1e-12, `${ ledger.applicationLedgerId } overlap measure is not the exact interval intersection` );
			if ( expectedOverlapSeconds > 0 ) {

				assert.ok( ! isTypedAbsence( ledger.executionOverlapInterval ), `${ ledger.applicationLedgerId } omits a nonempty execution overlap` );
				const overlapBounds = intervalBoundsSeconds( ledger.executionOverlapInterval, route.physicsContext, `${ ledger.applicationLedgerId }.executionOverlapInterval` );
				assert.ok( Math.abs( overlapBounds[ 0 ] - Math.max( declaredBounds[ 0 ], executionBounds[ 0 ] ) ) <= 1e-12 && Math.abs( overlapBounds[ 1 ] - Math.min( declaredBounds[ 1 ], executionBounds[ 1 ] ) ) <= 1e-12, `${ ledger.applicationLedgerId } execution overlap interval is inexact` );

			}
			if ( record.payload.timeSemantics === 'interval-integrated' ) assert.equal( quantityValue( ledger.applicationFraction, `${ ledger.applicationLedgerId }.applicationFraction` ), 1, `${ ledger.applicationLedgerId } interval-integrated payload is not applied exactly once` );
			else if ( record.payload.timeSemantics === 'rate' ) assert.ok( Math.abs( quantityValue( ledger.applicationFraction, `${ ledger.applicationLedgerId }.applicationFraction` ) - expectedOverlapSeconds / ( declaredBounds[ 1 ] - declaredBounds[ 0 ] ) ) <= 1e-12, `${ ledger.applicationLedgerId } rate application fraction is not overlap/declared-duration` );
			assert.equal( ledger.cursorBefore, record.provenance.producerSequence, `${ ledger.applicationLedgerId } cursorBefore mismatch` );
			assert.equal( ledger.cursorAfter, ledger.cursorBefore + 1, `${ ledger.applicationLedgerId } cursor is not monotonic` );
			assert.ok( execution.interactionApplicationLedgerIds.includes( ledger.applicationLedgerId ), `${ ledger.applicationLedgerId } is absent from its stage execution` );
			const stage = route.physicsGraph.stages.find( ( candidate ) => candidate.stageId === execution.stageId );
			assert.equal( stage.owner, ledger.targetOwner, `${ ledger.applicationLedgerId } is not applied by the target state-equation owner` );
			const claim = claims.find( ( candidate ) => candidate.owner === ledger.targetOwner && candidate.stateEquationId === ledger.targetStateEquation && candidate.interactionApplicationLedgerIds.includes( ledger.applicationLedgerId ) );
			assert.ok( claim && claim.nativeExecutionIds.includes( execution.executionId ), `${ ledger.applicationLedgerId } is absent from its target state-advance claim` );
			const transaction = transactionsById.get( ledger.commitTransactionId );
			assert.ok( transaction && transaction.status === 'committed', `${ ledger.applicationLedgerId } does not resolve a committed transaction` );
			const targetGroups = route.physicsGraph.commitGroups.filter( ( group ) => transaction.commitGroupIds.includes( group.commitGroupId ) && group.stateEquationOwners[ ledger.targetStateEquation ] === ledger.targetOwner );
			assert.equal( targetGroups.length, 1, `${ ledger.applicationLedgerId } target owner/equation does not resolve exactly one transaction group` );
			assert.ok( targetGroups[ 0 ].preparedPublications.some( ( publication ) => publication.stateEquationOwner === ledger.targetOwner && publication.preparedVersion.stateVersion === ledger.targetPreparedVersion ), `${ ledger.applicationLedgerId } target prepared version is not owned by its target equation/transaction` );
			assert.ok( preparedStateVersions.has( ledger.targetPreparedVersion ), `${ ledger.applicationLedgerId } target prepared version does not resolve` );
			assert.equal( ledger.applicationContentDigest, sha256Canonical( interactionApplicationContentDigestPayload( ledger ) ), `${ ledger.applicationLedgerId } application content digest mismatch` );
			assert.equal( ledger.receiptDigest, sha256Canonical( interactionApplicationReceiptDigestPayload( ledger ) ), `${ ledger.applicationLedgerId } receipt digest mismatch` );

		}

	}
	assert.deepEqual( expectedAllLedgerIds.sort(), [ ...graphLedgersById.keys() ].sort(), 'application-ledger inventory contains an unreferenced row' );
	for ( const execution of executionsById.values() ) {

		assertUnique( execution.interactionApplicationLedgerIds, `execution ${ execution.executionId } application-ledger IDs` );
		assert.deepEqual( [ ...execution.interactionApplicationLedgerIds ].sort(), graphLedgers.filter( ( ledger ) => ledger.stageExecutionId === execution.executionId ).map( ( ledger ) => ledger.applicationLedgerId ).sort(), `execution ${ execution.executionId } application-ledger reverse closure mismatch` );

	}
	for ( const claim of claims ) {

		assertUnique( claim.interactionApplicationLedgerIds, `claim ${ claim.claimId } application-ledger IDs` );
		assert.deepEqual( [ ...claim.interactionApplicationLedgerIds ].sort(), graphLedgers.filter( ( ledger ) => ledger.targetOwner === claim.owner && ledger.targetStateEquation === claim.stateEquationId ).map( ( ledger ) => ledger.applicationLedgerId ).sort(), `claim ${ claim.claimId } application-ledger reverse closure mismatch` );

	}
	for ( const loop of route.physicsGraph.loopMacros ) {

		const acceptedRow = loop.perIterationLedger.find( ( row ) => row.accepted );
		const requiredLoopLedgerIds = route.physicsInteractions.filter( ( exchange ) => exchange.couplingLoopId === loop.loopId ).flatMap( ( exchange ) => exchange.batchLedger.applicationLedgerIds );
		assertUnique( acceptedRow.interactionApplicationLedgerIds, `loop ${ loop.loopId } accepted application-ledger IDs` );
		assert.deepEqual( [ ...acceptedRow.interactionApplicationLedgerIds ].sort(), [ ...requiredLoopLedgerIds ].sort(), `loop ${ loop.loopId } accepted application-ledger closure is not exact` );
		for ( const applicationLedgerId of acceptedRow.interactionApplicationLedgerIds ) assert.ok( graphLedgersById.has( applicationLedgerId ), `loop ${ loop.loopId } accepted row references unknown application ledger ${ applicationLedgerId}` );
		const acceptedRangeKeys = acceptedRow.interactionSequenceRanges.map( ( range ) => `${ range.firstSequence}:${ range.lastSequenceInclusive }` ).sort();
		const requiredRangeKeys = route.physicsInteractions.filter( ( exchange ) => exchange.couplingLoopId === loop.loopId ).map( ( exchange ) => `${ exchange.batchLedger.publishedSequenceRange.firstSequence }:${ exchange.batchLedger.publishedSequenceRange.lastSequence }` ).sort();
		assert.deepEqual( acceptedRangeKeys, requiredRangeKeys, `loop ${ loop.loopId } accepted interaction sequence-range closure is not exact` );
		for ( const row of loop.perIterationLedger.filter( ( candidate ) => ! candidate.accepted ) ) assert.deepEqual( row.interactionApplicationLedgerIds, [], `loop ${ loop.loopId } rejected iteration carries committed application receipts` );

	}

}

function leaseRefIdentity( ref ) {

	return `${ ref.leaseId }|${ ref.deviceId }|${ ref.deviceLossGeneration }|${ ref.resourceGeneration }|${ ref.layoutRevision }`;

}

function completionJoinDigest( join ) {

	return sha256Canonical( {
		leaseId: join.leaseId,
		requiredConsumerKeys: [ ...join.requiredConsumerKeys ].sort(),
		simulationConsumers: join.simulationConsumers,
		couplingConsumers: join.couplingConsumers,
		externalConsumers: join.externalConsumers,
		presentationConsumers: join.presentationConsumers,
		joinPredicate: join.joinPredicate,
		deviceLossRetirementPath: join.deviceLossRetirementPath
	} );

}

function validateCompletionJoin( join, lease, label ) {

	requireAbiRecord( join, 'ConsumerCompletionJoin', label );
	assert.equal( join.leaseId, lease.leaseId, `${ label}.leaseId mismatch` );
	const tokens = [ ...join.simulationConsumers, ...join.couplingConsumers, ...join.externalConsumers, ...join.presentationConsumers ];
	assertUnique( join.requiredConsumerKeys, `${ label}.requiredConsumerKeys` );
	assertUnique( tokens.map( ( token ) => token.tokenId ), `${ label} completion token IDs` );
	assert.deepEqual( [ ...join.requiredConsumerKeys ].sort(), tokens.map( ( token ) => token.consumerKey ).sort(), `${ label} consumer-key closure mismatch` );
	for ( const token of tokens ) {

		requireAbiRecord( token, 'CompletionTokenRef', `${ label}.${ token.tokenId}` );
		assert.equal( token.deviceLossGeneration, lease.deviceLossGeneration, `${ label}.${ token.tokenId} device-loss generation mismatch` );
		const presentation = token.consumerKind === 'presentation';
		for ( const key of [ 'executionId', 'presentationTargetId', 'viewId', 'snapshotId', 'queueSubmissionEpoch' ] ) assert.equal( isTypedAbsence( token[ key ] ), ! presentation, `${ label}.${ token.tokenId}.${ key} has wrong presence for ${ token.consumerKind } consumer` );

	}
	assert.equal( join.joinPredicate, 'all-required-consumers-complete-or-loss-invalidated', `${ label}.joinPredicate mismatch` );
	assert.equal( join.joinDigest, completionJoinDigest( join ), `${ label}.joinDigest does not cover its canonical consumer closure` );

}

function dependencyDagDigest( preparation ) {

	return sha256Canonical( {
		preparationEdges: preparation.requiredPreparationEdges.map( ( edge ) => ( {
			edgeId: edge.edgeId,
			producerPublicationId: edge.producerPublicationId,
			consumerPublicationId: edge.consumerPublicationId,
			dependencyRef: edge.dependencyRef
		} ) ).sort( ( a, b ) => a.edgeId.localeCompare( b.edgeId ) ),
		resetEdges: preparation.resetDependencies.flatMap( ( action ) => action.dependencies.map( ( dependency ) => [ dependency, action.actionId ] ) ).sort()
	} );

}

function closureManifestDigest( manifest ) {

	const { closureDigest, ...covered } = manifest;
	return sha256Canonical( covered );

}

function renderPlanDigest( plan ) {

	const { immutablePlanDigest, ...covered } = plan;
	return sha256Canonical( covered );

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
		assert.ok( Object.values( context.physicsFrameRegistry.framesById ).some( ( frame ) => frame.frameId === arm.globalBinding.sourcePhysicsFrameId && frame.transformRevision === arm.globalBinding.transformRevision ), `${ label }.${ armKey}.globalBinding frame/revision is unregistered` );
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
	assert.ok( Object.values( context.physicsFrameRegistry.framesById ).some( ( frame ) => frame.frameId === transform.sourcePhysicsFrameId && frame.transformRevision === transform.sourceTransformRevision ), `${ label } source frame/revision is unregistered` );
	canonicalInstantSeconds( transform.referenceInstant, context, `${ label }.referenceInstant` );
	assert.equal( canonicalInstantIdentity( transform.referenceInstant ), canonicalInstantIdentity( expectedInstant ), `${ label }.referenceInstant does not bind the camera sample instant` );
	assert.deepEqual( [ transform.sourcePhysicsFrameId, transform.sourceTransformRevision, transform.sourcePhysicsOriginEpoch ], [ expectedBinding.sourcePhysicsFrameId, expectedBinding.transformRevision, expectedBinding.physicsOriginEpoch ], `${ label } source binding mismatch` );
	assertProperRotation( transform.properBasisRotation, `${ label }.properBasisRotation` );
	const presentationScale = quantityValue( transform.presentationScale, `${ label }.presentationScale` );
	const renderUnitsPerMeter = quantityValue( transform.renderUnitsPerMeter, `${ label }.renderUnitsPerMeter` );
	const metersPerWorldUnit = quantityValue( context.metersPerWorldUnit, 'physicsContext.metersPerWorldUnit' );
	assert.ok( Math.abs( renderUnitsPerMeter - presentationScale / metersPerWorldUnit ) < 1e-12, `${ label }.renderUnitsPerMeter violates the exact mapping formula` );
	assert.ok( Array.isArray( transform.translationRenderUnits ) && transform.translationRenderUnits.length === 3 && transform.translationRenderUnits.every( Number.isFinite ), `${ label }.translationRenderUnits must contain three finite render-space components` );

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

function validateResetActionResult( result, action, allowedLeases, camera, label ) {

	requireAbiRecord( result, 'ScopedResetActionResult', label );
	assert.deepEqual( [ result.actionId, result.presentationTargetId, result.viewId, result.historyKey, result.policyApplied ], [ action.actionId, action.presentationTargetId, action.viewId, action.historyKey, action.policy ], `${ label} does not realize its planned reset action` );
	assert.deepEqual( [ ...result.causeEpochs ].sort(), [ ...action.causeEpochs ].sort(), `${ label}.causeEpochs mismatch` );
	validateAffectedRegion( result.appliedRegion, allowedLeases, camera, `${ label}.appliedRegion` );
	for ( const [ refKey, generationKey ] of [ [ 'inputHistoryLeaseRef', 'inputHistoryGeneration' ], [ 'outputHistoryLeaseRef', 'outputHistoryGeneration' ] ] ) {

		if ( isTypedAbsence( result[ refKey ] ) ) assert.ok( isTypedAbsence( result[ generationKey ] ), `${ label}.${ generationKey} cannot exist without a lease` );
		else validateLeaseRef( result[ refKey ], allowedLeases, `${ label}.${ refKey}` );

	}
	assert.deepEqual( [ result.inputHistoryGeneration, result.outputHistoryGeneration ], [ action.expectedInputHistoryGeneration, action.expectedOutputHistoryGeneration ], `${ label} history generations disagree with the immutable plan` );
	assert.ok( Array.isArray( result.dependencyCompletionRefs ) && result.dependencyCompletionRefs.length > 0, `${ label} lacks dependency completion evidence` );
	for ( const [ index, ref ] of result.dependencyCompletionRefs.entries() ) requireAbiRecord( ref, 'PhysicsDependencyCompletionRef', `${ label}.dependencyCompletionRefs[${ index }]` );
	if ( result.status === 'completed' ) assert.ok( isTypedAbsence( result.failure ), `${ label} completed with a failure arm` );
	else assert.ok( ! isTypedAbsence( result.failure ), `${ label} failed without a typed failure record` );
	requireNonEmptyString( result.resultDigest, `${ label}.resultDigest` );

}

function validateRenderPlan( plan, targetViewKey, route, preparation, snapshot, label ) {

	requireAbiRecord( plan, 'PresentationRenderPlan', label );
	assert.equal( targetViewKey, `${ plan.presentationTargetId }/${ plan.viewId }`, `${ label} target/view key mismatch` );
	assert.deepEqual( [ plan.timeCohortId, plan.candidateId, plan.snapshotId, plan.closureDigest ], [ route.physicsPresentationCandidate.timeCohortId, route.physicsPresentationCandidate.candidateId, snapshot.snapshotId, snapshot.closureManifest.closureDigest ], `${ label} publication-chain identity mismatch` );
	assertUnique( plan.phaseIds, `${ label}.phaseIds` );
	assert.deepEqual( [ ...plan.phaseIds ], plan.phaseRecords.map( ( phase ) => phase.phaseId ), `${ label}.phaseIds must equal phase-record order exactly` );
	const phasesById = new Map();
	const generationProducer = new Map();
	for ( const [ index, phase ] of plan.phaseRecords.entries() ) {

		const phaseLabel = `${ label}.phaseRecords[${ index }]`;
		requireAbiRecord( phase, 'RenderPlanPhase', phaseLabel );
		assert.deepEqual( [ phase.renderPlanId, phase.presentationTargetId, phase.viewId ], [ plan.renderPlanId, plan.presentationTargetId, plan.viewId ], `${ phaseLabel} scope mismatch` );
		assert.equal( phase.backendGeneration, route.frameExecutionRecord.backendGeneration, `${ phaseLabel}.backendGeneration mismatch` );
		assert.ok( ! phasesById.has( phase.phaseId ), `${ phaseLabel} duplicates phaseId` );
		phasesById.set( phase.phaseId, phase );
		for ( const generation of phase.outputResourceGenerationIds ) {

			assert.ok( ! generationProducer.has( generation ), `${ phaseLabel} duplicates output generation ${ generation}` );
			generationProducer.set( generation, phase.phaseId );

		}
		for ( const mapKey of [ 'outputOwnerByGeneration', 'outputEncodingByGeneration', 'outputPhysicalExtentByGeneration' ] ) assert.deepEqual( Object.keys( phase[ mapKey ] ).sort(), [ ...phase.outputResourceGenerationIds ].sort(), `${ phaseLabel}.${ mapKey} must close over every output generation` );

	}
	assert.deepEqual( [ ...plan.requiredPreparationEdgeIds ].sort(), preparation.requiredPreparationEdges.map( ( edge ) => edge.edgeId ).sort(), `${ label} preparation-edge closure mismatch` );
	assert.deepEqual( [ ...plan.renderResourceLeaseIds ].sort(), preparation.renderResourceLeases.map( ( lease ) => lease.renderResourceLeaseId ).sort(), `${ label} render-resource lease closure mismatch` );
	assert.deepEqual( [ ...plan.plannedResetActionIds ].sort(), preparation.resetDependencies.map( ( action ) => action.actionId ).sort(), `${ label} reset-action closure mismatch` );
	assertUnique( plan.shadowFactorIds, `${ label}.shadowFactorIds` );
	assert.deepEqual( [ ...plan.shadowFactorIds ].sort(), preparation.shadowViewPublicationRefs.map( ( ref ) => ref.shadowFactorProvenance.shadowFactorId ).sort(), `${ label} shadow-factor closure mismatch` );
	for ( const action of preparation.resetDependencies ) assert.deepEqual( plan.expectedResetHistoryGenerations[ action.actionId ], { inputHistoryGeneration: action.expectedInputHistoryGeneration, outputHistoryGeneration: action.expectedOutputHistoryGeneration }, `${ label} expected reset generations mismatch for ${ action.actionId }` );
	assert.deepEqual( Object.keys( plan.expectedResetHistoryGenerations ).sort(), [ ...plan.plannedResetActionIds ].sort(), `${ label} expected reset-generation keys mismatch` );
	const edgePredecessors = new Map( plan.phaseIds.map( ( phaseId ) => [ phaseId, [] ] ) );
	assertUnique( plan.edges.map( ( edge ) => edge.edgeId ), `${ label}.edgeIds` );
	assertUnique( plan.edges.map( ( edge ) => edge.dependencyRef.dependencyId ), `${ label}.dependencyIds` );
	assertUnique( plan.edges.map( ( edge ) => edge.completionRef.completionId ), `${ label}.completionIds` );
	for ( const [ index, edge ] of plan.edges.entries() ) {

		const edgeLabel = `${ label}.edges[${ index }]`;
		requireAbiRecord( edge, 'RenderPlanEdge', edgeLabel );
		assert.equal( edge.renderPlanId, plan.renderPlanId, `${ edgeLabel}.renderPlanId mismatch` );
		assert.ok( phasesById.has( edge.producerPhaseId ) && phasesById.has( edge.consumerPhaseId ), `${ edgeLabel} references an unknown phase` );
		assert.equal( generationProducer.get( edge.resourceGenerationId ), edge.producerPhaseId, `${ edgeLabel} resource generation is not produced by its producer phase` );
		assert.ok( phasesById.get( edge.consumerPhaseId ).inputResourceGenerationIds.includes( edge.resourceGenerationId ), `${ edgeLabel} consumer does not declare its resource generation` );
		requireAbiRecord( edge.dependencyRef, 'PhysicsDependencyRef', `${ edgeLabel}.dependencyRef` );
		requireAbiRecord( edge.completionRef, 'PhysicsDependencyCompletionRef', `${ edgeLabel}.completionRef` );
		assert.equal( edge.completionRef.dependencyId, edge.dependencyRef.dependencyId, `${ edgeLabel} completion/dependency mismatch` );
		edgePredecessors.get( edge.consumerPhaseId ).push( edge.producerPhaseId );

	}
	for ( const phase of plan.phaseRecords ) for ( const generation of phase.inputResourceGenerationIds ) {

		const incoming = plan.edges.filter( ( edge ) => edge.consumerPhaseId === phase.phaseId && edge.resourceGenerationId === generation );
		assert.equal( incoming.length, 1, `${ label}.${ phase.phaseId } input ${ generation } must have exactly one producing edge` );

	}
	const pending = new Set( plan.phaseIds );
	const visited = new Set();
	while ( pending.size > 0 ) {

		const ready = [ ...pending ].filter( ( phaseId ) => edgePredecessors.get( phaseId ).every( ( predecessor ) => visited.has( predecessor ) ) );
		assert.ok( ready.length > 0, `${ label} phase edges contain a cycle` );
		for ( const phaseId of ready ) { pending.delete( phaseId ); visited.add( phaseId ); }

	}
	assert.equal( plan.immutablePlanDigest, renderPlanDigest( plan ), `${ label}.immutablePlanDigest does not cover the immutable plan` );

}

function authoritativePresentationEventPayloadDigest( exchange ) {

	const { firstSequence, lastSequence } = exchange.batchLedger.publishedSequenceRange;
	const records = [ ...exchange.interactions, ...exchange.reactions ]
		.filter( ( record ) => record.provenance.producerSequence >= firstSequence && record.provenance.producerSequence <= lastSequence )
		.sort( ( a, b ) => a.provenance.producerSequence - b.provenance.producerSequence );
	assert.deepEqual( records.map( ( record ) => record.provenance.producerSequence ), Array.from( { length: lastSequence - firstSequence + 1 }, ( _, index ) => firstSequence + index ), `presentation event stream ${ exchange.exchangeId } does not have an exact authoritative batch payload` );
	return sha256Canonical( records.map( ( record ) => ( {
		interactionId: record.interactionId,
		producerSequence: record.provenance.producerSequence,
		payload: record.payload
	} ) ) );

}

function validateCanonicalPresentation( route ) {

	const { physicsContext: context, physicsSignals: signals } = route;
	const candidate = route.physicsPresentationCandidate;
	requireAbiRecord( candidate, 'PhysicsPresentationCandidate', 'physicsPresentationCandidate' );
	assert.equal( candidate.contextId, context.contextId, 'physicsPresentationCandidate.contextId mismatch' );
	assert.equal( candidate.physicsOriginEpoch, context.physicsOriginEpoch, 'physicsPresentationCandidate.physicsOriginEpoch mismatch' );
	canonicalInstantSeconds( candidate.requestedPresentationInstant, context, 'physicsPresentationCandidate.requestedPresentationInstant' );
	const timeCohort = route.physicsPresentationTimeCohortsById[ candidate.timeCohortId ];
	assert.ok( timeCohort, 'physicsPresentationCandidate.timeCohortId does not resolve' );
	requireAbiRecord( timeCohort, 'PresentationTimeCohort', `physicsPresentationTimeCohortsById.${ candidate.timeCohortId}` );
	assert.equal( timeCohort.timeCohortId, candidate.timeCohortId, 'presentation time cohort registry key mismatch' );
	assert.equal( canonicalInstantIdentity( timeCohort.currentRequestedPresentationInstant ), canonicalInstantIdentity( candidate.requestedPresentationInstant ), 'Candidate does not bind the cohort current requested instant' );
	assert.equal( canonicalInstantIdentity( timeCohort.requestedPresentationInstant ), canonicalInstantIdentity( timeCohort.currentRequestedPresentationInstant ), 'time cohort compatibility instant drifts from current requested instant' );
	assert.ok( timeCohort.requiredContextIds.includes( context.contextId ), 'time cohort omits Candidate context' );
	assert.equal( timeCohort.requiredDiscontinuityEpochs[ context.contextId ], candidate.requestedPresentationInstant.discontinuityEpoch, 'time cohort discontinuity epoch mismatch' );
	validateCanonicalDuration( timeCohort.maximumInterContextSkew, context, 'presentationTimeCohort.maximumInterContextSkew' );
	validateCanonicalDuration( timeCohort.maximumCandidateAge, context, 'presentationTimeCohort.maximumCandidateAge' );
	requireAbiRecord( candidate.commitProvenance, 'CandidateCommitProvenance', 'physicsPresentationCandidate.commitProvenance' );
	assert.equal( candidate.commitProvenance.contextId, context.contextId, 'Candidate commit provenance context mismatch' );
	assert.ok( candidate.commitProvenance.coordinationAdvanceIds.length > 0 && candidate.commitProvenance.commitTransactionIds.length > 0 && candidate.commitProvenance.commitReceiptIdsAndDigests.length > 0, 'Candidate commit provenance is not closed over committed scheduler state' );
	assert.deepEqual( [ ...candidate.commitProvenance.coordinationAdvanceIds ].sort(), route.physicsCoordinationAdvanceRecords.map( ( advance ) => advance.coordinationAdvanceId ).sort(), 'Candidate coordination-advance provenance closure mismatch' );
	assert.deepEqual( [ ...candidate.commitProvenance.commitTransactionIds ].sort(), Object.keys( route.physicsCommitTransactions ).sort(), 'Candidate commit-transaction provenance closure mismatch' );
	const provenanceTransactions = candidate.commitProvenance.commitTransactionIds.map( ( id ) => route.physicsCommitTransactions[ id ] );
	assert.deepEqual( candidate.commitProvenance.commitReceiptIdsAndDigests.map( ( row ) => [ row.receiptId, row.receiptDigest ] ).sort(), provenanceTransactions.map( ( transaction ) => [ transaction.receipt.receiptId, transaction.receipt.receiptDigest ] ).sort(), 'Candidate commit-receipt provenance mismatch' );
	assert.deepEqual( candidate.commitProvenance.committedStateVersions.map( ( row ) => `${ row.signalId }@${ row.stateVersion }` ).sort(), provenanceTransactions.flatMap( ( transaction ) => transaction.receipt.committedPublications.map( ( row ) => `${ row.signalId }@${ row.stateVersion }` ) ).sort(), 'Candidate committed-state provenance mismatch' );
	assert.equal( candidate.commitProvenance.closedPublicationSetDigest, provenanceTransactions[ 0 ].publicationSetDigest, 'Candidate closed publication-set digest mismatch' );
	for ( const forbidden of [ 'cameraId', 'viewId', 'presentationTargetId', 'renderOriginEpoch', 'globalToRenderCurrent', 'globalToRenderPrevious', 'viewMatrix', 'projectionMatrix' ] ) assert.ok( ! Object.hasOwn( candidate, forbidden ), `physicsPresentationCandidate is not view-independent: ${ forbidden }` );
	const candidateLeasesById = new Map();
	for ( const [ index, lease ] of candidate.resourceLeases.entries() ) {

		requireAbiRecord( lease, 'PresentationResourceLease', `physicsPresentationCandidate.resourceLeases[${ index }]` );
		assert.ok( ! candidateLeasesById.has( lease.leaseId ), `duplicate presentation lease ${ lease.leaseId }` );
		validateCompletionJoin( lease.reuseProhibitedUntil, lease, `physicsPresentationCandidate.resourceLeases[${ index }].reuseProhibitedUntil` );
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
	const sharedPresentationConsumerId = 'shared-presentation-views';
	const authoritativeEventBatchesByStreamId = new Map();
	for ( const exchange of route.physicsInteractions ) {

		assert.ok( ! authoritativeEventBatchesByStreamId.has( exchange.exchangeId ), `duplicate authoritative presentation event stream ${ exchange.exchangeId }` );
		assert.equal( exchange.batchLedger.exchangeId, exchange.exchangeId, `presentation event stream ${ exchange.exchangeId } batch references another exchange` );
		authoritativeEventBatchesByStreamId.set( exchange.exchangeId, exchange );

	}
	assertUnique( candidate.eventSequenceRanges.map( ( range ) => range.rangeId ), 'physicsPresentationCandidate.eventSequenceRanges range IDs' );
	for ( const [ index, range ] of candidate.eventSequenceRanges.entries() ) {

		const label = `physicsPresentationCandidate.eventSequenceRanges[${ index }]`;
		requireAbiRecord( range, 'PresentationEventRange', label );
		assert.ok( range.consumerId === sharedPresentationConsumerId || Object.hasOwn( cameras, range.consumerId ), `${ label}.consumerId is neither a registered target/view nor the shared presentation consumer` );
		assert.ok( Number.isSafeInteger( range.firstSequence ) && Number.isSafeInteger( range.lastSequenceInclusive ) && range.firstSequence <= range.lastSequenceInclusive, `${ label} has an invalid closed sequence range` );
		assert.equal( range.cursorBefore, range.firstSequence, `${ label}.cursorBefore does not start at the closed range` );
		assert.equal( range.cursorAfter, range.lastSequenceInclusive + 1, `${ label}.cursorAfter does not advance past the closed range` );
		validateCanonicalInterval( range.interval, context, `${ label}.interval` );
		const exchange = authoritativeEventBatchesByStreamId.get( range.streamId );
		assert.ok( exchange, `${ label}.streamId does not resolve an authoritative interaction batch` );
		assert.equal( range.producerId, exchange.batchLedger.producerId, `${ label}.producerId does not own the authoritative batch` );
		assert.deepEqual( [ range.firstSequence, range.lastSequenceInclusive ], [ exchange.batchLedger.publishedSequenceRange.firstSequence, exchange.batchLedger.publishedSequenceRange.lastSequence ], `${ label} does not equal the authoritative batch sequence range` );
		assert.equal( canonicalIntervalIdentity( range.interval ), canonicalIntervalIdentity( exchange.applicationInterval ), `${ label}.interval differs from the authoritative batch interval` );
		const committedSourceDescriptors = candidate.commitProvenance.committedStateVersions.flatMap( ( committed ) => Object.values( signals ).filter( ( descriptor ) => descriptor.signalId === committed.signalId && descriptor.stateVersion === committed.stateVersion && committed.stateVersion === range.sourceStateVersion && descriptor.owner === range.producerId ) );
		assert.equal( committedSourceDescriptors.length, 1, `${ label}.sourceStateVersion does not resolve exactly one producer-owned committed signal` );
		assert.equal( range.payloadDigest, authoritativePresentationEventPayloadDigest( exchange ), `${ label}.payloadDigest does not cover the authoritative batch payloads` );

	}
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
			validateCompletionJoin( lease.reuseProhibitedUntil, lease, `${ label }.resourceLeases[${ index }].reuseProhibitedUntil` );
			leasesById.set( lease.leaseId, lease );
			allowedLeases.set( lease.leaseId, lease );

		}
		allowedLeasesByTargetView.set( targetViewKey, allowedLeases );
		for ( const [ index, ref ] of preparation.resourceLeaseRefs.entries() ) validateLeaseRef( ref, allowedLeases, `${ label }.resourceLeaseRefs[${ index }]` );
		for ( const [ index, shadowRef ] of preparation.shadowViewPublicationRefs.entries() ) {

			const shadowLabel = `${ label }.shadowViewPublicationRefs[${ index }]`;
			requireAbiRecord( shadowRef, 'ShadowViewPublicationRef', shadowLabel );
			assert.deepEqual( [ shadowRef.presentationTargetId, shadowRef.receiverViewId, shadowRef.cameraPublicationId, shadowRef.cameraProjectionRevision ], [ camera.presentationTargetId, camera.viewId, camera.cameraPublicationId, camera.cameraProjectionRevision ], `${ shadowLabel } camera/target scope mismatch` );
			const factor = requireAbiRecord( shadowRef.shadowFactorProvenance, 'ShadowFactorProvenance', `${ shadowLabel}.shadowFactorProvenance` );
			assert.deepEqual( [ factor.shadowViewId, factor.receiverViewId, factor.candidateId, factor.cameraPublicationId, factor.factorSemantics, factor.applicationMultiplicity ], [ shadowRef.shadowViewId, camera.viewId, candidate.candidateId, camera.cameraPublicationId, 'direct-light-visibility', 'exactly-once' ], `${ shadowLabel} shadow-factor provenance mismatch` );
			for ( const [ refIndex, ref ] of shadowRef.resourceLeaseRefs.entries() ) validateLeaseRef( ref, allowedLeases, `${ shadowLabel }.resourceLeaseRefs[${ refIndex }]` );
			if ( ! isTypedAbsence( shadowRef.boundedDelay ) ) validateCanonicalDuration( shadowRef.boundedDelay, context, `${ shadowLabel }.boundedDelay` );

		}
		const actionIds = new Set( preparation.resetDependencies.map( ( action ) => action.actionId ) );
		assertAcyclicDependencies( preparation.resetDependencies, 'actionId', 'dependencies', `${ label}.resetDependencies` );
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
			if ( ! isTypedAbsence( action.inputHistoryLeaseRef ) ) validateLeaseRef( action.inputHistoryLeaseRef, allowedLeases, `${ actionLabel }.inputHistoryLeaseRef` );

		}
		assert.deepEqual( preparation.resetActionResults.map( ( result ) => result.actionId ).sort(), [ ...actionIds ].sort(), `${ label}.resetActionResults must realize every planned action exactly once` );
		assertUnique( preparation.resetActionResults.map( ( result ) => result.resultId ), `${ label}.resetActionResults result IDs` );
		for ( const [ index, result ] of preparation.resetActionResults.entries() ) validateResetActionResult( result, preparation.resetDependencies.find( ( action ) => action.actionId === result.actionId ), allowedLeases, camera, `${ label}.resetActionResults[${ index }]` );
		assertUnique( preparation.requiredPreparationEdges.map( ( edge ) => edge.edgeId ), `${ label}.requiredPreparationEdges` );
		for ( const [ index, edge ] of preparation.requiredPreparationEdges.entries() ) {

			requireAbiRecord( edge, 'PresentationPreparationEdge', `${ label}.requiredPreparationEdges[${ index }]` );
			assert.equal( edge.consumerPublicationId, preparation.viewPreparationId, `${ label}.requiredPreparationEdges[${ index }] consumer mismatch` );
			assert.equal( edge.status, 'satisfied', `${ label}.requiredPreparationEdges[${ index }] is not satisfied before seal` );
			if ( ! isTypedAbsence( edge.resourceLeaseRef ) ) validateLeaseRef( edge.resourceLeaseRef, allowedLeases, `${ label}.requiredPreparationEdges[${ index }].resourceLeaseRef` );
			requireAbiRecord( edge.dependencyRef, 'PhysicsDependencyRef', `${ label}.requiredPreparationEdges[${ index }].dependencyRef` );

		}
		assertUnique( preparation.renderResourceLeases.map( ( lease ) => lease.renderResourceLeaseId ), `${ label}.renderResourceLeases` );
		for ( const [ index, renderLease ] of preparation.renderResourceLeases.entries() ) {

			requireAbiRecord( renderLease, 'RenderResourceLease', `${ label}.renderResourceLeases[${ index }]` );
			assert.deepEqual( [ renderLease.presentationTargetId, renderLease.viewId ], [ camera.presentationTargetId, camera.viewId ], `${ label}.renderResourceLeases[${ index }] target/view mismatch` );
			validateLeaseRef( renderLease.baseLeaseRef, allowedLeases, `${ label}.renderResourceLeases[${ index }].baseLeaseRef` );
			assert.ok( preparation.requiredPreparationEdges.some( ( edge ) => edge.edgeId === renderLease.producerPreparationEdgeId ), `${ label}.renderResourceLeases[${ index }] has no producing preparation edge` );

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
		assert.deepEqual( [ ...snapshot.presentedStatePairRefs ].sort(), [ ...pairIds ].sort(), `${ label } must reference the exact Candidate pair set` );
		const allowedLeases = allowedLeasesByTargetView.get( targetViewKey );
		for ( const [ index, ref ] of snapshot.resourceLeaseRefs.entries() ) {

			validateLeaseRef( ref, allowedLeases, `${ label }.resourceLeaseRefs[${ index }]` );
			snapshotConsumersByLeaseId.get( ref.leaseId ).push( snapshot.snapshotId );

		}
		for ( const forbidden of [ 'presentedStatePairs', 'globalToRenderCurrent', 'globalToRenderPrevious', 'cameraPublication', 'reactivePublications', 'resetDependencies' ] ) assert.ok( ! Object.hasOwn( snapshot, forbidden ), `${ label } copies mutable ${ forbidden } instead of referencing prior publications` );
		assert.ok( ! snapshotIds.has( snapshot.snapshotId ), `${ label } duplicates snapshotId` );
		snapshotIds.add( snapshot.snapshotId );
		const closure = requireAbiRecord( snapshot.closureManifest, 'PresentationClosureManifest', `${ label}.closureManifest` );
		assert.equal( closure.snapshotId, snapshot.snapshotId, `${ label}.closureManifest.snapshotId mismatch` );
		const pairStateHandleLeaseIds = [ ...new Set( snapshot.presentedStatePairRefs.flatMap( ( bindingId ) => {

			const pair = candidate.presentedStatePairs.find( ( candidatePair ) => candidatePair.bindingId === bindingId );
			return [ pair.previousPresented.stateHandle.leaseId, pair.currentPresented.stateHandle.leaseId ];

		} ) ) ].sort();
		const preparationDependencyLeaseIds = [ ...new Set( preparation.requiredPreparationEdges.flatMap( ( edge ) => isTypedAbsence( edge.resourceLeaseRef ) ? [] : [ edge.resourceLeaseRef.leaseId ] ) ) ].sort();
		const reactiveAndResetLeaseIds = [ ...new Set( [
			...preparation.reactivePublications.flatMap( ( publication ) => isTypedAbsence( publication.resourceLeaseId ) ? [] : [ publication.resourceLeaseId ] ),
			...preparation.resetDependencies.flatMap( ( action ) => isTypedAbsence( action.resourceLeaseId ) ? [] : [ action.resourceLeaseId ] ),
			...preparation.resetActionResults.flatMap( ( result ) => [ result.inputHistoryLeaseRef, result.outputHistoryLeaseRef ].flatMap( ( ref ) => isTypedAbsence( ref ) ? [] : [ ref.leaseId ] ) )
		] ) ].sort();
		const shadowCacheVisibilityLeaseIds = [ ...new Set( preparation.shadowViewPublicationRefs.flatMap( ( ref ) => ref.resourceLeaseRefs.map( ( leaseRef ) => leaseRef.leaseId ) ) ) ].sort();
		const exactRequiredLeaseIds = [ ...new Set( [ ...pairStateHandleLeaseIds, ...preparationDependencyLeaseIds, ...reactiveAndResetLeaseIds, ...shadowCacheVisibilityLeaseIds ] ) ].sort();
		const exactEventRangeIds = candidate.eventSequenceRanges.filter( ( range ) => range.consumerId === targetViewKey || range.consumerId === sharedPresentationConsumerId ).map( ( range ) => range.rangeId ).sort();
		for ( const [ key, expected ] of Object.entries( { pairStateHandleLeaseIds, preparationDependencyLeaseIds, reactiveAndResetLeaseIds, shadowCacheVisibilityLeaseIds, exactRequiredLeaseIds, exactEventRangeIds } ) ) assert.deepEqual( [ ...closure[ key ] ].sort(), expected, `${ label}.closureManifest.${ key} is not exact` );
		assert.deepEqual( snapshot.resourceLeaseRefs.map( ( ref ) => ref.leaseId ).sort(), exactRequiredLeaseIds, `${ label}.resourceLeaseRefs do not equal closure lease union` );
		assert.deepEqual( snapshot.eventSequenceRanges.map( ( range ) => range.rangeId ).sort(), exactEventRangeIds, `${ label}.eventSequenceRanges do not equal addressed Candidate event ranges` );
		for ( const range of snapshot.eventSequenceRanges ) assert.deepEqual( range, candidate.eventSequenceRanges.find( ( candidateRange ) => candidateRange.rangeId === range.rangeId ), `${ label} invents or mutates event range ${ range.rangeId }` );
		assert.equal( closure.dependencyDagDigest, dependencyDagDigest( preparation ), `${ label}.closureManifest.dependencyDagDigest mismatch` );
		assert.equal( closure.closureDigest, closureManifestDigest( closure ), `${ label}.closureManifest.closureDigest mismatch` );

	}
	const renderPlans = route.physicsPresentationRenderPlansByTarget;
	assert.deepEqual( Object.keys( renderPlans ).sort(), Object.keys( snapshots ).sort(), 'every sealed snapshot requires exactly one keyed PresentationRenderPlan' );
	for ( const [ targetViewKey, plan ] of Object.entries( renderPlans ) ) validateRenderPlan( plan, targetViewKey, route, preparations[ targetViewKey ], snapshots[ targetViewKey ], `physicsPresentationRenderPlansByTarget.${ targetViewKey}` );
	assertUnique( Object.values( renderPlans ).map( ( plan ) => plan.renderPlanId ), 'presentation renderPlanIds' );
	assertUnique( Object.values( renderPlans ).flatMap( ( plan ) => plan.phaseIds ), 'presentation execution-level phaseIds' );
	assertUnique( Object.values( renderPlans ).flatMap( ( plan ) => plan.edges.map( ( edge ) => edge.edgeId ) ), 'presentation execution-level render edgeIds' );
	assertUnique( Object.values( renderPlans ).flatMap( ( plan ) => plan.edges.map( ( edge ) => edge.dependencyRef.dependencyId ) ), 'presentation execution-level render dependencyIds' );
	assertUnique( Object.values( renderPlans ).flatMap( ( plan ) => plan.edges.map( ( edge ) => edge.completionRef.completionId ) ), 'presentation execution-level render completionIds' );
	return { leasesById, snapshotIds, snapshotConsumersByLeaseId, renderPlans, timeCohort };

}

function validateCanonicalExecution( execution, route, presentation ) {

	requireAbiRecord( execution, 'FrameExecutionRecord', 'frameExecutionRecord' );
	assert.deepEqual( execution.candidateIds, [ route.physicsPresentationCandidate.candidateId ], 'frameExecutionRecord.candidateIds mismatch' );
	assert.equal( execution.timeCohortId, presentation.timeCohort.timeCohortId, 'frameExecutionRecord.timeCohortId mismatch' );
	requireAbiEnum( execution.overallStatus, 'executionStatuses', 'frameExecutionRecord.overallStatus' );
	const exactTargetKeys = Object.keys( route.physicsCameraViewPublicationsByTarget ).sort();
	assert.deepEqual( [ ...execution.requiredTargetViewKeys ].sort(), exactTargetKeys, 'frameExecutionRecord.requiredTargetViewKeys must equal the camera target/view set' );
	assert.deepEqual( Object.keys( execution.targetExecutions ).sort(), exactTargetKeys, 'frameExecutionRecord must contain exactly one target execution per camera target/view' );
	assert.ok( execution.snapshotIds.every( ( id ) => presentation.snapshotIds.has( id ) ), 'frameExecutionRecord references unknown snapshot' );
	assert.deepEqual( [ ...execution.snapshotIds ].sort(), Object.values( route.physicsPresentationSnapshotsByTarget ).map( ( snapshot ) => snapshot.snapshotId ).sort(), 'frameExecutionRecord.snapshotIds must equal every actually sealed route snapshot' );
	const targetSnapshotIds = Object.values( execution.targetExecutions ).filter( ( target ) => ! isTypedAbsence( target.snapshotId ) ).map( ( target ) => target.snapshotId ).sort();
	assert.deepEqual( [ ...execution.snapshotIds ].sort(), targetSnapshotIds, 'frameExecutionRecord.snapshotIds must equal successful target snapshot IDs exactly' );
	const cohort = requireAbiRecord( execution.cohortAdmission, 'FrameCohortAdmission', 'frameExecutionRecord.cohortAdmission' );
	assert.equal( cohort.status, 'admitted', 'frameExecutionRecord cannot submit a rejected cohort' );
	assert.equal( cohort.timeCohortId, execution.timeCohortId, 'frameExecutionRecord.cohortAdmission time-cohort mismatch' );
	assert.deepEqual( [ ...cohort.requiredTargetViewKeys ].sort(), exactTargetKeys, 'frameExecutionRecord.cohortAdmission target closure mismatch' );
	assert.deepEqual( [ ...cohort.candidateIds ].sort(), [ ...execution.candidateIds ].sort(), 'frameExecutionRecord.cohortAdmission Candidate closure mismatch' );
	assert.deepEqual( [ ...cohort.snapshotIds ].sort(), [ ...execution.snapshotIds ].sort(), 'frameExecutionRecord.cohortAdmission snapshot closure mismatch' );
	assert.ok( canonicalDurationSecondsValue( cohort.observedMaximumSkew, route.physicsContext, 'frameExecutionRecord.cohortAdmission.observedMaximumSkew' ) <= canonicalDurationSecondsValue( presentation.timeCohort.maximumInterContextSkew, route.physicsContext, 'presentationTimeCohort.maximumInterContextSkew' ), 'frameExecutionRecord.cohortAdmission observed skew exceeds the cohort gate' );
	const plansById = new Map();
	for ( const [ index, plan ] of execution.renderPlans.entries() ) {

		requireAbiRecord( plan, 'PresentationRenderPlan', `frameExecutionRecord.renderPlans[${ index }]` );
		const routePlan = Object.values( presentation.renderPlans ).find( ( candidatePlan ) => candidatePlan.renderPlanId === plan.renderPlanId );
		assert.ok( routePlan && plan.immutablePlanDigest === routePlan.immutablePlanDigest, `frameExecutionRecord.renderPlans[${ index }] is not the sealed route plan` );
		plansById.set( plan.renderPlanId, plan );

	}
	assert.deepEqual( [ ...plansById.keys() ].sort(), Object.values( presentation.renderPlans ).map( ( plan ) => plan.renderPlanId ).sort(), 'frameExecutionRecord render-plan closure mismatch' );
	assert.deepEqual( [ ...cohort.renderPlanIds ].sort(), [ ...plansById.keys() ].sort(), 'frameExecutionRecord.cohortAdmission render-plan closure mismatch' );
	for ( const key of exactTargetKeys ) {

		assert.ok( Number.isSafeInteger( cohort.configuredMaximumFramesInFlightByTarget[ key ] ) && cohort.configuredMaximumFramesInFlightByTarget[ key ] > 0, `frameExecutionRecord.cohortAdmission ${ key} has invalid configured frames in flight` );
		assert.ok( Number.isSafeInteger( cohort.observedFramesInFlightByTarget[ key ] ) && cohort.observedFramesInFlightByTarget[ key ] >= 0, `frameExecutionRecord.cohortAdmission ${ key} has invalid observed frames in flight` );
		assert.ok( cohort.observedFramesInFlightByTarget[ key ] < cohort.configuredMaximumFramesInFlightByTarget[ key ], `frameExecutionRecord.cohortAdmission ${ key} admits a saturated target` );
		assert.ok( [ 'stall', 'drop-unsubmitted', 'reject-admission' ].includes( cohort.saturationPolicyByTarget[ key ] ), `frameExecutionRecord.cohortAdmission ${ key} has invalid saturation policy` );

	}
	const slotsById = new Map();
	const slotIdsByTargetViewKey = new Map();
	for ( const [ index, slot ] of execution.slotAdmissions.entries() ) {

		const label = `frameExecutionRecord.slotAdmissions[${ index }]`;
		requireAbiRecord( slot, 'FrameSlotAdmission', label );
		assert.equal( slot.status, 'admitted', `${ label} is not admitted` );
		assert.equal( slot.cohortAdmissionId, cohort.cohortAdmissionId, `${ label}.cohortAdmissionId mismatch` );
		assert.equal( slot.targetFrameSequence, cohort.targetFrameSequence, `${ label}.targetFrameSequence mismatch` );
		const key = `${ slot.presentationTargetId }/${ slot.viewId }`;
		assert.ok( exactTargetKeys.includes( key ), `${ label} has unknown target/view` );
		assert.equal( slot.configuredMaximumFramesInFlight, cohort.configuredMaximumFramesInFlightByTarget[ key ], `${ label} configured capacity mismatch` );
		assert.equal( slot.observedFramesInFlightAtAdmission, cohort.observedFramesInFlightByTarget[ key ], `${ label} observed capacity mismatch` );
		assert.ok( slot.observedFramesInFlightAtAdmission < slot.configuredMaximumFramesInFlight, `${ label} reuses a saturated frame slot` );
		assert.equal( slot.saturationPolicy, cohort.saturationPolicyByTarget[ key ], `${ label} saturation policy mismatch` );
		assert.ok( Number.isSafeInteger( slot.frameSlotIndex ) && slot.frameSlotIndex >= 0, `${ label}.frameSlotIndex must be structural` );
		assert.equal( isTypedAbsence( slot.priorOccupantExecutionId ), isTypedAbsence( slot.priorSlotCompletionJoin ), `${ label} prior occupant and completion join must be present together` );
		if ( ! isTypedAbsence( slot.priorSlotCompletionJoin ) ) assert.equal( slot.priorSlotCompletionJoin.joinPredicate, 'all-required-consumers-complete-or-loss-invalidated', `${ label} prior slot completion join is not terminal` );
		assertUnique( slot.requiredRenderResourceLeaseIds, `${ label}.requiredRenderResourceLeaseIds` );
		assert.ok( ! slotsById.has( slot.slotAdmissionId ), `${ label} duplicates slotAdmissionId` );
		assert.ok( ! slotIdsByTargetViewKey.has( key ), `${ label} duplicates target/view slot admission` );
		slotsById.set( slot.slotAdmissionId, slot );
		slotIdsByTargetViewKey.set( key, slot.slotAdmissionId );

	}
	assert.deepEqual( [ ...slotIdsByTargetViewKey.keys() ].sort(), Object.keys( presentation.renderPlans ).sort(), 'frameExecutionRecord slot admissions must equal the sealed/scheduled target set' );
	for ( const [ key, target ] of Object.entries( execution.targetExecutions ) ) {

		const label = `frameExecutionRecord.targetExecutions.${ key}`;
		requireAbiRecord( target, 'TargetExecution', label );
		requireAbiEnum( target.status, 'targetExecutionStatuses', `${ label }.status` );
		assert.deepEqual( [ target.presentationTargetId, target.viewId ], key.split( '/' ), `${ label} target/view scope mismatch` );
		const keyedSnapshot = route.physicsPresentationSnapshotsByTarget[ key ];
		if ( [ 'aborted', 'failed' ].includes( target.status ) ) {

			assert.ok( isTypedAbsence( target.snapshotId ), `${ label } failed/aborted target cannot retain a sealed snapshot` );
			assert.deepEqual( target.submittedPasses, [], `${ label } pre-seal failure cannot submit passes` );
			assert.deepEqual( target.queueSubmissionEpochs, [], `${ label } pre-seal failure cannot submit a queue epoch` );
			assert.deepEqual( target.resetActionResults, [], `${ label } pre-seal failure cannot execute reset actions` );
			assert.deepEqual( target.completionTokens, [], `${ label } pre-seal failure cannot fabricate completion tokens` );
			assert.ok( isTypedAbsence( target.renderPlanId ) && isTypedAbsence( target.slotAdmissionId ), `${ label } pre-seal failure cannot fabricate a plan or slot admission` );
			assert.ok( isTypedAbsence( target.presentedTimestamp ), `${ label } pre-seal failure cannot have a presented timestamp` );
			assert.ok( ! isTypedAbsence( target.failure ), `${ label } pre-seal failure lacks a failure record` );

		} else {

			assert.ok( keyedSnapshot, `${ label } has no snapshot chain for its target/view key` );
			assert.ok( presentation.snapshotIds.has( target.snapshotId ), `${ label } references unknown snapshot` );
			assert.equal( target.snapshotId, keyedSnapshot.snapshotId, `${ label } swaps another target/view snapshot` );
			const plan = plansById.get( target.renderPlanId );
			const slot = slotsById.get( target.slotAdmissionId );
			assert.ok( plan && `${ plan.presentationTargetId }/${ plan.viewId }` === key, `${ label} references the wrong render plan` );
			assert.ok( slot && `${ slot.presentationTargetId }/${ slot.viewId }` === key, `${ label} references the wrong frame slot` );
			assert.deepEqual( target.submittedPasses, plan.phaseRecords.map( ( phase ) => phase.passOrDispatchKey ), `${ label}.submittedPasses do not realize the immutable plan` );
			assert.deepEqual( target.resetActionResults, route.physicsViewPreparationPublicationsByTarget[ key ].resetActionResults, `${ label}.resetActionResults mismatch` );
			assert.ok( target.queueSubmissionEpochs.length > 0 && target.queueSubmissionEpochs.every( ( epoch ) => typeof epoch === 'string' && epoch.length > 0 ), `${ label } sealed target lacks queue-submission evidence` );
			if ( target.status === 'device-lost' ) {

				assert.ok( ! isTypedAbsence( target.failure ), `${ label } device loss lacks a failure record` );
				assert.deepEqual( target.completionTokens, [], `${ label } device loss cannot fabricate terminal completion tokens` );
				assert.ok( isTypedAbsence( target.presentedTimestamp ), `${ label } loss-before-present cannot carry a presented timestamp` );

			} else if ( target.status === 'submitted' ) {

				assert.ok( isTypedAbsence( target.failure ), `${ label } submitted target carries a failure` );
				assert.deepEqual( target.completionTokens, [], `${ label } submitted target cannot carry completion tokens` );
				assert.ok( isTypedAbsence( target.presentedTimestamp ), `${ label } submitted target cannot be marked presented` );

			} else {

				assert.equal( target.status, 'completed', `${ label } sealed target has unsupported status` );
				assert.ok( isTypedAbsence( target.failure ), `${ label } completed target carries a failure` );
				assert.ok( ! isTypedAbsence( target.presentedTimestamp ), `${ label } completed target lacks a presented timestamp` );
				assert.ok( target.completionTokens.length > 0, `${ label } completed target lacks completion tokens` );

			}
			for ( const token of target.completionTokens ) {

				requireAbiRecord( token, 'CompletionTokenRef', `${ label}.completionTokens.${ token.tokenId}` );
				assert.deepEqual( [ token.consumerKind, token.executionId, token.presentationTargetId, token.viewId, token.snapshotId, token.queueSubmissionEpoch, token.backendGeneration, token.deviceLossGeneration ], [ 'presentation', execution.executionId, target.presentationTargetId, target.viewId, target.snapshotId, target.queueSubmissionEpochs[ 0 ], execution.backendGeneration, execution.deviceLossGeneration ], `${ label} has an unrelated completion token` );

			}

		}

	}
	const targetStatuses = Object.values( execution.targetExecutions ).map( ( target ) => target.status );
	const completedCount = targetStatuses.filter( ( status ) => status === 'completed' ).length;
	const submittedCount = targetStatuses.filter( ( status ) => status === 'submitted' ).length;
	const failedCount = targetStatuses.filter( ( status ) => [ 'failed', 'aborted', 'device-lost' ].includes( status ) ).length;
	if ( execution.overallStatus === 'completed' ) assert.equal( completedCount, targetStatuses.length, 'completed frame execution requires every target completed' );
	if ( execution.overallStatus === 'submitted' ) assert.ok( submittedCount > 0 && failedCount === 0, 'submitted frame execution status algebra mismatch' );
	if ( execution.overallStatus === 'partial-failure' ) assert.ok( failedCount > 0 && completedCount + submittedCount > 0, 'partial-failure frame execution status algebra mismatch' );
	if ( execution.overallStatus === 'aborted' ) assert.ok( execution.snapshotIds.length === 0 && submittedCount + completedCount === 0, 'aborted frame execution status algebra mismatch' );
	if ( execution.overallStatus === 'device-lost' ) assert.equal( targetStatuses.filter( ( status ) => status === 'device-lost' ).length, targetStatuses.length, 'device-lost status requires every target lost in the same execution' );
	assert.deepEqual( Object.keys( execution.leaseDispositionById ).sort(), [ ...presentation.leasesById.keys() ].sort(), 'frameExecutionRecord must disposition every candidate lease by leaseId' );
	const preSealFailedTargetKeys = new Set( Object.entries( execution.targetExecutions ).filter( ( [ , target ] ) => [ 'failed', 'aborted' ].includes( target.status ) && isTypedAbsence( target.snapshotId ) ).map( ( [ key ] ) => key ) );
	for ( const [ leaseId, disposition ] of Object.entries( execution.leaseDispositionById ) ) {

		const label = `frameExecutionRecord.leaseDispositionById.${ leaseId}`;
		requireAbiRecord( disposition, 'LeaseDisposition', label );
		requireAbiEnum( disposition.disposition, 'leaseDispositions', `${ label }.disposition` );
		const lease = presentation.leasesById.get( leaseId );
		requireAbiRecord( disposition.completionJoin, 'ConsumerCompletionJoin', `${ label }.completionJoin` );
		validateCompletionJoin( disposition.completionJoin, lease, `${ label }.completionJoin` );
		assert.deepEqual( disposition.completionJoin, lease.reuseProhibitedUntil, `${ label} completion join does not match the immutable lease join` );
		assert.ok( disposition.consumingSnapshotIds.every( ( id ) => presentation.snapshotIds.has( id ) ), `${ label } references unknown consuming snapshot` );
		assert.deepEqual( [ ...disposition.consumingSnapshotIds ].sort(), [ ...presentation.snapshotConsumersByLeaseId.get( leaseId ) ].sort(), `${ label } completion join omits or invents a snapshot consumer` );
		if ( execution.overallStatus === 'device-lost' ) {

			assert.equal( disposition.disposition, 'invalidated-by-device-loss', `${ label } must invalidate on device loss` );
			assert.equal( execution.deviceLossGeneration, lease.deviceLossGeneration, `${ label } does not identify the lost device generation` );
			requireObjectKeys( disposition.retirementEvidence, [ 'lostDeviceLossGeneration', 'lostResourceGeneration' ], `${ label }.retirementEvidence` );
			assert.equal( disposition.retirementEvidence.lostDeviceLossGeneration, lease.deviceLossGeneration, `${ label } loss-generation evidence mismatch` );
			assert.equal( disposition.retirementEvidence.lostResourceGeneration, lease.resourceGeneration, `${ label } resource-generation evidence mismatch` );

		} else {

			const expectedCancelled = lease.reuseProhibitedUntil.presentationConsumers.filter( ( consumer ) => preSealFailedTargetKeys.has( `${ consumer.presentationTargetId }/${ consumer.viewId }` ) ).map( ( consumer ) => consumer.consumerKey ).sort();
			requireObjectKeys( disposition.retirementEvidence, [ 'completedConsumerKeys', 'cancelledConsumerKeys', 'joinResolution' ], `${ label }.retirementEvidence` );
			assert.deepEqual( [ ...disposition.retirementEvidence.cancelledConsumerKeys ].sort(), expectedCancelled, `${ label } does not close aborted target reservations` );
			const expectedCompleted = lease.reuseProhibitedUntil.requiredConsumerKeys.filter( ( key ) => ! expectedCancelled.includes( key ) ).sort();
			assert.deepEqual( [ ...disposition.retirementEvidence.completedConsumerKeys ].sort(), expectedCompleted, `${ label } does not close completed consumer reservations` );
			assert.equal( disposition.retirementEvidence.joinResolution, 'completed-or-reservation-cancelled', `${ label } has no terminal join resolution` );
			assert.deepEqual( [ ...new Set( [ ...expectedCompleted, ...expectedCancelled ] ) ].sort(), [ ...lease.reuseProhibitedUntil.requiredConsumerKeys ].sort(), `${ label } terminal evidence does not cover the immutable join` );
			if ( disposition.disposition === 'retired-after-abort' ) assert.ok( disposition.consumingSnapshotIds.length === 0 && expectedCancelled.length > 0, `${ label } retires without an aborted reservation` );

		}

	}
	if ( execution.overallStatus === 'device-lost' ) for ( const [ key, target ] of Object.entries( execution.targetExecutions ) ) assert.equal( target.status, 'device-lost', `frameExecutionRecord.targetExecutions.${ key} must identify the affected target as device-lost` );

}

function validateCanonicalCostLedger( ledger, graph, context, route ) {

	requireAbiRecord( ledger, 'PhysicsCostLedger', 'physicsCostLedger' );
	assert.equal( ledger.contextId, graph.contextId, 'physicsCostLedger.contextId mismatch' );
	assert.equal( ledger.graphId, graph.graphId, 'physicsCostLedger.graphId mismatch' );
	assert.equal( ledger.graphRevision, graph.executionLedger.graphRevision, 'physicsCostLedger.graphRevision mismatch' );
	validateCanonicalInterval( ledger.measurementInterval, context, 'physicsCostLedger.measurementInterval' );
	assert.equal( ledger.measurementClockId, ledger.measurementInterval.clockId, 'physicsCostLedger measurement clock mismatch' );
	assert.equal( ledger.status, 'active', 'physicsCostLedger is not active' );
	assert.ok( ledger.presentationTargetsAndViews.length > 0 && ledger.measurementProtocolRefs.length > 0, 'physicsCostLedger omits target/view or trace identity' );
	assertUnique( ledger.presentationTargetsAndViews, 'physicsCostLedger.presentationTargetsAndViews' );
	assert.deepEqual( [ ...ledger.presentationTargetsAndViews ].sort(), Object.keys( route.physicsCameraViewPublicationsByTarget ).sort(), 'physicsCostLedger target/view closure differs from presentation cameras' );
	requireAbiRecord( ledger.harness, 'PhysicsCostHarness', 'physicsCostLedger.harness' );
	const totals = requireAbiRecord( ledger.cadenceTraceTotals, 'CadenceTraceTotals', 'physicsCostLedger.cadenceTraceTotals' );
	assert.equal( canonicalIntervalIdentity( totals.measurementInterval ), canonicalIntervalIdentity( ledger.measurementInterval ), 'cadence trace and cost ledger use different measurement intervals' );
	assert.ok( ledger.measurementProtocolRefs.includes( totals.traceRef ), 'cadence trace is absent from the cost-ledger protocol refs' );
	validateCanonicalDuration( totals.exactDuration, context, 'physicsCostLedger.cadenceTraceTotals.exactDuration' );
	const measurementBounds = intervalBoundsSeconds( ledger.measurementInterval, context, 'physicsCostLedger.measurementInterval' );
	const exactDuration = quantityValue( totals.exactDuration.seconds, 'physicsCostLedger.cadenceTraceTotals.exactDuration.seconds' );
	assert.ok( Math.abs( exactDuration - ( measurementBounds[ 1 ] - measurementBounds[ 0 ] ) ) <= 1e-12, 'cadence trace exact duration disagrees with clock endpoints' );
	const exactIntervals = quantityValue( totals.coordinationAdvanceCount, 'physicsCostLedger.cadenceTraceTotals.coordinationAdvanceCount' );
	assert.ok( Number.isSafeInteger( exactIntervals ) && exactIntervals > 0, 'cadence trace coordination count must be a positive integer' );
	const catchUpBatchCount = quantityValue( totals.catchUpBatchCount, 'physicsCostLedger.cadenceTraceTotals.catchUpBatchCount' );
	assert.ok( Number.isSafeInteger( catchUpBatchCount ) && catchUpBatchCount >= 0, 'cadence trace catch-up count must be a nonnegative integer' );
	assert.ok( Array.isArray( totals.droppedCoordinationIntervals ), 'cadence trace droppedCoordinationIntervals must be an array' );
	assertUnique( totals.droppedCoordinationIntervals.map( canonicalIntervalIdentity ), 'cadence trace dropped coordination intervals' );
	let priorDroppedTraceEnd = - Infinity;
	for ( const [ index, interval ] of totals.droppedCoordinationIntervals.entries() ) {

		validateCanonicalInterval( interval, context, `physicsCostLedger.cadenceTraceTotals.droppedCoordinationIntervals[${ index }]` );
		assert.equal( interval.clockId, graph.catchUpPolicy.debtClockId, `physicsCostLedger.cadenceTraceTotals.droppedCoordinationIntervals[${ index }] uses another debt clock` );
		const bounds = intervalBoundsSeconds( interval, context, `physicsCostLedger.cadenceTraceTotals.droppedCoordinationIntervals[${ index }]` );
		assert.ok( bounds[ 0 ] >= priorDroppedTraceEnd - 1e-12, 'cadence trace dropped coordination intervals overlap or are out of order' );
		priorDroppedTraceEnd = bounds[ 1 ];
		const whollyInside = bounds[ 0 ] >= measurementBounds[ 0 ] && bounds[ 1 ] <= measurementBounds[ 1 ];
		const whollyOutside = bounds[ 1 ] <= measurementBounds[ 0 ] || bounds[ 0 ] >= measurementBounds[ 1 ];
		assert.ok( whollyInside || whollyOutside, 'cadence trace contains a partially overlapping dropped coordination interval' );

	}
	if ( catchUpBatchCount === 0 ) assert.deepEqual( totals.droppedCoordinationIntervals, [], 'zero catch-up batches cannot report dropped coordination intervals' );
	if ( totals.droppedCoordinationIntervals.length > 0 ) assert.ok( catchUpBatchCount > 0, 'dropped coordination intervals have no catch-up batch count' );
	if ( ! isTypedAbsence( graph.catchUpBatch ) ) {

		const observedAtSeconds = canonicalInstantSeconds( graph.catchUpBatch.debtIdentity.observedAt, context, 'physicsGraph.catchUpBatch.debtIdentity.observedAt' );
		const batchBelongsToTrace = observedAtSeconds >= measurementBounds[ 0 ] && observedAtSeconds < measurementBounds[ 1 ];
		if ( batchBelongsToTrace ) assert.ok( catchUpBatchCount > 0, 'measured catch-up batch is absent from exact cadence totals' );
		if ( ! isTypedAbsence( graph.catchUpBatch.lossLedger ) ) {

			const traceDroppedRangeIds = totals.droppedCoordinationIntervals.map( canonicalIntervalIdentity );
			for ( const dropped of graph.catchUpBatch.lossLedger.droppedIntervals ) if ( batchBelongsToTrace ) assert.ok( traceDroppedRangeIds.includes( canonicalIntervalIdentity( dropped ) ), 'catch-up loss interval is absent from exact cadence totals' );

		}

	}
	const digestPayload = clone( totals );
	delete digestPayload.exactTotalsDigest;
	assert.equal( totals.exactTotalsDigest, sha256Canonical( digestPayload ), 'cadence trace exact-totals digest mismatch' );
	const stageIds = graph.stages.map( ( stage ) => stage.stageId );
	assertUnique( stageIds, 'physicsGraph stage IDs for cost accounting' );
	for ( const mapKey of [ 'stageExecutionCounts', 'stageExecutionsPerCoordinationInterval', 'stageExecutionsPerSecond', 'executionsPerPresentedFrame', 'hotBytesReadWrittenPerExecution' ] ) assert.deepEqual( Object.keys( mapKey === 'stageExecutionCounts' ? totals[ mapKey ] : ledger[ mapKey ] ).sort(), [ ...stageIds ].sort(), `physicsCostLedger.${ mapKey} stage-key closure mismatch` );
	assert.deepEqual( ledger.graphStageCosts.map( ( cost ) => cost.stageId ).sort(), [ ...stageIds ].sort(), 'physicsCostLedger.graphStageCosts stage-key closure mismatch' );
	for ( const cost of ledger.graphStageCosts ) {

		const sampleCount = quantityValue( cost.sampleCount, `physicsCostLedger.${ cost.stageId }.sampleCount` );
		assert.ok( sampleCount > 0, `physicsCostLedger.${ cost.stageId } has no timing samples` );
		assert.equal( sampleCount, quantityValue( totals.stageExecutionCounts[ cost.stageId ], `cadenceTraceTotals.stageExecutionCounts.${ cost.stageId }` ), `physicsCostLedger.${ cost.stageId } timing sample does not cover every exact execution` );

	}
	assert.deepEqual( ledger.solverDispatches.map( ( dispatch ) => dispatch.stageId ).sort(), [ ...stageIds ].sort(), 'solver/dispatch accounting omits graph stages' );
	for ( const dispatch of ledger.solverDispatches ) assert.equal( quantityValue( dispatch.occurrenceCount, `${ dispatch.stageId }.dispatchCount` ), quantityValue( totals.stageExecutionCounts[ dispatch.stageId ], `${ dispatch.stageId }.traceCount` ), `solver/dispatch count mismatch for ${ dispatch.stageId }` );
	const exactFramesByTarget = Object.fromEntries( Object.entries( totals.presentedFrameCounts ).map( ( [ key, value ] ) => [ key, quantityValue( value, `cadenceTraceTotals.presentedFrameCounts.${ key}` ) ] ) );
	assert.deepEqual( Object.keys( exactFramesByTarget ).sort(), [ ...ledger.presentationTargetsAndViews ].sort(), 'cadence trace presented-frame target closure mismatch' );
	assert.ok( Object.values( exactFramesByTarget ).every( ( count ) => Number.isSafeInteger( count ) && count > 0 ), 'cadence trace presented-frame counts must be positive integers' );
	const resolvePresentedFrameDenominator = ( cadence, label ) => {

		assert.ok( isPlainObject( cadence ), `${ label } must be a mapping` );
		if ( Object.hasOwn( cadence, 'denominatorTargetViewKey' ) ) {

			requireNonEmptyString( cadence.denominatorTargetViewKey, `${ label }.denominatorTargetViewKey` );
			assert.ok( Object.hasOwn( exactFramesByTarget, cadence.denominatorTargetViewKey ), `${ label } names unknown presented-frame denominator ${ cadence.denominatorTargetViewKey}` );
			return exactFramesByTarget[ cadence.denominatorTargetViewKey ];

		}

		const distinctFrameCounts = new Set( Object.values( exactFramesByTarget ) );
		assert.equal( distinctFrameCounts.size, 1, `${ label } must declare denominatorTargetViewKey when target/views have independent presented-frame counts` );
		return Math.min( ...distinctFrameCounts );

	};
	const intervalsPerSecond = quantityValue( ledger.coordinationIntervalsPerSecond.exactMean, 'physicsCostLedger.coordinationIntervalsPerSecond.exactMean' );
	const intervalsPerFrame = quantityValue( ledger.coordinationIntervalsPerPresentedFrame.exactRatio, 'physicsCostLedger.coordinationIntervalsPerPresentedFrame.exactRatio' );
	const intervalFrameDenominator = resolvePresentedFrameDenominator( ledger.coordinationIntervalsPerPresentedFrame, 'physicsCostLedger.coordinationIntervalsPerPresentedFrame' );
	assert.ok( Math.abs( intervalsPerSecond - exactIntervals / exactDuration ) <= 1e-12, 'coordination intervals/second is not derived from exact trace totals' );
	assert.ok( Math.abs( intervalsPerFrame - exactIntervals / intervalFrameDenominator ) <= 1e-12, 'coordination intervals/frame is not derived from exact trace totals and its declared target/view denominator' );
	assert.ok( quantityValue( ledger.coordinationIntervalsPerSecond.p50, 'physicsCostLedger.coordinationIntervalsPerSecond.p50' ) > 0, 'measured p50 coordination cadence must be positive' );
	assert.ok( quantityValue( ledger.coordinationIntervalsPerPresentedFrame.p95, 'physicsCostLedger.coordinationIntervalsPerPresentedFrame.p95' ) > 0, 'measured p95 coordination/frame cadence must be positive' );
	for ( const stageId of stageIds ) {

		const exactExecutions = quantityValue( totals.stageExecutionCounts[ stageId ], `cadenceTraceTotals.stageExecutionCounts.${ stageId }` );
		const perInterval = quantityValue( ledger.stageExecutionsPerCoordinationInterval[ stageId ].count, `physicsCostLedger.stageExecutionsPerCoordinationInterval.${ stageId }` );
		const perSecond = quantityValue( ledger.stageExecutionsPerSecond[ stageId ].count, `physicsCostLedger.stageExecutionsPerSecond.${ stageId }` );
		const perFrameCadence = ledger.executionsPerPresentedFrame[ stageId ];
		const perFrame = quantityValue( perFrameCadence.count, `physicsCostLedger.executionsPerPresentedFrame.${ stageId }` );
		const stageFrameDenominator = resolvePresentedFrameDenominator( perFrameCadence, `physicsCostLedger.executionsPerPresentedFrame.${ stageId }` );
		assert.ok( Number.isSafeInteger( exactExecutions ) && exactExecutions > 0, `cadence trace ${ stageId } execution count must be a positive integer` );
		assert.ok( Math.abs( perInterval - exactExecutions / exactIntervals ) <= 1e-12, `physicsCostLedger ${ stageId } per-interval cadence is not exact-total/advance-count` );
		assert.ok( Math.abs( perSecond - exactExecutions / exactDuration ) <= 1e-12, `physicsCostLedger ${ stageId } per-second cadence is not exact-total/duration` );
		assert.ok( Math.abs( perFrame - exactExecutions / stageFrameDenominator ) <= 1e-12, `physicsCostLedger ${ stageId } per-frame cadence is not exact-total/declared-target-view-frame-count` );

	}
	const nativeSubcycleTotalsByOwner = {};
	for ( const stage of graph.stages.filter( ( candidate ) => candidate.executionRule.partition === 'exact-subcycle-tile' ) ) nativeSubcycleTotalsByOwner[ stage.owner ] = ( nativeSubcycleTotalsByOwner[ stage.owner ] ?? 0 ) + quantityValue( totals.stageExecutionCounts[ stage.stageId ], `cadenceTraceTotals.stageExecutionCounts.${ stage.stageId }` );
	assert.deepEqual( Object.keys( totals.nativeSubcycleCounts ).sort(), Object.keys( nativeSubcycleTotalsByOwner ).sort(), 'native-subcycle owner closure mismatch' );
	for ( const [ owner, exactOwnerExecutions ] of Object.entries( nativeSubcycleTotalsByOwner ) ) assert.equal( quantityValue( totals.nativeSubcycleCounts[ owner ], `cadenceTraceTotals.nativeSubcycleCounts.${ owner}` ), exactOwnerExecutions, `native-subcycle exact total for ${ owner } differs from exact subcycle-stage executions` );
	assert.deepEqual( Object.keys( totals.couplingIterationCounts ).sort(), graph.loopMacros.map( ( loop ) => loop.loopId ).sort(), 'coupling-iteration loop closure mismatch' );
	for ( const loop of graph.loopMacros ) {

		const referenceStage = loop.orderedStageIds.map( ( stageId ) => graph.stages.find( ( stage ) => stage.stageId === stageId ) ).find( ( stage ) => stage?.executionRule.activation === 'per-loop-iteration' && stage.executionRule.partition !== 'exact-subcycle-tile' );
		const exactIterations = quantityValue( totals.couplingIterationCounts[ loop.loopId ], `cadenceTraceTotals.couplingIterationCounts.${ loop.loopId }` );
		assert.ok( Number.isSafeInteger( exactIterations ) && exactIterations > 0, `cadence trace ${ loop.loopId } iteration total must be a positive integer` );
		if ( referenceStage ) assert.equal( exactIterations, quantityValue( totals.stageExecutionCounts[ referenceStage.stageId ], `cadenceTraceTotals.stageExecutionCounts.${ referenceStage.stageId }` ), `cadence trace ${ loop.loopId } iteration total differs from exact ${ referenceStage.stageId } activations` );

	}
	const interactionCountsByTag = {};
	const interactionsById = new Map( route.physicsInteractions.flatMap( ( exchange ) => [ ...exchange.interactions, ...exchange.reactions ] ).map( ( interaction ) => [ interaction.interactionId, interaction ] ) );
	for ( const application of graph.executionLedger.interactionApplicationLedgers ) {

		const interaction = interactionsById.get( application.interactionId );
		assert.ok( interaction, `cost trace application ${ application.applicationLedgerId } references unknown ${ application.interactionId }; known=${ [ ...interactionsById.keys() ].join( ',' ) }` );
		interactionCountsByTag[ interaction.payload.tag ] = ( interactionCountsByTag[ interaction.payload.tag ] ?? 0 ) + 1;

	}
	assert.deepEqual( Object.keys( totals.interactionApplicationCounts ).sort(), Object.keys( interactionCountsByTag ).sort(), 'cadence trace interaction-payload tag closure mismatch' );
	for ( const [ tag, currentAdvanceCount ] of Object.entries( interactionCountsByTag ) ) {

		const exactApplications = quantityValue( totals.interactionApplicationCounts[ tag ], `cadenceTraceTotals.interactionApplicationCounts.${ tag }` );
		assert.ok( Number.isSafeInteger( exactApplications ) && exactApplications >= currentAdvanceCount, `cadence trace ${ tag } application total omits the serialized advance` );

	}
	requireAbiRecord( ledger.worstPermittedCatchUpCost, 'PhysicsWorstPermittedCatchUpCost', 'physicsCostLedger.worstPermittedCatchUpCost' );
	requireObjectKeys( ledger.tileGpuTraffic, [ 'attachmentStoreLoadResolveBytes', 'tileSpillEvidence', 'renderComputePassBreaks' ], 'physicsCostLedger.tileGpuTraffic' );
	assert.ok( ledger.dependencyCriticalPaths.length > 0, 'physicsCostLedger has no dependency critical-path evidence' );
	for ( const [ index, path ] of ledger.dependencyCriticalPaths.entries() ) assert.ok( quantityValue( path.p95, `physicsCostLedger.dependencyCriticalPaths[${ index }].p95` ) >= 0, 'dependency critical-path time is invalid' );
	const queueSubmissions = quantityValue( ledger.queueSubmissionsAndPassBreaks.submissions, 'physicsCostLedger.queueSubmissionsAndPassBreaks.submissions' );
	const queueBreaks = quantityValue( ledger.queueSubmissionsAndPassBreaks.breaks, 'physicsCostLedger.queueSubmissionsAndPassBreaks.breaks' );
	assert.ok( queueSubmissions > 0 && queueBreaks >= 0, 'queue submission/pass-break evidence is invalid' );
	assert.equal( quantityValue( ledger.tileGpuTraffic.renderComputePassBreaks.p95, 'physicsCostLedger.tileGpuTraffic.renderComputePassBreaks.p95' ), queueBreaks, 'tile-GPU pass-break evidence disagrees with queue/pass accounting' );
	assert.ok( quantityValue( ledger.tileGpuTraffic.attachmentStoreLoadResolveBytes.p95, 'physicsCostLedger.tileGpuTraffic.attachmentStoreLoadResolveBytes.p95' ) >= 0, 'tile-GPU attachment traffic is invalid' );
	assert.ok( ledger.cpuWork.length > 0 && ledger.allocationGcAndCompilation.length > 0 && ledger.synchronization.length > 0, 'cost ledger omits CPU/allocation/synchronization evidence' );
	assert.ok( ledger.bindingAndDeviceLimits.length > 0, 'physicsCostLedger must gate binding/device limits' );
	for ( const [ index, limit ] of ledger.bindingAndDeviceLimits.entries() ) {

		const demand = quantityValue( limit.demand, `physicsCostLedger.bindingAndDeviceLimits[${ index }].demand` );
		const deviceLimit = quantityValue( limit.deviceLimit, `physicsCostLedger.bindingAndDeviceLimits[${ index }].deviceLimit` );
		const headroom = quantityValue( limit.requiredHeadroom, `physicsCostLedger.bindingAndDeviceLimits[${ index }].requiredHeadroom` );
		assert.ok( demand + headroom <= deviceLimit, `physicsCostLedger.bindingAndDeviceLimits[${ index }] exceeds the device limit/headroom gate` );

	}
	assert.equal( quantityValue( ledger.hostCompletionsReadbacksPerPresentedFrame, 'physicsCostLedger.hostCompletionsReadbacksPerPresentedFrame' ), 0, 'physicsCostLedger steady runtime contains frame-critical host readback' );
	const trafficById = new Map();
	for ( const [ index, traffic ] of ledger.uploadsCopiesMaps.entries() ) {

		requireAbiRecord( traffic, 'TrafficRecord', `physicsCostLedger.uploadsCopiesMaps[${ index }]` );
		assert.ok( ! trafficById.has( traffic.trafficRecordId ), `duplicate traffic record ${ traffic.trafficRecordId}` );
		trafficById.set( traffic.trafficRecordId, traffic );
		assert.equal( canonicalIntervalIdentity( traffic.measurementInterval ), canonicalIntervalIdentity( ledger.measurementInterval ), `traffic record ${ traffic.trafficRecordId } uses another trace interval` );
		assert.notEqual( traffic.readbackMapBehavior, 'host-critical-failure', `traffic record ${ traffic.trafficRecordId } contains a critical readback` );
		const traceTraffic = totals.trafficOccurrenceAndLogicalByteTotals[ traffic.trafficRecordId ];
		assert.ok( traceTraffic, `traffic record ${ traffic.trafficRecordId } is absent from exact trace totals` );
		const occurrences = quantityValue( traffic.occurrenceCount, `${ traffic.trafficRecordId }.occurrenceCount` );
		assert.equal( quantityValue( traceTraffic.occurrenceCount, `${ traffic.trafficRecordId }.traceOccurrenceCount` ), occurrences, `traffic record ${ traffic.trafficRecordId } occurrence mismatch` );
		assert.equal( quantityValue( traceTraffic.logicalByteTotal, `${ traffic.trafficRecordId }.logicalByteTotal` ), occurrences * quantityValue( traffic.logicalBytesPerOccurrence, `${ traffic.trafficRecordId }.logicalBytesPerOccurrence` ), `traffic record ${ traffic.trafficRecordId } logical-byte total mismatch` );

	}
	assert.deepEqual( Object.keys( totals.trafficOccurrenceAndLogicalByteTotals ).sort(), [ ...trafficById.keys() ].sort(), 'exact traffic totals contain an unledgered transfer' );
	for ( const stageId of stageIds ) {

		const traffic = [ ...trafficById.values() ].find( ( record ) => record.producer === stageId && record.cadenceBasis === 'per-stage-execution' );
		assert.ok( traffic, `stage ${ stageId } has no hot-state traffic record` );
		const hot = ledger.hotBytesReadWrittenPerExecution[ stageId ];
		const perExecutionBytes = quantityValue( hot.read, `${ stageId }.hotReadBytes` ) + quantityValue( hot.written, `${ stageId }.hotWrittenBytes` );
		assert.equal( quantityValue( traffic.logicalBytesPerOccurrence, `${ stageId }.trafficBytes` ), perExecutionBytes, `stage ${ stageId } hot read/write bytes do not reconcile to traffic` );
		assert.equal( quantityValue( traffic.occurrenceCount, `${ stageId }.trafficOccurrences` ), quantityValue( totals.stageExecutionCounts[ stageId ], `${ stageId }.stageExecutions` ), `stage ${ stageId } traffic occurrence count mismatch` );

	}
	const memoryAllocationIds = new Set();
	for ( const key of [ 'hotState', 'peakTransient', 'migrationOverlap' ] ) {

		const memory = requireAbiRecord( ledger[ key ], 'PhysicsMemoryLedger', `physicsCostLedger.${ key}` );
		assert.equal( canonicalIntervalIdentity( memory.measurementInterval ), canonicalIntervalIdentity( ledger.measurementInterval ), `physicsCostLedger.${ key } uses another trace interval` );
		let logicalTotal = 0;
		let physicalTotal = 0;
		for ( const [ allocationIndex, allocation ] of memory.allocations.entries() ) {

			requireAbiRecord( allocation, 'PhysicsMemoryAllocationRecord', `physicsCostLedger.${ key }.allocations[${ allocationIndex }]` );
			assert.ok( ! memoryAllocationIds.has( allocation.allocationId ), `memory allocation ${ allocation.allocationId } is double-counted` );
			memoryAllocationIds.add( allocation.allocationId );
			logicalTotal += quantityValue( allocation.elementCountStrideAndLogicalBytes.logicalBytes, `${ allocation.allocationId }.logicalBytes` );
			physicalTotal += quantityValue( allocation.physicalAllocatedBytes, `${ allocation.allocationId }.physicalAllocatedBytes` );

		}
		const logicalByResidency = Object.values( memory.logicalBytesByResidency ).reduce( ( total, value ) => total + quantityValue( value, `${ key}.logicalBytesByResidency` ), 0 );
		const physicalByResidency = Object.values( memory.physicalAllocatedBytesByResidency ).reduce( ( total, value ) => total + quantityValue( value, `${ key}.physicalAllocatedBytesByResidency` ), 0 );
		const maximumLiveByResidency = Object.values( memory.maximumSimultaneouslyLiveBytes ).reduce( ( total, value ) => total + quantityValue( value, `${ key}.maximumSimultaneouslyLiveBytes` ), 0 );
		assert.equal( logicalByResidency, logicalTotal, `physicsCostLedger.${ key } logical-byte inventory mismatch` );
		assert.equal( physicalByResidency, physicalTotal, `physicsCostLedger.${ key } physical-byte inventory mismatch` );
		assert.ok( maximumLiveByResidency >= physicalTotal, `physicsCostLedger.${ key } understates simultaneous live bytes` );
		if ( key === 'migrationOverlap' && route.physicsQualityTransitions.length > 0 ) {

			assert.deepEqual( memory.allocations.map( ( allocation ) => allocation.encodingFormatAndExtent.generationRole ).sort(), [ 'destination', 'source' ], 'migration-overlap ledger does not prove simultaneous old/new generations' );
			assert.ok( memory.allocations.every( ( allocation ) => allocation.liveInterval.coversQualityCommit === true ), 'migration-overlap allocation is not live across the quality commit' );

		}

	}
	const declaredWorkKeys = [ ...ledger.sharedWorkKeys, ...Object.values( ledger.perViewWorkKeys ).flat() ];
	assertUnique( declaredWorkKeys, 'physicsCostLedger work keys' );
	assert.deepEqual( Object.keys( ledger.perViewWorkKeys ).sort(), [ ...ledger.presentationTargetsAndViews ].sort(), 'per-view work-key target closure mismatch' );
	assert.deepEqual( ledger.workAttribution.map( ( row ) => row.workKey ).sort(), [ ...declaredWorkKeys ].sort(), 'work-attribution key closure mismatch' );
	assert.deepEqual( Object.keys( totals.workOccurrenceCounts ).sort(), [ ...declaredWorkKeys ].sort(), 'exact work-occurrence key closure mismatch' );
	const representativeExecutionIds = new Set();
	const graphExecutionIds = graph.executionLedger.stageExecutions.map( ( execution ) => execution.executionId );
	for ( const [ index, attribution ] of ledger.workAttribution.entries() ) {

		requireAbiRecord( attribution, 'PhysicsCostAttribution', `physicsCostLedger.workAttribution[${ index }]` );
		const isShared = ledger.sharedWorkKeys.includes( attribution.workKey );
		assert.equal( attribution.scope, isShared ? 'shared' : 'per-view', `work ${ attribution.workKey } scope mismatch` );
		assert.equal( attribution.attributionRule, isShared ? 'count-shared-once' : 'count-once-per-listed-view', `work ${ attribution.workKey } multiplication rule mismatch` );
		assertUnique( attribution.stageExecutionPassOrDispatchIds, `work ${ attribution.workKey } representative execution IDs` );
		for ( const executionId of attribution.stageExecutionPassOrDispatchIds ) {

			assert.ok( ! representativeExecutionIds.has( executionId ), `representative execution ${ executionId } is double-attributed` );
			representativeExecutionIds.add( executionId );

		}
		if ( isShared ) {

			assert.deepEqual( [ ...attribution.targetViewKeys ].sort(), [ ...ledger.presentationTargetsAndViews ].sort(), `shared work ${ attribution.workKey } target scope mismatch` );
			assert.deepEqual( [ ...attribution.stageExecutionPassOrDispatchIds ].sort(), [ ...graphExecutionIds ].sort(), `shared work ${ attribution.workKey } omits or invents graph executions` );

		} else {

			const targetViewKey = Object.entries( ledger.perViewWorkKeys ).find( ( [ , keys ] ) => keys.includes( attribution.workKey ) )[ 0 ];
			assert.deepEqual( attribution.targetViewKeys, [ targetViewKey ], `work ${ attribution.workKey } is attributed to the wrong view` );
			const routePlan = route.physicsPresentationRenderPlansByTarget[ targetViewKey ];
			if ( routePlan ) assert.deepEqual( [ ...attribution.stageExecutionPassOrDispatchIds ].sort(), [ ...routePlan.phaseIds ].sort(), `per-view work ${ attribution.workKey } omits or invents render phases` );
			else {

				const failedTarget = route.frameExecutionRecord.targetExecutions[ targetViewKey ];
				assert.ok( failedTarget && [ 'failed', 'aborted' ].includes( failedTarget.status ) && isTypedAbsence( failedTarget.renderPlanId ), `per-view work ${ attribution.workKey } has no resolvable plan or pre-seal failure` );
				assert.ok( attribution.stageExecutionPassOrDispatchIds.length > 0 && attribution.stageExecutionPassOrDispatchIds.every( ( phaseId ) => phaseId.includes( targetViewKey ) ), `historical trace work ${ attribution.workKey } is not scoped to ${ targetViewKey }` );

			}

		}
		assert.equal( quantityValue( attribution.occurrenceCount, `${ attribution.workKey }.occurrenceCount` ), quantityValue( totals.workOccurrenceCounts[ attribution.workKey ], `${ attribution.workKey }.traceOccurrenceCount` ), `work ${ attribution.workKey } occurrence mismatch` );
		for ( const trafficId of attribution.trafficRecordIds ) assert.ok( trafficById.has( trafficId ), `work ${ attribution.workKey } references unledgered traffic ${ trafficId}` );
		for ( const allocationId of attribution.memoryAllocationIds ) assert.ok( memoryAllocationIds.has( allocationId ), `work ${ attribution.workKey } references unledgered allocation ${ allocationId}` );

	}
	const attributedTrafficIds = ledger.workAttribution.flatMap( ( attribution ) => attribution.trafficRecordIds );
	assertUnique( attributedTrafficIds, 'work-attributed traffic IDs' );
	assert.deepEqual( [ ...attributedTrafficIds ].sort(), [ ...trafficById.keys() ].sort(), 'work attribution omits or double-counts a traffic record' );
	const attributedMemoryAllocationIds = ledger.workAttribution.flatMap( ( attribution ) => attribution.memoryAllocationIds );
	assertUnique( attributedMemoryAllocationIds, 'work-attributed memory allocation IDs' );
	assert.deepEqual( [ ...attributedMemoryAllocationIds ].sort(), [ ...memoryAllocationIds ].sort(), 'work attribution omits or double-counts a memory allocation' );
	const expectedRepresentativeIds = [ ...graphExecutionIds, ...ledger.workAttribution.filter( ( row ) => row.scope === 'per-view' ).flatMap( ( row ) => row.stageExecutionPassOrDispatchIds ) ];
	assert.deepEqual( [ ...representativeExecutionIds ].sort(), expectedRepresentativeIds.sort(), 'work attribution omits or invents representative graph/render work' );
	requireObjectKeys( ledger.multiviewAndFramesInFlightMultipliers, [ 'viewCount', 'framesInFlight', 'resourceMultiplier', 'workMultiplier' ], 'physicsCostLedger.multiviewAndFramesInFlightMultipliers' );
	assert.equal( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.viewCount, 'physicsCostLedger.viewCount' ), ledger.presentationTargetsAndViews.length, 'physicsCostLedger view multiplier disagrees with target/view closure' );
	const configuredFramesInFlight = route.frameExecutionRecord.slotAdmissions.map( ( admission ) => admission.configuredMaximumFramesInFlight );
	assert.ok( configuredFramesInFlight.length > 0, 'physicsCostLedger has no admitted frame slot' );
	assert.equal( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.framesInFlight, 'physicsCostLedger.framesInFlight' ), Math.max( ...configuredFramesInFlight ), 'physicsCostLedger frames-in-flight multiplier disagrees with the maximum admitted slot capacity' );
	assert.ok( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.resourceMultiplier, 'physicsCostLedger.resourceMultiplier' ) >= 1, 'resource multiplier cannot erase live resources' );
	assert.ok( quantityValue( ledger.multiviewAndFramesInFlightMultipliers.workMultiplier, 'physicsCostLedger.workMultiplier' ) >= 1, 'work multiplier cannot erase submitted work' );
	assert.equal( quantityValue( ledger.thermalPowerState.duration, 'physicsCostLedger.thermalPowerState.duration' ), exactDuration, 'thermal/power evidence does not span the exact trace duration' );
	assert.equal( graph.executionLedger.physicsCostLedgerId, ledger.ledgerId, 'physicsGraph.executionLedger does not bind the active PhysicsCostLedger' );

}

function validateCanonicalComposedCostEvidence( ledger, graph, context, route ) {

	const harness = requireAbiRecord( ledger.harness, 'PhysicsCostHarness', 'physicsCostLedger.harness' );
	const gateSet = requireAbiRecord( ledger.composedGateSet, 'PhysicsComposedCostGateSet', 'physicsCostLedger.composedGateSet' );
	const table = requireAbiRecord( ledger.opportunityTable, 'PhysicsCostOpportunityTable', 'physicsCostLedger.opportunityTable' );
	const trace = requireAbiRecord( ledger.composedTrace, 'PhysicsComposedCostTrace', 'physicsCostLedger.composedTrace' );
	const catchUp = requireAbiRecord( ledger.worstPermittedCatchUpCost, 'PhysicsWorstPermittedCatchUpCost', 'physicsCostLedger.worstPermittedCatchUpCost' );
	assert.equal( harness.harnessDigest, sha256CanonicalExcluding( harness, [ 'harnessDigest' ] ), 'physics cost harness digest mismatch' );
	assert.deepEqual( [ ...harness.workload.presentationTargetsAndViews ].sort(), [ ...ledger.presentationTargetsAndViews ].sort(), 'physics cost harness target/view closure mismatch' );
	assert.deepEqual( harness.workload.qualityStateAndEpoch, { qualityStateId: ledger.qualityState, qualityEpoch: ledger.qualityEpoch }, 'physics cost harness quality identity mismatch' );
	assert.equal( gateSet.harnessId, harness.harnessId, 'composed gate set uses another harness' );
	assert.deepEqual( gateSet.qualityStateAndEpoch, harness.workload.qualityStateAndEpoch, 'composed gate set uses another quality identity' );
	assert.equal( table.harnessId, harness.harnessId, 'opportunity table uses another harness' );
	assert.equal( canonicalIntervalIdentity( table.measurementInterval ), canonicalIntervalIdentity( ledger.measurementInterval ), 'opportunity table uses another measurement interval' );
	assert.equal( table.tableDigest, sha256CanonicalExcluding( table, [ 'tableDigest' ] ), 'opportunity table digest mismatch' );
	assert.deepEqual( [ trace.harnessId, trace.gateSetId, trace.opportunityTableId, trace.cadenceTraceTotalsId ], [ harness.harnessId, gateSet.gateSetId, table.opportunityTableId, ledger.cadenceTraceTotals.traceTotalsId ], 'composed trace identity closure mismatch' );
	assert.equal( trace.status, 'measured-valid', 'composed trace is not measured-valid' );
	assert.ok( Object.values( trace.gateResults ).every( ( result ) => result === 'pass' ), 'composed trace contains a failed or insufficient gate' );
	assert.ok( quantityValue( trace.cpuCriticalPathDistribution.p95, 'composed CPU p95' ) <= quantityValue( gateSet.cpuCriticalPathP95, 'CPU critical-path gate' ), 'composed CPU critical path exceeds its frozen gate' );
	if ( ! isTypedAbsence( gateSet.gpuCriticalPathP95 ) ) {

		assert.ok( ! isTypedAbsence( trace.gpuCriticalPathDistribution ), 'GPU gate has no composed GPU evidence' );
		assert.ok( quantityValue( trace.gpuCriticalPathDistribution.p95, 'composed GPU p95' ) <= quantityValue( gateSet.gpuCriticalPathP95, 'GPU critical-path gate' ), 'composed GPU critical path exceeds its frozen gate' );

	}
	const totals = ledger.cadenceTraceTotals;
	const exactRowCount = quantityValue( table.exactRowCount, 'opportunity table exactRowCount' );
	assert.ok( Number.isSafeInteger( exactRowCount ) && exactRowCount > 0, 'opportunity table exactRowCount must be a positive integer' );
	let runs;
	if ( table.storage === 'inline' ) {

		assert.ok( Array.isArray( table.inlineRows ) && isTypedAbsence( table.resource ), 'inline opportunity table arm mismatch' );
		assert.equal( table.inlineRows.length, exactRowCount, 'inline opportunity row count mismatch' );
		runs = table.inlineRows.map( ( row, index ) => {

			requireAbiRecord( row, 'PhysicsCostOpportunityRow', `physicsCostLedger.opportunityTable.inlineRows[${ index }]` );
			assert.equal( row.rowDigest, sha256CanonicalExcluding( row, [ 'rowDigest' ] ), `opportunity row ${ index } digest mismatch` );
			return { count: 1, pattern: row };

		} );

	} else {

		assert.equal( table.storage, 'immutable-resource', 'unknown opportunity table storage arm' );
		assert.ok( isTypedAbsence( table.inlineRows ) && ! isTypedAbsence( table.resource ), 'immutable opportunity table arm mismatch' );
		const payload = costOpportunityTableResourceFixtures.get( table.resource.contentDigest );
		assert.ok( payload, 'opportunity table resource is opaque or unavailable' );
		assert.equal( table.resource.contentDigest, sha256Canonical( payload ), 'opportunity table resource content digest mismatch' );
		assert.equal( payload.layout, table.resource.canonicalByteLayout, 'opportunity table byte layout mismatch' );
		assert.equal( payload.rowCount, exactRowCount, 'opportunity resource row count mismatch' );
		assert.equal( quantityValue( table.resource.rowCount, 'opportunity resource declared rowCount' ), exactRowCount, 'opportunity resource declared row count mismatch' );
		assert.equal( table.resource.orderedRowDigestRoot, sha256Canonical( payload.runs ), 'opportunity row digest root mismatch' );
		runs = payload.runs;

	}
	assert.equal( runs.reduce( ( sum, run ) => sum + run.count, 0 ), exactRowCount, 'opportunity run lengths do not equal exactRowCount' );
	const numeric = ( value, label ) => isPlainObject( value ) && Object.hasOwn( value, 'value' ) ? quantityValue( value, label ) : value;
	const summedMap = ( field ) => {

		const sums = {};
		for ( const run of runs ) for ( const [ key, value ] of Object.entries( run.pattern[ field ] ?? {} ) ) sums[ key ] = ( sums[ key ] ?? 0 ) + run.count * numeric( value, `${ field}.${ key}` );
		return sums;

	};
	const assertCountMapClosure = ( field, expected ) => {

		const sums = summedMap( field );
		assert.deepEqual( Object.keys( sums ).sort(), Object.keys( expected ).sort(), `opportunity ${ field} key closure mismatch` );
		for ( const [ key, value ] of Object.entries( expected ) ) {

			const expectedValue = quantityValue( value, `cadenceTraceTotals.${ field}.${ key}` );
			assert.ok( Math.abs( sums[ key ] - expectedValue ) <= Math.max( 1e-9, Math.abs( expectedValue ) * 1e-12 ), `opportunity ${ field}.${ key} total mismatch` );

		}

	};
	for ( const field of [ 'stageExecutionCounts', 'nativeSubcycleCounts', 'couplingIterationCounts', 'interactionApplicationCounts', 'presentedFrameCounts', 'workOccurrenceCounts' ] ) assertCountMapClosure( field, totals[ field ] );
	const trafficOccurrenceSums = {};
	const trafficByteSums = {};
	for ( const run of runs ) for ( const [ trafficId, record ] of Object.entries( run.pattern.trafficOccurrenceAndLogicalByteTotals ?? {} ) ) {

		trafficOccurrenceSums[ trafficId ] = ( trafficOccurrenceSums[ trafficId ] ?? 0 ) + run.count * numeric( record.occurrenceCount, `${ trafficId }.occurrenceCount` );
		trafficByteSums[ trafficId ] = ( trafficByteSums[ trafficId ] ?? 0 ) + run.count * numeric( record.logicalByteTotal, `${ trafficId }.logicalByteTotal` );

	}
	assert.deepEqual( Object.keys( trafficOccurrenceSums ).sort(), Object.keys( totals.trafficOccurrenceAndLogicalByteTotals ).sort(), 'opportunity traffic key closure mismatch' );
	for ( const [ trafficId, record ] of Object.entries( totals.trafficOccurrenceAndLogicalByteTotals ) ) {

		const expectedOccurrences = quantityValue( record.occurrenceCount, `${ trafficId }.traceOccurrenceCount` );
		const expectedBytes = quantityValue( record.logicalByteTotal, `${ trafficId }.traceLogicalBytes` );
		assert.ok( Math.abs( trafficOccurrenceSums[ trafficId ] - expectedOccurrences ) <= Math.max( 1e-9, Math.abs( expectedOccurrences ) * 1e-12 ), `opportunity traffic occurrence mismatch for ${ trafficId }` );
		assert.ok( Math.abs( trafficByteSums[ trafficId ] - expectedBytes ) <= Math.max( 1e-9, Math.abs( expectedBytes ) * 1e-12 ), `opportunity traffic byte mismatch for ${ trafficId }` );

	}
	assert.equal( summedMap( 'coordinationAdvanceCount' ).coordinationAdvanceCount ?? runs.reduce( ( sum, run ) => sum + run.count * numeric( run.pattern.coordinationAdvanceCount, 'coordinationAdvanceCount' ), 0 ), quantityValue( totals.coordinationAdvanceCount, 'trace coordinationAdvanceCount' ), 'opportunity coordination advance total mismatch' );
	const policy = graph.catchUpPolicy;
	const policyIdentity = catchUp.catchUpPolicyIdentity;
	assert.deepEqual( [ policyIdentity.graphId, policyIdentity.graphRevision, policyIdentity.debtClockId, policyIdentity.debtDisposition ], [ graph.graphId, graph.executionLedger.graphRevision, policy.debtClockId, policy.debtDisposition ], 'catch-up cost policy identity mismatch' );
	assert.equal( policyIdentity.policyDigest, sha256Canonical( policy ), 'catch-up cost policy digest mismatch' );
	assert.deepEqual( policyIdentity.maximumDebt, policy.maximumDebt, 'catch-up cost maximum debt mismatch' );
	assert.deepEqual( policyIdentity.maximumCoordinationAdvancesPerPresentationOpportunity, policy.maximumCoordinationAdvancesPerPresentationOpportunity, 'catch-up cost maximum advances mismatch' );
	assert.deepEqual( policyIdentity.maximumNativeExecutionsPerOpportunity, policy.maximumNativeExecutionsPerOpportunity, 'catch-up cost maximum native executions mismatch' );
	assert.deepEqual( [ catchUp.harnessId, catchUp.gateSetId ], [ harness.harnessId, gateSet.gateSetId ], 'catch-up cost harness/gate identity mismatch' );
	const requiredObjectives = [ 'cpu-critical-path', 'gpu-critical-path', 'external-tail', 'presented-interval', 'hot-traffic', 'peak-live-bytes', 'migration-overlap-bytes', 'numerical-error', 'visual-error' ];
	assert.deepEqual( [ ...catchUp.admissibleScheduleModel.objectiveDimensions ].sort(), [ ...requiredObjectives ].sort(), 'catch-up schedule model objective closure mismatch' );
	assert.deepEqual( [ ...catchUp.frontierCoverage.coveredObjectiveDimensions ].sort(), [ ...requiredObjectives ].sort(), 'catch-up frontier misses an objective dimension' );
	assert.deepEqual( catchUp.frontierCoverage.uncoveredObjectiveDimensions, [], 'catch-up frontier reports uncovered objectives' );
	assert.ok( catchUp.frontierWitnesses.length > 0, 'catch-up frontier has no executable witness' );
	const witnessedObjectives = new Set();
	let maximumWitnessAdvanceCount = 0;
	for ( const [ index, witness ] of catchUp.frontierWitnesses.entries() ) {

		requireAbiRecord( witness, 'PhysicsCatchUpCostWitness', `catchUp.frontierWitnesses[${ index }]` );
		assert.equal( witness.witnessDigest, sha256CanonicalExcluding( witness, [ 'witnessDigest' ] ), `catch-up witness ${ witness.witnessId } digest mismatch` );
		const row = requireAbiRecord( witness.opportunityRow, 'PhysicsCostOpportunityRow', `catchUp.frontierWitnesses[${ index }].opportunityRow` );
		assert.equal( row.rowDigest, sha256CanonicalExcluding( row, [ 'rowDigest' ] ), `catch-up witness ${ witness.witnessId } row digest mismatch` );
		assert.deepEqual( Object.keys( row.stageExecutionCounts ).sort(), graph.stages.map( ( stage ) => stage.stageId ).sort(), `catch-up witness ${ witness.witnessId } stage closure mismatch` );
		maximumWitnessAdvanceCount = Math.max( maximumWitnessAdvanceCount, row.coordinationAdvanceIds.length );
		assert.ok( row.coordinationAdvanceIds.length <= quantityValue( policy.maximumCoordinationAdvancesPerPresentationOpportunity, 'maximum catch-up advances' ), `catch-up witness ${ witness.witnessId } exceeds maximum advances` );
		const nativeExecutionCount = Object.values( row.stageExecutionCounts ).reduce( ( sum, count ) => sum + quantityValue( count, 'catch-up witness stage count' ), 0 );
		assert.ok( nativeExecutionCount <= quantityValue( policy.maximumNativeExecutionsPerOpportunity, 'maximum native executions' ), `catch-up witness ${ witness.witnessId } exceeds maximum native executions` );
		for ( const objective of witness.maximizedObjectiveDimensions ) witnessedObjectives.add( objective );

	}
	const exactTraceAdvances = quantityValue( totals.coordinationAdvanceCount, 'exact trace coordination advances' );
	const nativeExecutionsPerAdvance = Object.values( totals.stageExecutionCounts ).reduce( ( sum, count ) => sum + quantityValue( count, 'trace stage execution count' ), 0 ) / exactTraceAdvances;
	const maximumFeasibleWholeAdvances = Math.min( quantityValue( policy.maximumCoordinationAdvancesPerPresentationOpportunity, 'maximum catch-up advances' ), Math.floor( quantityValue( policy.maximumNativeExecutionsPerOpportunity, 'maximum native executions' ) / nativeExecutionsPerAdvance ) );
	assert.equal( maximumWitnessAdvanceCount, maximumFeasibleWholeAdvances, 'catch-up frontier never executes the maximum feasible whole-advance schedule under both policy caps' );
	assert.deepEqual( [ ...witnessedObjectives ].sort(), [ ...requiredObjectives ].sort(), 'catch-up witness set does not cover every objective' );
	assert.ok( Object.values( catchUp.gateResults ).every( ( result ) => result === 'pass' ) && catchUp.requiredDisposition === 'admit', 'catch-up frontier does not pass its gate set' );
	const qualityRefs = ledger.qualityCostEvidence;
	assert.deepEqual( qualityRefs.map( ( ref ) => ref.qualityStateAndEpoch.qualityStateId ).sort(), Object.keys( route.physicsQualityStates ).sort(), 'quality cost evidence state closure mismatch' );
	for ( const [ index, ref ] of qualityRefs.entries() ) {

		requireAbiRecord( ref, 'PhysicsQualityCostEvidenceRef', `physicsCostLedger.qualityCostEvidence[${ index }]` );
		const state = route.physicsQualityStates[ ref.qualityStateAndEpoch.qualityStateId ];
		assert.equal( ref.qualityStateAndEpoch.qualityEpoch, state.qualityEpoch, `quality cost evidence ${ state.qualityStateId } epoch mismatch` );
		assert.equal( ref.status, 'accepted', `quality cost evidence ${ state.qualityStateId } is not accepted` );
		if ( state.qualityStateId === ledger.qualityState ) assert.deepEqual( [ ref.harnessId, ref.gateSetId, ref.steadyCostLedgerId, ref.composedTraceId, ref.worstPermittedCatchUpCostId ], [ harness.harnessId, gateSet.gateSetId, ledger.ledgerId, trace.composedTraceId, catchUp.catchUpCostId ], 'active quality cost evidence does not close to active records' );

	}
	assert.deepEqual( ledger.qualityMigrationCostEvidence.map( ( evidenceRecord ) => evidenceRecord.transitionId ).sort(), route.physicsQualityTransitions.map( ( transition ) => transition.transitionId ).sort(), 'quality migration cost evidence transition closure mismatch' );
	const evidenceById = new Map();
	for ( const [ index, evidenceRecord ] of ledger.qualityMigrationCostEvidence.entries() ) {

		requireAbiRecord( evidenceRecord, 'PhysicsQualityMigrationCostEvidence', `physicsCostLedger.qualityMigrationCostEvidence[${ index }]` );
		assert.ok( ! evidenceById.has( evidenceRecord.migrationCostEvidenceId ), `duplicate migration cost evidence ${ evidenceRecord.migrationCostEvidenceId}` );
		evidenceById.set( evidenceRecord.migrationCostEvidenceId, evidenceRecord );
		const transition = route.physicsQualityTransitions.find( ( candidate ) => candidate.transitionId === evidenceRecord.transitionId );
		const sourceCostRef = qualityRefs.find( ( ref ) => ref.qualityStateAndEpoch.qualityStateId === transition.fromState );
		const destinationCostRef = qualityRefs.find( ( ref ) => ref.qualityStateAndEpoch.qualityStateId === transition.toState );
		assert.ok( sourceCostRef.outgoingMigrationCostEvidenceIds.includes( evidenceRecord.migrationCostEvidenceId ), `source quality cost evidence omits outgoing migration ${ evidenceRecord.migrationCostEvidenceId}` );
		assert.ok( destinationCostRef.incomingMigrationCostEvidenceIds.includes( evidenceRecord.migrationCostEvidenceId ), `destination quality cost evidence omits incoming migration ${ evidenceRecord.migrationCostEvidenceId}` );
		assert.deepEqual( evidenceRecord.sourceAndDestinationQualityEpochs, { source: transition.fromQualityEpoch, destination: transition.toQualityEpoch }, `migration cost evidence ${ evidenceRecord.transitionId } quality epoch mismatch` );
		assert.deepEqual( evidenceRecord.requestAndAllocationAdmissionIds, { requestAdmissionId: transition.requestAdmission.admissionId, allocationAdmissionId: transition.prepare.allocationAdmission.allocationAdmissionId }, `migration cost evidence ${ evidenceRecord.transitionId } admission mismatch` );
		assert.equal( evidenceRecord.overlapMemoryLedgerId, ledger.migrationOverlap.memoryLedgerId, `migration cost evidence ${ evidenceRecord.transitionId } overlap ledger mismatch` );
		assert.deepEqual( Object.keys( evidenceRecord.phaseOpportunityRows ).sort(), [ 'commit', 'populate', 'prepare', 'retire' ], `migration cost evidence ${ evidenceRecord.transitionId } phase closure mismatch` );
		for ( const [ phase, rows ] of Object.entries( evidenceRecord.phaseOpportunityRows ) ) for ( const [ rowIndex, row ] of rows.entries() ) {

			requireAbiRecord( row, 'PhysicsCostOpportunityRow', `migration ${ evidenceRecord.transitionId }.${ phase }[${ rowIndex }]` );
			assert.equal( row.rowDigest, sha256CanonicalExcluding( row, [ 'rowDigest' ] ), `migration ${ evidenceRecord.transitionId }.${ phase } row digest mismatch` );

		}
		assert.ok( evidenceRecord.migrationTrafficRecordIds.every( ( id ) => ledger.uploadsCopiesMaps.some( ( record ) => record.trafficRecordId === id ) ), `migration cost evidence ${ evidenceRecord.transitionId } references unknown traffic` );
		assert.equal( evidenceRecord.status, 'accepted', `migration cost evidence ${ evidenceRecord.transitionId } is not accepted` );
		assert.ok( Object.values( evidenceRecord.composedGateResultsDuringTransition ).every( ( result ) => result === 'pass' ), `migration cost evidence ${ evidenceRecord.transitionId } contains failed gates` );

	}
	for ( const ref of qualityRefs ) for ( const id of [ ...ref.incomingMigrationCostEvidenceIds, ...ref.outgoingMigrationCostEvidenceIds ] ) assert.ok( evidenceById.has( id ), `quality cost evidence references missing migration ${ id}` );
	const allReferencedMigrationIds = new Set( qualityRefs.flatMap( ( ref ) => [ ...ref.incomingMigrationCostEvidenceIds, ...ref.outgoingMigrationCostEvidenceIds ] ) );
	assert.deepEqual( [ ...allReferencedMigrationIds ].sort(), [ ...evidenceById.keys() ].sort(), 'quality cost evidence omits or invents migration references' );
	return true;

}

function validateExternalAdapterOwnershipPartition( route ) {

	const adapters = Object.entries( route.physicsExternalSolverAdaptersById );
	const claimsByEquation = new Map();
	for ( const claim of route.physicsGraph.executionLedger.stateAdvanceClaims ) {

		const claims = claimsByEquation.get( claim.stateEquationId ) ?? [];
		claims.push( claim );
		claimsByEquation.set( claim.stateEquationId, claims );

	}
	const commitOwnersByEquation = new Map();
	for ( const group of route.physicsGraph.commitGroups ) for ( const [ stateEquationId, owner ] of Object.entries( group.stateEquationOwners ) ) {

		const owners = commitOwnersByEquation.get( stateEquationId ) ?? [];
		owners.push( {
			commitGroupId: group.commitGroupId,
			owner,
			committedSignalIds: group.committedPublications.filter( ( publication ) => publication.stateEquation === stateEquationId ).map( ( publication ) => publication.signalId )
		} );
		commitOwnersByEquation.set( stateEquationId, owners );

	}
	const adapterByEquation = new Map();
	for ( const [ adapterId, adapter ] of adapters ) {

		assert.equal( adapter.adapterId, adapterId, `external adapter registry key ${ adapterId } mismatch during ownership partition validation` );
		assertUnique( adapter.ownedStateEquations, `physicsExternalSolverAdaptersById.${ adapterId }.ownedStateEquations` );
		const adapterSignalsById = new Map( adapter.signalDescriptors.map( ( descriptor ) => [ descriptor.signalId, descriptor ] ) );
		assert.equal( adapterSignalsById.size, adapter.signalDescriptors.length, `external adapter ${ adapterId } duplicates a signal descriptor` );
		for ( const equation of adapter.ownedStateEquations ) {

			assert.ok( ! adapterByEquation.has( equation ), `state equation ${ equation } is owned by multiple external adapters: ${ adapterByEquation.get( equation ) } and ${ adapterId }` );
			adapterByEquation.set( equation, adapterId );
			const claims = claimsByEquation.get( equation ) ?? [];
			const commitOwners = commitOwnersByEquation.get( equation ) ?? [];
			assert.equal( claims.length, 1, `external adapter ${ adapterId } state equation ${ equation } must have exactly one graph state-advance claim` );
			assert.equal( commitOwners.length, 1, `external adapter ${ adapterId } state equation ${ equation } must have exactly one graph commit owner` );
			assert.equal( claims[ 0 ].owner, commitOwners[ 0 ].owner, `external adapter ${ adapterId } state equation ${ equation } claim/commit owner mismatch` );
			const graphSignalIds = new Set( [ claims[ 0 ].outputPreparedVersion.signalId, ...commitOwners[ 0 ].committedSignalIds ] );
			assert.ok( graphSignalIds.size > 0, `external adapter ${ adapterId } state equation ${ equation } has no graph signal lineage` );
			for ( const signalId of graphSignalIds ) {

				const descriptor = adapterSignalsById.get( signalId );
				assert.ok( descriptor, `external adapter ${ adapterId } state equation ${ equation } omits graph signal ${ signalId }` );
				assert.equal( descriptor.owner, claims[ 0 ].owner, `external adapter ${ adapterId } state equation ${ equation } descriptor/graph owner mismatch` );

			}

		}
		const graphEquationsForAdapter = new Set();
		for ( const [ equation, claims ] of claimsByEquation ) if ( claims.some( ( claim ) => adapterSignalsById.has( claim.outputPreparedVersion.signalId ) ) ) graphEquationsForAdapter.add( equation );
		for ( const [ equation, commitOwners ] of commitOwnersByEquation ) if ( commitOwners.some( ( entry ) => entry.committedSignalIds.some( ( signalId ) => adapterSignalsById.has( signalId ) ) ) ) graphEquationsForAdapter.add( equation );
		assert.deepEqual( [ ...adapter.ownedStateEquations ].sort(), [ ...graphEquationsForAdapter ].sort(), `external adapter ${ adapterId } ownedStateEquations do not exactly partition its graph-owned equations` );

	}
	const externalSignalIds = new Set( adapters.flatMap( ( [ , adapter ] ) => adapter.signalDescriptors.map( ( descriptor ) => descriptor.signalId ) ) );
	const externallyOwnedGraphEquations = new Set();
	for ( const [ equation, claims ] of claimsByEquation ) if ( claims.some( ( claim ) => externalSignalIds.has( claim.outputPreparedVersion.signalId ) ) ) externallyOwnedGraphEquations.add( equation );
	for ( const [ equation, commitOwners ] of commitOwnersByEquation ) if ( commitOwners.some( ( entry ) => entry.committedSignalIds.some( ( signalId ) => externalSignalIds.has( signalId ) ) ) ) externallyOwnedGraphEquations.add( equation );
	assert.deepEqual( [ ...adapterByEquation.keys() ].sort(), [ ...externallyOwnedGraphEquations ].sort(), 'external adapter state-equation registry is not an exact partition of graph-owned external equations' );
	return true;

}

function validateExternalSolverAdapter( route, adapter, label ) {

	requireAbiRecord( adapter, 'ExternalSolverAdapter', label );
	assert.equal( adapter.contextId, route.physicsContext.contextId, `${ label}.contextId mismatch` );
	requireNonEmptyString( adapter.adapterId, `${ label}.adapterId` );
	const ownershipFields = [ 'stepping', 'constraintAssemblyAndSolve', 'collisionDetection', 'contactManifoldLifecycle', 'forceImpulseAccumulation', 'committedStatePublication' ];
	requireObjectKeys( adapter.ownership, ownershipFields, `${ label}.ownership` );
	for ( const field of ownershipFields ) {

		requireNonEmptyString( adapter.ownership[ field ], `${ label}.ownership.${ field}` );
		assert.doesNotMatch( adapter.ownership[ field ], /implicit|default|unknown/i, `${ label}.ownership.${ field} is implicit` );

	}
	assert.ok( adapter.ownedStateEquations.length > 0, `${ label}.ownedStateEquations must be nonempty` );
	assertUnique( adapter.ownedStateEquations, `${ label}.ownedStateEquations` );
	const claimsByEquation = new Map();
	for ( const claim of route.physicsGraph.executionLedger.stateAdvanceClaims ) {

		const rows = claimsByEquation.get( claim.stateEquationId ) ?? [];
		rows.push( claim );
		claimsByEquation.set( claim.stateEquationId, rows );

	}
	for ( const equation of adapter.ownedStateEquations ) {

		assert.equal( ( claimsByEquation.get( equation ) ?? [] ).length, 1, `${ label} state equation ${ equation} does not resolve exactly one state-advance claim` );
		const ownerGroups = route.physicsGraph.commitGroups.filter( ( group ) => Object.hasOwn( group.stateEquationOwners, equation ) );
		assert.equal( ownerGroups.length, 1, `${ label} state equation ${ equation} does not resolve exactly one commit-group owner` );
		assert.ok( ownerGroups[ 0 ].preparedPublications.some( ( publication ) => publication.stateEquationOwner === ownerGroups[ 0 ].stateEquationOwners[ equation ] ), `${ label} state equation ${ equation} has no prepared publication lineage` );

	}
	assertUnique( adapter.signalDescriptors.map( ( descriptor ) => descriptor.signalId ), `${ label}.signalDescriptors` );
	const routeSignalsById = new Map( Object.values( route.physicsSignals ).map( ( descriptor ) => [ descriptor.signalId, descriptor ] ) );
	for ( const [ index, descriptor ] of adapter.signalDescriptors.entries() ) {

		requireAbiRecord( descriptor, 'PhysicsSignalDescriptor', `${ label}.signalDescriptors[${ index }]` );
		assert.deepEqual( [ descriptor.providerId, descriptor.contextId ], [ adapter.adapterId, adapter.contextId ], `${ label}.signalDescriptors[${ index }] provider/context mismatch` );
		const registered = routeSignalsById.get( descriptor.signalId );
		assert.ok( registered, `${ label}.signalDescriptors[${ index }] is absent from the route signal registry` );
		for ( const key of [ 'providerId', 'contextId', 'schemaId', 'stateVersion', 'physicsFrameId', 'clockId' ] ) assert.deepEqual( descriptor[ key ], registered[ key ], `${ label}.signalDescriptors[${ index }].${ key} differs from the route descriptor` );
		assert.deepEqual( descriptor.resourceGeneration, registered.resourceGeneration, `${ label}.signalDescriptors[${ index }].resourceGeneration differs from the route descriptor` );

	}
	const supportedFrameChartIds = [
		...adapter.signalDescriptors.flatMap( ( descriptor ) => [ descriptor.physicsFrameId, ...( isTypedAbsence( descriptor.chartId ) ? [] : [ descriptor.chartId ] ) ] ),
		...adapter.interactionCapabilities.map( ( capability ) => capability.frameId )
	];
	assertUnique( adapter.supportedFramesCharts, `${ label}.supportedFramesCharts` );
	assert.deepEqual( [ ...adapter.supportedFramesCharts ].sort(), [ ...new Set( supportedFrameChartIds ) ].sort(), `${ label}.supportedFramesCharts closure mismatch` );
	const contextClock = canonicalClock( route.physicsContext, adapter.clockMapping.contextClockId, `${ label}.clockMapping.contextClockId` );
	assert.deepEqual( [ adapter.clockMapping.mappingDescriptorRef.clockId, adapter.clockMapping.mappingDescriptorRef.mappingRevision, adapter.clockMapping.mappingDescriptorRef.discontinuityEpoch ], [ contextClock.clockId, contextClock.mappingRevision, contextClock.discontinuityEpoch ], `${ label}.clockMapping.mappingDescriptorRef does not resolve the registered context clock` );
	assertUnique( adapter.interactionCapabilities.map( ( capability ) => capability.capabilityId ), `${ label}.interactionCapabilities` );
	const graphDependencyIds = new Set( route.physicsGraph.dependencies.map( ( dependency ) => dependency.dependencyId ) );
	for ( const [ index, capability ] of adapter.interactionCapabilities.entries() ) {

		requireAbiRecord( capability, 'ExternalInteractionCapability', `${ label}.interactionCapabilities[${ index }]` );
		assert.ok( graphDependencyIds.has( capability.dependencyRef.dependencyId ), `${ label}.interactionCapabilities[${ index }] dependency does not resolve` );
		if ( capability.direction === 'ingress' ) {

			assert.ok( ! isTypedAbsence( capability.targetEquationId ) && adapter.ownedStateEquations.includes( capability.targetEquationId ), `${ label}.interactionCapabilities[${ index }] ingress target equation is not adapter-owned` );
			assert.equal( capability.exactOnceSupport, 'required-ledger', `${ label}.interactionCapabilities[${ index }] ingress does not require an exact-once ledger` );

		}

	}
	const adapterSignalOwners = new Set( adapter.signalDescriptors.map( ( descriptor ) => descriptor.owner ) );
	const crossing = route.physicsInteractions.flatMap( ( exchange ) => [ ...exchange.interactions, ...exchange.reactions ].map( ( record ) => ( {
		exchange,
		record,
		direction: adapter.ownedStateEquations.includes( record.targetStateEquation ) ? 'ingress' : adapterSignalOwners.has( record.sourceOwner ) ? 'egress' : null
	} ) ) ).filter( ( entry ) => entry.direction !== null );
	const usedCapabilityIds = new Set();
	for ( const { record, direction } of crossing ) {

		const matches = adapter.interactionCapabilities.filter( ( capability ) => capability.direction === direction && capability.role === record.role && capability.payloadTag === record.payload.tag && capability.frameId === record.physicsFrameId && capability.footprintKinds.includes( record.footprint.kind ) && ( direction === 'egress' ? isTypedAbsence( capability.targetEquationId ) || capability.targetEquationId === record.targetStateEquation : capability.targetEquationId === record.targetStateEquation ) );
		assert.equal( matches.length, 1, `${ label} interaction ${ record.interactionId} does not match exactly one directional capability` );
		usedCapabilityIds.add( matches[ 0 ].capabilityId );
		if ( matches[ 0 ].reactionAtomicity === 'independent-with-conservation-bound' ) assert.ok( record.conservationGroupIds.some( ( conservationGroupId ) => route.physicsInteractions.some( ( exchange ) => exchange.conservationGroups.some( ( group ) => group.conservationGroupId === conservationGroupId ) ) ), `${ label} capability ${ matches[ 0 ].capabilityId} has no resolved conservation bound` );

	}
	assert.deepEqual( [ ...usedCapabilityIds ].sort(), adapter.interactionCapabilities.map( ( capability ) => capability.capabilityId ).sort(), `${ label} contains an unused or duplicate directional capability` );
	const routeAdvancesById = new Map( route.physicsCoordinationAdvanceRecords.map( ( advance ) => [ advance.coordinationAdvanceId, advance ] ) );
	const dependencyCompletionsById = new Map( route.physicsGraph.executionLedger.dependencyCompletions.map( ( completion ) => [ completion.completionId, completion ] ) );
	const applicationLedgersById = new Map( Object.values( route.physicsInteractionApplicationLedgers ).map( ( ledger ) => [ ledger.applicationLedgerId, ledger ] ) );
	const inputLedgerIdsAcrossReceipts = [];
	const emittedInteractionIdsAcrossReceipts = [];
	const receiptStepKeys = new Set();
	const receiptsByAdvance = new Map();
	for ( const [ index, receipt ] of adapter.stepReceipts.entries() ) {

		const receiptLabel = `${ label}.stepReceipts[${ index }]`;
		requireAbiRecord( receipt, 'ExternalSolverStepReceipt', receiptLabel );
		assert.equal( receipt.adapterId, adapter.adapterId, `${ receiptLabel}.adapterId mismatch` );
		const stepKey = `${ receipt.coordinationAdvanceId }|${ receipt.externalStepSequence }`;
		assert.ok( ! receiptStepKeys.has( stepKey ), `${ receiptLabel} duplicates external step ${ stepKey}` );
		receiptStepKeys.add( stepKey );
		const advance = routeAdvancesById.get( receipt.coordinationAdvanceId );
		assert.ok( advance, `${ receiptLabel}.coordinationAdvanceId does not resolve` );
		validateCanonicalInterval( receipt.requestedInterval, route.physicsContext, `${ receiptLabel}.requestedInterval` );
		assertIntervalContained( receipt.requestedInterval, advance.interval, route.physicsContext, `${ receiptLabel}.requestedInterval` );
		let priorEnd = intervalBoundsSeconds( receipt.requestedInterval, route.physicsContext, `${ receiptLabel}.requestedInterval` )[ 0 ];
		const requestedEnd = intervalBoundsSeconds( receipt.requestedInterval, route.physicsContext, `${ receiptLabel}.requestedInterval` )[ 1 ];
		for ( const [ nativeIndex, interval ] of receipt.actualNativeExecutionIntervals.entries() ) {

			validateCanonicalInterval( interval, route.physicsContext, `${ receiptLabel}.actualNativeExecutionIntervals[${ nativeIndex }]` );
			const bounds = intervalBoundsSeconds( interval, route.physicsContext, `${ receiptLabel}.actualNativeExecutionIntervals[${ nativeIndex }]` );
			assert.ok( Math.abs( bounds[ 0 ] - priorEnd ) <= 1e-12, `${ receiptLabel} native execution intervals contain a gap or overlap` );
			priorEnd = bounds[ 1 ];

		}
		if ( receipt.status === 'completed' ) assert.ok( receipt.actualNativeExecutionIntervals.length > 0 && Math.abs( priorEnd - requestedEnd ) <= 1e-12, `${ receiptLabel} completed native intervals do not tile the requested interval` );
		for ( const ref of receipt.dependencyCompletionRefs ) {

			const completion = dependencyCompletionsById.get( ref.completionId );
			assert.ok( completion && ref.dependencyId === completion.dependencyId && ref.receiptDigest === completion.receiptDigest, `${ receiptLabel} dependency completion does not resolve exactly` );

		}
		for ( const applicationLedgerId of receipt.inputApplicationLedgerIds ) {

			const application = applicationLedgersById.get( applicationLedgerId );
			assert.ok( application?.disposition === 'committed', `${ receiptLabel} input application ${ applicationLedgerId} is absent or uncommitted` );
			inputLedgerIdsAcrossReceipts.push( applicationLedgerId );

		}
		for ( const output of receipt.outputPreparedVersions ) {

			assert.ok( adapter.ownedStateEquations.includes( output.stateEquationId ), `${ receiptLabel} publishes unowned state equation ${ output.stateEquationId}` );
			const group = route.physicsGraph.commitGroups.find( ( candidate ) => candidate.commitGroupId === output.commitGroupId );
			const transaction = route.physicsGraph.commitTransactions.find( ( candidate ) => candidate.commitTransactionId === output.commitTransactionId );
			assert.ok( group && transaction?.status === 'committed' && transaction.commitGroupIds.includes( group.commitGroupId ), `${ receiptLabel} output does not resolve a committed group/transaction` );
			assert.ok( group.preparedPublications.some( ( publication ) => publication.preparedVersion.signalId === output.signalId && publication.preparedVersion.stateVersion === output.preparedStateVersion ), `${ receiptLabel} output prepared version does not resolve` );
			assert.ok( transaction.receipt.preparedToCommittedPublicationMap.some( ( promotion ) => promotion.preparedVersion.signalId === output.signalId && promotion.preparedVersion.stateVersion === output.preparedStateVersion ), `${ receiptLabel} output prepared version is not atomically promoted` );

		}
		for ( const range of receipt.emittedInteractionSequenceRanges ) {

			assert.ok( Number.isSafeInteger( range.firstSequence ) && Number.isSafeInteger( range.lastSequenceInclusive ) && range.firstSequence <= range.lastSequenceInclusive, `${ receiptLabel} emitted interaction range is invalid` );
			assert.equal( range.interactionIds.length, range.lastSequenceInclusive - range.firstSequence + 1, `${ receiptLabel} emitted interaction range cardinality mismatch` );
			emittedInteractionIdsAcrossReceipts.push( ...range.interactionIds );
			const records = crossing.filter( ( entry ) => entry.direction === 'egress' && range.interactionIds.includes( entry.record.interactionId ) ).map( ( entry ) => entry.record );
			assert.deepEqual( [ ...range.exactOnceKeys ].sort(), records.map( ( record ) => record.exactOnceKey ).sort(), `${ receiptLabel} emitted exact-once key closure mismatch` );

		}
		assert.equal( receipt.contentDigest, sha256CanonicalExcluding( receipt, [ 'contentDigest' ] ), `${ receiptLabel}.contentDigest mismatch` );
		const rows = receiptsByAdvance.get( receipt.coordinationAdvanceId ) ?? [];
		rows.push( receipt );
		receiptsByAdvance.set( receipt.coordinationAdvanceId, rows );

	}
	const ingressInteractionIds = new Set( crossing.filter( ( entry ) => entry.direction === 'ingress' ).map( ( entry ) => entry.record.interactionId ) );
	const requiredInputLedgerIds = Object.values( route.physicsInteractionApplicationLedgers ).filter( ( ledger ) => ingressInteractionIds.has( ledger.interactionId ) ).map( ( ledger ) => ledger.applicationLedgerId );
	assertUnique( inputLedgerIdsAcrossReceipts, `${ label} input application ledgers across receipts` );
	assert.deepEqual( [ ...inputLedgerIdsAcrossReceipts ].sort(), requiredInputLedgerIds.sort(), `${ label} external ingress application-ledger closure mismatch` );
	const requiredEgressIds = crossing.filter( ( entry ) => entry.direction === 'egress' ).map( ( entry ) => entry.record.interactionId );
	assertUnique( emittedInteractionIdsAcrossReceipts, `${ label} emitted interactions across receipts` );
	assert.deepEqual( [ ...emittedInteractionIdsAcrossReceipts ].sort(), requiredEgressIds.sort(), `${ label} external egress interaction closure mismatch` );
	for ( const [ advanceId, receipts ] of receiptsByAdvance ) if ( receipts.some( ( receipt ) => receipt.status === 'completed' ) ) assert.deepEqual( [ ...new Set( receipts.filter( ( receipt ) => receipt.status === 'completed' ).flatMap( ( receipt ) => receipt.outputPreparedVersions.map( ( output ) => output.stateEquationId ) ) ) ].sort(), [ ...adapter.ownedStateEquations ].sort(), `${ label} completed receipts for ${ advanceId} do not publish every owned equation` );
	assertUnique( adapter.stepReceipts.map( ( receipt ) => receipt.receiptId ), `${ label}.stepReceipts` );
	const synchronization = adapter.residencySynchronization;
	assert.deepEqual( Object.keys( synchronization.authorityBySignalOrStateEquation ).sort(), [ ...new Set( [ ...adapter.ownedStateEquations, ...adapter.signalDescriptors.map( ( descriptor ) => descriptor.signalId ) ] ) ].sort(), `${ label}.residencySynchronization authority closure mismatch` );
	for ( const authority of Object.values( synchronization.authorityBySignalOrStateEquation ) ) assert.ok( authority === 'external-solver' || authority === adapter.adapterId, `${ label}.residencySynchronization contains an implicit authority` );
	assert.ok( adapter.interactionCapabilities.some( ( capability ) => capability.dependencyRef.dependencyId === synchronization.resourceProtocol.acquireDependency.dependencyId ), `${ label}.resourceProtocol acquire dependency does not resolve a capability` );
	requireNonEmptyString( synchronization.resourceProtocol.lifecycleAndRetirementOwner, `${ label}.resourceProtocol.lifecycleAndRetirementOwner` );
	if ( synchronization.transport === 'shared-resource' ) {

		assert.equal( synchronization.hostVisibilityProof, 'not-host-visible', `${ label} shared resource falsely claims host visibility` );
		assert.equal( synchronization.transferProtocol.serializationLayoutAndDigest.mode, 'not-used-shared-resource', `${ label} shared resource invents a copy layout` );

	} else {

		assert.ok( [ 'device-copy', 'host-staging', 'network-message' ].includes( synchronization.transport ), `${ label} has an unsupported transport` );
		const layout = clone( synchronization.transferProtocol.serializationLayoutAndDigest );
		const contentDigest = layout.contentDigest;
		delete layout.contentDigest;
		assert.equal( contentDigest, sha256Canonical( layout ), `${ label} copy/staging/network layout digest mismatch` );
		assert.notEqual( synchronization.hostVisibilityProof, 'not-host-visible', `${ label} copy/staging/network transport lacks completion-based visibility` );

	}
	const checkpointFields = [ 'checkpointFormatAndDigest', 'cadenceAndMaximumRollback', 'includedStateVersionsInventoriesAndCursors', 'restoreOrderingAndValidationGates' ];
	if ( adapter.checkpointRollback.support === 'none' ) for ( const field of checkpointFields ) assert.ok( isTypedAbsence( adapter.checkpointRollback[ field ] ), `${ label}.checkpointRollback.${ field} must be absent when checkpointing is unsupported` );
	else for ( const field of checkpointFields ) assert.ok( ! isTypedAbsence( adapter.checkpointRollback[ field ] ), `${ label}.checkpointRollback.${ field} is absent despite checkpoint support` );
	for ( const commitGroupId of adapter.failurePolicy.freezeCommitGroups ) assert.ok( route.physicsGraph.commitGroups.some( ( group ) => group.commitGroupId === commitGroupId ), `${ label}.failurePolicy freezes unknown commit group ${ commitGroupId}` );
	assert.doesNotMatch( adapter.failurePolicy.degradedPublication, /implicit|default|best-effort|unknown/i, `${ label}.failurePolicy permits implicit degraded publication` );
	return true;

}

function validateQualityInventories( route ) {

	assert.ok( isPlainObject( route.physicsQualityRequests ), 'physicsQualityRequests must be a keyed mapping' );
	assert.ok( isPlainObject( route.physicsQualityStates ), 'physicsQualityStates must be a keyed mapping' );
	assert.ok( Array.isArray( route.physicsQualityTransitions ), 'physicsQualityTransitions must be an array' );
	if ( route.physicsQualityTransitions.length === 0 ) {

		assert.deepEqual( route.physicsQualityRequests, {}, 'route without quality transitions retains requests' );
		assert.deepEqual( route.physicsQualityStates, {}, 'route without quality transitions retains states' );
		return true;

	}
	const requestSequences = Object.values( route.physicsQualityRequests ).map( ( request ) => request.requestSequence );
	assert.ok( requestSequences.every( Number.isSafeInteger ), 'quality request sequences must be structural integers' );
	assert.equal( new Set( requestSequences ).size, requestSequences.length, 'quality request sequences contain duplicates' );
	for ( const [ requestId, request ] of Object.entries( route.physicsQualityRequests ) ) {

		requireAbiRecord( request, 'QualityChangeRequest', `physicsQualityRequests.${ requestId}` );
		assert.equal( request.requestId, requestId, `physicsQualityRequests key ${ requestId } mismatch` );
		requireAbiRecord( request.requestedAllocation, 'QualityAllocationRequest', `physicsQualityRequests.${ requestId }.requestedAllocation` );
		assert.deepEqual( [ ...request.requestedAllocation.affectedTargetsViews ].sort(), [ ...request.affectedTargetsViews ].sort(), `physicsQualityRequests.${ requestId } allocation target/view scope mismatch` );
		assertUnique( request.admissionRequirements.map( ( requirement ) => requirement.requirementId ), `physicsQualityRequests.${ requestId }.admissionRequirements` );
		for ( const [ index, requirement ] of request.admissionRequirements.entries() ) requireAbiRecord( requirement, 'QualityAdmissionRequirement', `physicsQualityRequests.${ requestId }.admissionRequirements[${ index }]` );

	}
	for ( const [ stateId, state ] of Object.entries( route.physicsQualityStates ) ) {

		requireAbiRecord( state, 'PhysicsQualityStateDescriptor', `physicsQualityStates.${ stateId}` );
		assert.equal( state.qualityStateId, stateId, `physicsQualityStates key ${ stateId } mismatch` );
		assert.equal( state.contextId, route.physicsContext.contextId, `physicsQualityStates.${ stateId } context mismatch` );

	}
	assertUnique( route.physicsQualityTransitions.map( ( transition ) => transition.transitionId ), 'physicsQualityTransitions transition IDs' );
	assert.deepEqual( route.physicsQualityTransitions.map( ( transition ) => transition.requestId ).sort(), Object.keys( route.physicsQualityRequests ).sort(), 'quality request/transition inventory closure mismatch' );
	assert.deepEqual( [ ...new Set( route.physicsQualityTransitions.flatMap( ( transition ) => [ transition.fromState, transition.toState ] ) ) ].sort(), Object.keys( route.physicsQualityStates ).sort(), 'quality state inventory is not the exact transition endpoint set' );
	const visitedQualityStateIds = new Set();
	const visitedQualityEpochs = new Set();
	for ( const [ index, transition ] of route.physicsQualityTransitions.entries() ) {

		const label = `physicsQualityTransitions[${ index }]`;
		assert.ok( Number.isSafeInteger( transition.requestSequence ), `${ label }.requestSequence must be a structural integer` );
		assert.notEqual( transition.fromState, transition.toState, `${ label} is a self-transition` );
		assert.notEqual( transition.fromQualityEpoch, transition.toQualityEpoch, `${ label} does not advance the quality epoch` );
		if ( index === 0 ) {

			visitedQualityStateIds.add( transition.fromState );
			visitedQualityEpochs.add( transition.fromQualityEpoch );

		}
		else {

			const predecessor = route.physicsQualityTransitions[ index - 1 ];
			assert.ok( predecessor.requestSequence < transition.requestSequence, `${ label} is not strictly ordered by requestSequence` );
			assert.equal( transition.fromState, predecessor.toState, `${ label} forks or is disconnected from the preceding quality transition` );
			assert.equal( transition.fromQualityEpoch, predecessor.toQualityEpoch, `${ label} quality epoch is disconnected from the preceding quality transition` );

		}
		assert.ok( ! visitedQualityStateIds.has( transition.toState ), `${ label} closes a quality-transition cycle or reuses an earlier quality state` );
		assert.ok( ! visitedQualityEpochs.has( transition.toQualityEpoch ), `${ label} closes a quality-transition cycle or reuses an earlier quality epoch` );
		visitedQualityStateIds.add( transition.toState );
		visitedQualityEpochs.add( transition.toQualityEpoch );

	}
	for ( const [ index, transition ] of route.physicsQualityTransitions.entries() ) {

		const label = `physicsQualityTransitions[${ index }]`;
		requireAbiRecord( transition, 'QualityTransition', label );
		assert.equal( transition.contextId, route.physicsContext.contextId, `${ label }.contextId mismatch` );
		const request = route.physicsQualityRequests[ transition.requestId ];
		const sourceState = route.physicsQualityStates[ transition.fromState ];
		const destinationState = route.physicsQualityStates[ transition.toState ];
		assert.ok( request && sourceState && destinationState, `${ label } references an unknown request or endpoint state` );
		assert.equal( transition.requestSequence, request.requestSequence, `${ label }.requestSequence mismatch` );
		assert.deepEqual( transition.affectedTargetsViews, request.affectedTargetsViews, `${ label } target/view scope differs from the request` );
		assert.deepEqual( transition.affectedControls, request.rankedCandidateControls, `${ label } control ranking differs from the request` );
		assert.equal( transition.sourceEvidenceDigest, sha256Canonical( request.evidenceRecords ), `${ label }.sourceEvidenceDigest does not cover request evidence` );
		assert.deepEqual( transition.triggerEvidence.pressureRecords, request.evidenceRecords, `${ label } pressure evidence differs from the request` );
		assert.deepEqual( transition.triggerEvidence.errorRecords, sourceState.physicalAndVisualErrorBounds, `${ label } trigger errors differ from the source quality state` );
		assert.deepEqual( transition.protectedInvariants, request.protectedInvariants, `${ label } changes protected invariants` );
		assert.deepEqual( [ transition.fromQualityEpoch, transition.toQualityEpoch ], [ sourceState.qualityEpoch, destinationState.qualityEpoch ], `${ label } epoch endpoints differ from quality states` );
		const requestAdmission = requireAbiRecord( transition.requestAdmission, 'QualityRequestAdmission', `${ label}.requestAdmission` );
		assert.deepEqual( [ requestAdmission.requestId, requestAdmission.currentQualityStateId, requestAdmission.currentQualityEpoch, requestAdmission.selectedCandidateQualityStateId ], [ request.requestId, sourceState.qualityStateId, sourceState.qualityEpoch, destinationState.qualityStateId ], `${ label}.requestAdmission request/source/destination mismatch` );
		assert.equal( requestAdmission.status, 'admitted', `${ label } performs quality work without request admission` );
		assert.ok( requestAdmission.safeCommitBoundary.kind === 'instant' && ! isTypedAbsence( requestAdmission.safeCommitBoundary.instant ) && isTypedAbsence( requestAdmission.safeCommitBoundary.interval ), `${ label}.requestAdmission lacks an exact instant safe boundary` );
		assert.deepEqual( requestAdmission.safeCommitBoundary.instant, transition.commitAtStepBoundary.commitInstant, `${ label } commit instant differs from the admitted boundary` );
		assert.equal( requestAdmission.allocationRequestDigest, sha256Canonical( request.requestedAllocation ), `${ label}.requestAdmission allocation digest mismatch` );
		assert.deepEqual( requestAdmission.admissionRequirementResults.map( ( result ) => result.requirementId ).sort(), request.admissionRequirements.map( ( requirement ) => requirement.requirementId ).sort(), `${ label}.requestAdmission requirement closure mismatch` );
		for ( const result of requestAdmission.admissionRequirementResults ) {

			const requirement = request.admissionRequirements.find( ( candidate ) => candidate.requirementId === result.requirementId );
			assert.equal( result.status, 'accepted', `${ label}.requestAdmission requirement ${ result.requirementId } is not accepted` );
			assert.equal( result.evidenceRef, requirement.evidenceRef, `${ label}.requestAdmission requirement ${ result.requirementId } cites other evidence` );

		}
		assert.ok( requestAdmission.hysteresisAndMinimumResidenceResults.length > 0 && requestAdmission.hysteresisAndMinimumResidenceResults.every( ( result ) => result.status === 'accepted' ), `${ label}.requestAdmission lacks accepted hysteresis/minimum-residence evidence` );
		const allocation = requireAbiRecord( transition.prepare.allocationAdmission, 'QualityAllocationAdmission', `${ label}.prepare.allocationAdmission` );
		assert.deepEqual( [ allocation.allocationRequestId, allocation.transitionId, allocation.status ], [ request.requestedAllocation.allocationRequestId, transition.transitionId, 'admitted' ], `${ label}.prepare allocation admission mismatch` );
		assert.ok( transition.prepare.allocateCompilePopulate.length > 0 && transition.prepare.allocateCompilePopulate.every( ( operation ) => typeof operation === 'string' && operation.startsWith( `after-${ allocation.allocationAdmissionId }:` ) ), `${ label}.prepare work is not sequenced after allocation admission` );
		requireAbiRecord( transition.prepare.predictedPeakResources, 'PhysicsMemoryLedger', `${ label}.prepare.predictedPeakResources` );
		requireAbiRecord( allocation.simultaneousOldNewPeakProof, 'PhysicsMemoryLedger', `${ label}.prepare.allocationAdmission.simultaneousOldNewPeakProof` );
		assert.ok( allocation.limitHeadroomAndThermalGateResults.length > 0 && allocation.limitHeadroomAndThermalGateResults.every( ( result ) => result.status === 'accepted' ), `${ label}.prepare allocation has a rejected/implicit capacity gate` );
		assert.equal( allocation.receiptDigest, sha256CanonicalExcluding( allocation, [ 'receiptDigest' ] ), `${ label}.prepare allocation receipt digest mismatch` );
		assert.ok( transition.commitAtStepBoundary.conservativeMap.length > 0, `${ label} has no conservative state map` );
		for ( const [ mapIndex, stateMap ] of transition.commitAtStepBoundary.conservativeMap.entries() ) {

			requireAbiRecord( stateMap, 'ConservativeStateMap', `${ label}.commitAtStepBoundary.conservativeMap[${ mapIndex }]` );
			assert.deepEqual( [ stateMap.contextId, stateMap.sourceQualityStateId, stateMap.destinationQualityStateId ], [ route.physicsContext.contextId, sourceState.qualityStateId, destinationState.qualityStateId ], `${ label} conservative map endpoint mismatch` );
			assert.ok( route.physicsErrorPropagationLedgers[ stateMap.errorPropagationLedgerRef ], `${ label} conservative map error ledger does not resolve` );
			assert.equal( stateMap.acceptanceGate.status, 'accepted', `${ label} conservative map is not accepted` );
			assert.ok( stateMap.conservedCommodities.length > 0 && stateMap.positivityAndConstraintPreservation.every( ( result ) => result.status === 'accepted' ), `${ label} conservative map lacks commodity/positivity closure` );

		}
		const expectedEmitterKeys = destinationState.stateVariablesAndInventories.stateEquations;
		assert.ok( Array.isArray( expectedEmitterKeys ) && expectedEmitterKeys.length > 0, `${ label} destination state has no declared state equations` );
		assert.deepEqual( Object.keys( transition.commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel ).sort(), [ ...expectedEmitterKeys ].sort(), `${ label} authoritative emitter closure mismatch` );
		assert.ok( Object.values( transition.commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel ).every( ( value ) => value === 'exactly-one-owner-and-representation' ), `${ label} admits duplicate state-equation/source-channel emitters` );
		assert.equal( transition.commitAtStepBoundary.atomicPublication, 'required', `${ label} quality commit is not atomic` );
		const retirement = transition.retireAfterCompletion;
		requireAbiRecord( retirement.completionJoin, 'ConsumerCompletionJoin', `${ label}.retireAfterCompletion.completionJoin` );
		assert.ok( retirement.oldResourceLeases.length > 0, `${ label} retires no source resource leases` );
		const completionTokens = [ ...retirement.completionJoin.simulationConsumers, ...retirement.completionJoin.couplingConsumers, ...retirement.completionJoin.externalConsumers, ...retirement.completionJoin.presentationConsumers ];
		assertUnique( completionTokens.map( ( token ) => token.tokenId ), `${ label}.retireAfterCompletion completion token IDs` );
		assert.deepEqual( [ ...retirement.completionJoin.requiredConsumerKeys ].sort(), completionTokens.map( ( token ) => token.consumerKey ).sort(), `${ label}.retireAfterCompletion consumer closure mismatch` );
		assert.equal( retirement.completionJoin.joinDigest, sha256CanonicalExcluding( retirement.completionJoin, [ 'joinDigest' ] ), `${ label}.retireAfterCompletion completion-join digest mismatch` );
		assert.deepEqual( [ ...retirement.retirementEvidence.completedConsumerKeys ].sort(), [ ...retirement.completionJoin.requiredConsumerKeys ].sort(), `${ label} retires before every consumer completes` );
		assert.ok( transition.resetPlan.length > 0, `${ label} has no reset plan` );
		for ( const [ actionIndex, action ] of transition.resetPlan.entries() ) {

			requireAbiRecord( action, 'ScopedResetAction', `${ label}.resetPlan[${ actionIndex }]` );
			assert.deepEqual( action.causeEpochs, [ transition.fromQualityEpoch, transition.toQualityEpoch ], `${ label}.resetPlan[${ actionIndex }] epoch scope mismatch` );

		}

	}
	return true;

}

let physicsContractProfilePrinted = false;
function validatePhysicalRouteManifest( route ) {

	const phaseTimings = {};
	let phaseStartedAt = performance.now();
	const markPhase = ( label ) => {

		if ( process.env.PHYSICS_PROFILE_SETUP === '1' && ! physicsContractProfilePrinted ) phaseTimings[ label ] = performance.now() - phaseStartedAt;
		phaseStartedAt = performance.now();

	};
	validateCanonicalContext( route.physicsContext );
	markPhase( 'context' );
	requireNonEmptyMapping( route.physicsSignals, 'physical route physicsSignals' );
	for ( const [ key, descriptor ] of Object.entries( route.physicsSignals ) ) validateCanonicalSignal( key, descriptor, route.physicsContext );
	markPhase( 'signals' );
	const gravity = Object.values( route.physicsSignals ).find( ( descriptor ) => descriptor.signalId === route.physicsContext.gravityProvider.signalId );
	assert.ok( gravity, 'physicsContext.gravityProvider does not resolve to a registered descriptor' );
	assert.equal( gravity.stateVersion, route.physicsContext.gravityProvider.descriptorStateVersion, 'physicsContext.gravityProvider version mismatch' );
	assert.equal( gravity.schemaId, route.physicsContext.gravityProvider.schemaId, 'physicsContext.gravityProvider schema mismatch' );
	assert.equal( gravity.contextId, route.physicsContext.gravityProvider.contextId, 'physicsContext.gravityProvider context mismatch' );
	const gravityChannel = gravity.channels[ route.physicsContext.gravityProvider.channelId ];
	assert.ok( gravityChannel, 'physicsContext.gravityProvider channel does not resolve' );
	assert.deepEqual( [ route.physicsContext.gravityProvider.quantityDimension, gravityChannel.unit, gravityChannel.basisBehavior ], [ 'acceleration', route.physicsContext.gravityProvider.unit, route.physicsContext.gravityProvider.basisBehavior ], 'physicsContext.gravityProvider dimension/unit/basis mismatch' );
	assert.ok( isPlainObject( route.physicsExternalSolverAdaptersById ), 'physicsExternalSolverAdaptersById must be a keyed mapping' );
	for ( const [ adapterId, adapter ] of Object.entries( route.physicsExternalSolverAdaptersById ) ) {

		assert.equal( adapterId, adapter.adapterId, `external solver adapter registry key ${ adapterId } mismatch` );
		validateExternalSolverAdapter( route, adapter, `physicsExternalSolverAdaptersById.${ adapterId}` );

	}
	validateExternalAdapterOwnershipPartition( route );
	markPhase( 'externalAdapters' );
	validateCanonicalGraphV2( route.physicsGraph, route.physicsSignals, route.physicsContext, route );
	markPhase( 'graph' );
	assert.ok( Array.isArray( route.physicsInteractions ), 'physical route physicsInteractions must be an array' );
	for ( let i = 0; i < route.physicsInteractions.length; i ++ ) validateCanonicalExchange( route.physicsInteractions[ i ], route.physicsContext, i );
	validateExactOnceInteractionApplication( route );
	markPhase( 'interactions' );
	const presentation = validateCanonicalPresentation( route );
	validateCanonicalExecution( route.frameExecutionRecord, route, presentation );
	markPhase( 'presentation' );
	validateCanonicalCostLedger( route.physicsCostLedger, route.physicsGraph, route.physicsContext, route );
	markPhase( 'cost' );
	validateQualityInventories( route );
	markPhase( 'quality' );
	assert.ok( isNotUsedRecord( route.physicsPresentationSnapshot ), 'deprecated singular physicsPresentationSnapshot must remain not used' );
	validateNumericEvidence( route );
	markPhase( 'numericEvidence' );
	if ( process.env.PHYSICS_PROFILE_SETUP === '1' && ! physicsContractProfilePrinted ) {

		physicsContractProfilePrinted = true;
		console.log( JSON.stringify( { physicsContractPhaseTimingsMs: phaseTimings }, null, 2 ) );

	}

}

function assertCanonicalCoupledFixtureCoverage( route ) {

	const mappingKinds = new Set( Object.values( route.physicsContext.physicsClockRegistry.clocksById ).map( ( clock ) => clock.mappingKind ) );
	for ( const kind of [ 'fixed-rational', 'timestamp-table', 'piecewise-versioned' ] ) assert.ok( mappingKinds.has( kind ), `canonical coupled fixture does not cover ${ kind } clock mapping` );
	const signalText = JSON.stringify( route.physicsSignals );
	assert.match( signalText, /water/i, 'canonical coupled fixture does not cover a water signal' );
	assert.match( signalText, /body|rigid/i, 'canonical coupled fixture does not cover a body signal' );
	const coupledLoop = route.physicsGraph.loopMacros.find( ( loop ) => loop.loopId === 'body-water-loop' );
	assert.ok( coupledLoop && coupledLoop.perIterationLedger.length > 1, 'canonical coupled fixture does not cover the body-water iterative loop' );
	assert.ok( route.physicsInteractions.some( ( exchange ) => exchange.mode !== 'one-way' && exchange.reactionGroups.some( ( group ) => group.sourceInteractionIds.length > 1 && group.reactionInteractionIds.length > 1 ) ), 'canonical coupled fixture does not exercise many-to-many source/reaction coverage' );
	assert.ok( route.physicsCostLedger.presentationTargetsAndViews.length >= 2, 'canonical coupled fixture does not cover multiple presentation views' );
	assert.ok( route.physicsCostLedger.measurementProtocolRefs.length >= 2, 'canonical coupled fixture does not cover protocol plus sustained trace identity' );
	assert.match( JSON.stringify( route.physicsCostLedger.harness.target ), /mobile|low-end|tile/i, 'canonical coupled fixture does not cover the mobile/low-end harness' );
	assert.ok( route.physicsCostLedger.graphStageCosts.every( ( cost ) => quantityValue( cost.sampleCount, `canonicalCoverage.${ cost.stageId}.sampleCount` ) >= 120 ), 'canonical coupled fixture does not cover sustained stage samples' );
	assert.ok( Object.hasOwn( route.physicsCostLedger.cadenceTraceTotals.nativeSubcycleCounts, '$threejs-water-optics' ), 'canonical coupled fixture does not cover water native-subcycle totals' );
	assert.ok( Object.keys( route.physicsExternalSolverAdaptersById ).length > 0, 'canonical coupled fixture does not cover an external solver adapter' );
	for ( const [ adapterId, adapter ] of Object.entries( route.physicsExternalSolverAdaptersById ) ) validateExternalSolverAdapterFixture( fixtureModuleHelpers, route, adapter, `canonicalCoverage.externalAdapters.${ adapterId}` );
	assert.ok( route.physicsQualityTransitions.length > 0, 'canonical coupled fixture does not cover a quality transition' );
	validateQualityTransitionBundle( fixtureModuleHelpers, route );
	return true;

}

function validateUniqueStateEquationOwnership( fixture ) {

	const graph = fixture.route.physicsGraph;
	const ownersByEquation = new Map();
	for ( const group of graph.commitGroups ) {

		requireAbiRecord( group, 'PhysicsCommitGroup', `semantic.${ group.commitGroupId }` );
		const publicationEquationBySignal = new Map( group.committedPublications.map( ( publication ) => [ publication.signalId, publication.stateEquation ] ) );
		assert.equal( publicationEquationBySignal.size, group.committedPublications.length, `commit group ${ group.commitGroupId } duplicates a committed signal` );
		assert.deepEqual( Object.keys( group.stateEquationOwners ).sort(), [ ...new Set( publicationEquationBySignal.values() ) ].sort(), `commit group ${ group.commitGroupId } state-equation owner inventory does not close over committed publications` );
		for ( const [ equation, owner ] of Object.entries( group.stateEquationOwners ) ) {

			assert.ok( ! ownersByEquation.has( equation ), `state equation ${ equation } has duplicate ownership` );
			requireNonEmptyString( owner, `state equation ${ equation } owner` );
			ownersByEquation.set( equation, owner );

		}
		for ( const publication of group.preparedPublications ) {

			const equation = publicationEquationBySignal.get( publication.preparedVersion.signalId );
			assert.ok( equation, `prepared publication ${ publication.preparedPublicationId } does not resolve one committed state equation` );
			assert.equal( group.stateEquationOwners[ equation ], publication.stateEquationOwner, `state equation ${ equation } is missing its unique prepared-publication owner` );

		}

	}
	for ( const claim of graph.executionLedger.stateAdvanceClaims ) assert.equal( ownersByEquation.get( claim.stateEquationId ), claim.owner, `state equation ${ claim.stateEquationId } claim owner differs from its unique commit owner` );
	return true;

}

function validateProperOrthogonalTransforms( fixture ) {

	validateCanonicalContext( fixture.route.physicsContext );
	validateCanonicalPresentation( fixture.route );
	return true;

}

function validateCanonicalRationalSubstep( fixture ) {

	canonicalInstantSeconds( fixture.route.physicsGraph.coordinationInterval.start, fixture.route.physicsContext, 'semantic.rationalSubstep' );
	return true;

}

function validateOrderedCompatibleInterval( fixture ) {

	validateCanonicalInterval( fixture.route.physicsGraph.coordinationInterval, fixture.route.physicsContext, 'semantic.orderedInterval' );
	return true;

}

function validateClockMappingEvaluation( fixture ) {

	validateCanonicalContext( fixture.route.physicsContext );
	return true;

}

function validatePhysicsGraphOrderingAndLoops( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	return true;

}

function validateAtomicPublicationLineage( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	return true;

}

function validateSignalChannelErrorAndAbsenceClosure( fixture ) {

	for ( const [ key, descriptor ] of Object.entries( fixture.route.physicsSignals ) ) validateCanonicalSignal( key, descriptor, fixture.route.physicsContext );
	validateProviderWaterBundle( fixtureModuleHelpers, fixture.providerWaterBundle, fixture.route );
	return true;

}

function validateDimensionalInteractionAndQuadrature( fixture ) {

	validateCanonicalExchange( fixture.route.physicsInteractions[ 0 ], fixture.route.physicsContext, 'semantic-dimensional' );
	return true;

}

function validateInteractionDeliveryAndReactionAtomicity( fixture ) {

	validateCanonicalExchange( fixture.route.physicsInteractions[ 0 ], fixture.route.physicsContext, 'semantic-delivery' );
	validateExactOnceInteractionApplication( fixture.route );
	return true;

}

function validateStableGenerationIdentity( fixture ) {

	validateContactIdentityBundle( fixtureModuleHelpers, fixture.route, fixture.contactIdentityBundle );
	return true;

}

function validateAuthoritativeGpuRecovery( fixture ) {

	validateExternalGpuFixtureBundle( fixtureModuleHelpers, fixture.route, fixture.externalGpuBundle );
	return true;

}

function validateExternalSolverBoundaryOwnership( fixture ) {

	validateExternalGpuFixtureBundle( fixtureModuleHelpers, fixture.route, fixture.externalGpuBundle );
	assert.deepEqual( fixture.route.physicsExternalSolverAdaptersById[ fixture.externalGpuBundle.externalAdapterVariants.sharedResource.adapterId ], fixture.externalGpuBundle.externalAdapterVariants.sharedResource, 'route active external adapter differs from the validated shared-resource adapter' );
	return true;

}

function validatePresentationPublicationClosure( fixture ) {

	validateCanonicalPresentation( fixture.route );
	return true;

}

function validateLeaseConsumerJoinAndRetirement( fixture ) {

	const presentation = validateCanonicalPresentation( fixture.route );
	validateCanonicalExecution( fixture.route.frameExecutionRecord, fixture.route, presentation );
	return true;

}

function validateAtomicPhysicsOriginRebase( fixture ) {

	const route = fixture.crossOriginRoute;
	validateCanonicalGraphV2( route.physicsGraph, route.physicsSignals, route.physicsContext, route );
	const presentation = validateCanonicalPresentation( route );
	validateCanonicalExecution( route.frameExecutionRecord, route, presentation );
	for ( const transaction of route.physicsGraph.originRebaseTransactions ) {

		const bridged = route.physicsPresentationCandidate.presentedStatePairs.filter( ( pair ) => ! isTypedAbsence( pair.previousPresented.originEpochBridge ) && pair.previousPresented.originEpochBridge.transactionId === transaction.transactionId );
		assert.ok( bridged.length > 0, `origin rebase ${ transaction.transactionId } has no bridged state consumer` );
		assert.deepEqual( Object.keys( transaction.affectedOwnersAndCommittedVersions ).sort(), [ ...new Set( bridged.map( ( pair ) => pair.providerId ) ) ].sort(), `origin rebase ${ transaction.transactionId } affected-owner closure mismatch` );
		for ( const pair of bridged ) {

			const bridge = pair.previousPresented.originEpochBridge;
			assert.deepEqual( [ bridge.fromPhysicsOriginEpoch, bridge.toPhysicsOriginEpoch, bridge.fromToTransformRevision ], [ transaction.fromPhysicsOriginEpoch, transaction.toPhysicsOriginEpoch, transaction.fromToTransform.transformRevision ], `origin bridge ${ pair.bindingId } does not resolve its transaction` );
			assert.ok( transaction.affectedOwnersAndCommittedVersions[ pair.providerId ].includes( pair.previousPresented.provenance.upperBracket.stateVersion ), `origin rebase ${ transaction.transactionId } omits ${ pair.bindingId } committed version` );

		}

	}
	return true;

}

function validateConservativeQualityMigration( fixture ) {

	validateQualityTransitionBundle( fixtureModuleHelpers, fixture.route );
	return true;

}

function validateAlignedCostTraceAndNoCriticalReadback( fixture ) {

	validateCanonicalCostLedger( fixture.route.physicsCostLedger, fixture.route.physicsGraph, fixture.route.physicsContext, fixture.route );
	return true;

}

function validateComposedCostEnvelope( fixture ) {

	validateCanonicalCostLedger( fixture.route.physicsCostLedger, fixture.route.physicsGraph, fixture.route.physicsContext, fixture.route );
	return validateCanonicalComposedCostEvidence( fixture.route.physicsCostLedger, fixture.route.physicsGraph, fixture.route.physicsContext, fixture.route );

}

function validateRegistryAuthorityAndDagClosure( fixture ) {

	const context = fixture.route.physicsContext;
	validateCanonicalContext( context );
	const frames = context.physicsFrameRegistry.framesById;
	for ( const [ key, frame ] of Object.entries( frames ) ) assert.equal( key, frame.frameId, `physics frame registry key ${ key} differs from frameId` );
	assert.equal( context.chartRegistry.anchorFrameRegistryRevision, context.physicsFrameRegistry.registryRevision, 'chart registry is anchored to another frame-registry revision' );
	const visiting = new Set();
	const visited = new Set();
	const visit = ( frameId ) => {

		if ( visited.has( frameId ) || frameId === 'root' ) return;
		assert.ok( frames[ frameId ], `physics frame ${ frameId} has no registry entry` );
		assert.ok( ! visiting.has( frameId ), `physics frame registry contains a parent cycle at ${ frameId}` );
		visiting.add( frameId );
		visit( frames[ frameId ].parentFrameId );
		visiting.delete( frameId );
		visited.add( frameId );

	};
	for ( const frameId of Object.keys( frames ) ) visit( frameId );
	validateContactIdentityBundle( fixtureModuleHelpers, fixture.route, fixture.contactIdentityBundle );
	return true;

}

function validateCoordinationAdvanceAndCatchUp( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	if ( fixture.route.physicsGraph.catchUpPolicy.debtDisposition === 'drop-with-loss-ledger' ) {

		assert.ok( ! isTypedAbsence( fixture.route.physicsGraph.catchUpBatch ), 'drop catch-up policy requires a serialized catch-up batch' );
		assert.ok( fixture.route.physicsCostLedger.cadenceTraceTotals.droppedCoordinationIntervals.length > 0, 'drop catch-up policy requires an exact lost-interval ledger' );

	}
	return true;

}

function validateDependencyCompletionInstances( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	for ( const completion of fixture.route.physicsGraph.executionLedger.dependencyCompletions ) assert.notEqual( completion.completionId, completion.dependencyId, `dependency template ${ completion.dependencyId } cannot stand in for an execution-level completion instance` );
	return true;

}

function validateAtomicCommitTransaction( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	return true;

}

function validateCouplingIterationLineage( fixture ) {

	validateCanonicalGraphV2( fixture.route.physicsGraph, fixture.route.physicsSignals, fixture.route.physicsContext, fixture.route );
	return true;

}

function validatePhysicalImpactPartitionClosure( fixture ) {

	return validatePhysicalImpactPartitionBundle( fixtureModuleHelpers, fixture.route, fixture.physicalImpactPartitionBundle );

}

function validateDeformingAndFluidBoundaryProxy( fixture ) {

	validateContactIdentityBundle( fixtureModuleHelpers, fixture.route, fixture.contactIdentityBundle );
	return true;

}

function validateExternalDirectionalCapability( fixture ) {

	validateExternalGpuFixtureBundle( fixtureModuleHelpers, fixture.route, fixture.externalGpuBundle );
	assert.deepEqual( fixture.route.physicsExternalSolverAdaptersById[ fixture.externalGpuBundle.externalAdapterVariants.sharedResource.adapterId ], fixture.externalGpuBundle.externalAdapterVariants.sharedResource, 'directional-capability fixture is not the route active external adapter' );
	return true;

}

function validatePresentationCohortAndSlotAdmission( fixture ) {

	const presentation = validateCanonicalPresentation( fixture.route );
	validateCanonicalExecution( fixture.route.frameExecutionRecord, fixture.route, presentation );
	return true;

}

function validateImmutableRenderPlanClosure( fixture ) {

	const presentation = validateCanonicalPresentation( fixture.route );
	validateCanonicalExecution( fixture.route.frameExecutionRecord, fixture.route, presentation );
	return true;

}

function validateQualityRequestAndAllocationAdmission( fixture ) {

	validateQualityTransitionBundle( fixtureModuleHelpers, fixture.route );
	return true;

}

function validateMemoryTrafficAndWorkAttribution( fixture ) {

	validateCanonicalCostLedger( fixture.route.physicsCostLedger, fixture.route.physicsGraph, fixture.route.physicsContext, fixture.route );
	return true;

}

function validateCadenceTraceTotals( fixture ) {

	validateCanonicalCostLedger( fixture.route.physicsCostLedger, fixture.route.physicsGraph, fixture.route.physicsContext, fixture.route );
	const totals = fixture.route.physicsCostLedger.cadenceTraceTotals;
	assert.doesNotMatch( JSON.stringify( totals ), /(?:p50|p95|percentile)[-_ ]*(?:product|times|multipl)/i, 'exact cadence totals cannot be derived from a percentile product' );
	assert.equal( new Set( Object.values( totals.stageExecutionCounts ).map( ( count ) => count.source ) ).size, 1, 'cadence exact counts mix traces' );
	return true;

}

function makeCanonicalClocks() {

	const absentMapping = ( owner = 'route-physics-coordinator' ) => typedAbsence( 'not-applicable', owner, 'timeless', 'inactive clock-mapping arm' );
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
	else seconds = externalMappingSeconds( clock.mapping.external, coordinate, 'fixture.external.frozenEvaluationTable' );
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
		parentFromFrameRotation: fields.rotation,
		parentFromFrameTranslationMeters: fields.translation,
		originCoordinateRateInParentMps: fields.linearRate,
		angularRateOfFrameRelativeToParentInParentRadPerS: fields.angularRate,
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
	const perChannelError = Object.fromEntries( fields.channels.map( ( channel ) => {

		const error = fixtureError( channel.unit, channel.errorBound, 'fixture-signal-error' );
		error.errorId = `${ fields.signalId }/error/${ channel.id }`;
		error.quantityOrChannelId = channel.id;
		return [ channel.id, error ];

	} ) );
	const channels = Object.fromEntries( fields.channels.map( ( channel ) => [ channel.id, {
		channelId: channel.id, valueType: channel.valueType, tensorRankAndShape: channel.kind, unit: channel.unit, basisBehavior: channel.basisBehavior,
		quantityClass: channel.classification, samplingMeasure: channel.kind === 'point' ? 'point' : 'area', declaredSupport: support, declaredFilter: filter,
		timeSemantics: 'state-over-interval', validity, errorRef: `${ fields.signalId }/error/${ channel.id }`
	} ] ) );
	return {
		signalId: fields.signalId, providerId: fields.providerId, schemaId: fields.schemaId, contextId: 'coastal-coupling-context', owner: fields.owner,
		consumers: fields.consumers, channels, physicsFrameId: fields.physicsFrameId, physicsOriginEpoch: 'physics-origin-17', transformRevision: fields.transformRevision,
		chartId: typedAbsence( 'not-applicable', fields.owner ), clockId: fields.clockId, samplePhase: 'interval-end',
		representedFootprint: support, filter, validity,
		perChannelError,
		residency: { kind: 'gpu', deviceId: 'fixture-webgpu-device', queueId: 'default-queue', bindingIdentity: `${ fields.signalId }-binding`, sameQueueAvailability: 'after producing dispatch', hostVisibility: 'not-host-visible', mirror: { kind: 'absent', sourceStateVersion: typedAbsence( 'unavailable', fields.owner ), mirrorStateVersion: typedAbsence( 'unavailable', fields.owner ), availableAt: typedAbsence( 'unavailable', fields.owner ), age: typedAbsence( 'unavailable', fields.owner ), error: typedAbsence( 'unavailable', fields.owner ), synchronization: typedAbsence( 'unavailable', fields.owner ) }, readbackPolicy: 'diagnostic-delayed-only' },
		cadence: { kind: fields.cadenceKind, clockId: fields.clockId, intervalOrTrigger: fields.cadenceParameters, samplePhase: fields.cadenceKind === 'analytic-on-demand' ? 'analytic-at-request' : 'substep-stage', jitterBound: fixtureDurationSeconds( 0.001, 'fixture-cadence' ), maximumBurst: evidence( 4, 'execution', 'Gated', 'fixture-cadence' ), evidence: 'fixture graph/cost trace' },
		latency: { productionDelay: fixtureDurationSeconds( 0 ), consumerAvailability: 'same-queue dependency', maximumStaleness: fixtureDurationSeconds( 0.05 ), hostVisibleDelay: typedAbsence( 'unavailable', fields.owner ), clockMappingRevision: fields.sampleInterval.intervalMappingRevision, error: fixtureError( 'second', 1e-6, 'fixture-latency' ) },
		stateVersion: fields.stateVersion, resourceGeneration: { kind: 'present', generation: fields.resourceGeneration }, missingChannelPolicy: 'report-absent'
	};

}

function attachCanonicalGraph( route, fixedInterval, adaptiveInterval, eventInterval ) {

	const signalId = ( key ) => route.physicsSignals[ key ].signalId;
	const intervalTime = ( interval, owner ) => ( { kind: 'interval', instant: typedAbsence( 'not-applicable', owner ), interval: clone( interval ) } );
	const phaseByStageKind = { ingest: 'interval-start', predict: 'substep-stage', 'emit-interactions': 'substep-stage', 'solve-subcycles': 'substep-stage', 'reduce-reactions': 'substep-stage', correct: 'substep-stage', commit: 'interval-end', 'publish-presentation': 'analytic-at-request' };
	const readSpec = ( key, resolutionTemplate, disposition ) => ( { key, resolutionTemplate, disposition, stateVersionRule: disposition === 'loop-provisional' ? 'loop-seed-or-prior-iteration' : 'exact-named-version' } );
	const writeSpec = ( key, resolutionTemplate, disposition, commitGroupId, claimId, publicationEligibility ) => ( { key, resolutionTemplate, disposition, commitGroupId, claimId, publicationEligibility } );
	const loopStageIds = new Set( [ 'predict-body', 'emit-body-water', 'solve-water', 'reduce-coupling' ] );
	const readResolutionTemplateById = new Map();
	const writeResolutionTemplateById = new Map();
	const makeStage = ( id, kind, owner, interval, readSpecs, writeSpecs, nativeStepRule ) => {

		const samplePhase = phaseByStageKind[ kind ];
		const partition = nativeStepRule === 'adaptive' ? 'exact-subcycle-tile' : nativeStepRule === 'analytic' ? 'analytic-samples' : nativeStepRule === 'event' ? 'sparse-events' : 'single';
		const activation = loopStageIds.has( id ) ? 'per-loop-iteration' : nativeStepRule === 'analytic' ? 'per-analytic-request' : nativeStepRule === 'event' ? 'per-event' : 'per-advance';
		return {
			stageId: id, stageKind: kind, owner, clockId: interval.clockId, executionInterval: clone( interval ), samplePhase,
			reads: readSpecs.map( ( spec, index ) => {

				const readId = `${ id}/read-${ index }`;
				readResolutionTemplateById.set( readId, spec.resolutionTemplate );
				return { readId, signalId: signalId( spec.key ), requiredStateVersionRule: spec.stateVersionRule, requiredDisposition: spec.disposition, requestedTime: intervalTime( interval, owner ), samplePhase, maximumStaleness: fixtureDurationSeconds( 0.05 ), dependencyId: `${ id}/read-${ index }/dependency-pending`, consumerTolerance: 'exact version/frame/clock or block' };

			} ),
			writes: writeSpecs.map( ( spec, index ) => {

				const writeId = `${ id}/write-${ index }`;
				writeResolutionTemplateById.set( writeId, spec.resolutionTemplate );
				return { writeId, signalId: signalId( spec.key ), producedStateVersionRule: 'execution-derived-unique-version', disposition: spec.disposition, producedTime: intervalTime( interval, owner ), commitGroupId: spec.commitGroupId ?? typedAbsence( 'not-applicable', owner ), stateAdvanceClaimId: spec.claimId ?? typedAbsence( 'not-applicable', owner ), publicationEligibility: spec.publicationEligibility };

			} ),
			immutableSubstepParameters: { parameterRecordId: `${ id }-parameters`, version: 'parameters-v1' }, nativeStepRule,
			executionRule: { activation, partition, maximumActivationsPerAdvance: evidence( loopStageIds.has( id ) ? 3 : 1, 'activation', 'Gated', 'fixture-scheduler' ), maximumExecutionsPerActivation: evidence( nativeStepRule === 'adaptive' ? 3 : 1, 'execution', 'Gated', 'fixture-scheduler' ), nativeSubcycleSelection: nativeStepRule === 'adaptive' ? 'stability-bound' : nativeStepRule === 'event' ? 'event-times' : nativeStepRule === 'analytic' ? 'not-applicable' : 'fixed-count', ordering: 'monotonic-interval-then-native-sequence' },
			executionResidency: { kind: 'gpu', deviceId: 'fixture-webgpu-device', queueId: 'default-queue', bindingIdentity: `${ id }-execution-binding`, sameQueueAvailability: 'after producing dispatch completion', hostVisibility: 'not-host-visible', mirror: { kind: 'absent', sourceStateVersion: typedAbsence( 'unavailable', owner ), mirrorStateVersion: typedAbsence( 'unavailable', owner ), availableAt: typedAbsence( 'unavailable', owner ), age: typedAbsence( 'unavailable', owner ), error: typedAbsence( 'unavailable', owner ), synchronization: typedAbsence( 'unavailable', owner ) }, readbackPolicy: 'diagnostic-delayed-only' },
			failurePolicy: 'rollback provisional/prepared namespaces and preserve prior registry revision'
		};

	};
	const stages = [
		makeStage( 'ingest-gravity', 'ingest', 'environment-owner', eventInterval, [], [ writeSpec( 'gravity', 'forcing-42/gravity-prepared', 'transaction-prepared', 'forcing-commit', 'gravity-advance-claim-42', 'transaction-commit-only' ) ], 'event' ),
		makeStage( 'predict-body', 'predict', '$threejs-procedural-motion-systems', fixedInterval, [ readSpec( 'gravity', 'forcing-42/gravity-prepared', 'transaction-prepared' ) ], [ writeSpec( 'bodyState', 'loop-42/iteration-{i}/body', 'loop-provisional', null, 'body-advance-claim-42', 'loop-accepted-only' ) ], 'fixed' ),
		makeStage( 'emit-body-water', 'emit-interactions', '$threejs-procedural-motion-systems', fixedInterval, [ readSpec( 'bodyState', 'loop-42/iteration-{i}/body', 'loop-provisional' ) ], [], 'event' ),
		makeStage( 'solve-water', 'solve-subcycles', '$threejs-water-optics', adaptiveInterval, [ readSpec( 'bodyState', 'loop-42/iteration-{i}/body', 'loop-provisional' ) ], [ writeSpec( 'waterSurface', 'loop-42/iteration-{i}/water/subcycle-{s}', 'loop-provisional', null, 'water-advance-claim-42', 'loop-accepted-only' ) ], 'adaptive' ),
		makeStage( 'reduce-coupling', 'reduce-reactions', 'route-physics-coordinator', fixedInterval, [ readSpec( 'waterSurface', 'loop-42/iteration-{i}/water/subcycle-2', 'loop-provisional' ) ], [], 'event' ),
		makeStage( 'correct-water', 'correct', '$threejs-water-optics', adaptiveInterval, [ readSpec( 'waterSurface', 'loop-42/iteration-2/water/subcycle-2', 'loop-provisional' ) ], [ writeSpec( 'waterSurface', 'water-42/prepared', 'transaction-prepared', 'coupled-commit', 'water-advance-claim-42', 'transaction-commit-only' ) ], 'fixed' ),
		makeStage( 'correct-body', 'correct', '$threejs-procedural-motion-systems', fixedInterval, [ readSpec( 'bodyState', 'loop-42/iteration-2/body', 'loop-provisional' ) ], [ writeSpec( 'bodyState', 'body-42/prepared', 'transaction-prepared', 'coupled-commit', 'body-advance-claim-42', 'transaction-commit-only' ) ], 'fixed' ),
		makeStage( 'commit-coupled', 'commit', 'route-physics-coordinator', fixedInterval, [ readSpec( 'waterSurface', 'water-42/prepared', 'transaction-prepared' ), readSpec( 'bodyState', 'body-42/prepared', 'transaction-prepared' ) ], [ writeSpec( 'commitToken', 'commit-42/prepared', 'transaction-prepared', 'coupled-commit', null, 'transaction-commit-only' ) ], 'event' ),
		makeStage( 'publish-presentation', 'publish-presentation', 'route-physics-coordinator', fixedInterval, [ readSpec( 'commitToken', 'commit-42/prepared', 'transaction-prepared' ) ], [], 'analytic' )
	];
	const stagesById = new Map( stages.map( ( stage ) => [ stage.stageId, stage ] ) );
	const makeEdge = ( id, producerStageId, consumerStageId, key, versionRule, disposition ) => {

		const producer = stagesById.get( producerStageId );
		const consumer = stagesById.get( consumerStageId );
		const producerWrite = producer.writes.find( ( write ) => write.signalId === signalId( key ) );
		const consumerRead = consumer.reads.find( ( read ) => read.signalId === signalId( key ) && readResolutionTemplateById.get( read.readId ) === versionRule );
		assert.ok( producerWrite && consumerRead, `fixture edge ${ id } cannot resolve its read/write rule` );
		const dependencyId = `dependency-${ id}`;
		consumerRead.dependencyId = dependencyId;
		return {
			edgeId: id, producerStageId, consumerStageId, payload: { kind: 'state-version-ref', signalId: signalId( key ) }, requiredVersionAndPhase: { signalId: signalId( key ), stateVersionRule: versionRule, disposition, samplePhase: consumer.samplePhase },
			interpolationExtrapolation: 'not-used', maximumStaleness: fixtureDurationSeconds( 0.05 ), latency: { productionDelay: fixtureDurationSeconds( 0 ), consumerAvailability: 'same-queue after exact completion', maximumStaleness: fixtureDurationSeconds( 0.05 ), hostVisibleDelay: typedAbsence( 'not-applicable', consumer.owner ), clockMappingRevision: consumer.executionInterval.intervalMappingRevision, error: fixtureError( 'second', 1e-6, 'fixture-edge-latency' ) },
			barrier: { dependencyId, requiredCompletionVersion: 'completion-v1' }, absencePolicy: 'block'
		};

	};
	const edges = [
		makeEdge( 'gravity-to-body', 'ingest-gravity', 'predict-body', 'gravity', 'forcing-42/gravity-prepared', 'transaction-prepared' ),
		makeEdge( 'body-to-emission', 'predict-body', 'emit-body-water', 'bodyState', 'loop-42/iteration-{i}/body', 'loop-provisional' ),
		makeEdge( 'body-to-water-solve', 'predict-body', 'solve-water', 'bodyState', 'loop-42/iteration-{i}/body', 'loop-provisional' ),
		makeEdge( 'water-to-reduction', 'solve-water', 'reduce-coupling', 'waterSurface', 'loop-42/iteration-{i}/water/subcycle-2', 'loop-provisional' ),
		makeEdge( 'water-to-correction', 'solve-water', 'correct-water', 'waterSurface', 'loop-42/iteration-2/water/subcycle-2', 'loop-provisional' ),
		makeEdge( 'body-to-correction', 'predict-body', 'correct-body', 'bodyState', 'loop-42/iteration-2/body', 'loop-provisional' ),
		makeEdge( 'water-to-commit', 'correct-water', 'commit-coupled', 'waterSurface', 'water-42/prepared', 'transaction-prepared' ),
		makeEdge( 'body-to-commit', 'correct-body', 'commit-coupled', 'bodyState', 'body-42/prepared', 'transaction-prepared' ),
		makeEdge( 'commit-to-presentation', 'commit-coupled', 'publish-presentation', 'commitToken', 'commit-42/prepared', 'transaction-prepared' )
	];
	const dependencies = edges.map( ( edge ) => ( { dependencyId: edge.barrier.dependencyId, kind: 'same-queue-transition', producerStageId: edge.producerStageId, consumerStageId: edge.consumerStageId, payloadSchemaAndVersionRule: edge.requiredVersionAndPhase, producerResidencyRule: 'exact stage execution residency', consumerResidencyRule: 'exact stage execution residency', resourceSubresourceRule: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), accessTransitionRule: 'producer shader-write to consumer shader-read', generationCompatibilityRule: 'same backend/device-loss/resource generation', releaseAcquireProtocol: typedAbsence( 'not-applicable', 'same-queue-dependency' ), externalFenceOrHostVisibilityRule: typedAbsence( 'not-applicable', 'same-queue-dependency' ), completionSemantics: 'named producer receipt precedes first consumer access' } ) );
	let executionSequence = 0;
	const stageExecutions = [];
	const instantiateRule = ( rule, iterationIndex, subcycleIndex ) => rule.replaceAll( '{i}', String( iterationIndex ?? 2 ) ).replaceAll( '{s}', String( subcycleIndex ?? 2 ) );
	const appendExecution = ( stageId, iterationIndex = null, subcycleIndex = null ) => {

		const stage = stagesById.get( stageId );
		const executionInterval = subcycleIndex === null ? clone( stage.executionInterval ) : fixtureInterval( route.physicsContext.physicsClockRegistry.clocksById, stage.clockId, stage.executionInterval.start.tick + subcycleIndex, stage.executionInterval.start.tick + subcycleIndex + 1 );
		const claimIdByStage = { 'ingest-gravity': 'gravity-advance-claim-42', 'predict-body': 'body-advance-claim-42', 'solve-water': 'water-advance-claim-42', 'correct-water': 'water-advance-claim-42', 'correct-body': 'body-advance-claim-42' };
		const executionId = `coordination-advance-42/${ stageId }/${ iterationIndex ?? 'advance' }/${ subcycleIndex ?? 0}`;
		stageExecutions.push( {
			executionId, coordinationAdvanceId: 'coordination-advance-42', stageId, executionSequence: executionSequence ++, executionInterval,
			coordinationCoverageInterval: clone( fixedInterval ), coordinationClockMappingProof: stage.clockId === fixedInterval.clockId ? 'identity mapping' : `${ stage.clockId }-to-${ fixedInterval.clockId } exact endpoint proof`,
			subcycleIndex: subcycleIndex === null ? typedAbsence( 'not-applicable', stage.owner ) : subcycleIndex,
			couplingLoopId: iterationIndex === null ? typedAbsence( 'not-applicable', stage.owner ) : 'body-water-loop', iterationIndex: iterationIndex === null ? typedAbsence( 'not-applicable', stage.owner ) : iterationIndex,
			readResolutions: stage.reads.map( ( read ) => ( { readId: read.readId, stateVersion: instantiateRule( readResolutionTemplateById.get( read.readId ), iterationIndex, subcycleIndex ), requestedTime: clone( read.requestedTime ) } ) ),
			writeResolutions: stage.writes.map( ( write ) => ( { writeId: write.writeId, preparedVersion: instantiateRule( writeResolutionTemplateById.get( write.writeId ), iterationIndex, subcycleIndex ), contentDigest: `sha256:${ stageId }-${ iterationIndex ?? 'advance' }-${ subcycleIndex ?? 0}-${ write.writeId}` } ) ),
			dependencyCompletions: [], stateAdvanceClaimIds: claimIdByStage[ stageId ] ? [ claimIdByStage[ stageId ] ] : [], interactionApplicationLedgerIds: [], status: 'completed', completionReceiptDigest: `sha256:execution-${ stageId }-${ iterationIndex ?? 'advance' }-${ subcycleIndex ?? 0}`
		} );
		return executionId;

	};
	appendExecution( 'ingest-gravity' );
	for ( let iterationIndex = 0; iterationIndex < 3; iterationIndex ++ ) {

		appendExecution( 'predict-body', iterationIndex );
		appendExecution( 'emit-body-water', iterationIndex );
		for ( let subcycleIndex = 0; subcycleIndex < 3; subcycleIndex ++ ) appendExecution( 'solve-water', iterationIndex, subcycleIndex );
		appendExecution( 'reduce-coupling', iterationIndex );

	}
	appendExecution( 'correct-water' );
	appendExecution( 'correct-body' );
	appendExecution( 'commit-coupled' );
	appendExecution( 'publish-presentation' );
	const executionsByStage = new Map( stages.map( ( stage ) => [ stage.stageId, stageExecutions.filter( ( execution ) => execution.stageId === stage.stageId ) ] ) );
	const dependencyCompletions = [];
	for ( const edge of edges ) {

		const producerRows = executionsByStage.get( edge.producerStageId );
		const consumerRows = executionsByStage.get( edge.consumerStageId );
		for ( const consumerExecution of consumerRows ) {

			const consumerIteration = isTypedAbsence( consumerExecution.iterationIndex ) ? null : consumerExecution.iterationIndex;
			let candidates = producerRows;
			if ( consumerIteration !== null && producerRows.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) candidates = producerRows.filter( ( row ) => row.iterationIndex === consumerIteration );
			else if ( consumerIteration === null && producerRows.some( ( row ) => ! isTypedAbsence( row.iterationIndex ) ) ) candidates = producerRows.filter( ( row ) => row.iterationIndex === 2 );
			const producerExecution = candidates.at( - 1 );
			const completionId = `${ edge.barrier.dependencyId }/${ producerExecution.executionId }/${ consumerExecution.executionId }`;
			const completion = { completionId, dependencyId: edge.barrier.dependencyId, coordinationAdvanceId: 'coordination-advance-42', producerExecutionId: producerExecution.executionId, consumerExecutionId: consumerExecution.executionId, payloadAndVersion: { signalId: edge.requiredVersionAndPhase.signalId, stateVersionRule: edge.requiredVersionAndPhase.stateVersionRule }, producerResidency: clone( stagesById.get( edge.producerStageId ).executionResidency ), consumerResidency: clone( stagesById.get( edge.consumerStageId ).executionResidency ), resourceIdentityAndSubresource: typedAbsence( 'not-applicable', 'same-queue-dependency' ), accessTransition: 'shader-write-to-shader-read', deviceBackendResourceGenerations: { deviceId: 'fixture-webgpu-device', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1' }, producerRelease: { submissionEpoch: `submit-${ producerExecution.executionSequence }`, completionToken: producerExecution.completionReceiptDigest }, consumerAcquire: { waitToken: producerExecution.completionReceiptDigest, firstUse: consumerExecution.executionId }, externalFenceOrHostVisibility: typedAbsence( 'not-applicable', 'same-queue-dependency' ), status: 'completed', receiptDigest: `sha256:${ completionId }` };
			dependencyCompletions.push( completion );
			consumerExecution.dependencyCompletions.push( { completionId, dependencyId: completion.dependencyId, receiptDigest: completion.receiptDigest } );

		}

	}
	const claim = ( claimId, owner, stateEquationId, kind, inputVersions, outputVersion, nativeStageIds, applicationInterval ) => ( { claimId, contextId: route.physicsContext.contextId, coordinationAdvanceId: 'coordination-advance-42', owner, stateEquationId, kind, inputCommittedVersions: inputVersions, outputPreparedVersion: outputVersion, applicationInterval: clone( applicationInterval ), nativeExecutionIds: stageExecutions.filter( ( row ) => nativeStageIds.includes( row.stageId ) ).map( ( row ) => row.executionId ), interactionApplicationLedgerIds: [], exactOnceAdvanceKey: `${ route.physicsContext.contextId }|coordination-advance-42|${ stateEquationId }|${ canonicalIntervalIdentity( applicationInterval ) }` } );
	const stateAdvanceClaims = [
		claim( 'gravity-advance-claim-42', 'environment-owner', 'gravity-field', 'event-application', [ { signalId: signalId( 'gravity' ), stateVersion: 'gravity-41' } ], { signalId: signalId( 'gravity' ), stateVersion: 'forcing-42/gravity-prepared' }, [ 'ingest-gravity' ], fixedInterval ),
		claim( 'body-advance-claim-42', '$threejs-procedural-motion-systems', 'body-state', 'state-advance', [ { signalId: signalId( 'bodyState' ), stateVersion: 'body-41' } ], { signalId: signalId( 'bodyState' ), stateVersion: 'body-42/prepared' }, [ 'predict-body', 'correct-body' ], fixedInterval ),
		claim( 'water-advance-claim-42', '$threejs-water-optics', 'water-state', 'state-advance', [ { signalId: signalId( 'waterSurface' ), stateVersion: 'water-41' } ], { signalId: signalId( 'waterSurface' ), stateVersion: 'water-42/prepared' }, [ 'solve-water', 'correct-water' ], fixedInterval )
	];
	const preparedPublication = ( preparedPublicationId, commitGroupId, owner, signalKey, provisionalStateVersion, preparedStateVersion ) => ( { preparedPublicationId, commitGroupId, stateEquationOwner: owner, signalOrStateEquationId: signalId( signalKey ), provisionalVersion: { signalId: signalId( signalKey ), stateVersion: provisionalStateVersion }, preparedVersion: { signalId: signalId( signalKey ), stateVersion: preparedStateVersion }, contentDigest: `sha256:${ preparedPublicationId }`, ownerApproval: `${ owner }@fixture-v1`, prepareDependencyRefs: [], visibility: 'transaction-private' } );
	const gravityPrepared = preparedPublication( 'prepared-gravity-42', 'forcing-commit', 'environment-owner', 'gravity', 'forcing-42/gravity-prepared', 'gravity-42/prepared' );
	const waterPrepared = preparedPublication( 'prepared-water-42', 'coupled-commit', '$threejs-water-optics', 'waterSurface', 'loop-42/iteration-2/water/subcycle-2', 'water-42/prepared' );
	const bodyPrepared = preparedPublication( 'prepared-body-42', 'coupled-commit', '$threejs-procedural-motion-systems', 'bodyState', 'loop-42/iteration-2/body', 'body-42/prepared' );
	const tokenPrepared = preparedPublication( 'prepared-token-42', 'coupled-commit', 'route-physics-coordinator', 'commitToken', 'commit-42/prepared', 'commit-42/prepared' );
	const publication = ( signalKey, stateVersion, stateEquation ) => ( { signalKey, signalId: signalId( signalKey ), stateVersion, stateEquation } );
	const lineage = ( prepared, committedStateVersion ) => ( { provisionalVersion: clone( prepared.provisionalVersion ), committedVersion: { signalId: prepared.preparedVersion.signalId, stateVersion: committedStateVersion }, contentDigest: prepared.contentDigest, semanticEquivalenceProof: 'immutable-handle-promotion', ownerApproval: prepared.ownerApproval, publicationInstant: clone( fixedInterval.endExclusive ) } );
	const commitGroups = [
		{ commitGroupId: 'forcing-commit', owner: 'environment-owner', interval: clone( fixedInterval ), provisionalVersions: [ clone( gravityPrepared.provisionalVersion ) ], preparedPublications: [ gravityPrepared ], committedPublications: [ publication( 'gravity', 'gravity-42', 'gravity-field' ) ], publicationLineage: [ lineage( gravityPrepared, 'gravity-42' ) ], stateEquationOwners: { 'gravity-field': 'environment-owner' }, conservationAndErrorGates: [ 'gravity-error' ], atomicity: 'all-or-none', failureDisposition: 'preserve-prior-commit', commitTransactionId: 'coordination-commit-transaction-42' },
		{ commitGroupId: 'coupled-commit', owner: 'route-physics-coordinator', interval: clone( fixedInterval ), provisionalVersions: [ clone( waterPrepared.provisionalVersion ), clone( bodyPrepared.provisionalVersion ), clone( tokenPrepared.provisionalVersion ) ], preparedPublications: [ waterPrepared, bodyPrepared, tokenPrepared ], committedPublications: [ publication( 'waterSurface', 'water-42', 'water-state' ), publication( 'bodyState', 'body-42', 'body-state' ), publication( 'commitToken', 'commit-42', 'commit-token' ) ], publicationLineage: [ lineage( waterPrepared, 'water-42' ), lineage( bodyPrepared, 'body-42' ), lineage( tokenPrepared, 'commit-42' ) ], stateEquationOwners: { 'water-state': '$threejs-water-optics', 'body-state': '$threejs-procedural-motion-systems', 'commit-token': 'route-physics-coordinator' }, conservationAndErrorGates: [ 'body-water-momentum', 'finite-state' ], atomicity: 'all-or-none', failureDisposition: 'rollback', commitTransactionId: 'coordination-commit-transaction-42' }
	];
	const committedPublications = commitGroups.flatMap( ( group ) => group.committedPublications.map( ( entry ) => ( { signalId: entry.signalId, stateVersion: entry.stateVersion } ) ) );
	const preparedToCommittedPublicationMap = [ gravityPrepared, waterPrepared, bodyPrepared, tokenPrepared ].map( ( prepared, index ) => ( { preparedPublicationId: prepared.preparedPublicationId, preparedVersion: clone( prepared.preparedVersion ), committedVersion: committedPublications[ index ] } ) );
	const commitReceipt = { receiptId: 'coordination-commit-receipt-42', commitTransactionId: 'coordination-commit-transaction-42', publicationInstant: clone( fixedInterval.endExclusive ), preparedToCommittedPublicationMap, committedPublications, priorToCommittedVersionMap: [ [ 'gravity-41', 'gravity-42' ], [ 'water-41', 'water-42' ], [ 'body-41', 'body-42' ], [ 'commit-41', 'commit-42' ] ].map( ( [ priorStateVersion, committedStateVersion ], index ) => ( { priorVersion: { signalId: committedPublications[ index ].signalId, stateVersion: priorStateVersion }, committedVersion: { signalId: committedPublications[ index ].signalId, stateVersion: committedStateVersion } } ) ), publicationSetDigest: sha256Canonical( committedPublications ), registryRevisionBeforeAfter: { before: 'physics-registry-41', after: 'physics-registry-42' }, dependencyCompletionRefs: clone( stageExecutions.find( ( row ) => row.stageId === 'commit-coupled' ).dependencyCompletions ), conservationAndErrorGateResults: [ { gate: 'body-water-momentum', status: 'accepted' }, { gate: 'finite-state', status: 'accepted' } ], status: 'committed', receiptDigest: 'sha256:coordination-commit-receipt-42' };
	commitReceipt.receiptDigest = sha256CanonicalExcluding( commitReceipt, [ 'receiptDigest' ] );
	const commitTransaction = { commitTransactionId: 'coordination-commit-transaction-42', coordinationAdvanceId: 'coordination-advance-42', contextId: route.physicsContext.contextId, interval: clone( fixedInterval ), commitGroupIds: commitGroups.map( ( group ) => group.commitGroupId ), preparedPublicationIds: [ gravityPrepared, waterPrepared, bodyPrepared, tokenPrepared ].map( ( prepared ) => prepared.preparedPublicationId ), conservationErrorAndResourceGates: [ { gate: 'closed-publication-set', status: 'accepted' }, { gate: 'memory-and-generation', status: 'accepted' } ], priorCommittedVersions: commitReceipt.priorToCommittedVersionMap.map( ( transition ) => transition.priorVersion ), publicationSetDigest: commitReceipt.publicationSetDigest, atomicPublicationProtocol: 'prepare-validate-single-registry-swap', status: 'committed', receipt: commitReceipt };
	const loopRows = [ 0, 1, 2 ].map( ( iterationIndex ) => {

		const rowExecutions = stageExecutions.filter( ( row ) => row.iterationIndex === iterationIndex );
		return { loopId: 'body-water-loop', iterationIndex, bracket: canonicalIntervalIdentity( fixedInterval ), inputVersions: iterationIndex === 0 ? [ { signalId: signalId( 'waterSurface' ), stateVersion: 'water-41' }, { signalId: signalId( 'bodyState' ), stateVersion: 'body-41' } ] : [ { signalId: signalId( 'waterSurface' ), stateVersion: `loop-42/iteration-${ iterationIndex - 1 }/water/subcycle-2` }, { signalId: signalId( 'bodyState' ), stateVersion: `loop-42/iteration-${ iterationIndex - 1 }/body` } ], outputVersions: [ { signalId: signalId( 'waterSurface' ), stateVersion: `loop-42/iteration-${ iterationIndex }/water/subcycle-2` }, { signalId: signalId( 'bodyState' ), stateVersion: `loop-42/iteration-${ iterationIndex }/body` } ], interactionSequenceRanges: [ { firstSequence: 1001, lastSequenceInclusive: 1004 } ], residualValues: [ evidence( 0.001 / ( iterationIndex + 1 ), 'newton-second', 'Measured', 'fixture-coupling' ) ], conservationResults: [ { conservationGroupId: 'body-water-momentum', status: 'within-gate' } ], accepted: iterationIndex === 2, stageExecutionIds: rowExecutions.map( ( row ) => row.executionId ), interactionApplicationLedgerIds: [], outputContentDigest: `sha256:loop-42-iteration-${ iterationIndex }`, dependencyCompletionRefs: rowExecutions.flatMap( ( row ) => row.dependencyCompletions ) };

	} );
	const acceptedWrites = clone( loopRows[ 2 ].outputVersions );
	const acceptedWriteLineage = [ [ acceptedWrites[ 0 ], waterPrepared ], [ acceptedWrites[ 1 ], bodyPrepared ] ].map( ( [ accepted, prepared ] ) => ( { loopId: 'body-water-loop', acceptedIterationIndex: 2, provisionalVersion: accepted, iterationOutputDigest: loopRows[ 2 ].outputContentDigest, preparedPublicationId: prepared.preparedPublicationId, preparedVersion: clone( prepared.preparedVersion ), semanticEquivalenceProof: 'immutable-handle-promotion' } ) );
	const loopMacros = [ { loopId: 'body-water-loop', coordinationAdvanceId: 'coordination-advance-42', couplingInterval: clone( fixedInterval ), orderedStageIds: [ 'predict-body', 'emit-body-water', 'solve-water', 'reduce-coupling' ], iterationBound: evidence( 3, 'iteration', 'Gated', 'added-mass-stability-gate' ), residuals: [ evidence( 1e-4, 'newton-second', 'Measured', 'accepted-iterate-linear-residual' ), evidence( 1e-4, 'newton-metre-second', 'Measured', 'accepted-iterate-angular-residual' ) ], convergenceBounds: [ evidence( 1e-3, 'newton-second', 'Gated', 'coupling-linear-gate' ), evidence( 1e-3, 'newton-metre-second', 'Gated', 'coupling-angular-gate' ) ], conservationGroupIds: [ 'body-water-momentum' ], provisionalVersionNamespace: 'loop-42', seedCommittedVersions: [ { signalId: signalId( 'waterSurface' ), stateVersion: 'water-41' }, { signalId: signalId( 'bodyState' ), stateVersion: 'body-41' } ], externalReads: [ { signalId: signalId( 'gravity' ), stateVersion: 'forcing-42/gravity-prepared' } ], iterationCarriedEdges: [ { edgeId: 'water-iterate-carry', producerStageId: 'solve-water', consumerStageId: 'predict-body', signalOrExchangeId: signalId( 'waterSurface' ), producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: canonicalIntervalIdentity( fixedInterval ), requiredProvisionalVersionPattern: 'loop-42/iteration-{i}/water/subcycle-2', barrier: { dependencyId: 'loop-water-carry', requiredCompletionVersion: 'completion-v1' } }, { edgeId: 'body-iterate-carry', producerStageId: 'reduce-coupling', consumerStageId: 'predict-body', signalOrExchangeId: signalId( 'bodyState' ), producedIterationOffset: 0, consumedIterationOffset: 1, requiredBracket: canonicalIntervalIdentity( fixedInterval ), requiredProvisionalVersionPattern: 'loop-42/iteration-{i}/body', barrier: { dependencyId: 'loop-body-carry', requiredCompletionVersion: 'completion-v1' } } ], iterationVersionRule: 'exact-iteration-index-and-bracket-rule', acceptedWrites, perIterationLedger: loopRows, acceptedIterationIndex: 2, acceptedWriteLineage, outerEdgePolicy: 'ingress-committed-and-accepted-egress-only', acceptedIteratePublication: 'atomic', divergenceFallback: 'rollback' } ];
	const coordinationAdvance = { coordinationAdvanceId: 'coordination-advance-42', graphId: 'coastal-coupling-graph', contextId: route.physicsContext.contextId, coordinationSequence: 42, catchUpBatchId: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), predecessorAdvanceId: 'coordination-advance-41', predecessorReceiptDigest: 'sha256:coordination-advance-41', interval: clone( fixedInterval ), debtBefore: fixtureDurationSeconds( 0.01 ), debtAfter: fixtureDurationSeconds( 0 ), stageExecutionIds: stageExecutions.map( ( row ) => row.executionId ), stateAdvanceClaimIds: stateAdvanceClaims.map( ( entry ) => entry.claimId ), commitTransactionIds: [ commitTransaction.commitTransactionId ], status: 'committed', receiptDigest: 'sha256:coordination-advance-42' };
	coordinationAdvance.receiptDigest = sha256CanonicalExcluding( coordinationAdvance, [ 'receiptDigest' ] );
	const executionLedger = { ledgerId: 'physics-execution-42', graphId: 'coastal-coupling-graph', graphRevision: 'coastal-coupling-graph-v42', coordinationInterval: clone( fixedInterval ), coordinationAdvanceId: coordinationAdvance.coordinationAdvanceId, stageExecutions, dependencyCompletions, stateAdvanceClaims, interactionApplicationLedgers: [], loopResults: [ { loopId: 'body-water-loop', iterations: evidence( 3, 'iteration', 'Measured', 'fixture-execution' ), residuals: 'within gate', acceptedIterate: 'loop-42/iteration-2' } ], commitReceipts: [ commitReceipt ], catchUpDebtBeforeAfter: { before: fixtureDurationSeconds( 0.01 ), after: fixtureDurationSeconds( 0 ) }, discontinuityEpoch: 'time-continuity-1', physicsCostLedgerId: 'mobile-cost-ledger-42' };
	route.physicsGraph = { graphId: 'coastal-coupling-graph', contextId: route.physicsContext.contextId, coordinationInterval: clone( fixedInterval ), coordinationAdvance, catchUpBatch: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), stages, edges, dependencies, loopMacros, commitGroups, commitTransactions: [ commitTransaction ], originRebaseTransactions: [], catchUpPolicy: { owner: 'route-physics-coordinator', debtClockId: fixedInterval.clockId, maximumDebt: fixtureDurationSeconds( 0.05 ), maximumCoordinationAdvancesPerPresentationOpportunity: evidence( 3, 'advance', 'Gated', 'fixture-catch-up' ), maximumNativeExecutionsPerOpportunity: evidence( 64, 'execution', 'Gated', 'fixture-catch-up' ), debtDisposition: 'retain', discontinuityOnDrop: 'required', externalDeadlinePolicy: 'bounded-defer', errorAndResourceGates: [ 'latency', 'memory', 'physical-error' ] }, discontinuityPolicy: { owner: 'route-physics-coordinator', action: 'one graph-wide discontinuity' }, executionLedger };
	route.physicsCoordinationAdvanceRecords = [ clone( coordinationAdvance ) ];
	route.physicsCommitTransactions = { [ commitTransaction.commitTransactionId ]: clone( commitTransaction ) };

}

function attachCanonicalExchange( route, interval ) {

	const footprint = { footprintId: 'hull-water-footprint-v4', kind: 'area', physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', chartId: typedAbsence( 'not-applicable', 'distributed-coupler' ), supportGeometry: 'generation-bearing hull-water patch', orientation: 'hull-to-water', measureUnit: 'square-meter', representedMeasure: evidence( 12, 'square-metre', 'Derived', 'fixture-quadrature' ), distributionKind: 'extensive-distributed', kernel: 'normalized compact area kernel v4', kernelUnit: 'inverse-square-meter', normalizationTarget: 'unity', normalizationIntegral: evidence( 1, 'ratio', 'Gated', 'fixture-quadrature' ), quadrature: 'fixed deterministic patch quadrature with physical weights/Jacobians', referencePointMeters: [ 0, 0, 0 ], approximationError: fixtureError( 'square-metre', 1e-4, 'fixture-quadrature' ) };
	const makeRecord = ( fields ) => {

		const key = `${ canonicalIntervalIdentity( interval ) }|stage=${ fields.stage }|producer=${ fields.producer }|sequence=${ fields.sequence }|interaction=${ fields.id }`;
		return { interactionId: fields.id, exactOnceKey: key, role: fields.role, sourceOwner: fields.sourceOwner, sourceEntityId: fields.sourceEntity, sourceStateVersions: fields.sourceVersions, targetOwner: fields.targetOwner, targetEntityId: fields.targetEntity, targetStateVersionExpected: fields.targetVersion, targetStateEquation: fields.targetEquation, applicationInterval: interval, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', footprint, payload: { tag: 'momentumTransfer', timeSemantics: 'interval-integrated', linearMomentumNs: fields.linear, angularMomentumNms: fields.angular, referencePointMeters: [ 0, 0, 0 ] }, signConvention: 'positive-source-to-receiver', applicationLedgerKey: `apply|${ key }`, partitionMembership: typedAbsence( 'not-applicable', 'distributed-coupler' ), reactionGroupId: 'body-water-reaction-group', reactionToInteractionIds: fields.reactionTo, conservationGroupIds: [ 'body-water-momentum' ], validity: 'exact interval/frame/epoch/revision', error: { momentum: fixtureError( 'newton-second', 1e-6, 'fixture-exchange' ) }, provenance: { adapterRevision: 'distributed-coupler-v4', stageId: fields.stage, producerId: fields.producer, producerSequence: fields.sequence } };

	};
	const sources = [
		makeRecord( { id: 'source-bow', role: 'source', sourceOwner: '$threejs-procedural-motion-systems', sourceEntity: 'hull#g4', sourceVersions: [ 'body-42', 'hull-material-1@materials-v5' ], targetOwner: '$threejs-water-optics', targetEntity: 'water#g2', targetVersion: 'water-41', targetEquation: 'water-state', stage: 'emit-body-water', producer: 'body-provider', sequence: 1001, linear: [ 4, 0, 0 ], angular: [ 0, 0, 1 ], reactionTo: [] } ),
		makeRecord( { id: 'source-stern', role: 'source', sourceOwner: '$threejs-procedural-motion-systems', sourceEntity: 'hull#g4', sourceVersions: [ 'body-42', 'hull-material-1@materials-v5' ], targetOwner: '$threejs-water-optics', targetEntity: 'water#g2', targetVersion: 'water-41', targetEquation: 'water-state', stage: 'emit-body-water', producer: 'body-provider', sequence: 1002, linear: [ 0, 2, 0 ], angular: [ 0, 0, - 0.5 ], reactionTo: [] } )
	];
	const sourceIds = sources.map( ( record ) => record.interactionId );
	const reactions = [
		makeRecord( { id: 'reaction-a', role: 'reaction', sourceOwner: '$threejs-water-optics', sourceEntity: 'water#g2', sourceVersions: [ 'water-42', 'water-material-1@materials-v5' ], targetOwner: '$threejs-procedural-motion-systems', targetEntity: 'hull#g4', targetVersion: 'body-41', targetEquation: 'body-state', stage: 'reduce-coupling', producer: 'water-provider', sequence: 1003, linear: [ - 1, - 1, 0 ], angular: [ 0, 0, - 0.2 ], reactionTo: sourceIds } ),
		makeRecord( { id: 'reaction-b', role: 'reaction', sourceOwner: '$threejs-water-optics', sourceEntity: 'water#g2', sourceVersions: [ 'water-42', 'water-material-1@materials-v5' ], targetOwner: '$threejs-procedural-motion-systems', targetEntity: 'hull#g4', targetVersion: 'body-41', targetEquation: 'body-state', stage: 'reduce-coupling', producer: 'water-provider', sequence: 1004, linear: [ - 3, - 1, 0 ], angular: [ 0, 0, - 0.3 ], reactionTo: sourceIds } )
	];
	route.physicsInteractions = [ { exchangeId: 'body-water-exchange', contextId: route.physicsContext.contextId, applicationInterval: interval, physicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', mode: 'two-way-iterated', participants: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], sourceDescriptors: [ { signalId: 'water-surface-state', descriptorStateVersion: 'water-42', schemaId: 'physics/water-surface/v1', contextId: route.physicsContext.contextId }, { signalId: 'rigid-body-state', descriptorStateVersion: 'body-42', schemaId: 'physics/rigid-body/v1', contextId: route.physicsContext.contextId } ], interactions: sources, reactions, physicalImpactParents: [], physicalImpactPartitions: [], reactionGroups: [ { reactionGroupId: 'body-water-reaction-group', contextId: route.physicsContext.contextId, exchangeId: 'body-water-exchange', applicationInterval: interval, sourceInteractionIds: sourceIds, reactionInteractionIds: reactions.map( ( record ) => record.interactionId ), acceptance: 'all-or-none', orderedReduction: 'fixed binary tree', balanceFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', balanceTransformRevision: 'physics-frame-transform-3', balanceReferencePoint: evidence( [ 0, 0, 0 ], 'metre', 'Authored', 'balance-origin' ), conservationGroupIds: [ 'body-water-momentum' ], residualsAndBounds: { linearMomentumBound: evidence( 1e-9, 'newton-second', 'Gated', 'fixture-conservation' ), angularMomentumBound: evidence( 1e-9, 'newton-metre-second', 'Gated', 'fixture-conservation' ) } } ], conservationGroups: [ { conservationGroupId: 'body-water-momentum', contextId: route.physicsContext.contextId, interval, participants: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], referencePhysicsFrameId: 'physics-world-y-up', physicsOriginEpoch: 'physics-origin-17', transformRevision: 'physics-frame-transform-3', angularMomentumReference: { kind: 'fixed-inertial-point', pointAtStartMeters: [ 0, 0, 0 ], trajectoryAndVelocity: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), transportTerms: typedAbsence( 'not-applicable', 'route-physics-coordinator' ) }, commodities: [ 'linear-momentum', 'angular-momentum' ], explicitConstraints: [], initialInventory: 'typed-map', finalInventory: 'typed-map', externalSources: 'typed-map', boundaryFluxes: 'typed-map', modeledInternalTransfers: 'equal-and-opposite participant transfer map', modeledConversions: {}, modeledDissipation: {}, numericalResidual: 'typed-map', residualNorms: 'typed-map', acceptanceBounds: 'typed-map' } ], couplingLoopId: 'body-water-loop', stabilityGate: 'added-mass gate accepted', convergence: 'bounded loop converged', batchLedger: { batchId: 'body-water-batch', exchangeId: 'body-water-exchange', producerId: 'route-physics-coordinator', publishedSequenceRange: { firstSequence: 1001, lastSequence: 1004 }, perConsumerCursor: { water: 1005, body: 1005 }, acceptedRejectedLateDuplicate: { accepted: evidence( 4, 'record', 'Measured', 'fixture-replay' ), rejected: evidence( 0, 'record', 'Measured', 'fixture-replay' ), late: evidence( 0, 'record', 'Measured', 'fixture-replay' ), duplicate: evidence( 0, 'record', 'Measured', 'fixture-replay' ) }, overflowPolicy: 'block', overflowSequenceRanges: [], lostCommodities: {}, deferredCommodities: {}, exactOnceApplicationLedgerVersion: 'delivery-ledger-v42', applicationLedgerIds: [] } } ];
	const conservation = route.physicsInteractions[ 0 ].conservationGroups[ 0 ];
	conservation.commodities = [ 'linear-momentum', 'angular-momentum', 'energy' ];
	conservation.initialInventory = { linearMomentumNs: [ 10, 0, 0 ], angularMomentumNms: [ 0, 5, 0 ], energyJ: evidence( 100, 'joule', 'Measured', 'fixture-initial-inventory' ) };
	conservation.finalInventory = { linearMomentumNs: [ 11, 0, 0 ], angularMomentumNms: [ 0, 5.5, 0 ], energyJ: evidence( 107, 'joule', 'Measured', 'fixture-final-inventory' ) };
	conservation.externalSources = { linearMomentumNs: [ 2, 0, 0 ], angularMomentumNms: [ 0, 1, 0 ], energyJ: evidence( 10, 'joule', 'Derived', 'fixture-external-source' ) };
	conservation.boundaryFluxes = { linearMomentumNs: [ 1, 0, 0 ], angularMomentumNms: [ 0, 0.5, 0 ], energyJ: evidence( 5, 'joule', 'Derived', 'fixture-boundary-outflow' ) };
	conservation.modeledInternalTransfers = { byInteractionId: Object.fromEntries( [ ...sources, ...reactions ].map( ( record ) => [ record.interactionId, { linearMomentumNs: clone( record.payload.linearMomentumNs ), angularMomentumNms: clone( record.payload.angularMomentumNms ), energyJ: evidence( 0, 'joule', 'Derived', 'momentum-only-transfer' ) } ] ) ) };
	conservation.modeledConversions = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 4, 'joule', 'Derived', 'fixture-modeled-conversion' ) };
	conservation.modeledDissipation = { energyJ: evidence( 2, 'joule', 'Derived', 'fixture-modeled-dissipation' ) };
	conservation.numericalResidual = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Derived', 'fixture-conservation-residual' ) };
	conservation.residualNorms = { linearMomentumNs: evidence( 0, 'newton-second', 'Measured', 'fixture-conservation' ), angularMomentumNms: evidence( 0, 'newton-metre-second', 'Measured', 'fixture-conservation' ), energyJ: evidence( 0, 'joule', 'Measured', 'fixture-conservation' ) };
	conservation.acceptanceBounds = { linearMomentumNs: evidence( 1e-9, 'newton-second', 'Gated', 'fixture-conservation' ), angularMomentumNms: evidence( 1e-9, 'newton-metre-second', 'Gated', 'fixture-conservation' ), energyJ: evidence( 1e-9, 'joule', 'Gated', 'fixture-conservation' ) };
	const exchange = route.physicsInteractions[ 0 ];
	const executionLedger = route.physicsGraph.executionLedger;
	const acceptedIteration = route.physicsGraph.loopMacros[ 0 ].perIterationLedger.find( ( row ) => row.accepted );
	const applicationLedgers = [ ...sources, ...reactions ].map( ( record ) => {

		const applicationStageId = record.targetOwner === '$threejs-water-optics' ? 'correct-water' : 'correct-body';
		const stageExecution = executionLedger.stageExecutions.find( ( execution ) => execution.stageId === applicationStageId );
		assert.ok( stageExecution, `fixture cannot bind ${ record.interactionId } to the accepted iteration` );
		const targetPreparedVersion = record.targetOwner === '$threejs-water-optics' ? 'water-42/prepared' : 'body-42/prepared';
		const applicationLedgerId = `application-${ record.interactionId }-42`;
		const ledger = {
			applicationLedgerId, contextId: route.physicsContext.contextId, exchangeId: exchange.exchangeId, interactionId: record.interactionId,
			exactOnceKey: record.exactOnceKey, targetOwner: record.targetOwner, targetEntityId: record.targetEntityId, targetStateEquation: record.targetStateEquation,
			targetStateVersionExpected: record.targetStateVersionExpected, coordinationAdvanceId: 'coordination-advance-42', stageExecutionId: stageExecution.executionId,
			nativeSubcycleIndex: typedAbsence( 'not-applicable', record.targetOwner ), payloadTimeSemantics: record.payload.timeSemantics,
			declaredApplicationInterval: clone( record.applicationInterval ), executionOverlapInterval: clone( record.applicationInterval ),
			overlapMeasureSeconds: evidence( 1 / 60, 'second', 'Derived', 'exact-clock-endpoint-difference' ),
			appliedPayloadAmount: { linearMomentumNs: clone( record.payload.linearMomentumNs ), angularMomentumNms: clone( record.payload.angularMomentumNms ), referencePointMeters: clone( record.payload.referencePointMeters ) },
			applicationFraction: evidence( 1, 'ratio', 'Derived', 'full-overlap-interval-integrated-payload' ), cursorBefore: record.provenance.producerSequence, cursorAfter: record.provenance.producerSequence + 1,
			targetPreparedVersion, commitTransactionId: 'coordination-commit-transaction-42', disposition: 'committed', replayEpoch: 'initial-application-42',
			replaySourceLedgerId: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), applicationContentDigest: 'pending', receiptDigest: 'pending'
		};
		ledger.applicationContentDigest = sha256Canonical( interactionApplicationContentDigestPayload( ledger ) );
		ledger.receiptDigest = sha256Canonical( interactionApplicationReceiptDigestPayload( ledger ) );
		return ledger;

	} );
	const applicationIds = applicationLedgers.map( ( ledger ) => ledger.applicationLedgerId );
	exchange.batchLedger.applicationLedgerIds = applicationIds;
	route.physicsInteractionApplicationLedgers = Object.fromEntries( applicationLedgers.map( ( ledger ) => [ ledger.applicationLedgerId, clone( ledger ) ] ) );
	executionLedger.interactionApplicationLedgers = clone( applicationLedgers );
	for ( const ledger of applicationLedgers ) {

		const execution = executionLedger.stageExecutions.find( ( row ) => row.executionId === ledger.stageExecutionId );
		execution.interactionApplicationLedgerIds.push( ledger.applicationLedgerId );
		const claim = executionLedger.stateAdvanceClaims.find( ( row ) => row.owner === ledger.targetOwner );
		assert.ok( claim, `fixture cannot bind ${ ledger.applicationLedgerId } to a target state-advance claim` );
		claim.interactionApplicationLedgerIds.push( ledger.applicationLedgerId );

	}
	acceptedIteration.interactionApplicationLedgerIds = clone( applicationIds );

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
		const join = { joinId: `join-${ id }`, leaseId: id, requiredConsumerKeys, simulationConsumers, couplingConsumers, externalConsumers: [], presentationConsumers, joinPredicate: 'all-required-consumers-complete-or-loss-invalidated', deviceLossRetirementPath: 'invalidate only matching device/loss/resource generation' };
		join.joinDigest = completionJoinDigest( join );
		return join;

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
	route.physicsPresentationTimeCohortsById = {
		'presentation-cohort-42': {
			timeCohortId: 'presentation-cohort-42', presentationClockId: 'physics-fixed', presentationOpportunitySequence: 42,
			previousRequestedPresentationInstant: fixed41Half, currentRequestedPresentationInstant: fixed42Half, requestedPresentationInstant: fixed42Half,
			requiredContextIds: [ route.physicsContext.contextId ], requiredDiscontinuityEpochs: { [ route.physicsContext.contextId ]: 'time-continuity-1' },
			maximumInterContextSkew: fixtureDurationSeconds( 0.001, 'presentation-cohort-gate' ), maximumCandidateAge: fixtureDurationSeconds( 0.05, 'presentation-cohort-gate' ),
			admissionPolicy: 'bounded-mapped-skew', cohortSpecificationDigest: 'sha256:presentation-cohort-42'
		}
	};
	route.physicsPresentationCandidate = { candidateId: 'physics-candidate-42', contextId: route.physicsContext.contextId, presentationEpoch: 'presentation-42', timeCohortId: 'presentation-cohort-42', requestedPresentationInstant: fixed42Half, physicsOriginEpoch: 'physics-origin-17', commitProvenance: { provenanceId: 'candidate-commit-provenance-42', contextId: route.physicsContext.contextId, coordinationAdvanceIds: [ 'coordination-advance-42' ], commitTransactionIds: [ 'coordination-commit-transaction-42' ], commitReceiptIdsAndDigests: [ { receiptId: 'coordination-commit-receipt-42', receiptDigest: route.physicsGraph.commitTransactions[ 0 ].receipt.receiptDigest } ], committedStateVersions: [ { signalId: 'gravity-acceleration', stateVersion: 'gravity-42' }, { signalId: 'water-surface-state', stateVersion: 'water-42' }, { signalId: 'rigid-body-state', stateVersion: 'body-42' }, { signalId: 'coupled-commit-token', stateVersion: 'commit-42' } ], physicsOriginTransactionId: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), qualityTransitionId: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), closedPublicationSetDigest: route.physicsGraph.commitTransactions[ 0 ].publicationSetDigest }, candidateScope: 'committed-state-brackets-leases-and-events', presentedStatePairs: pairs, resourceLeases: candidateLeases, eventSequenceRanges: [ { rangeId: 'body-water-events-1001-1004', producerId: 'route-physics-coordinator', consumerId: 'shared-presentation-views', streamId: 'body-water-exchange', firstSequence: 1001, lastSequenceInclusive: 1004, sourceStateVersion: 'commit-42', interval: fixtureInterval( clocks, 'physics-fixed', 42, 43 ), cursorBefore: 1001, cursorAfter: 1005, payloadDigest: authoritativePresentationEventPayloadDigest( route.physicsInteractions[ 0 ] ) } ] };
	const matrix3 = [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
	const matrix4 = evidence( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ], 'matrix4', 'Derived', 'camera' );
	const renderMap = ( id, epoch, instant, translation ) => ( { sourcePhysicsFrameId: 'physics-world-y-up', sourceTransformRevision: 'physics-frame-transform-3', sourcePhysicsOriginEpoch: 'physics-origin-17', destinationRenderFrameId: `render-${ id }`, renderOriginEpoch: epoch, referenceInstant: instant, properBasisRotation: matrix3, presentationScale: evidence( 1, 'ratio', 'Authored', 'presentation-scale' ), renderUnitsPerMeter: evidence( 2, 'render-unit-per-metre', 'Derived', 'presentationScale/metersPerWorldUnit' ), translationRenderUnits: translation, transformRevision: `render-transform-${ id }`, error: fixtureError( 'render-unit', 1e-6, 'render-map' ) } );
	const camera = ( target, view, id, translation ) => ( { cameraPublicationId: `camera-${ id}`, candidateId: 'physics-candidate-42', owner: '$threejs-camera-controls-and-rigs', presentationTargetId: target, viewId: view, cameraId: `${ id}-camera`, viewScope: `${ target } layers`, cameraStateVersion: `${ id}-state-42`, cameraProjectionRevision: `${ id}-projection-42`, previousRenderSampleInstant: fixed41Half, currentRenderSampleInstant: fixed42Half, globalToRenderPrevious: renderMap( `${ id}-previous`, `${ id}-origin-7`, fixed41Half, translation ), globalToRenderCurrent: renderMap( `${ id}-current`, `${ id}-origin-8`, fixed42Half, translation ), previousUnjitteredViewMatrix: matrix4, currentUnjitteredViewMatrix: matrix4, previousUnjitteredProjectionMatrix: matrix4, currentUnjitteredProjectionMatrix: matrix4, previousJitterSampleAndConvention: { sample: evidence( [ - 0.25, 0.25 ], 'physical-pixel', 'Authored', 'jitter-sequence-42' ), convention: 'motion uses unjittered matrices' }, currentJitterSampleAndConvention: { sample: evidence( [ 0.25, - 0.25 ], 'physical-pixel', 'Authored', 'jitter-sequence-42' ), convention: 'motion uses unjittered matrices' }, jitterSequenceRevision: 'jitter-sequence-42', viewport: { physical: evidence( [ 0, 0, 1280, 720 ], 'physical-pixel', 'Derived', 'viewport' ) }, rendererDpr: evidence( 1, 'ratio', 'Authored', 'target' ), renderExtent: evidence( [ 1280, 720 ], 'physical-pixel', 'Derived', 'viewport' ), depthConvention: 'reversed-depth', projectionValidityAndError: { validity: 'valid', error: fixtureError( 'ndc', 1e-7, 'camera' ) } } );
	route.physicsCameraViewPublicationsByTarget = { 'main/main-view': camera( 'main', 'main-view', 'main', [ - 2000, 0, 1000 ] ), 'minimap/map-view': camera( 'minimap', 'map-view', 'map', [ - 1800, 0, 900 ] ) };
	const leaseRef = ( id ) => { const lease = leasesById.get( id ); return { leaseId: id, deviceId: lease.deviceId, deviceLossGeneration: lease.deviceLossGeneration, resourceGeneration: lease.resourceGeneration, layoutRevision: lease.layoutRevision, subresourceOrCpuSlice: `${ id }:all` }; };
	const prepare = ( key, viewLease ) => {

		const c = route.physicsCameraViewPublicationsByTarget[ key ];
		const affectedRegion = key === 'main/main-view' ? {
			kind: 'screen-mask', fullFrame: typedAbsence( 'not-applicable', 'view-preparation' ), entitySet: typedAbsence( 'not-applicable', 'view-preparation' ), physicsBounds: typedAbsence( 'not-applicable', 'view-preparation' ),
			screenMask: { presentationTargetId: c.presentationTargetId, viewId: c.viewId, cameraId: c.cameraId, cameraProjectionRevision: c.cameraProjectionRevision, jitterKey: 'fixture-jitter-key', physicalExtent: evidence( [ 1280, 720 ], 'physical-pixel', 'Derived', 'fixture-viewport' ), resolutionScale: evidence( 0.5, 'ratio', 'Authored', 'fixture-reactive-mask' ), encodingFormat: 'conservative-r8unorm-mask', conservativeCoverage: 'outside', dilationAndError: { dilation: evidence( 2, 'physical-pixel', 'Gated', 'temporal-neighborhood' ), error: fixtureError( 'physical-pixel', 0.5, 'mask-conservatism' ) }, resourceLeaseId: viewLease }
		} : { kind: 'full-frame', fullFrame: { reason: 'map-view consumer lacks conservative mask support' }, entitySet: typedAbsence( 'not-applicable', 'view-preparation' ), physicsBounds: typedAbsence( 'not-applicable', 'view-preparation' ), screenMask: typedAbsence( 'not-applicable', 'view-preparation' ) };
		const actionId = `reset-water-history-${ key}`;
		const preparationEdgeId = `prepare-edge-${ key}`;
		const dependencyId = `prepare-dependency-${ key}`;
		const shadowFactorId = `shadow-factor-${ key}`;
		const inputHistoryGeneration = typedAbsence( 'unavailable', '$threejs-image-pipeline', 'timeless', 'history reset does not preserve an input generation' );
		const outputHistoryGeneration = `${ viewLeases[ key ].resourceGeneration }/reset-42`;
		const resetAction = { actionId, owner: '$threejs-image-pipeline', historyKey: `${ key}/water-history/r185`, presentationTargetId: c.presentationTargetId, viewId: c.viewId, causeEpochs: [ `water-${ key}-42` ], affectedRegion: clone( affectedRegion ), policy: 'reset', capabilityGate: 'mask-capable-or-full-frame-promoted', dependencies: [], executionStrategy: 'history-clear-before-temporal-consumer', resourceLeaseId: viewLease, inputHistoryLeaseRef: typedAbsence( 'unavailable', '$threejs-image-pipeline' ), expectedInputHistoryGeneration: inputHistoryGeneration, expectedOutputHistoryGeneration: outputHistoryGeneration, expectedPolicyResult: 'cleared-before-first-temporal-read' };
		const resetActionResult = {
			resultId: `reset-result-${ key}`, actionId, presentationTargetId: c.presentationTargetId, viewId: c.viewId,
			historyKey: resetAction.historyKey, causeEpochs: [ ...resetAction.causeEpochs ], appliedRegion: clone( affectedRegion ), policyApplied: 'reset',
			inputHistoryLeaseRef: typedAbsence( 'unavailable', '$threejs-image-pipeline' ), outputHistoryLeaseRef: leaseRef( viewLease ),
			inputHistoryGeneration, outputHistoryGeneration,
			dependencyCompletionRefs: [ { completionId: `reset-completion-${ key}`, dependencyId, receiptDigest: `sha256:reset-completion-${ key}` } ],
			queueSubmissionEpoch: 'submit-42', status: 'completed', residualAndError: { residual: evidence( 0, 'ratio', 'Measured', 'fixture-history-clear' ), error: fixtureError( 'ratio', 0, 'fixture-history-clear' ) },
			failure: typedAbsence( 'not-applicable', '$threejs-image-pipeline' ), resultDigest: `sha256:reset-result-${ key}`
		};
		const preparationEdge = {
			edgeId: preparationEdgeId, producerPublicationId: `reactive-water-${ key}`, consumerPublicationId: `preparation-${ key}`,
			requiredContentIdAndVersion: { sourceId: 'water-surface-state', sourceVersion: 'water-42' }, resourceLeaseRef: leaseRef( viewLease ),
			dependencyRef: { dependencyId, requiredCompletionVersion: 'prepare-completion-v1' }, accessTransition: 'shader-write-to-shader-read',
			completionRequiredBefore: actionId, status: 'satisfied'
		};
		const renderResourceLease = {
			renderResourceLeaseId: `render-history-${ key}`, baseLeaseRef: leaseRef( viewLease ), presentationTargetId: c.presentationTargetId, viewId: c.viewId,
			semantic: 'history', encodingFormat: 'linear-rgba16float-history', physicalExtent: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport' ),
			resolutionScale: evidence( 1, 'ratio', 'Authored', 'fixture-history' ), sampleCount: evidence( 1, 'sample', 'Authored', 'fixture-history' ), subresourceRange: `${ viewLease }:all`,
			producerPreparationEdgeId: preparationEdgeId, firstConsumerPhase: `reset-${ key}`, lastConsumerPhase: `present-${ key}`,
			requiredConsumerKeys: [ `presentation/${ key}/${ viewLease }` ], aliasGroupAndCompatibility: typedAbsence( 'not-applicable', '$threejs-image-pipeline' ),
			reuseProhibitedUntil: clone( viewLeases[ key ].reuseProhibitedUntil )
		};
		return {
			viewPreparationId: `preparation-${ key}`, candidateId: 'physics-candidate-42', cameraPublicationId: c.cameraPublicationId, presentationTargetId: c.presentationTargetId, viewId: c.viewId,
			visibilityPublicationRefs: [ { publicationId: `visibility-${ key}`, publicationVersion: 'visibility-v42' } ], accelerationPublicationRefs: [ { publicationId: `acceleration-${ key}`, publicationVersion: 'acceleration-v42' } ],
			shadowViewPublicationRefs: [ { shadowOwner: '$threejs-scalable-real-time-shadows', shadowViewId: `shadow-${ key}`, presentationTargetId: c.presentationTargetId, receiverViewId: c.viewId, cameraPublicationId: c.cameraPublicationId, cameraProjectionRevision: c.cameraProjectionRevision, shadowContentEpoch: `shadow-${ key}-42`, shadowFactorProvenance: { shadowFactorId, shadowViewId: `shadow-${ key}`, lightIdAndStateVersion: 'sun@42', receiverViewId: c.viewId, receiverStateVersions: [ 'water-42', 'body-42' ], occluderPublicationRefs: [ `visibility-${ key}` ], candidateId: 'physics-candidate-42', cameraPublicationId: c.cameraPublicationId, encodingAndFilterRevision: 'shadow-factor-r16f-pcf-v2', factorSemantics: 'direct-light-visibility', applicationOwner: 'lighting-owner', applicationMultiplicity: 'exactly-once', contentDigest: `sha256:shadow-factor-${ key}` }, resourceLeaseRefs: [ leaseRef( viewLease ) ], boundedDelay: typedAbsence( 'not-applicable', '$threejs-scalable-real-time-shadows' ) } ],
			cachePublicationRefs: [ { publicationId: `cache-${ key}`, publicationVersion: 'cache-v42' } ], reactiveEpochs: [ `water-${ key}-42` ],
			reactivePublications: [ { sourceId: 'water-surface-state', sourceVersion: 'water-42', reactiveEpoch: `water-${ key}-42`, kind: 'optical', presentationTargetId: c.presentationTargetId, viewId: c.viewId, affectedRegion: clone( affectedRegion ), resourceLeaseId: viewLease, validity: 'valid for sealed preparation', error: fixtureError( 'ratio', 0.01, 'reactive-publication' ), plannedConsumerActions: [ actionId ] } ],
			resetDependencies: [ resetAction ], resetActionResults: [ resetActionResult ], requiredPreparationEdges: [ preparationEdge ],
			resourceLeases: [ viewLeases[ key ] ], resourceLeaseRefs: [ leaseRef( 'water-current' ), leaseRef( 'body-current' ), leaseRef( viewLease ) ],
			renderResourceLeases: [ renderResourceLease ]
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
		const closureManifest = { snapshotId, pairStateHandleLeaseIds, preparationDependencyLeaseIds: [ viewLease ], reactiveAndResetLeaseIds: [ viewLease ], shadowCacheVisibilityLeaseIds: [ viewLease ], exactRequiredLeaseIds, exactEventRangeIds, dependencyDagDigest: dependencyDagDigest( p ) };
		closureManifest.closureDigest = closureManifestDigest( closureManifest );
		return { snapshotId, candidateId: 'physics-candidate-42', cameraPublicationId: c.cameraPublicationId, viewPreparationId: p.viewPreparationId, presentationTargetId: c.presentationTargetId, viewId: c.viewId, presentedStatePairRefs: [ 'water-binding', 'body-binding' ], resourceLeaseRefs: exactRequiredLeaseIds.map( leaseRef ), eventSequenceRanges: clone( route.physicsPresentationCandidate.eventSequenceRanges ), closureManifest, sealVersion: `seal-${ key }-42` };

	};
	route.physicsPresentationSnapshotsByTarget = { 'main/main-view': seal( 'main/main-view', 'main-view' ), 'minimap/map-view': seal( 'minimap/map-view', 'map-view' ) };
	const mainId = route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId;
	const mapId = route.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ].snapshotId;
	const renderPlan = ( key, snapshotId, viewLeaseId ) => {

		const [ presentationTargetId, viewId ] = key.split( '/' );
		const preparation = route.physicsViewPreparationPublicationsByTarget[ key ];
		const renderPlanId = `render-plan-${ key}-42`;
		const resetPhaseId = `reset-${ key}`;
		const scenePhaseId = `scene-${ key}`;
		const presentPhaseId = `present-${ key}`;
		const resetAction = preparation.resetDependencies[ 0 ];
		const historyInput = clone( resetAction.expectedInputHistoryGeneration );
		const historyOutput = resetAction.expectedOutputHistoryGeneration;
		const sceneColor = `scene-color-${ key}-g42`;
		const presentColor = `present-color-${ key}-g42`;
		const phase = ( phaseId, owner, passOrDispatchKey, inputs, outputs, historyReads = [], historyWrites = [] ) => ( {
			phaseId, renderPlanId, presentationTargetId, viewId, owner, queueId: 'default-queue', backendGeneration: 'backend-generation-1', passOrDispatchKey,
			inputResourceGenerationIds: inputs, outputResourceGenerationIds: outputs,
			outputOwnerByGeneration: Object.fromEntries( outputs.map( ( generation ) => [ generation, owner ] ) ),
			outputEncodingByGeneration: Object.fromEntries( outputs.map( ( generation ) => [ generation, generation === presentColor ? 'display-srgb8' : 'scene-linear-rgba16float' ] ) ),
			outputPhysicalExtentByGeneration: Object.fromEntries( outputs.map( ( generation ) => [ generation, evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-render-plan' ) ] ) ),
			historyReadGenerationIds: historyReads, historyWriteGenerationIds: historyWrites
		} );
		const phaseRecords = [
			phase( resetPhaseId, '$threejs-image-pipeline', `reset-history-${ key}`, [], [ historyOutput ], [], [ historyOutput ] ),
			phase( scenePhaseId, 'scene-render-owner', `scene-${ key}`, [ historyOutput ], [ sceneColor ], [ historyOutput ], [] ),
			phase( presentPhaseId, '$threejs-image-pipeline', `present-${ key}`, [ sceneColor ], [ presentColor ] )
		];
		const edge = ( suffix, producerPhaseId, consumerPhaseId, resourceGenerationId ) => ( {
			edgeId: `render-edge-${ key}-${ suffix}`, renderPlanId, producerPhaseId, consumerPhaseId,
			dependencyRef: { dependencyId: `render-dependency-${ key}-${ suffix}`, requiredCompletionVersion: 'completion-v1' }, resourceGenerationId,
			subresourceRange: `${ resourceGenerationId }:all`, producerAccess: 'shader-write', consumerAccess: 'shader-read',
			completionRef: { completionId: `render-completion-${ key}-${ suffix}`, dependencyId: `render-dependency-${ key}-${ suffix}`, receiptDigest: `sha256:render-completion-${ key}-${ suffix}` },
			externalFence: typedAbsence( 'not-applicable', '$threejs-image-pipeline' )
		} );
		const plan = {
			renderPlanId, timeCohortId: 'presentation-cohort-42', candidateId: 'physics-candidate-42', snapshotId, presentationTargetId, viewId,
			phaseIds: phaseRecords.map( ( record ) => record.phaseId ), phaseRecords,
			edges: [ edge( 'history', resetPhaseId, scenePhaseId, historyOutput ), edge( 'scene', scenePhaseId, presentPhaseId, sceneColor ) ],
			requiredPreparationEdgeIds: preparation.requiredPreparationEdges.map( ( preparationEdge ) => preparationEdge.edgeId ),
			renderResourceLeaseIds: preparation.renderResourceLeases.map( ( lease ) => lease.renderResourceLeaseId ), plannedResetActionIds: [ resetAction.actionId ],
			expectedResetHistoryGenerations: { [ resetAction.actionId ]: { inputHistoryGeneration: historyInput, outputHistoryGeneration: historyOutput } },
			shadowFactorIds: preparation.shadowViewPublicationRefs.map( ( ref ) => ref.shadowFactorProvenance.shadowFactorId ),
			closureDigest: route.physicsPresentationSnapshotsByTarget[ key ].closureManifest.closureDigest
		};
		plan.immutablePlanDigest = renderPlanDigest( plan );
		return plan;

	};
	route.physicsPresentationRenderPlansByTarget = { 'main/main-view': renderPlan( 'main/main-view', mainId, 'main-view' ), 'minimap/map-view': renderPlan( 'minimap/map-view', mapId, 'map-view' ) };
	const requiredTargetViewKeys = [ 'main/main-view', 'minimap/map-view' ];
	const renderPlans = requiredTargetViewKeys.map( ( key ) => route.physicsPresentationRenderPlansByTarget[ key ] );
	const cohortAdmission = {
		cohortAdmissionId: 'cohort-admission-42', timeCohortId: 'presentation-cohort-42', targetFrameSequence: 42, requiredTargetViewKeys,
		candidateIds: [ 'physics-candidate-42' ], snapshotIds: [ mainId, mapId ], renderPlanIds: renderPlans.map( ( plan ) => plan.renderPlanId ),
		mappedPresentationInstants: { [ route.physicsContext.contextId ]: clone( fixed42Half ) }, observedMaximumSkew: fixtureDurationSeconds( 0, 'cohort-admission' ),
		configuredMaximumFramesInFlightByTarget: Object.fromEntries( requiredTargetViewKeys.map( ( key ) => [ key, 2 ] ) ),
		observedFramesInFlightByTarget: Object.fromEntries( requiredTargetViewKeys.map( ( key ) => [ key, 1 ] ) ),
		saturationPolicyByTarget: Object.fromEntries( requiredTargetViewKeys.map( ( key ) => [ key, 'stall' ] ) ),
		ageSkewDiscontinuityAndClosureGateResults: [ { gate: 'cohort-closure', status: 'accepted' } ], status: 'admitted', admissionDigest: 'sha256:cohort-admission-42'
	};
	const slotAdmission = ( key, index ) => {

		const [ presentationTargetId, viewId ] = key.split( '/' );
		return {
			slotAdmissionId: `slot-admission-${ key}-42`, cohortAdmissionId: cohortAdmission.cohortAdmissionId, targetFrameSequence: 42,
			presentationTargetId, viewId, configuredMaximumFramesInFlight: 2, observedFramesInFlightAtAdmission: 1, saturationPolicy: 'stall',
			frameSlotIndex: index, frameSlotGeneration: `frame-slot-${ key}-g42`, backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1',
			priorOccupantExecutionId: typedAbsence( 'unavailable', 'frame-slot-coordinator' ), priorSlotCompletionJoin: typedAbsence( 'unavailable', 'frame-slot-coordinator' ),
			acquisitionToken: `acquire-${ key}-42`, presentCompletionReservation: `present-reservation-${ key}-42`,
			requiredRenderResourceLeaseIds: route.physicsPresentationRenderPlansByTarget[ key ].renderResourceLeaseIds,
			capacityAndAliasingGateResults: [ { gate: 'frame-slot-capacity', status: 'accepted' } ], status: 'admitted', admissionDigest: `sha256:slot-admission-${ key}-42`
		};

	};
	const slotAdmissions = requiredTargetViewKeys.map( slotAdmission );
	const slotByKey = new Map( slotAdmissions.map( ( slot ) => [ `${ slot.presentationTargetId }/${ slot.viewId }`, slot ] ) );
	const targetExecution = ( key, id, viewLease ) => {

		const [ presentationTargetId, viewId ] = key.split( '/' );
		const consumedLeaseIds = [ 'water-previous', 'water-current', 'body-previous', 'body-current', viewLease ];
		const completionTokens = consumedLeaseIds.map( ( leaseId ) => leasesById.get( leaseId ).reuseProhibitedUntil.presentationConsumers.find( ( ref ) => ref.presentationTargetId === presentationTargetId && ref.viewId === viewId ) );
		const plan = route.physicsPresentationRenderPlansByTarget[ key ];
		return { snapshotId: id, renderPlanId: plan.renderPlanId, slotAdmissionId: slotByKey.get( key ).slotAdmissionId, presentationTargetId, viewId, status: 'completed', submittedPasses: plan.phaseRecords.map( ( phaseRecord ) => phaseRecord.passOrDispatchKey ), queueSubmissionEpochs: [ 'submit-42' ], actionResults: [ { status: 'all-plan-phases-completed', phaseIds: plan.phaseIds } ], resetActionResults: clone( route.physicsViewPreparationPublicationsByTarget[ key ].resetActionResults ), completionTokens, presentedTimestamp: clone( fixed42Half ), failure: typedAbsence( 'not-applicable', '$threejs-image-pipeline' ) };

	};
	route.frameExecutionRecord = { executionId: 'execution-42', timeCohortId: 'presentation-cohort-42', candidateIds: [ 'physics-candidate-42' ], cohortAdmission, renderPlans: clone( renderPlans ), slotAdmissions, requiredTargetViewKeys, snapshotIds: [ mainId, mapId ], overallStatus: 'completed', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', targetExecutions: { 'main/main-view': targetExecution( 'main/main-view', mainId, 'main-view' ), 'minimap/map-view': targetExecution( 'minimap/map-view', mapId, 'map-view' ) }, leaseDispositionById: Object.fromEntries( allLeases.map( ( lease ) => [ lease.leaseId, { disposition: 'retained-until-join', consumingSnapshotIds: lease.leaseId === 'main-view' ? [ mainId ] : lease.leaseId === 'map-view' ? [ mapId ] : [ mainId, mapId ], completionJoin: clone( lease.reuseProhibitedUntil ), retirementEvidence: { joinId: lease.reuseProhibitedUntil.joinId, joinDigest: lease.reuseProhibitedUntil.joinDigest, completedConsumerKeys: [ ...lease.reuseProhibitedUntil.requiredConsumerKeys ], cancelledConsumerKeys: [], joinResolution: 'completed-or-reservation-cancelled', status: 'all required consumers completed' } } ] ) ) };

}

function attachCanonicalCostLedger( route ) {

	const stages = route.physicsGraph.stages;
	const measurementInterval = fixtureInterval( route.physicsContext.physicsClockRegistry.clocksById, 'physics-fixed', 0, 18000 );
	const exactIntervals = 18000;
	const exactFrames = 9000;
	const exactDurationSeconds = 300;
	const targetViewKeys = [ 'main/main-view', 'minimap/map-view' ];
	const executionCountPerInterval = Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, route.physicsGraph.executionLedger.stageExecutions.filter( ( execution ) => execution.stageId === stage.stageId ).length ] ) );
	const perStage = ( value, unit ) => Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, { count: evidence( value( stage.stageId ), unit, 'Measured', 'mobile-sustained-trace' ) } ] ) );
	const stageExecutionCounts = Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, evidence( executionCountPerInterval[ stage.stageId ] * exactIntervals, 'execution', 'Measured', 'mobile-sustained-trace' ) ] ) );
	const totalStageExecutions = Object.values( stageExecutionCounts ).reduce( ( total, count ) => total + quantityValue( count, 'stageExecutionCounts' ), 0 );
	const sharedWorkKey = 'physics-shared-work';
	const perViewWorkKeys = { 'main/main-view': [ 'render-main-work' ], 'minimap/map-view': [ 'render-minimap-work' ] };
	const workOccurrenceCounts = { [ sharedWorkKey ]: evidence( totalStageExecutions, 'occurrence', 'Measured', 'mobile-sustained-trace' ), 'render-main-work': evidence( exactFrames, 'occurrence', 'Measured', 'mobile-sustained-trace' ), 'render-minimap-work': evidence( exactFrames, 'occurrence', 'Measured', 'mobile-sustained-trace' ) };
	const descriptorTrafficRecord = {
		trafficRecordId: 'traffic-descriptor-upload', contextId: route.physicsContext.contextId, producer: 'route-physics-coordinator', consumers: [ 'gpu-stages' ], direction: 'cpu-to-gpu',
		resourceIdAndVersion: { resourceId: 'physics-descriptor-table', resourceVersion: 'descriptor-table-v42' }, sourceAndDestinationResidency: { source: 'cpu', destination: 'gpu' },
		deviceBackendResourceGenerations: { deviceId: 'fixture-webgpu-device', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', resourceGeneration: 'descriptor-generation-42' },
		logicalBytesPerOccurrence: evidence( 4096, 'byte', 'Derived', 'descriptor-layout' ), physicalBytesPerOccurrence: evidence( 4096, 'byte', 'Measured', 'queue-write-counters' ), occurrenceCount: evidence( exactIntervals, 'occurrence', 'Measured', 'mobile-sustained-trace' ),
		cadenceBasis: 'per-coordination-advance', dirtyFraction: evidence( 1, 'ratio', 'Measured', 'queue-write-counters' ), measurementInterval: clone( measurementInterval ),
		accessAndResourceTransition: { before: 'cpu-write', after: 'gpu-read' }, passDispatchOrExternalBoundary: 'coordination-ingress', dependencyRefs: [], readbackMapBehavior: 'none',
		workKey: sharedWorkKey, sharingScope: 'shared', targetViewKeys, measuredCountersRef: 'sha256:fixture-queue-write-counters'
	};
	const stageTrafficRecords = stages.map( ( stage ) => ( {
		trafficRecordId: `traffic-stage-${ stage.stageId }`, contextId: route.physicsContext.contextId, producer: stage.stageId, consumers: stage.writes.length > 0 ? stage.writes.map( ( write ) => write.signalId ) : [ 'stage-side-effect-or-publication' ], direction: 'same-residency',
		resourceIdAndVersion: { resourceId: `${ stage.stageId }-hot-state`, resourceVersion: route.physicsGraph.executionLedger.graphRevision }, sourceAndDestinationResidency: { source: 'gpu', destination: 'gpu' },
		deviceBackendResourceGenerations: { deviceId: 'fixture-webgpu-device', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', resourceGeneration: `${ stage.stageId }-resource-generation-42` },
		logicalBytesPerOccurrence: evidence( 393216, 'byte', 'Derived', `${ stage.stageId }-hot-layout` ), physicalBytesPerOccurrence: evidence( 393216, 'byte', 'Measured', 'gpu-traffic-counters' ), occurrenceCount: clone( stageExecutionCounts[ stage.stageId ] ),
		cadenceBasis: 'per-stage-execution', dirtyFraction: evidence( 1, 'ratio', 'Measured', 'gpu-traffic-counters' ), measurementInterval: clone( measurementInterval ), accessAndResourceTransition: { before: 'stage-read', after: 'stage-write-or-complete' },
		passDispatchOrExternalBoundary: stage.stageId, dependencyRefs: [], readbackMapBehavior: 'none', workKey: sharedWorkKey, sharingScope: 'shared', targetViewKeys, measuredCountersRef: 'sha256:fixture-gpu-traffic-counters'
	} ) );
	const trafficRecords = [ descriptorTrafficRecord, ...stageTrafficRecords ];
	const memoryResidency = clone( route.physicsSignals.waterSurface.residency );
	const makeMemoryLedger = ( category, bytes ) => {

		const allocationParts = category === 'migration-overlap' ? [ [ 'source', bytes / 2 ], [ 'destination', bytes / 2 ] ] : [ [ 'active', bytes ] ];
		const allocations = allocationParts.map( ( [ generationRole, allocationBytes ] ) => ( {
			allocationId: `${ category }-${ generationRole }-allocation`, resourceId: `${ category }-${ generationRole }-resource`, owner: '$threejs-water-optics', semantic: category === 'hot-state' ? 'solver-state' : 'named', residency: clone( memoryResidency ),
			deviceBackendResourceGenerations: { deviceId: 'fixture-webgpu-device', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1', resourceGeneration: `${ category }-${ generationRole }-generation-42` },
			encodingFormatAndExtent: { generationRole, format: 'rgba16float', extent: evidence( [ 1024, 1024, 1 ], 'texel-extent', 'Derived', 'allocation-layout' ) }, elementCountStrideAndLogicalBytes: { elementCount: evidence( allocationBytes / 8, 'element', 'Derived', 'allocation-layout' ), stride: evidence( 8, 'byte', 'Derived', 'allocation-layout' ), logicalBytes: evidence( allocationBytes, 'byte', 'Derived', 'allocation-layout' ) },
			physicalAllocatedBytes: evidence( allocationBytes, 'byte', 'Measured', 'adapter-allocation-trace' ), liveInterval: { begin: 'trace-start', endExclusive: 'trace-end', coversQualityCommit: category === 'migration-overlap' }, framesInFlightMultiplier: evidence( 2, 'frame', 'Measured', 'backend-trace' ),
			sharingScope: 'context-shared', targetViewKeys, workKey: sharedWorkKey, aliasGroupAndNonoverlapProof: typedAbsence( 'not-applicable', '$threejs-water-optics' ), leaseIdsAndCompletionJoins: [], evidenceRef: 'sha256:adapter-allocation-trace'
		} ) );
		return {
			memoryLedgerId: `${ category }-memory-ledger`, contextId: route.physicsContext.contextId, measurementInterval: clone( measurementInterval ), qualityEpoch: 'quality-epoch-3', category,
			allocations,
			logicalBytesByResidency: { gpu: evidence( bytes, 'byte', 'Derived', 'allocation-layout' ) }, physicalAllocatedBytesByResidency: { gpu: evidence( bytes, 'byte', 'Measured', 'adapter-allocation-trace' ) }, maximumSimultaneouslyLiveBytes: { gpu: evidence( bytes, 'byte', 'Measured', 'allocation-lifetime-sweep' ) },
			sharedBytesByWorkKey: { [ sharedWorkKey ]: evidence( bytes, 'byte', 'Derived', 'allocation-layout' ) }, perViewBytesByTargetView: Object.fromEntries( targetViewKeys.map( ( key ) => [ key, evidence( 0, 'byte', 'Derived', 'shared-allocation' ) ] ) ),
			lifetimeDagDigest: `sha256:${ category }-lifetime-dag`, allocationTraceRef: 'sha256:adapter-allocation-trace', status: 'measured'
		};

	};
	const hotState = makeMemoryLedger( 'hot-state', 50331648 );
	const peakTransient = makeMemoryLedger( 'peak-transient', 83886080 );
	const migrationOverlap = makeMemoryLedger( 'migration-overlap', 100663296 );
	const workAttribution = [
		{ workKey: sharedWorkKey, owner: 'route-physics-coordinator', scope: 'shared', targetViewKeys, coordinationAdvanceIds: [ 'coordination-advance-42' ], stageExecutionPassOrDispatchIds: route.physicsGraph.executionLedger.stageExecutions.map( ( execution ) => execution.executionId ), occurrenceCount: clone( workOccurrenceCounts[ sharedWorkKey ] ), cpuTime: evidence( 24, 'second', 'Measured', 'mobile-sustained-trace' ), gpuTime: evidence( 48, 'second', 'Measured', 'mobile-sustained-trace' ), externalLatency: typedAbsence( 'not-applicable', 'route-physics-coordinator' ), trafficRecordIds: trafficRecords.map( ( record ) => record.trafficRecordId ), memoryAllocationIds: [ ...hotState.allocations, ...peakTransient.allocations, ...migrationOverlap.allocations ].map( ( allocation ) => allocation.allocationId ), attributionRule: 'count-shared-once', attributionDigest: 'sha256:physics-shared-work-attribution' },
		...targetViewKeys.map( ( targetViewKey ) => { const workKey = perViewWorkKeys[ targetViewKey ][ 0 ]; return { workKey, owner: '$threejs-image-pipeline', scope: 'per-view', targetViewKeys: [ targetViewKey ], coordinationAdvanceIds: [], stageExecutionPassOrDispatchIds: route.physicsPresentationRenderPlansByTarget[ targetViewKey ].phaseIds, occurrenceCount: clone( workOccurrenceCounts[ workKey ] ), cpuTime: evidence( 3, 'second', 'Measured', 'mobile-sustained-trace' ), gpuTime: evidence( 18, 'second', 'Measured', 'mobile-sustained-trace' ), externalLatency: typedAbsence( 'not-applicable', '$threejs-image-pipeline' ), trafficRecordIds: [], memoryAllocationIds: [], attributionRule: 'count-once-per-listed-view', attributionDigest: `sha256:${ workKey }-attribution` }; } )
	];
	const cadenceTraceTotals = {
		traceTotalsId: 'mobile-trace-totals-42', traceRef: 'sha256:fixture-mobile-sustained-trace', measurementInterval: clone( measurementInterval ), exactDuration: fixtureDurationSeconds( exactDurationSeconds, 'exact-clock-endpoint-difference' ),
		coordinationAdvanceCount: evidence( exactIntervals, 'advance', 'Measured', 'mobile-sustained-trace' ), catchUpBatchCount: evidence( 0, 'batch', 'Measured', 'mobile-sustained-trace' ), stageExecutionCounts,
		nativeSubcycleCounts: { '$threejs-water-optics': evidence( executionCountPerInterval[ 'solve-water' ] * exactIntervals, 'subcycle', 'Measured', 'mobile-sustained-trace' ) },
		couplingIterationCounts: { 'body-water-loop': evidence( 3 * exactIntervals, 'iteration', 'Measured', 'mobile-sustained-trace' ) },
		interactionApplicationCounts: { momentumTransfer: evidence( route.physicsGraph.executionLedger.interactionApplicationLedgers.length * exactIntervals, 'application', 'Measured', 'mobile-sustained-trace' ) },
		presentedFrameCounts: Object.fromEntries( targetViewKeys.map( ( key ) => [ key, evidence( exactFrames, 'frame', 'Measured', 'mobile-sustained-trace' ) ] ) ), workOccurrenceCounts,
		trafficOccurrenceAndLogicalByteTotals: Object.fromEntries( trafficRecords.map( ( record ) => [ record.trafficRecordId, { occurrenceCount: clone( record.occurrenceCount ), logicalByteTotal: evidence( quantityValue( record.occurrenceCount, `${ record.trafficRecordId }.occurrenceCount` ) * quantityValue( record.logicalBytesPerOccurrence, `${ record.trafficRecordId }.logicalBytes` ), 'byte', 'Derived', 'occurrence-count-times-logical-bytes' ) } ] ) ),
		droppedCoordinationIntervals: [], exactTotalsDigest: 'pending'
	};
	const cadenceDigestPayload = clone( cadenceTraceTotals );
	delete cadenceDigestPayload.exactTotalsDigest;
	cadenceTraceTotals.exactTotalsDigest = sha256Canonical( cadenceDigestPayload );
	const qualityStateAndEpoch = { qualityStateId: 'mobile-quality-v3', qualityEpoch: 'quality-epoch-3' };
	const graphAndResourceRevisionDigest = sha256Canonical( {
		graphId: route.physicsGraph.graphId,
		graphRevision: route.physicsGraph.executionLedger.graphRevision,
		trafficRecordIds: trafficRecords.map( ( record ) => record.trafficRecordId ),
		memoryLedgerIds: [ hotState.memoryLedgerId, peakTransient.memoryLedgerId, migrationOverlap.memoryLedgerId ]
	} );
	const harness = {
		harnessId: 'mobile-cost-harness-42',
		target: {
			deviceId: 'fixture-low-end-mobile-tile-gpu', osAndBrowserBuild: 'fixture-mobile-os/chromium-webgpu-build-42', gpuAdapterAndDriver: 'fixture-integrated-tile-adapter-driver-42',
			backendAndDeviceGeneration: { backend: 'WebGPU', backendGeneration: 'backend-generation-1', deviceLossGeneration: 'device-generation-1' },
			displayModeAndMeasuredRefresh: { mode: 'foreground-vsync', refresh: evidence( 60, 'hertz', 'Measured', 'fixture-display-probe' ) },
			powerSourceAndGovernor: { source: 'battery', governor: 'balanced-thermal-policy' }, thermalStartAndStabilizationPolicy: { start: 'conditioned-nominal', sustainedDuration: evidence( exactDurationSeconds, 'second', 'Authored', 'fixture-sustained-protocol' ) }
		},
		viewport: { cssExtent: evidence( [ 720, 1280 ], 'css-pixel-extent', 'Measured', 'fixture-canvas' ), dpr: evidence( 1.5, 'ratio', 'Measured', 'fixture-canvas' ), physicalExtent: evidence( [ 1080, 1920 ], 'physical-pixel-extent', 'Derived', 'css-extent-times-dpr' ) },
		workload: {
			routeAndSceneRevision: 'sha256:fixture-coupled-water-body-scene-42', contextGraphAndRegistryRevisions: { contextVersion: route.physicsContext.contextVersion, graphRevision: route.physicsGraph.executionLedger.graphRevision, frameRegistryRevision: route.physicsContext.physicsFrameRegistry.registryRevision },
			resourceAndPipelineGraphDigest: graphAndResourceRevisionDigest, presentationTargetsAndViews: targetViewKeys, seedCameraInputAndEventTrace: 'sha256:fixture-seed-camera-input-event-trace-42', qualityStateAndEpoch
		},
		protocol: {
			warmupAndCompilationState: { shaderPipelinesWarm: true, allocationPlateauReached: true }, coldTransitionAndSustainedSegments: { cold: 'excluded-and-recorded', sustained: evidence( exactDurationSeconds, 'second', 'Measured', 'mobile-sustained-trace' ) },
			sampleAndQuantilePolicy: { estimator: 'nearest-rank', samples: evidence( exactFrames, 'opportunity', 'Measured', 'mobile-sustained-trace' ) }, cpuClockAndGpuQueryCoverage: { cpuClock: 'monotonic-performance-clock', gpuTimestamps: 'all-solver-and-render-critical-path-nodes' },
			counterAvailabilityAndUncertainty: { tileTraffic: 'available', physicalAllocation: 'available', powerCounters: 'unavailable' }, visibilityPowerAndAutomationControls: { foreground: true, visible: true, automationThrottling: false }
		},
		harnessDigest: 'pending'
	};
	harness.harnessDigest = sha256CanonicalExcluding( harness, [ 'harnessDigest' ] );
	const totalTraceLogicalBytes = Object.values( cadenceTraceTotals.trafficOccurrenceAndLogicalByteTotals ).reduce( ( total, record ) => total + quantityValue( record.logicalByteTotal, 'trace logical byte total' ), 0 );
	const composedGateSet = {
		gateSetId: 'mobile-composed-cost-gates-42', harnessId: harness.harnessId, qualityStateAndEpoch: clone( qualityStateAndEpoch ), frozenBeforeTraceDigest: 'sha256:fixture-mobile-gates-frozen-before-trace-42',
		cpuCriticalPathP95: evidence( 0.004, 'second', 'Gated', 'derived-mobile-cpu-envelope' ), gpuCriticalPathP95: evidence( 0.006, 'second', 'Gated', 'derived-mobile-gpu-envelope' ), externalTailP95: typedAbsence( 'not-applicable', 'route-physics-coordinator' ),
		presentedIntervalP95: evidence( 1 / 60, 'second', 'Gated', 'target-presentation-envelope' ), deadlineMissRatio: evidence( 0.01, 'ratio', 'Gated', 'product-deadline-contract' ),
		updateLatencyByStateEquation: { 'water-state': evidence( 0.012, 'second', 'Gated', 'water-control-latency-contract' ), 'body-state': evidence( 0.012, 'second', 'Gated', 'body-control-latency-contract' ) },
		hotStateBytes: evidence( 50331648, 'byte', 'Gated', 'named-target-memory-contract' ), peakTransientBytes: evidence( 83886080, 'byte', 'Gated', 'named-target-memory-contract' ), migrationOverlapBytes: evidence( 100663296, 'byte', 'Gated', 'named-target-memory-contract' ),
		logicalTrafficPerOpportunity: evidence( totalTraceLogicalBytes / exactFrames, 'byte-per-opportunity', 'Gated', 'named-target-traffic-contract' ), uploadCopyMapBytesPerOpportunity: evidence( totalTraceLogicalBytes / exactFrames, 'byte-per-opportunity', 'Gated', 'named-target-transfer-contract' ),
		allocationAndCompilationChurn: { steadyAllocationsPerOpportunity: evidence( 0, 'allocation-per-opportunity', 'Gated', 'steady-runtime-contract' ) }, sustainedDriftAndQualityResidence: { maximumP95Drift: evidence( 0.1, 'ratio', 'Gated', 'sustained-target-contract' ) },
		numericalAndVisualErrorGateRefs: [ 'body-water-momentum-residual-gate', 'water-surface-error-gate', 'quality-visual-error-gate' ]
	};
	const opportunityPattern = {
		coordinationAdvanceCount: exactIntervals / exactFrames,
		stageExecutionCounts: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, executionCountPerInterval[ stage.stageId ] * exactIntervals / exactFrames ] ) ),
		nativeSubcycleCounts: { '$threejs-water-optics': executionCountPerInterval[ 'solve-water' ] * exactIntervals / exactFrames },
		couplingIterationCounts: { 'body-water-loop': 3 * exactIntervals / exactFrames },
		interactionApplicationCounts: Object.fromEntries( Object.entries( cadenceTraceTotals.interactionApplicationCounts ).map( ( [ tag, count ] ) => [ tag, quantityValue( count, `cadenceTraceTotals.interactionApplicationCounts.${ tag }` ) / exactFrames ] ) ),
		presentedFrameCounts: Object.fromEntries( targetViewKeys.map( ( key ) => [ key, 1 ] ) ),
		workOccurrenceCounts: { [ sharedWorkKey ]: totalStageExecutions / exactFrames, 'render-main-work': 1, 'render-minimap-work': 1 },
		trafficOccurrenceAndLogicalByteTotals: Object.fromEntries( trafficRecords.map( ( record ) => {
			const occurrences = quantityValue( record.occurrenceCount, `${ record.trafficRecordId }.occurrences` ) / exactFrames;
			return [ record.trafficRecordId, { occurrenceCount: occurrences, logicalByteTotal: occurrences * quantityValue( record.logicalBytesPerOccurrence, `${ record.trafficRecordId }.logicalBytes` ) } ];
		} ) ),
		queueDispatchPassAndBarrierCounts: { dispatches: Object.values( stageExecutionCounts ).reduce( ( total, count ) => total + quantityValue( count, 'dispatch count' ), 0 ) / exactFrames, submissions: 1, passBreaks: 2, barriers: route.physicsGraph.dependencies.length },
		qualityStateAndEpoch: clone( qualityStateAndEpoch )
	};
	const opportunityResourcePayload = {
		layout: 'physics-cost-opportunity-columnar-rle-v1', rowCount: exactFrames, presentationClockId: 'physics-fixed', firstOpportunitySequence: 0, ticksPerOpportunity: exactIntervals / exactFrames,
		runs: [ { count: exactFrames, pattern: opportunityPattern, measuredColumns: { cpuCriticalPathSeconds: 0.0024, gpuCriticalPathSeconds: 0.0048, presentedIntervalSeconds: 1 / 60, deadlineMiss: false, hotStateBytes: 50331648, peakTransientBytes: 83886080, migrationOverlapBytes: 0 } } ]
	};
	const opportunityResourceDigest = sha256Canonical( opportunityResourcePayload );
	costOpportunityTableResourceFixtures.set( opportunityResourceDigest, opportunityResourcePayload );
	const opportunityTable = {
		opportunityTableId: 'mobile-opportunity-table-42', harnessId: harness.harnessId, measurementInterval: clone( measurementInterval ), storage: 'immutable-resource', inlineRows: typedAbsence( 'not-applicable', 'route-physics-coordinator' ),
		resource: { contentDigest: opportunityResourceDigest, canonicalByteLayout: opportunityResourcePayload.layout, rowCount: evidence( exactFrames, 'opportunity', 'Measured', 'mobile-sustained-trace' ), orderedRowDigestRoot: sha256Canonical( opportunityResourcePayload.runs ) },
		exactRowCount: evidence( exactFrames, 'opportunity', 'Measured', 'mobile-sustained-trace' ), tableDigest: 'pending'
	};
	opportunityTable.tableDigest = sha256CanonicalExcluding( opportunityTable, [ 'tableDigest' ] );
	const composedTrace = {
		composedTraceId: 'mobile-composed-trace-42', harnessId: harness.harnessId, gateSetId: composedGateSet.gateSetId, opportunityTableId: opportunityTable.opportunityTableId, cadenceTraceTotalsId: cadenceTraceTotals.traceTotalsId,
		cpuCriticalPathDistribution: { p50: evidence( 0.0022, 'second', 'Measured', 'mobile-sustained-opportunity-table' ), p95: evidence( 0.0024, 'second', 'Measured', 'mobile-sustained-opportunity-table' ) },
		gpuCriticalPathDistribution: { p50: evidence( 0.0044, 'second', 'Measured', 'mobile-sustained-opportunity-table' ), p95: evidence( 0.0048, 'second', 'Measured', 'mobile-sustained-opportunity-table' ), queryCoverage: 'all dependency-path GPU nodes' }, externalTailDistribution: typedAbsence( 'not-applicable', 'route-physics-coordinator' ),
		presentedIntervalAndDeadlineMissDistribution: { p95: evidence( 1 / 60, 'second', 'Measured', 'mobile-sustained-opportunity-table' ), missRatio: evidence( 0, 'ratio', 'Measured', 'mobile-sustained-opportunity-table' ) },
		memoryTrafficAllocationAndThermalDistributions: { hotStatePeak: evidence( 50331648, 'byte', 'Measured', 'allocation-lifetime-sweep' ), transientPeak: evidence( 83886080, 'byte', 'Measured', 'allocation-lifetime-sweep' ), logicalTrafficPerOpportunity: evidence( totalTraceLogicalBytes / exactFrames, 'byte-per-opportunity', 'Derived', 'exact-trace-bytes-over-opportunities' ), thermalTrace: 'sha256:fixture-mobile-sustained-thermal-42' },
		gateResults: { cpuCriticalPathP95: 'pass', gpuCriticalPathP95: 'pass', presentedIntervalP95: 'pass', deadlineMissRatio: 'pass', memory: 'pass', traffic: 'pass', numericalAndVisualError: 'pass' }, status: 'measured-valid'
	};
	const catchUpPolicyMaximumAdvances = quantityValue( route.physicsGraph.catchUpPolicy.maximumCoordinationAdvancesPerPresentationOpportunity, 'maximum catch-up advances' );
	const catchUpMaximumNativeExecutions = quantityValue( route.physicsGraph.catchUpPolicy.maximumNativeExecutionsPerOpportunity, 'maximum catch-up native executions' );
	const nativeExecutionsPerAdvance = Object.values( executionCountPerInterval ).reduce( ( total, count ) => total + count, 0 );
	const catchUpMaxAdvances = Math.min( catchUpPolicyMaximumAdvances, Math.floor( catchUpMaximumNativeExecutions / nativeExecutionsPerAdvance ) );
	assert.ok( catchUpMaxAdvances > 0, 'catch-up policy admits no complete coordination advance under its native-execution cap' );
	const catchUpStageCounts = Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, evidence( executionCountPerInterval[ stage.stageId ] * catchUpMaxAdvances, 'execution', 'Derived', 'graph-stage-activation-times-maximum-catch-up-advances' ) ] ) );
	const catchUpStageTotal = Object.values( catchUpStageCounts ).reduce( ( total, count ) => total + quantityValue( count, 'catch-up stage count' ), 0 );
	const catchUpTraffic = Object.fromEntries( trafficRecords.map( ( record ) => {
		const occurrences = record.cadenceBasis === 'per-stage-execution' ? quantityValue( catchUpStageCounts[ record.producer ], `${ record.producer }.catchUpCount` ) : catchUpMaxAdvances;
		return [ record.trafficRecordId, { occurrenceCount: evidence( occurrences, 'occurrence', 'Derived', 'worst-permitted-catch-up-schedule' ), logicalByteTotal: evidence( occurrences * quantityValue( record.logicalBytesPerOccurrence, `${ record.trafficRecordId }.logicalBytes` ), 'byte', 'Derived', 'worst-permitted-catch-up-schedule' ) } ];
	} ) );
	const catchUpOpportunityRow = {
		opportunityKey: { presentationClockId: 'physics-fixed', presentationOpportunitySequence: 'worst-permitted-catch-up-witness-42' }, opportunityInterval: fixtureInterval( route.physicsContext.physicsClockRegistry.clocksById, 'physics-fixed', 0, catchUpMaxAdvances ), catchUpBatchId: 'synthetic-max-policy-batch-42',
		coordinationAdvanceIds: Array.from( { length: catchUpMaxAdvances }, ( _, index ) => `synthetic-catch-up-advance-${ index }` ), stageExecutionCounts: catchUpStageCounts,
		nativeSubcycleCounts: { '$threejs-water-optics': evidence( executionCountPerInterval[ 'solve-water' ] * catchUpMaxAdvances, 'subcycle', 'Derived', 'worst-permitted-catch-up-schedule' ) }, couplingIterationCounts: { 'body-water-loop': evidence( 3 * catchUpMaxAdvances, 'iteration', 'Derived', 'worst-permitted-catch-up-schedule' ) },
		interactionApplicationCounts: Object.fromEntries( Object.entries( cadenceTraceTotals.interactionApplicationCounts ).map( ( [ tag, count ] ) => [ tag, evidence( quantityValue( count, `cadenceTraceTotals.interactionApplicationCounts.${ tag }` ) / exactIntervals * catchUpMaxAdvances, 'application', 'Derived', 'worst-permitted-catch-up-schedule' ) ] ) ), presentedFrameCounts: Object.fromEntries( targetViewKeys.map( ( key ) => [ key, evidence( 1, 'frame', 'Derived', 'one-catch-up-presentation-opportunity' ) ] ) ),
		workOccurrenceCounts: { [ sharedWorkKey ]: evidence( catchUpStageTotal, 'occurrence', 'Derived', 'worst-permitted-catch-up-schedule' ), 'render-main-work': evidence( 1, 'occurrence', 'Derived', 'one-catch-up-presentation-opportunity' ), 'render-minimap-work': evidence( 1, 'occurrence', 'Derived', 'one-catch-up-presentation-opportunity' ) }, trafficOccurrenceAndLogicalByteTotals: catchUpTraffic,
		queueDispatchPassAndBarrierCounts: { dispatches: evidence( catchUpStageTotal, 'dispatch', 'Derived', 'worst-permitted-catch-up-schedule' ), submissions: evidence( 1, 'submission', 'Measured', 'catch-up-frontier-trace' ), passBreaks: evidence( 2, 'pass-break', 'Measured', 'catch-up-frontier-trace' ), barriers: evidence( route.physicsGraph.dependencies.length * catchUpMaxAdvances, 'barrier', 'Derived', 'dependency-closure' ) },
		cpuCriticalPath: { duration: evidence( 0.0036, 'second', 'Measured', 'catch-up-frontier-trace' ), nodePath: [ 'schedule', 'solve', 'commit' ] }, gpuCriticalPath: { duration: evidence( 0.0055, 'second', 'Measured', 'catch-up-frontier-trace' ), nodePath: [ 'solver-dispatches', 'render-critical-path' ], queryCoverage: 'complete' }, externalTail: typedAbsence( 'not-applicable', 'route-physics-coordinator' ),
		presentedIntervalAndDeadlineMiss: { interval: evidence( 1 / 60, 'second', 'Measured', 'catch-up-frontier-trace' ), deadlineMiss: false }, hotStatePeakTransientAndMigrationBytes: { hotState: evidence( 50331648, 'byte', 'Measured', 'catch-up-frontier-trace' ), peakTransient: evidence( 83886080, 'byte', 'Measured', 'catch-up-frontier-trace' ), migrationOverlap: evidence( 100663296, 'byte', 'Measured', 'catch-up-frontier-trace' ) },
		numericalAndVisualGateResults: [ { gateId: 'body-water-momentum-residual-gate', status: 'pass' }, { gateId: 'quality-visual-error-gate', status: 'pass' } ], qualityStateAndEpoch: clone( qualityStateAndEpoch ), rowDigest: 'pending'
	};
	catchUpOpportunityRow.rowDigest = sha256CanonicalExcluding( catchUpOpportunityRow, [ 'rowDigest' ] );
	const catchUpWitness = {
		witnessId: 'catch-up-frontier-witness-42', maximizedObjectiveDimensions: [ 'cpu-critical-path', 'gpu-critical-path', 'external-tail', 'presented-interval', 'hot-traffic', 'peak-live-bytes', 'migration-overlap-bytes', 'numerical-error', 'visual-error' ], opportunityRow: catchUpOpportunityRow,
		repetitionAndSustainedProtocol: { repetitions: evidence( 900, 'opportunity', 'Measured', 'catch-up-frontier-trace' ), duration: evidence( 15, 'second', 'Measured', 'catch-up-frontier-trace' ) }, composedMeasuredDistributions: { cpuP95: clone( catchUpOpportunityRow.cpuCriticalPath.duration ), gpuP95: clone( catchUpOpportunityRow.gpuCriticalPath.duration ), presentedP95: clone( catchUpOpportunityRow.presentedIntervalAndDeadlineMiss.interval ), trafficBytes: evidence( Object.values( catchUpTraffic ).reduce( ( total, record ) => total + quantityValue( record.logicalByteTotal, 'catch-up traffic bytes' ), 0 ), 'byte', 'Derived', 'worst-permitted-catch-up-schedule' ) },
		derivedUpperBoundsAndAssumptions: { scheduleModel: 'verified-integer-closure-over-graph-maxima', assumption: 'fixture stage activation is invariant over the admitted maximum debt envelope' }, witnessDigest: 'pending'
	};
	catchUpWitness.witnessDigest = sha256CanonicalExcluding( catchUpWitness, [ 'witnessDigest' ] );
	const worstPermittedCatchUpCost = {
		catchUpCostId: 'mobile-worst-permitted-catch-up-42', harnessId: harness.harnessId, gateSetId: composedGateSet.gateSetId,
		catchUpPolicyIdentity: { graphId: route.physicsGraph.graphId, graphRevision: route.physicsGraph.executionLedger.graphRevision, policyDigest: sha256Canonical( route.physicsGraph.catchUpPolicy ), debtClockId: route.physicsGraph.catchUpPolicy.debtClockId, maximumDebt: clone( route.physicsGraph.catchUpPolicy.maximumDebt ), maximumCoordinationAdvancesPerPresentationOpportunity: clone( route.physicsGraph.catchUpPolicy.maximumCoordinationAdvancesPerPresentationOpportunity ), maximumNativeExecutionsPerOpportunity: clone( route.physicsGraph.catchUpPolicy.maximumNativeExecutionsPerOpportunity ), debtDisposition: route.physicsGraph.catchUpPolicy.debtDisposition },
		admissibleScheduleModel: { integerVariables: [ 'coordination-advances', 'stage-executions', 'native-subcycles', 'loop-iterations', 'interaction-applications', 'work-occurrences' ], constraintsDigest: sha256Canonical( { catchUpPolicy: route.physicsGraph.catchUpPolicy, stageRules: stages.map( ( stage ) => stage.executionRule ), loopBounds: route.physicsGraph.loopMacros.map( ( loop ) => loop.iterationBound ) } ), objectiveDimensions: clone( catchUpWitness.maximizedObjectiveDimensions ) },
		frontierWitnesses: [ catchUpWitness ], frontierCoverage: { method: 'verified-integer-optimization', proofRef: 'sha256:fixture-catch-up-frontier-proof-42', coveredObjectiveDimensions: clone( catchUpWitness.maximizedObjectiveDimensions ), uncoveredObjectiveDimensions: [], componentwiseDominationDigest: sha256Canonical( { witnessId: catchUpWitness.witnessId, dimensions: catchUpWitness.maximizedObjectiveDimensions, maximumAdvances: catchUpMaxAdvances } ) },
		gateResults: { cpu: 'pass', gpu: 'pass', presentation: 'pass', traffic: 'pass', memory: 'pass', numericalError: 'pass', visualError: 'pass' }, requiredDisposition: 'admit'
	};
	route.physicsCostLedger = {
		ledgerId: 'mobile-cost-ledger-42', contextId: route.physicsContext.contextId, graphId: route.physicsGraph.graphId, graphRevision: route.physicsGraph.executionLedger.graphRevision,
		measurementInterval, measurementClockId: 'physics-fixed', qualityEpoch: 'quality-epoch-3', presentationTargetsAndViews: targetViewKeys, measurementProtocolRefs: [ 'sha256:fixture-mobile-sustained-protocol', 'sha256:fixture-mobile-sustained-trace' ], cadenceTraceTotals, status: 'active',
		harness, composedGateSet, opportunityTable, composedTrace, qualityState: 'mobile-quality-v3',
		graphStageCosts: stages.map( ( stage ) => ( { stageId: stage.stageId, cpuP95: evidence( 0.08, 'millisecond', 'Measured', 'mobile-sustained-trace' ), gpuP95: evidence( 0.12, 'millisecond', 'Measured', 'mobile-sustained-trace' ), sampleCount: evidence( quantityValue( stageExecutionCounts[ stage.stageId ], `${ stage.stageId }.exactExecutions` ), 'sample', 'Measured', 'mobile-sustained-trace' ) } ) ),
		coordinationIntervalsPerSecond: { exactMean: evidence( 60, 'interval-per-second', 'Derived', 'exact-advance-count-over-duration' ), p50: evidence( 60, 'interval-per-second', 'Measured', 'mobile-sustained-trace' ) },
		stageExecutionsPerCoordinationInterval: perStage( ( stageId ) => executionCountPerInterval[ stageId ], 'execution-per-interval' ),
		stageExecutionsPerSecond: perStage( ( stageId ) => executionCountPerInterval[ stageId ] * exactIntervals / exactDurationSeconds, 'execution-per-second' ),
		coordinationIntervalsPerPresentedFrame: { exactRatio: evidence( 2, 'interval-per-frame', 'Derived', 'exact-advance-count-over-frame-cohort-count' ), p95: evidence( 2, 'interval-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		subcyclesAndCouplingIterationsPerPresentedFrame: { water: evidence( executionCountPerInterval[ 'solve-water' ] * exactIntervals / exactFrames, 'subcycle-per-frame', 'Measured', 'mobile-sustained-trace' ), coupling: evidence( 3 * exactIntervals / exactFrames, 'iteration-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		executionsPerPresentedFrame: perStage( ( stageId ) => executionCountPerInterval[ stageId ] * exactIntervals / exactFrames, 'execution-per-frame' ),
		worstPermittedCatchUpCost,
		hotBytesReadWrittenPerExecution: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, { read: evidence( 262144, 'byte', 'Derived', 'resource-layout' ), written: evidence( 131072, 'byte', 'Derived', 'resource-layout' ) } ] ) ),
		solverDispatches: stages.map( ( stage ) => ( { stageId: stage.stageId, owner: stage.owner, cadence: evidence( executionCountPerInterval[ stage.stageId ] * exactIntervals / exactDurationSeconds, 'dispatch-per-second', 'Measured', 'mobile-sustained-trace' ), occurrenceCount: clone( stageExecutionCounts[ stage.stageId ] ) } ) ),
		queueSubmissionsAndPassBreaks: { submissions: evidence( 1, 'submission-per-frame', 'Measured', 'mobile-sustained-trace' ), breaks: evidence( 2, 'break-per-frame', 'Measured', 'mobile-sustained-trace' ) },
		dependencyCriticalPaths: [ { path: 'water-solve-to-atomic-commit', p95: evidence( 2.4, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ],
		tileGpuTraffic: { attachmentStoreLoadResolveBytes: { p95: evidence( 12582912, 'byte-per-frame', 'Measured', 'tile-counters' ) }, tileSpillEvidence: 'no spill observed', renderComputePassBreaks: { p95: evidence( 2, 'break-per-frame', 'Measured', 'mobile-sustained-trace' ) } },
		bindingAndDeviceLimits: [ { limit: 'storage-bindings', demand: evidence( 6, 'binding', 'Derived', 'layouts' ), deviceLimit: evidence( 8, 'binding', 'Measured', 'adapter-limits' ), requiredHeadroom: evidence( 1, 'binding', 'Gated', 'mobile-gate' ) } ],
		cpuWork: [ { task: 'graph-schedule', p95: evidence( 0.5, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ], allocationGcAndCompilation: [ { category: 'steady-runtime', allocations: evidence( 0, 'allocation-per-frame', 'Measured', 'mobile-sustained-trace' ) } ],
		uploadsCopiesMaps: trafficRecords,
		hostCompletionsReadbacksPerPresentedFrame: evidence( 0, 'readback-per-frame', 'Measured', 'mobile-sustained-trace' ), synchronization: [ { kind: 'same-queue', p95: evidence( 0, 'millisecond', 'Measured', 'mobile-sustained-trace' ) } ],
		workAttribution, sharedWorkKeys: [ sharedWorkKey ], perViewWorkKeys, hotState, peakTransient, migrationOverlap, qualityCostEvidence: [], qualityMigrationCostEvidence: [],
		multiviewAndFramesInFlightMultipliers: { viewCount: evidence( 2, 'view', 'Measured', 'fixture-route' ), framesInFlight: evidence( 2, 'frame', 'Measured', 'backend-trace' ), resourceMultiplier: evidence( 1.4, 'ratio', 'Derived', 'resource-ledger' ), workMultiplier: evidence( 1.25, 'ratio', 'Measured', 'mobile-sustained-trace' ) }, thermalPowerState: { state: 'sustained nominal', duration: evidence( 300, 'second', 'Measured', 'mobile-sustained-trace' ) }
	};

}

function attachCanonicalQualityCostEvidence( route ) {

	const ledger = route.physicsCostLedger;
	const transitions = route.physicsQualityTransitions;
	if ( transitions.length === 0 ) {

		ledger.qualityCostEvidence = [];
		ledger.qualityMigrationCostEvidence = [];
		return;

	}
	const migrationEvidence = transitions.map( ( transition ) => {

		const migrationCostEvidenceId = `cost-${ transition.transitionId }`;
		const baseRow = ledger.worstPermittedCatchUpCost.frontierWitnesses[ 0 ].opportunityRow;
		const phaseOpportunityRows = Object.fromEntries( [ 'prepare', 'populate', 'commit', 'retire' ].map( ( phase, index ) => {

			const row = clone( baseRow );
			row.opportunityKey = { presentationClockId: transition.commitAtStepBoundary.commitInstant.clockId, presentationOpportunitySequence: `${ transition.transitionId }-${ phase }` };
			row.opportunityInterval = clone( transition.requestAdmission.safeCommitBoundary.kind === 'instant' ? route.physicsQualityRequests[ transition.requestId ].observedInterval : baseRow.opportunityInterval );
			row.catchUpBatchId = typedAbsence( 'not-applicable', 'route-physics-coordinator' );
			row.coordinationAdvanceIds = [];
			row.cpuCriticalPath.duration = evidence( 0.0004 + index * 0.0001, 'second', 'Measured', `quality-${ phase }-cost-trace` );
			row.gpuCriticalPath.duration = evidence( 0.0008 + index * 0.0002, 'second', 'Measured', `quality-${ phase }-cost-trace` );
			row.presentedIntervalAndDeadlineMiss = { interval: evidence( 1 / 60, 'second', 'Measured', `quality-${ phase }-cost-trace` ), deadlineMiss: false };
			row.qualityStateAndEpoch = { qualityStateId: phase === 'retire' ? transition.toState : transition.fromState, qualityEpoch: phase === 'retire' ? transition.toQualityEpoch : transition.fromQualityEpoch };
			row.rowDigest = sha256CanonicalExcluding( row, [ 'rowDigest' ] );
			return [ phase, [ row ] ];

		} ) );
		const migrationTrafficRecordIds = ledger.uploadsCopiesMaps.filter( ( record ) => /quality-migration/.test( record.trafficRecordId ) ).map( ( record ) => record.trafficRecordId );
		assert.ok( migrationTrafficRecordIds.length > 0, `quality transition ${ transition.transitionId } has no migration traffic record` );
		return {
			migrationCostEvidenceId, transitionId: transition.transitionId, sourceAndDestinationQualityEpochs: { source: transition.fromQualityEpoch, destination: transition.toQualityEpoch }, requestAndAllocationAdmissionIds: { requestAdmissionId: transition.requestAdmission.admissionId, allocationAdmissionId: transition.prepare.allocationAdmission.allocationAdmissionId },
			harnessId: ledger.harness.harnessId, gateSetId: ledger.composedGateSet.gateSetId, phaseOpportunityRows, overlapMemoryLedgerId: ledger.migrationOverlap.memoryLedgerId, migrationTrafficRecordIds,
			allocationCompilationAndPipelineCreation: { allocationsAdmittedBeforePopulation: true, compileCost: evidence( 0.0012, 'second', 'Measured', 'quality-migration-cost-trace' ), allocationChurn: evidence( transition.prepare.predictedPeakResources.allocations.length, 'allocation', 'Measured', 'quality-migration-cost-trace' ) },
			sourceRetirementTail: { duration: evidence( 2 / 60, 'second', 'Measured', 'quality-retirement-completion-trace' ), completionJoinId: transition.retireAfterCompletion.completionJoin.joinId, completionJoinDigest: transition.retireAfterCompletion.completionJoin.joinDigest },
			conservationConstraintAndVisualErrorResults: [ { gateId: 'quality-conservation-residual', status: 'pass' }, { gateId: 'quality-visual-error-gate', status: 'pass' } ], composedGateResultsDuringTransition: { cpu: 'pass', gpu: 'pass', presentation: 'pass', memory: 'pass', traffic: 'pass', error: 'pass' }, status: 'accepted'
		};

	} );
	const migrationByTransition = new Map( migrationEvidence.map( ( evidenceRecord ) => [ evidenceRecord.transitionId, evidenceRecord ] ) );
	ledger.qualityMigrationCostEvidence = migrationEvidence;
	ledger.qualityCostEvidence = Object.values( route.physicsQualityStates ).map( ( state ) => {

		const incoming = transitions.filter( ( transition ) => transition.toState === state.qualityStateId ).map( ( transition ) => migrationByTransition.get( transition.transitionId ).migrationCostEvidenceId );
		const outgoing = transitions.filter( ( transition ) => transition.fromState === state.qualityStateId ).map( ( transition ) => migrationByTransition.get( transition.transitionId ).migrationCostEvidenceId );
		const isActiveLedgerState = state.qualityStateId === ledger.qualityState && state.qualityEpoch === ledger.qualityEpoch;
		return {
			qualityStateAndEpoch: { qualityStateId: state.qualityStateId, qualityEpoch: state.qualityEpoch }, graphAndResourceRevisionDigest: sha256Canonical( { graphRevision: ledger.graphRevision, stateResourceCosts: state.hotTransientTrafficAndSynchronizationCosts, qualityEpoch: state.qualityEpoch } ),
			harnessId: isActiveLedgerState ? ledger.harness.harnessId : `harness-${ state.qualityStateId }`, gateSetId: isActiveLedgerState ? ledger.composedGateSet.gateSetId : `gate-set-${ state.qualityStateId }`, steadyCostLedgerId: isActiveLedgerState ? ledger.ledgerId : `steady-ledger-${ state.qualityStateId }`,
			composedTraceId: isActiveLedgerState ? ledger.composedTrace.composedTraceId : `composed-trace-${ state.qualityStateId }`, worstPermittedCatchUpCostId: isActiveLedgerState ? ledger.worstPermittedCatchUpCost.catchUpCostId : `catch-up-cost-${ state.qualityStateId }`, incomingMigrationCostEvidenceIds: incoming, outgoingMigrationCostEvidenceIds: outgoing, status: 'accepted'
		};

	} );

}

function refreshCanonicalComposedCostEvidence( route ) {

	const ledger = route.physicsCostLedger;
	const table = ledger.opportunityTable;
	assert.equal( table.storage, 'immutable-resource', 'canonical composed-cost refresh expects an immutable opportunity table' );
	const rowCount = quantityValue( table.exactRowCount, 'canonical opportunity row count' );
	const totals = ledger.cadenceTraceTotals;
	const priorPayload = costOpportunityTableResourceFixtures.get( table.resource.contentDigest );
	assert.ok( priorPayload, 'canonical opportunity resource is unavailable before refresh' );
	const payload = clone( priorPayload );
	const pattern = payload.runs[ 0 ].pattern;
	const dividedCounts = ( records, label ) => Object.fromEntries( Object.entries( records ).map( ( [ key, value ] ) => [ key, quantityValue( value, `${ label }.${ key}` ) / rowCount ] ) );
	pattern.coordinationAdvanceCount = quantityValue( totals.coordinationAdvanceCount, 'cadence coordination advances' ) / rowCount;
	pattern.stageExecutionCounts = dividedCounts( totals.stageExecutionCounts, 'stageExecutionCounts' );
	pattern.nativeSubcycleCounts = dividedCounts( totals.nativeSubcycleCounts, 'nativeSubcycleCounts' );
	pattern.couplingIterationCounts = dividedCounts( totals.couplingIterationCounts, 'couplingIterationCounts' );
	pattern.interactionApplicationCounts = dividedCounts( totals.interactionApplicationCounts, 'interactionApplicationCounts' );
	pattern.presentedFrameCounts = dividedCounts( totals.presentedFrameCounts, 'presentedFrameCounts' );
	pattern.workOccurrenceCounts = dividedCounts( totals.workOccurrenceCounts, 'workOccurrenceCounts' );
	pattern.trafficOccurrenceAndLogicalByteTotals = Object.fromEntries( Object.entries( totals.trafficOccurrenceAndLogicalByteTotals ).map( ( [ trafficId, record ] ) => [ trafficId, { occurrenceCount: quantityValue( record.occurrenceCount, `${ trafficId }.occurrenceCount` ) / rowCount, logicalByteTotal: quantityValue( record.logicalByteTotal, `${ trafficId }.logicalByteTotal` ) / rowCount } ] ) );
	const digest = sha256Canonical( payload );
	costOpportunityTableResourceFixtures.set( digest, payload );
	table.resource.contentDigest = digest;
	table.resource.canonicalByteLayout = payload.layout;
	table.resource.rowCount.value = payload.rowCount;
	table.resource.orderedRowDigestRoot = sha256Canonical( payload.runs );
	table.tableDigest = sha256CanonicalExcluding( table, [ 'tableDigest' ] );
	const catchUp = ledger.worstPermittedCatchUpCost;
	const exactAdvances = quantityValue( totals.coordinationAdvanceCount, 'exact coordination advances' );
	for ( const witness of catchUp.frontierWitnesses ) {

		const row = witness.opportunityRow;
		const admittedAdvances = row.coordinationAdvanceIds.length;
		row.interactionApplicationCounts = Object.fromEntries( Object.entries( totals.interactionApplicationCounts ).map( ( [ tag, count ] ) => [ tag, evidence( quantityValue( count, `${ tag }.applicationCount` ) / exactAdvances * admittedAdvances, 'application', 'Derived', 'worst-permitted-catch-up-schedule' ) ] ) );
		row.rowDigest = sha256CanonicalExcluding( row, [ 'rowDigest' ] );
		witness.witnessDigest = sha256CanonicalExcluding( witness, [ 'witnessDigest' ] );

	}

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
			scaleSource: 'metersPerWorldUnit', properBasisRotation: identity3,
			translationMeters: [ 1000, 0, - 500 ],
			originCoordinateRateMps: [ 0, 0, 0 ],
			angularRateOfWorldRelativeToPhysicsRadPerS: [ 0, 0, 0 ],
			originCoordinateAccelerationMps2: typedAbsence( 'unavailable', 'fixture-world-physics-adapter' ), angularAccelerationRadPerS2: typedAbsence( 'unavailable', 'fixture-world-physics-adapter' ),
			validityInterval: fixtureInterval( clocks, 'physics-fixed', 40, 45 ), error: fixtureError( 'metre', 1e-9, 'fixture-world-physics-adapter' )
		},
		worldTransformRevision: 'world-physics-transform-3',
		physicsFrameRegistry: {
			registryId: 'physics-frame-registry', owner: 'route-physics-coordinator', registryRevision: 'physics-frames-17', rootFrameId: 'physics-world-y-up',
			framesById: {
				'physics-world-y-up': fixtureFrame( clocks, { frameId: 'physics-world-y-up', parentFrameId: 'root', owner: 'route-physics-coordinator', transformRevision: 'physics-frame-transform-3', rotation: identity3, translation: [ 0, 0, 0 ], linearRate: [ 0, 0, 0 ], angularRate: [ 0, 0, 0 ], source: 'fixture-root-frame' } ),
				'body-frame-1': fixtureFrame( clocks, { frameId: 'body-frame-1', parentFrameId: 'physics-world-y-up', owner: '$threejs-procedural-motion-systems', transformRevision: 'body-frame-transform-8', rotation: identity3, translation: [ 2, 0.5, - 1 ], linearRate: [ 1, 0, 0 ], angularRate: [ 0, 0.3, 0 ], source: 'fixture-body-frame' } )
			},
			parentDagDigest: 'sha256:physics-frame-parent-dag-17'
		},
		chartRegistry: { registryId: 'physics-chart-registry', owner: 'route-physics-coordinator', registryRevision: 'physics-charts-17', chartsById: {}, anchorFrameRegistryRevision: 'physics-frames-17' },
		physicsClockRegistry: { registryId: 'physics-clock-registry', owner: 'route-physics-coordinator', registryRevision: 'physics-clocks-17', clocksById: Object.fromEntries( Object.values( clocks ).map( ( clock ) => [ clock.clockId, clock ] ) ), coordinationClockId: 'physics-fixed', mappingDagDigest: 'sha256:physics-clock-mapping-dag-17' },
		gravityProvider: { signalId: 'gravity-acceleration', descriptorStateVersion: 'gravity-42', schemaId: 'physics/gravity/v1', contextId: 'coastal-coupling-context', channelId: 'acceleration', quantityDimension: 'acceleration', unit: 'metre-per-second-squared', basisBehavior: 'polar-vector' },
		physicsOriginEpoch: 'physics-origin-17',
		idNamespaces: { registryId: 'physics-identity-registry', owner: 'route-physics-coordinator', registryRevision: 'physics-identities-17', namespacesByKind: Object.fromEntries( [ 'entity', 'provider', 'signal', 'collider', 'shape', 'support', 'feature', 'contactManifold', 'physicsMaterial', 'interaction', 'conservationGroup' ].map( ( kind, index ) => [ kind, { namespaceId: `${ kind }-namespace-v1`, owner: 'route-physics-coordinator', schemaId: `${ kind }-identity-schema-v1`, generationPolicy: 'monotonically-increment-on-reuse', allocationCursor: 42 + index, retiredGenerationDigest: `sha256:${ kind }-retired-generations-42` } ] ) ) },
		physicsMaterialRegistry: {
			registryId: 'physics-material-registry-1', owner: 'physics-material-owner', registryVersion: 'materials-v5',
			materials: {
				'water-material-1': { physicsMaterialId: 'water-material-1', recordVersion: 'water-material-record-v1', densityKgPerM3: evidence( 1025, 'kilogram-per-cubic-metre', 'Measured', 'fixture-seawater' ), contactLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), frictionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), restitutionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), complianceDampingLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), adhesionCohesionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), permeabilityPorosityLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), wettingContactAngleLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), dragRoughnessLaw: 'water-drag-law-v2', thermalConductivityWPerMK: typedAbsence( 'unsupported', 'physics-material-owner' ), specificHeatJPerKgK: typedAbsence( 'unsupported', 'physics-material-owner' ), emissivitySpectrum: typedAbsence( 'unsupported', 'physics-material-owner' ), phaseChangeLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), uncertainty: 'density-and-drag-error-map', provenance: 'fixture-water-material' },
				'hull-material-1': { physicsMaterialId: 'hull-material-1', recordVersion: 'hull-material-record-v1', densityKgPerM3: evidence( 600, 'kilogram-per-cubic-metre', 'Measured', 'fixture-hull' ), contactLaw: 'hull-contact-v3', frictionLaw: 'hull-friction-v2', restitutionLaw: 'hull-restitution-v1', complianceDampingLaw: 'hull-compliance-v1', adhesionCohesionLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), permeabilityPorosityLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), wettingContactAngleLaw: 'hull-wetting-v1', dragRoughnessLaw: 'hull-drag-v4', thermalConductivityWPerMK: typedAbsence( 'unsupported', 'physics-material-owner' ), specificHeatJPerKgK: typedAbsence( 'unsupported', 'physics-material-owner' ), emissivitySpectrum: typedAbsence( 'unsupported', 'physics-material-owner' ), phaseChangeLaw: typedAbsence( 'unsupported', 'physics-material-owner' ), uncertainty: 'hull-property-error-map', provenance: 'fixture-hull-material' }
			},
			materialStateDescriptors: [],
			pairLawResolver: { resolverId: 'ordered-pair-resolver', resolverVersion: 'v4', participantOrdering: 'ordered-A-B-with-contact-frame', explicitPairOverrides: { 'water-material-1|hull-material-1': 'water-hull-coupling-v2' }, perLawCompositionRules: 'no implicit scalar averaging', missingPairPolicy: 'block', deterministicSelectionDigestRule: 'sha256 over ordered IDs, record versions, and selected pair-law version' },
			renderBindings: typedAbsence( 'not-requested', 'physics-material-owner' )
		}
	};
	const fixedInterval = fixtureInterval( clocks, 'physics-fixed', 42, 43 );
	const adaptiveInterval = fixtureInterval( clocks, 'water-adaptive', 100, 103 );
	const eventInterval = fixtureInterval( clocks, 'contact-event', 7, 8 );
	route.physicsSignals = {
		gravity: fixturePhysicsSignal( { signalId: 'gravity-acceleration', providerId: 'environment-provider', schemaId: 'physics/gravity/v1', owner: 'environment-owner', consumers: [ '$threejs-water-optics', '$threejs-procedural-motion-systems' ], channels: [ { id: 'acceleration', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second-squared', basisBehavior: 'polar-vector', classification: 'intensive', errorBound: 1e-6 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'contact-event', cadenceKind: 'event-driven', cadenceParameters: { eventStream: 'gravity-change-events' }, sampleInterval: eventInterval, stateVersion: 'gravity-42', resourceGeneration: 'gravity-generation-4' } ),
		waterSurface: fixturePhysicsSignal( { signalId: 'water-surface-state', providerId: 'water-provider', schemaId: 'physics/water-surface/v1', owner: '$threejs-water-optics', consumers: [ '$threejs-procedural-motion-systems', 'route-physics-coordinator' ], channels: [ { id: 'freeSurfacePoint', valueType: 'Vec3', kind: 'point', unit: 'metre', basisBehavior: 'structured', classification: 'geometric', errorBound: 0.002 }, { id: 'materialCurrentVelocityMps', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'polar-vector', classification: 'intensive', errorBound: 0.01 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'water-adaptive', cadenceKind: 'adaptive', cadenceParameters: { errorController: 'CFL-and-truncation-v3' }, sampleInterval: adaptiveInterval, stateVersion: 'water-42', resourceGeneration: 'water-generation-42' } ),
		bodyState: fixturePhysicsSignal( { signalId: 'rigid-body-state', providerId: 'body-provider', schemaId: 'physics/rigid-body/v1', owner: '$threejs-procedural-motion-systems', consumers: [ '$threejs-water-optics', 'route-physics-coordinator' ], channels: [ { id: 'centerOfMassPositionMeters', valueType: 'Vec3', kind: 'point', unit: 'metre', basisBehavior: 'structured', classification: 'geometric', errorBound: 0.001 }, { id: 'linearVelocityMps', valueType: 'Vec3', kind: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'polar-vector', classification: 'intensive', errorBound: 0.005 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'physics-fixed', cadenceKind: 'fixed', cadenceParameters: { interval: fixtureDurationSeconds( 1 / 60 ) }, sampleInterval: fixedInterval, stateVersion: 'body-42', resourceGeneration: 'body-generation-42' } ),
		commitToken: fixturePhysicsSignal( { signalId: 'coupled-commit-token', providerId: 'route-physics-coordinator', schemaId: 'physics/commit-token/v1', owner: 'route-physics-coordinator', consumers: [ '$threejs-camera-controls-and-rigs', '$threejs-image-pipeline' ], channels: [ { id: 'commitEpoch', valueType: 'opaque-version', kind: 'scalar', unit: 'dimensionless', basisBehavior: 'scalar', classification: 'categorical', errorBound: 0 } ], physicsFrameId: 'physics-world-y-up', transformRevision: 'physics-frame-transform-3', clockId: 'physics-fixed', cadenceKind: 'event-driven', cadenceParameters: { eventStream: 'atomic-commit-events' }, sampleInterval: fixedInterval, stateVersion: 'commit-42', resourceGeneration: 'commit-token-generation-42' } )
	};
	attachCanonicalGraph( route, fixedInterval, adaptiveInterval, eventInterval );
	attachCanonicalExchange( route, fixedInterval );
	attachCanonicalPresentation( route, clocks );
	attachCanonicalCostLedger( route );
	route.physicsPresentationSnapshot = 'not used (deprecated compatibility projection)';
	return route;

}

function normalizeRouteToSingleFixedClock( route ) {

	const clocks = route.physicsContext.physicsClockRegistry.clocksById;
	const fixedClock = Object.values( clocks ).find( ( clock ) => clock.mappingKind === 'fixed-rational' );
	assert.ok( fixedClock, 'single-clock fixture source has no fixed-rational clock' );
	const fixedMapping = fixedClock.mapping.fixedRational;
	const epochCoordinate = instantCoordinate( { tick: fixedMapping.epochTick, rationalSubstep: fixedMapping.epochRationalSubstep }, 'singleClock.fixedMapping.epoch' );
	const epochSeconds = quantityValue( fixedMapping.epochSeconds, 'singleClock.fixedMapping.epochSeconds' );
	const secondsPerTick = rationalQuantityValue( fixedMapping.secondsPerTick, 'singleClock.fixedMapping.secondsPerTick' );
	route.physicsContext.physicsClockRegistry.clocksById = { [ fixedClock.clockId ]: fixedClock };
	route.physicsContext.physicsClockRegistry.coordinationClockId = fixedClock.clockId;
	const gcd = ( a, b ) => {

		while ( b !== 0 ) [ a, b ] = [ b, a % b ];
		return Math.abs( a );

	};
	const normalizeInstant = ( instant ) => {

		const seconds = quantityValue( instant.timeSecondsDerived, 'singleClock.timeSecondsDerived' );
		const coordinate = epochCoordinate + ( seconds - epochSeconds ) / secondsPerTick;
		let tick = Math.floor( coordinate );
		let denominator = 1_000_000_000_000;
		let numerator = Math.round( ( coordinate - tick ) * denominator );
		if ( numerator === denominator ) { tick ++; numerator = 0; }
		const divisor = numerator === 0 ? denominator : gcd( numerator, denominator );
		numerator /= divisor;
		denominator /= divisor;
		instant.clockId = fixedClock.clockId;
		instant.tick = tick;
		instant.rationalSubstep = { numerator, denominator };
		instant.clockMappingRevision = fixedClock.mappingRevision;
		instant.discontinuityEpoch = fixedClock.discontinuityEpoch;
		instant.timeSecondsDerived.value = epochSeconds + ( tick + numerator / denominator - epochCoordinate ) * secondsPerTick;

	};
	const visit = ( value, visited = new WeakSet() ) => {

		if ( value === null || typeof value !== 'object' || visited.has( value ) ) return;
		visited.add( value );
		if ( Array.isArray( value ) ) { for ( const entry of value ) visit( entry, visited ); return; }
		if ( Object.hasOwn( value, 'tick' ) && Object.hasOwn( value, 'rationalSubstep' ) && Object.hasOwn( value, 'timeSecondsDerived' ) ) normalizeInstant( value );
		if ( Object.hasOwn( value, 'clockId' ) && ! Object.hasOwn( value, 'mappingKind' ) ) value.clockId = fixedClock.clockId;
		if ( Object.hasOwn( value, 'sourceClockId' ) ) value.sourceClockId = fixedClock.clockId;
		if ( Object.hasOwn( value, 'measurementClockId' ) ) value.measurementClockId = fixedClock.clockId;
		if ( Object.hasOwn( value, 'presentationClockId' ) ) value.presentationClockId = fixedClock.clockId;
		if ( Object.hasOwn( value, 'debtClockId' ) ) value.debtClockId = fixedClock.clockId;
		if ( Object.hasOwn( value, 'intervalMappingRevision' ) ) value.intervalMappingRevision = fixedClock.mappingRevision;
		if ( Object.hasOwn( value, 'clockMapRevision' ) ) value.clockMapRevision = fixedClock.mappingRevision;
		if ( Object.hasOwn( value, 'coordinationClockMappingProof' ) ) value.coordinationClockMappingProof = 'identity fixed-clock mapping';
		for ( const child of Object.values( value ) ) visit( child, visited );

	};
	visit( route );
	for ( const pair of route.physicsPresentationCandidate.presentedStatePairs ) for ( const arm of [ pair.previousPresented, pair.currentPresented ] ) {

		const lower = quantityValue( arm.provenance.lowerBracket.sampleInstant.timeSecondsDerived, 'singleClock.lower' );
		const upper = quantityValue( arm.provenance.upperBracket.sampleInstant.timeSecondsDerived, 'singleClock.upper' );
		const mapped = quantityValue( arm.provenance.mappedSourceInstant.timeSecondsDerived, 'singleClock.mapped' );
		arm.provenance.interpolation.alpha.value = ( mapped - lower ) / ( upper - lower );

	}
	return fixedClock;

}

function makeSingleViewNonWaterPhysicalRouteFixture( canonicalRoute ) {

	const route = clone( canonicalRoute );
	route.workloadProfile.domain = 'scientific-visualization';
	route.causeLedger.sourceOfTruth = 'versioned inertial field state';
	route.causeLedger.primaryObservable = 'one-view committed field state';
	route.causeLedger.selectedAlgorithm = 'single-rate exact transactional field advance';
	route.causeLedger.noPostBaseline = 'the committed inertial field remains legible without post-processing';
	route.selectedSkills = [ '$threejs-camera-controls-and-rigs', '$threejs-image-pipeline', '$threejs-visual-validation' ];
	route.primaryOwner = 'environment-owner';
	route.owners.sourceOfTruth = 'versioned inertial field state';
	route.owners.representation = 'environment-owner';
	route.owners.timebase = 'environment-owner';
	route.physicsExternalSolverAdaptersById = {};
	route.physicsQualityRequests = {};
	route.physicsQualityStates = {};
	route.physicsQualityTransitions = [];
	route.physicsErrorPropagationLedgers = {};
	route.physicsInteractions = [];
	route.physicsInteractionApplicationLedgers = {};

	const fixedClock = normalizeRouteToSingleFixedClock( route );
	const context = route.physicsContext;
	const gravitySignal = route.physicsSignals.gravity;
	route.physicsSignals = { gravity: gravitySignal };
	gravitySignal.consumers = [ 'route-physics-coordinator' ];
	gravitySignal.clockId = fixedClock.clockId;
	gravitySignal.samplePhase = 'interval-end';
	gravitySignal.stateVersion = 'gravity-42';
	context.physicsMaterialRegistry.materials = {
		'inertial-probe-material': {
			...clone( context.physicsMaterialRegistry.materials[ 'hull-material-1' ] ),
			physicsMaterialId: 'inertial-probe-material', recordVersion: 'inertial-probe-material-v1', provenance: 'single-view inertial fixture'
		}
	};
	context.contextVersion = 'context-17-single-field';
	context.physicsMaterialRegistry.pairLawResolver.explicitPairOverrides = {};
	context.physicsMaterialRegistry.materialStateDescriptors = [];
	context.physicsFrameRegistry.framesById = { [ context.physicsRootFrameId ]: context.physicsFrameRegistry.framesById[ context.physicsRootFrameId ] };
	context.chartRegistry.chartsById = {};
	context.chartRegistry.registryRevision = 'physics-charts-17-empty';
	for ( const pass of route.performanceContract.passLedger ) {

		if ( pass.accountingOwner === '$threejs-water-optics' ) pass.accountingOwner = 'environment-owner';
		if ( pass.producer === '$threejs-water-optics' ) pass.producer = 'environment-owner';

	}

	const graph = route.physicsGraph;
	const stage = graph.stages.find( ( candidate ) => candidate.stageId === 'ingest-gravity' );
	const execution = graph.executionLedger.stageExecutions.find( ( candidate ) => candidate.stageId === stage.stageId );
	const claim = graph.executionLedger.stateAdvanceClaims.find( ( candidate ) => candidate.claimId === 'gravity-advance-claim-42' );
	const group = graph.commitGroups.find( ( candidate ) => candidate.commitGroupId === 'forcing-commit' );
	const transaction = graph.commitTransactions[ 0 ];
	transaction.commitGroupIds = [ group.commitGroupId ];
	transaction.preparedPublicationIds = group.preparedPublications.map( ( publication ) => publication.preparedPublicationId );
	transaction.priorCommittedVersions = transaction.priorCommittedVersions.filter( ( version ) => version.signalId === gravitySignal.signalId );
	transaction.receipt.preparedToCommittedPublicationMap = transaction.receipt.preparedToCommittedPublicationMap.filter( ( row ) => row.preparedVersion.signalId === gravitySignal.signalId );
	transaction.receipt.committedPublications = transaction.receipt.committedPublications.filter( ( row ) => row.signalId === gravitySignal.signalId );
	transaction.receipt.priorToCommittedVersionMap = transaction.receipt.priorToCommittedVersionMap.filter( ( row ) => row.committedVersion.signalId === gravitySignal.signalId );
	transaction.receipt.dependencyCompletionRefs = [];
	transaction.receipt.conservationAndErrorGateResults = [ { gate: 'gravity-error', status: 'accepted' } ];
	transaction.publicationSetDigest = sha256Canonical( transaction.receipt.committedPublications );
	transaction.receipt.publicationSetDigest = transaction.publicationSetDigest;
	transaction.receipt.receiptDigest = sha256CanonicalExcluding( transaction.receipt, [ 'receiptDigest' ] );
	graph.stages = [ stage ];
	graph.edges = [];
	graph.dependencies = [];
	graph.loopMacros = [];
	graph.commitGroups = [ group ];
	graph.commitTransactions = [ transaction ];
	graph.originRebaseTransactions = [];
	execution.couplingLoopId = typedAbsence( 'not-applicable', stage.owner, 'timeless', 'single-rate route has no coupling loop' );
	execution.iterationIndex = typedAbsence( 'not-applicable', stage.owner, 'timeless', 'single-rate route has no coupling iteration' );
	execution.interactionApplicationLedgerIds = [];
	execution.dependencyCompletions = [];
	claim.nativeExecutionIds = [ execution.executionId ];
	claim.interactionApplicationLedgerIds = [];
	graph.executionLedger.stageExecutions = [ execution ];
	graph.executionLedger.dependencyCompletions = [];
	graph.executionLedger.stateAdvanceClaims = [ claim ];
	graph.executionLedger.interactionApplicationLedgers = [];
	graph.executionLedger.loopResults = [];
	graph.executionLedger.commitReceipts = [ transaction.receipt ];
	graph.executionLedger.physicsCostLedgerId = 'generic-cost-ledger-1';
	graph.coordinationAdvance.stageExecutionIds = [ execution.executionId ];
	graph.coordinationAdvance.stateAdvanceClaimIds = [ claim.claimId ];
	graph.coordinationAdvance.commitTransactionIds = [ transaction.commitTransactionId ];
	graph.coordinationAdvance.receiptDigest = sha256CanonicalExcluding( graph.coordinationAdvance, [ 'receiptDigest' ] );
	route.physicsCoordinationAdvanceRecords = [ clone( graph.coordinationAdvance ) ];
	route.physicsCommitTransactions = { [ transaction.commitTransactionId ]: clone( transaction ) };

	const keepView = 'main/main-view';
	for ( const inventory of [ route.physicsCameraViewPublicationsByTarget, route.physicsViewPreparationPublicationsByTarget, route.physicsPresentationSnapshotsByTarget, route.physicsPresentationRenderPlansByTarget ] ) for ( const key of Object.keys( inventory ) ) if ( key !== keepView ) delete inventory[ key ];
	const candidate = route.physicsPresentationCandidate;
	candidate.commitProvenance.committedStateVersions = transaction.receipt.committedPublications.map( ( row ) => clone( row ) );
	candidate.commitProvenance.commitReceiptIdsAndDigests = [ { receiptId: transaction.receipt.receiptId, receiptDigest: transaction.receipt.receiptDigest } ];
	candidate.commitProvenance.closedPublicationSetDigest = transaction.publicationSetDigest;
	candidate.eventSequenceRanges = [];
	const rewriteStrings = ( value, replacements, visited = new WeakSet() ) => {

		if ( typeof value === 'string' ) {

			for ( const [ source, destination ] of replacements ) value = value.replaceAll( source, destination );
			return value;

		}
		if ( value === null || typeof value !== 'object' || visited.has( value ) ) return value;
		visited.add( value );
		if ( Array.isArray( value ) ) {

			for ( let index = 0; index < value.length; index ++ ) value[ index ] = rewriteStrings( value[ index ], replacements, visited );
			return value;

		}
		for ( const key of Object.keys( value ) ) {

			const rewrittenKey = rewriteStrings( key, replacements );
			const rewrittenValue = rewriteStrings( value[ key ], replacements, visited );
			if ( rewrittenKey !== key ) delete value[ key ];
			value[ rewrittenKey ] = rewrittenValue;

		}
		return value;

	};
	const retargetLease = ( lease, suffix ) => {

		const retargeted = rewriteStrings( clone( lease ), [ [ `water-${ suffix }`, `gravity-${ suffix }` ], [ 'water', 'gravity' ] ] );
		retargeted.owner = 'environment-owner';
		return retargeted;

	};
	const gravityPreviousLease = retargetLease( candidate.resourceLeases.find( ( lease ) => lease.leaseId === 'water-previous' ), 'previous' );
	const gravityCurrentLease = retargetLease( candidate.resourceLeases.find( ( lease ) => lease.leaseId === 'water-current' ), 'current' );
	candidate.resourceLeases = [ gravityPreviousLease, gravityCurrentLease ];
	const gravityPair = rewriteStrings( clone( candidate.presentedStatePairs.find( ( pair ) => pair.bindingId === 'water-binding' ) ), [ [ 'water', 'gravity' ] ] );
	gravityPair.bindingId = 'gravity-binding';
	gravityPair.entityId = 'inertial-field#1';
	gravityPair.providerId = gravitySignal.providerId;
	gravityPair.signalId = gravitySignal.signalId;
	gravityPair.previousPresented.globalBinding.bindingPayload = 'inertial-field-layout-v1';
	gravityPair.currentPresented.globalBinding.bindingPayload = 'inertial-field-layout-v1';
	gravityPair.motionBinding.identitySlotMap = 'inertial-field-map-v1';
	candidate.presentedStatePairs = [ gravityPair ];
	const preparation = route.physicsViewPreparationPublicationsByTarget[ keepView ];
	rewriteStrings( preparation, [ [ 'water', 'gravity' ], [ 'body', 'probe' ] ] );
	const presentationLeaseRef = ( lease ) => ( {
		leaseId: lease.leaseId,
		deviceId: lease.deviceId,
		deviceLossGeneration: lease.deviceLossGeneration,
		resourceGeneration: lease.resourceGeneration,
		layoutRevision: lease.layoutRevision,
		subresourceOrCpuSlice: `${ lease.leaseId }:all`
	} );
	preparation.resourceLeaseRefs = [ presentationLeaseRef( gravityCurrentLease ), presentationLeaseRef( preparation.resourceLeases[ 0 ] ) ];
	preparation.shadowViewPublicationRefs[ 0 ].shadowFactorProvenance.receiverStateVersions = [ gravitySignal.stateVersion ];
	preparation.reactivePublications[ 0 ].sourceId = gravitySignal.signalId;
	preparation.reactivePublications[ 0 ].sourceVersion = gravitySignal.stateVersion;
	preparation.requiredPreparationEdges[ 0 ].requiredContentIdAndVersion = { sourceId: gravitySignal.signalId, sourceVersion: gravitySignal.stateVersion };
	const snapshot = route.physicsPresentationSnapshotsByTarget[ keepView ];
	rewriteStrings( snapshot, [ [ 'water', 'gravity' ], [ 'body', 'probe' ] ] );
	snapshot.presentedStatePairRefs = [ gravityPair.bindingId ];
	snapshot.eventSequenceRanges = [];
	const viewLeaseId = preparation.resourceLeases[ 0 ].leaseId;
	const pairStateHandleLeaseIds = [ gravityPreviousLease.leaseId, gravityCurrentLease.leaseId ].sort();
	const exactRequiredLeaseIds = [ ...pairStateHandleLeaseIds, viewLeaseId ].sort();
	snapshot.resourceLeaseRefs = exactRequiredLeaseIds.map( ( leaseId ) => presentationLeaseRef( [ gravityPreviousLease, gravityCurrentLease, ...preparation.resourceLeases ].find( ( lease ) => lease.leaseId === leaseId ) ) );
	snapshot.closureManifest.pairStateHandleLeaseIds = pairStateHandleLeaseIds;
	snapshot.closureManifest.preparationDependencyLeaseIds = [ viewLeaseId ];
	snapshot.closureManifest.reactiveAndResetLeaseIds = [ viewLeaseId ];
	snapshot.closureManifest.shadowCacheVisibilityLeaseIds = [ viewLeaseId ];
	snapshot.closureManifest.exactRequiredLeaseIds = exactRequiredLeaseIds;
	snapshot.closureManifest.exactEventRangeIds = [];
	snapshot.closureManifest.dependencyDagDigest = dependencyDagDigest( preparation );
	snapshot.closureManifest.closureDigest = closureManifestDigest( snapshot.closureManifest );
	const plan = route.physicsPresentationRenderPlansByTarget[ keepView ];
	rewriteStrings( plan, [ [ 'water', 'gravity' ], [ 'body', 'probe' ] ] );
	plan.closureDigest = snapshot.closureManifest.closureDigest;
	plan.immutablePlanDigest = renderPlanDigest( plan );
	const refreshJoin = ( lease ) => {

		const join = lease.reuseProhibitedUntil;
		join.presentationConsumers = join.presentationConsumers.filter( ( token ) => `${ token.presentationTargetId }/${ token.viewId }` === keepView );
		join.couplingConsumers = [];
		join.requiredConsumerKeys = [ ...join.simulationConsumers, ...join.externalConsumers, ...join.presentationConsumers ].map( ( token ) => token.consumerKey ).sort();
		join.joinDigest = completionJoinDigest( join );

	};
	const activeLeases = [ ...candidate.resourceLeases, ...route.physicsViewPreparationPublicationsByTarget[ keepView ].resourceLeases ];
	for ( const lease of activeLeases ) refreshJoin( lease );
	const activeLeasesById = new Map( activeLeases.map( ( lease ) => [ lease.leaseId, lease ] ) );
	const frame = route.frameExecutionRecord;
	frame.requiredTargetViewKeys = [ keepView ];
	frame.snapshotIds = [ snapshot.snapshotId ];
	frame.renderPlans = [ clone( plan ) ];
	frame.slotAdmissions = frame.slotAdmissions.filter( ( admission ) => `${ admission.presentationTargetId }/${ admission.viewId }` === keepView );
	frame.targetExecutions = { [ keepView ]: frame.targetExecutions[ keepView ] };
	rewriteStrings( frame.targetExecutions[ keepView ], [ [ 'water', 'gravity' ], [ 'body', 'probe' ] ] );
	frame.targetExecutions[ keepView ].submittedPasses = plan.phaseRecords.map( ( phaseRecord ) => phaseRecord.passOrDispatchKey );
	frame.targetExecutions[ keepView ].actionResults = [ { status: 'all-plan-phases-completed', phaseIds: [ ...plan.phaseIds ] } ];
	frame.targetExecutions[ keepView ].resetActionResults = clone( preparation.resetActionResults );
	frame.cohortAdmission.requiredTargetViewKeys = [ keepView ];
	frame.cohortAdmission.snapshotIds = [ snapshot.snapshotId ];
	frame.cohortAdmission.renderPlanIds = [ plan.renderPlanId ];
	for ( const mapKey of [ 'configuredMaximumFramesInFlightByTarget', 'observedFramesInFlightByTarget', 'saturationPolicyByTarget' ] ) frame.cohortAdmission[ mapKey ] = { [ keepView ]: frame.cohortAdmission[ mapKey ][ keepView ] };
	frame.targetExecutions[ keepView ].completionTokens = activeLeases.map( ( lease ) => lease.reuseProhibitedUntil.presentationConsumers[ 0 ] ).filter( Boolean ).map( clone );
	frame.leaseDispositionById = Object.fromEntries( activeLeases.map( ( lease ) => [ lease.leaseId, {
		disposition: 'retained-until-join', consumingSnapshotIds: [ snapshot.snapshotId ], completionJoin: clone( lease.reuseProhibitedUntil ),
		retirementEvidence: { joinId: lease.reuseProhibitedUntil.joinId, joinDigest: lease.reuseProhibitedUntil.joinDigest, completedConsumerKeys: [ ...lease.reuseProhibitedUntil.requiredConsumerKeys ], cancelledConsumerKeys: [], joinResolution: 'completed-or-reservation-cancelled', status: 'all required consumers completed' }
	} ] ) );

	const ledger = route.physicsCostLedger;
	ledger.ledgerId = 'generic-cost-ledger-1';
	ledger.graphRevision = graph.executionLedger.graphRevision;
	ledger.presentationTargetsAndViews = [ keepView ];
	ledger.measurementProtocolRefs = [ ledger.cadenceTraceTotals.traceRef ];
	ledger.harness.target.deviceId = 'single-view-generic-WebGPU-trace';
	ledger.qualityState = 'fixed-quality';
	const exactIntervals = quantityValue( ledger.cadenceTraceTotals.coordinationAdvanceCount, 'singleView.exactIntervals' );
	const keepStageId = stage.stageId;
	const retainStageKey = ( mapping ) => ( { [ keepStageId ]: mapping[ keepStageId ] } );
	ledger.graphStageCosts = ledger.graphStageCosts.filter( ( cost ) => cost.stageId === keepStageId );
	ledger.stageExecutionsPerCoordinationInterval = retainStageKey( ledger.stageExecutionsPerCoordinationInterval );
	ledger.stageExecutionsPerSecond = retainStageKey( ledger.stageExecutionsPerSecond );
	ledger.executionsPerPresentedFrame = retainStageKey( ledger.executionsPerPresentedFrame );
	ledger.hotBytesReadWrittenPerExecution = retainStageKey( ledger.hotBytesReadWrittenPerExecution );
	ledger.solverDispatches = ledger.solverDispatches.filter( ( dispatch ) => dispatch.stageId === keepStageId );
	ledger.cadenceTraceTotals.stageExecutionCounts = retainStageKey( ledger.cadenceTraceTotals.stageExecutionCounts );
	ledger.cadenceTraceTotals.nativeSubcycleCounts = {};
	ledger.cadenceTraceTotals.couplingIterationCounts = {};
	ledger.cadenceTraceTotals.interactionApplicationCounts = {};
	ledger.cadenceTraceTotals.presentedFrameCounts = { [ keepView ]: ledger.cadenceTraceTotals.presentedFrameCounts[ keepView ] };
	delete ledger.perViewWorkKeys[ 'minimap/map-view' ];
	const declaredWorkKeys = new Set( [ ...ledger.sharedWorkKeys, ...ledger.perViewWorkKeys[ keepView ] ] );
	ledger.workAttribution = ledger.workAttribution.filter( ( row ) => declaredWorkKeys.has( row.workKey ) );
	const sharedAttribution = ledger.workAttribution.find( ( row ) => ledger.sharedWorkKeys.includes( row.workKey ) );
	sharedAttribution.stageExecutionPassOrDispatchIds = [ execution.executionId ];
	sharedAttribution.targetViewKeys = [ keepView ];
	sharedAttribution.occurrenceCount.value = exactIntervals;
	ledger.cadenceTraceTotals.workOccurrenceCounts = Object.fromEntries( Object.entries( ledger.cadenceTraceTotals.workOccurrenceCounts ).filter( ( [ key ] ) => declaredWorkKeys.has( key ) ) );
	ledger.cadenceTraceTotals.workOccurrenceCounts[ sharedAttribution.workKey ].value = exactIntervals;
	ledger.uploadsCopiesMaps = ledger.uploadsCopiesMaps.filter( ( traffic ) => traffic.producer !== 'route-physics-coordinator' || traffic.trafficRecordId === 'traffic-descriptor-upload' ).filter( ( traffic ) => traffic.cadenceBasis !== 'per-stage-execution' || traffic.producer === keepStageId );
	for ( const traffic of ledger.uploadsCopiesMaps ) traffic.targetViewKeys = [ keepView ];
	const trafficIds = new Set( ledger.uploadsCopiesMaps.map( ( traffic ) => traffic.trafficRecordId ) );
	ledger.cadenceTraceTotals.trafficOccurrenceAndLogicalByteTotals = Object.fromEntries( Object.entries( ledger.cadenceTraceTotals.trafficOccurrenceAndLogicalByteTotals ).filter( ( [ id ] ) => trafficIds.has( id ) ) );
	sharedAttribution.trafficRecordIds = [ ...trafficIds ];
	for ( const memoryKey of [ 'hotState', 'peakTransient', 'migrationOverlap' ] ) {

		const memory = ledger[ memoryKey ];
		memory.perViewBytesByTargetView = { [ keepView ]: memory.perViewBytesByTargetView[ keepView ] };
		for ( const allocation of memory.allocations ) allocation.targetViewKeys = [ keepView ];

	}
	ledger.multiviewAndFramesInFlightMultipliers.viewCount.value = 1;
	ledger.subcyclesAndCouplingIterationsPerPresentedFrame = {};
	ledger.dependencyCriticalPaths[ 0 ].path = 'field-advance-to-atomic-commit';
	rewriteStrings( ledger, [ [ '$threejs-water-optics', 'environment-owner' ], [ 'water', 'gravity' ], [ 'body', 'probe' ] ] );
	const totalsDigestPayload = clone( ledger.cadenceTraceTotals );
	delete totalsDigestPayload.exactTotalsDigest;
	ledger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( totalsDigestPayload );
	const coupledResidue = [];
	const collectCoupledResidue = ( value, path = '$', visited = new WeakSet() ) => {

		if ( typeof value === 'string' ) {

			if ( /water|body-water|rigid-body-state|\$threejs-water-optics/i.test( value ) ) coupledResidue.push( `${ path }=${ value }` );
			return;

		}
		if ( value === null || typeof value !== 'object' || visited.has( value ) ) return;
		visited.add( value );
		if ( Array.isArray( value ) ) for ( let index = 0; index < value.length; index ++ ) collectCoupledResidue( value[ index ], `${ path }[${ index }]`, visited );
		else for ( const [ key, child ] of Object.entries( value ) ) {

			if ( /water|body-water|rigid-body-state|\$threejs-water-optics/i.test( key ) ) coupledResidue.push( `${ path }.<key:${ key }>` );
			collectCoupledResidue( child, `${ path }.${ key }`, visited );

		}

	};
	collectCoupledResidue( route );
	assert.deepEqual( coupledResidue, [], 'single-view non-water fixture retains coupled water or rigid-body route state' );
	assert.equal( activeLeasesById.size, Object.keys( frame.leaseDispositionById ).length, 'single-view fixture lease pruning failed' );
	return route;

}

function makeOneToOnePhysicalExchangeRouteFixture( canonicalRoute ) {

	const route = clone( canonicalRoute );
	route.causeLedger.selectedAlgorithm = 'multi-rate bounded coupling with one source and one equal-and-opposite reaction';
	route.causeLedger.primaryObservable = 'one-to-one water-body momentum closes across one atomic commit';
	const exchange = route.physicsInteractions[ 0 ];
	const source = exchange.interactions[ 0 ];
	const reaction = exchange.reactions[ 0 ];
	exchange.interactions = [ source ];
	exchange.reactions = [ reaction ];
	exchange.physicalImpactParents = [];
	exchange.physicalImpactPartitions = [];
	for ( const record of [ source, reaction ] ) record.partitionMembership = typedAbsence( 'not-applicable', 'distributed-coupler', 'timeless', 'one-to-one exchange does not allocate a spatial partition family' );
	const negateWithoutNegativeZero = ( component ) => component === 0 ? 0 : - component;
	reaction.payload.linearMomentumNs = source.payload.linearMomentumNs.map( negateWithoutNegativeZero );
	reaction.payload.angularMomentumNms = source.payload.angularMomentumNms.map( negateWithoutNegativeZero );
	reaction.reactionToInteractionIds = [ source.interactionId ];
	reaction.provenance.producerSequence = source.provenance.producerSequence + 1;
	reaction.exactOnceKey = `${ canonicalIntervalIdentity( reaction.applicationInterval ) }|stage=${ reaction.provenance.stageId }|producer=${ reaction.provenance.producerId }|sequence=${ reaction.provenance.producerSequence }|interaction=${ reaction.interactionId }`;
	reaction.applicationLedgerKey = `apply|${ reaction.exactOnceKey }`;
	const reactionGroup = exchange.reactionGroups[ 0 ];
	reactionGroup.sourceInteractionIds = [ source.interactionId ];
	reactionGroup.reactionInteractionIds = [ reaction.interactionId ];
	const conservation = exchange.conservationGroups[ 0 ];
	conservation.modeledInternalTransfers.byInteractionId = Object.fromEntries( [ source, reaction ].map( ( record ) => [ record.interactionId, {
		linearMomentumNs: clone( record.payload.linearMomentumNs ),
		angularMomentumNms: clone( record.payload.angularMomentumNms ),
		energyJ: evidence( 0, 'joule', 'Derived', 'one-to-one momentum-only transfer' )
	} ] ) );
	const firstSequence = source.provenance.producerSequence;
	const lastSequence = reaction.provenance.producerSequence;
	exchange.batchLedger.publishedSequenceRange = { firstSequence, lastSequence };
	for ( const loop of route.physicsGraph.loopMacros.filter( ( candidate ) => candidate.loopId === exchange.couplingLoopId ) ) for ( const row of loop.perIterationLedger ) row.interactionSequenceRanges = [ { firstSequence, lastSequenceInclusive: lastSequence } ];
	for ( const consumerId of Object.keys( exchange.batchLedger.perConsumerCursor ) ) exchange.batchLedger.perConsumerCursor[ consumerId ] = lastSequence + 1;
	exchange.batchLedger.acceptedRejectedLateDuplicate.accepted.value = 2;
	const retainedInteractionIds = new Set( [ source.interactionId, reaction.interactionId ] );
	const applicationLedgers = route.physicsGraph.executionLedger.interactionApplicationLedgers.filter( ( ledger ) => retainedInteractionIds.has( ledger.interactionId ) );
	const recordById = new Map( [ source, reaction ].map( ( record ) => [ record.interactionId, record ] ) );
	for ( const ledger of applicationLedgers ) {

		const record = recordById.get( ledger.interactionId );
		ledger.exactOnceKey = record.exactOnceKey;
		ledger.appliedPayloadAmount = Object.fromEntries( Object.entries( record.payload ).filter( ( [ key ] ) => ! [ 'tag', 'timeSemantics' ].includes( key ) ) );
		ledger.cursorBefore = record.provenance.producerSequence;
		ledger.cursorAfter = ledger.cursorBefore + 1;
		ledger.applicationContentDigest = sha256Canonical( interactionApplicationContentDigestPayload( ledger ) );
		ledger.receiptDigest = sha256Canonical( interactionApplicationReceiptDigestPayload( ledger ) );

	}
	const retainedApplicationIds = new Set( applicationLedgers.map( ( ledger ) => ledger.applicationLedgerId ) );
	exchange.batchLedger.applicationLedgerIds = [ ...retainedApplicationIds ];
	route.physicsGraph.executionLedger.interactionApplicationLedgers = applicationLedgers;
	route.physicsInteractionApplicationLedgers = Object.fromEntries( applicationLedgers.map( ( ledger ) => [ ledger.applicationLedgerId, clone( ledger ) ] ) );
	for ( const execution of route.physicsGraph.executionLedger.stageExecutions ) execution.interactionApplicationLedgerIds = execution.interactionApplicationLedgerIds.filter( ( id ) => retainedApplicationIds.has( id ) );
	for ( const claim of route.physicsGraph.executionLedger.stateAdvanceClaims ) claim.interactionApplicationLedgerIds = claim.interactionApplicationLedgerIds.filter( ( id ) => retainedApplicationIds.has( id ) );
	for ( const loop of route.physicsGraph.loopMacros ) for ( const row of loop.perIterationLedger ) row.interactionApplicationLedgerIds = row.interactionApplicationLedgerIds.filter( ( id ) => retainedApplicationIds.has( id ) );
	const exactIntervals = quantityValue( route.physicsCostLedger.cadenceTraceTotals.coordinationAdvanceCount, 'oneToOne.coordinationAdvanceCount' );
	route.physicsCostLedger.cadenceTraceTotals.interactionApplicationCounts = { momentumTransfer: evidence( 2 * exactIntervals, 'application', 'Measured', 'one-to-one exact application trace' ) };
	const totalsDigestPayload = clone( route.physicsCostLedger.cadenceTraceTotals );
	delete totalsDigestPayload.exactTotalsDigest;
	route.physicsCostLedger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( totalsDigestPayload );
	const candidateRange = route.physicsPresentationCandidate.eventSequenceRanges.find( ( range ) => range.streamId === exchange.exchangeId );
	if ( candidateRange ) {

		candidateRange.lastSequenceInclusive = lastSequence;
		candidateRange.cursorAfter = lastSequence + 1;
		candidateRange.payloadDigest = authoritativePresentationEventPayloadDigest( exchange );
		for ( const snapshot of Object.values( route.physicsPresentationSnapshotsByTarget ) ) snapshot.eventSequenceRanges = snapshot.eventSequenceRanges.map( ( range ) => range.rangeId === candidateRange.rangeId ? clone( candidateRange ) : range );

	}
	return route;

}

function makeCatchUpPhysicalRouteFixture( sourceRoute ) {

	const route = clone( sourceRoute );
	const graph = route.physicsGraph;
	const advance = graph.coordinationAdvance;
	const catchUpBatchId = 'generic-catch-up-batch-1';
	advance.catchUpBatchId = catchUpBatchId;
	advance.receiptDigest = sha256CanonicalExcluding( advance, [ 'receiptDigest' ] );
	route.physicsCoordinationAdvanceRecords = [ clone( advance ) ];
	const advanceBounds = intervalBoundsSeconds( advance.interval, route.physicsContext, 'genericCatchUp.advance.interval' );
	const committedSeconds = advanceBounds[ 1 ] - advanceBounds[ 0 ];
	const debtBeforeSeconds = canonicalDurationSecondsValue( advance.debtBefore, route.physicsContext, 'genericCatchUp.advance.debtBefore' );
	const elapsedSeconds = committedSeconds - debtBeforeSeconds;
	assert.ok( elapsedSeconds >= 0, 'generic catch-up fixture cannot close nonnegative elapsed time' );
	graph.catchUpBatch = {
		catchUpBatchId,
		graphId: graph.graphId,
		contextId: route.physicsContext.contextId,
		owner: graph.catchUpPolicy.owner,
		debtIdentity: {
			debtIdentityId: 'generic-catch-up-debt-1', graphId: graph.graphId, debtClockId: graph.catchUpPolicy.debtClockId,
			sourceCursorBeforeAfter: { before: 42, after: 43 }, presentationOpportunitySequence: 42,
			observedAt: clone( advance.interval.start ), policyRevision: 'generic-catch-up-policy-v1'
		},
		debtBefore: clone( advance.debtBefore ), elapsedDuringBatch: fixtureDurationSeconds( elapsedSeconds, 'generic-catch-up-fixture' ),
		admittedAdvanceIntervals: [ clone( advance.interval ) ], coordinationAdvanceIds: [ advance.coordinationAdvanceId ],
		committedAdvanceDuration: fixtureDurationSeconds( committedSeconds, 'generic-catch-up-fixture' ), explicitlyDroppedDuration: fixtureDurationSeconds( 0, 'generic-catch-up-fixture' ), debtAfter: clone( advance.debtAfter ),
		lossLedger: typedAbsence( 'not-applicable', graph.catchUpPolicy.owner, 'timeless', 'generic catch-up fixture drops no interval' ),
		policyRevision: 'generic-catch-up-policy-v1', errorResourceAndExecutionGateResults: [ { gate: 'latency', status: 'accepted' } ], status: 'completed', receiptDigest: 'pending'
	};
	graph.catchUpBatch.receiptDigest = sha256CanonicalExcluding( graph.catchUpBatch, [ 'receiptDigest' ] );
	route.physicsCostLedger.cadenceTraceTotals.catchUpBatchCount.value = 1;
	const totalsDigestPayload = clone( route.physicsCostLedger.cadenceTraceTotals );
	delete totalsDigestPayload.exactTotalsDigest;
	route.physicsCostLedger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( totalsDigestPayload );
	return route;

}

const skill = await readText( 'SKILL.md' );
const recipes = await readText( 'references/router-recipes.md' );
const template = await readText( 'examples/router-preflight-template.md' );
physicsAbiSchema = JSON.parse( await readText( 'references/physics-domain-and-interaction-contract.schema.json' ) );
assert.equal( physicsAbiSchema.$id, 'threejs-physics-domain-and-interaction-abi/v1', 'unexpected physics ABI schema revision' );
assertSupportedSchemaVocabulary( physicsAbiSchema );
const abiVocabularyCoverage = validateAbiVocabularyCoverage();
const canonicalAbsenceFixture = typedAbsence( 'unavailable', 'fixture-owner', 'timeless', 'typed-absence coverage' );
assert.ok( isTypedAbsence( canonicalAbsenceFixture ), 'canonical TypedAbsence fixture is rejected' );
for ( const [ label, mutation ] of [
	[ 'bare sentinel', 'typed-absence' ],
	[ 'null', null ],
	[ 'empty mapping', {} ],
	[ 'invalid reason', { ...canonicalAbsenceFixture, reason: 'not-presented' } ],
	[ 'blank authority', { ...canonicalAbsenceFixture, authority: '' } ],
	[ 'wrong schema', { ...canonicalAbsenceFixture, schemaId: 'typed-absence-v0' } ],
	[ 'invalid effective time', { ...canonicalAbsenceFixture, effectiveTime: 'sometime' } ],
	[ 'extra field', { ...canonicalAbsenceFixture, sentinel: 0 } ]
] ) assert.ok( ! isTypedAbsence( mutation ), `TypedAbsence accepts ${ label }` );
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

if ( process.env.ROUTER_RECIPE_ONLY === '1' ) {

	for ( const recipeName of recipeNames ) assertRecipeManifest( recipes, recipeName );
	console.log( JSON.stringify( { pass: true, profile: 'recipe-only', recipeCount: recipeNames.length }, null, 2 ) );
	process.exit( 0 );

}

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

const fixtureModuleHelpers = Object.freeze( {
	assert,
	clone,
	typedAbsence,
	isTypedAbsence,
	evidence,
	fixtureDurationSeconds,
	fixtureError,
	fixtureInstant,
	fixtureInterval,
	requireAbiRecord,
	sha256Canonical
} );

function structuredRecordCandidates( rootsByKey ) {

	const records = [];
	for ( const [ rootKey, root ] of Object.entries( rootsByKey ) ) {

		const visited = new WeakSet();
		const visit = ( value, path ) => {

			if ( value === null || typeof value !== 'object' || visited.has( value ) ) return;
			visited.add( value );
			if ( Array.isArray( value ) ) {

				for ( const [ index, entry ] of value.entries() ) visit( entry, [ ...path, index ] );
				return;

			}
			if ( ! isPlainObject( value ) ) return;
			records.push( { path, rootKey, value } );
			for ( const [ key, child ] of Object.entries( value ) ) visit( child, [ ...path, key ] );

		};
		visit( root, [] );

	}
	return records;

}

function buildSemanticSubjectBindings( rootsByKey ) {

	const subjectNames = [ ...new Set( physicsAbiSchema[ 'x-semantic-invariants' ].flatMap( ( invariant ) => invariant.appliesTo ) ) ];
	const rootOrder = Object.keys( rootsByKey );
	const candidates = structuredRecordCandidates( rootsByKey );
	const candidatesByKey = new Map();
	for ( const candidate of candidates ) for ( const key of Object.keys( candidate.value ) ) {

		if ( ! candidatesByKey.has( key ) ) candidatesByKey.set( key, [] );
		candidatesByKey.get( key ).push( candidate );

	}
	const bindings = {};
	const missing = [];
	for ( const recordName of subjectNames ) {

		const definition = physicsAbiSchema.$defs[ recordName ];
		assert.ok( isPlainObject( definition ), `physics ABI schema missing semantic subject record ${ recordName}` );
		const required = definition.required ?? [];
		const exactKeys = Object.keys( definition.properties ?? {} ).sort();
		const pool = required.length === 0 ? candidates : required.map( ( key ) => candidatesByKey.get( key ) ?? [] ).sort( ( a, b ) => a.length - b.length )[ 0 ];
		const matches = pool.filter( ( candidate ) => {

			if ( ! required.every( ( key ) => Object.hasOwn( candidate.value, key ) ) ) return false;
			if ( definition.additionalProperties === false ) {

				const candidateKeys = Object.keys( candidate.value ).sort();
				if ( candidateKeys.length !== exactKeys.length || candidateKeys.some( ( key, index ) => key !== exactKeys[ index ] ) ) return false;

			}
			try {

				validateSchemaSubset( candidate.value, definition, physicsAbiSchema, `semanticBinding.${ recordName }` );
				return true;

			} catch {

				return false;

			}

		} );
		if ( matches.length > 0 ) {

			const selectedRoot = rootOrder.find( ( rootKey ) => matches.some( ( match ) => match.rootKey === rootKey ) );
			bindings[ recordName ] = matches.filter( ( match ) => match.rootKey === selectedRoot ).map( ( match ) => Object.freeze( { path: Object.freeze( [ ...match.path ] ), rootKey: match.rootKey } ) );

		}
		else missing.push( recordName );

	}
	assert.deepEqual( missing, [], `semantic invariant subjects have no live schema-valid binding: ${ missing.join( ', ' ) }` );
	return Object.freeze( bindings );

}

function resolveSemanticBinding( fixture, binding, label ) {

	let value = fixture[ binding.rootKey ];
	for ( const segment of binding.path ) value = value?.[ segment ];
	assert.ok( value !== undefined, `${ label } no longer resolves ${ binding.rootKey }/${ binding.path.join( '/' ) }` );
	return value;

}

function validateSemanticSubjectRecord( recordName, record, context ) {

	const definition = physicsAbiSchema.$defs[ recordName ];
	assert.ok( isPlainObject( definition ), `${ context.invocation } references unknown ABI record ${ recordName}` );
	validateSchemaSubset( record, definition, physicsAbiSchema, `${ context.invocation }.subjects.${ recordName}` );
	return true;

}

const physicsSetupTimingsMs = {};
let physicsSetupMarkMs = performance.now();
function markPhysicsSetup( label ) {

	const now = performance.now();
	physicsSetupTimingsMs[ label ] = now - physicsSetupMarkMs;
	physicsSetupMarkMs = now;

}

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
markPhysicsSetup( 'genericRouteFixtures' );
const coupledPhysicsFixture = makeCanonicalCoupledPhysicsFixture();
const physicalImpactPartitionBundle = buildPhysicalImpactPartitionBundle( fixtureModuleHelpers, coupledPhysicsFixture );
const providerWaterBundle = buildProviderWaterBundle( fixtureModuleHelpers, coupledPhysicsFixture );
const contactIdentityBundle = buildContactIdentityBundle( fixtureModuleHelpers, coupledPhysicsFixture );
const externalGpuBundle = buildExternalGpuFixtureBundle( fixtureModuleHelpers, coupledPhysicsFixture );
const activeExternalAdapter = clone( externalGpuBundle.externalAdapterVariants.sharedResource );
coupledPhysicsFixture.physicsExternalSolverAdaptersById = { [ activeExternalAdapter.adapterId ]: activeExternalAdapter };
const qualityTransitionBundle = buildQualityTransitionBundle( fixtureModuleHelpers, coupledPhysicsFixture );
attachCanonicalQualityCostEvidence( coupledPhysicsFixture );
refreshCanonicalComposedCostEvidence( coupledPhysicsFixture );
markPhysicsSetup( 'coupledRouteAndModuleBuilds' );
validateRouteManifest( coupledPhysicsFixture );
markPhysicsSetup( 'canonicalCoupledRouteValidation' );
validateProviderWaterBundle( fixtureModuleHelpers, providerWaterBundle, coupledPhysicsFixture );
validateExternalGpuFixtureBundle( fixtureModuleHelpers, coupledPhysicsFixture, externalGpuBundle );
validateQualityTransitionBundle( fixtureModuleHelpers, coupledPhysicsFixture, qualityTransitionBundle );
validateContactIdentityBundle( fixtureModuleHelpers, coupledPhysicsFixture, contactIdentityBundle );
validatePhysicalImpactPartitionBundle( fixtureModuleHelpers, coupledPhysicsFixture, physicalImpactPartitionBundle );
markPhysicsSetup( 'modulePositiveValidation' );
assertCanonicalCoupledFixtureCoverage( coupledPhysicsFixture );
const implicitExternalOwnership = clone( activeExternalAdapter );
implicitExternalOwnership.ownership.stepping = 'implicit engine default';
assert.throws(
	() => validateExternalSolverAdapter( coupledPhysicsFixture, implicitExternalOwnership, 'genericExternalReject.implicitOwnership' ),
	/is implicit/,
	'generic external adapter validation accepted implicit stepping ownership'
);
const mismatchedExternalDescriptor = clone( activeExternalAdapter );
mismatchedExternalDescriptor.signalDescriptors[ 0 ].stateVersion = 'stale-external-state-version';
assert.throws(
	() => validateExternalSolverAdapter( coupledPhysicsFixture, mismatchedExternalDescriptor, 'genericExternalReject.descriptorMismatch' ),
	/differs from the route descriptor/,
	'generic external adapter validation accepted a stale route descriptor'
);
const duplicateExternalEquationOwner = clone( coupledPhysicsFixture );
const secondExternalAdapter = clone( activeExternalAdapter );
secondExternalAdapter.adapterId = 'duplicate-external-body-adapter';
duplicateExternalEquationOwner.physicsExternalSolverAdaptersById[ secondExternalAdapter.adapterId ] = secondExternalAdapter;
assert.throws(
	() => validateExternalAdapterOwnershipPartition( duplicateExternalEquationOwner ),
	/owned by multiple external adapters/,
	'generic external adapter validation accepted duplicate route-global state-equation ownership'
);
const duplicateQualityEmitter = clone( coupledPhysicsFixture );
duplicateQualityEmitter.physicsQualityTransitions[ 0 ].commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel[ 'duplicate-source-channel' ] = 'exactly-one-owner-and-representation';
assert.throws(
	() => validateQualityInventories( duplicateQualityEmitter ),
	/authoritative emitter closure mismatch/,
	'generic quality validation accepted an extra authoritative emitter'
);
const staleQualityEvidence = clone( coupledPhysicsFixture );
staleQualityEvidence.physicsQualityTransitions[ 0 ].sourceEvidenceDigest = 'sha256:stale-quality-evidence';
assert.throws(
	() => validateQualityInventories( staleQualityEvidence ),
	/sourceEvidenceDigest does not cover request evidence/,
	'generic quality validation accepted stale request evidence'
);
function makeQualityLineageRejectFixture( mode ) {

	const route = clone( coupledPhysicsFixture );
	const first = route.physicsQualityTransitions[ 0 ];
	const request = clone( route.physicsQualityRequests[ first.requestId ] );
	request.requestId = `${ first.requestId }-next`;
	request.requestSequence = first.requestSequence + 1;
	route.physicsQualityRequests[ request.requestId ] = request;
	const nextStateId = `${ first.toState }-next`;
	if ( mode !== 'cycle' ) {

		const nextState = clone( route.physicsQualityStates[ first.toState ] );
		nextState.qualityStateId = nextStateId;
		nextState.qualityEpoch = `${ nextState.qualityEpoch }-next`;
		route.physicsQualityStates[ nextStateId ] = nextState;

	}
	const second = clone( first );
	second.transitionId = `${ first.transitionId }-next`;
	second.requestId = request.requestId;
	second.requestSequence = request.requestSequence;
	second.fromState = mode === 'fork' ? first.fromState : first.toState;
	second.toState = mode === 'cycle' ? first.fromState : nextStateId;
	second.fromQualityEpoch = route.physicsQualityStates[ second.fromState ].qualityEpoch;
	second.toQualityEpoch = route.physicsQualityStates[ second.toState ].qualityEpoch;
	route.physicsQualityTransitions.push( second );
	if ( mode === 'reversed' ) route.physicsQualityTransitions.reverse();
	return route;

}
assert.throws(
	() => validateQualityInventories( makeQualityLineageRejectFixture( 'fork' ) ),
	/forks or is disconnected/,
	'generic quality validation accepted a forked transition lineage'
);
assert.throws(
	() => validateQualityInventories( makeQualityLineageRejectFixture( 'reversed' ) ),
	/not strictly ordered by requestSequence/,
	'generic quality validation accepted reverse request-sequence order'
);
assert.throws(
	() => validateQualityInventories( makeQualityLineageRejectFixture( 'cycle' ) ),
	/cycle or reuses an earlier quality state/,
	'generic quality validation accepted a transition cycle'
);
const unknownPresentationConsumer = clone( coupledPhysicsFixture );
unknownPresentationConsumer.physicsPresentationCandidate.eventSequenceRanges[ 0 ].consumerId = 'main/main-veiw';
assert.throws(
	() => validateCanonicalPresentation( unknownPresentationConsumer ),
	/neither a registered target\/view nor the shared presentation consumer/,
	'presentation validation treated an unknown consumer as a shared broadcast'
);
const unrelatedCommittedPresentationSource = clone( coupledPhysicsFixture );
unrelatedCommittedPresentationSource.physicsPresentationCandidate.eventSequenceRanges[ 0 ].sourceStateVersion = 'water-42';
for ( const snapshot of Object.values( unrelatedCommittedPresentationSource.physicsPresentationSnapshotsByTarget ) ) snapshot.eventSequenceRanges = clone( unrelatedCommittedPresentationSource.physicsPresentationCandidate.eventSequenceRanges );
assert.throws(
	() => validateCanonicalPresentation( unrelatedCommittedPresentationSource ),
	/sourceStateVersion does not resolve exactly one producer-owned committed signal/,
	'presentation validation accepted an unrelated committed state version as batch provenance'
);
const fabricatedPresentationPayload = clone( coupledPhysicsFixture );
fabricatedPresentationPayload.physicsPresentationCandidate.eventSequenceRanges[ 0 ].payloadDigest = 'sha256:fabricated-presentation-event-payload';
for ( const snapshot of Object.values( fabricatedPresentationPayload.physicsPresentationSnapshotsByTarget ) ) snapshot.eventSequenceRanges = clone( fabricatedPresentationPayload.physicsPresentationCandidate.eventSequenceRanges );
assert.throws(
	() => validateCanonicalPresentation( fabricatedPresentationPayload ),
	/payloadDigest does not cover the authoritative batch payloads/,
	'presentation validation accepted a fabricated batch payload digest copied into every snapshot'
);
const contaminatedLoopApplicationClosure = clone( coupledPhysicsFixture );
const unrelatedApplicationLedgerId = contaminatedLoopApplicationClosure.physicsGraph.executionLedger.interactionApplicationLedgers.find( ( ledger ) => ! contaminatedLoopApplicationClosure.physicsInteractions.filter( ( exchange ) => exchange.couplingLoopId === 'body-water-loop' ).flatMap( ( exchange ) => exchange.batchLedger.applicationLedgerIds ).includes( ledger.applicationLedgerId ) ).applicationLedgerId;
contaminatedLoopApplicationClosure.physicsGraph.loopMacros[ 0 ].perIterationLedger.find( ( row ) => row.accepted ).interactionApplicationLedgerIds.push( unrelatedApplicationLedgerId );
assert.throws(
	() => validateExactOnceInteractionApplication( contaminatedLoopApplicationClosure ),
	/accepted application-ledger closure is not exact/,
	'loop validation accepted an unrelated application ledger'
);
const singleViewNonWaterPhysicalRoute = makeSingleViewNonWaterPhysicalRouteFixture( coupledPhysicsFixture );
validateRouteManifest( singleViewNonWaterPhysicalRoute );
assert.throws(
	() => assertCanonicalCoupledFixtureCoverage( singleViewNonWaterPhysicalRoute ),
	/canonical coupled fixture does not cover/,
	'single-view non-water route must not satisfy the canonical coupled coverage profile'
);
const oneToOnePhysicalExchangeRoute = makeOneToOnePhysicalExchangeRouteFixture( makeCanonicalCoupledPhysicsFixture() );
validateRouteManifest( oneToOnePhysicalExchangeRoute );
assert.equal( oneToOnePhysicalExchangeRoute.physicsInteractions[ 0 ].interactions.length, 1, 'one-to-one physical route must contain exactly one source interaction' );
assert.equal( oneToOnePhysicalExchangeRoute.physicsInteractions[ 0 ].reactions.length, 1, 'one-to-one physical route must contain exactly one reaction interaction' );
assert.throws(
	() => assertCanonicalCoupledFixtureCoverage( oneToOnePhysicalExchangeRoute ),
	/canonical coupled fixture does not exercise many-to-many/,
	'one-to-one physical route must not satisfy the canonical many-to-many coverage profile'
);
const catchUpPhysicalRoute = makeCatchUpPhysicalRouteFixture( singleViewNonWaterPhysicalRoute );
validateRouteManifest( catchUpPhysicalRoute );
const catchUpDebtMismatch = clone( catchUpPhysicalRoute );
catchUpDebtMismatch.physicsGraph.catchUpBatch.debtAfter = fixtureDurationSeconds( 0.001, 'catch-up-debt-mismatch' );
catchUpDebtMismatch.physicsGraph.catchUpBatch.receiptDigest = sha256CanonicalExcluding( catchUpDebtMismatch.physicsGraph.catchUpBatch, [ 'receiptDigest' ] );
assert.throws(
	() => validateCatchUpSchedulerClosure( catchUpDebtMismatch.physicsGraph, catchUpDebtMismatch.physicsContext, catchUpDebtMismatch.physicsGraph.coordinationAdvance, catchUpDebtMismatch, catchUpDebtMismatch.physicsGraph.executionLedger ),
	/catch-up debt equation does not close|debt endpoints disagree/,
	'catch-up validator accepted inconsistent debt algebra'
);
const catchUpReciprocalMismatch = clone( catchUpPhysicalRoute );
catchUpReciprocalMismatch.physicsGraph.coordinationAdvance.catchUpBatchId = 'another-catch-up-batch';
catchUpReciprocalMismatch.physicsGraph.coordinationAdvance.receiptDigest = sha256CanonicalExcluding( catchUpReciprocalMismatch.physicsGraph.coordinationAdvance, [ 'receiptDigest' ] );
catchUpReciprocalMismatch.physicsCoordinationAdvanceRecords = [ clone( catchUpReciprocalMismatch.physicsGraph.coordinationAdvance ) ];
assert.throws(
	() => validateCatchUpSchedulerClosure( catchUpReciprocalMismatch.physicsGraph, catchUpReciprocalMismatch.physicsContext, catchUpReciprocalMismatch.physicsGraph.coordinationAdvance, catchUpReciprocalMismatch, catchUpReciprocalMismatch.physicsGraph.executionLedger ),
	/references another catch-up batch/,
	'catch-up validator accepted a stale reciprocal batch ID'
);
const catchUpNativeExecutionClosureMismatch = clone( catchUpPhysicalRoute );
catchUpNativeExecutionClosureMismatch.physicsGraph.coordinationAdvance.stageExecutionIds.push( 'schema-valid-but-unexecuted-native-step' );
catchUpNativeExecutionClosureMismatch.physicsGraph.coordinationAdvance.receiptDigest = sha256CanonicalExcluding( catchUpNativeExecutionClosureMismatch.physicsGraph.coordinationAdvance, [ 'receiptDigest' ] );
catchUpNativeExecutionClosureMismatch.physicsCoordinationAdvanceRecords = [ clone( catchUpNativeExecutionClosureMismatch.physicsGraph.coordinationAdvance ) ];
assert.throws(
	() => validateCatchUpSchedulerClosure( catchUpNativeExecutionClosureMismatch.physicsGraph, catchUpNativeExecutionClosureMismatch.physicsContext, catchUpNativeExecutionClosureMismatch.physicsGraph.coordinationAdvance, catchUpNativeExecutionClosureMismatch, catchUpNativeExecutionClosureMismatch.physicsGraph.executionLedger ),
	/native-execution closure differs from the execution ledger/,
	'catch-up validator accepted an inexact native-execution closure for an advance'
);
const catchUpMultiAdvanceNativeExecutionOverflow = clone( catchUpPhysicalRoute );
const catchUpFirstAdvance = catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph.coordinationAdvance;
const catchUpSecondAdvance = clone( catchUpFirstAdvance );
catchUpSecondAdvance.coordinationAdvanceId = 'generic-catch-up-advance-2';
catchUpSecondAdvance.coordinationSequence = catchUpFirstAdvance.coordinationSequence + 1;
catchUpSecondAdvance.predecessorAdvanceId = catchUpFirstAdvance.coordinationAdvanceId;
catchUpSecondAdvance.predecessorReceiptDigest = catchUpFirstAdvance.receiptDigest;
catchUpSecondAdvance.stageExecutionIds = catchUpSecondAdvance.stageExecutionIds.map( ( executionId ) => `${ executionId }/catch-up-advance-2` );
const catchUpClockRegistry = catchUpMultiAdvanceNativeExecutionOverflow.physicsContext.physicsClockRegistry.clocksById;
const catchUpFirstEnd = catchUpFirstAdvance.interval.endExclusive;
catchUpSecondAdvance.interval = fixtureInterval( catchUpClockRegistry, catchUpFirstAdvance.interval.clockId, catchUpFirstEnd.tick, catchUpFirstEnd.tick + 1, [ catchUpFirstEnd.rationalSubstep.numerator, catchUpFirstEnd.rationalSubstep.denominator ], [ catchUpFirstEnd.rationalSubstep.numerator, catchUpFirstEnd.rationalSubstep.denominator ] );
catchUpSecondAdvance.debtBefore = clone( catchUpFirstAdvance.debtAfter );
catchUpSecondAdvance.debtAfter = clone( catchUpFirstAdvance.debtAfter );
catchUpSecondAdvance.receiptDigest = sha256CanonicalExcluding( catchUpSecondAdvance, [ 'receiptDigest' ] );
catchUpMultiAdvanceNativeExecutionOverflow.physicsCoordinationAdvanceRecords.push( catchUpSecondAdvance );
const catchUpOverflowBatch = catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph.catchUpBatch;
catchUpOverflowBatch.coordinationAdvanceIds.push( catchUpSecondAdvance.coordinationAdvanceId );
catchUpOverflowBatch.admittedAdvanceIntervals.push( clone( catchUpSecondAdvance.interval ) );
const catchUpOverflowCommittedSeconds = catchUpOverflowBatch.admittedAdvanceIntervals.reduce( ( sum, interval, index ) => {

	const bounds = intervalBoundsSeconds( interval, catchUpMultiAdvanceNativeExecutionOverflow.physicsContext, `catchUpOverflow.interval[${ index }]` );
	return sum + bounds[ 1 ] - bounds[ 0 ];

}, 0 );
const catchUpOverflowDebtBeforeSeconds = canonicalDurationSecondsValue( catchUpOverflowBatch.debtBefore, catchUpMultiAdvanceNativeExecutionOverflow.physicsContext, 'catchUpOverflow.debtBefore' );
const catchUpOverflowDebtAfterSeconds = canonicalDurationSecondsValue( catchUpOverflowBatch.debtAfter, catchUpMultiAdvanceNativeExecutionOverflow.physicsContext, 'catchUpOverflow.debtAfter' );
catchUpOverflowBatch.committedAdvanceDuration = fixtureDurationSeconds( catchUpOverflowCommittedSeconds, 'catch-up-overflow-fixture' );
catchUpOverflowBatch.elapsedDuringBatch = fixtureDurationSeconds( catchUpOverflowCommittedSeconds + catchUpOverflowDebtAfterSeconds - catchUpOverflowDebtBeforeSeconds, 'catch-up-overflow-fixture' );
catchUpOverflowBatch.receiptDigest = sha256CanonicalExcluding( catchUpOverflowBatch, [ 'receiptDigest' ] );
const catchUpOverflowNativeExecutionCount = catchUpFirstAdvance.stageExecutionIds.length + catchUpSecondAdvance.stageExecutionIds.length;
catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph.catchUpPolicy.maximumNativeExecutionsPerOpportunity.value = catchUpOverflowNativeExecutionCount - 1;
assert.throws(
	() => validateCatchUpSchedulerClosure( catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph, catchUpMultiAdvanceNativeExecutionOverflow.physicsContext, catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph.coordinationAdvance, catchUpMultiAdvanceNativeExecutionOverflow, catchUpMultiAdvanceNativeExecutionOverflow.physicsGraph.executionLedger ),
	/catch-up batch exceeds the policy native-execution bound/,
	'catch-up validator accepted a multi-advance batch whose summed native executions exceed the policy cap'
);

const noExchangePhysicsFixture = clone( coupledPhysicsFixture );
noExchangePhysicsFixture.physicsInteractions = [];
noExchangePhysicsFixture.physicsExternalSolverAdaptersById = {};
noExchangePhysicsFixture.physicsQualityRequests = {};
noExchangePhysicsFixture.physicsQualityStates = {};
noExchangePhysicsFixture.physicsQualityTransitions = [];
noExchangePhysicsFixture.physicsErrorPropagationLedgers = {};
noExchangePhysicsFixture.physicsInteractionApplicationLedgers = {};
noExchangePhysicsFixture.physicsGraph.executionLedger.interactionApplicationLedgers = [];
for ( const execution of noExchangePhysicsFixture.physicsGraph.executionLedger.stageExecutions ) execution.interactionApplicationLedgerIds = [];
for ( const claim of noExchangePhysicsFixture.physicsGraph.executionLedger.stateAdvanceClaims ) claim.interactionApplicationLedgerIds = [];
for ( const loop of noExchangePhysicsFixture.physicsGraph.loopMacros ) for ( const row of loop.perIterationLedger ) {

	row.interactionApplicationLedgerIds = [];
	row.interactionSequenceRanges = [];

}
noExchangePhysicsFixture.physicsCostLedger.cadenceTraceTotals.interactionApplicationCounts = {};
{

	const digestPayload = clone( noExchangePhysicsFixture.physicsCostLedger.cadenceTraceTotals );
	delete digestPayload.exactTotalsDigest;
	noExchangePhysicsFixture.physicsCostLedger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( digestPayload );

}
validateExactOnceInteractionApplication( noExchangePhysicsFixture );
validateCanonicalCostLedger( noExchangePhysicsFixture.physicsCostLedger, noExchangePhysicsFixture.physicsGraph, noExchangePhysicsFixture.physicsContext, noExchangePhysicsFixture );
validateQualityTransitionBundle( fixtureModuleHelpers, noExchangePhysicsFixture );
markPhysicsSetup( 'noExchangeFocusedValidation' );

const oneWayExchangeFixture = clone( coupledPhysicsFixture.physicsInteractions[ 0 ] );
oneWayExchangeFixture.mode = 'one-way';
oneWayExchangeFixture.reactions = [];
oneWayExchangeFixture.reactionGroups = [];
oneWayExchangeFixture.physicalImpactParents = [];
oneWayExchangeFixture.physicalImpactPartitions = [];
oneWayExchangeFixture.couplingLoopId = typedAbsence( 'not-applicable', 'route-physics-coordinator', 'timeless', 'one-way exchange has no feedback loop' );
oneWayExchangeFixture.stabilityGate = { omittedFeedbackUpperBound: evidence( 0.05, 'newton-second', 'Gated', 'prescribed-source-regime' ), validityRegime: 'prescribed body load with bounded receiver-to-source response' };
oneWayExchangeFixture.convergence = 'not-applicable';
for ( const interaction of oneWayExchangeFixture.interactions ) {

	interaction.reactionGroupId = typedAbsence( 'not-applicable', interaction.sourceOwner, 'timeless', 'one-way exchange has no reaction group' );
	interaction.partitionMembership = typedAbsence( 'not-applicable', interaction.sourceOwner, 'timeless', 'one-way fixture has no physical-impact partition family' );

}
const oneWayConservation = oneWayExchangeFixture.conservationGroups[ 0 ];
const oneWayIngress = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Derived', 'one-way-prescribed-ingress' ) };
for ( const interaction of oneWayExchangeFixture.interactions ) {

	addVector( oneWayIngress.linearMomentumNs, interaction.payload.linearMomentumNs );
	addVector( oneWayIngress.angularMomentumNms, interaction.payload.angularMomentumNms );

}
oneWayConservation.participants = [ '$threejs-water-optics' ];
oneWayConservation.initialInventory = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Measured', 'one-way-initial-inventory' ) };
oneWayConservation.finalInventory = clone( oneWayIngress );
oneWayConservation.externalSources = clone( oneWayIngress );
oneWayConservation.boundaryFluxes = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Derived', 'one-way-boundary-outflow' ) };
oneWayConservation.modeledConversions = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Derived', 'one-way-modeled-conversion' ) };
oneWayConservation.modeledDissipation = {};
oneWayConservation.numericalResidual = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], energyJ: evidence( 0, 'joule', 'Derived', 'one-way-residual' ) };
oneWayConservation.modeledInternalTransfers = { byInteractionId: {} };
oneWayExchangeFixture.batchLedger.publishedSequenceRange.lastSequence = 1002;
oneWayExchangeFixture.batchLedger.perConsumerCursor = { water: 1003 };
oneWayExchangeFixture.batchLedger.acceptedRejectedLateDuplicate.accepted.value = 2;
oneWayExchangeFixture.batchLedger.applicationLedgerIds = oneWayExchangeFixture.batchLedger.applicationLedgerIds.filter( ( id ) => id.startsWith( 'application-source-' ) );
validateCanonicalExchange( oneWayExchangeFixture, coupledPhysicsFixture.physicsContext, 'one-way' );
const oneWayPhysicsFixture = clone( coupledPhysicsFixture );
oneWayPhysicsFixture.physicsInteractions = [ oneWayExchangeFixture ];
oneWayPhysicsFixture.physicsExternalSolverAdaptersById = {};
oneWayPhysicsFixture.physicsQualityRequests = {};
oneWayPhysicsFixture.physicsQualityStates = {};
oneWayPhysicsFixture.physicsQualityTransitions = [];
oneWayPhysicsFixture.physicsErrorPropagationLedgers = {};
const oneWayApplicationIds = new Set( oneWayExchangeFixture.batchLedger.applicationLedgerIds );
oneWayPhysicsFixture.physicsInteractionApplicationLedgers = Object.fromEntries( Object.entries( oneWayPhysicsFixture.physicsInteractionApplicationLedgers ).filter( ( [ id ] ) => oneWayApplicationIds.has( id ) ) );
oneWayPhysicsFixture.physicsGraph.executionLedger.interactionApplicationLedgers = oneWayPhysicsFixture.physicsGraph.executionLedger.interactionApplicationLedgers.filter( ( ledger ) => oneWayApplicationIds.has( ledger.applicationLedgerId ) );
for ( const execution of oneWayPhysicsFixture.physicsGraph.executionLedger.stageExecutions ) execution.interactionApplicationLedgerIds = execution.interactionApplicationLedgerIds.filter( ( id ) => oneWayApplicationIds.has( id ) );
for ( const claim of oneWayPhysicsFixture.physicsGraph.executionLedger.stateAdvanceClaims ) claim.interactionApplicationLedgerIds = claim.interactionApplicationLedgerIds.filter( ( id ) => oneWayApplicationIds.has( id ) );
for ( const loop of oneWayPhysicsFixture.physicsGraph.loopMacros ) for ( const row of loop.perIterationLedger ) {

	row.interactionApplicationLedgerIds = [];
	row.interactionSequenceRanges = [];

}
oneWayPhysicsFixture.physicsCostLedger.cadenceTraceTotals.interactionApplicationCounts.momentumTransfer.value = oneWayApplicationIds.size * oneWayPhysicsFixture.physicsCostLedger.cadenceTraceTotals.coordinationAdvanceCount.value;
delete oneWayPhysicsFixture.physicsCostLedger.cadenceTraceTotals.interactionApplicationCounts.pointImpulse;
{

	const digestPayload = clone( oneWayPhysicsFixture.physicsCostLedger.cadenceTraceTotals );
	delete digestPayload.exactTotalsDigest;
	oneWayPhysicsFixture.physicsCostLedger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( digestPayload );

}
validateExactOnceInteractionApplication( oneWayPhysicsFixture );
validateCanonicalCostLedger( oneWayPhysicsFixture.physicsCostLedger, oneWayPhysicsFixture.physicsGraph, oneWayPhysicsFixture.physicsContext, oneWayPhysicsFixture );
markPhysicsSetup( 'oneWayFocusedValidation' );

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
		fromToTransform: { transformRevision: 'origin-rebase-transform-16-17', properBasisRotation: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], translationMeters: [ 1024, 0, 0 ], error: fixtureError( 'metre', 1e-9, 'rebase-round-trip' ) },
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
markPhysicsSetup( 'crossOriginFixtureBuild' );

const semanticClockSpanPrototype = {
	clockId: coupledPhysicsFixture.physicsGraph.coordinationInterval.clockId,
	start: clone( coupledPhysicsFixture.physicsGraph.coordinationInterval.start ),
	endExclusive: clone( coupledPhysicsFixture.physicsGraph.coordinationInterval.endExclusive ),
	mappingRevision: coupledPhysicsFixture.physicsGraph.coordinationInterval.intervalMappingRevision
};
const semanticCatchUpBatchPrototype = {
	catchUpBatchId: 'semantic-catch-up-batch', graphId: coupledPhysicsFixture.physicsGraph.graphId, contextId: coupledPhysicsFixture.physicsContext.contextId,
	owner: 'route-physics-coordinator',
	debtIdentity: {
		debtIdentityId: 'semantic-catch-up-debt', graphId: coupledPhysicsFixture.physicsGraph.graphId,
		debtClockId: coupledPhysicsFixture.physicsGraph.coordinationInterval.clockId,
		sourceCursorBeforeAfter: { before: 42, after: 43 }, presentationOpportunitySequence: 42,
		observedAt: clone( coupledPhysicsFixture.physicsGraph.coordinationInterval.start ), policyRevision: 'semantic-catch-up-policy-v1'
	},
	debtBefore: fixtureDurationSeconds( 1 / 60, 'semantic-catch-up' ), elapsedDuringBatch: fixtureDurationSeconds( 1 / 60, 'semantic-catch-up' ),
	admittedAdvanceIntervals: [ clone( coupledPhysicsFixture.physicsGraph.coordinationInterval ) ], coordinationAdvanceIds: [ coupledPhysicsFixture.physicsGraph.coordinationAdvance.coordinationAdvanceId ],
	committedAdvanceDuration: fixtureDurationSeconds( 1 / 60, 'semantic-catch-up' ), explicitlyDroppedDuration: fixtureDurationSeconds( 0, 'semantic-catch-up' ), debtAfter: fixtureDurationSeconds( 0, 'semantic-catch-up' ),
	lossLedger: typedAbsence( 'not-applicable', 'route-physics-coordinator', 'timeless', 'semantic catch-up drops no interval' ),
	policyRevision: 'semantic-catch-up-policy-v1', errorResourceAndExecutionGateResults: [ 'accepted' ], status: 'completed', receiptDigest: 'sha256:semantic-catch-up-batch'
};

const semanticFixtureRoots = Object.freeze( {
	route: coupledPhysicsFixture,
	crossOriginRoute: crossOriginPresentationFixture,
	providerWaterBundle,
	externalGpuBundle,
	contactIdentityBundle,
	physicalImpactPartitionBundle,
	semanticClockSpanPrototype,
	semanticCatchUpBatchPrototype
} );
const semanticBindingStartedAtMs = performance.now();
const semanticSubjectBindings = buildSemanticSubjectBindings( semanticFixtureRoots );
const semanticBindingDurationMs = performance.now() - semanticBindingStartedAtMs;
const semanticCheckRootKeys = Object.freeze( {
	validateSignalChannelErrorAndAbsenceClosure: [ 'route', 'providerWaterBundle' ],
	validateStableGenerationIdentity: [ 'route', 'contactIdentityBundle' ],
	validateAuthoritativeGpuRecovery: [ 'route', 'externalGpuBundle' ],
	validateExternalSolverBoundaryOwnership: [ 'route', 'externalGpuBundle' ],
	validateAtomicPhysicsOriginRebase: [ 'crossOriginRoute' ],
	validateRegistryAuthorityAndDagClosure: [ 'route', 'contactIdentityBundle' ],
	validatePhysicalImpactPartitionClosure: [ 'route', 'physicalImpactPartitionBundle' ],
	validateDeformingAndFluidBoundaryProxy: [ 'route', 'contactIdentityBundle' ],
	validateExternalDirectionalCapability: [ 'route', 'externalGpuBundle' ]
} );

const semanticIdentityCase = ( fixture ) => fixture;
const semanticRouteCase = ( mutation ) => ( fixture ) => { mutation( fixture.route, fixture ); return fixture; };
const semanticCrossOriginCase = ( mutation ) => ( fixture ) => { mutation( fixture.crossOriginRoute, fixture ); return fixture; };
const semanticBundleCase = ( bundleKey, mutation ) => ( fixture ) => { fixture[ bundleKey ] = mutation( fixture[ bundleKey ], fixture ); return fixture; };
const refreshCadenceTotalsDigest = ( route ) => {

	const payload = clone( route.physicsCostLedger.cadenceTraceTotals );
	delete payload.exactTotalsDigest;
	route.physicsCostLedger.cadenceTraceTotals.exactTotalsDigest = sha256Canonical( payload );

};
const makeIndependentViewCadenceCase = semanticRouteCase( ( route ) => {

	const ledger = route.physicsCostLedger;
	const totals = ledger.cadenceTraceTotals;
	const denominatorTargetViewKey = 'minimap/map-view';
	const priorFrameCount = quantityValue( totals.presentedFrameCounts[ denominatorTargetViewKey ], 'independentViewCadence.priorFrameCount' );
	const independentFrameCount = 6000;
	totals.presentedFrameCounts[ denominatorTargetViewKey ].value = independentFrameCount;
	ledger.coordinationIntervalsPerPresentedFrame.denominatorTargetViewKey = denominatorTargetViewKey;
	ledger.coordinationIntervalsPerPresentedFrame.exactRatio.value = quantityValue( totals.coordinationAdvanceCount, 'independentViewCadence.coordinationAdvanceCount' ) / independentFrameCount;
	for ( const [ stageId, cadence ] of Object.entries( ledger.executionsPerPresentedFrame ) ) {

		cadence.denominatorTargetViewKey = denominatorTargetViewKey;
		cadence.count.value = quantityValue( totals.stageExecutionCounts[ stageId ], `independentViewCadence.stageExecutionCounts.${ stageId }` ) / independentFrameCount;

	}
	for ( const [ metric, cadence ] of Object.entries( ledger.subcyclesAndCouplingIterationsPerPresentedFrame ) ) ledger.subcyclesAndCouplingIterationsPerPresentedFrame[ metric ] = {

		denominatorTargetViewKey,
		count: evidence( quantityValue( cadence, `independentViewCadence.${ metric }` ) * priorFrameCount / independentFrameCount, cadence.unit, cadence.label, cadence.source )

	};
	for ( const workKey of ledger.perViewWorkKeys[ denominatorTargetViewKey ] ) {

		totals.workOccurrenceCounts[ workKey ].value = independentFrameCount;
		ledger.workAttribution.find( ( row ) => row.workKey === workKey ).occurrenceCount.value = independentFrameCount;

	}
	refreshCadenceTotalsDigest( route );

} );
const makeSemanticInvariantFixture = ( context ) => {

	const rootKeys = new Set( semanticCheckRootKeys[ context.validator ] ?? [ 'route' ] );
	for ( const recordName of context.invariant.appliesTo ) for ( const binding of semanticSubjectBindings[ recordName ] ) rootKeys.add( binding.rootKey );
	return Object.fromEntries( [ ...rootKeys ].map( ( rootKey ) => [ rootKey, semanticFixtureRoots[ rootKey ] ] ) );

};
const resolveSemanticSubjects = ( fixture, context ) => Object.fromEntries( context.invariant.appliesTo.map( ( recordName ) => {

	const records = semanticSubjectBindings[ recordName ].map( ( binding ) => resolveSemanticBinding( fixture, binding, `${ context.invocation }.subjects.${ recordName}` ) );
	return [ recordName, records.length === 1 ? records[ 0 ] : records ];

} ) );

const semanticInvariantChecks = Object.freeze( {
	validateUniqueStateEquationOwnership,
	validateProperOrthogonalTransforms,
	validateCanonicalRationalSubstep,
	validateOrderedCompatibleInterval,
	validateClockMappingEvaluation,
	validatePhysicsGraphOrderingAndLoops,
	validateAtomicPublicationLineage,
	validateSignalChannelErrorAndAbsenceClosure,
	validateDimensionalInteractionAndQuadrature,
	validateInteractionDeliveryAndReactionAtomicity,
	validateConservationResiduals: ( fixture ) => {

		const exchange = fixture.route.physicsInteractions[ 0 ];
		return validateConservationResiduals( exchange.conservationGroups[ 0 ], [ ...exchange.interactions, ...exchange.reactions ], 'semantic.conservation', exchange.mode );

	},
	validateStableGenerationIdentity,
	validateAuthoritativeGpuRecovery,
	validateExternalSolverBoundaryOwnership,
	validatePresentationPublicationClosure,
	validateLeaseConsumerJoinAndRetirement,
	validateAtomicPhysicsOriginRebase,
	validateConservativeQualityMigration,
	validateAlignedCostTraceAndNoCriticalReadback,
	validateComposedCostEnvelope,
	validateRegistryAuthorityAndDagClosure,
	validateCoordinationAdvanceAndCatchUp,
	validateDependencyCompletionInstances,
	validateAtomicCommitTransaction,
	validateCouplingIterationLineage,
	validatePhysicalImpactPartitionClosure,
	validateExactOnceInteractionApplication: ( fixture ) => validateExactOnceInteractionApplication( fixture.route ),
	validateDeformingAndFluidBoundaryProxy,
	validateExternalDirectionalCapability,
	validatePresentationCohortAndSlotAdmission,
	validateImmutableRenderPlanClosure,
	validateQualityRequestAndAllocationAdmission,
	validateMemoryTrafficAndWorkAttribution,
	validateCadenceTraceTotals
} );

const semanticInvariantAcceptCases = Object.freeze( {
	validateUniqueStateEquationOwnership: { 'one-owner-per-equation': semanticIdentityCase },
	validateProperOrthogonalTransforms: { 'proper-rotation': semanticIdentityCase },
	validateCanonicalRationalSubstep: { 'reduced-rational': semanticIdentityCase },
	validateOrderedCompatibleInterval: { 'ordered-same-clock': semanticIdentityCase },
	validateClockMappingEvaluation: { 'monotone-covered-mapping': semanticIdentityCase },
	validatePhysicsGraphOrderingAndLoops: { 'acyclic-outer-graph': semanticIdentityCase },
	validateAtomicPublicationLineage: { 'complete-lineage': semanticIdentityCase },
	validateSignalChannelErrorAndAbsenceClosure: { 'matching-channel-error-sets': semanticIdentityCase },
	validateDimensionalInteractionAndQuadrature: { 'compatible-payload-footprint': semanticIdentityCase },
	validateInteractionDeliveryAndReactionAtomicity: { 'monotonic-exact-once': semanticIdentityCase },
	validateConservationResiduals: { 'closed-ledger': semanticIdentityCase },
	validateStableGenerationIdentity: { 'compaction-preserves-id': semanticIdentityCase },
	validateAuthoritativeGpuRecovery: { 'restore-replay-atomic': semanticIdentityCase },
	validateExternalSolverBoundaryOwnership: { 'single-owner-each-boundary': semanticIdentityCase },
	validatePresentationPublicationClosure: { 'acyclic-exact-closure': semanticIdentityCase },
	validateLeaseConsumerJoinAndRetirement: { 'all-consumers-complete': semanticIdentityCase },
	validateAtomicPhysicsOriginRebase: { 'complete-owner-rebase': semanticIdentityCase },
	validateConservativeQualityMigration: { 'prepare-commit-retire': semanticIdentityCase },
	validateAlignedCostTraceAndNoCriticalReadback: { 'aligned-sustained-trace': semanticIdentityCase },
	validateComposedCostEnvelope: { 'digest-closed-opportunity-frontier-and-migration': semanticIdentityCase },
	validateRegistryAuthorityAndDagClosure: { 'single-atomic-registry-revision': semanticIdentityCase },
	validateCoordinationAdvanceAndCatchUp: { 'digest-linked-adjacent-advances': semanticIdentityCase },
	validateDependencyCompletionInstances: { 'exact-producer-consumer-completion': semanticIdentityCase },
	validateAtomicCommitTransaction: { 'single-registry-swap': semanticIdentityCase },
	validateCouplingIterationLineage: { 'seed-prior-accepted-lineage': semanticIdentityCase },
	validatePhysicalImpactPartitionClosure: { 'measure-and-commodity-closure': semanticIdentityCase },
	validateExactOnceInteractionApplication: { 'rate-overlap-and-integral-once': semanticIdentityCase },
	validateDeformingAndFluidBoundaryProxy: { 'complete-material-point-boundary': semanticIdentityCase },
	validateExternalDirectionalCapability: { 'one-capability-per-directional-payload': semanticIdentityCase },
	validatePresentationCohortAndSlotAdmission: { 'committed-cohort-admitted-slot': semanticIdentityCase },
	validateImmutableRenderPlanClosure: { 'complete-phase-edge-reset-shadow-closure': semanticIdentityCase },
	validateQualityRequestAndAllocationAdmission: { 'scope-evidence-capacity-match': semanticIdentityCase },
	validateMemoryTrafficAndWorkAttribution: { 'unique-lifetime-transfer-work-closure': semanticIdentityCase },
	validateCadenceTraceTotals: { 'exact-duration-count-byte-reconciliation': makeIndependentViewCadenceCase }
} );

const semanticInvariantRejectCases = Object.freeze( {
	validateUniqueStateEquationOwnership: {
		'duplicate-owner': semanticRouteCase( ( route ) => { route.physicsGraph.commitGroups[ 0 ].stateEquationOwners[ 'water-state' ] = 'environment-owner'; } ),
		'missing-owner': semanticRouteCase( ( route ) => { delete route.physicsGraph.commitGroups.find( ( group ) => group.commitGroupId === 'coupled-commit' ).stateEquationOwners[ 'body-state' ]; } )
	},
	validateProperOrthogonalTransforms: {
		reflection: semanticRouteCase( ( route ) => { route.physicsContext.worldToPhysicsTransform.properBasisRotation[ 0 ] = - 1; } ),
		shear: semanticRouteCase( ( route ) => { route.physicsContext.worldToPhysicsTransform.properBasisRotation[ 1 ] = 0.25; } ),
		'scaled-basis': semanticRouteCase( ( route ) => { route.physicsContext.worldToPhysicsTransform.properBasisRotation[ 0 ] = 2; } )
	},
	validateCanonicalRationalSubstep: {
		'improper-fraction': semanticRouteCase( ( route ) => { route.physicsGraph.coordinationInterval.start.rationalSubstep = { numerator: 1, denominator: 1 }; } ),
		'nonreduced-rational': semanticRouteCase( ( route ) => { route.physicsGraph.coordinationInterval.start.rationalSubstep = { numerator: 2, denominator: 4 }; } )
	},
	validateOrderedCompatibleInterval: {
		reversed: semanticRouteCase( ( route ) => { route.physicsGraph.coordinationInterval.endExclusive = clone( route.physicsGraph.coordinationInterval.start ); } ),
		'mixed-clock': semanticRouteCase( ( route ) => { route.physicsGraph.coordinationInterval.endExclusive.clockId = 'water-adaptive'; } ),
		'mixed-epoch': semanticRouteCase( ( route ) => { route.physicsGraph.coordinationInterval.endExclusive.discontinuityEpoch = 'time-continuity-stale'; } )
	},
	validateClockMappingEvaluation: {
		gap: semanticRouteCase( ( route ) => { route.physicsContext.physicsClockRegistry.clocksById[ 'water-adaptive' ].mapping.piecewiseVersioned.segmentTable.inlineEntries[ 2 ].startInclusive.tick = 101; } ),
		overlap: semanticRouteCase( ( route ) => { route.physicsContext.physicsClockRegistry.clocksById[ 'water-adaptive' ].mapping.piecewiseVersioned.segmentTable.inlineEntries[ 2 ].startInclusive.tick = 99; } ),
		'unlogged-external-query': semanticRouteCase( ( route ) => { route.physicsContext.physicsClockRegistry.clocksById[ 'contact-event' ].mapping.external.unloggedQueryPolicy = 'best-effort'; } )
	},
	validatePhysicsGraphOrderingAndLoops: {
		'hidden-cycle': semanticRouteCase( ( route ) => { const edge = clone( route.physicsGraph.edges[ 0 ] ); edge.edgeId = 'semantic-self-cycle'; edge.producerStageId = 'predict-body'; edge.consumerStageId = 'predict-body'; edge.barrier.dependencyId = 'dependency-semantic-self-cycle'; route.physicsGraph.edges.push( edge ); } ),
		'stage-order-regression': semanticRouteCase( ( route ) => { route.physicsGraph.executionLedger.stageExecutions[ 1 ].executionSequence = route.physicsGraph.executionLedger.stageExecutions[ 0 ].executionSequence; } )
	},
	validateAtomicPublicationLineage: {
		'partial-commit': semanticRouteCase( ( route ) => { route.physicsGraph.commitGroups.find( ( group ) => group.commitGroupId === 'coupled-commit' ).committedPublications.pop(); } ),
		'escaped-provisional-version': semanticRouteCase( ( route ) => { route.physicsGraph.loopMacros[ 0 ].acceptedWrites[ 0 ].stateVersion = 'water-42'; } )
	},
	validateSignalChannelErrorAndAbsenceClosure: {
		'implicit-zero': semanticBundleCase( 'providerWaterBundle', ( bundle ) => providerWaterRejectMutations.implicitZeroForAbsentWaterPressure( fixtureModuleHelpers, bundle ) ),
		'missing-error': semanticRouteCase( ( route ) => { delete route.physicsSignals.waterSurface.perChannelError.materialCurrentVelocityMps; } ),
		'stale-generation': semanticBundleCase( 'providerWaterBundle', ( bundle ) => providerWaterRejectMutations.staleResponseResourceGeneration( fixtureModuleHelpers, bundle ) )
	},
	validateDimensionalInteractionAndQuadrature: {
		'rate-as-integral': semanticRouteCase( ( route ) => {

			const record = route.physicsInteractions[ 0 ].interactions[ 0 ];
			const integratedPayload = record.payload;
			record.payload = {
				tag: 'wrenchRate', timeSemantics: 'rate',
				forceN: clone( integratedPayload.linearMomentumNs ),
				torqueNm: clone( integratedPayload.angularMomentumNms ),
				referencePointMeters: clone( integratedPayload.referencePointMeters )
			};

		} ),
		'bad-kernel-normalization': semanticRouteCase( ( route ) => { route.physicsInteractions[ 0 ].interactions[ 0 ].footprint.normalizationIntegral.value = 0.5; } )
	},
	validateInteractionDeliveryAndReactionAtomicity: {
		duplicate: semanticRouteCase( ( route ) => { route.physicsInteractions[ 0 ].interactions[ 1 ].exactOnceKey = route.physicsInteractions[ 0 ].interactions[ 0 ].exactOnceKey; } ),
		'unledgered-overflow': semanticRouteCase( ( route ) => { route.physicsInteractions[ 0 ].batchLedger.overflowPolicy = 'lossy-with-failed-conservation'; } ),
		'partial-reaction': semanticRouteCase( ( route ) => { route.physicsInteractions[ 0 ].reactionGroups[ 0 ].acceptance = 'partial'; } )
	},
	validateConservationResiduals: {
		'one-sided-transfer': semanticRouteCase( ( route ) => { const exchange = route.physicsInteractions[ 0 ]; const reaction = exchange.reactions.at( - 1 ); reaction.payload.linearMomentumNs[ 0 ] += 1; exchange.conservationGroups[ 0 ].modeledInternalTransfers.byInteractionId[ reaction.interactionId ].linearMomentumNs[ 0 ] += 1; } ),
		'negative-modeled-dissipation': semanticRouteCase( ( route ) => {

			const group = route.physicsInteractions[ 0 ].conservationGroups[ 0 ];
			group.commodities.push( 'energy' );
			for ( const transfer of Object.values( group.modeledInternalTransfers.byInteractionId ) ) transfer.energyJ = 0;
			for ( const mapName of [ 'initialInventory', 'finalInventory', 'externalSources', 'boundaryFluxes', 'modeledConversions', 'numericalResidual' ] ) group[ mapName ].energyJ = 0;
			group.residualNorms.energyJ = evidence( 0, 'joule', 'Measured', 'negative-dissipation-mutation' );
			group.acceptanceBounds.energyJ = evidence( 1e-9, 'joule', 'Gated', 'negative-dissipation-mutation' );
			group.modeledDissipation.energyJ = - 1;

		} ),
		'residual-over-gate': semanticRouteCase( ( route ) => { const group = route.physicsInteractions[ 0 ].conservationGroups[ 0 ]; group.finalInventory.linearMomentumNs[ 0 ] = 2e-9; group.numericalResidual.linearMomentumNs[ 0 ] = 2e-9; group.residualNorms.linearMomentumNs.value = 2e-9; } )
	},
	validateStableGenerationIdentity: {
		'slot-used-as-id': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => contactIdentityRejectMutations[ 'slot-used-as-id' ]( bundle ) ),
		'recycle-without-generation': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => contactIdentityRejectMutations[ 'recycle-without-generation' ]( bundle ) )
	},
	validateAuthoritativeGpuRecovery: {
		'partial-checkpoint': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.partialCheckpoint( bundle ) ),
		'double-replay': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.doubleReplay( bundle ) ),
		'lost-generation-reuse': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.lostGenerationReuse( bundle ) )
	},
	validateExternalSolverBoundaryOwnership: {
		'implicit-engine-default': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.implicitEngineDefault( bundle ) ),
		'half-commit': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.halfCommit( bundle ) )
	},
	validatePresentationPublicationClosure: {
		'camera-in-candidate': semanticRouteCase( ( route ) => { route.physicsPresentationCandidate.cameraId = 'illegal-camera'; } ),
		'missing-lease': semanticRouteCase( ( route ) => { route.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].resourceLeaseRefs[ 0 ].leaseId = 'missing-lease'; } ),
		'invented-event-range': semanticRouteCase( ( route ) => {

			const fabricatedRange = route.physicsPresentationCandidate.eventSequenceRanges[ 0 ];
			fabricatedRange.firstSequence ++;
			fabricatedRange.cursorBefore ++;
			for ( const snapshot of Object.values( route.physicsPresentationSnapshotsByTarget ) ) snapshot.eventSequenceRanges = snapshot.eventSequenceRanges.map( ( range ) => range.rangeId === fabricatedRange.rangeId ? clone( fabricatedRange ) : range );

		} )
	},
	validateLeaseConsumerJoinAndRetirement: {
		'early-reuse': semanticRouteCase( ( route ) => { route.frameExecutionRecord.leaseDispositionById[ 'water-current' ].retirementEvidence.completedConsumerKeys.pop(); } ),
		'unrelated-token': semanticRouteCase( ( route ) => { route.frameExecutionRecord.leaseDispositionById[ 'water-current' ].completionJoin.presentationConsumers[ 0 ].deviceLossGeneration = 'unrelated-device-loss-generation'; } ),
		'sibling-view-retirement': semanticRouteCase( ( route ) => { route.frameExecutionRecord.leaseDispositionById[ 'water-current' ].consumingSnapshotIds.pop(); } )
	},
	validateAtomicPhysicsOriginRebase: {
		'partial-owner-rebase': semanticCrossOriginCase( ( route ) => { delete route.physicsGraph.originRebaseTransactions[ 0 ].affectedOwnersAndCommittedVersions[ Object.keys( route.physicsGraph.originRebaseTransactions[ 0 ].affectedOwnersAndCommittedVersions )[ 0 ] ]; } ),
		'stale-epoch-bridge': semanticCrossOriginCase( ( route ) => { route.physicsPresentationCandidate.presentedStatePairs[ 0 ].previousPresented.originEpochBridge.transactionId = 'missing-origin-rebase'; } )
	},
	validateConservativeQualityMigration: {
		'double-emitter': semanticRouteCase( ( route ) => {

			route.physicsQualityTransitions[ 0 ].commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel[ 'water-state/secondary-representation' ] = 'exactly-one-owner-and-representation';

		} ),
		'early-retire': semanticRouteCase( qualityTransitionRejectMutations[ 'early-retire' ] ),
		'silent-inventory-loss': semanticRouteCase( qualityTransitionRejectMutations[ 'silent-inventory-loss' ] )
	},
	validateAlignedCostTraceAndNoCriticalReadback: {
		'mixed-interval-percentiles': semanticRouteCase( ( route ) => { route.physicsCostLedger.cadenceTraceTotals.measurementInterval = clone( route.physicsGraph.coordinationInterval ); refreshCadenceTotalsDigest( route ); } ),
		'frame-critical-readback': semanticRouteCase( ( route ) => { route.physicsCostLedger.hostCompletionsReadbacksPerPresentedFrame.value = 1; } )
	},
	validateComposedCostEnvelope: {
		'opaque-opportunity-resource': semanticRouteCase( ( route ) => {

			route.physicsCostLedger.opportunityTable.resource.contentDigest = 'sha256:missing-opportunity-resource';
			route.physicsCostLedger.opportunityTable.tableDigest = sha256CanonicalExcluding( route.physicsCostLedger.opportunityTable, [ 'tableDigest' ] );

		} ),
		'opportunity-count-mismatch': semanticRouteCase( ( route ) => {

			route.physicsCostLedger.opportunityTable.resource.rowCount.value ++;
			route.physicsCostLedger.opportunityTable.tableDigest = sha256CanonicalExcluding( route.physicsCostLedger.opportunityTable, [ 'tableDigest' ] );

		} ),
		'frontier-missing-objective': semanticRouteCase( ( route ) => { route.physicsCostLedger.worstPermittedCatchUpCost.frontierCoverage.coveredObjectiveDimensions.pop(); } ),
		'catchup-policy-mismatch': semanticRouteCase( ( route ) => { route.physicsCostLedger.worstPermittedCatchUpCost.catchUpPolicyIdentity.maximumCoordinationAdvancesPerPresentationOpportunity.value ++; } ),
		'stale-harness-digest': semanticRouteCase( ( route ) => { route.physicsCostLedger.harness.target.deviceId = 'different-device-with-stale-digest'; } ),
		'migration-evidence-omitted': semanticRouteCase( ( route ) => { route.physicsCostLedger.qualityCostEvidence.find( ( ref ) => ref.outgoingMigrationCostEvidenceIds.length > 0 ).outgoingMigrationCostEvidenceIds.pop(); } )
	},
	validateRegistryAuthorityAndDagClosure: {
		'cyclic-parent': semanticRouteCase( ( route ) => { route.physicsContext.physicsFrameRegistry.framesById[ 'body-frame-1' ].parentFrameId = 'body-frame-1'; } ),
		'mixed-revision': semanticRouteCase( ( route ) => { route.physicsContext.physicsFrameRegistry.framesById[ 'body-frame-1' ].frameId = 'body-frame-renamed-without-registry-swap'; } ),
		'retired-generation-alias': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => contactIdentityRejectMutations[ 'recycle-without-generation' ]( bundle ) )
	},
	validateCoordinationAdvanceAndCatchUp: {
		'double-step': semanticRouteCase( ( route ) => { const claim = clone( route.physicsGraph.executionLedger.stateAdvanceClaims[ 0 ] ); claim.claimId = 'duplicate-step-claim'; route.physicsGraph.executionLedger.stateAdvanceClaims.push( claim ); } ),
		'debt-identity-mismatch': semanticRouteCase( ( route ) => { route.physicsCoordinationAdvanceRecords[ 0 ].debtAfter.seconds.value = 0.001; } ),
		'drop-without-loss-ledger': semanticRouteCase( ( route ) => {

			route.physicsGraph.catchUpPolicy.debtDisposition = 'drop-with-loss-ledger';
			route.physicsGraph.coordinationAdvance.catchUpBatchId = 'missing-catch-up-batch';
			route.physicsGraph.coordinationAdvance.receiptDigest = sha256CanonicalExcluding( route.physicsGraph.coordinationAdvance, [ 'receiptDigest' ] );
			route.physicsCoordinationAdvanceRecords = [ clone( route.physicsGraph.coordinationAdvance ) ];

		} )
	},
	validateDependencyCompletionInstances: {
		'template-as-completion': semanticRouteCase( ( route ) => {

			const completion = route.physicsGraph.executionLedger.dependencyCompletions[ 0 ];
			const priorCompletionId = completion.completionId;
			const templateId = completion.dependencyId;
			const rewriteCompletionRef = ( value, visited = new WeakSet() ) => {

				if ( value === null || typeof value !== 'object' || visited.has( value ) ) return;
				visited.add( value );
				if ( Array.isArray( value ) ) {

					for ( const entry of value ) rewriteCompletionRef( entry, visited );
					return;

				}
				if ( value.completionId === priorCompletionId ) value.completionId = templateId;
				for ( const child of Object.values( value ) ) rewriteCompletionRef( child, visited );

			};
			rewriteCompletionRef( route.physicsGraph );

		} ),
		'generation-mismatch': semanticRouteCase( ( route ) => { route.physicsGraph.executionLedger.dependencyCompletions[ 0 ].deviceBackendResourceGenerations.deviceLossGeneration = 'stale-generation'; } ),
		'missing-acquire': semanticRouteCase( ( route ) => { route.physicsGraph.executionLedger.dependencyCompletions[ 0 ].consumerAcquire.waitToken = 'missing-release-token'; } )
	},
	validateAtomicCommitTransaction: {
		'partial-receipt': semanticRouteCase( ( route ) => { route.physicsGraph.commitTransactions[ 0 ].receipt.committedPublications.pop(); } ),
		'prepared-state-visible': semanticRouteCase( ( route ) => { route.physicsGraph.commitTransactions[ 0 ].receipt.committedPublications[ 0 ].stateVersion = route.physicsGraph.commitGroups[ 0 ].preparedPublications[ 0 ].preparedVersion.stateVersion; } ),
		'digest-mismatch': semanticRouteCase( ( route ) => { route.physicsGraph.commitTransactions[ 0 ].receipt.receiptDigest = 'sha256:mismatched-transaction-receipt'; } )
	},
	validateCouplingIterationLineage: {
		'future-iteration-read': semanticRouteCase( ( route ) => { route.physicsGraph.loopMacros[ 0 ].perIterationLedger[ 1 ].inputVersions[ 0 ].stateVersion = 'loop-42/iteration-2/water/subcycle-2'; } ),
		'rejected-egress': semanticRouteCase( ( route ) => { const loop = route.physicsGraph.loopMacros[ 0 ]; loop.acceptedWrites = clone( loop.perIterationLedger[ 1 ].outputVersions ); } ),
		'accepted-digest-mismatch': semanticRouteCase( ( route ) => { route.physicsGraph.loopMacros[ 0 ].acceptedWriteLineage[ 0 ].iterationOutputDigest = 'sha256:wrong-accepted-iteration'; } )
	},
	validatePhysicalImpactPartitionClosure: {
		overlap: semanticBundleCase( 'physicalImpactPartitionBundle', ( bundle ) => physicalImpactPartitionRejectMutations.overlap( fixtureModuleHelpers, bundle ) ),
		'missing-partition': semanticBundleCase( 'physicalImpactPartitionBundle', ( bundle ) => physicalImpactPartitionRejectMutations[ 'missing-partition' ]( fixtureModuleHelpers, bundle ) ),
		'visual-child-authority': semanticBundleCase( 'physicalImpactPartitionBundle', ( bundle ) => physicalImpactPartitionRejectMutations[ 'visual-child-authority' ]( fixtureModuleHelpers, bundle ) )
	},
	validateExactOnceInteractionApplication: {
		'repeat-integral': semanticRouteCase( ( route ) => { const ledger = route.physicsGraph.executionLedger.interactionApplicationLedgers[ 0 ]; ledger.cursorAfter = ledger.cursorBefore; route.physicsInteractionApplicationLedgers[ ledger.applicationLedgerId ].cursorAfter = ledger.cursorBefore; } ),
		'out-of-overlap-rate': semanticRouteCase( ( route ) => { const exchange = route.physicsInteractions[ 0 ]; const record = exchange.interactions[ 0 ]; const ledger = route.physicsGraph.executionLedger.interactionApplicationLedgers.find( ( candidate ) => candidate.interactionId === record.interactionId ); record.payload.timeSemantics = 'rate'; ledger.payloadTimeSemantics = 'rate'; ledger.executionOverlapInterval = clone( route.physicsGraph.executionLedger.stageExecutions[ 0 ].executionInterval ); route.physicsInteractionApplicationLedgers[ ledger.applicationLedgerId ] = clone( ledger ); } ),
		'replay-committed-key': semanticRouteCase( ( route ) => { const exchange = route.physicsInteractions[ 0 ]; const firstRecord = exchange.interactions[ 0 ]; const secondRecord = exchange.interactions[ 1 ]; const secondLedger = route.physicsGraph.executionLedger.interactionApplicationLedgers.find( ( candidate ) => candidate.interactionId === secondRecord.interactionId ); secondRecord.exactOnceKey = firstRecord.exactOnceKey; secondLedger.exactOnceKey = firstRecord.exactOnceKey; route.physicsInteractionApplicationLedgers[ secondLedger.applicationLedgerId ] = clone( secondLedger ); } )
	},
	validateDeformingAndFluidBoundaryProxy: {
		'missing-velocity': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => {

			bundle.deformingSupportProxies[ 0 ].velocitySampler = typedAbsence( 'unavailable', 'deforming-support-owner', 'timeless', 'velocity sampler intentionally withheld' );
			return bundle;

		} ),
		'stale-remap': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => contactIdentityRejectMutations[ 'stale-remap' ]( bundle ) ),
		'unlatched-material-selection': semanticBundleCase( 'contactIdentityBundle', ( bundle ) => contactIdentityRejectMutations[ 'unlatched-material-selection' ]( bundle ) )
	},
	validateExternalDirectionalCapability: {
		'ambiguous-capability': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.ambiguousCapability( bundle ) ),
		'missing-exact-once': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.missingExactOnce( bundle ) ),
		'receipt-dependency-mismatch': semanticBundleCase( 'externalGpuBundle', ( bundle ) => externalGpuRejectMutations.receiptDependencyMismatch( bundle ) )
	},
	validatePresentationCohortAndSlotAdmission: {
		'prepared-version': semanticRouteCase( ( route ) => { route.physicsPresentationCandidate.commitProvenance.committedStateVersions[ 0 ].stateVersion = 'gravity-42/prepared'; } ),
		'skew-over-gate': semanticRouteCase( ( route ) => { route.frameExecutionRecord.cohortAdmission.observedMaximumSkew.seconds.value = 0.01; } ),
		'occupied-slot': semanticRouteCase( ( route ) => { route.frameExecutionRecord.slotAdmissions[ 0 ].observedFramesInFlightAtAdmission = route.frameExecutionRecord.slotAdmissions[ 0 ].configuredMaximumFramesInFlight; } )
	},
	validateImmutableRenderPlanClosure: {
		'missing-edge': semanticRouteCase( ( route ) => {

			const plan = route.physicsPresentationRenderPlansByTarget[ 'main/main-view' ];
			const missingEdge = plan.edges[ 1 ];
			const unrelatedEdge = clone( plan.edges[ 0 ] );
			unrelatedEdge.edgeId = `${ missingEdge.edgeId }-unrelated-replacement`;
			unrelatedEdge.dependencyRef.dependencyId = `${ missingEdge.dependencyRef.dependencyId }-unrelated-replacement`;
			unrelatedEdge.completionRef = {
				...unrelatedEdge.completionRef,
				completionId: `${ missingEdge.completionRef.completionId }-unrelated-replacement`,
				dependencyId: unrelatedEdge.dependencyRef.dependencyId
			};
			plan.edges[ 1 ] = unrelatedEdge;

		} ),
		'history-generation-mismatch': semanticRouteCase( ( route ) => { route.physicsPresentationRenderPlansByTarget[ 'main/main-view' ].expectedResetHistoryGenerations[ 'reset-water-history-main/main-view' ].outputHistoryGeneration = 'stale-history-generation'; } ),
		'duplicate-shadow-factor': semanticRouteCase( ( route ) => { const plan = route.physicsPresentationRenderPlansByTarget[ 'main/main-view' ]; plan.shadowFactorIds.push( plan.shadowFactorIds[ 0 ] ); } )
	},
	validateQualityRequestAndAllocationAdmission: {
		'work-before-admission': semanticRouteCase( qualityTransitionRejectMutations[ 'work-before-admission' ] ),
		'scope-widening': semanticRouteCase( qualityTransitionRejectMutations[ 'scope-widening' ] ),
		'insufficient-overlap-capacity': semanticRouteCase( qualityTransitionRejectMutations[ 'insufficient-overlap-capacity' ] )
	},
	validateMemoryTrafficAndWorkAttribution: {
		'unledgered-allocation': semanticRouteCase( ( route ) => { route.physicsCostLedger.hotState.allocations[ 0 ].allocationId = 'unrelated-hot-state-allocation'; } ),
		'unledgered-transfer': semanticRouteCase( ( route ) => {

			const trafficRecordId = route.physicsCostLedger.uploadsCopiesMaps.at( - 1 ).trafficRecordId;
			for ( const attribution of route.physicsCostLedger.workAttribution ) attribution.trafficRecordIds = attribution.trafficRecordIds.filter( ( id ) => id !== trafficRecordId );

		} ),
		'shared-work-double-count': semanticRouteCase( ( route ) => { const duplicate = clone( route.physicsCostLedger.workAttribution[ 0 ] ); duplicate.workKey = 'duplicate-shared-work'; route.physicsCostLedger.workAttribution.push( duplicate ); } )
	},
	validateCadenceTraceTotals: {
		'percentile-product': semanticRouteCase( ( route ) => { route.physicsCostLedger.cadenceTraceTotals.coordinationAdvanceCount.source = 'p95-product-is-not-an-exact-total'; refreshCadenceTotalsDigest( route ); } ),
		'count-mismatch': semanticRouteCase( ( route ) => { route.physicsCostLedger.cadenceTraceTotals.stageExecutionCounts[ 'predict-body' ].value ++; refreshCadenceTotalsDigest( route ); } ),
		'mixed-trace': semanticRouteCase( ( route ) => { route.physicsCostLedger.cadenceTraceTotals.stageExecutionCounts[ 'predict-body' ].source = 'different-trace'; refreshCadenceTotalsDigest( route ); } )
	}
} );

const semanticInvariantStructuralRejects = Object.freeze( {
	validateClockMappingEvaluation: {
		'unlogged-external-query': {
			subject: 'PhysicsClockDescriptor',
			justification: 'The external-clock policy is a schema const because permitting an unlogged query has no valid ABI representation.'
		}
	},
	validateInteractionDeliveryAndReactionAtomicity: {
		'partial-reaction': {
			subject: 'InteractionReactionGroup',
			justification: 'Reaction-group acceptance is structurally all-or-none; partial acceptance is intentionally outside the ABI.'
		}
	},
	validatePresentationPublicationClosure: {
		'camera-in-candidate': {
			subject: 'PhysicsPresentationCandidate',
			justification: 'Candidate view-independence is structural: camera state is a forbidden additional property and belongs in its publication.'
		}
	}
} );

const semanticInvariantRegistry = Object.fromEntries( Object.keys( semanticInvariantChecks ).map( ( validator ) => [ validator, {
	check: semanticInvariantChecks[ validator ],
	makeFixture: makeSemanticInvariantFixture,
	accepts: semanticInvariantAcceptCases[ validator ],
	rejects: semanticInvariantRejectCases[ validator ],
	structuralRejects: semanticInvariantStructuralRejects[ validator ] ?? {},
	subjects: resolveSemanticSubjects,
	validateRecord: validateSemanticSubjectRecord
} ] ) );
const requestedSemanticValidator = process.env.PHYSICS_SEMANTIC_VALIDATOR;
const semanticInvariantsForRun = requestedSemanticValidator ? physicsAbiSchema[ 'x-semantic-invariants' ].filter( ( invariant ) => invariant.validator === requestedSemanticValidator ) : physicsAbiSchema[ 'x-semantic-invariants' ];
if ( requestedSemanticValidator ) assert.equal( semanticInvariantsForRun.length, 1, `unknown PHYSICS_SEMANTIC_VALIDATOR ${ requestedSemanticValidator}` );
const semanticSchemaForRun = requestedSemanticValidator ? { ...physicsAbiSchema, 'x-semantic-invariants': semanticInvariantsForRun } : physicsAbiSchema;
const semanticRegistryForRun = requestedSemanticValidator ? { [ requestedSemanticValidator ]: semanticInvariantRegistry[ requestedSemanticValidator ] } : semanticInvariantRegistry;
const semanticRegistryStartedAtMs = performance.now();
const semanticInvariantRegistryResult = runSemanticInvariantRegistry( semanticSchemaForRun, semanticRegistryForRun );
const semanticRegistryDurationMs = performance.now() - semanticRegistryStartedAtMs;
const expectedSemanticAccepts = semanticInvariantsForRun.reduce( ( total, invariant ) => total + invariant.fixtures.accept.length, 0 );
const expectedSemanticRejects = semanticInvariantsForRun.reduce( ( total, invariant ) => total + invariant.fixtures.reject.length, 0 );
assert.deepEqual( [ semanticInvariantRegistryResult.invariantCount, semanticInvariantRegistryResult.validatorCount, semanticInvariantRegistryResult.acceptCaseCount, semanticInvariantRegistryResult.rejectCaseCount ], [ semanticInvariantsForRun.length, semanticInvariantsForRun.length, expectedSemanticAccepts, expectedSemanticRejects ], 'semantic invariant registry executable closure mismatch' );
if ( requestedSemanticValidator && process.env.PHYSICS_SEMANTIC_ONLY === '1' ) {

	console.log( JSON.stringify( { pass: true, physicsSetupTimingsMs, semanticInvariantRegistryResult, semanticBindingDurationMs, semanticRegistryDurationMs }, null, 2 ) );
	process.exit( 0 );

}

let negativeCaseCount = 0;
function expectReject( name, mutate, pattern ) {

	const fixture = clone( positiveFixtures[ 0 ] );
	mutate( fixture );
	assert.throws( () => validateRouteManifest( fixture ), undefined, name );
	negativeCaseCount ++;

}

function expectPhysicsReject( name, mutate, pattern ) {

	const fixture = clone( coupledPhysicsFixture );
	mutate( fixture );
	assert.throws( () => validateRouteManifest( fixture ), undefined, name );
	negativeCaseCount ++;

}

for ( const [ name, mutate ] of Object.entries( providerWaterRejectMutations ) ) {

	const rejectedBundle = mutate( fixtureModuleHelpers, providerWaterBundle );
	assert.throws( () => validateProviderWaterBundle( fixtureModuleHelpers, rejectedBundle, coupledPhysicsFixture ), undefined, `provider/water reject fixture ${ name } was accepted` );
	negativeCaseCount ++;

}
for ( const [ name, mutate ] of Object.entries( externalGpuRejectMutations ) ) {

	const rejectedBundle = mutate( externalGpuBundle );
	assert.throws( () => validateExternalGpuFixtureBundle( fixtureModuleHelpers, coupledPhysicsFixture, rejectedBundle ), undefined, `external/GPU reject fixture ${ name } was accepted` );
	negativeCaseCount ++;

}
for ( const [ name, mutate ] of Object.entries( contactIdentityRejectMutations ) ) {

	const rejectedBundle = mutate( contactIdentityBundle );
	assert.throws( () => validateContactIdentityBundle( fixtureModuleHelpers, coupledPhysicsFixture, rejectedBundle ), undefined, `contact/identity reject fixture ${ name } was accepted` );
	negativeCaseCount ++;

}
for ( const [ name, mutate ] of Object.entries( physicalImpactPartitionRejectMutations ) ) {

	const rejectedBundle = mutate( fixtureModuleHelpers, physicalImpactPartitionBundle );
	assert.throws( () => validatePhysicalImpactPartitionBundle( fixtureModuleHelpers, coupledPhysicsFixture, rejectedBundle ), undefined, `physical-impact partition reject fixture ${ name } was accepted` );
	negativeCaseCount ++;

}
for ( const [ name, mutate ] of Object.entries( qualityTransitionRejectMutations ) ) {

	const rejectedRoute = clone( coupledPhysicsFixture );
	mutate( rejectedRoute );
	assert.throws( () => validateQualityTransitionBundle( fixtureModuleHelpers, rejectedRoute ), undefined, `quality-transition reject fixture ${ name } was accepted` );
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
const abortedMapRenderPlanId = abortedExecutionFixture.physicsPresentationRenderPlansByTarget[ 'minimap/map-view' ].renderPlanId;
delete abortedExecutionFixture.physicsPresentationSnapshotsByTarget[ 'minimap/map-view' ];
delete abortedExecutionFixture.physicsPresentationRenderPlansByTarget[ 'minimap/map-view' ];
abortedExecutionFixture.frameExecutionRecord.overallStatus = 'partial-failure';
abortedExecutionFixture.frameExecutionRecord.snapshotIds = [ abortedExecutionFixture.physicsPresentationSnapshotsByTarget[ 'main/main-view' ].snapshotId ];
abortedExecutionFixture.frameExecutionRecord.renderPlans = abortedExecutionFixture.frameExecutionRecord.renderPlans.filter( ( plan ) => plan.renderPlanId !== abortedMapRenderPlanId );
abortedExecutionFixture.frameExecutionRecord.slotAdmissions = abortedExecutionFixture.frameExecutionRecord.slotAdmissions.filter( ( slot ) => `${ slot.presentationTargetId }/${ slot.viewId }` !== 'minimap/map-view' );
abortedExecutionFixture.frameExecutionRecord.cohortAdmission.snapshotIds = abortedExecutionFixture.frameExecutionRecord.cohortAdmission.snapshotIds.filter( ( id ) => id !== abortedMapSnapshotId );
abortedExecutionFixture.frameExecutionRecord.cohortAdmission.renderPlanIds = abortedExecutionFixture.frameExecutionRecord.cohortAdmission.renderPlanIds.filter( ( id ) => id !== abortedMapRenderPlanId );
abortedExecutionFixture.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ] = { snapshotId: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'aborted before seal' ), renderPlanId: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'aborted before plan sealing' ), slotAdmissionId: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'aborted before slot admission' ), presentationTargetId: 'minimap', viewId: 'map-view', status: 'aborted', submittedPasses: [], queueSubmissionEpochs: [], actionResults: [], resetActionResults: [], completionTokens: [], presentedTimestamp: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'target was not presented' ), failure: { code: 'validation-abort', cause: 'fixture pre-seal abort' } };
for ( const [ leaseId, disposition ] of Object.entries( abortedExecutionFixture.frameExecutionRecord.leaseDispositionById ) ) {

	disposition.consumingSnapshotIds = disposition.consumingSnapshotIds.filter( ( id ) => id !== abortedMapSnapshotId );
	const cancelledConsumerKeys = disposition.completionJoin.presentationConsumers.filter( ( consumer ) => consumer.presentationTargetId === 'minimap' && consumer.viewId === 'map-view' ).map( ( consumer ) => consumer.consumerKey ).sort();
	const completedConsumerKeys = disposition.completionJoin.requiredConsumerKeys.filter( ( key ) => ! cancelledConsumerKeys.includes( key ) ).sort();
	disposition.retirementEvidence = { joinId: disposition.completionJoin.joinId, joinDigest: disposition.completionJoin.joinDigest, completedConsumerKeys, cancelledConsumerKeys, joinResolution: 'completed-or-reservation-cancelled', status: cancelledConsumerKeys.length > 0 ? 'aborted reservations cancelled' : 'all required consumers completed' };
	disposition.disposition = leaseId === 'map-view' ? 'retired-after-abort' : 'retained-until-join';

}
abortedExecutionFixture.physicsQualityRequests = {};
abortedExecutionFixture.physicsQualityStates = {};
abortedExecutionFixture.physicsQualityTransitions = [];
validateRouteManifest( abortedExecutionFixture );

const deviceLossExecutionFixture = clone( coupledPhysicsFixture );
deviceLossExecutionFixture.frameExecutionRecord.overallStatus = 'device-lost';
for ( const target of Object.values( deviceLossExecutionFixture.frameExecutionRecord.targetExecutions ) ) {

	target.status = 'device-lost';
	target.completionTokens = [];
	target.presentedTimestamp = typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'device lost before presentation completion' );
	target.actionResults = [ { status: 'device-lost-after-submit', phaseIds: [] } ];
	target.failure = { code: 'device-lost', cause: 'fixture device-generation-1 loss' };

}
const deviceLossFullLeases = [ ...deviceLossExecutionFixture.physicsPresentationCandidate.resourceLeases, ...Object.values( deviceLossExecutionFixture.physicsViewPreparationPublicationsByTarget ).flatMap( ( preparation ) => preparation.resourceLeases ) ];
const deviceLossLeaseById = new Map( deviceLossFullLeases.map( ( lease ) => [ lease.leaseId, lease ] ) );
for ( const [ leaseId, disposition ] of Object.entries( deviceLossExecutionFixture.frameExecutionRecord.leaseDispositionById ) ) {

	disposition.disposition = 'invalidated-by-device-loss';
	const lease = deviceLossLeaseById.get( leaseId );
	disposition.retirementEvidence = { lostDeviceLossGeneration: lease.deviceLossGeneration, lostResourceGeneration: lease.resourceGeneration };

}
deviceLossExecutionFixture.physicsQualityRequests = {};
deviceLossExecutionFixture.physicsQualityStates = {};
deviceLossExecutionFixture.physicsQualityTransitions = [];
validateRouteManifest( deviceLossExecutionFixture );

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

	route.physicsContext.physicsClockRegistry.clocksById[ 'weather-nonuniform' ].mapping.fixedRational = { epochSeconds: evidence( 0, 'second', 'Authored', 'mutation' ), secondsPerTick: evidence( 1, 'second-per-tick', 'Authored', 'mutation' ) };

}, /exactly its timestampTable mapping arm/ );
expectPhysicsReject( 'nonuniform clock deletes its active mapping arm', ( route ) => {

	delete route.physicsContext.physicsClockRegistry.clocksById[ 'weather-nonuniform' ].mapping.timestampTable;

}, /exactly its timestampTable mapping arm/ );
expectPhysicsReject( 'timestamp clock changes normative interpolation', ( route ) => {

	route.physicsContext.physicsClockRegistry.clocksById[ 'weather-nonuniform' ].mapping.timestampTable.interpolationRule = 'cubic-spline';

}, /interpolation rule drift/ );
expectPhysicsReject( 'external clock permits unlogged evaluation', ( route ) => {

	route.physicsContext.physicsClockRegistry.clocksById[ 'contact-event' ].mapping.external.unloggedQueryPolicy = 'best-effort';

}, /must reject unlogged evaluations/ );
expectPhysicsReject( 'external clock content-addressed table has wrong digest', ( route ) => {

	route.physicsContext.physicsClockRegistry.clocksById[ 'contact-event' ].mapping.external.frozenEvaluationTable.knotTable.resourceRef.contentDigest = 'sha256:missing';

}, /cannot resolve content digest/ );
expectPhysicsReject( 'adaptive signal uses unregistered clock', ( route ) => {

	route.physicsSignals.waterSurface.clockId = 'missing-adaptive-clock';

}, /unregistered clock/ );
expectPhysicsReject( 'frame shear is not a rotation', ( route ) => {

	route.physicsContext.physicsFrameRegistry.framesById[ 'physics-world-y-up' ].parentFromFrameRotation[ 1 ] = 0.25;

}, /not orthogonal|not orthonormal/ );
expectPhysicsReject( 'gravity provider version mismatch', ( route ) => {

	route.physicsContext.gravityProvider.descriptorStateVersion = 'gravity-stale';

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

	const write = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-water' ).writes.find( ( candidate ) => candidate.disposition === 'transaction-prepared' );
	write.commitGroupId = 'forcing-commit';

}, /assigned to another commit group/ );
expectPhysicsReject( 'duplicate graph writer', ( route ) => {

	const stage = route.physicsGraph.stages.find( ( entry ) => entry.stageId === 'correct-body' );
	const duplicate = clone( stage.writes[ 0 ] );
	duplicate.writeId = `${ duplicate.writeId }-duplicate`;
	stage.writes.push( duplicate );

}, /duplicate writers/ );
expectPhysicsReject( 'graph read has no edge', ( route ) => {

	route.physicsGraph.edges = route.physicsGraph.edges.filter( ( edge ) => edge.edgeId !== 'body-to-water-solve' );

}, /has no exact edge/ );
expectPhysicsReject( 'graph edge version mismatch', ( route ) => {

	route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'water-to-correction' ).requiredVersionAndPhase.stateVersionRule = 'water-wrong';

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

	const dependencyId = route.physicsGraph.edges[ 0 ].barrier.dependencyId;
	route.physicsGraph.dependencies.find( ( dependency ) => dependency.dependencyId === dependencyId ).kind = 'none';

}, /lacks a GPU ordering barrier/ );
expectPhysicsReject( 'outer graph cycle', ( route ) => {

	const correctWater = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-water' );
	const correctBody = route.physicsGraph.stages.find( ( stage ) => stage.stageId === 'correct-body' );
	const bodyRead = clone( correctBody.reads[ 0 ] );
	bodyRead.readId = 'correct-water/read-cycle';
	correctWater.reads.push( bodyRead );
	const waterRead = clone( correctWater.reads[ 0 ] );
	waterRead.readId = 'correct-body/read-cycle';
	correctBody.reads.push( waterRead );
	const bodyToWater = clone( route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'body-to-correction' ) );
	bodyToWater.edgeId = 'correct-body-to-correct-water'; bodyToWater.producerStageId = 'correct-body'; bodyToWater.consumerStageId = 'correct-water'; bodyToWater.barrier.dependencyId = 'dependency-correct-body-to-correct-water'; bodyToWater.requiredVersionAndPhase.stateVersionRule = 'body-42/prepared';
	const waterToBody = clone( route.physicsGraph.edges.find( ( edge ) => edge.edgeId === 'water-to-correction' ) );
	waterToBody.edgeId = 'correct-water-to-correct-body'; waterToBody.producerStageId = 'correct-water'; waterToBody.consumerStageId = 'correct-body'; waterToBody.barrier.dependencyId = 'dependency-correct-water-to-correct-body'; waterToBody.requiredVersionAndPhase.stateVersionRule = 'water-42/prepared';
	route.physicsGraph.edges.push( bodyToWater, waterToBody );

}, /contains a cycle/ );
expectPhysicsReject( 'loop publication is non-atomic', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].acceptedIteratePublication = 'streaming';

}, /accepted iterate atomically/ );
expectPhysicsReject( 'loop accepted write escapes namespace', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].acceptedWrites[ 0 ].stateVersion = 'water-42';

}, /loop-scoped provisional versions/ );
expectPhysicsReject( 'dependency completion inventory is empty', ( route ) => {

	route.physicsGraph.executionLedger.dependencyCompletions = [];
	for ( const execution of route.physicsGraph.executionLedger.stageExecutions ) execution.dependencyCompletions = [];

} );
expectPhysicsReject( 'graph contains an extra unused dependency template', ( route ) => {

	const dependency = clone( route.physicsGraph.dependencies[ 0 ] );
	dependency.dependencyId = 'unused-shape-valid-dependency-template';
	route.physicsGraph.dependencies.push( dependency );

} );
expectPhysicsReject( 'dependency completion generation is stale', ( route ) => {

	route.physicsGraph.executionLedger.dependencyCompletions[ 0 ].deviceBackendResourceGenerations.deviceLossGeneration = 'stale-device-loss-generation';

} );
expectPhysicsReject( 'dependency completion acquire token is unrelated', ( route ) => {

	route.physicsGraph.executionLedger.dependencyCompletions[ 0 ].consumerAcquire.waitToken = 'unrelated-release-token';

} );
expectPhysicsReject( 'execution omits all exact read resolutions', ( route ) => {

	const execution = route.physicsGraph.executionLedger.stageExecutions.find( ( row ) => row.readResolutions.length > 0 );
	execution.readResolutions = [];

} );
expectPhysicsReject( 'execution invents a write resolution', ( route ) => {

	const execution = route.physicsGraph.executionLedger.stageExecutions.find( ( row ) => row.writeResolutions.length > 0 );
	const invented = clone( execution.writeResolutions[ 0 ] );
	invented.writeId = 'invented-write-resolution';
	execution.writeResolutions.push( invented );

} );
expectPhysicsReject( 'accepted iterate escapes namespace consistently', ( route ) => {

	const loop = route.physicsGraph.loopMacros[ 0 ];
	const accepted = loop.perIterationLedger[ loop.acceptedIterationIndex ];
	accepted.outputVersions[ 0 ].stateVersion = 'escaped/accepted/water';
	loop.acceptedWrites[ 0 ].stateVersion = 'escaped/accepted/water';
	loop.acceptedWriteLineage[ 0 ].provisionalVersion.stateVersion = 'escaped/accepted/water';

} );
expectPhysicsReject( 'commit receipt contains only a partial publication set', ( route ) => {

	route.physicsGraph.commitTransactions[ 0 ].receipt.committedPublications.pop();

} );
expectPhysicsReject( 'prepared publication becomes externally visible', ( route ) => {

	route.physicsGraph.commitGroups[ 0 ].preparedPublications[ 0 ].visibility = 'committed-visible';

} );
expectPhysicsReject( 'commit publication-set digest is fabricated', ( route ) => {

	route.physicsGraph.commitTransactions[ 0 ].publicationSetDigest = 'sha256:fabricated-publication-set';

} );
expectPhysicsReject( 'route commit-transaction registry drifts from graph', ( route ) => {

	route.physicsCommitTransactions[ 'coordination-commit-transaction-42' ].status = 'prepared';

} );
expectPhysicsReject( 'loop iteration omits an ordered stage execution', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].perIterationLedger[ 1 ].stageExecutionIds.pop();

} );
expectPhysicsReject( 'loop seed reads future provisional state', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].perIterationLedger[ 0 ].inputVersions[ 0 ].stateVersion = 'loop-42/iteration-1/water/subcycle-2';

} );
expectPhysicsReject( 'loop accepted lineage digest is stale', ( route ) => {

	route.physicsGraph.loopMacros[ 0 ].acceptedWriteLineage[ 0 ].iterationOutputDigest = 'sha256:stale-accepted-output';

} );
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

	route.physicsInteractions[ 0 ].reactions[ 0 ].payload.linearMomentumNs[ 0 ] += 1;

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
	route.frameExecutionRecord.targetExecutions[ 'minimap/map-view' ] = { snapshotId: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'aborted before seal' ), presentationTargetId: 'minimap', viewId: 'map-view', status: 'aborted', submittedPasses: [], queueSubmissionEpochs: [], actionResults: [], completionTokens: [ 'fake-complete' ], presentedTimestamp: typedAbsence( 'unavailable', 'frame-execution-owner', 'timeless', 'target was not presented' ), failure: { code: 'validation-abort', cause: 'fixture pre-seal abort' } };
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
expectPhysicsReject( 'cost ledger normalizes independent views by an implicit frame count', ( route ) => {

	route.physicsCostLedger.cadenceTraceTotals.presentedFrameCounts[ 'minimap/map-view' ].value = 6000;
	refreshCadenceTotalsDigest( route );

}, /must declare denominatorTargetViewKey/ );
expectPhysicsReject( 'cost ledger allows frame-critical readback', ( route ) => {

	route.physicsCostLedger.hostCompletionsReadbacksPerPresentedFrame.value = 1;

}, /frame-critical host readback/ );
expectPhysicsReject( 'cost ledger misses stage hot bytes', ( route ) => {

	delete route.physicsCostLedger.hotBytesReadWrittenPerExecution[ 'solve-water' ];

}, /lacks hot-byte traffic/ );
expectPhysicsReject( 'cost ledger exceeds device binding limit', ( route ) => {

	route.physicsCostLedger.bindingAndDeviceLimits[ 0 ].demand.value = 8;

}, /exceeds the device limit/ );
{

	const nonMobileCanonicalCoverage = clone( coupledPhysicsFixture );
	nonMobileCanonicalCoverage.physicsCostLedger.harness.target = {
		deviceId: 'desktop-workstation', osAndBrowserBuild: 'desktop-os/browser-build', gpuAdapterAndDriver: 'desktop-discrete-adapter-driver',
		backendAndDeviceGeneration: { backend: 'WebGPU', backendGeneration: 'desktop-backend-generation', deviceLossGeneration: 'desktop-device-generation' },
		displayModeAndMeasuredRefresh: { mode: 'foreground-vsync', refresh: evidence( 60, 'hertz', 'Measured', 'desktop-display-probe' ) },
		powerSourceAndGovernor: { source: 'mains', governor: 'desktop-balanced-policy' }, thermalStartAndStabilizationPolicy: { start: 'conditioned-nominal', sustainedDuration: evidence( 300, 'second', 'Authored', 'desktop-sustained-protocol' ) }
	};
	assert.throws(
		() => assertCanonicalCoupledFixtureCoverage( nonMobileCanonicalCoverage ),
		/mobile\/low-end harness/,
		'canonical stress coverage accepted a non-mobile harness'
	);
	negativeCaseCount ++;

}
{

	const shortCanonicalCoverage = clone( coupledPhysicsFixture );
	shortCanonicalCoverage.physicsCostLedger.graphStageCosts[ 0 ].sampleCount.value = 20;
	assert.throws(
		() => assertCanonicalCoupledFixtureCoverage( shortCanonicalCoverage ),
		/sustained stage samples/,
		'canonical stress coverage accepted an undersampled stage trace'
	);
	negativeCaseCount ++;

}

assertPhysicsFieldsInYaml( templateRouteYaml, 'template routeManifest' );
for ( const recipeName of recipeNames ) assertRecipeManifest( recipes, recipeName );

console.log( JSON.stringify( {
	pass: true,
	recipeCount: recipeNames.length,
	positiveFixtureDomains: positiveSpecs.map( ( spec ) => spec.domain ),
	coupledPhysicsFixture: true,
	semanticInvariantRegistry: semanticInvariantRegistryResult,
	negativeCaseCount,
	templateSections: templateSections.length
}, null, 2 ) );
