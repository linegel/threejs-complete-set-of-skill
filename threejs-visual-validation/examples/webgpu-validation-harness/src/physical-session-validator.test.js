import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { numericDatum } from './physical-evidence-common.js';
import { createCorrectnessCaptureSessionFixture, createCorrectnessResourceLedgerFixture } from './correctness-capture-session.fixture.js';
import { HARDWARE_PERFORMANCE_CONTRACT, HARDWARE_PERFORMANCE_ROUTE_PLAN, PHYSICAL_ROUTE_PLAN } from './in-app-evidence-plan.js';
import { createRuntimeGovernorTrace, createRuntimePerformanceTrace } from './physical-performance-trace.js';
import { projectValidationHarnessPerformanceEvidence } from './performance-evidence-projection.js';
import { validatePhysicalEvidenceRecordFile } from './physical-validate-record.js';
import {
	hashPhysicalRecord,
	validateCorrectnessCaptureSession,
	validateHardwarePerformanceSession,
	validatePhysicalRouteSession
} from './physical-session-validator.js';
import { finalizeImportedPhysicalRecord, loadVerifiedImportedPhysicalRecord } from './verified-physical-record.js';
import { classifyGovernorTrace, classifyGpuStageAttribution, classifyPerformanceTrace } from './runtime-v2-bundle.js';

const HASH_A = `sha256:${ 'a'.repeat( 64 ) }`;
const HASH_B = `sha256:${ 'b'.repeat( 64 ) }`;
const HASH_C = `sha256:${ 'c'.repeat( 64 ) }`;
const HASH_D = `sha256:${ 'd'.repeat( 64 ) }`;

function immutableBuild() {

	return {
		schemaVersion: 1,
		kind: 'immutable-physical-build',
		immutable: true,
		viteDevelopmentServer: false,
		transformAtServe: false,
		redirects: false,
		spaFallback: false,
		contentAddress: hashPhysicalRecord( { sourceClosureHash: HASH_A, buildRevision: HASH_B, threeRevision: '0.185.1' } ),
		sourceClosureHash: HASH_A,
		buildRevision: HASH_B,
		threeRevision: '0.185.1',
		sourceClosure: {
			sourceHash: HASH_A,
			buildRevision: HASH_B,
			threeRevision: '0.185.1',
			roots: [ 'package.json', 'package-lock.json', 'labs/runtime/aligned-readback.mjs' ]
		},
		bundleHash: HASH_C,
		files: {
			'index.html': { sha256: HASH_A, byteLength: 100 },
			'src/in-app-evidence.html': { sha256: HASH_B, byteLength: 200 }
		}
	};

}

function routeRecord( plan ) {

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
		sourceClosureHash: HASH_A,
		buildRevision: HASH_B,
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
			pixelSha256: HASH_A,
			transportSha256: HASH_B,
			normalizedSha256: HASH_C,
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

function serving( plan ) {

	return {
		status: 'FINALIZED_EXACT_STATIC_BYTES',
		ledgerSha256: HASH_D,
		buildManifestFileSha256: HASH_B,
		entries: plan.map( ( route ) => ( {
			status: 200,
			resolvedPath: 'index.html',
			query: new URLSearchParams( { lockKind: route.kind, lockId: route.id } ).toString(),
			sha256: HASH_A,
			byteLength: 100,
			responseKind: 'exact-prebuilt-byte',
			redirected: false,
			fallback: false,
			transformed: false
		} ) )
	};

}

function baseSession( profile, plan ) {

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
		immutableBuild: immutableBuild(),
		routeOrder: plan.map( ( route ) => route.key ),
		routes: plan.map( routeRecord ),
		serving: serving( plan )
	};

}

async function importedWrapper( record, options = {} ) {

	const finalized = structuredClone( record );
	finalized.publishable = options.publishable ?? false;
	finalized.acceptanceStatus = options.acceptanceStatus ?? 'incomplete';
	finalized.serving.ledgerSha256 = options.servedLedgerSha256 ?? hashPhysicalRecord( finalized.serving.entries );
	const wrapper = finalizeImportedPhysicalRecord( finalized );
	const directory = options.directory ?? await mkdtemp( join( tmpdir(), 'threejs-verified-physical-' ) );
	const path = join( directory, options.filename ?? `${ finalized.profile }.json` );
	const bytes = Buffer.from( options.compact === true ? JSON.stringify( wrapper ) : `${ JSON.stringify( wrapper, null, 2 ) }\n` );
	await writeFile( path, bytes, { flag: 'wx' } );
	return { path, bytes, wrapper };

}

