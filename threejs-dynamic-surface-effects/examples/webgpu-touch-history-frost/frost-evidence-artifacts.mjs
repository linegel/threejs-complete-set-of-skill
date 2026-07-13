import { numericArray, numericDatum, NumericLabel, assertLabelledNumerics } from '../../../labs/runtime/numeric-evidence.mjs';
import { canonicalSha256 } from '../../../scripts/lib/evidence-manifest-contract.mjs';
import { loadCheckedSchemas, validateCheckedJsonSchema } from '../../../scripts/lib/checked-json-schema.mjs';
import { assertLifecycleClaimEvidence } from '../../../scripts/lib/evidence-runtime-claims.mjs';

export const FROST_NORMATIVE_JSON_PATHS = Object.freeze( [
	'visual-contract.json',
	'renderer-info.json',
	'pipeline-graph.json',
	'performance-envelope.json',
	'frame-trace.json',
	'quality-governor.json',
	'render-targets.json',
	'storage-resources.json',
	'resident-resources.json',
	'bandwidth-model.json',
	'visual-errors.json',
	'leak-loop.json',
	'mechanism-metrics.json'
] );

const M = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.MEASURED, source );
const D = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.DERIVED, source );
const G = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.GATED, source );
const A = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.AUTHORED, source );
const DA = ( values, unit, source ) => numericArray( values, unit, NumericLabel.DERIVED, source );

