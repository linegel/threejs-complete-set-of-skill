import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BoxGeometry,
	FloatType,
	HalfFloatType,
	NodeUpdateType,
	PerspectiveCamera,
	PlaneGeometry,
	RenderTarget,
	Scene,
	SRGBColorSpace,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { emissive, mrt, normalView, output, pass } from 'three/tsl';

import {
	assertCorrectnessCaptureRecipeContext,
	assertCorrectnessCaptureEntryState,
	assertCurrentLockedCaptureMode,
	assertCaptureDeviceTupleUnchanged,
	assertRendererBackendDeviceIdentity,
	buildCaptureRecipeEvidenceEnvelope,
	cloneJsonSafeCaptureEvidence,
	configureExplicitRenderSubmissionPass,
	createExclusiveControllerOperationGate,
	createJoinableControllerDisposal,
	createValidationResourceLedgerObserver,
	FINAL_EMISSIVE_COMPOSITE_STRENGTH,
	finalizeCaptureEvidenceWithDeviceGuard,
	parseRenderTimestampUid,
	summarizeTimestampBatch,
	timestampResolutionPolicy,
	VALIDATION_MODE_OUTPUT_NODE_IDS
} from './browser-subject-adapter.js';
import {
	correctnessCaptureRecipeDigest,
	correctnessCaptureRecipeSetDigest,
	getCorrectnessCaptureRecipe
} from './correctness-capture-recipes.js';
import { sha256Hex } from './physical-evidence-common.js';
import { getRouteLock } from './route-locks.js';

test( 'final output retains a visible authored emissive composite', () => {

	assert.equal( FINAL_EMISSIVE_COMPOSITE_STRENGTH, 0.4 );

} );

function testCanvas() {

	return {
		width: 1,
		height: 1,
		style: {},
		addEventListener() {},
		removeEventListener() {},
		getContext() { return null; }
	};

}

function deferred() {

	let resolve;
	let reject;
	const promise = new Promise( ( onResolve, onReject ) => {

		resolve = onResolve;
		reject = onReject;

	} );
	return { promise, resolve, reject };

}

