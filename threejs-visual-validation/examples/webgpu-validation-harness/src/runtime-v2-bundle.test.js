import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTraceSegment, bytesPerTexel, classifyGovernorTrace, classifyGpuStageAttribution, classifyMechanismProof, classifyPerformanceCompliance, classifyPerformanceTrace, resolveBundlePromotion, summarizeLifecycleEvidence, VISUAL_SIGNOFF_IMAGES } from './runtime-v2-bundle.js';

function timestampTrace( adapterClass = 'hardware', overrides = {} ) {

	const cpuSamples = [ 2, 2, 2 ];
	const scene = [ 8, 9, 10 ];
	const output = [ 2, 2, 3 ];
	const gpuSamples = scene.map( ( value, index ) => value + output[ index ] );
	const presentationSamples = [ 16, 16, 16 ];
	return {
		adapterClass,
		sampleFrames: 3,
		cpuSamples,
		gpuSamples,
		presentationSamples,
		deadlineIntervalMs: 16.666666666666668,
		cpuP50: 2,
		cpuP95: 2,
		gpuP50: 11,
		gpuP95: 12.8,
		presentationP50: 16,
		presentationP95: 16,
		deadlineMissRatio: 0,
		gpuStageSamples: { 'scene-mrt': scene, 'final-output': output },
		gpuStageP50: { 'scene-mrt': 9, 'final-output': 2 },
		gpuStageP95: { 'scene-mrt': 9.9, 'final-output': 2.9 },
		timestampRows: scene.map( ( sceneMs, index ) => ( {
			frameId: index,
			sceneUid: `r:${ index * 2 + 1 }:17:f${ index }`,
			outputUid: `r:${ index * 2 + 2 }:41:f${ index }`,
			sceneMs,
			outputMs: output[ index ],
			totalMs: gpuSamples[ index ],
			residualMs: null,
			totalProvenance: 'Derived',
			independentPerFrameTotalAvailable: false
		} ) ),
		independentPerFrameTotalsAvailable: false,
		lastFrameResolveResidualMs: 0.0001,
		...overrides
	};

}

function governorWindow( window, measuredTier, tier, total = 12 ) {

	const timestampRows = [ 0, 1, 2 ].map( ( frame ) => ( {
		frameId: frame,
		sceneUid: `r:${ frame * 2 + 1 }:17:f${ frame }`,
		outputUid: `r:${ frame * 2 + 2 }:41:f${ frame }`,
		sceneMs: total - 2,
		outputMs: 2,
		totalMs: total,
		residualMs: null,
		totalProvenance: 'Derived',
		independentPerFrameTotalAvailable: false
	} ) );
	return { window, gpuSamples: [ total, total, total ], timestampRows, lastFrameResolveResidualMs: 0, gpuP95: total, measuredTier, tier };

}

function lifecycleFixture( mutate = () => {} ) {

	const snapshots = Array.from( { length: 50 }, ( _, cycle ) => ( {
		rowType: 'settled-lifecycle-cycle-v2',
		cycle,
		beforeDispose: {
			controllerGeneration: cycle + 1,
			backend: { isWebGPUBackend: true, rendererDeviceGeneration: cycle + 101 },
			listenerState: { runtimeEventListeners: 1 },
			rendererInfo: { memory: { total: 1024 + cycle, textures: 2, renderTargets: 1 } }
		},
		afterDispose: {
			controllerGeneration: cycle + 1,
			backend: { isWebGPUBackend: true, rendererDeviceGeneration: cycle + 101 },
			listenerState: { runtimeEventListeners: 0 },
			rendererInfo: { memory: { total: 0, textures: 0, renderTargets: 0 } }
		},
		resourcesBeforeDispose: {
			renderTargets: [ { bytes: 4096 + cycle } ],
			storageResources: []
		},
		dispose: {
			status: 'PASS',
			completed: true,
			error: null,
			evidence: {
				controllerGeneration: cycle + 1,
				rendererDeviceGeneration: cycle + 101,
				queueSettlement: { status: 'PASS' },
				deviceDestroy: { status: 'PASS', intentionalDestroyObserved: true },
				listenersAfterDispose: 0
			}
		},
		settle: { status: 'PASS', policyAnimationFrames: 2, observedAnimationFrames: 2, queueSettled: true, delayedErrors: [] },
		resourcesAfterDispose: { renderTargets: [], storageResources: [] }
	} ) );
	const fixture = { cycles: snapshots.length, snapshots };
	mutate( fixture );
	return fixture;

}

