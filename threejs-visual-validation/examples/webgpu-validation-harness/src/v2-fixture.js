import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { numericArray, numericDatum, NumericLabel } from './numeric-evidence.js';
import { createDiagnosticPng } from './png.js';
import { getAlignedReadbackLayout } from './readback.js';
import { REQUIRED_V2_IMAGES, validateV2ArtifactBundle } from './schema/v2.js';

const SOURCE = 'schema-v2 contract fixture; not runtime evidence';

const A = ( value, unit, source = SOURCE ) => numericDatum( value, unit, NumericLabel.AUTHORED, source );
const D = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.DERIVED, source );
const G = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.GATED, source );
const AA = ( values, unit, source = SOURCE ) => numericArray( values, unit, NumericLabel.AUTHORED, source );

function schema( fields ) {

	return { schemaVersion: 2, ...fields };

}

function identityMatrix() {

	return AA( [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1
	], 'matrix element' );

}

function readbackRecord( width, height, bytesPerTexel ) {

	const layout = getAlignedReadbackLayout( width, height, bytesPerTexel );
	return {
		rowBytes: G( layout.rowBytes, 'byte', 'WebGPU texture copy row payload' ),
		bytesPerRow: G( layout.bytesPerRow, 'byte', 'WebGPU 256-byte bytesPerRow alignment' ),
		minimumByteLength: D( layout.minimumByteLength, 'byte', 'bytesPerRow*(height-1)+rowBytes' ),
		fullyPaddedByteLength: D( layout.fullyPaddedByteLength, 'byte', 'bytesPerRow*height' ),
		alignment: G( layout.alignment, 'byte', 'WebGPU bytesPerRow alignment contract' )
	};

}

