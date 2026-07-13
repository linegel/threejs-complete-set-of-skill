import { numericDatum } from './physical-evidence-common.js';
import {
	createCorrectnessCaptureSessionFixture,
	createCorrectnessResourceLedgerFixture
} from './correctness-capture-session.fixture.js';
import {
	HARDWARE_PERFORMANCE_CONTRACT,
	HARDWARE_PERFORMANCE_ROUTE_PLAN,
	PHYSICAL_ROUTE_PLAN
} from './in-app-evidence-plan.js';
import { hashPhysicalRecord } from './physical-session-validator.js';

export const PHYSICAL_FIXTURE_HASH_A = `sha256:${ 'a'.repeat( 64 ) }`;
export const PHYSICAL_FIXTURE_HASH_B = `sha256:${ 'b'.repeat( 64 ) }`;
export const PHYSICAL_FIXTURE_HASH_C = `sha256:${ 'c'.repeat( 64 ) }`;
export const PHYSICAL_FIXTURE_HASH_D = `sha256:${ 'd'.repeat( 64 ) }`;

function fixtureIdentity( options = {} ) {

	const suppliedClosure = options.sourceClosure === undefined ? null : structuredClone( options.sourceClosure );
	const sourceClosureHash = options.sourceClosureHash ?? suppliedClosure?.sourceHash ?? PHYSICAL_FIXTURE_HASH_A;
	const buildRevision = options.buildRevision ?? suppliedClosure?.buildRevision ?? PHYSICAL_FIXTURE_HASH_B;
	const sourceClosure = suppliedClosure ?? {
		sourceHash: sourceClosureHash,
		buildRevision,
		threeRevision: '0.185.1',
		roots: [ 'package.json', 'package-lock.json', 'labs/runtime/aligned-readback.mjs' ]
	};
	sourceClosure.sourceHash = sourceClosureHash;
	sourceClosure.buildRevision = buildRevision;
	sourceClosure.threeRevision = '0.185.1';
	return { sourceClosureHash, buildRevision, sourceClosure };

}

function immutableBuild( identity ) {

	return {
		schemaVersion: 1,
		kind: 'immutable-physical-build',
		immutable: true,
		viteDevelopmentServer: false,
		transformAtServe: false,
		redirects: false,
		spaFallback: false,
		contentAddress: hashPhysicalRecord( {
			sourceClosureHash: identity.sourceClosureHash,
			buildRevision: identity.buildRevision,
			threeRevision: '0.185.1'
		} ),
		sourceClosureHash: identity.sourceClosureHash,
		buildRevision: identity.buildRevision,
		threeRevision: '0.185.1',
		sourceClosure: structuredClone( identity.sourceClosure ),
		bundleHash: PHYSICAL_FIXTURE_HASH_C,
		files: {
			'index.html': { sha256: PHYSICAL_FIXTURE_HASH_A, byteLength: 100 },
			'src/in-app-evidence.html': { sha256: PHYSICAL_FIXTURE_HASH_B, byteLength: 200 }
		}
	};

}

