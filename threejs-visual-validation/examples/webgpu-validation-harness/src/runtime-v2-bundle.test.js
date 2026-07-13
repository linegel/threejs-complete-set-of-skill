import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCheckedEvidenceSchemas, validateCheckedJsonSchema } from './checked-json-schema.js';
import { buildTraceSegment, bytesPerTexel, classifyGovernorTrace, classifyGpuStageAttribution, classifyMechanismProof, classifyPerformanceCompliance, classifyPerformanceTrace, createPerformanceEvidenceArtifacts, createRuntimePipelineGraph, resolveBundlePromotion, summarizeLifecycleEvidence, VISUAL_SIGNOFF_IMAGES } from './runtime-v2-bundle.js';

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

function performanceGovernorTrace() {

	const windows = Array.from( { length: 6 }, ( _, window ) => ( {
		...governorWindow( window, window === 0 ? 'governor-stress' : 'target-performance', 'target-performance' ),
		decision: window === 0 ? 'upgrade' : 'hold',
		residence: window,
		cooldown: Math.max( 0, 2 - window )
	} ) );
	return {
		adapterClass: 'hardware',
		states: [ 'target-performance', 'governor-stress' ],
		framesPerWindow: 3,
		windowCount: windows.length,
		targetMs: 14,
		hysteresisMs: 2,
		minimumResidenceWindows: 2,
		cooldownWindows: 2,
		initialState: 'governor-stress',
		settledState: 'target-performance',
		visualErrorByTier: {
			'target-performance': { meanRgbByteDifference: 0, edgeMaskPixels: 100, edgeMeanRgbByteDifference: 0, edgeP95RgbByteDifference: 0 },
			'governor-stress': { meanRgbByteDifference: 3, edgeMaskPixels: 100, edgeMeanRgbByteDifference: 5, edgeP95RgbByteDifference: 12 }
		},
		visualErrorGates: { meanRgbByteDifference: 8, edgeP95RgbByteDifference: 32 },
		windows,
		transitions: [ {
			window: 0,
			from: 'governor-stress',
			to: 'target-performance',
			cause: 'upgrade-after-hysteresis',
			gpuP95: 12,
			rebuildCpuSubmissionMs: 0.2,
			rebuildGpuMs: 10,
			rebuildTimestampRow: { frameId: 0, sceneUid: 'r:1:17:f0', outputUid: 'r:2:41:f0', sceneMs: 8, outputMs: 2, totalMs: 10, residualMs: null, totalProvenance: 'Derived', independentPerFrameTotalAvailable: false },
			lastFrameResolveResidualMs: 0,
			fromResourceBytes: 60,
			toResourceBytes: 100
		} ],
		oscillationDetected: false
	};

}