test( 'lifecycle reducer accepts complete native-WebGPU zero-retention evidence', () => {

	const summary = summarizeLifecycleEvidence( lifecycleFixture() );
	assert.equal( summary.cycles, 50 );
	assert.equal( summary.afterRendererBytesMax, 0 );
	assert.equal( summary.targetBytesMin, 4096 );
	assert.equal( summary.targetBytesMax, 4145 );
	assert.equal( summary.storageBytesMax, 0 );

} );

test( 'lifecycle reducer rejects missing, non-WebGPU, and retained-resource cycles', () => {

	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => fixture.snapshots.pop() ) ), /snapshot count/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 7 ].beforeDispose.backend.isWebGPUBackend = false; } ) ), /did not initialize native WebGPU/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 12 ].afterDispose.rendererInfo.memory.textures = 1; } ) ), /retained renderer memory/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].beforeDispose.deviceLostObserved = true; } ) ), /device loss/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.uncapturedErrors = [ 'late validation error' ]; } ) ), /device error/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose = { status: 'FAIL', completed: false, error: 'dispose failed' }; } ) ), /dispose failed/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.delayedErrors = [ 'post-dispose failure' ]; } ) ), /delayed post-dispose/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.observedAnimationFrames = 1; } ) ), /observed post-disposal settle/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.queueSettled = false; } ) ), /observed post-disposal settle/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose.evidence.queueSettlement.status = 'FAIL'; } ) ), /actual GPU queue/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose.evidence.rendererDeviceGeneration ++; } ) ), /generation identity/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.listenerState.runtimeEventListeners = 1; } ) ), /listener census/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].resourcesAfterDispose.renderTargets.push( { bytes: 4 } ); } ) ), /resources after disposal/ );

} );

test( 'runtime bundle format widths include the canonical depth allocation', () => {

	assert.equal( bytesPerTexel( 'rgba16float' ), 8 );
	assert.equal( bytesPerTexel( 'rgba8unorm' ), 4 );
	assert.equal( bytesPerTexel( 'depth32float' ), 4 );
	assert.throws( () => bytesPerTexel( 'depth24plus' ), /does not know the byte width/ );

} );

test( 'trace segments distinguish measured cadence from an authored target', () => {

	const authored = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16 );
	assert.equal( authored.presentationSamples.label, 'Authored' );
	assert.equal( authored.presentationP95.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.value, 1 );

	const measured = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16, [ 15, 16, 17, 18 ] );
	assert.equal( measured.presentationSamples.label, 'Measured' );
	assert.deepEqual( measured.presentationSamples.values, [ 15, 16, 17, 18 ] );
	assert.equal( measured.presentationP95.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.value, 0.5 );

} );