function routeRecord( plan, identity ) {

	const sourceBytesPerRow = Math.ceil( plan.startup.width * 4 / 256 ) * 256;
	const pipelineGraph = { route: plan.key, owner: 'native-validation-subject' };
	const resources = plan.runtimeProfile === 'performance'
		? createCorrectnessResourceLedgerFixture( plan.startup.width, plan.startup.height, plan.id === 'governor-stress' ? 0.5 : 1 )
		: { route: plan.key, targets: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] };
	return {
		key: plan.key,
		kind: plan.kind,
		id: plan.id,
		startup: structuredClone( plan.startup ),
		runtimeProfile: plan.runtimeProfile,
		controllerReady: true,
		finalUrlMatches: true,
		sourceClosureHash: identity.sourceClosureHash,
		buildRevision: identity.buildRevision,
		threeRevision: '0.185.1',
		pipelineGraphDigest: hashPhysicalRecord( pipelineGraph ),
		resourceDigest: hashPhysicalRecord( resources ),
		pipelineGraph,
		resources,
		backend: {
			isWebGPUBackend: true,
			initialized: true,
			deviceIdentityVerified: true,
			rendererDeviceGeneration: 1,
			controllerGeneration: 1,
			deviceLossGeneration: 0,
			deviceLostObserved: false,
			uncapturedErrors: []
		},
		adapter: { adapterClass: 'hardware', info: { vendor: 'Apple', device: 'M-series' } },
		state: {
			scenario: plan.startup.scenario,
			mode: plan.startup.mode,
			tier: plan.startup.tier,
			camera: plan.startup.camera,
			seed: plan.startup.seed,
			timeSeconds: plan.startup.timeSeconds,
			viewport: { width: plan.startup.width, height: plan.startup.height, dpr: plan.startup.dpr }
		},
		readback: {
			target: plan.startup.mode,
			width: plan.startup.width,
			height: plan.startup.height,
			bytesPerPixel: 4,
			rowBytes: plan.startup.width * 4,
			sourceBytesPerRow,
			format: 'rgba8unorm',
			resourceFormat: 'rgba8unorm-srgb',
			colorManaged: true,
			outputColorSpace: 'srgb',
			encoding: 'srgb',
			origin: 'top-left',
			sourceByteLength: sourceBytesPerRow * plan.startup.height,
			pixelByteLength: plan.startup.width * plan.startup.height * 4,
			transportByteLength: sourceBytesPerRow * plan.startup.height,
			normalizedByteLength: sourceBytesPerRow * plan.startup.height,
			pixelSha256: PHYSICAL_FIXTURE_HASH_A,
			transportSha256: PHYSICAL_FIXTURE_HASH_B,
			normalizedSha256: PHYSICAL_FIXTURE_HASH_C,
			transportLayout: {
				width: plan.startup.width,
				height: plan.startup.height,
				rowBytes: plan.startup.width * 4,
				bytesPerRow: sourceBytesPerRow,
				byteLength: sourceBytesPerRow * plan.startup.height,
				format: 'rgba8unorm',
				origin: 'top-left'
			},
			normalizedLayout: {
				width: plan.startup.width,
				height: plan.startup.height,
				rowBytes: plan.startup.width * 4,
				bytesPerRow: sourceBytesPerRow,
				byteLength: sourceBytesPerRow * plan.startup.height,
				format: 'rgba8unorm',
				origin: 'top-left'
			}
		},
		lifecycle: { disposeCompleted: true, twoAnimationFramesSettled: true, delayedErrors: [] },
		errors: []
	};

}

export function createPhysicalRouteRecordFixture( plan, options = {} ) {

	return routeRecord( plan, fixtureIdentity( options ) );

}

function serving( plan ) {

	return {
		status: 'FINALIZED_EXACT_STATIC_BYTES',
		ledgerSha256: PHYSICAL_FIXTURE_HASH_D,
		buildManifestFileSha256: PHYSICAL_FIXTURE_HASH_B,
		entries: plan.map( ( route ) => ( {
			status: 200,
			resolvedPath: 'index.html',
			query: new URLSearchParams( { lockKind: route.kind, lockId: route.id } ).toString(),
			sha256: PHYSICAL_FIXTURE_HASH_A,
			byteLength: 100,
			responseKind: 'exact-prebuilt-byte',
			redirected: false,
			fallback: false,
			transformed: false
		} ) )
	};

}