function lifecycleFixture( mutate = () => {} ) {

	const snapshots = Array.from( { length: 50 }, ( _, cycle ) => ( {
		rowType: 'settled-lifecycle-cycle-v2',
		cycle,
		beforeDispose: {
			controllerGeneration: cycle + 1,
			nativeWebGPU: true,
			backend: 'WebGPU',
			rendererDeviceGeneration: cycle + 101,
			rendererBackendEvidence: { isWebGPUBackend: true, rendererDeviceGeneration: cycle + 101 },
			listenerState: { runtimeEventListeners: 1 },
			lifecycleState: { activeControls: 0, activeMaterials: 3, rendererStateDisposition: 'ACTIVE_OWNED_RENDERER' },
			rendererState: { outputColorSpace: 'srgb', toneMapping: 'NeutralToneMapping', exposure: 1 },
			rendererInfo: { memory: { total: 1024 + cycle, textures: 2, renderTargets: 1 } }
		},
		afterDispose: {
			controllerGeneration: cycle + 1,
			nativeWebGPU: true,
			backend: 'WebGPU',
			rendererDeviceGeneration: cycle + 101,
			rendererBackendEvidence: { isWebGPUBackend: true, rendererDeviceGeneration: cycle + 101 },
			listenerState: { runtimeEventListeners: 0 },
			lifecycleState: { activeControls: 0, activeMaterials: 0, rendererStateDisposition: 'OWNED_RENDERER_DISPOSED' },
			rendererState: { outputColorSpace: 'srgb', toneMapping: 'NeutralToneMapping', exposure: 1 },
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
				listenersAfterDispose: 0,
				controlsAfterDispose: 0,
				materialsAfterDispose: 0,
				rendererStateDisposition: 'OWNED_RENDERER_DISPOSED'
			}
		},
		settle: { status: 'PASS', policyAnimationFrames: 2, observedAnimationFrames: 2, queueSettled: true, delayedErrors: [] },
		resourcesAfterDispose: {
			renderTargets: [ { bytes: 4096 + cycle, liveBytes: 0 } ],
			storageResources: [],
			trackedRenderTargetBytes: 0,
			trackedLiveBytes: 0
		}
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
	assert.equal( summary.cycleSnapshots[ 0 ].retainedListenerCount, 0 );
	assert.equal( summary.cycleSnapshots[ 0 ].retainedControlCount, 0 );
	assert.equal( summary.cycleSnapshots[ 0 ].retainedMaterialCount, 0 );
	assert.equal( summary.cycleSnapshots[ 0 ].rendererStateDisposition, 'OWNED_RENDERER_DISPOSED' );
	assert.match( summary.cycleSnapshots[ 0 ].rendererStateBeforeDigest, /^sha256:[0-9a-f]{64}$/ );
	assert.equal( summary.cycleSnapshots[ 0 ].rendererStateAfterDigest, summary.cycleSnapshots[ 0 ].rendererStateBeforeDigest );

} );

test( 'lifecycle reducer rejects missing, non-WebGPU, and retained-resource cycles', () => {

	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => fixture.snapshots.pop() ) ), /snapshot count/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => {
		fixture.snapshots[ 7 ].beforeDispose.nativeWebGPU = false;
		fixture.snapshots[ 7 ].beforeDispose.backend = 'WebGL';
		fixture.snapshots[ 7 ].beforeDispose.rendererBackendEvidence.isWebGPUBackend = false;
	} ) ), /did not initialize native WebGPU/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 12 ].afterDispose.rendererInfo.memory.textures = 1; } ) ), /retained renderer memory/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].beforeDispose.deviceLostObserved = true; } ) ), /device loss/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.uncapturedErrors = [ 'late validation error' ]; } ) ), /device error/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose = { status: 'FAIL', completed: false, error: 'dispose failed' }; } ) ), /dispose failed/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.delayedErrors = [ 'post-dispose failure' ]; } ) ), /delayed post-dispose/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.observedAnimationFrames = 1; } ) ), /observed post-disposal settle/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].settle.queueSettled = false; } ) ), /observed post-disposal settle/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose.evidence.queueSettlement.status = 'FAIL'; } ) ), /actual GPU queue/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose.evidence.rendererDeviceGeneration ++; } ) ), /generation identity/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].beforeDispose.rendererBackendEvidence.rendererDeviceGeneration ++; } ) ), /generation evidence disagrees/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => {
		fixture.snapshots[ 5 ].afterDispose.rendererDeviceGeneration ++;
		fixture.snapshots[ 5 ].afterDispose.rendererBackendEvidence.rendererDeviceGeneration ++;
	} ) ), /generation identity/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.rendererBackendEvidence.rendererDeviceGeneration ++; } ) ), /generation evidence disagrees/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.listenerState.runtimeEventListeners = 1; } ) ), /listener census/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.lifecycleState.activeMaterials = 1; } ) ), /retained controls or materials/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].dispose.evidence.controlsAfterDispose = 1; } ) ), /registry evidence disagrees/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.lifecycleState.rendererStateDisposition = 'RESTORED'; } ) ), /truthful owned-renderer disposal/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].afterDispose.rendererState = null; } ) ), /renderer state snapshot/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].resourcesAfterDispose.renderTargets.push( { bytes: 4 } ); } ) ), /resources after disposal/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].resourcesAfterDispose.renderTargets[ 0 ].liveBytes = 4; } ) ), /resources after disposal/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 5 ].resourcesAfterDispose.trackedLiveBytes = 4; } ) ), /resources after disposal/ );

} );

test( 'runtime bundle format widths include the canonical depth allocation', () => {

	assert.equal( bytesPerTexel( 'rgba16float' ), 8 );
	assert.equal( bytesPerTexel( 'rgba8unorm' ), 4 );
	assert.equal( bytesPerTexel( 'rgba8unorm-srgb' ), 4 );
	assert.equal( bytesPerTexel( 'depth32float' ), 4 );
	assert.throws( () => bytesPerTexel( 'depth24plus' ), /does not know the byte width/ );

} );