function createResourceObserverFixture() {

	const renderer = new WebGPURenderer( { canvas: testCanvas(), outputBufferType: HalfFloatType } );
	const scenePass = pass( new Scene(), new PerspectiveCamera() );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );
	scenePass.setSize( 1200, 800 );
	scenePass.getTexture( 'normal' );
	scenePass.getTexture( 'emissive' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	scenePass.renderTarget.depthTexture.image.width = 1200;
	scenePass.renderTarget.depthTexture.image.height = 800;
	const captureTarget = new RenderTarget( 1200, 800, { type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.colorSpace = SRGBColorSpace;
	captureTarget.texture.name = 'validation-capture-rgba8';
	const geometries = [ new BoxGeometry( 1, 1, 1 ), new PlaneGeometry( 2, 2 ) ];
	return {
		renderer,
		observer: createValidationResourceLedgerObserver( { renderer, scenePass, captureTarget, geometries } )
	};

}

function captureResourceFixture() {

	return createResourceObserverFixture().observer.describeLive();

}

function captureStateFixture( overrides = {} ) {

	return {
		schemaVersion: 1,
		scenario: 'browser-capture',
		mode: 'final',
		tier: 'webgpu-correctness',
		camera: 'design',
		seed: 1,
		timeSeconds: 0,
		viewport: { width: 1200, height: 800, dpr: 1 },
		passScale: 1,
		outputNodeMode: 'final',
		outputNodeId: VALIDATION_MODE_OUTPUT_NODE_IDS.final,
		outputNodeUuid: 'output-node-final-uuid',
		outputNodeType: 'RenderOutputNode',
		captureTarget: { width: 1200, height: 800 },
		sceneTarget: { width: 1200, height: 800 },
		rendererTarget: { kind: 'presentation', textureUuid: null },
		device: {
			controllerGeneration: 3,
			rendererDeviceGeneration: 4,
			deviceLossGeneration: 0,
			rendererDeviceStatus: 'active',
			deviceLostObserved: false,
			backendDeviceIdentityVerified: true,
			nativeWebGPUBackend: true,
			uncapturedErrorCount: 0
		},
		...overrides
	};

}

function captureLayoutsFixture( width = 1200, height = 800 ) {

	const rowBytes = width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const minimumByteLength = bytesPerRow * ( height - 1 ) + rowBytes;
	const fullyPaddedByteLength = bytesPerRow * height;
	return {
		readback: { width, height, bytesPerTexel: 4, rowBytes, bytesPerRow, minimumByteLength, fullyPaddedByteLength, alignment: 256 },
		transport: { width, height, rowBytes, bytesPerRow, byteLength: minimumByteLength, format: 'rgba8unorm', origin: 'top-left', padding: 'tight-final-row' },
		normalized: { width, height, rowBytes, bytesPerRow, byteLength: fullyPaddedByteLength, format: 'rgba8unorm', origin: 'top-left' }
	};

}

async function captureEnvelopeFixture( overrides = {} ) {

	const recipe = getCorrectnessCaptureRecipe( 'final.design' );
	const state = captureStateFixture();
	const entryResources = captureResourceFixture();
	const restoredResources = structuredClone( entryResources );
	restoredResources.trackedPeakLiveBytes += 4096;
	const fixture = {
		recipe,
		recipeDigest: await correctnessCaptureRecipeDigest( recipe.id ),
		recipeSetDigest: await correctnessCaptureRecipeSetDigest(),
		routeLock: getRouteLock( 'tier', 'webgpu-correctness' ),
		runtimeProfile: 'correctness',
		transaction: {
			schemaVersion: 1,
			status: 'COMMITTED',
			transactionId: 'capture-1',
			sequence: 1,
			recipeId: recipe.id,
			restorationVerdict: 'PASS',
			phaseVerdicts: { capture: 'PASS', restore: 'PASS', settle: 'PASS', verify: 'PASS' },
			entryStateDigest: await sha256Hex( state ),
			restoredStateDigest: await sha256Hex( state )
		},
		entryState: state,
		effectiveState: structuredClone( state ),
		effectiveStateDigest: await sha256Hex( state ),
		restoredState: structuredClone( state ),
		resources: {
			entry: entryResources,
			effective: structuredClone( entryResources ),
			restored: restoredResources
		},
		telemetry: {
			entry: { resetEventCount: 0, resetEvents: [] },
			effective: { resetEventCount: 0, resetEvents: [] },
			restored: { resetEventCount: 0, resetEvents: [] },
			appendedDuringCapture: [],
			appendedDuringRestoration: [],
			historyResetDelta: 0,
			restorationHistoryResetDelta: 0
		},
		submissions: {
			entry: { renderSubmissionCount: 1, scenePassExecutionCount: 1, modeSelectionCount: 1 },
			effective: { renderSubmissionCount: 2, scenePassExecutionCount: 2, modeSelectionCount: 2 },
			restored: { renderSubmissionCount: 3, scenePassExecutionCount: 3, modeSelectionCount: 3 },
			captureDelta: { renderSubmissions: 1, scenePassExecutions: 1, modeSelections: 1 },
			restorationDelta: { renderSubmissions: 1, scenePassExecutions: 1, modeSelections: 1 },
			captureRenderTrace: [ { sequence: 2, timeSeconds: 0, target: 'capture-target', mode: 'final', tier: 'webgpu-correctness' } ],
			restorationRenderTrace: [ { sequence: 3, timeSeconds: 0, target: 'presentation', mode: 'final', tier: 'webgpu-correctness' } ]
		},
		layouts: captureLayoutsFixture()
	};
	const result = { ...fixture, ...overrides };
	if ( overrides.recipe !== undefined && overrides.recipeDigest === undefined ) result.recipeDigest = await correctnessCaptureRecipeDigest( result.recipe.id );
	if ( overrides.entryState !== undefined && overrides.transaction?.entryStateDigest === undefined ) result.transaction = { ...result.transaction, entryStateDigest: await sha256Hex( result.entryState ) };
	if ( overrides.restoredState !== undefined && overrides.transaction?.restoredStateDigest === undefined ) result.transaction = { ...result.transaction, restoredStateDigest: await sha256Hex( result.restoredState ) };
	if ( overrides.effectiveState !== undefined && overrides.effectiveStateDigest === undefined ) result.effectiveStateDigest = await sha256Hex( result.effectiveState );
	return result;

}

test( 'renderer identity requires the exact device retained by the initialized backend', () => {

	const requestedDevice = {};
	assert.equal( assertRendererBackendDeviceIdentity( requestedDevice, requestedDevice ), requestedDevice );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, {} ), /exact requested GPUDevice/ );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, null ), /actual GPUDevice/ );

} );