function baseSession( profile, plan, options ) {

	const identity = fixtureIdentity( options );
	const refreshIntervals = Array( 120 ).fill( 16.67 );
	refreshIntervals.fill( 17.17, 0, 8 );
	return {
		schemaVersion: 1,
		profile,
		automationSurface: 'codex-in-app-browser',
		startedAt: '2026-07-12T09:00:00.000Z',
		servedLedgerStartedAt: '2026-07-12T09:00:00.000Z',
		finishedAt: '2026-07-12T09:01:00.000Z',
		browser: { webdriver: false, headless: false, visibilityState: 'visible' },
		adapter: { adapterClass: 'hardware', identity: { vendor: 'Apple', device: 'M-series' } },
		refresh: {
			hz: numericDatum( 1000 / 16.67, 'Hz', 'Measured', 'idle-rAF' ),
			measurementDuration: numericDatum( 2100, 'ms', 'Measured', 'idle-rAF' ),
			intervals: { values: refreshIntervals, unit: 'ms', label: 'Measured', source: 'idle-rAF intervals' },
			p50: numericDatum( 16.67, 'ms', 'Measured', 'idle-rAF intervals' ),
			p95: numericDatum( 17.17, 'ms', 'Measured', 'idle-rAF intervals' )
		},
		immutableBuild: immutableBuild( identity ),
		routeOrder: plan.map( ( route ) => route.key ),
		routes: plan.map( ( route ) => routeRecord( route, identity ) ),
		serving: serving( plan )
	};

}

export function createPhysicalRouteSessionFixture( options = {} ) {

	return baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN, options );

}

export function createPhysicalTimestampBatchFixture( { frameBase = 0, frameCallBase = 0 } = {} ) {

	const timestampRows = Array.from( { length: 120 }, ( _, index ) => {

		const frameId = frameBase + index;
		return {
			frameId,
			sceneUid: `r:${ frameCallBase + index * 2 + 2 }:17:f${ frameId }`,
			outputUid: `r:${ frameCallBase + index * 2 + 1 }:41:f${ frameId }`,
			sceneMs: 1,
			outputMs: 0.5,
			totalMs: 1.5,
			residualMs: null,
			totalProvenance: 'Derived',
			independentPerFrameTotalAvailable: false
		};

	} );
	return {
		verdict: 'PASS',
		mappingCadence: 'once-per-batch',
		warmupFrames: numericDatum( 30, 'frame', 'Measured', 'warm-up batch' ),
		warmupCpuSamples: { values: Array( 30 ).fill( 1.1 ), unit: 'ms', label: 'Measured', source: 'performance.now' },
		sampleFrames: numericDatum( 120, 'frame', 'Measured', 'timestamp batch' ),
		cpuSamples: { values: Array( 120 ).fill( 1.2 ), unit: 'ms', label: 'Measured', source: 'performance.now' },
		resolveCount: numericDatum( 1, 'resolve', 'Measured', 'timestamp batch' ),
		gpuSamples: { values: timestampRows.map( ( row ) => row.totalMs ), unit: 'ms', label: 'Measured', source: 'WebGPU timestamp rows' },
		timestampRows,
		stageContextIds: { 'scene-mrt': 17, 'final-output': 41 },
		lastFrameResolveResidualMs: 0,
		independentPerFrameTotalsAvailable: false,
		reconciliationKind: 'final-renderer-frame-aggregate',
		reconciliationScope: 'Independent Three aggregate checked only for the final-frame resolve.'
	};

}

function sustainedWindow( presentationSampleCount = 1800 ) {

	const presentationSamples = Array( presentationSampleCount ).fill( 16.67 );
	const duration = presentationSamples.reduce( ( sum, sample ) => sum + sample, 0 );
	return {
		duration: numericDatum( duration, 'ms', 'Measured', 'monotonic clock' ),
		sampleCount: numericDatum( presentationSamples.length, 'sample', 'Measured', 'rAF intervals' ),
		presentationSamples: { values: presentationSamples, unit: 'ms', label: 'Measured', source: 'rAF intervals' },
		maximumPresentationGap: numericDatum( 16.67, 'ms', 'Measured', 'rAF intervals' ),
		presentationCoverage: numericDatum( presentationSamples.length / ( duration / 16.67 ), 'ratio', 'Derived', 'observed/expected intervals' ),
		gpuTimestampBatches: [ createPhysicalTimestampBatchFixture() ]
	};

}