function timestampBatch( { frameBase = 0, frameCallBase = 0 } = {} ) {

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
		gpuTimestampBatches: [ timestampBatch() ]
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

function performanceSession() {

	return {
		...baseSession( 'performance', HARDWARE_PERFORMANCE_ROUTE_PLAN ),
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

function tierVisualEvidence() {

	const binding = {
		reference: {
			recipeId: 'tier.target-performance.final',
			pngSha256: HASH_A,
			passScale: 1,
			transaction: { status: 'COMMITTED', restorationVerdict: 'PASS', entryStateDigest: HASH_A, restoredStateDigest: HASH_A },
			normalized: { width: 1920, height: 1080, compactByteLength: 1920 * 1080 * 4, compactRgbaSha256: HASH_B },
			effectiveState: { scenario: 'timing-and-governor', mode: 'final', tier: 'target-performance', passScale: 1, outputNodeMode: 'final', viewport: { width: 1920, height: 1080, dpr: 1 }, sceneTarget: { width: 1920, height: 1080 } }
		},
		candidate: {
			recipeId: 'tier.governor-stress.final',
			pngSha256: HASH_C,
			passScale: 0.5,
			transaction: { status: 'COMMITTED', restorationVerdict: 'PASS', entryStateDigest: HASH_A, restoredStateDigest: HASH_A },
			normalized: { width: 1920, height: 1080, compactByteLength: 1920 * 1080 * 4, compactRgbaSha256: HASH_D },
			effectiveState: { scenario: 'timing-and-governor', mode: 'final', tier: 'governor-stress', passScale: 0.5, outputNodeMode: 'final', viewport: { width: 1920, height: 1080, dpr: 1 }, sceneTarget: { width: 960, height: 540 } }
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

function correctnessCaptureSession() {

	return createCorrectnessCaptureSessionFixture();

}
test( 'complete 19-route physical session passes strict validation', () => {

	const session = baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN );
	assert.deepEqual( validatePhysicalRouteSession( session ), { valid: true, profile: 'physical-route', routeCount: 19 } );

} );

test( 'complete correctness session uses the shared Playwright capture surface', () => {

	const session = correctnessCaptureSession();
	assert.deepEqual( validateCorrectnessCaptureSession( session ), {
		valid: true,
		profile: 'correctness',
		outputCount: 10,
		captureCount: 14,
		recipeCount: 14,
		adapterClass: 'hardware'
	} );
	const crossed = structuredClone( session );
	crossed.automationSurface = 'codex-in-app-browser';
	assert.throws( () => validateCorrectnessCaptureSession( crossed ), /playwright-headless-chromium/ );

} );

test( 'correctness recipe mutations fail closed across identity, restoration, resources, artifacts, and claim scope', () => {

	const mutations = [
		[ 'missing recipe', ( value ) => { value.writtenCaptures.pop(); }, /exactly 14 direct recipe/ ],
		[ 'reordered recipe', ( value ) => { [ value.writtenCaptures[ 0 ], value.writtenCaptures[ 1 ] ] = [ value.writtenCaptures[ 1 ], value.writtenCaptures[ 0 ] ]; }, /target does not match recipe/ ],
		[ 'stale recipe digest', ( value ) => { value.writtenCaptures[ 0 ].evidence.recipe.digest = HASH_D; }, /recipe or recipe-set digest/ ],
		[ 'crossed capture mode', ( value ) => { value.writtenCaptures[ 0 ].captureMode = 'normal'; }, /captureMode does not match/ ],
		[ 'crossed parent route', ( value ) => { value.writtenCaptures[ 0 ].evidence.recipe.parentRoute.id = 'target-performance'; }, /parent\/effective-state contract/ ],
		[ 'expanded claim scope', ( value ) => { value.writtenCaptures[ 0 ].evidence.claimScope.performance = true; }, /claim scope is not correctness-only/ ],
		[ 'uncommitted transaction', ( value ) => { value.writtenCaptures[ 0 ].evidence.transaction.status = 'FAILED'; }, /not a committed recipe restoration/ ],
		[ 'missing settle phase', ( value ) => { value.writtenCaptures[ 0 ].evidence.transaction.phaseVerdicts.settle = 'NOT_RUN'; }, /phase verdicts/ ],
		[ 'forged full-state digest', ( value ) => { value.writtenCaptures[ 0 ].evidence.entryState.cameraState.matrixWorld[ 0 ] = 2; }, /digest does not bind its complete state/ ],
		[ 'stale parent-state digest', ( value ) => { value.writtenCaptures[ 0 ].evidence.parentStartupStateDigest = HASH_D; }, /parent startup digest/ ],
		[ 'semantic state drift with rehash', ( value ) => {

			const capture = value.writtenCaptures[ 0 ];
			capture.evidence.effectiveState.camera = 'far';
			capture.evidence.effectiveStateDigest = hashPhysicalRecord( capture.evidence.effectiveState );

		}, /effective camera differs/ ],
		[ 'device generation drift', ( value ) => {

			const capture = value.writtenCaptures[ 0 ];
			capture.evidence.effectiveState.device.rendererDeviceGeneration ++;
			capture.evidence.effectiveStateDigest = hashPhysicalRecord( capture.evidence.effectiveState );

		}, /crossed a device identity/ ],
		[ 'resource identity replacement', ( value ) => { value.writtenCaptures[ 0 ].evidence.resources.effective.renderTargets[ 0 ].textureUuid = 'replacement-texture'; }, /changed live resource identities/ ],
		[ 'tier resource extent drift', ( value ) => {

			const target = value.writtenCaptures[ 13 ].evidence.resources.effective.renderTargets.find( ( row ) => row.semantic === 'output' );
			target.width = 1920;
			target.bytes = target.width * target.height * target.bytesPerTexel;
			target.logicalBytes = target.bytes;
			target.liveBytes = target.bytes;
			value.writtenCaptures[ 13 ].evidence.resources.effective.trackedRenderTargetBytes = value.writtenCaptures[ 13 ].evidence.resources.effective.renderTargets.reduce( ( sum, row ) => sum + row.liveBytes, 0 );

		}, /output extent/ ],
		[ 'forged submission delta', ( value ) => { value.writtenCaptures[ 0 ].evidence.submissions.captureDelta.renderSubmissions = 2; }, /does not reconcile/ ],
		[ 'duplicated t001 render time', ( value ) => { value.writtenCaptures[ 10 ].evidence.submissions.captureRenderTrace[ 0 ].timeSeconds = 1 / 60; }, /adjacent render timeline/ ],
		[ 'discontinuous submission counters', ( value ) => { value.writtenCaptures[ 1 ].evidence.submissions.entry.renderSubmissionCount ++; }, /does not continue/ ],
		[ 'rewound reset telemetry', ( value ) => {

			value.writtenCaptures[ 10 ].evidence.telemetry.entry.resetEvents = [];
			value.writtenCaptures[ 10 ].evidence.telemetry.entry.resetEventCount = 0;

		}, /does not continue the prior append-only/ ],
		[ 'wrong reset cause', ( value ) => { value.writtenCaptures[ 9 ].evidence.telemetry.appendedDuringCapture[ 0 ].cause = 'forged'; }, /not the exact append slice|wrong reset cause/ ],
		[ 'restoration reset append', ( value ) => {

			value.writtenCaptures[ 9 ].evidence.telemetry.appendedDuringRestoration.push( { cause: 'forged', timeSeconds: 0 } );
			value.writtenCaptures[ 9 ].evidence.telemetry.restorationHistoryResetDelta = 1;

		}, /reset deltas differ/ ],
		[ 'artifact hash mismatch', ( value ) => { value.artifactWrites.find( ( row ) => row.path === 'final.design.png' ).sha256 = HASH_D; }, /hash\/length does not exactly join/ ],
		[ 'artifact length mismatch', ( value ) => { value.writtenCaptures[ 0 ].png.byteLength ++; }, /hash\/length does not exactly join/ ],
		[ 'duplicate transaction path provenance', ( value ) => { value.writtenCaptures[ 1 ].evidence.transaction.transactionId = 'capture-1'; }, /transaction provenance/ ],
		[ 'stale tier capture digest', ( value ) => { value.hookResult.tierVisualEvidence.binding.reference.captureEvidenceSha256 = HASH_D; }, /capture-evidence digest/ ],
		[ 'aliased tier normalized path', ( value ) => { value.hookResult.tierVisualEvidence.binding.candidate.normalized.artifact.path = value.hookResult.tierVisualEvidence.binding.reference.normalized.artifact.path; }, /normalized readback binding|alias transaction or artifact/ ],
		[ 'forged tier document bytes', ( value ) => {

			value.hookResult.tierVisualEvidence.metrics.meanRgbByteDifference = {
				...value.hookResult.tierVisualEvidence.metrics.meanRgbByteDifference,
				value: 3
			};

		}, /bindingSha256|tier-visual-evidence/ ],
		[ 'performance claim in correctness lane', ( value ) => { value.hookResult.bundle.claimVerdicts.performanceCompliance = 'PASS'; }, /leave performanceCompliance NOT_CLAIMED/ ],
		[ 'timestamp queries in correctness lane', ( value ) => { value.finalRuntime.pipeline.timestampQueriesActive = true; }, /must be false in correctness-only evidence/ ],
		[ 'post-commit poison', ( value ) => { value.finalRuntime.metrics.postCommitPoison = { recipeId: 'temporal.t001', reason: 'late failure' }; }, /post-commit poison/ ],
		[ 'final route drift', ( value ) => { value.route.finalState.camera = 'far'; }, /differs from the tier\/webgpu-correctness parent lock/ ],
		[ 'direct output detached from recipe', ( value ) => { value.outputPlan[ 0 ].artifact.sha256 = HASH_D; }, /hash\/length does not exactly join/ ],
		[ 'mosaic aliases final', ( value ) => {

			const mosaic = value.outputPlan.find( ( output ) => output.id === 'diagnostics.mosaic' );
			mosaic.artifact.sha256 = HASH_A;
			const hookMosaic = value.hookResult.standardOutputs[ 0 ];
			hookMosaic.file.sha256 = HASH_A;
			hookMosaic.pixelEvidence.png.sha256 = HASH_A;
			value.artifactWrites.find( ( row ) => row.path === 'diagnostics.mosaic.png' ).sha256 = HASH_A;

		}, /aliases final output/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = correctnessCaptureSession();
		mutate( value );
		assert.throws( () => validateCorrectnessCaptureSession( value ), pattern, name );

	}

} );

test( 'physical session mutations reject nonphysical or mutable evidence', () => {

	const mutations = [
		[ 'Vite development', ( value ) => { value.immutableBuild.viteDevelopmentServer = true; }, /Vite development/ ],
		[ 'headless', ( value ) => { value.browser.headless = true; }, /Headless/ ],
		[ 'software adapter', ( value ) => { value.adapter.adapterClass = 'software'; }, /Software, virtual, and unknown/ ],
		[ 'virtual adapter', ( value ) => { value.adapter.adapterClass = 'virtual'; }, /Software, virtual, and unknown/ ],
		[ 'unknown adapter', ( value ) => { value.adapter.adapterClass = 'unknown'; }, /Software, virtual, and unknown/ ],
		[ 'authored refresh', ( value ) => { value.refresh.hz.label = 'Authored'; }, /Measured/ ],
		[ 'forged refresh Hz', ( value ) => { value.refresh.hz.value = 30; }, /does not reconcile/ ],
		[ 'route state drift', ( value ) => { value.routes[ 0 ].state.camera = 'near'; }, /camera drifted/ ],
		[ 'linearized capture resource', ( value ) => { value.routes[ 0 ].readback.resourceFormat = 'rgba8unorm'; }, /sRGB RGBA8 capture-target resource/ ],
		[ 'copy bytes mislabeled sRGB', ( value ) => { value.routes[ 0 ].readback.format = 'rgba8unorm-srgb'; }, /distinguish raw four-channel/ ],
		[ 'wrong output encoding', ( value ) => { value.routes[ 0 ].readback.encoding = 'display-p3'; }, /color\/encoding\/origin/ ],
		[ 'unaligned stride', ( value ) => { value.routes[ 0 ].readback.sourceBytesPerRow += 1; }, /256-byte-aligned/ ],
		[ 'delayed disposal error', ( value ) => { value.routes[ 0 ].lifecycle.delayedErrors.push( 'late device error' ); }, /delayed post-disposal/ ],
		[ 'SPA fallback', ( value ) => { value.serving.entries[ 0 ].fallback = true; }, /exact static byte/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = structuredClone( baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN ) );
		mutate( value );
		assert.throws( () => validatePhysicalRouteSession( value ), pattern, name );

	}

} );

test( 'hardware performance session passes long-window and timestamp gates', () => {

	assert.equal( HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value, 1000 / 60 - 2 );
	assert.equal( HARDWARE_PERFORMANCE_CONTRACT.gpuP95Maximum.value, HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value );
	assert.equal( HARDWARE_PERFORMANCE_CONTRACT.governorTarget.value, HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value );
	assert.deepEqual( validateHardwarePerformanceSession( performanceSession() ), {
		valid: true,
		profile: 'performance',
		sustainedWindowCount: 2,
		frameTargetMs: 16.67,
		coldCpuP50Ms: 1.2,
		coldCpuP95Ms: 1.2,
		coldGpuP50Ms: 1.5,
		coldGpuP95Ms: 1.5,
		coldPresentationP95Ms: 16.67,
		presentationP50Ms: 16.67,
		presentationP95Ms: 16.67,
		deadlineMissRatio: 0,
		cpuP50Ms: 1.2,
		cpuP95Ms: 1.2,
		gpuP50Ms: 1.5,
		gpuP95Ms: 1.5,
		governorTransitionCount: 1,
		governorSettledResidenceWindows: 4
	} );

} );

test( 'verified hardware timing maps the final sustained window without relabelling cold samples', async () => {

	const record = performanceSession();
	record.sustainedWindows.at( - 1 ).gpuTimestampBatches.push( timestampBatch( { frameBase: 120, frameCallBase: 240 } ) );
	const imported = await importedWrapper( record );
	const verified = await loadVerifiedImportedPhysicalRecord( imported.path, { expectedProfile: 'performance' } );
	const trace = createRuntimePerformanceTrace( verified );
	assert.equal( trace.adapterClass, 'hardware' );
	assert.equal( trace.sustainedWindowIndex, 1 );
	assert.equal( trace.sustainedWindowCount, 2 );
	assert.equal( trace.sampleFrames, 240 );
	assert.equal( trace.timestampResolveCount, 2 );
	assert.equal( trace.timestampRows[ 119 ].frameId, 119 );
	assert.equal( trace.timestampRows[ 120 ].frameId, 120 );
	assert.equal( trace.warmupCpuSamples.length, 30 );
	assert.equal( trace.coldCpuSamples.length, 120 );
	assert.equal( trace.coldGpuSamples.length, 120 );
	assert.equal( trace.coldPresentationSamples.length, HARDWARE_PERFORMANCE_CONTRACT.coldMinimumSamples.value );
	assert.equal( trace.deadlineIntervalMs, HARDWARE_PERFORMANCE_CONTRACT.deadlineThreshold.value );
	assert.equal( classifyPerformanceTrace( trace, {
		cpuP95: HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value,
		gpuP95: HARDWARE_PERFORMANCE_CONTRACT.gpuP95Maximum.value,
		deadlineMissRatio: HARDWARE_PERFORMANCE_CONTRACT.maximumDeadlineMissRatio.value
	} ), 'PASS' );
	assert.equal( classifyGpuStageAttribution( trace ), 'PASS' );
	verified.record.sustainedWindows.at( - 1 ).gpuTimestampBatches[ 0 ].cpuSamples.values[ 0 ] = 99;
	assert.equal( trace.cpuSamples[ 0 ], 1.2 );
	assert.throws( () => createRuntimePerformanceTrace( { record: performanceSession() } ), /exact wrapper bytes/ );

	const duplicateRecord = performanceSession();
	duplicateRecord.sustainedWindows.at( - 1 ).gpuTimestampBatches.push( timestampBatch() );
	const duplicateImport = await importedWrapper( duplicateRecord );
	const duplicateVerified = await loadVerifiedImportedPhysicalRecord( duplicateImport.path, { expectedProfile: 'performance' } );
	assert.throws( () => createRuntimePerformanceTrace( duplicateVerified ), /duplicates a timestamp or render-call identity/ );

	const sharedFrameRecord = performanceSession();
	for ( const row of sharedFrameRecord.sustainedWindows.at( - 1 ).gpuTimestampBatches[ 0 ].timestampRows ) {

		row.frameId = 7;
		row.sceneUid = row.sceneUid.replace( /f\d+$/, 'f7' );
		row.outputUid = row.outputUid.replace( /f\d+$/, 'f7' );

	}
	const sharedFrameImport = await importedWrapper( sharedFrameRecord );
	const sharedFrameVerified = await loadVerifiedImportedPhysicalRecord( sharedFrameImport.path, { expectedProfile: 'performance' } );
	const sharedFrameTrace = createRuntimePerformanceTrace( sharedFrameVerified );
	assert.equal( sharedFrameTrace.timestampRows.length, 120 );
	assert.equal( new Set( sharedFrameTrace.timestampRows.map( ( row ) => row.frameId ) ).size, 1 );

} );

test( 'verified governor timing joins separately bound tier visual evidence', async () => {

	const imported = await importedWrapper( performanceSession() );
	const verified = await loadVerifiedImportedPhysicalRecord( imported.path, { expectedProfile: 'performance' } );
	const visual = tierVisualEvidence();
	const trace = createRuntimeGovernorTrace( verified, visual );
	assert.equal( trace.adapterClass, 'hardware' );
	assert.equal( trace.initialState, 'governor-stress' );
	assert.equal( trace.visualErrorByTier[ 'target-performance' ].meanRgbByteDifference, 0 );
	assert.equal( trace.visualErrorByTier[ 'governor-stress' ].edgeP95RgbByteDifference, 1 );
	assert.equal( classifyGovernorTrace( trace ), 'PASS' );
	const staleVisual = structuredClone( visual );
	staleVisual.metrics.edgeP95RgbByteDifference.value = 40;
	assert.throws( () => createRuntimeGovernorTrace( verified, staleVisual ), /binding digest is stale/ );

	for ( const [ name, mutate, pattern ] of [
		[ 'wrong candidate tier', ( value ) => { value.binding.candidate.effectiveState.tier = 'target-performance'; }, /route identity/ ],
		[ 'aliased pixels', ( value ) => { value.binding.candidate.pngSha256 = value.binding.reference.pngSha256; }, /aliases/ ],
		[ 'unrestored transaction', ( value ) => { value.binding.candidate.transaction.restorationVerdict = 'FAIL'; }, /not restored/ ],
		[ 'empty edge mask', ( value ) => { value.metrics.edgeMaskPixels.value = 0; }, /does not satisfy/ ]
	] ) {

		const mutation = structuredClone( tierVisualEvidence() );
		mutate( mutation );
		mutation.bindingSha256 = hashPhysicalRecord( { binding: mutation.binding, metrics: mutation.metrics, gates: mutation.gates } );
		assert.throws( () => createRuntimeGovernorTrace( verified, mutation ), pattern, name );

	}

} );

test( 'offline performance projection binds the exact hardware and tier-evidence inputs', async () => {

	const imported = await importedWrapper( performanceSession() );
	const verifiedPerformance = await loadVerifiedImportedPhysicalRecord( imported.path, { expectedProfile: 'performance' } );
	const tierDocument = tierVisualEvidence();
	const tierVisualEvidenceBytes = Buffer.from( `${ JSON.stringify( tierDocument, null, 2 ) }\n` );
	const tierVisualEvidenceLedgerEntry = {
		path: 'tier-visual-evidence.json',
		status: 'captured',
		kind: 'supplementary-json',
		sha256: `sha256:${ createHash( 'sha256' ).update( tierVisualEvidenceBytes ).digest( 'hex' ) }`,
		byteLength: tierVisualEvidenceBytes.byteLength
	};
	const correctnessIdentity = { sourceClosureHash: HASH_A, buildRevision: HASH_B, threeRevision: '0.185.1' };
	const result = projectValidationHarnessPerformanceEvidence( {
		verifiedPerformance,
		tierVisualEvidenceBytes,
		tierVisualEvidenceLedgerEntry,
		correctnessIdentity
	} );
	assert.deepEqual( result.claimVerdicts, { performanceCompliance: 'PASS', gpuAttribution: 'PASS' } );
	assert.equal( result.projectionBinding.performanceSessionDocumentSha256, verifiedPerformance.sourceDocumentSha256 );
	assert.equal( result.projectionBinding.tierVisualEvidenceSha256, tierVisualEvidenceLedgerEntry.sha256 );
	assert.equal( result.artifacts[ 'performance-envelope.json' ].compositorGpuReserve.status, 'NOT_CLAIMED' );
	assert.equal( Object.isFrozen( result ), true );

	assert.throws( () => projectValidationHarnessPerformanceEvidence( {
		verifiedPerformance,
		tierVisualEvidenceBytes,
		tierVisualEvidenceLedgerEntry: { ...tierVisualEvidenceLedgerEntry, sha256: HASH_D },
		correctnessIdentity
	} ), /differ from the correctness ledger/ );
	assert.throws( () => projectValidationHarnessPerformanceEvidence( {
		verifiedPerformance,
		tierVisualEvidenceBytes: Buffer.from( JSON.stringify( tierDocument ) ),
		tierVisualEvidenceLedgerEntry: {
			...tierVisualEvidenceLedgerEntry,
			sha256: `sha256:${ createHash( 'sha256' ).update( Buffer.from( JSON.stringify( tierDocument ) ) ).digest( 'hex' ) }`,
			byteLength: Buffer.byteLength( JSON.stringify( tierDocument ) )
		},
		correctnessIdentity
	} ), /not canonical two-space JSON/ );
	assert.throws( () => projectValidationHarnessPerformanceEvidence( {
		verifiedPerformance,
		tierVisualEvidenceBytes,
		tierVisualEvidenceLedgerEntry,
		correctnessIdentity: { ...correctnessIdentity, buildRevision: HASH_C }
	} ), /buildRevision differ/ );

} );

test( 'hardware performance mutations reject short, discontinuous, or fabricated traces', () => {

	const mutations = [
		[ 'descriptor-only route resources', ( value ) => {

			value.routes[ 0 ].resources = { route: 'tier/target-performance', targets: [ 'output' ] };
			value.routes[ 0 ].resourceDigest = hashPhysicalRecord( value.routes[ 0 ].resources );

		}, /live schema-v1 resource ledger/ ],
		[ 'wrong target tier extent', ( value ) => {

			const target = value.routes[ 0 ].resources.renderTargets.find( ( row ) => row.semantic === 'output' );
			target.width = 960;
			target.bytes = target.width * target.height * target.bytesPerTexel;
			target.logicalBytes = target.bytes;
			target.liveBytes = target.bytes;
			value.routes[ 0 ].resources.trackedRenderTargetBytes = value.routes[ 0 ].resources.renderTargets.reduce( ( sum, row ) => sum + row.liveBytes, 0 );
			value.routes[ 0 ].resourceDigest = hashPhysicalRecord( value.routes[ 0 ].resources );

		}, /does not match locked tier target-performance extent/ ],
		[ 'wrong stress tier extent', ( value ) => {

			value.routes[ 1 ].resources = createCorrectnessResourceLedgerFixture( 1920, 1080, 1 );
			value.routes[ 1 ].resourceDigest = hashPhysicalRecord( value.routes[ 1 ].resources );

		}, /does not match locked tier governor-stress extent/ ],
		[ 'unreconciled resource total', ( value ) => {

			value.routes[ 0 ].resources.trackedRenderTargetBytes ++;
			value.routes[ 0 ].resourceDigest = hashPhysicalRecord( value.routes[ 0 ].resources );

		}, /does not reconcile with live target identities/ ],
		[ 'wrong viewport', ( value ) => { value.viewport.width = 1200; }, /1920x1080/ ],
		[ 'short refresh probe', ( value ) => { value.refresh.measurementDuration.value = 1000; }, /shorter than two seconds/ ],
		[ 'authored host reserve', ( value ) => { value.hostReserve.p95.label = 'Authored'; }, /Measured/ ],
		[ 'invented compositor reserve', ( value ) => { value.compositorReserve = { verdict: 'PASS', measurement: { label: 'Authored' } }; }, /Compositor reserve/ ],
		[ 'anonymous compositor API', ( value ) => { value.compositorReserve = { verdict: 'PASS', measurement: numericDatum( 0.5, 'ms', 'Measured', 'counter' ) }; }, /real timing API identity/ ],
		[ 'short cold trace', ( value ) => { value.cold.duration.value = 1999; }, /cold is shorter than its minimum duration/ ],
		[ 'missing cold timestamp population', ( value ) => { value.cold.gpuTimestampBatches = []; }, /cold has no GPU timestamp batches/ ],
		[ 'forged cold warm-up population', ( value ) => { value.cold.gpuTimestampBatches[ 0 ].warmupCpuSamples.values.pop(); }, /cold.*warm-up CPU sample count/ ],
		[ 'one sustained window', ( value ) => { value.sustainedWindows.pop(); }, /at least two/ ],
		[ 'short sustained window', ( value ) => { value.sustainedWindows[ 0 ].duration.value = 29999; }, /shorter than its minimum duration/ ],
		[ 'too few samples', ( value ) => { value.sustainedWindows[ 0 ].sampleCount.value = 119; }, /fewer than 120/ ],
		[ 'sample-count mismatch', ( value ) => { value.sustainedWindows[ 0 ].sampleCount.value += 1; }, /sampleCount/ ],
		[ 'forged maximum gap', ( value ) => { value.sustainedWindows[ 0 ].maximumPresentationGap.value = 17; }, /does not match/ ],
		[ 'presentation gap', ( value ) => {

			value.sustainedWindows[ 0 ].presentationSamples.values[ 0 ] = 101;
			value.sustainedWindows[ 0 ].maximumPresentationGap.value = 101;
			value.sustainedWindows[ 0 ].duration.value = value.sustainedWindows[ 0 ].presentationSamples.values.reduce( ( sum, sample ) => sum + sample, 0 );
			value.sustainedWindows[ 0 ].presentationCoverage.value = value.sustainedWindows[ 0 ].sampleCount.value / ( value.sustainedWindows[ 0 ].duration.value / 16.67 );

		}, /presentation-gap/ ],
		[ 'coverage gap', ( value ) => { value.sustainedWindows[ 0 ].presentationCoverage.value = 0.9; }, /presentation-coverage/ ],
		[ 'CPU sample-count mismatch', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].cpuSamples.values.pop(); }, /CPU sample count/ ],
		[ 'CPU p95 overrun', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].cpuSamples.values.fill( 15.5, 0, 8 ); }, /CPU p95/ ],
		[ 'p95 cadence overrun', ( value ) => {

			value.sustainedWindows[ 0 ].presentationSamples.values.fill( 21, 0, 100 );
			value.sustainedWindows[ 0 ].maximumPresentationGap.value = 21;
			value.sustainedWindows[ 0 ].duration.value = value.sustainedWindows[ 0 ].presentationSamples.values.reduce( ( sum, sample ) => sum + sample, 0 );
			value.sustainedWindows[ 0 ].presentationCoverage.value = value.sustainedWindows[ 0 ].sampleCount.value / ( value.sustainedWindows[ 0 ].duration.value / 16.67 );

		}, /presentation p95/ ],
		[ 'deadline miss ratio', ( value ) => {

			value.sustainedWindows[ 0 ].presentationSamples.values.fill( 26, 0, 20 );
			value.sustainedWindows[ 0 ].maximumPresentationGap.value = 26;
			value.sustainedWindows[ 0 ].duration.value = value.sustainedWindows[ 0 ].presentationSamples.values.reduce( ( sum, sample ) => sum + sample, 0 );
			value.sustainedWindows[ 0 ].presentationCoverage.value = value.sustainedWindows[ 0 ].sampleCount.value / ( value.sustainedWindows[ 0 ].duration.value / 16.67 );

		}, /deadline-miss ratio/ ],
		[ 'per-frame resolves', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].resolveCount.value = 120; }, /per frame/ ],
		[ 'missing timestamp row', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].timestampRows.pop(); }, /explicit timestamp row/ ],
		[ 'GPU sample-row mismatch', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].gpuSamples.values[ 0 ] = 2; }, /bound GPU sample/ ],
		[ 'GPU p95 overrun', ( value ) => {

			const batch = value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ];
			for ( let index = 0; index < 8; index ++ ) {

				batch.timestampRows[ index ].sceneMs = 15;
				batch.timestampRows[ index ].outputMs = 0.5;
				batch.timestampRows[ index ].totalMs = 15.5;
				batch.gpuSamples.values[ index ] = 15.5;

			}

		}, /GPU p95/ ],
		[ 'fabricated per-frame total', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].timestampRows[ 0 ].independentPerFrameTotalAvailable = true; }, /fabricates/ ],
		[ 'unreconciled batch resolve', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].lastFrameResolveResidualMs = 0.002; }, /final-frame timestamp resolve/ ],
		[ 'wrong batch reconciliation kind', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].reconciliationKind = 'last-submission'; }, /final-renderer-frame aggregate/ ],
		[ 'missing governor transition', ( value ) => { value.governor.trace.transitions = []; }, /did not exercise/ ],
		[ 'wrong governor initial state', ( value ) => { value.governor.trace.initialState = 'target-performance'; }, /locked governor-stress route/ ],
		[ 'forged governor p95', ( value ) => { value.governor.trace.windows[ 0 ].gpuP95 = 15; }, /does not reconcile/ ],
		[ 'forged governor timestamp row', ( value ) => { value.governor.trace.windows[ 0 ].timestampRows[ 0 ].sceneMs += 1; }, /not derived/ ],
		[ 'forged governor decision', ( value ) => { value.governor.trace.windows[ 1 ].decision = 'hold'; }, /decision does not follow/ ],
		[ 'forged governor cooldown', ( value ) => { value.governor.trace.windows[ 2 ].cooldown = 0; }, /committed state counters/ ],
		[ 'forged governor resource binding', ( value ) => { value.governor.trace.transitions[ 0 ].toResourceBytes = value.governor.trace.transitions[ 0 ].fromResourceBytes + 1; }, /do not match the locked tier resource inventories/ ],
		[ 'forged governor oscillation', ( value ) => { value.governor.trace.oscillationDetected = true; }, /oscillation verdict/ ],
		[ 'forged governor settled residence', ( value ) => { value.governor.settledResidenceWindows.value = 5; }, /does not reconcile/ ],
		[ 'unsettled governor', ( value ) => { value.governor.settled = false; }, /summary does not match/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = structuredClone( performanceSession() );
		mutate( value );
		assert.throws( () => validateHardwarePerformanceSession( value ), pattern, name );

	}

} );