test( 'manual deterministic renders execute the scene pass once per submission', () => {

	const scenePass = pass( new Scene(), new PerspectiveCamera() );
	assert.equal( scenePass.updateBeforeType, NodeUpdateType.FRAME );
	assert.equal( configureExplicitRenderSubmissionPass( scenePass ), scenePass );
	assert.equal( scenePass.updateBeforeType, NodeUpdateType.RENDER );
	assert.throws( () => configureExplicitRenderSubmissionPass( {} ), /requires a PassNode/ );

} );

test( 'correctness capture context requires the exact canonical parent and current-mode readback', () => {

	const recipe = getCorrectnessCaptureRecipe( 'final.design' );
	const routeLock = getRouteLock( 'tier', 'webgpu-correctness' );
	assert.equal( assertCorrectnessCaptureRecipeContext( { runtimeProfile: 'correctness', routeLock, recipe } ), true );
	assert.equal( assertCorrectnessCaptureEntryState( captureStateFixture(), routeLock ), true );
	assert.throws( () => assertCorrectnessCaptureRecipeContext( {
		runtimeProfile: 'correctness',
		routeLock: { ...routeLock, startup: { ...routeLock.startup } },
		recipe
	} ), /exact tier\/webgpu-correctness/ );
	assert.throws( () => assertCorrectnessCaptureRecipeContext( { runtimeProfile: 'performance', routeLock, recipe } ), /correctness runtime profile/ );
	assert.throws( () => assertCorrectnessCaptureRecipeContext( {
		runtimeProfile: 'correctness',
		routeLock,
		recipe: { ...recipe, parentRoute: { kind: 'tier', id: 'release' } }
	} ), /does not belong/ );
	assert.throws( () => assertCorrectnessCaptureEntryState( captureStateFixture( { rendererTarget: { kind: 'capture-target', textureUuid: 'leaked' } } ), routeLock ), /rendererTarget drifted/ );
	assert.throws( () => assertCorrectnessCaptureEntryState( captureStateFixture( { device: { ...captureStateFixture().device, uncapturedErrorCount: 1 } } ), routeLock ), /clean active native-WebGPU/ );
	assert.equal( assertCurrentLockedCaptureMode( 'normal', 'normal' ), true );
	assert.throws( () => assertCurrentLockedCaptureMode( 'normal', 'final' ), /not the current locked mode/ );

} );

test( 'capture evidence is JSON-safe, canonicalizes negative zero, and rejects binary or cyclic metadata', () => {

	const cloned = cloneJsonSafeCaptureEvidence( { values: [ - 0, 1 ], nested: { pass: true } } );
	assert.equal( Object.is( cloned.values[ 0 ], - 0 ), false );
	assert.equal( cloned.values[ 0 ], 0 );
	assert.equal( Object.isFrozen( cloned ), true );
	assert.equal( Object.isFrozen( cloned.values ), true );
	assert.throws( () => cloneJsonSafeCaptureEvidence( { pixels: new Uint8Array( 4 ) } ), /binary data/ );
	const cyclic = {};
	cyclic.self = cyclic;
	assert.throws( () => cloneJsonSafeCaptureEvidence( cyclic ), /cycle/ );
	assert.throws( () => cloneJsonSafeCaptureEvidence( { invalid: undefined } ), /non-JSON undefined/ );
	const sparse = new Array( 2 );
	assert.throws( () => cloneJsonSafeCaptureEvidence( sparse ), /sparse array hole/ );
	const accessor = {};
	Object.defineProperty( accessor, 'value', { enumerable: true, get() { return 1; } } );
	assert.throws( () => cloneJsonSafeCaptureEvidence( accessor ), /enumerable plain JSON data/ );
	const hiddenObject = {};
	Object.defineProperty( hiddenObject, 'hidden', { enumerable: false, value: 1 } );
	assert.throws( () => cloneJsonSafeCaptureEvidence( hiddenObject ), /enumerable plain JSON data/ );
	const hiddenArray = [ 1 ];
	Object.defineProperty( hiddenArray, '0', { enumerable: false, value: 1 } );
	assert.throws( () => cloneJsonSafeCaptureEvidence( hiddenArray ), /enumerable plain JSON data/ );
	const arrayWithExtra = [ 1 ];
	arrayWithExtra.extra = true;
	assert.throws( () => cloneJsonSafeCaptureEvidence( arrayWithExtra ), /non-JSON array property/ );
	const arrayWithSymbol = [ 1 ];
	arrayWithSymbol[ Symbol( 'hidden' ) ] = true;
	assert.throws( () => cloneJsonSafeCaptureEvidence( arrayWithSymbol ), /non-JSON array property/ );
	const protoKey = JSON.parse( '{"__proto__":{"polluted":true},"ok":1}' );
	assert.throws( () => cloneJsonSafeCaptureEvidence( protoKey ), /forbidden evidence key/ );
	assert.equal( {}.polluted, undefined );

} );