function governorWindow( window, measuredTier, tier, gpuP95, decision, residence, cooldown ) {

	const timestampRows = Array.from( { length: 30 }, ( _, frameId ) => ( {
		frameId,
		sceneUid: `governor-scene:${ window }:${ frameId }`,
		outputUid: `governor-output:${ window }:${ frameId }`,
		sceneMs: gpuP95 - 0.5,
		outputMs: 0.5,
		totalMs: gpuP95,
		residualMs: null,
		totalProvenance: 'Derived',
		independentPerFrameTotalAvailable: false
	} ) );
	return {
		window,
		measuredTier,
		tier,
		gpuSamples: timestampRows.map( ( row ) => row.totalMs ),
		gpuP95,
		timestampRows,
		lastFrameResolveResidualMs: 0,
		decision,
		residence,
		cooldown
	};

}

function governorTrace() {

	const targetResourceBytes = createCorrectnessResourceLedgerFixture( 1920, 1080, 1 ).trackedRenderTargetBytes;
	const stressResourceBytes = createCorrectnessResourceLedgerFixture( 1920, 1080, 0.5 ).trackedRenderTargetBytes;
	return {
		adapterClass: 'hardware',
		windowCount: 6,
		framesPerWindow: 30,
		targetMs: 1000 / 60 - 2,
		hysteresisMs: 2,
		minimumResidenceWindows: 2,
		cooldownWindows: 2,
		states: [ 'target-performance', 'governor-stress' ],
		initialState: 'governor-stress',
		windows: [
			governorWindow( 0, 'governor-stress', 'governor-stress', 10, 'hold', 1, 0 ),
			governorWindow( 1, 'governor-stress', 'target-performance', 10, 'upgrade', 0, 2 ),
			governorWindow( 2, 'target-performance', 'target-performance', 10, 'hold', 1, 1 ),
			governorWindow( 3, 'target-performance', 'target-performance', 10, 'hold', 2, 0 ),
			governorWindow( 4, 'target-performance', 'target-performance', 10, 'hold', 3, 0 ),
			governorWindow( 5, 'target-performance', 'target-performance', 10, 'hold', 4, 0 )
		],
		transitions: [ {
			window: 1,
			from: 'governor-stress',
			to: 'target-performance',
			cause: 'gpu-p95-below-hysteresis',
			gpuP95: 10,
			rebuildCpuSubmissionMs: 0.2,
			rebuildGpuMs: 1.5,
			rebuildTimestampRow: {
				frameId: 0,
				sceneUid: 'governor-transition-scene:1',
				outputUid: 'governor-transition-output:1',
				sceneMs: 1,
				outputMs: 0.5,
				totalMs: 1.5,
				residualMs: null,
				totalProvenance: 'Derived',
				independentPerFrameTotalAvailable: false
			},
			lastFrameResolveResidualMs: 0,
			fromResourceBytes: stressResourceBytes,
			toResourceBytes: targetResourceBytes
		} ],
		settledState: 'target-performance',
		oscillationDetected: false
	};

}

export function createHardwarePerformanceSessionFixture( options = {} ) {

	return {
		...baseSession( 'performance', HARDWARE_PERFORMANCE_ROUTE_PLAN, options ),
		viewport: { width: 1920, height: 1080, dpr: 1 },
		hostReserve: { p95: numericDatum( 0.5, 'ms', 'Measured', 'idle host shell' ) },
		compositorReserve: { verdict: 'NOT_CLAIMED', reason: 'no real API' },
		cold: sustainedWindow( HARDWARE_PERFORMANCE_CONTRACT.coldMinimumSamples.value ),
		sustainedWindows: [ sustainedWindow(), sustainedWindow() ],
		governor: {
			verdict: 'PASS',
			oscillationDetected: false,
			settled: true,
			settledState: 'target-performance',
			settledResidenceWindows: numericDatum( 4, 'window', 'Measured', 'governor trace' ),
			trace: governorTrace()
		}
	};

}