test( 'verified physical wrapper loader preserves exact bytes and recomputes both lane types', async () => {

	const physical = await importedWrapper( baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN ) );
	const performance = await importedWrapper( performanceSession() );
	for ( const fixture of [ physical, performance ] ) {

		const verified = await loadVerifiedImportedPhysicalRecord( fixture.path, { expectedProfile: fixture.wrapper.record.profile } );
		assert.deepEqual( verified.sourceBytes, fixture.bytes );
		assert.equal( verified.recordSha256, fixture.wrapper.recordSha256 );
		assert.deepEqual( verified.laneReference, fixture.wrapper.laneReference );
		assert.equal( verified.servedLedgerSha256, fixture.wrapper.record.serving.ledgerSha256 );
		assert.equal( verified.sourceDocumentByteLength, fixture.bytes.byteLength );
		const cliValidation = await validatePhysicalEvidenceRecordFile( fixture.path );
		assert.equal( cliValidation.recordSha256, verified.recordSha256 );
		assert.equal( cliValidation.sourceDocumentSha256, verified.sourceDocumentSha256 );

	}

} );

test( 'verified physical wrapper loader rejects raw, stale, promoted, and cross-profile inputs', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'threejs-verified-physical-mutations-' ) );
	const baseline = await importedWrapper( baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN ), { directory, filename: 'baseline.json' } );
	const mutations = [
		[ 'raw record', structuredClone( baseline.wrapper.record ), /omits record/ ],
		[ 'stale validation', { ...structuredClone( baseline.wrapper ), validation: { valid: false } }, /validation summary/ ],
		[ 'stale record hash', { ...structuredClone( baseline.wrapper ), recordSha256: HASH_D }, /recordSha256/ ],
		[ 'stale lane reference', { ...structuredClone( baseline.wrapper ), laneReference: { ...baseline.wrapper.laneReference, sessionId: 'swapped' } }, /laneReference/ ]
	];
	for ( const [ name, value, pattern ] of mutations ) {

		const path = join( directory, `${ name.replaceAll( ' ', '-' ) }.json` );
		await writeFile( path, `${ JSON.stringify( value, null, 2 ) }\n`, { flag: 'wx' } );
		await assert.rejects( loadVerifiedImportedPhysicalRecord( path ), pattern, name );

	}
	await assert.rejects( loadVerifiedImportedPhysicalRecord( baseline.path, { expectedProfile: 'performance' } ), /Expected profile performance/ );
	for ( const [ filename, mutate ] of [
		[ 'promoted.json', ( value ) => { value.record.publishable = true; } ],
		[ 'accepted.json', ( value ) => { value.record.acceptanceStatus = 'accepted'; } ]
	] ) {

		const value = structuredClone( baseline.wrapper );
		mutate( value );
		const path = join( directory, filename );
		await writeFile( path, `${ JSON.stringify( value, null, 2 ) }\n`, { flag: 'wx' } );
		await assert.rejects( loadVerifiedImportedPhysicalRecord( path ), /nonpublishable and incomplete/ );

	}
	const staleLedger = await importedWrapper( baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN ), { directory, filename: 'stale-ledger.json', servedLedgerSha256: HASH_D } );
	await assert.rejects( loadVerifiedImportedPhysicalRecord( staleLedger.path ), /served-byte ledger hash/ );

} );

test( 'verified wrapper distinguishes semantic record identity from exact document bytes', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'threejs-verified-physical-format-' ) );
	const record = baseSession( 'physical-route', PHYSICAL_ROUTE_PLAN );
	const pretty = await importedWrapper( record, { directory, filename: 'pretty.json' } );
	const compact = await importedWrapper( record, { directory, filename: 'compact.json', compact: true } );
	const prettyVerified = await loadVerifiedImportedPhysicalRecord( pretty.path );
	const compactVerified = await loadVerifiedImportedPhysicalRecord( compact.path );
	assert.equal( prettyVerified.recordSha256, compactVerified.recordSha256 );
	assert.notEqual( prettyVerified.sourceDocumentSha256, compactVerified.sourceDocumentSha256 );

} );