test( 'device tuple checks reject post-await loss, generation drift, and new GPU errors', () => {

	const entry = captureStateFixture().device;
	assert.equal( assertCaptureDeviceTupleUnchanged( entry, structuredClone( entry ), 'Post-commit evidence finalization' ), true );
	assert.throws( () => assertCaptureDeviceTupleUnchanged( entry, { ...entry, deviceLossGeneration: 1 }, 'Post-commit evidence finalization' ), /identity or generation drift/ );
	assert.throws( () => assertCaptureDeviceTupleUnchanged( entry, { ...entry, rendererDeviceGeneration: 5 }, 'Post-commit evidence finalization' ), /identity or generation drift/ );
	assert.throws( () => assertCaptureDeviceTupleUnchanged( entry, { ...entry, uncapturedErrorCount: 1 }, 'Post-commit evidence finalization' ), /new uncaptured GPU errors/ );

} );

test( 'async evidence finalization poisons when device state drifts during digest work', async () => {

	const entryDevice = captureStateFixture().device;
	const digestWork = deferred();
	let observedDevice = structuredClone( entryDevice );
	let poison = null;
	const finalization = finalizeCaptureEvidenceWithDeviceGuard( {
		recipeId: 'final.design',
		entryDevice,
		observeDevice: () => observedDevice,
		onPoison: ( value ) => {

			poison = value;

		},
		buildEvidence: () => digestWork.promise
	} );
	observedDevice = { ...observedDevice, deviceLossGeneration: 1, deviceLostObserved: true };
	digestWork.resolve( { status: 'assembled' } );
	await assert.rejects( finalization, /identity or generation drift/ );
	assert.equal( poison.recipeId, 'final.design' );
	assert.match( poison.reason, /identity or generation drift/ );

	const stableEvidence = await finalizeCaptureEvidenceWithDeviceGuard( {
		recipeId: 'final.design',
		entryDevice,
		observeDevice: () => structuredClone( entryDevice ),
		onPoison: () => assert.fail( 'Stable finalization must not poison.' ),
		buildEvidence: async () => ( { status: 'assembled' } )
	} );
	assert.deepEqual( stableEvidence, { status: 'assembled' } );

} );

test( 'capture evidence requires committed state and stable restorable resource identities', async () => {

	const input = await captureEnvelopeFixture();
	const evidence = await buildCaptureRecipeEvidenceEnvelope( input );
	assert.equal( evidence.recipe.captureFilename, 'final.design.png' );
	assert.equal( evidence.transaction.status, 'COMMITTED' );
	assert.deepEqual( evidence.claimScope, { correctness: true, performance: false, gpuAttribution: false } );
	assert.equal( evidence.transaction.entryStateDigest, evidence.transaction.restoredStateDigest );
	assert.equal( evidence.parentStartupStateDigest, evidence.transaction.entryStateDigest );
	assert.equal( evidence.passScale, 1 );
	assert.equal( evidence.resources.restored.trackedPeakLiveBytes > evidence.resources.entry.trackedPeakLiveBytes, true );
	assert.equal( Object.isFrozen( evidence.resources ), true );

	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		transaction: { ...input.transaction, status: 'FAILED' }
	} ), /not committed/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		recipeDigest: `sha256:${ '0'.repeat( 64 ) }`
	} ), /digest does not match the frozen recipe/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		effectiveStateDigest: `sha256:${ '0'.repeat( 64 ) }`
	} ), /effective-state digest does not match/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		restoredState: captureStateFixture( { camera: 'near' } )
	} ), /state digests do not match/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		restoredState: captureStateFixture( { rendererTarget: { kind: 'capture-target', textureUuid: 'texture-4' } } )
	} ), /state digests do not match/ );
	const driftedResources = structuredClone( input.resources );
	driftedResources.restored.renderTargets[ 0 ].width = 641;
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		resources: driftedResources
	} ), /byte accounting mismatch/ );
	const leakedTransient = structuredClone( input.resources );
	leakedTransient.restored.transientResources.readbackBuffers.push( { id: 'leaked-readback', logicalBytes: 256, liveBytes: 256, liveness: 'live' } );
	leakedTransient.restored.trackedTransientBytes = 256;
	leakedTransient.restored.trackedLiveBytes += 256;
	leakedTransient.restored.trackedLogicalBytes += 256;
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		resources: leakedTransient
	} ), /runtimeMemory|bytes do not match/ );
	const partialResources = structuredClone( input.resources );
	delete partialResources.effective.classSummaries;
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		resources: partialResources
	} ), /classSummaries/ );
	const driftedEffectiveState = captureStateFixture( { tier: 'governor-stress', passScale: 0.5 } );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		effectiveState: driftedEffectiveState,
		effectiveStateDigest: await sha256Hex( driftedEffectiveState )
	} ), /does not match recipe/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		layouts: { ...captureLayoutsFixture(), transport: { ...captureLayoutsFixture().transport, bytesPerRow: 4800 } }
	} ), /retained layout/ );

} );