export function createV2ContractFixtureArtifacts() {

	const width = 96;
	const height = 64;
	const colorBytes = width * height * 4;
	const targetBytes = colorBytes * 3;
	const claimVerdicts = {
		visualCorrectness: 'NOT_CLAIMED',
		mechanismCorrectness: 'NOT_CLAIMED',
		performanceCompliance: 'NOT_CLAIMED',
		gpuAttribution: 'NOT_CLAIMED',
		lifecycleStability: 'NOT_CLAIMED'
	};

	const visualContract = schema( {
		contractRevision: 'visual-validation-v2-fixture-1',
		subject: 'schema-v2-contract-fixture',
		identity: [ 'transport-only fixture', 'never publishable', 'synthetic images explicitly classified' ],
		invariants: [
			{
				id: 'diagnostic-route-separation',
				statement: 'The diagnostics route is distinct from the final route.',
				domain: 'image',
				truthSource: 'pipeline-graph.json captureRoutes',
				diagnostic: 'diagnostics.mosaic.png',
				metric: 'differing-pixel ratio',
				gate: G( 0.01, 'ratio', 'frozen transport mutation threshold' ),
				requiredArtifacts: [ 'pipeline-graph.json', 'final.design.png', 'diagnostics.mosaic.png' ],
				blockingFailure: 'false diagnostic route'
			}
		],
		requiredImages: [ ...REQUIRED_V2_IMAGES ],
		requiredDiagnostics: [ 'final', 'no-post', 'diagnostics', 'near/design/far', 'seeds', 'temporal' ],
		requiredMetrics: [ 'pipeline graph', 'resource ledgers', 'frame trace', 'visual errors', 'lifecycle' ],
		blockingFailures: [ 'unlabelled numeric', 'self-comparison', 'path escape', 'missing timestamp claim separation' ],
		allowedDivergences: [ 'All values and images are contract fixtures; no runtime claim is made.' ],
		performanceClaims: { gpuTimingRequirement: 'not-claimed', claims: [] },
		imageComparisons: [
			{
				id: 'deterministic-seed-transport',
				baseline: 'seed-0001.final.png',
				candidate: 'seed-9e3779b9.final.png',
				maxDifferingRatio: G( 0, 'ratio', 'fixture images are intentionally identical transport sentinels' )
			}
		]
	} );

	const evidenceManifest = schema( {
		bundleKind: 'contract-fixture',
		publishable: false,
		skill: 'threejs-visual-validation',
		sceneId: 'schema-v2-contract-fixture',
		threeRevision: '0.185.1',
		captureProfile: 'schema-fixture',
		automationSurface: 'contract-fixture',
		adapterClass: 'unknown',
		sourceClosureHash: 'fixture-source-closure',
		buildRevision: 'fixture-build-revision',
		evidenceBundleId: 'fixture-v2-0001',
		targetId: 'not-a-runtime-target',
		device: 'not-run',
		browser: 'not-run',
		os: 'not-run',
		gpuAdapter: null,
		displayRefresh: A( 60, 'Hz' ),
		targetPresentationRate: G( 60, 'Hz', 'fixture target only' ),
		renderer: 'WebGPURenderer contract requirement; not instantiated by fixture',
		backend: {
			isWebGPUBackend: false,
			initialized: false,
			timestampAvailable: false,
			unavailableReason: 'Contract fixture does not initialize a browser renderer.',
			features: [],
			limits: {},
			deviceLostObserved: false,
			uncapturedErrors: []
		},
		qualityState: 'schema-fixture',
		viewport: { width: A( width, 'px' ), height: A( height, 'px' ), dpr: A( 1, 'ratio' ) },
		camera: {
			bookmark: 'design',
			matrixWorld: identityMatrix(),
			projectionMatrix: identityMatrix(),
			near: A( 0.1, 'scene unit' ),
			far: A( 100, 'scene unit' )
		},
		seed: '0x00000001',
		time: { fixed: true, seconds: A( 0, 's' ), frame: A( 0, 'frame' ) },
		assets: [],
		colorPipeline: {
			rendererOutputColorSpace: 'SRGBColorSpace',
			rendererToneMapping: 'NeutralToneMapping',
			rendererToneMappingExposure: A( 1, 'ratio' ),
			outputBufferType: 'UnsignedByteType',
			toneMapOwner: 'render-output',
			outputTransformOwner: 'render-output',
			hdrWorkingType: 'HalfFloatType',
			colorTextures: [],
			dataTextures: [],
			screenshotEncoding: 'PNG RGBA8'
		},
		stochasticMasks: [],
		knownCompromises: [ 'Synthetic fixture; forbidden from canonical evidence paths.' ],
		pipelineGraphDigest: 'fixture-graph-digest-1',
		claimVerdicts,
		promotion: { status: 'NOT_APPLICABLE', bindingDigest: null, binding: null, visualSignoff: null }
	} );

	const rendererInfo = schema( {
		threeRevision: '0.185.1',
		renderer: 'WebGPURenderer requirement; not instantiated',
		backend: 'unavailable-contract-fixture',
		captureProfile: 'schema-fixture',
		adapterClass: 'unknown',
		outputColorSpace: 'SRGBColorSpace',
		toneMapping: 'NeutralToneMapping',
		toneMappingExposure: A( 1, 'ratio' ),
		sampleCount: A( 1, 'sample/pixel' ),
		depthMode: 'standard',
		outputBufferType: 'UnsignedByteType',
		compatibilityMode: null,
		timestampSupport: false,
		adapterFeatures: [],
		adapterLimits: {},
		initializationState: 'not-run-contract-fixture',
		deviceLostObserved: false,
		uncapturedErrors: [],
		deviceErrors: [],
		rendererInfoSnapshots: []
	} );

	const pipelineGraph = schema( {
		graphDigest: 'fixture-graph-digest-1',
		runtimeProfile: 'schema-fixture',
		performanceTimestampMode: 'disabled',
		timestampQueriesRequired: false,
		timestampQueriesRequested: false,
		timestampQueriesActive: false,
		owners: {
			renderer: 'validation-subject-adapter',
			renderPipeline: 'validation-subject-adapter',
			toneMap: 'render-output',
			outputTransform: 'render-output'
		},
		ownerClaims: [
			{ semantic: 'renderer', owner: 'validation-subject-adapter', producerCount: A( 1, 'owner' ) },
			{ semantic: 'render-pipeline', owner: 'validation-subject-adapter', producerCount: A( 1, 'owner' ) },
			{ semantic: 'tone-map', owner: 'render-output', producerCount: A( 1, 'owner' ) },
			{ semantic: 'output-transform', owner: 'render-output', producerCount: A( 1, 'owner' ) }
		],
		signals: [
			{ id: 'output', producer: 'scene-pass', consumers: [ 'render-output' ] },
			{ id: 'normal', producer: 'scene-pass', consumers: [ 'normal-diagnostic' ] },
			{ id: 'emissive', producer: 'scene-pass', consumers: [ 'emissive-diagnostic' ] }
		],
		sceneSubmissions: [ { id: 'scene-pass', kind: 'full-lit', submissionCount: A( 1, 'submission/frame' ) } ],
		computeDispatches: [],
		resources: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ],
		finalToneMapOwner: 'render-output',
		finalOutputTransformOwner: 'render-output',
		captureRoutes: {
			final: { mode: 'final', outputNodeId: 'final-output-node' },
			'no-post': { mode: 'no-post', outputNodeId: 'no-post-output-node' },
			normal: { mode: 'normal', outputNodeId: 'normal-output-node' },
			emissive: { mode: 'emissive', outputNodeId: 'emissive-output-node' }
		}
	} );

	const performanceEnvelope = schema( {
		gpuTimingRequirement: 'not-claimed',
		refreshPeriod: D( 16.6666666667, 'ms', '1000 / 60 Hz target' ),
		browserMainThreadReserve: A( 1, 'ms' ),
		compositorGpuReserve: A( 1, 'ms' ),
		cpuSafetyReserve: A( 1, 'ms' ),
		gpuSafetyReserve: A( 1, 'ms' ),
		cpuSceneEnvelope: D( 14.6666666667, 'ms', 'refresh period - browser reserve - CPU reserve' ),
		gpuSceneEnvelope: D( 14.6666666667, 'ms', 'refresh period - compositor reserve - GPU reserve' ),
		cpuP95Gate: G( 14.6666666667, 'ms', 'frozen from derived CPU scene envelope' ),
		gpuP95Gate: G( 14.6666666667, 'ms', 'frozen from derived GPU scene envelope' ),
		deadlineMissRatioGate: G( 0.01, 'ratio', 'fixture gate' )
	} );

	const makeTraceSegment = () => ( {
		cpuSamples: AA( [ 0.8, 0.9, 1 ], 'ms' ),
		presentationSamples: AA( [ 16.6, 16.7, 16.6 ], 'ms' ),
		cpuP50: A( 0.9, 'ms' ),
		cpuP95: A( 0.99, 'ms' ),
		presentationP95: A( 16.69, 'ms' ),
		deadlineMissRatio: A( 1 / 3, 'ratio' )
	} );
	const frameTrace = schema( {
		captureProfile: 'schema-fixture',
		adapterClass: 'unknown',
		clockSource: 'fixture-authored-values',
		warmup: makeTraceSegment(),
		cold: makeTraceSegment(),
		sustained: makeTraceSegment(),
		gpuTimingAvailable: false,
		renderTimestamp: null,
		computeTimestamp: null,
		presentationCadence: A( 60, 'frame/s' ),
		excludedPhases: [ 'initialization', 'compilation', 'readback', 'PNG encoding' ]
	} );

	const qualityGovernor = schema( {
		enabled: false,
		states: [ 'schema-fixture' ],
		inputMetric: 'none',
		filter: 'none',
		hysteresis: G( 0, 'ms', 'governor disabled' ),
		minimumResidence: G( 0, 'frame', 'governor disabled' ),
		transitions: [],
		settledState: 'schema-fixture',
		oscillationDetected: false
	} );

	const target = ( name, semantic, owner ) => ( {
		name,
		owner,
		semantic,
		width: A( width, 'px' ),
		height: A( height, 'px' ),
		format: 'rgba8unorm',
		bytesPerTexel: G( 4, 'byte/texel', 'rgba8unorm storage' ),
		sampleCount: A( 1, 'sample/pixel' ),
		memoryBytes: D( colorBytes, 'byte', 'width*height*4' ),
		lifetime: 'fixture',
		loadOp: 'clear',
		storeOp: 'store',
		readback: readbackRecord( width, height, 4 )
	} );
	const renderTargets = schema( {
		targets: [
			target( 'output', 'scene-linear HDR stand-in', 'scene-pass' ),
			target( 'normal', 'view-space normal', 'scene-pass' ),
			target( 'emissive', 'scene-linear emissive', 'scene-pass' )
		],
		accountingScope: 'contract-fixture-only',
		completeness: 'FIXTURE',
		trackedRenderTargetBytes: D( targetBytes, 'byte', 'sum target memory' ),
		trackedPeakLiveRenderTargetBytes: D( targetBytes, 'byte', 'all fixture targets simultaneously live' )
	} );

	const storageResources = schema( {
		resources: [],
		totalResidentBytes: D( 0, 'byte', 'no storage resource in minimal subject' ),
		dispatchOwnership: [],
		synchronization: 'none',
		resetPolicy: 'not-applicable'
	} );

	const residentResources = schema( {
		textures: [ 'output', 'normal', 'emissive' ],
		geometry: [ 'fixture subject' ],
		buffers: [],
		histories: [],
		staging: [],
		readback: [ 'capture-target' ],
		pipelineEstimate: 'not measured in contract fixture',
		accountingScope: 'contract-fixture-only',
		completeness: 'FIXTURE',
		inventoryCompleteness: 'FIXTURE',
		labOwnedNonTargetResources: [],
		opaqueRendererInternalResidency: { status: 'NOT_CLAIMED', reason: 'Contract fixture has no renderer residency.' },
		trackedRenderTargetBytes: D( targetBytes, 'byte', 'render target sum only' ),
		trackedPeakLiveRenderTargetBytes: D( targetBytes, 'byte', 'fixture target liveness' ),
		uploadChurnPerFrame: { status: 'NOT_CLAIMED', value: null, reason: 'Contract fixture does not measure uploads.' }
	} );

	const bandwidthModel = schema( {
		passes: [ { id: 'scene-pass', lower: D( targetBytes, 'byte/frame', 'one store per attachment' ), upper: D( targetBytes * 2, 'byte/frame', 'conservative load+store fixture bound' ) } ],
		lowerBoundBytesPerFrame: D( targetBytes, 'byte/frame', 'attachment store lower bound' ),
		upperBoundBytesPerFrame: D( targetBytes * 2, 'byte/frame', 'attachment load+store upper bound' ),
		bytesPerSecond: D( targetBytes * 60, 'byte/s', 'lower bound * 60 Hz' ),
		assumptions: [ 'No cache or compression claim.' ],
		hardwareCountersAvailable: false,
		verdict: 'NOT_CLAIMED'
	} );

	const visualErrors = schema( {
		metrics: [
			{
				id: 'fixture-sentinel',
				domain: 'transport',
				truthSource: 'synthetic contract fixture',
				alignment: 'exact dimensions',
				mask: 'none',
				measured: A( 0, 'ratio' ),
				gate: G( 0, 'ratio', 'exact fixture sentinel' ),
				verdict: 'NOT_CLAIMED',
				worstCaseArtifact: 'seed-9e3779b9.final.png'
			}
		],
		spatialErrorMaps: [],
		worstCaseArtifacts: [ 'seed-9e3779b9.final.png' ]
	} );

	const leakLoop = schema( {
		operations: [ 'resize', 'DPR change', 'quality transition', 'debug transition', 'history reset', 'teardown', 'dispose/recreate' ],
		cycles: A( 1, 'cycle' ),
		before: { targetBytes: A( targetBytes, 'byte' ), storageBytes: A( 0, 'byte' ) },
		after: { targetBytes: A( targetBytes, 'byte' ), storageBytes: A( 0, 'byte' ) },
		trend: { targetBytesPerCycle: A( 0, 'byte/cycle' ), storageBytesPerCycle: A( 0, 'byte/cycle' ) },
		gates: { targetBytes: G( 0, 'byte', 'fixture exact equality' ), storageBytes: G( 0, 'byte', 'fixture exact equality' ) },
		allowedCachePlateaus: [],
		deviceErrors: [],
		verdict: 'NOT_CLAIMED'
	} );

	const mechanismMetrics = schema( {
		subjectAdapter: 'contract-fixture-only',
		proofKind: 'contract-fixture',
		captureProfile: 'schema-fixture',
		pipelineGraphDigest: 'fixture-graph-digest-1',
		runtimeReachability: { signals: [], resources: [], routes: [] },
		routeExecutions: [],
		negativeControls: {},
		diagnosticComparisons: [],
		metrics: [],
		verdicts: claimVerdicts,
		verdict: 'NOT_CLAIMED'
	} );

	return {
		'visual-contract.json': visualContract,
		'evidence-manifest.json': evidenceManifest,
		'renderer-info.json': rendererInfo,
		'pipeline-graph.json': pipelineGraph,
		'performance-envelope.json': performanceEnvelope,
		'frame-trace.json': frameTrace,
		'quality-governor.json': qualityGovernor,
		'render-targets.json': renderTargets,
		'storage-resources.json': storageResources,
		'resident-resources.json': residentResources,
		'bandwidth-model.json': bandwidthModel,
		'visual-errors.json': visualErrors,
		'leak-loop.json': leakLoop,
		'mechanism-metrics.json': mechanismMetrics
	};

}

export async function writeV2ContractFixture( artifactDir ) {

	await mkdir( artifactDir, { recursive: true } );
	const artifacts = createV2ContractFixtureArtifacts();
	for ( const [ name, artifact ] of Object.entries( artifacts ) ) {

		await writeFile( join( artifactDir, name ), `${ JSON.stringify( artifact, null, 2 ) }\n` );

	}

	for ( const imagePath of REQUIRED_V2_IMAGES ) {

		let mode = imagePath;
		if ( imagePath.includes( 'seed-0001' ) || imagePath.includes( 'seed-9e3779b9' ) ) mode = 'deterministic-seed-transport';
		await writeFile( join( artifactDir, imagePath ), createDiagnosticPng( 96, 64, mode ) );

	}

	return validateV2ArtifactBundle( artifactDir );

}
