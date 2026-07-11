import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname( fileURLToPath( import.meta.url ) );

const REQUIRED_SHARED_RESOURCES = Object.freeze( [
	'primaryScenePass',
	'weatherEnvelope',
	'toneMap',
	'outputTransform'
] );

const REQUIRED_NAMED_MRT_CANDIDATES = Object.freeze( [
	'albedo',
	'emissive',
	'normal',
	'velocity'
] );

const FORBIDDEN_UNCONDITIONAL_SIGNALS = Object.freeze( [
	'output',
	'normal',
	'albedo',
	'emissive',
	'velocity'
] );

const REQUIRED_WEATHER_FIELDS = Object.freeze( [
	'time',
	'deltaTime',
	'wind',
	'progress',
	'precipitationRate',
	'cloudCoverage',
	'seaState',
	'qualityTier',
	'debugMode'
] );

const EXPECTED_GRAPH_ORDER = Object.freeze( [
	'stable scene-linear lighting, AO, atmosphere, and eligible layers',
	'optional temporal reconstruction of stable scene radiance',
	'transparent or refractive layers excluded from temporal history',
	'optional exposure meter tap from resolved pre-bloom scene-linear HDR',
	'optional bloom and other scene-linear optical effects',
	'optional adapted exposure',
	'tone map',
	'optional grading in its declared domain',
	'single output conversion'
] );

const ALLOWED_NUMERIC_TAGS = Object.freeze( [ 'Derived', 'Gated', 'Measured', 'Authored' ] );
const AUTHORED_SINGLE_OWNER_COUNT = 1; // [Authored] Static single-owner architecture constraint.
const DERIVED_EMPTY_SELECTION_COUNT = 0; // [Derived] The static contract deliberately selects no named MRT candidates.
const NODE_FAILURE_EXIT_CODE = 1; // [Derived] Conventional non-zero Node.js process failure status.
const DERIVED_CLI_SCRIPT_ARG_INDEX = 1; // [Derived] Node.js reserves argv[0] for the executable path.
const AUTHORED_JSON_INDENT_SPACES = 2; // [Authored] Human-readable validator output formatting.
const AUTHORED_INVALID_FRAME_BUDGET_MS = 16.67; // [Authored] Negative-fixture payload; intentionally lacks a manifest provenance record.

function fail( message ) {

	throw new Error( message );

}