test( 'temporal t001 evidence starts at zero, resets once, and steps exactly once', async () => {

	const recipe = getCorrectnessCaptureRecipe( 'temporal.t001' );
	const base = await captureEnvelopeFixture();
	const effectiveState = captureStateFixture( {
		timeSeconds: 1 / 60
	} );
	const reset = { cause: 'correctness-capture', timeSeconds: 0 };
	const telemetry = {
		entry: { resetEventCount: 2, resetEvents: [ { cause: 'prior-1', timeSeconds: 0 }, { cause: 'prior-2', timeSeconds: 0 } ] },
		effective: { resetEventCount: 3, resetEvents: [ { cause: 'prior-1', timeSeconds: 0 }, { cause: 'prior-2', timeSeconds: 0 }, reset ] },
		restored: { resetEventCount: 3, resetEvents: [ { cause: 'prior-1', timeSeconds: 0 }, { cause: 'prior-2', timeSeconds: 0 }, reset ] },
		appendedDuringCapture: [ reset ],
		appendedDuringRestoration: [],
		historyResetDelta: 1,
		restorationHistoryResetDelta: 0
	};
	const submissions = {
		entry: { renderSubmissionCount: 4, scenePassExecutionCount: 4, modeSelectionCount: 2 },
		effective: { renderSubmissionCount: 6, scenePassExecutionCount: 6, modeSelectionCount: 3 },
		restored: { renderSubmissionCount: 7, scenePassExecutionCount: 7, modeSelectionCount: 4 },
		captureDelta: { renderSubmissions: 2, scenePassExecutions: 2, modeSelections: 1 },
		restorationDelta: { renderSubmissions: 1, scenePassExecutions: 1, modeSelections: 1 },
		captureRenderTrace: [
			{ sequence: 5, timeSeconds: 0, target: 'presentation', mode: 'final', tier: 'webgpu-correctness' },
			{ sequence: 6, timeSeconds: 1 / 60, target: 'capture-target', mode: 'final', tier: 'webgpu-correctness' }
		],
		restorationRenderTrace: [ { sequence: 7, timeSeconds: 0, target: 'presentation', mode: 'final', tier: 'webgpu-correctness' } ]
	};
	const input = {
		...base,
		recipe,
		recipeDigest: await correctnessCaptureRecipeDigest( recipe.id ),
		transaction: { ...base.transaction, recipeId: recipe.id },
		effectiveState,
		effectiveStateDigest: await sha256Hex( effectiveState ),
		telemetry,
		submissions
	};
	const evidence = await buildCaptureRecipeEvidenceEnvelope( input );
	assert.equal( evidence.effectiveState.timeSeconds, 1 / 60 );
	assert.equal( evidence.telemetry.restored.resetEventCount, 3 );
	assert.equal( evidence.transaction.entryStateDigest, evidence.transaction.restoredStateDigest );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		telemetry: {
			...telemetry,
			effective: { ...telemetry.effective, resetEvents: [ ...telemetry.entry.resetEvents, { ...reset, timeSeconds: 1 / 60 } ] },
			restored: { ...telemetry.restored, resetEvents: [ ...telemetry.entry.resetEvents, { ...reset, timeSeconds: 1 / 60 } ] },
			appendedDuringCapture: [ { ...reset, timeSeconds: 1 / 60 } ]
		}
	} ), /wrong cause or time/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		telemetry: {
			...telemetry,
			effective: { ...telemetry.effective, resetEvents: [ { cause: 'rewritten-prior', timeSeconds: 0 }, telemetry.entry.resetEvents[ 1 ], reset ] },
			restored: { ...telemetry.restored, resetEvents: [ { cause: 'rewritten-prior', timeSeconds: 0 }, telemetry.entry.resetEvents[ 1 ], reset ] }
		}
	} ), /rewrote the entry reset-history prefix/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		submissions: { ...submissions, captureDelta: { ...submissions.captureDelta, renderSubmissions: 1 } }
	} ), /cumulative renderSubmissionCount/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		submissions: {
			...submissions,
			effective: { ...submissions.effective, scenePassExecutionCount: 7 }
		}
	} ), /cumulative scenePassExecutionCount/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		submissions: {
			...submissions,
			restorationRenderTrace: [ { ...submissions.restorationRenderTrace[ 0 ], sequence: 8 } ]
		}
	} ), /sequence is not contiguous|trace endpoints/ );
	await assert.rejects( buildCaptureRecipeEvidenceEnvelope( {
		...input,
		submissions: {
			...submissions,
			captureRenderTrace: submissions.captureRenderTrace.map( ( row ) => ( { ...row, timeSeconds: 1 / 60 } ) )
		}
	} ), /render times/ );

} );