test( 'performance classification exposes measured overruns without promoting incomplete passes', () => {

	const gates = { cpuP95: 14, gpuP95: 14, deadlineMissRatio: 0.01 };
	assert.equal( classifyPerformanceTrace( null, gates ), 'NOT_CLAIMED' );
	assert.equal( classifyPerformanceTrace( timestampTrace( 'unknown' ), gates ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyPerformanceTrace( timestampTrace( 'software' ), gates ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyPerformanceTrace( timestampTrace(), gates ), 'PASS' );
	assert.equal( classifyPerformanceTrace( timestampTrace( 'hardware', { gpuSamples: [ 10, 11, 15 ], gpuP50: 11, gpuP95: 14.6 } ), gates ), 'FAIL' );
	assert.equal( classifyPerformanceTrace( timestampTrace( 'hardware', {
		presentationSamples: [ 16, 16, 18 ],
		presentationP50: 16,
		presentationP95: 17.8,
		deadlineMissRatio: 1 / 3
	} ), gates ), 'FAIL' );
	assert.throws( () => classifyPerformanceTrace( timestampTrace( 'hardware', { gpuP95: 1 } ), gates ), /raw sample population/ );

} );

test( 'GPU stage attribution requires complete reconciled scene and output samples', () => {

	const trace = timestampTrace();
	assert.equal( classifyGpuStageAttribution( null ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyGpuStageAttribution( trace ), 'PASS' );
	assert.equal( classifyGpuStageAttribution( { ...trace, adapterClass: 'software' } ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyGpuStageAttribution( { ...trace, adapterClass: 'unknown' } ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyGpuStageAttribution( { ...trace, lastFrameResolveResidualMs: 0.01 } ), 'FAIL' );
	assert.throws( () => classifyGpuStageAttribution( { ...trace, gpuStageSamples: { ...trace.gpuStageSamples, 'scene-mrt': [ 8 ] } } ), /sample count/ );
	assert.throws( () => classifyGpuStageAttribution( { ...trace, gpuP95: 1 } ), /raw sample population/ );

} );

test( 'quality governor classification requires a settled non-oscillating trace', () => {

	const trace = {
		adapterClass: 'hardware',
		windowCount: 6,
		cooldownWindows: 2,
		targetMs: 14,
		settledState: 'governor-stress',
		visualErrorByTier: {
			'target-performance': { meanRgbByteDifference: 0, edgeMaskPixels: 0, edgeMeanRgbByteDifference: 0, edgeP95RgbByteDifference: 0 },
			'governor-stress': { meanRgbByteDifference: 3, edgeMaskPixels: 100, edgeMeanRgbByteDifference: 5, edgeP95RgbByteDifference: 12 }
		},
		visualErrorGates: { meanRgbByteDifference: 8, edgeP95RgbByteDifference: 32 },
		windows: Array.from( { length: 6 }, ( _, window ) => governorWindow( window, window < 2 ? 'target-performance' : 'governor-stress', window < 1 ? 'target-performance' : 'governor-stress' ) ),
		transitions: [ {
			window: 1,
			from: 'target-performance',
			to: 'governor-stress',
			gpuP95: 12,
			rebuildCpuSubmissionMs: 0.2,
			rebuildGpuMs: 10,
			rebuildTimestampRow: { sceneMs: 8, outputMs: 2 },
			lastFrameResolveResidualMs: 0,
			fromResourceBytes: 100,
			toResourceBytes: 60
		} ],
		oscillationDetected: false
	};
	assert.equal( classifyGovernorTrace( null ), 'NOT_CLAIMED' );
	assert.equal( classifyGovernorTrace( trace ), 'PASS' );
	assert.equal( classifyGovernorTrace( {
		...trace,
		windows: trace.windows.map( ( window, index ) => index === 5 ? { ...window, measuredTier: 'target-performance', tier: 'governor-stress' } : window ),
		transitions: [ { ...trace.transitions[ 0 ], window: 5 } ]
	} ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyGovernorTrace( { ...trace, oscillationDetected: true } ), 'FAIL' );
	assert.equal( classifyGovernorTrace( { ...trace, windows: trace.windows.map( ( window, index ) => index === 5 ? governorWindow( 5, 'governor-stress', 'governor-stress', 15 ) : window ) } ), 'FAIL' );
	assert.equal( classifyGovernorTrace( { ...trace, visualErrorByTier: { ...trace.visualErrorByTier, 'governor-stress': { ...trace.visualErrorByTier[ 'governor-stress' ], meanRgbByteDifference: 9 } } } ), 'FAIL' );
	assert.equal( classifyGovernorTrace( { ...trace, visualErrorByTier: { ...trace.visualErrorByTier, 'governor-stress': { ...trace.visualErrorByTier[ 'governor-stress' ], edgeP95RgbByteDifference: 33 } } } ), 'FAIL' );
	assert.throws( () => classifyGovernorTrace( { ...trace, windows: trace.windows.map( ( window, index ) => index === 1 ? { ...window, measuredTier: 'governor-stress' } : window ) } ), /tier lineage/ );

} );

test( 'performance compliance cannot pass without an accepted governor trace', () => {

	assert.equal( classifyPerformanceCompliance( 'PASS', 'PASS' ), 'PASS' );
	assert.equal( classifyPerformanceCompliance( 'PASS', 'FAIL' ), 'FAIL' );
	assert.equal( classifyPerformanceCompliance( 'FAIL', 'PASS' ), 'FAIL' );
	assert.equal( classifyPerformanceCompliance( 'PASS', 'NOT_CLAIMED' ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyPerformanceCompliance( 'NOT_CLAIMED', 'NOT_CLAIMED' ), 'NOT_CLAIMED' );
	assert.throws( () => classifyPerformanceCompliance( 'PASS', 'invented' ), /valid performance and governor verdicts/ );

} );

test( 'mechanism classifier binds live route identity, submissions, diagnostics, and negative controls', () => {

	const modes = [ 'final', 'no-post', 'normal', 'emissive' ];
	const proof = {
		proofKind: 'native-browser-runtime',
		routeExecutions: modes.map( ( mode, index ) => ( {
			mode,
			outputNodeId: `${ mode }-output-node`,
			selectedOutputNodeId: `${ mode }-output-node`,
			selectedOutputNodeIdentityVerified: true,
			graphMarkedDirtyBeforeRender: true,
			renderSubmissionCountBefore: index,
			renderSubmissionCountAfter: index + 1,
			renderSubmissionDelta: 1
		} ) ),
		negativeControls: {
			unknownModeRejected: true,
			unknownModeError: 'Unknown mode "negative".',
			modeStatePreserved: true,
			outputNodeIdentityPreserved: true
		},
		reachableSignals: [ 'output', 'normal', 'emissive', 'depth' ],
		reachableResources: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ]
	};
	const pipeline = { captureRoutes: Object.fromEntries( modes.map( ( mode ) => [ mode, { mode, outputNodeId: `${ mode }-output-node` } ] ) ) };
	const differences = { normal: 12, emissive: 18 };
	assert.equal( classifyMechanismProof( proof, differences, pipeline ), 'PASS' );
	assert.throws( () => classifyMechanismProof( { ...proof, routeExecutions: proof.routeExecutions.slice( 1 ) }, differences, pipeline ), /every output route/ );
	assert.throws( () => classifyMechanismProof( { ...proof, routeExecutions: proof.routeExecutions.map( ( route, index ) => index === 2 ? { ...route, renderSubmissionDelta: 0 } : route ) }, differences, pipeline ), /exactly one observed runtime render/ );
	assert.throws( () => classifyMechanismProof( { ...proof, negativeControls: { ...proof.negativeControls, modeStatePreserved: false } }, differences, pipeline ), /modeStatePreserved/ );
	assert.throws( () => classifyMechanismProof( proof, { ...differences, normal: 0 }, pipeline ), /normal diagnostic/ );

} );

test( 'bundle promotion requires all PASS claims and a digest-bound authored visual signoff', () => {

	const input = {
		labId: 'webgpu-validation-harness',
		sourceClosureHash: 'source-hash',
		buildRevision: 'build-revision',
		pipelineGraphDigest: 'pipeline-digest',
		captureProfile: 'performance',
		adapterClass: 'hardware',
		claimVerdicts: {
			visualCorrectness: 'PASS',
			mechanismCorrectness: 'PASS',
			performanceCompliance: 'PASS',
			gpuAttribution: 'PASS',
			lifecycleStability: 'PASS'
		},
		imageHashes: Object.fromEntries( VISUAL_SIGNOFF_IMAGES.map( ( image, index ) => [ image, `sha256:${ index.toString( 16 ).padStart( 64, '0' ) }` ] ) ),
		deviceState: { deviceLostObserved: false, uncapturedErrors: [], deviceErrors: [] },
		visualSignoff: null
	};
	const pending = resolveBundlePromotion( input );
	assert.equal( pending.bundleKind, 'browser-capture-incomplete' );
	assert.equal( pending.publishable, false );
	assert.equal( pending.claimVerdicts.visualCorrectness, 'INSUFFICIENT_EVIDENCE' );
	assert.equal( pending.promotion.status, 'CAPTURE_SESSION_PENDING' );
	const offlineFinalization = {
		phase: 'offline-finalized-capture-session',
		captureSessionSha256: `sha256:${ 'a'.repeat( 64 ) }`,
		artifactLedgerSha256: `sha256:${ 'b'.repeat( 64 ) }`
	};
	const offlinePending = resolveBundlePromotion( { ...input, offlineFinalization } );
	assert.equal( offlinePending.promotion.status, 'PENDING_VISUAL_SIGNOFF' );

	const signoff = {
		provenance: 'Authored',
		decision: 'APPROVED',
		reviewer: 'graphics-reviewer',
		reviewedAt: '2026-07-12T12:00:00.000Z',
		reviewMethod: 'direct inspection of every bound render-target image',
		bindingDigest: offlinePending.promotion.bindingDigest,
		reviewedImages: [ ...VISUAL_SIGNOFF_IMAGES ]
	};
	assert.throws( () => resolveBundlePromotion( { ...input, visualSignoff: signoff } ), /offline finalized capture session/ );
	const promoted = resolveBundlePromotion( {
		...input,
		offlineFinalization,
		visualSignoff: signoff
	} );
	assert.equal( promoted.bundleKind, 'browser-capture' );
	assert.equal( promoted.publishable, true );
	assert.deepEqual( promoted.claimVerdicts, input.claimVerdicts );
	assert.equal( promoted.promotion.status, 'APPROVED' );
	assert.throws( () => resolveBundlePromotion( { ...input, offlineFinalization, visualSignoff: { ...signoff, bindingDigest: 'sha256:deadbeef' } } ), /digest does not bind/ );
	assert.throws( () => resolveBundlePromotion( { ...input, offlineFinalization, claimVerdicts: { ...input.claimVerdicts, gpuAttribution: 'INSUFFICIENT_EVIDENCE' }, visualSignoff: signoff } ), /every claim classifier/ );
	assert.throws( () => resolveBundlePromotion( { ...input, offlineFinalization, deviceState: { deviceLostObserved: false, uncapturedErrors: [ 'validation error' ], deviceErrors: [ 'validation error' ] }, visualSignoff: signoff } ), /device errors or loss/ );

} );