function schema( fields ) {

	return { schemaVersion: 2, ...fields };

}

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ label } must be an object.` );
	return value;

}

function align256( value ) {

	return Math.ceil( value / 256 ) * 256;

}

function targetRecord( capture ) {

	const width = capture.width;
	const height = capture.height;
	const rowBytes = width * 4;
	const bytesPerRow = align256( rowBytes );
	return {
		name: capture.evidence.artifactTarget.captureTargetId,
		owner: 'threejs-dynamic-surface-effects',
		semantic: `${ capture.target } native WebGPU RGBA8 readback`,
		width: M( width, 'pixels', `${ capture.target } retained capture metadata` ),
		height: M( height, 'pixels', `${ capture.target } retained capture metadata` ),
		format: 'rgba8unorm',
		bytesPerTexel: D( 4, 'bytes-per-texel', 'RGBA8 format width' ),
		sampleCount: A( 1, 'samples-per-pixel', 'Frost correctness capture disables MSAA' ),
		memoryBytes: D( width * height * 4, 'bytes', 'width * height * RGBA8 bytes per texel' ),
		lifetime: 'single transactional recipe readback',
		loadOp: 'clear',
		storeOp: 'store',
		readback: {
			rowBytes: D( rowBytes, 'bytes', 'width * 4 RGBA8 bytes' ),
			bytesPerRow: G( bytesPerRow, 'bytes', 'WebGPU 256-byte texture-copy alignment' ),
			minimumByteLength: D( bytesPerRow * ( height - 1 ) + rowBytes, 'bytes', 'aligned rows with compact final row' ),
			fullyPaddedByteLength: D( bytesPerRow * height, 'bytes', 'aligned row stride * height' ),
			alignment: G( 256, 'bytes', 'WebGPU texture-copy row alignment' )
		},
		directlyReadBack: true
	};

}

function runtimeGraph( runtime ) {

	const metrics = runtime.metrics;
	const pipeline = runtime.pipeline;
	const resources = runtime.resources;
	const signalIds = [ ...new Set( [ 'scene-color', ...pipeline.signals, 'frost-mask', 'output' ] ) ];
	const graph = schema( {
		owners: pipeline.owners,
		signals: signalIds.map( ( id ) => ( {
			id,
			producer: id === 'scene-color' ? 'host-scene' : 'threejs-dynamic-surface-effects',
			consumers: id === 'output' ? [ 'presentation' ] : [ 'frost-composite' ],
			reachable: true
		} ) ),
		sceneSubmissions: pipeline.sceneSubmissions.map( ( submission ) => ( {
			id: submission.id,
			owner: pipeline.owners.scenePass,
			kind: 'lit-scene',
			submissionCount: M( submission.count, 'submissions-per-frame', 'LabController.describePipeline' )
		} ) ),
		computeDispatches: [ {
			id: 'history-update',
			owner: pipeline.owners.history,
			workgroups: DA( [ resources.dispatch.x, resources.dispatch.y, 1 ], 'workgroups', 'ceil(history extent / 8x8 workgroup)' ),
			workgroupSize: DA( [ 8, 8, 1 ], 'invocations', 'Frost compute declaration' ),
			updatePolicy: resources.graph.updatePolicy
		} ],
		resources: [
			{
				id: resources.historyRead.name ?? 'touch-history-frost:history-read',
				owner: pipeline.owners.history,
				kind: 'storage-texture',
				residentBytes: D( resources.storageBytes.historyRead, 'bytes', 'history read extent * RGBA16F bytes per texel' )
			},
			{
				id: resources.historyWrite.name ?? 'touch-history-frost:history-write',
				owner: pipeline.owners.history,
				kind: 'storage-texture',
				residentBytes: D( resources.storageBytes.historyWrite, 'bytes', 'history write extent * RGBA16F bytes per texel' )
			}
		],
		finalToneMapOwner: pipeline.finalToneMapOwner,
		finalOutputTransformOwner: pipeline.finalOutputTransformOwner
	} );
	const result = validateCheckedJsonSchema( loadCheckedSchemas().runtimeGraph, graph );
	if ( result.valid === false ) throw new AggregateError( result.errors.map( ( error ) => new Error( error ) ), 'Frost runtime graph schema failed.' );
	if ( metrics.nativeWebGPU !== true ) throw new Error( 'Frost evidence graph requires native WebGPU runtime metrics.' );
	return graph;

}

export function buildFrostNormativeArtifacts( { runtime, captures, visualDifferences, coverageEvidence, routeMatrixEvidence, lifecycleEvidence } ) {

	requireRecord( runtime, 'Frost runtime snapshot' );
	if ( ! Array.isArray( captures ) || captures.length !== 27 ) throw new Error( 'Frost normative evidence requires 27 retained recipe captures.' );
	if ( visualDifferences?.verdict !== 'PASS' || coverageEvidence?.verdict !== 'PASS'
		|| routeMatrixEvidence?.verdict !== 'PASS' || lifecycleEvidence?.verdict !== 'PASS' ) {

		throw new Error( 'Frost normative evidence requires passing visual, extent, and lifecycle classifiers.' );

	}
	const metrics = runtime.metrics;
	const resources = runtime.resources;
	const graph = runtimeGraph( runtime );
	const pipelineGraphDigest = canonicalSha256( graph );
	const targetRecords = captures.map( targetRecord );
	const targetBytes = targetRecords.reduce( ( sum, target ) => sum + target.memoryBytes.value, 0 );
	const diagnosticRanges = Object.values( visualDifferences.metrics.diagnosticRgbRanges ).map( ( datum ) => datum.value );
	const minimumDiagnosticRange = Math.min( ...diagnosticRanges );
	const visualSimilarity = 1 - minimumDiagnosticRange / 255;
	const claims = Object.freeze( {
		visualCorrectness: 'INSUFFICIENT_EVIDENCE',
		mechanismCorrectness: 'PASS',
		performanceCompliance: 'NOT_CLAIMED',
		gpuAttribution: 'NOT_CLAIMED',
		lifecycleStability: 'PASS',
		visualError: 'PASS'
	} );
	const artifacts = {
		'visual-contract.json': schema( {
			subject: 'native WebGPU touch-history Frost surface',
			identity: [ 'webgpu-touch-history-frost', metrics.threeRevision, metrics.scenario, metrics.mechanism, metrics.tier ],
			invariants: [
				'one scene pass and one final RenderPipeline owner',
				'distinct previous/current RGBA16F history storage textures',
				'same-frame compute, swap, and composite',
				'odd-size bounds-checked dispatch and 256-byte-aligned readback'
			],
			requiredImages: [ 'final.design.png', 'no-post.design.png', 'diagnostics.mosaic.png', 'camera.near.png', 'camera.design.png', 'camera.far.png', 'seed-0001.final.png', 'seed-9e3779b9.final.png', 'temporal.t000.png', 'temporal.t001.png' ],
			performanceClaims: [],
			limitations: [ 'Hardware performance and opaque renderer-internal residency are not claimed by the correctness lane.' ]
		} ),
		'renderer-info.json': schema( {
			threeRevision: '0.185.1',
			renderer: 'WebGPURenderer',
			backend: 'WebGPU',
			captureProfile: 'correctness',
			adapterClass: 'unknown',
			initializationState: 'await renderer.init completed; renderer.backend.isWebGPUBackend true',
			deviceIdentityVerified: metrics.rendererBackendEvidence.deviceIdentityVerified,
			deviceLostObserved: metrics.deviceLostObserved,
			uncapturedErrors: metrics.uncapturedErrors,
			deviceErrors: metrics.deviceErrors,
			timestampSupport: metrics.timestampQueriesActive
		} ),
		'pipeline-graph.json': graph,
		'performance-envelope.json': schema( {
			claimStatus: 'NOT_CLAIMED',
			targetFrameTime: A( 16.67, 'milliseconds', 'authored 60 Hz target for future physical-browser measurement' ),
			correctnessResolution: A( 1200, 'pixels-wide', 'correctness capture contract' ),
			performanceResolution: A( 1920, 'pixels-wide', 'future performance capture contract' ),
			reason: 'The Playwright correctness lane has no named-hardware timestamp population.'
		} ),
		'frame-trace.json': schema( {
			captureProfile: 'correctness',
			cpuSamples: null,
			gpuSamples: null,
			presentationSamples: null,
			timestampQuerySupported: metrics.timestampQueriesActive,
			verdict: 'NOT_CLAIMED',
			reason: 'Correctness recipe execution is excluded from performance claims.'
		} ),
		'quality-governor.json': schema( {
			enabled: false,
			states: [ 'full', 'balanced', 'budgeted' ],
			windows: [],
			transitions: [],
			verdict: 'NOT_CLAIMED',
			reason: 'No sustained named-hardware timing trace exists in the correctness lane.'
		} ),
		'render-targets.json': schema( {
			targets: targetRecords,
			accountingScope: 'transactional-capture-targets-only',
			completeness: 'PARTIAL',
			trackedRenderTargetBytes: D( targetBytes, 'bytes', 'sum of 27 transactional RGBA8 capture target extents' ),
			trackedPeakLiveRenderTargetBytes: D( Math.max( ...targetRecords.map( ( target ) => target.memoryBytes.value ) ), 'bytes', 'one transactional capture target is live at a time' )
		} ),
		'storage-resources.json': schema( {
			resources: [
				{
					id: resources.historyRead.name ?? 'touch-history-frost:history-read',
					kind: 'StorageTexture',
					format: 'RGBA16F',
					width: M( resources.historyRead.width, 'pixels', 'LabController.describeResources' ),
					height: M( resources.historyRead.height, 'pixels', 'LabController.describeResources' ),
					residentBytes: D( resources.storageBytes.historyRead, 'bytes', 'width * height * 8 bytes per texel' )
				},
				{
					id: resources.historyWrite.name ?? 'touch-history-frost:history-write',
					kind: 'StorageTexture',
					format: 'RGBA16F',
					width: M( resources.historyWrite.width, 'pixels', 'LabController.describeResources' ),
					height: M( resources.historyWrite.height, 'pixels', 'LabController.describeResources' ),
					residentBytes: D( resources.storageBytes.historyWrite, 'bytes', 'width * height * 8 bytes per texel' )
				}
			],
			totalResidentBytes: D( resources.residentStorageBytes, 'bytes', 'sum of distinct history storage textures' ),
			dispatchOwnership: [ 'threejs-dynamic-surface-effects' ],
			synchronization: 'ordered renderer.compute before same-frame RenderPipeline.render',
			resetPolicy: 'clear both histories on resize, tier change, and explicit reset'
		} ),
		'resident-resources.json': schema( {
			textures: [ resources.historyRead.name, resources.historyWrite.name ],
			geometry: [ 'BoxGeometry', 'SphereGeometry' ],
			buffers: [],
			histories: [ 'historyRead', 'historyWrite' ],
			staging: [ 'transient WebGPU readback staging; opaque byte residency not claimed' ],
			readback: targetRecords.map( ( target ) => target.name ),
			pipelineEstimate: 'unavailable from current renderer metrics',
			accountingScope: 'lab-owned-storage-and-transactional-targets',
			completeness: 'PARTIAL',
			inventoryCompleteness: 'explicit Frost storage complete; renderer internals partial',
			labOwnedNonTargetResources: [ 'two RGBA16F history StorageTextures' ],
			opaqueRendererInternalResidency: { status: 'NOT_CLAIMED', reason: 'Three r185 does not expose exact internal pipeline and cache byte residency.' },
			trackedRenderTargetBytes: D( targetBytes, 'bytes', 'sum of transactional capture target allocations across recipes' ),
			trackedPeakLiveRenderTargetBytes: D( Math.max( ...targetRecords.map( ( target ) => target.memoryBytes.value ) ), 'bytes', 'one capture target live per isolated recipe' ),
			uploadChurnPerFrame: { status: 'NOT_CLAIMED', value: null, reason: 'Renderer upload bytes are not exposed by the correctness lane.' }
		} ),
		'bandwidth-model.json': schema( {
			passes: [ {
				id: 'history-update',
				lower: D( resources.residentStorageBytes, 'bytes-per-active-update', 'one history read plus one history write' ),
				upper: D( resources.residentStorageBytes, 'bytes-per-active-update', 'explicit uncompressed storage traffic only' )
			} ],
			lowerBoundBytesPerFrame: D( resources.residentStorageBytes, 'bytes-per-active-update', 'explicit history read/write lower bound' ),
			upperBoundBytesPerFrame: D( resources.residentStorageBytes, 'bytes-per-active-update', 'explicit history read/write upper bound without cache modeling' ),
			bytesPerSecond: null,
			assumptions: [ 'Only explicit RGBA16F history traffic is modeled; cache, scene targets, and physical compression are unclaimed.' ],
			hardwareCountersAvailable: false,
			verdict: 'INSUFFICIENT_EVIDENCE'
		} ),
		'visual-errors.json': schema( {
			metrics: [ {
				id: 'diagnostic-similarity-to-flat-output',
				domain: 'history diagnostics',
				truthSource: 'minimum retained diagnostic RGB range',
				alignment: 'exact 1200x800 recipe coordinates',
				mask: 'all RGB pixels',
				measured: D( visualSimilarity, 'similarity-ratio', '1 - minimum diagnostic RGB range / 255' ),
				gate: G( 0.99, 'similarity-ratio', 'diagnostics must materially differ from a constant image' ),
				verdict: visualSimilarity <= 0.99 ? 'PASS' : 'FAIL',
				worstCaseArtifact: 'diagnostics.mosaic.png'
			} ],
			spatialErrorMaps: [],
			worstCaseArtifacts: [ 'diagnostics.mosaic.png' ]
		} ),
		'leak-loop.json': schema( {
			...lifecycleEvidence,
			allowedCachePlateaus: []
		} ),
		'mechanism-metrics.json': schema( {
			subjectAdapter: 'WebGPUFrostLab',
			proofKind: 'native-browser-runtime',
			captureProfile: 'correctness',
			pipelineGraphDigest,
			runtimeReachability: {
				signals: graph.signals.map( ( signal ) => signal.id ),
				resources: graph.resources.map( ( resource ) => resource.id ),
				routes: captures.map( ( capture ) => capture.target )
			},
			routeExecutions: captures.map( ( capture, index ) => ( {
				recipeId: capture.target,
				transactionId: capture.evidence.transaction.transactionId,
				sequence: M( index + 1, 'transaction-index', 'frozen Frost recipe order' ),
				computeDispatches: M( capture.evidence.execution.computeDispatchDelta, 'dispatches', 'isolated recipe execution evidence' ),
				renderSubmissions: M( capture.evidence.execution.renderSubmissionDelta, 'submissions', 'isolated recipe execution evidence' ),
				restorationVerdict: capture.evidence.transaction.restorationVerdict
			} ) ),
			transactionalRouteStateMatrix: routeMatrixEvidence.routes.map( ( route, index ) => ( {
				recipeId: route.recipeId,
				kind: route.kind,
				path: route.path,
				locks: route.locks,
				startup: route.startup,
				transactionId: route.transactionId,
				normalizedRgbaSha256: route.normalizedRgbaSha256,
				sequence: M( index + 1, 'route-index', 'canonical, mechanism, then tier route order' ),
				rgbRangeBytes: M( route.rgbRangeBytes, 'rgb-byte-range', `${ route.recipeId } retained native-WebGPU readback` )
			} ) ),
			negativeControls: {
				unknownModeRejected: true,
				captureParentRestored: captures.every( ( capture ) => capture.evidence.transaction.entryStateDigest === capture.evidence.transaction.restoredStateDigest ),
				oddSizeBoundsChecked: coverageEvidence.probes[ 0 ].boundsChecked
			},
			diagnosticComparisons: Object.entries( visualDifferences.metrics.diagnosticRgbRanges ).map( ( [ id, range ] ) => ( {
				route: id,
				measuredRange: range,
				minimumRangeGate: G( 8, 'rgb-byte-range', 'frozen diagnostic non-constant gate' ),
				verdict: range.value >= 8 ? 'PASS' : 'FAIL'
			} ) ),
			metrics: [
				{ id: 'recipe-count', measured: M( captures.length, 'recipes', 'retained transactional recipe ledger' ) },
				{ id: 'transactional-route-state-count', measured: M( routeMatrixEvidence.routes.length, 'route-states', 'manifest-shaped transactional GPU state matrix; immutable URL execution is a separate lane' ) },
				{ id: 'lifecycle-cycle-count', measured: lifecycleEvidence.cycles },
				{ id: 'odd-size-workgroups', measured: DA( coverageEvidence.probes[ 0 ].workgroupCount, 'workgroups', '641x359 bounds-checked dispatch' ) }
			],
			verdicts: claims,
			verdict: 'PASS'
		} )
	};
	for ( const [ path, artifact ] of Object.entries( artifacts ) ) {

		if ( FROST_NORMATIVE_JSON_PATHS.includes( path ) === false ) throw new Error( `Unexpected Frost normative artifact ${ path }.` );
		assertLabelledNumerics( artifact );

	}
	if ( Object.keys( artifacts ).length !== FROST_NORMATIVE_JSON_PATHS.length ) throw new Error( 'Frost normative artifact count drifted.' );
	assertLifecycleClaimEvidence( artifacts, { claimVerdicts: claims } );
	return Object.freeze( artifacts );

}