test( 'runtime graph conversion emits only the checked ownership and resource schema', async () => {

	const pipeline = {
		owners: { renderer: 'validation-subject', renderPipeline: 'validation-subject' },
		signals: [ { id: 'output', producer: 'scene-pass', consumers: [ 'final' ] } ],
		sceneSubmissions: [ { id: 'scene-pass', kind: 'full-lit', count: 1 } ],
		computeDispatches: [],
		finalToneMapOwner: 'renderOutput',
		finalOutputTransformOwner: 'renderOutput'
	};
	const resources = {
		renderTargets: [ { name: 'output', owner: 'scene-pass', width: 1200, height: 800, bytesPerTexel: 8, bytes: 7_680_000 } ]
	};
	const graph = createRuntimePipelineGraph( pipeline, resources );
	const schemas = await loadCheckedEvidenceSchemas();
	assert.deepEqual( validateCheckedJsonSchema( schemas.runtimeGraph, graph ), { valid: true, errors: [] } );
	assert.equal( graph.signals[ 0 ].reachable, true );
	assert.equal( graph.sceneSubmissions[ 0 ].kind, 'lit-scene' );
	assert.equal( graph.resources[ 0 ].residentBytes.unit, 'bytes' );
	assert.equal( Object.hasOwn( graph, 'captureRoutes' ), false );
	assert.throws( () => createRuntimePipelineGraph( { ...pipeline, computeDispatches: [ { id: 'fake' } ] }, resources ), /undeclared compute/ );

} );

test( 'trace segments distinguish measured cadence from an authored target', () => {

	const authored = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16 );
	assert.equal( authored.presentationSamples.label, 'Authored' );
	assert.equal( authored.presentationP95.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.value, 0 );

	const measured = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16, [ 15, 16, 17, 26 ], 25.005 );
	assert.equal( measured.presentationSamples.label, 'Measured' );
	assert.deepEqual( measured.presentationSamples.values, [ 15, 16, 17, 26 ] );
	assert.equal( measured.presentationP95.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.value, 0.25 );
	assert.throws( () => buildTraceSegment( [ 1 ], 'unit trace', 16, [ 16 ], 0 ), /positive deadline interval/ );

} );

test( 'pure performance artifacts preserve measured inputs and derived estimators', () => {

	const trace = {
		...timestampTrace(),
		refreshHz: 60,
		refreshP50: 1000 / 60,
		refreshP95: 17,
		hostReserveP95: 17 - 1000 / 60,
		compositorReserve: { verdict: 'NOT_CLAIMED', reason: 'no compositor timing API' },
		warmupCpuSamples: Array( 30 ).fill( 1 ),
		coldCpuSamples: [ 2 ],
		coldPresentationSamples: [ 16 ],
		timestampResolveCount: 1,
		timestampMappingCadence: 'once-per-batch',
		timestampReconciliationScope: 'maximum final-frame aggregate residual'
	};
	const governorTrace = performanceGovernorTrace();
	const result = createPerformanceEvidenceArtifacts( {
		captureProfile: 'performance',
		adapterClass: 'hardware',
		metrics: { tier: 'target-performance', cpuFrameMs: { samples: [ 1 ] } },
		gpuTiming: { verdict: 'PASS', renderMs: 12.8, computeMs: null },
		performanceTrace: trace,
		governorTrace
	} );
	const envelope = result.artifacts[ 'performance-envelope.json' ];
	const frameTrace = result.artifacts[ 'frame-trace.json' ];
	const governor = result.artifacts[ 'quality-governor.json' ];
	assert.equal( result.performanceVerdict, 'PASS' );
	assert.equal( result.gpuAttributionVerdict, 'PASS' );
	assert.equal( result.governorVerdict, 'PASS' );
	assert.equal( result.performanceComplianceVerdict, 'PASS' );
	assert.equal( envelope.refreshRate.label, 'Measured' );
	assert.equal( envelope.refreshPeriod.label, 'Derived' );
	assert.equal( envelope.browserMainThreadReserve.label, 'Measured' );
	assert.equal( envelope.compositorGpuReserve.status, 'NOT_CLAIMED' );
	assert.equal( frameTrace.renderTimestamp.label, 'Derived' );
	assert.equal( frameTrace.gpuP50.label, 'Derived' );
	assert.equal( frameTrace.gpuP95.label, 'Derived' );
	assert.match( frameTrace.gpuP50.source, /measured render-context timestamps/ );
	assert.match( frameTrace.gpuP95.source, /measured render-context timestamps/ );
	assert.equal( frameTrace.presentationCadence.label, 'Derived' );
	assert.match( frameTrace.sustained.cpuSamples.source, /physical-browser performance/ );
	assert.equal( governor.windows[ 1 ].visualError.label, 'Derived' );
	assert.match( governor.windows[ 1 ].gpuP95.source, /measured render-context timestamps/ );
	assert.equal( governor.windows[ 1 ].edgeMaskPixels.label, 'Measured' );
	assert.equal( governor.finalStableGpuP95.label, 'Derived' );
	assert.equal( governor.finalStableVisualError.label, 'Derived' );
	assert.equal( Object.isFrozen( result ), true );
	assert.equal( Object.isFrozen( trace ), false );
	assert.equal( Object.isFrozen( governorTrace ), false );
	assert.equal( Object.isFrozen( governorTrace.states ), false );

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