export function createTierVisualEvidenceFixture() {

	const binding = {
		reference: {
			recipeId: 'tier.target-performance.final',
			pngSha256: PHYSICAL_FIXTURE_HASH_A,
			passScale: 1,
			transaction: {
				status: 'COMMITTED',
				restorationVerdict: 'PASS',
				entryStateDigest: PHYSICAL_FIXTURE_HASH_A,
				restoredStateDigest: PHYSICAL_FIXTURE_HASH_A
			},
			normalized: {
				width: 1920,
				height: 1080,
				compactByteLength: 1920 * 1080 * 4,
				compactRgbaSha256: PHYSICAL_FIXTURE_HASH_B
			},
			effectiveState: {
				scenario: 'timing-and-governor',
				mode: 'final',
				tier: 'target-performance',
				passScale: 1,
				outputNodeMode: 'final',
				viewport: { width: 1920, height: 1080, dpr: 1 },
				sceneTarget: { width: 1920, height: 1080 }
			}
		},
		candidate: {
			recipeId: 'tier.governor-stress.final',
			pngSha256: PHYSICAL_FIXTURE_HASH_C,
			passScale: 0.5,
			transaction: {
				status: 'COMMITTED',
				restorationVerdict: 'PASS',
				entryStateDigest: PHYSICAL_FIXTURE_HASH_A,
				restoredStateDigest: PHYSICAL_FIXTURE_HASH_A
			},
			normalized: {
				width: 1920,
				height: 1080,
				compactByteLength: 1920 * 1080 * 4,
				compactRgbaSha256: PHYSICAL_FIXTURE_HASH_D
			},
			effectiveState: {
				scenario: 'timing-and-governor',
				mode: 'final',
				tier: 'governor-stress',
				passScale: 0.5,
				outputNodeMode: 'final',
				viewport: { width: 1920, height: 1080, dpr: 1 },
				sceneTarget: { width: 960, height: 540 }
			}
		}
	};
	const metrics = {
		meanRgbByteDifference: numericDatum( 0.25, 'mean-rgb-byte-difference', 'Measured', 'tier readback comparison' ),
		edgeMaskPixels: numericDatum( 100, 'pixels', 'Measured', 'reference edge mask' ),
		edgeMeanRgbByteDifference: numericDatum( 0.5, 'mean-rgb-byte-difference', 'Measured', 'tier readback comparison' ),
		edgeP95RgbByteDifference: numericDatum( 1, 'mean-rgb-byte-difference', 'Measured', 'tier readback comparison' )
	};
	const gates = {
		meanRgbByteDifference: numericDatum( 8, 'mean-rgb-byte-difference', 'Gated', 'frozen tier gate' ),
		edgeP95RgbByteDifference: numericDatum( 32, 'mean-rgb-byte-difference', 'Gated', 'frozen tier gate' )
	};
	return {
		schemaVersion: 1,
		kind: 'validation-harness-tier-visual-evidence-v1',
		binding,
		metrics,
		gates,
		bindingSha256: hashPhysicalRecord( { binding, metrics, gates } ),
		verdict: 'PASS'
	};

}

export function createTierVisualResourceEvidenceFixture() {

	const document = createTierVisualEvidenceFixture();
	const resourceEvidence = createCorrectnessCaptureSessionFixture().hookResult.tierVisualEvidence;
	document.binding.reference.resources = structuredClone( resourceEvidence.binding.reference.resources );
	document.binding.candidate.resources = structuredClone( resourceEvidence.binding.candidate.resources );
	document.bindingSha256 = hashPhysicalRecord( { binding: document.binding, metrics: document.metrics, gates: document.gates } );
	return document;

}