export async function readIntegrationManifest( path = join( __dirname, 'integration-manifest.json' ) ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

function requireSingleOwner( resourceName, resource ) {

	if ( ! resource || typeof resource !== 'object' ) {

		fail( `Missing shared resource "${ resourceName }".` );

	}

	if ( typeof resource.owner !== 'string' || resource.owner.length === DERIVED_EMPTY_SELECTION_COUNT ) {

		fail( `Shared resource "${ resourceName }" needs exactly one owner.` );

	}

	assert( Array.isArray( resource.writers ), `${ resourceName }.writers must be an array` );

	if ( resource.writers.length !== AUTHORED_SINGLE_OWNER_COUNT ) {

		fail( `Shared resource "${ resourceName }" must have one writer, got ${ resource.writers.length }.` );

	}

	assert.equal( resource.writers[ DERIVED_EMPTY_SELECTION_COUNT ], resource.owner, `${ resourceName } owner must be its sole writer` );
	return resource.owner;

}

function collectNumericPaths( value, path = '', paths = [] ) {

	if ( typeof value === 'number' ) {

		paths.push( path );
		return paths;

	}

	if ( Array.isArray( value ) ) {

		for ( const [ index, entry ] of value.entries() ) {

			collectNumericPaths( entry, `${ path }[${ index }]`, paths );

		}

		return paths;

	}

	if ( value && typeof value === 'object' ) {

		for ( const [ key, entry ] of Object.entries( value ) ) {

			collectNumericPaths( entry, path ? `${ path }.${ key }` : key, paths );

		}

	}

	return paths;

}

function validateClaimBoundary( manifest ) {

	assert.equal( manifest.evidenceStatus, 'static-contract-only' );
	assert( Array.isArray( manifest.claimBoundary?.proves ) );
	assert( Array.isArray( manifest.claimBoundary?.doesNotProve ) );
	assert(
		manifest.claimBoundary.proves.some( ( claim ) => claim.includes( 'output' ) && claim.includes( 'not a selected named MRT output' ) ),
		'Claim boundary must distinguish primary output from selected named MRT outputs.'
	);
	assert(
		manifest.claimBoundary.proves.some( ( claim ) => claim.includes( 'depth' ) && claim.includes( 'rather than an MRT color output' ) ),
		'Claim boundary must state that depth is not an MRT color output.'
	);
	assert(
		manifest.claimBoundary.proves.some( ( claim ) => claim.includes( 'conditional named MRT candidates' ) ),
		'Claim boundary must state that named MRT candidates are conditional.'
	);
	assert(
		manifest.claimBoundary.doesNotProve.some( ( claim ) => claim.includes( 'constructed, compiled, or rendered' ) ),
		'Static contract must disclaim executable renderer proof.'
	);
	assert(
		manifest.claimBoundary.doesNotProve.some( ( claim ) => claim.includes( 'mobile' ) && claim.includes( 'low-end-device' ) ),
		'Static contract must disclaim device acceptance.'
	);

}

function validateNumericProvenance( manifest ) {

	const provenance = manifest.numericProvenance;
	assert( provenance && typeof provenance === 'object', 'numericProvenance is required' );
	assert.deepEqual( Object.keys( provenance.tagDefinitions ).sort(), [ ...ALLOWED_NUMERIC_TAGS ].sort() );

	const records = provenance.contractCounts;
	const expectedRecordNames = [
		'primaryScenePassOwnerCount',
		'renderPipelineOwnerCount',
		'rendererOwnerCount'
	];
	assert.deepEqual( Object.keys( records ).sort(), expectedRecordNames.sort() );

	for ( const [ name, record ] of Object.entries( records ) ) {

		assert.equal( record.value, AUTHORED_SINGLE_OWNER_COUNT, `${ name } must encode the authored single-owner constraint` );
		assert.equal( record.tag, 'Authored', `${ name } is a static constraint, not a measurement` );
		assert(
			typeof record.basis === 'string' && record.basis.includes( 'not a runtime observation' ),
			`${ name } must disclaim runtime observation`
		);

	}

	const expectedNumericPaths = Object.keys( records )
		.map( ( name ) => `numericProvenance.contractCounts.${ name }.value` )
		.sort();
	assert.deepEqual(
		collectNumericPaths( manifest ).sort(),
		expectedNumericPaths,
		'Every numeric manifest value must live in a tagged provenance record.'
	);

}

function validatePrimaryScenePass( primaryScenePass ) {

	assert.equal( primaryScenePass.resource, 'pass(scene, camera)' );
	assert.equal( primaryScenePass.primaryColor.signal, 'output' );
	assert.equal( primaryScenePass.primaryColor.attachmentClass, 'primary-pass-color' );
	assert.equal( primaryScenePass.primaryColor.namedMrtCandidate, false );
	assert.equal( primaryScenePass.depth.resource, "scenePass.getTextureNode('depth')" );
	assert.equal( primaryScenePass.depth.attachmentClass, 'pass-depth-texture' );
	assert.equal( primaryScenePass.depth.mrtColorOutput, false );
	assert.equal( primaryScenePass.outputs, undefined, 'Legacy unconditional gbuffer.outputs is forbidden.' );

	assert( Array.isArray( primaryScenePass.selectedNamedMrtOutputs ) );
	assert.equal(
		primaryScenePass.selectedNamedMrtOutputs.length,
		DERIVED_EMPTY_SELECTION_COUNT,
		'Static contract must not preselect named MRT outputs.'
	);

	const candidates = primaryScenePass.candidateNamedMrtOutputs;
	assert.deepEqual( Object.keys( candidates ).sort(), [ ...REQUIRED_NAMED_MRT_CANDIDATES ].sort() );
	assert.equal( candidates.output, undefined, 'Primary output is not a conditional named MRT candidate.' );
	assert.equal( candidates.depth, undefined, 'Depth must not appear among named MRT color candidates.' );

	for ( const [ name, candidate ] of Object.entries( candidates ) ) {

		assert.equal( candidate.status, 'conditional-unselected', `${ name } must remain conditional in a static contract` );
		assert(
			typeof candidate.selectOnlyWhen === 'string' && candidate.selectOnlyWhen.startsWith( '[Measured]' ),
			`${ name } needs a measured admission rule`
		);

	}

	assert.equal( primaryScenePass.selectionPolicy.rule, 'select each named MRT candidate independently for the concrete workload' );
	assert( primaryScenePass.selectionPolicy.requiredEvidence.includes( 'paired measurements' ) );
	assert( primaryScenePass.selectionPolicy.tileGpuNote.includes( 'does not imply lower off-chip bandwidth' ) );

}

function validateColorAndTemporalContracts( manifest ) {

	assert.deepEqual( manifest.defaultGraphOrder, EXPECTED_GRAPH_ORDER );
	assert.equal( manifest.conditionalResources.temporalHistory.status, 'conditional-unselected' );
	assert( manifest.conditionalResources.temporalHistory.requires.includes( 'selected velocity signal' ) );
	assert( manifest.conditionalResources.temporalHistory.requires.includes( 'stable pre-exposure history domain' ) );

	const exposure = manifest.conditionalResources.exposureControl;
	assert.equal( exposure.owner, 'threejs-exposure-color-grading' );
	assert.equal( exposure.graphOwner, 'threejs-image-pipeline' );
	assert.equal( exposure.status, 'ownership-and-order-only' );
	assert.equal( exposure.defaultMeterTap, 'resolved pre-bloom scene-linear HDR' );
	assert.equal( exposure.adaptationDomain, 'EV/log space' );
	assert( exposure.cpuReadbackPolicy.includes( 'never current-frame exposure control' ) );

	const lut = manifest.conditionalResources.gradingLut;
	assert.equal( lut.status, 'conditional-unselected' );
	assert( lut.requiredContract.includes( 'scene-linear shaper when the input is unbounded HDR' ) );
	assert( lut.defaultPlacementWhenToneMappedLinear.includes( 'before the sole output conversion' ) );

	assert.equal( manifest.sharedResources.toneMap.graphOwner, 'threejs-image-pipeline' );
	assert.equal( manifest.sharedResources.outputTransform.graphOwner, 'threejs-image-pipeline' );
	assert.notEqual( manifest.sharedResources.toneMap.owner, manifest.sharedResources.outputTransform.owner );

}

function validateSystems( systems ) {

	for ( const [ systemName, system ] of Object.entries( systems ) ) {

		assert.equal( system.privatePostOwner, false, `${ systemName } must not own a private post/output pipeline` );
		assert( Array.isArray( system.consumes ), `${ systemName }.consumes must be an array` );
		assert( Array.isArray( system.conditionalConsumes ), `${ systemName }.conditionalConsumes must be an array` );
		assert( Array.isArray( system.publishes ), `${ systemName }.publishes must be an array` );

		for ( const signal of FORBIDDEN_UNCONDITIONAL_SIGNALS ) {

			assert(
				! system.consumes.includes( signal ),
				`${ systemName } must not unconditionally consume unselected signal ${ signal }`
			);

		}

	}

}

export function validateIntegrationManifest( manifest ) {

	assert.equal( manifest.sceneId, 'shared-framegraph-static-contract' );
	validateClaimBoundary( manifest );
	validateNumericProvenance( manifest );

	assert.equal( manifest.rendering.rendererType, 'WebGPURenderer' );
	assert.equal( manifest.rendering.rendererOwner, 'threejs-image-pipeline' );
	assert.equal( manifest.rendering.renderPipelineOwner, 'threejs-image-pipeline' );
	assert.equal( manifest.rendering.primaryScenePassOwner, 'threejs-image-pipeline' );
	assert.equal( manifest.rendering.outputNodeOwner, 'threejs-image-pipeline' );
	assert.equal( manifest.rendering.countRecords, 'numericProvenance.contractCounts' );

	const owners = {};

	for ( const resourceName of REQUIRED_SHARED_RESOURCES ) {

		owners[ resourceName ] = requireSingleOwner( resourceName, manifest.sharedResources[ resourceName ] );

	}

	assert.deepEqual( owners, {
		primaryScenePass: 'threejs-image-pipeline',
		weatherEnvelope: 'threejs-rain-snow-and-wet-surfaces',
		toneMap: 'threejs-exposure-color-grading',
		outputTransform: 'renderOutput'
	} );

	validatePrimaryScenePass( manifest.sharedResources.primaryScenePass );

	for ( const field of REQUIRED_WEATHER_FIELDS ) {

		assert(
			manifest.sharedResources.weatherEnvelope.schema.includes( field ),
			`weatherEnvelope.schema missing ${ field }`
		);

	}

	validateColorAndTemporalContracts( manifest );
	validateSystems( manifest.systems );

	assert.equal( manifest.browserProof.requiredForRuntimeAcceptance, true );
	assert.equal( manifest.browserProof.presentInThisFolder, false );
	assert.equal( manifest.browserProof.status, 'not-provided-by-static-contract' );
	assert( manifest.browserProof.requiredArtifacts.includes( 'renderer-info.json' ) );
	assert( manifest.browserProof.requiredArtifacts.includes( 'images/no-post.design.png' ) );

	return {
		pass: true,
		sceneId: manifest.sceneId,
		owners,
		selectedNamedMrtOutputs: manifest.sharedResources.primaryScenePass.selectedNamedMrtOutputs,
		browserProof: manifest.browserProof.presentInThisFolder ? 'present' : 'absent-by-claim-boundary'
	};

}

export function createInvalidDuplicateOwnerFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.sharedResources.primaryScenePass.writers.push( 'threejs-ambient-contact-shading' );
	return fixture;

}

