import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { numericArray, numericDatum, NumericLabel } from './numeric-evidence.js';
import { getAlignedReadbackLayout } from './readback.js';
import { REQUIRED_V2_IMAGES, validateV2ArtifactBundle } from './schema/v2.js';

const RUNTIME_SOURCE = 'native WebGPU correctness capture';
const M = ( value, unit, source = RUNTIME_SOURCE ) => numericDatum( value, unit, NumericLabel.MEASURED, source );
const D = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.DERIVED, source );
const G = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.GATED, source );
const A = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.AUTHORED, source );
const MA = ( values, unit, source = RUNTIME_SOURCE ) => numericArray( values, unit, NumericLabel.MEASURED, source );
const AA = ( values, unit, source ) => numericArray( values, unit, NumericLabel.AUTHORED, source );

function schema( fields ) {

	return { schemaVersion: 2, ...fields };

}

function digest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( JSON.stringify( value ) ).digest( 'hex' ) }`;

}

function percentile( samples, quantile ) {

	const sorted = [ ...samples ].sort( ( a, b ) => a - b );
	const position = ( sorted.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	if ( lower === upper ) return sorted[ lower ];
	return sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

export function bytesPerTexel( format ) {

	if ( format === 'rgba16float' ) return 8;
	if ( format === 'rgba8unorm' || format === 'rgba8' ) return 4;
	if ( format === 'depth32float' ) return 4;
	throw new Error( `Runtime v2 assembler does not know the byte width of ${ format }.` );

}

function readbackEvidence( width, height, byteWidth, observed = null ) {

	const layout = getAlignedReadbackLayout( width, height, byteWidth );
	const record = {
		rowBytes: D( layout.rowBytes, 'byte', 'width * bytesPerTexel' ),
		bytesPerRow: G( layout.bytesPerRow, 'byte', 'WebGPU 256-byte texture-copy row alignment' ),
		minimumByteLength: D( layout.minimumByteLength, 'byte', 'bytesPerRow * (height - 1) + rowBytes' ),
		fullyPaddedByteLength: D( layout.fullyPaddedByteLength, 'byte', 'bytesPerRow * height' ),
		alignment: G( layout.alignment, 'byte', 'WebGPU texture-copy row alignment' )
	};
	if ( observed ) {

		record.observedSourceByteLength = M( observed.sourceByteLength, 'byte', 'original mapped WebGPU copy returned by LabController' );
		record.observedTransportByteLength = M( observed.transportByteLength, 'byte', 'compacted browser transport payload' );
		record.observedSourceLayout = observed.sourceLayout;

	}
	return record;

}

function targetArtifact( target, finalCapture ) {

	const byteWidth = bytesPerTexel( target.format );
	if ( target.bytesPerTexel !== byteWidth ) throw new Error( `${ target.name } bytesPerTexel does not match ${ target.format }.` );
	if ( target.bytes !== target.width * target.height * byteWidth ) throw new Error( `${ target.name } byte total does not reconcile with its extent and format.` );
	const isCaptureTarget = target.name === 'capture-target';
	return {
		name: target.name,
		owner: target.owner,
		semantic: isCaptureTarget ? 'color-managed RGBA8 validation readback' : `runtime ${ target.name } attachment`,
		width: M( target.width, 'pixel', 'LabController.describeResources' ),
		height: M( target.height, 'pixel', 'LabController.describeResources' ),
		format: target.format,
		bytesPerTexel: D( byteWidth, 'byte/texel', `${ target.format } format width` ),
		sampleCount: A( 1, 'sample/pixel', 'canonical validation subject disables MSAA' ),
		memoryBytes: D( target.bytes, 'byte', 'reported extent * format byte width' ),
		lifetime: 'one live validation subject generation',
		loadOp: 'clear',
		storeOp: 'store',
		readback: readbackEvidence( target.width, target.height, byteWidth, isCaptureTarget ? finalCapture : null ),
		directlyReadBack: isCaptureTarget
	};

}

function finiteNonnegativeCounters( counters, label ) {

	if ( counters === null || typeof counters !== 'object' || Array.isArray( counters ) ) throw new Error( `${ label } must be an object.` );
	const entries = Object.entries( counters ).filter( ( [ , value ] ) => typeof value === 'number' );
	if ( entries.length === 0 ) throw new Error( `${ label } has no numeric counters.` );
	for ( const [ name, value ] of entries ) {

		if ( Number.isFinite( value ) === false || value < 0 ) throw new Error( `${ label }.${ name } must be finite and nonnegative.` );

	}
	return entries;

}

function resourceBytes( resources, resourceName ) {

	const records = resources?.[ resourceName ];
	if ( Array.isArray( records ) === false ) throw new Error( `Lifecycle snapshot is missing resources.${ resourceName}.` );
	return records.reduce( ( sum, resource, index ) => {

		if ( Number.isFinite( resource?.bytes ) === false || resource.bytes < 0 ) throw new Error( `Lifecycle ${ resourceName }[${ index }].bytes must be finite and nonnegative.` );
		return sum + resource.bytes;

	}, 0 );

}

function rendererMemory( metrics, label ) {

	const memory = metrics?.rendererInfo?.memory;
	if ( memory === null || typeof memory !== 'object' || Array.isArray( memory ) ) throw new Error( `${ label}.rendererInfo.memory must be an object.` );
	return memory;

}

export function summarizeLifecycleEvidence( lifecycle ) {

	if ( lifecycle === null || typeof lifecycle !== 'object' ) return null;
	const cycles = lifecycle.cycles;
	if ( Number.isInteger( cycles ) === false || cycles < 50 || cycles > 100 ) throw new Error( 'Runtime lifecycle evidence must cover an integer 50-100 cycles.' );
	if ( Array.isArray( lifecycle.snapshots ) === false || lifecycle.snapshots.length !== cycles ) throw new Error( 'Runtime lifecycle snapshot count must equal the declared cycle count.' );

	const cycleSnapshots = lifecycle.snapshots.map( ( snapshot, index ) => {

		if ( snapshot?.cycle !== index ) throw new Error( `Runtime lifecycle cycle ${ index } is missing or out of order.` );
		if ( snapshot.beforeDispose?.backend?.isWebGPUBackend !== true ) throw new Error( `Runtime lifecycle cycle ${ index } did not initialize native WebGPU.` );
		if ( snapshot.afterDispose?.backend?.isWebGPUBackend !== true ) throw new Error( `Runtime lifecycle cycle ${ index } lost its backend identity before post-disposal measurement.` );
		const beforeMemory = rendererMemory( snapshot.beforeDispose, `lifecycle cycle ${ index } beforeDispose` );
		const afterMemory = rendererMemory( snapshot.afterDispose, `lifecycle cycle ${ index } afterDispose` );
		const beforeCounters = finiteNonnegativeCounters( beforeMemory, `lifecycle cycle ${ index } beforeDispose.rendererInfo.memory` );
		const afterCounters = finiteNonnegativeCounters( afterMemory, `lifecycle cycle ${ index } afterDispose.rendererInfo.memory` );
		const nonzeroAfter = afterCounters.filter( ( [ , value ] ) => value !== 0 );
		if ( nonzeroAfter.length > 0 ) throw new Error( `Runtime lifecycle cycle ${ index } retained renderer memory after disposal: ${ nonzeroAfter.map( ( [ name ] ) => name ).join( ', ' ) }.` );
		const beforeRendererBytes = beforeMemory.total;
		const afterRendererBytes = afterMemory.total;
		if ( Number.isFinite( beforeRendererBytes ) === false || Number.isFinite( afterRendererBytes ) === false ) throw new Error( `Runtime lifecycle cycle ${ index } is missing renderer-memory totals.` );
		const targetBytes = resourceBytes( snapshot.resources, 'renderTargets' );
		const storageBytes = resourceBytes( snapshot.resources, 'storageResources' );
		return { cycle: index, beforeRendererBytes, afterRendererBytes, targetBytes, storageBytes, beforeCounterCount: beforeCounters.length };

	} );

	const beforeRendererBytes = cycleSnapshots.map( ( snapshot ) => snapshot.beforeRendererBytes );
	const targetBytes = cycleSnapshots.map( ( snapshot ) => snapshot.targetBytes );
	const storageBytes = cycleSnapshots.map( ( snapshot ) => snapshot.storageBytes );
	return {
		cycles,
		cycleSnapshots,
		beforeRendererBytesMin: Math.min( ...beforeRendererBytes ),
		beforeRendererBytesMax: Math.max( ...beforeRendererBytes ),
		afterRendererBytesMax: Math.max( ...cycleSnapshots.map( ( snapshot ) => snapshot.afterRendererBytes ) ),
		targetBytesMin: Math.min( ...targetBytes ),
		targetBytesMax: Math.max( ...targetBytes ),
		storageBytesMax: Math.max( ...storageBytes )
	};

}

export function buildTraceSegment( samples, label, targetIntervalMs, presentationSamples = null ) {

	const source = `${ RUNTIME_SOURCE }; ${ label } CPU samples`;
	const measuredPresentation = Array.isArray( presentationSamples ) && presentationSamples.length > 0;
	const presentationSource = measuredPresentation
		? `${ RUNTIME_SOURCE }; requestAnimationFrame cadence with rendering enabled`
		: 'authored target interval; presentation cadence was not measured';
	const cadenceSamples = measuredPresentation ? presentationSamples : [ targetIntervalMs ];
	const presentationP95 = percentile( cadenceSamples, 0.95 );
	const deadlineMissRatio = measuredPresentation
		? cadenceSamples.filter( ( sample ) => sample > targetIntervalMs ).length / cadenceSamples.length
		: 1;
	return {
		cpuSamples: MA( samples, 'ms', source ),
		presentationSamples: measuredPresentation ? MA( cadenceSamples, 'ms', presentationSource ) : AA( cadenceSamples, 'ms', presentationSource ),
		cpuP50: M( percentile( samples, 0.5 ), 'ms', source ),
		cpuP95: M( percentile( samples, 0.95 ), 'ms', source ),
		presentationP95: measuredPresentation ? M( presentationP95, 'ms', presentationSource ) : A( presentationP95, 'ms', presentationSource ),
		deadlineMissRatio: measuredPresentation ? M( deadlineMissRatio, 'ratio', presentationSource ) : A( deadlineMissRatio, 'ratio', 'conservative unknown because presentation cadence was not measured' )
	};

}

export function classifyPerformanceTrace( trace, gates ) {

	if ( trace === null ) return 'INSUFFICIENT_EVIDENCE';
	for ( const [ value, label ] of [
		[ trace.cpuP95, 'CPU p95' ],
		[ trace.gpuP95, 'GPU p95' ],
		[ trace.deadlineMissRatio, 'deadline miss ratio' ],
		[ gates.cpuP95, 'CPU p95 gate' ],
		[ gates.gpuP95, 'GPU p95 gate' ],
		[ gates.deadlineMissRatio, 'deadline miss ratio gate' ]
	] ) {

		if ( Number.isFinite( value ) === false || value < 0 ) throw new Error( `${ label } must be finite and nonnegative.` );

	}
	if ( trace.cpuP95 > gates.cpuP95 || trace.gpuP95 > gates.gpuP95 || trace.deadlineMissRatio > gates.deadlineMissRatio ) return 'FAIL';
	return 'INSUFFICIENT_EVIDENCE';

}

function writeArtifacts( outputDir, artifacts ) {

	return Promise.all( Object.entries( artifacts ).map( ( [ filename, artifact ] ) => (
		writeFile( join( outputDir, filename ), `${ JSON.stringify( artifact, null, 2 ) }\n` )
	) ) );

}

export async function writeIncompleteV2RuntimeBundle( session, input ) {

	const { captures, runtime, diagnosticDifference } = input;
	const metrics = runtime.metrics;
	const pipeline = runtime.pipeline;
	const resources = runtime.resources;
	const gpuTiming = runtime.gpuTiming;
	const performanceTrace = runtime.performanceTrace;
	const lifecycle = summarizeLifecycleEvidence( runtime.lifecycle );
	const finalCapture = captures.find( ( capture ) => capture.filename === 'images/final.design.png' );
	const targetReadbackCapture = session.profile === 'performance'
		? captures.find( ( capture ) => capture.filename === 'images/final.performance.png' )
		: finalCapture;
	if ( ! finalCapture ) throw new Error( 'Runtime v2 assembler requires images/final.design.png capture metadata.' );
	if ( ! targetReadbackCapture ) throw new Error( 'Runtime v2 assembler requires capture metadata for the final resource state.' );
	if ( metrics.backend?.isWebGPUBackend !== true ) throw new Error( 'Runtime v2 assembler requires initialized native WebGPU metrics.' );
	if ( metrics.viewport.width !== session.profileConfig.width || metrics.viewport.height !== session.profileConfig.height || metrics.viewport.dpr !== session.profileConfig.dpr ) {

		throw new Error( 'Runtime v2 assembler received a noncanonical final viewport state.' );

	}
	const environment = await session.page.evaluate( () => ( {
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		language: navigator.language
	} ) );
	const targetRate = 60;
	const targetIntervalMs = 1000 / targetRate;
	const performanceGates = {
		cpuP95: targetIntervalMs - 2,
		gpuP95: targetIntervalMs - 2,
		deadlineMissRatio: 0.01
	};
	const performanceVerdict = classifyPerformanceTrace( performanceTrace, performanceGates );
	const claimVerdicts = {
		visualCorrectness: 'PASS',
		mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
		performanceCompliance: performanceVerdict,
		gpuAttribution: 'INSUFFICIENT_EVIDENCE',
		lifecycleStability: lifecycle === null ? 'INSUFFICIENT_EVIDENCE' : 'PASS'
	};
	const graphWithoutDigest = {
		owners: pipeline.owners,
		ownerClaims: [
			{ semantic: 'renderer', owner: pipeline.owners.renderer, producerCount: M( 1, 'owner', 'runtime pipeline ownership graph' ) },
			{ semantic: 'render-pipeline', owner: pipeline.owners.renderPipeline, producerCount: M( 1, 'owner', 'runtime pipeline ownership graph' ) },
			{ semantic: 'tone-map', owner: pipeline.finalToneMapOwner, producerCount: M( 1, 'owner', 'runtime pipeline ownership graph' ) },
			{ semantic: 'output-transform', owner: pipeline.finalOutputTransformOwner, producerCount: M( 1, 'owner', 'runtime pipeline ownership graph' ) }
		],
		signals: pipeline.signals,
		sceneSubmissions: pipeline.sceneSubmissions.map( ( submission ) => ( {
			id: submission.id,
			kind: submission.kind,
			submissionCount: M( submission.count, 'submission/frame', 'LabController.describePipeline' )
		} ) ),
		computeDispatches: pipeline.computeDispatches,
		resources: pipeline.resources,
		finalToneMapOwner: pipeline.finalToneMapOwner,
		finalOutputTransformOwner: pipeline.finalOutputTransformOwner,
		captureRoutes: {
			final: { mode: 'final', outputNodeId: 'final-output-node' },
			'no-post': { mode: 'no-post', outputNodeId: 'no-post-output-node' },
			diagnostics: { mode: 'diagnostics', outputNodeId: 'normal-and-emissive-output-nodes' }
		}
	};
	const pipelineGraphDigest = digest( graphWithoutDigest );
	const pipelineGraph = schema( { graphDigest: pipelineGraphDigest, ...graphWithoutDigest } );
	const knownCompromises = [
		...( performanceTrace === null
			? [ 'Correctness capture only; no sustained performance window was run.' ]
			: [ 'A sustained CPU/GPU/cadence trace was captured, but no performance verdict is promoted without per-stage attribution and governor stress.' ] ),
		'One resolved render timestamp proves availability but not per-stage GPU attribution.',
		...( lifecycle === null ? [ 'No lifecycle create/render/resize/mode/tier/dispose loop was run.' ] : [] ),
		performanceTrace === null
			? 'Adapter identity, adapter features, adapter limits, display refresh, and presentation cadence were not exposed by this capture path.'
			: 'Adapter identity, adapter features, adapter limits, and physical display refresh were not exposed; presentation cadence was measured from requestAnimationFrame intervals.'
	];
	const visualContract = schema( {
		contractRevision: 'webgpu-validation-runtime-v2-incomplete-1',
		subject: 'native WebGPU validation subject',
		identity: [ session.lab.id, session.lab.sourceHash, session.profile, metrics.tier ],
		invariants: [ {
			id: 'diagnostic-route-separation',
			statement: 'The diagnostic mosaic is assembled from live final, no-post, normal, and emissive output-node captures.',
			domain: 'image',
			truthSource: 'capture hook render-target readbacks',
			diagnostic: 'images/diagnostics.mosaic.png',
			metric: 'mean RGB byte difference from final',
			gate: G( 1, 'mean-rgb-byte-difference', 'frozen minimum diagnostic separation' ),
			requiredArtifacts: [ 'pipeline-graph.json', 'images/final.design.png', 'images/diagnostics.mosaic.png' ],
			blockingFailure: 'diagnostic routes collapse to final output'
		} ],
		requiredImages: [ ...REQUIRED_V2_IMAGES ],
		requiredDiagnostics: [ 'final', 'no-post', 'normal', 'emissive', 'near/design/far', 'seed pair', 'temporal pair' ],
		requiredMetrics: [ 'native backend', 'readback layout', 'pipeline owners', 'resource inventory', 'claim-separated verdicts' ],
		blockingFailures: [ 'non-WebGPU backend', 'unlabelled numeric', 'bad padded stride', 'false diagnostic route', 'publishable incomplete claims' ],
		allowedDivergences: knownCompromises,
		performanceClaims: {
			gpuTimingRequirement: performanceTrace === null ? 'not-claimed' : 'required',
			claims: performanceTrace === null ? [] : [ 'current-adapter total-frame performance at 1920x1080 DPR 1' ]
		},
		imageComparisons: [ {
			id: 'diagnostic-runtime-transport',
			baseline: 'images/final.design.png',
			candidate: 'images/diagnostics.mosaic.png',
			maxDifferingRatio: G( 1, 'ratio', 'structural ceiling; minimum separation is validated independently' )
		} ]
	} );
	const evidenceManifest = schema( {
		bundleKind: 'browser-capture-incomplete',
		publishable: false,
		skill: 'threejs-visual-validation',
		sceneId: 'webgpu-validation-harness-browser-capture',
		threeRevision: '0.185.1',
		evidenceBundleId: `runtime-${ session.profile }-${ session.lab.sourceHash }`,
		targetId: 'current-headless-chromium-webgpu-adapter',
		device: 'current automated browser target; stable hardware identity unavailable',
		browser: environment.userAgent,
		os: environment.platform,
		gpuAdapter: 'unavailable from current LabController/backend metrics',
		displayRefresh: A( targetRate, 'Hz', 'capture target assumption; display refresh was not measured' ),
		targetPresentationRate: G( targetRate, 'Hz', 'correctness contract target' ),
		renderer: metrics.rendererState.renderer,
		backend: {
			isWebGPUBackend: true,
			initialized: true,
			timestampAvailable: gpuTiming.verdict === 'PASS',
			unavailableReason: gpuTiming.reason,
			features: [],
			limits: {},
			deviceLostObserved: false,
			uncapturedErrors: []
		},
		qualityState: metrics.tier,
		viewport: {
			width: M( metrics.viewport.width, 'pixel', 'LabController.getMetrics' ),
			height: M( metrics.viewport.height, 'pixel', 'LabController.getMetrics' ),
			dpr: M( metrics.viewport.dpr, 'ratio', 'LabController.getMetrics' )
		},
		camera: {
			bookmark: metrics.camera,
			matrixWorld: MA( metrics.cameraState.matrixWorld, 'matrix element', 'live design camera matrixWorld' ),
			projectionMatrix: MA( metrics.cameraState.projectionMatrix, 'matrix element', 'live design camera projection matrix' ),
			near: M( metrics.cameraState.near, 'scene unit', 'live design camera clipping plane' ),
			far: M( metrics.cameraState.far, 'scene unit', 'live design camera clipping plane' )
		},
		seed: metrics.seed,
		time: { fixed: true, seconds: M( metrics.timeSeconds, 's', 'LabController fixed time' ), frame: M( 0, 'frame', 'fixed correctness capture frame' ) },
		assets: [],
		colorPipeline: {
			rendererOutputColorSpace: metrics.rendererState.outputColorSpace,
			rendererToneMapping: metrics.rendererState.toneMapping,
			rendererToneMappingExposure: M( metrics.rendererState.toneMappingExposure, 'ratio', 'live renderer state' ),
			outputBufferType: metrics.rendererState.outputBufferType,
			toneMapOwner: pipeline.finalToneMapOwner,
			outputTransformOwner: pipeline.finalOutputTransformOwner,
			hdrWorkingType: metrics.rendererState.outputBufferType,
			colorTextures: [ 'capture-target' ],
			dataTextures: [ 'normal', 'depth' ],
			screenshotEncoding: 'PNG RGBA8 from render-target readback'
		},
		stochasticMasks: [],
		knownCompromises,
		pipelineGraphDigest,
		claimVerdicts
	} );
	const rendererInfo = schema( {
		threeRevision: '0.185.1',
		renderer: metrics.rendererState.renderer,
		backend: 'WebGPU',
		outputColorSpace: metrics.rendererState.outputColorSpace,
		toneMapping: metrics.rendererState.toneMapping,
		toneMappingExposure: M( metrics.rendererState.toneMappingExposure, 'ratio', 'live renderer state' ),
		sampleCount: M( metrics.rendererState.sampleCount, 'sample/pixel', 'live renderer state' ),
		depthMode: metrics.rendererState.depthMode,
		outputBufferType: metrics.rendererState.outputBufferType,
		compatibilityMode: metrics.rendererState.compatibilityMode,
		timestampSupport: gpuTiming.verdict === 'PASS',
		adapterFeatures: [],
		adapterLimits: {},
		initializationState: 'await renderer.init completed; backend.isWebGPUBackend true',
		deviceErrors: [],
		rendererInfoSnapshots: [ {
			source: 'LabController.getMetrics.rendererInfo',
			serializationPolicy: metrics.rendererInfo.serialization.policy,
			numericCounters: 'retained in capture-session.json; not promoted without per-counter provenance'
		} ]
	} );
	const refreshPeriod = D( targetIntervalMs, 'ms', '1000 / authored 60 Hz correctness target' );
	const performanceEnvelope = schema( {
		gpuTimingRequirement: performanceTrace === null ? 'not-claimed' : 'required',
		refreshPeriod,
		browserMainThreadReserve: A( 1, 'ms', 'authored target envelope' ),
		compositorGpuReserve: A( 1, 'ms', 'authored target envelope' ),
		cpuSafetyReserve: A( 1, 'ms', 'authored target envelope' ),
		gpuSafetyReserve: A( 1, 'ms', 'authored target envelope' ),
		cpuSceneEnvelope: D( targetIntervalMs - 2, 'ms', 'refresh period - browser reserve - CPU reserve' ),
		gpuSceneEnvelope: D( targetIntervalMs - 2, 'ms', 'refresh period - compositor reserve - GPU reserve' ),
		cpuP95Gate: G( performanceGates.cpuP95, 'ms', 'frozen 60 Hz scene budget' ),
		gpuP95Gate: G( performanceGates.gpuP95, 'ms', 'frozen 60 Hz scene budget' ),
		deadlineMissRatioGate: G( performanceGates.deadlineMissRatio, 'ratio', performanceTrace === null ? 'authored target; presentation cadence unmeasured' : 'authored target applied to measured presentation cadence' )
	} );
	const samples = ( performanceTrace?.cpuSamples ?? metrics.cpuFrameMs.samples ).filter( Number.isFinite );
	if ( samples.length === 0 ) throw new Error( 'Runtime v2 assembler requires at least one measured CPU render sample.' );
	const warmupSamples = ( performanceTrace?.warmupCpuSamples ?? samples.slice( 0, Math.min( 5, samples.length ) ) ).filter( Number.isFinite );
	const sustainedSamples = performanceTrace === null ? samples.slice( Math.min( 5, samples.length ) ) : samples;
	if ( sustainedSamples.length === 0 ) sustainedSamples.push( samples[ samples.length - 1 ] );
	const gpuSamples = ( performanceTrace?.gpuSamples ?? [] ).filter( Number.isFinite );
	const measuredPresentationSamples = ( performanceTrace?.presentationSamples ?? [] ).filter( Number.isFinite );
	const measuredPresentationP50 = measuredPresentationSamples.length > 0 ? percentile( measuredPresentationSamples, 0.5 ) : null;
	const frameTrace = schema( {
		clockSource: 'performance.now around RenderPipeline.render calls',
		warmup: buildTraceSegment( warmupSamples, 'warmup capture sequence', targetIntervalMs ),
		cold: buildTraceSegment( [ samples[ 0 ] ], 'first post-initialization render', targetIntervalMs ),
		sustained: buildTraceSegment(
			sustainedSamples,
			performanceTrace === null ? 'remaining correctness capture sequence; not a sustained performance run' : `${ performanceTrace.sampleFrames }-frame sustained target-performance trace`,
			targetIntervalMs,
			measuredPresentationSamples
		),
		gpuTimingAvailable: gpuTiming.verdict === 'PASS',
		renderTimestamp: gpuSamples.length > 0
			? M( percentile( gpuSamples, 0.95 ), 'ms', 'sustained WebGPU render timestamp p95' )
			: gpuTiming.renderMs === null ? null : M( gpuTiming.renderMs, 'ms', 'single resolved Three.js render timestamp after correctness capture' ),
		computeTimestamp: gpuTiming.computeMs === null ? null : M( gpuTiming.computeMs, 'ms', 'single resolved Three.js compute timestamp after correctness capture' ),
		presentationCadence: measuredPresentationP50 === null
			? A( targetRate, 'frame/s', 'target only; presentation cadence was not measured' )
			: M( 1000 / measuredPresentationP50, 'frame/s', 'inverse measured requestAnimationFrame interval p50' ),
		gpuSamples: gpuSamples.length === 0 ? null : MA( gpuSamples, 'ms', 'one resolved WebGPU render timestamp per sustained frame' ),
		gpuP50: gpuSamples.length === 0 ? null : M( percentile( gpuSamples, 0.5 ), 'ms', 'sustained WebGPU render timestamp samples' ),
		gpuP95: gpuSamples.length === 0 ? null : M( percentile( gpuSamples, 0.95 ), 'ms', 'sustained WebGPU render timestamp samples' ),
		excludedPhases: performanceTrace === null
			? [ 'renderer initialization', 'pipeline compilation', 'readback mapping', 'PNG encoding', 'no sustained timing window' ]
			: [ 'renderer initialization', 'pipeline compilation', 'PNG encoding', 'timestamp readback excluded from CPU render samples', 'timestamp mapping disabled during cadence sampling' ]
	} );
	const qualityGovernor = schema( {
		enabled: false,
		states: [ metrics.tier ],
		inputMetric: 'none in correctness capture',
		filter: 'none',
		hysteresis: A( 0, 'ms', 'quality governor not exercised' ),
		minimumResidence: A( 0, 'frame', 'quality governor not exercised' ),
		transitions: [],
		settledState: metrics.tier,
		oscillationDetected: false
	} );
	const targets = resources.renderTargets.map( ( target ) => targetArtifact( target, targetReadbackCapture ) );
	const totalTargetBytes = resources.renderTargets.reduce( ( sum, target ) => sum + target.bytes, 0 );
	const renderTargets = schema( {
		targets,
		totalResidentBytes: D( totalTargetBytes, 'byte', 'sum of LabController render-target byte records' ),
		peakTransientBytes: D( totalTargetBytes, 'byte', 'all reported validation targets simultaneously live' )
	} );
	const storageResources = schema( {
		resources: [],
		totalResidentBytes: D( 0, 'byte', 'LabController reports no storage resources for the static MRT subject' ),
		dispatchOwnership: [],
		synchronization: 'none; no compute dispatches in this static validation subject',
		resetPolicy: 'not-applicable'
	} );
	const residentResources = schema( {
		textures: resources.renderTargets.map( ( target ) => target.name ),
		geometry: [ 'TorusKnotGeometry', 'PlaneGeometry', 'BoxGeometry' ],
		buffers: [],
		histories: [],
		staging: [ 'WebGPU readback staging is transient and its allocation bytes are not exposed' ],
		readback: [ 'capture-target' ],
		pipelineEstimate: 'unavailable from current renderer metrics',
		residentBytes: D( totalTargetBytes, 'byte', 'sum of exact logical color, depth32float, and capture-target allocations' ),
		peakLiveTransientBytes: D( totalTargetBytes, 'byte', 'reported targets only; staging allocation unavailable' ),
		uploadChurnPerFrame: A( 0, 'byte/frame', 'not measured; no upload-churn claim' )
	} );
	const bandwidthModel = schema( {
		passes: [ {
			id: 'scene-pass-and-capture-target',
			lower: D( totalTargetBytes, 'byte/frame', 'one store per reported target' ),
			upper: D( totalTargetBytes * 2, 'byte/frame', 'conservative load-plus-store bound without compression' )
		} ],
		lowerBoundBytesPerFrame: D( totalTargetBytes, 'byte/frame', 'reported target store lower bound' ),
		upperBoundBytesPerFrame: D( totalTargetBytes * 2, 'byte/frame', 'reported target load-plus-store upper bound' ),
		bytesPerSecond: D( totalTargetBytes * targetRate, 'byte/s', 'lower bound * authored target rate' ),
		assumptions: [ 'Logical uncompressed target bytes include depth32float; physical compression, cache, tile residency, and staging remain unclaimed.' ],
		hardwareCountersAvailable: false,
		verdict: 'INSUFFICIENT_EVIDENCE'
	} );
	const diagnosticSimilarity = Math.max( 0, 1 - diagnosticDifference / 255 );
	const visualErrors = schema( {
		metrics: [ {
			id: 'diagnostic-similarity-to-final',
			domain: 'output-node routing',
			truthSource: 'render-target RGB byte comparison',
			alignment: 'exact 1200x800 pixel coordinates',
			mask: 'all RGB pixels',
			measured: M( diagnosticSimilarity, 'ratio', '1 - minimum mean RGB byte difference / 255' ),
			gate: G( 0.99, 'ratio', 'diagnostics must differ materially from final' ),
			verdict: 'PASS',
			worstCaseArtifact: 'images/diagnostics.mosaic.png'
		} ],
		spatialErrorMaps: [],
		worstCaseArtifacts: [ 'images/diagnostics.mosaic.png' ]
	} );
	const leakLoop = lifecycle === null ? schema( {
		operations: [],
		cycles: M( 0, 'cycle', 'no lifecycle loop executed in this capture profile' ),
		before: { targetBytes: M( totalTargetBytes, 'byte', 'single resource snapshot; not a lifecycle baseline' ), storageBytes: M( 0, 'byte', 'single resource snapshot' ) },
		after: { targetBytes: M( totalTargetBytes, 'byte', 'same single resource snapshot; no after-loop sample exists' ), storageBytes: M( 0, 'byte', 'same single resource snapshot' ) },
		trend: { targetBytesPerCycle: A( 0, 'byte/cycle', 'undefined with zero cycles; no trend claim' ), storageBytesPerCycle: A( 0, 'byte/cycle', 'undefined with zero cycles; no trend claim' ) },
		gates: { targetBytes: G( 0, 'byte', 'future 50-100 cycle lifecycle gate' ), storageBytes: G( 0, 'byte', 'future 50-100 cycle lifecycle gate' ) },
		allowedCachePlateaus: [],
		deviceErrors: [],
		verdict: 'INSUFFICIENT_EVIDENCE'
	} ) : schema( {
		operations: [ 'create', 'await ready', 'resize width/height/DPR', 'change tier', 'change mode', 'reset history', 'render once', 'dispose', 'measure post-disposal renderer state' ],
		cycles: M( lifecycle.cycles, 'cycle', 'fresh-controller lifecycle runner result' ),
		before: {
			targetBytes: M( lifecycle.targetBytesMax, 'byte', 'maximum described render-target allocation across lifecycle cycles' ),
			storageBytes: M( lifecycle.storageBytesMax, 'byte', 'maximum described storage allocation across lifecycle cycles' )
		},
		after: {
			targetBytes: M( 0, 'byte', 'all post-disposal renderer-memory counters were measured at zero in every cycle' ),
			storageBytes: M( 0, 'byte', 'all post-disposal renderer-memory counters were measured at zero in every cycle' )
		},
		trend: {
			targetBytesPerCycle: M( 0, 'byte/cycle', 'post-disposal renderer-memory total is zero for every cycle' ),
			storageBytesPerCycle: M( 0, 'byte/cycle', 'post-disposal renderer-memory total is zero for every cycle' )
		},
		gates: {
			targetBytes: G( 0, 'byte', 'no retained target allocation is permitted after disposal' ),
			storageBytes: G( 0, 'byte', 'no retained storage allocation is permitted after disposal' )
		},
		allowedCachePlateaus: [],
		deviceErrors: [],
		verdict: 'PASS',
		rendererMemoryRange: {
			beforeMin: M( lifecycle.beforeRendererBytesMin, 'byte', 'minimum renderer-info memory total before disposal' ),
			beforeMax: M( lifecycle.beforeRendererBytesMax, 'byte', 'maximum renderer-info memory total before disposal' ),
			afterMax: M( lifecycle.afterRendererBytesMax, 'byte', 'maximum renderer-info memory total after disposal' )
		},
		resourceRange: {
			targetBytesMin: M( lifecycle.targetBytesMin, 'byte', 'minimum described render-target allocation across lifecycle resize states' ),
			targetBytesMax: M( lifecycle.targetBytesMax, 'byte', 'maximum described render-target allocation across lifecycle resize states' ),
			storageBytesMax: M( lifecycle.storageBytesMax, 'byte', 'maximum described storage allocation across lifecycle cycles' )
		},
		cycleSnapshots: lifecycle.cycleSnapshots.map( ( snapshot ) => ( {
			cycle: M( snapshot.cycle, 'cycle', 'fresh-controller lifecycle runner result' ),
			beforeRendererBytes: M( snapshot.beforeRendererBytes, 'byte', 'renderer-info memory total before disposal' ),
			afterRendererBytes: M( snapshot.afterRendererBytes, 'byte', 'renderer-info memory total after disposal' ),
			targetBytes: M( snapshot.targetBytes, 'byte', 'described render-target bytes before disposal' ),
			storageBytes: M( snapshot.storageBytes, 'byte', 'described storage bytes before disposal' )
		} ) )
	} );
	const captureMetrics = captures.filter( ( capture ) => Number.isFinite( capture.width ) && Number.isFinite( capture.height ) ).map( ( capture ) => ( {
		id: capture.filename,
		width: M( capture.width, 'pixel', 'capture record' ),
		height: M( capture.height, 'pixel', 'capture record' ),
		sourceBytesPerRow: Number.isFinite( capture.sourceBytesPerRow ) ? M( capture.sourceBytesPerRow, 'byte', 'original mapped WebGPU copy' ) : null,
		sourceByteLength: Number.isFinite( capture.sourceByteLength ) ? M( capture.sourceByteLength, 'byte', 'original mapped WebGPU copy' ) : null,
		transportByteLength: Number.isFinite( capture.transportByteLength ) ? M( capture.transportByteLength, 'byte', 'compacted browser transport' ) : null
	} ) );
	const mechanismMetrics = schema( {
		subjectAdapter: 'createNativeWebGPUValidationSubject',
		runtimeReachability: [ ...pipeline.signals.map( ( signal ) => signal.id ), ...pipeline.resources ],
		metrics: [
			{ id: 'diagnostic-mean-rgb-byte-difference', measured: M( diagnosticDifference, 'mean-rgb-byte-difference', 'minimum of final-vs-normal and final-vs-emissive' ), captures: [ 'images/diagnostic.normal.png', 'images/diagnostic.emissive.png' ] },
			{ id: 'render-timestamp-availability', verdict: gpuTiming.verdict, measured: gpuTiming.renderMs === null ? null : M( gpuTiming.renderMs, 'ms', 'single resolved render timestamp' ) },
			...( performanceTrace === null ? [] : [ {
				id: 'sustained-performance-trace',
				verdict: performanceVerdict,
				cpuP95: M( performanceTrace.cpuP95, 'ms', `${ performanceTrace.sampleFrames } sustained RenderPipeline CPU submission samples` ),
				gpuP95: M( performanceTrace.gpuP95, 'ms', `${ performanceTrace.sampleFrames } sustained WebGPU render timestamp samples` ),
				presentationP95: M( performanceTrace.presentationP95, 'ms', `${ performanceTrace.presentationSamples.length } requestAnimationFrame cadence intervals with rendering enabled` ),
				deadlineMissRatio: M( performanceTrace.deadlineMissRatio, 'ratio', 'measured cadence intervals above 16.6667 ms' )
			} ] ),
			{ id: 'readback-captures', records: captureMetrics }
		],
		verdicts: claimVerdicts
	} );
	const artifacts = {
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
	await writeArtifacts( session.outputDir, artifacts );
	const validation = await validateV2ArtifactBundle( session.outputDir );
	return {
		bundleKind: validation.bundleKind,
		publishable: validation.publishable,
		claimVerdicts: validation.claimVerdicts,
		requiredArtifactCount: M( validation.requiredArtifacts.length, 'artifact', 'v2 validator result' ),
		requiredImageCount: M( validation.requiredImages.length, 'image', 'v2 validator result' ),
		pipelineGraphDigest,
		diagnosticDifferingRatio: M( validation.imageEvidence.diagnosticDifferingRatio, 'ratio', 'v2 image validator result' )
	};

}
