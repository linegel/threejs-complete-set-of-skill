import assert from 'node:assert/strict';
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
			'requiredSignals', 'domainSignals', 'outputOwnersByPresentationTarget',
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
	assertNoAutomaticGBufferInYaml( yaml, recipeName );
	assertStructuredAcceptanceInYaml( yaml, recipeName );
	assertNoAdditivePercentileText( yaml, recipeName );

}

function isPlainObject( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function requireObjectKeys( object, keys, label ) {

	assert.ok( isPlainObject( object ), `${ label } must be a mapping` );
	for ( const key of keys ) assert.ok( Object.hasOwn( object, key ), `${ label } missing ${ key }` );

}

function validateNumericEvidence( value, path = 'route' ) {

	if ( typeof value === 'number' || ( typeof value === 'string' && /^-?\d+(\.\d+)?$/.test( value ) ) ) {

		throw new Error( `${ path } is a bare numeric value` );

	}

	if ( Array.isArray( value ) ) {

		for ( let i = 0; i < value.length; i ++ ) validateNumericEvidence( value[ i ], `${ path }[${ i }]` );
		return;

	}

	if ( ! isPlainObject( value ) ) return;

	const evidenceKeyCount = numericEvidenceKeys.filter( ( key ) => Object.hasOwn( value, key ) ).length;
	const declaresEvidence = [ 'value', 'unit', 'label' ].some( ( key ) => Object.hasOwn( value, key ) );
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
		'requiredSignals', 'domainSignals', 'outputOwnersByPresentationTarget',
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
					viewScope: {
						view: 'main',
						timeSample: evidence( 0, 'seconds', 'Authored', 'fixture-path' )
					},
					resolution: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport-and-dpr' ),
					sampleCount: evidence( 1, 'samples-per-pixel', 'Measured', 'fixture-pass' ),
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
					viewScope: {
						view: 'main',
						timeSample: evidence( 0, 'seconds', 'Authored', 'fixture-path' )
					},
					resolution: evidence( [ 1280, 720 ], 'physical-pixels', 'Derived', 'fixture-viewport-and-dpr' ),
					sampleCount: evidence( 1, 'samples-per-pixel', 'Measured', 'fixture-pass' ),
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

const skill = await readText( 'SKILL.md' );
const recipes = await readText( 'references/router-recipes.md' );
const template = await readText( 'examples/router-preflight-template.md' );
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
	'ocean planet',
	'rainy city street',
	'forest flythrough',
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
	[ 'selectedSkills', 'omittedSkills', 'primaryOwner', 'deferredSkills', 'owners', 'requiredSignals', 'domainSignals', 'outputOwnersByPresentationTarget', 'sharedResourceOwners', 'spaceAndOwnerHandoff' ],
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
	[ 'aggregationPolicy', 'drawAccounting', 'mrtDecision', 'costRecords', 'passLedger', 'qualityController', 'routeStatus' ],
	'template performanceContract'
);
assertInlineNumericEvidence( templatePerformanceFields.get( 'frameInterval' ), 'template frameInterval' );
assertStructuredAcceptanceInYaml( templateAcceptanceYaml, 'template' );

for ( const pattern of [
	/backendManifest:/,
	/workloadProfile:/,
	/causeLedger:/,
	/owners:/,
	/requiredSignals:/,
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

let negativeCaseCount = 0;
function expectReject( name, mutate, pattern ) {

	const fixture = clone( positiveFixtures[ 0 ] );
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

console.log( JSON.stringify( {
	pass: true,
	recipeCount: recipeNames.length,
	positiveFixtureDomains: positiveSpecs.map( ( spec ) => spec.domain ),
	negativeCaseCount,
	templateSections: templateSections.length
}, null, 2 ) );