export function createInvalidPrivatePostFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.systems.clouds.privatePostOwner = true;
	return fixture;

}

export function createInvalidDepthInMrtFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.sharedResources.primaryScenePass.depth.mrtColorOutput = true;
	return fixture;

}

export function createInvalidUnconditionalMrtFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.sharedResources.primaryScenePass.selectedNamedMrtOutputs = [ ...REQUIRED_NAMED_MRT_CANDIDATES ];
	return fixture;

}

export function createInvalidRuntimeProofFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.browserProof.presentInThisFolder = true;
	return fixture;

}

export function createInvalidUntaggedNumberFixture( manifest ) {

	const fixture = structuredClone( manifest );
	fixture.rendering.untaggedFrameBudgetMs = AUTHORED_INVALID_FRAME_BUDGET_MS;
	return fixture;

}

export async function runSelfTest() {

	const manifest = await readIntegrationManifest();
	const valid = validateIntegrationManifest( manifest );
	const invalidFixtures = [
		[ 'duplicate primary-pass writer', createInvalidDuplicateOwnerFixture( manifest ) ],
		[ 'private post owner', createInvalidPrivatePostFixture( manifest ) ],
		[ 'depth promoted to MRT color output', createInvalidDepthInMrtFixture( manifest ) ],
		[ 'unconditional named MRT set', createInvalidUnconditionalMrtFixture( manifest ) ],
		[ 'unsupported runtime-proof claim', createInvalidRuntimeProofFixture( manifest ) ],
		[ 'untagged numeric budget', createInvalidUntaggedNumberFixture( manifest ) ]
	];

	for ( const [ label, fixture ] of invalidFixtures ) {

		try {

			validateIntegrationManifest( fixture );
			fail( `Invalid fixture "${ label }" unexpectedly passed.` );

		} catch ( error ) {

			if ( error.message.includes( 'unexpectedly passed' ) ) throw error;

		}

	}

	return {
		...valid,
		rejectedFixtures: invalidFixtures.map( ( [ label ] ) => label )
	};

}

if ( import.meta.url === `file://${ process.argv[ DERIVED_CLI_SCRIPT_ARG_INDEX ] }` ) {

	try {

		console.log( JSON.stringify( await runSelfTest(), null, AUTHORED_JSON_INDENT_SPACES ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = NODE_FAILURE_EXIT_CODE;

	}

}