test( 'exclusive controller operations block interleaving and admit poisoned disposal only', async () => {

	let poisoned = false;
	const gate = createExclusiveControllerOperationGate( ( operation, options ) => {

		if ( poisoned && options.allowPoisoned !== true ) throw new Error( `poisoned ${ operation }` );

	} );
	const release = deferred();
	const running = gate.run( 'captureRecipe', async () => release.promise );
	await Promise.resolve();
	assert.equal( gate.status().active.operation, 'captureRecipe' );
	assert.throws( () => gate.assertAvailable( 'setMode' ), /controller operation controller-operation-1 is active/ );
	await assert.rejects( gate.run( 'renderOnce', async () => true ), /controller operation controller-operation-1 is active/ );
	await assert.rejects( gate.run( 'dispose', async () => true, { allowPoisoned: true } ), /controller operation controller-operation-1 is active/ );
	release.resolve( 'captured' );
	assert.equal( await running, 'captured' );
	assert.equal( gate.status().active, null );
	await assert.rejects( gate.run( 'capturePixels', async () => {

		throw new Error( 'readback failed' );

	} ), /readback failed/ );
	assert.equal( gate.status().active, null );

	poisoned = true;
	assert.throws( () => gate.assertAvailable( 'describeResources' ), /poisoned describeResources/ );
	assert.equal( await gate.run( 'dispose', async () => 'disposed', { allowPoisoned: true } ), 'disposed' );
	assert.equal( gate.status().active, null );

} );

test( 'concurrent disposal calls join one in-flight operation and rejected starts do not latch', async () => {

	const disposal = createJoinableControllerDisposal();
	assert.throws( () => disposal.joinOrStart( () => {

		throw new Error( 'capture operation active' );

	} ), /capture operation active/ );
	assert.equal( disposal.status().started, false );

	const release = deferred();
	let starts = 0;
	const first = disposal.joinOrStart( async () => {

		starts ++;
		return release.promise;

	} );
	const second = disposal.joinOrStart( async () => {

		starts ++;
		return 'duplicate';

	} );
	assert.equal( first, second );
	assert.equal( starts, 1 );
	assert.equal( disposal.status().started, true );
	release.resolve( 'disposed' );
	assert.equal( await first, 'disposed' );
	assert.equal( await second, 'disposed' );

} );

test( 'timestamp populations are resolved once per sustained batch', () => {

	assert.equal( timestampResolutionPolicy.mappingCadence, 'once-per-batch' );
	const batch = summarizeTimestampBatch( {
		entries: [
			{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
			{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
			{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 },
			{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 }
		],
		resolvedLastFrameTotalMs: 6
	} );
	assert.deepEqual( batch.totalSamples, [ 4, 6 ] );
	assert.deepEqual( batch.stageSamples[ 'scene-mrt' ], [ 3, 4 ] );
	assert.deepEqual( batch.stageSamples[ 'final-output' ], [ 1, 2 ] );
	assert.deepEqual( batch.stageContextIds, { 'final-output': 41, 'scene-mrt': 17 } );
	assert.equal( batch.resolveCount, 1 );
	assert.equal( batch.lastFrameResolveResidualMs, 0 );
	assert.equal( batch.independentPerFrameTotalsAvailable, false );
	assert.equal( batch.rows[ 0 ].sceneUid, 'r:1:17:f10' );
	assert.equal( batch.rows[ 0 ].outputUid, 'r:2:41:f10' );
	assert.equal( batch.rows[ 0 ].residualMs, null );
	assert.deepEqual( parseRenderTimestampUid( 'r:123:45:f67' ), { uid: 'r:123:45:f67', frameCall: 123, contextId: 45, frameId: 67 } );
	assert.throws( () => parseRenderTimestampUid( 'r:scene:f67' ), /does not match Three r185/ );
	const sharedRendererFrame = summarizeTimestampBatch( {
		entries: [
			{ uid: 'r:10:17:f3', stage: 'scene-mrt', durationMs: 1 },
			{ uid: 'r:11:41:f3', stage: 'final-output', durationMs: 0.5 },
			{ uid: 'r:12:17:f3', stage: 'scene-mrt', durationMs: 2 },
			{ uid: 'r:13:41:f3', stage: 'final-output', durationMs: 0.75 }
		],
		resolvedLastFrameTotalMs: 2.75
	} );
	assert.deepEqual( sharedRendererFrame.rows.map( ( row ) => row.frameId ), [ 3, 3 ] );
	assert.deepEqual( sharedRendererFrame.totalSamples, [ 1.5, 2.75 ] );

} );

test( 'timestamp attribution rejects ordering, stage, frame, and context forgeries', () => {

	const base = [
		{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
		{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
		{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 },
		{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 }
	];
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 1 ? { ...entry, uid: 'r:2:17:f10', stage: 'scene-mrt' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /scene-mrt followed by final-output/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 3 ? { ...entry, uid: 'r:4:99:f11' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /changed render-context identity/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 3 ? { ...entry, uid: entry.uid.replace( 'f11', 'f12' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /crosses renderer frame identities/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 3 ? { ...entry, uid: entry.uid.replace( 'r:4:', 'r:5:' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /render-call identities must be contiguous/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry ) => entry.stage === 'final-output' ? { ...entry, uid: entry.uid.replace( ':41:', ':17:' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /two distinct stable render contexts/ );

} );

test( 'resource observer retains the exact live predecessor and reports zero live bytes after disposal', () => {

	const { renderer, observer } = createResourceObserverFixture();
	const firstLive = observer.describeLive();
	const latestLive = observer.describeLive();
	assert.equal( latestLive.identityClosureDigest, firstLive.identityClosureDigest );
	assert.equal( latestLive.trackedRenderTargetBytes, 30_720_000 );
	assert.equal( observer.current(), latestLive );
	assert.equal( JSON.stringify( cloneJsonSafeCaptureEvidence( latestLive ) ), JSON.stringify( latestLive ) );

	renderer.info.dispose();
	const disposed = observer.describeDisposed();
	assert.equal( disposed.state, 'disposed' );
	assert.equal( disposed.predecessorIdentityClosureDigest, latestLive.identityClosureDigest );
	assert.equal( disposed.identityClosureDigest, latestLive.identityClosureDigest );
	assert.deepEqual( disposed.renderTargets.map( ( target ) => target.textureUuid ), latestLive.renderTargets.map( ( target ) => target.textureUuid ) );
	assert.deepEqual( disposed.geometries.map( ( geometry ) => geometry.uuid ), latestLive.geometries.map( ( geometry ) => geometry.uuid ) );
	assert.equal( disposed.trackedRenderTargetBytes, 0 );
	assert.equal( disposed.trackedGeometryBytes, 0 );
	assert.equal( disposed.trackedTransientBytes, 0 );
	assert.equal( disposed.trackedLiveBytes, 0 );
	assert.equal( disposed.disposalObservation.memoryMapSize, 0 );
	assert.equal( disposed.disposalObservation.memoryTotalBytes, 0 );
	assert.equal( observer.describeDisposed(), disposed );
	assert.throws( () => observer.describeLive(), /after disposal/ );

} );
