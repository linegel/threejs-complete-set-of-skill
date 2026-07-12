import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { numericArray, numericDatum, NumericLabel } from './numeric-evidence.js';
import { HARDWARE_PERFORMANCE_CONTRACT } from './in-app-evidence-plan.js';
import { getAlignedReadbackLayout } from './readback.js';
import { REQUIRED_V2_IMAGES } from './schema/v2.js';

const RUNTIME_SOURCE = 'native WebGPU correctness capture';
const M = ( value, unit, source = RUNTIME_SOURCE ) => numericDatum( value, unit, NumericLabel.MEASURED, source );
const D = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.DERIVED, source );
const G = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.GATED, source );
const A = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.AUTHORED, source );
const MA = ( values, unit, source = RUNTIME_SOURCE ) => numericArray( values, unit, NumericLabel.MEASURED, source );
const DA = ( values, unit, source ) => numericArray( values, unit, NumericLabel.DERIVED, source );
const AA = ( values, unit, source ) => numericArray( values, unit, NumericLabel.AUTHORED, source );
const ADAPTER_CLASSES = new Set( [ 'hardware', 'software', 'virtual', 'unknown' ] );
const MECHANISM_MODES = Object.freeze( [ 'final', 'no-post', 'normal', 'emissive' ] );
const REQUIRED_CLAIM_CLASSES = Object.freeze( [ 'visualCorrectness', 'mechanismCorrectness', 'performanceCompliance', 'gpuAttribution', 'lifecycleStability' ] );
export const VISUAL_SIGNOFF_IMAGES = Object.freeze( [ ...REQUIRED_V2_IMAGES, 'diagnostic.normal.png', 'diagnostic.emissive.png' ] );

function schema( fields ) {

	return { schemaVersion: 2, ...fields };

}

function digest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( JSON.stringify( value ) ).digest( 'hex' ) }`;

}

function canonicalize( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalize );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonicalize( value[ key ] ) ] ) );
	return value;

}

export function createRuntimePipelineGraph( pipeline, resources ) {

	if ( pipeline === null || typeof pipeline !== 'object' || resources === null || typeof resources !== 'object' ) throw new Error( 'Runtime pipeline graph requires live pipeline and resource snapshots.' );
	if ( Array.isArray( pipeline.signals ) === false || Array.isArray( pipeline.sceneSubmissions ) === false || Array.isArray( pipeline.computeDispatches ) === false ) throw new Error( 'Runtime pipeline snapshot is structurally incomplete.' );
	if ( pipeline.computeDispatches.length !== 0 ) throw new Error( 'The static validation subject must not report undeclared compute dispatches.' );
	if ( Array.isArray( resources.renderTargets ) === false ) throw new Error( 'Runtime resource snapshot omits render targets.' );
	const passKinds = new Set( [ 'prepass', 'lit-scene', 'shadow', 'post', 'diagnostic', 'present' ] );
	return schema( {
		owners: pipeline.owners,
		signals: pipeline.signals.map( ( signal ) => ( { ...signal, reachable: true } ) ),
		sceneSubmissions: pipeline.sceneSubmissions.map( ( submission ) => {

			const kind = submission.kind === 'full-lit' ? 'lit-scene' : submission.kind;
			if ( passKinds.has( kind ) === false ) throw new Error( `Runtime scene submission ${ submission.id } has unsupported kind ${ submission.kind }.` );
			return {
				id: submission.id,
				owner: submission.owner ?? pipeline.owners?.renderPipeline,
				kind,
				submissionCount: M( submission.count, 'submission/frame', 'LabController.describePipeline' )
			};

		} ),
		computeDispatches: [],
		resources: resources.renderTargets.map( ( target ) => {

			if ( typeof target.name !== 'string' || typeof target.owner !== 'string' || Number.isFinite( target.bytes ) === false || target.bytes < 0 ) throw new Error( 'Runtime render-target record is incomplete.' );
			return {
				id: target.name,
				owner: target.owner,
				kind: 'render-target',
				residentBytes: {
					value: target.bytes,
					unit: 'bytes',
					label: 'Derived',
					source: `${ target.width } x ${ target.height } x ${ target.bytesPerTexel } bytes/texel`
				}
			};

		} ),
		finalToneMapOwner: pipeline.finalToneMapOwner,
		finalOutputTransformOwner: pipeline.finalOutputTransformOwner
	} );

}

function timestampEvidenceRow( row, source ) {

	return {
		frameId: M( row.frameId, 'frame', source ),
		sceneUid: row.sceneUid,
		outputUid: row.outputUid,
		sceneMs: M( row.sceneMs, 'ms', `${ source }; scene-mrt timestamp` ),
		outputMs: M( row.outputMs, 'ms', `${ source }; final-output timestamp` ),
		totalMs: D( row.totalMs, 'ms', 'sceneMs + outputMs' ),
		residualMs: null,
		totalProvenance: 'Derived',
		independentPerFrameTotalAvailable: false
	};

}

export function visualSignoffBindingDigest( binding ) {

	return digest( canonicalize( binding ) );

}

export function createVisualSignoffBinding( input ) {

	const images = Object.fromEntries( VISUAL_SIGNOFF_IMAGES.map( ( filename ) => {

		const hash = input.imageHashes?.[ filename ];
		if ( typeof hash !== 'string' || /^sha256:[0-9a-f]{64}$/.test( hash ) === false ) throw new Error( `Visual signoff binding is missing ${ filename } hash.` );
		return [ filename, hash ];

	} ) );
	const binding = {
		labId: input.labId,
		sourceClosureHash: input.sourceClosureHash,
		buildRevision: input.buildRevision,
		pipelineGraphDigest: input.pipelineGraphDigest,
		captureProfile: input.captureProfile,
		adapterClass: input.adapterClass,
		deviceState: {
			deviceLostObserved: input.deviceState?.deviceLostObserved === true,
			uncapturedErrors: [ ...( input.deviceState?.uncapturedErrors ?? [] ) ],
			deviceErrors: [ ...( input.deviceState?.deviceErrors ?? [] ) ]
		},
		claimVerdicts: Object.fromEntries( REQUIRED_CLAIM_CLASSES.map( ( claim ) => [ claim, input.claimVerdicts?.[ claim ] ] ) ),
		captureFinalization: {
			captureSessionSha256: input.offlineFinalization?.captureSessionSha256,
			artifactLedgerSha256: input.offlineFinalization?.artifactLedgerSha256
		},
		images
	};
	for ( const key of [ 'labId', 'sourceClosureHash', 'buildRevision', 'pipelineGraphDigest' ] ) if ( typeof binding[ key ] !== 'string' || binding[ key ].length === 0 ) throw new Error( `Visual signoff binding requires ${ key }.` );
	for ( const key of [ 'captureSessionSha256', 'artifactLedgerSha256' ] ) if ( /^sha256:[0-9a-f]{64}$/.test( binding.captureFinalization[ key ] ?? '' ) === false ) throw new Error( `Visual signoff binding requires finalized ${ key }.` );
	return { binding, bindingDigest: visualSignoffBindingDigest( binding ) };

}

export function resolveBundlePromotion( input ) {

	const pendingClaimVerdicts = { ...input.claimVerdicts, visualCorrectness: 'INSUFFICIENT_EVIDENCE' };
	if ( input.offlineFinalization?.phase !== 'offline-finalized-capture-session' ) {

		if ( input.visualSignoff !== null && input.visualSignoff !== undefined ) throw new Error( 'Bundle promotion requires an offline finalized capture session.' );
		return {
			bundleKind: 'browser-capture-incomplete',
			publishable: false,
			claimVerdicts: pendingClaimVerdicts,
			promotion: {
				status: 'CAPTURE_SESSION_PENDING',
				candidateClaimVerdicts: { ...input.claimVerdicts },
				bindingDigest: null,
				binding: null,
				visualSignoff: null
			}
		};

	}
	const { binding, bindingDigest } = createVisualSignoffBinding( input );
	if ( input.visualSignoff === null || input.visualSignoff === undefined ) return {

		bundleKind: 'browser-capture-incomplete',
		publishable: false,
		claimVerdicts: pendingClaimVerdicts,
		promotion: { status: 'PENDING_VISUAL_SIGNOFF', candidateClaimVerdicts: { ...input.claimVerdicts }, bindingDigest, binding, visualSignoff: null }

	};
	if ( REQUIRED_CLAIM_CLASSES.some( ( claim ) => input.claimVerdicts?.[ claim ] !== 'PASS' ) ) throw new Error( 'Bundle promotion requires every claim classifier to PASS.' );
	if ( input.captureProfile !== 'performance' || input.adapterClass !== 'hardware' ) throw new Error( 'Bundle promotion requires the named hardware performance capture.' );
	if ( binding.deviceState.deviceLostObserved || binding.deviceState.uncapturedErrors.length > 0 || binding.deviceState.deviceErrors.length > 0 ) throw new Error( 'Bundle promotion is blocked by live GPU device errors or loss.' );
	const signoff = input.visualSignoff;
	for ( const key of [ 'reviewer', 'reviewedAt', 'reviewMethod' ] ) if ( typeof signoff[ key ] !== 'string' || signoff[ key ].length === 0 ) throw new Error( `Visual signoff requires ${ key }.` );
	if ( signoff.provenance !== 'Authored' || signoff.decision !== 'APPROVED' ) throw new Error( 'Visual signoff must be an Authored APPROVED decision.' );
	if ( signoff.bindingDigest !== bindingDigest ) throw new Error( 'Visual signoff digest does not bind the current source, graph, claims, and images.' );
	if ( JSON.stringify( signoff.reviewedImages ) !== JSON.stringify( VISUAL_SIGNOFF_IMAGES ) ) throw new Error( 'Visual signoff must enumerate the complete frozen review image set.' );
	return {
		bundleKind: 'browser-capture',
		publishable: true,
		claimVerdicts: { ...input.claimVerdicts },
		promotion: { status: 'APPROVED', candidateClaimVerdicts: { ...input.claimVerdicts }, bindingDigest, binding, visualSignoff: structuredClone( signoff ) }
	};

}

function percentile( samples, quantile ) {

	const sorted = [ ...samples ].sort( ( a, b ) => a - b );
	const position = ( sorted.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	if ( lower === upper ) return sorted[ lower ];
	return sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

function finitePopulation( samples, label, minimum = 1 ) {

	if ( Array.isArray( samples ) === false || samples.length < minimum || samples.some( ( value ) => Number.isFinite( value ) === false || value < 0 ) ) throw new Error( `${ label } requires at least ${ minimum } finite nonnegative samples.` );
	return samples;

}

function requireRecomputed( reported, expected, label, tolerance = 1e-9 ) {

	if ( Number.isFinite( reported ) === false || Math.abs( reported - expected ) > tolerance ) throw new Error( `${ label } does not match its raw sample population.` );
	return expected;

}

export function recomputePerformanceTrace( trace ) {

	if ( trace === null || typeof trace !== 'object' ) throw new Error( 'Performance trace must be an object.' );
	const cpuSamples = finitePopulation( trace.cpuSamples, 'Performance CPU population' );
	const gpuSamples = finitePopulation( trace.gpuSamples, 'Performance GPU population' );
	const presentationSamples = finitePopulation( trace.presentationSamples, 'Performance presentation population' );
	if ( Number.isFinite( trace.deadlineIntervalMs ) === false || trace.deadlineIntervalMs <= 0 ) throw new Error( 'Performance trace requires a positive measured deadline interval.' );
	const summaries = {
		cpuP50: percentile( cpuSamples, 0.5 ),
		cpuP95: percentile( cpuSamples, 0.95 ),
		gpuP50: percentile( gpuSamples, 0.5 ),
		gpuP95: percentile( gpuSamples, 0.95 ),
		presentationP50: percentile( presentationSamples, 0.5 ),
		presentationP95: percentile( presentationSamples, 0.95 ),
		deadlineMissRatio: presentationSamples.filter( ( value ) => value > trace.deadlineIntervalMs ).length / presentationSamples.length
	};
	for ( const [ key, expected ] of Object.entries( summaries ) ) requireRecomputed( trace[ key ], expected, `Performance ${ key }` );
	return Object.freeze( summaries );

}

export function bytesPerTexel( format ) {

	if ( format === 'rgba16float' ) return 8;
	if ( format === 'rgba8unorm' || format === 'rgba8' ) return 4;
	if ( format === 'depth32float' ) return 4;
	throw new Error( `Runtime v2 assembler does not know the byte width of ${ format }.` );

}

function tagMeasuredNumbers( value, source ) {

	if ( typeof value === 'number' ) return M( value, 'layout value', source );
	if ( Array.isArray( value ) ) return value.map( ( entry ) => tagMeasuredNumbers( entry, source ) );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.entries( value ).map( ( [ key, entry ] ) => [ key, tagMeasuredNumbers( entry, `${ source}.${ key }` ) ] ) );
	return value;

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

		record.actualRendererReturn = {
			layout: observed.sourceLayout,
			bytesPerRow: M( observed.sourceBytesPerRow, 'byte', 'renderer-returned WebGPU copy layout' ),
			byteLength: M( observed.sourceByteLength, 'byte', 'renderer-returned mapped WebGPU copy' )
		};
		record.browserTransport = {
			layout: observed.transportLayout?.layout ?? 'unavailable',
			bytesPerRow: M( observed.transportLayout?.bytesPerRow ?? observed.sourceBytesPerRow, 'byte', 'shared runner retained transport layout' ),
			byteLength: M( observed.transportByteLength, 'byte', 'shared runner retained transport artifact' )
		};
		record.requestedCopyLayout = tagMeasuredNumbers( observed.requestedLayout, 'requested WebGPU copy layout' );
		record.cpuNormalizedArtifact = {
			layout: observed.normalizedLayout?.format ?? 'rgba8unorm',
			bytesPerRow: M( observed.normalizedBytesPerRow, 'byte', 'CPU-normalized 256-byte-aligned artifact row stride' ),
			byteLength: M( observed.normalizedByteLength, 'byte', 'CPU-normalized retained padded artifact' )
		};
		record.controllerNormalization = tagMeasuredNumbers( observed.controllerNormalized, 'LabController normalization evidence' );

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

function hasNativeWebGpuIdentity( metrics ) {

	return metrics?.nativeWebGPU === true || metrics?.backend?.isWebGPUBackend === true || metrics?.backend === 'WebGPU';

}

function runtimeDeviceErrors( metrics ) {

	return [
		...( Array.isArray( metrics?.uncapturedErrors ) ? metrics.uncapturedErrors : [] ),
		...( Array.isArray( metrics?.deviceErrors ) ? metrics.deviceErrors : [] ),
		...( metrics?.lastDeviceError ? [ metrics.lastDeviceError ] : [] )
	].map( String );

}

export function summarizeLifecycleEvidence( lifecycle ) {

	if ( lifecycle === null || typeof lifecycle !== 'object' ) return null;
	const cycles = lifecycle.cycles;
	if ( Number.isInteger( cycles ) === false || cycles < 50 || cycles > 100 ) throw new Error( 'Runtime lifecycle evidence must cover an integer 50-100 cycles.' );
	if ( Array.isArray( lifecycle.snapshots ) === false || lifecycle.snapshots.length !== cycles ) throw new Error( 'Runtime lifecycle snapshot count must equal the declared cycle count.' );

	const cycleSnapshots = lifecycle.snapshots.map( ( snapshot, index ) => {

		if ( snapshot?.cycle !== index ) throw new Error( `Runtime lifecycle cycle ${ index } is missing or out of order.` );
		if ( snapshot.rowType !== 'settled-lifecycle-cycle-v2' ) throw new Error( `Runtime lifecycle cycle ${ index } is not a typed settled row.` );
		if ( snapshot.dispose?.status !== 'PASS' || snapshot.dispose?.completed !== true || snapshot.dispose?.error !== null ) throw new Error( `Runtime lifecycle cycle ${ index } dispose failed.` );
		if (
			snapshot.settle?.status !== 'PASS' ||
			snapshot.settle?.policyAnimationFrames !== 2 ||
			snapshot.settle?.observedAnimationFrames < 2 ||
			snapshot.settle?.queueSettled !== true
		) throw new Error( `Runtime lifecycle cycle ${ index } did not complete the observed post-disposal settle.` );
		if ( Array.isArray( snapshot.settle?.delayedErrors ) === false || snapshot.settle.delayedErrors.length > 0 ) throw new Error( `Runtime lifecycle cycle ${ index } contains delayed post-dispose errors.` );
		const disposeEvidence = snapshot.dispose.evidence;
		if ( disposeEvidence?.queueSettlement?.status !== 'PASS' ) throw new Error( `Runtime lifecycle cycle ${ index } did not settle its actual GPU queue.` );
		if ( disposeEvidence?.deviceDestroy?.status !== 'PASS' || disposeEvidence.deviceDestroy.intentionalDestroyObserved !== true ) throw new Error( `Runtime lifecycle cycle ${ index } did not observe intentional owned-device destruction.` );
		if ( disposeEvidence.listenersAfterDispose !== 0 ) throw new Error( `Runtime lifecycle cycle ${ index } retained runtime listeners after disposal.` );
		const beforeControls = snapshot.beforeDispose?.lifecycleState?.activeControls;
		const beforeMaterials = snapshot.beforeDispose?.lifecycleState?.activeMaterials;
		const retainedControls = snapshot.afterDispose?.lifecycleState?.activeControls;
		const retainedMaterials = snapshot.afterDispose?.lifecycleState?.activeMaterials;
		for ( const [ value, label ] of [
			[ beforeControls, 'before controls' ],
			[ beforeMaterials, 'before materials' ],
			[ retainedControls, 'retained controls' ],
			[ retainedMaterials, 'retained materials' ]
		] ) if ( Number.isInteger( value ) === false || value < 0 ) throw new Error( `Runtime lifecycle cycle ${ index } has an invalid ${ label } registry count.` );
		if ( beforeMaterials < 1 ) throw new Error( `Runtime lifecycle cycle ${ index } did not observe the subject material registry before disposal.` );
		if ( retainedControls !== 0 || retainedMaterials !== 0 ) throw new Error( `Runtime lifecycle cycle ${ index } retained controls or materials after disposal.` );
		if ( disposeEvidence.controlsAfterDispose !== retainedControls || disposeEvidence.materialsAfterDispose !== retainedMaterials ) throw new Error( `Runtime lifecycle cycle ${ index } disposal registry evidence disagrees with the settled snapshot.` );
		const rendererStateDisposition = snapshot.afterDispose?.lifecycleState?.rendererStateDisposition;
		if ( rendererStateDisposition !== 'OWNED_RENDERER_DISPOSED' || disposeEvidence.rendererStateDisposition !== rendererStateDisposition ) throw new Error( `Runtime lifecycle cycle ${ index } has no truthful owned-renderer disposal disposition.` );
		for ( const [ state, label ] of [
			[ snapshot.beforeDispose?.rendererState, 'before-disposal renderer state' ],
			[ snapshot.afterDispose?.rendererState, 'after-disposal renderer state' ]
		] ) if ( state === null || typeof state !== 'object' || Array.isArray( state ) ) throw new Error( `Runtime lifecycle cycle ${ index } omits its ${ label } snapshot.` );
		const rendererStateBeforeDigest = digest( canonicalize( snapshot.beforeDispose.rendererState ) );
		const rendererStateAfterDigest = digest( canonicalize( snapshot.afterDispose.rendererState ) );
		const controllerGeneration = snapshot.beforeDispose?.controllerGeneration;
		const rendererDeviceGeneration = snapshot.beforeDispose?.backend?.rendererDeviceGeneration;
		if (
			Number.isInteger( controllerGeneration ) === false || controllerGeneration < 1 ||
			Number.isInteger( rendererDeviceGeneration ) === false || rendererDeviceGeneration < 1 ||
			disposeEvidence.controllerGeneration !== controllerGeneration ||
			disposeEvidence.rendererDeviceGeneration !== rendererDeviceGeneration ||
			snapshot.afterDispose?.controllerGeneration !== controllerGeneration ||
			snapshot.afterDispose?.backend?.rendererDeviceGeneration !== rendererDeviceGeneration
		) throw new Error( `Runtime lifecycle cycle ${ index } generation identity drifted across disposal.` );
		if ( snapshot.beforeDispose?.listenerState?.runtimeEventListeners !== 1 || snapshot.afterDispose?.listenerState?.runtimeEventListeners !== 0 ) throw new Error( `Runtime lifecycle cycle ${ index } listener census did not close.` );
		if ( hasNativeWebGpuIdentity( snapshot.beforeDispose ) === false ) throw new Error( `Runtime lifecycle cycle ${ index } did not initialize native WebGPU.` );
		if ( hasNativeWebGpuIdentity( snapshot.afterDispose ) === false ) throw new Error( `Runtime lifecycle cycle ${ index } lost its backend identity before post-disposal measurement.` );
		const deviceLossObserved = snapshot.beforeDispose.deviceLostObserved === true || snapshot.afterDispose.deviceLostObserved === true || ( snapshot.beforeDispose.deviceLossGeneration ?? 0 ) !== 0 || ( snapshot.afterDispose.deviceLossGeneration ?? 0 ) !== 0;
		if ( deviceLossObserved ) throw new Error( `Runtime lifecycle cycle ${ index } observed device loss.` );
		const postDisposeErrorCount = snapshot.settle.delayedErrors.length + runtimeDeviceErrors( snapshot.afterDispose ).length;
		if ( runtimeDeviceErrors( snapshot.beforeDispose ).length > 0 || postDisposeErrorCount > 0 ) throw new Error( `Runtime lifecycle cycle ${ index } contains a device error.` );
		const beforeMemory = rendererMemory( snapshot.beforeDispose, `lifecycle cycle ${ index } beforeDispose` );
		const afterMemory = rendererMemory( snapshot.afterDispose, `lifecycle cycle ${ index } afterDispose` );
		const beforeCounters = finiteNonnegativeCounters( beforeMemory, `lifecycle cycle ${ index } beforeDispose.rendererInfo.memory` );
		const afterCounters = finiteNonnegativeCounters( afterMemory, `lifecycle cycle ${ index } afterDispose.rendererInfo.memory` );
		const nonzeroAfter = afterCounters.filter( ( [ , value ] ) => value !== 0 );
		if ( nonzeroAfter.length > 0 ) throw new Error( `Runtime lifecycle cycle ${ index } retained renderer memory after disposal: ${ nonzeroAfter.map( ( [ name ] ) => name ).join( ', ' ) }.` );
		const beforeRendererBytes = beforeMemory.total;
		const afterRendererBytes = afterMemory.total;
		if ( Number.isFinite( beforeRendererBytes ) === false || Number.isFinite( afterRendererBytes ) === false ) throw new Error( `Runtime lifecycle cycle ${ index } is missing renderer-memory totals.` );
		if ( snapshot.resourcesAfterDispose?.captureError ) throw new Error( `Runtime lifecycle cycle ${ index } could not inspect resources after disposal.` );
		const targetBytes = resourceBytes( snapshot.resourcesBeforeDispose, 'renderTargets' );
		const storageBytes = resourceBytes( snapshot.resourcesBeforeDispose, 'storageResources' );
		const retainedTargetBytes = resourceBytes( snapshot.resourcesAfterDispose, 'renderTargets' );
		const retainedStorageBytes = resourceBytes( snapshot.resourcesAfterDispose, 'storageResources' );
		if ( retainedTargetBytes !== 0 || retainedStorageBytes !== 0 || ( snapshot.resourcesAfterDispose.trackedRenderTargetBytes ?? 0 ) !== 0 ) throw new Error( `Runtime lifecycle cycle ${ index } retained resources after disposal.` );
		return {
			rowType: snapshot.rowType,
			cycle: index,
			beforeRendererBytes,
			afterRendererBytes,
			targetBytes,
			storageBytes,
			retainedTargetBytes,
			retainedStorageBytes,
			retainedListenerCount: snapshot.afterDispose.listenerState.runtimeEventListeners,
			retainedControlCount: retainedControls,
			retainedMaterialCount: retainedMaterials,
			postDisposeErrorCount,
			rendererStateDisposition,
			rendererStateBeforeDigest,
			rendererStateAfterDigest,
			deviceLossObserved,
			settleAnimationFrames: snapshot.settle.observedAnimationFrames,
			disposeStatus: snapshot.dispose.status,
			beforeCounterCount: beforeCounters.length
		};

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

function requireAdapterClass( adapterClass ) {

	if ( ADAPTER_CLASSES.has( adapterClass ) === false ) throw new Error( `Unknown adapter class "${ adapterClass }".` );
	return adapterClass;

}

export function classifyPerformanceTrace( trace, gates, adapterClass = trace?.adapterClass ?? 'unknown' ) {

	if ( trace === null ) return 'NOT_CLAIMED';
	requireAdapterClass( adapterClass );
	const recomputed = recomputePerformanceTrace( trace );
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
	if ( adapterClass !== 'hardware' ) return 'INSUFFICIENT_EVIDENCE';
	if ( recomputed.cpuP95 > gates.cpuP95 || recomputed.gpuP95 > gates.gpuP95 || recomputed.deadlineMissRatio > gates.deadlineMissRatio ) return 'FAIL';
	return 'PASS';

}

export function classifyGpuStageAttribution( trace, reconciliationGateMs = 0.001 ) {

	if ( trace === null || trace.gpuStageSamples === undefined ) return 'INSUFFICIENT_EVIDENCE';
	const adapterClass = requireAdapterClass( trace.adapterClass ?? 'unknown' );
	if ( Number.isInteger( trace.sampleFrames ) === false || trace.sampleFrames <= 0 ) throw new Error( 'GPU attribution requires a positive sampleFrames count.' );
	for ( const id of [ 'scene-mrt', 'final-output' ] ) {

		const samples = trace.gpuStageSamples[ id ];
		if ( Array.isArray( samples ) === false || samples.length !== trace.sampleFrames ) throw new Error( `${ id } attribution sample count must equal sampleFrames.` );
		if ( samples.some( ( value ) => Number.isFinite( value ) === false || value < 0 ) ) throw new Error( `${ id } attribution samples must be finite and nonnegative.` );

	}
	if ( Array.isArray( trace.timestampRows ) === false || trace.timestampRows.length !== trace.sampleFrames ) throw new Error( 'GPU attribution requires one explicit timestamp row per frame.' );
	for ( let index = 0; index < trace.timestampRows.length; index ++ ) {

		const row = trace.timestampRows[ index ];
		for ( const key of [ 'frameId', 'sceneUid', 'outputUid', 'sceneMs', 'outputMs', 'totalMs', 'totalProvenance', 'independentPerFrameTotalAvailable' ] ) if ( Object.hasOwn( row, key ) === false ) throw new Error( `GPU timestamp row ${ index } omits ${ key }.` );
		if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) throw new Error( `GPU timestamp row ${ index } overclaims an independent per-frame total.` );
		if ( row.sceneMs !== trace.gpuStageSamples[ 'scene-mrt' ][ index ] || row.outputMs !== trace.gpuStageSamples[ 'final-output' ][ index ] ) throw new Error( `GPU timestamp row ${ index } disagrees with stage populations.` );
		const total = row.sceneMs + row.outputMs;
		requireRecomputed( row.totalMs, total, `GPU timestamp row ${ index } total` );
		requireRecomputed( trace.gpuSamples[ index ], total, `GPU timestamp row ${ index } frame population` );

	}
	for ( const id of [ 'scene-mrt', 'final-output' ] ) {

		requireRecomputed( trace.gpuStageP50[ id ], percentile( trace.gpuStageSamples[ id ], 0.5 ), `${ id } p50` );
		requireRecomputed( trace.gpuStageP95[ id ], percentile( trace.gpuStageSamples[ id ], 0.95 ), `${ id } p95` );

	}
	requireRecomputed( trace.gpuP50, percentile( trace.gpuSamples, 0.5 ), 'GPU total p50' );
	requireRecomputed( trace.gpuP95, percentile( trace.gpuSamples, 0.95 ), 'GPU total p95' );
	if ( trace.independentPerFrameTotalsAvailable !== false ) throw new Error( 'Three r185 does not expose independent totals for every frame; attribution must remain Derived.' );
	if ( Number.isFinite( trace.lastFrameResolveResidualMs ) === false || trace.lastFrameResolveResidualMs < 0 ) throw new Error( 'GPU attribution requires the final-frame resolve residual.' );
	if ( trace.lastFrameResolveResidualMs > reconciliationGateMs ) return 'FAIL';
	return adapterClass === 'hardware' ? 'PASS' : 'INSUFFICIENT_EVIDENCE';

}

export function classifyGovernorTrace( trace ) {

	if ( trace === null ) return 'NOT_CLAIMED';
	if ( Number.isInteger( trace.windowCount ) === false || trace.windowCount < 6 ) throw new Error( 'Governor trace requires at least six windows.' );
	if ( Array.isArray( trace.windows ) === false || trace.windows.length !== trace.windowCount ) throw new Error( 'Governor window count drifted.' );
	if ( trace.windows.some( ( window ) => Number.isFinite( window.gpuP95 ) === false || window.gpuP95 < 0 ) ) throw new Error( 'Governor windows require finite nonnegative GPU p95 values.' );
	for ( const [ index, window ] of trace.windows.entries() ) {

		finitePopulation( window.gpuSamples, `Governor window ${ index } GPU population` );
		requireRecomputed( window.gpuP95, percentile( window.gpuSamples, 0.95 ), `Governor window ${ index } GPU p95` );
		if ( Array.isArray( window.timestampRows ) === false || window.timestampRows.length !== window.gpuSamples.length ) throw new Error( `Governor window ${ index } timestamp rows do not cover its GPU population.` );
		for ( let frame = 0; frame < window.timestampRows.length; frame ++ ) requireRecomputed( window.gpuSamples[ frame ], window.timestampRows[ frame ].sceneMs + window.timestampRows[ frame ].outputMs, `Governor window ${ index} frame ${ frame } total` );
		if ( Number.isFinite( window.lastFrameResolveResidualMs ) === false || window.lastFrameResolveResidualMs > 0.001 ) throw new Error( `Governor window ${ index } final-frame timestamp resolve does not reconcile.` );

	}
	if ( Array.isArray( trace.transitions ) === false ) throw new Error( 'Governor transitions must be an array.' );
	if ( Number.isInteger( trace.cooldownWindows ) === false || trace.cooldownWindows < 0 ) throw new Error( 'Governor cooldown must be a nonnegative integer.' );
	if ( Number.isFinite( trace.targetMs ) === false || trace.targetMs <= 0 ) throw new Error( 'Governor target must be finite and positive.' );
	for ( const key of [ 'meanRgbByteDifference', 'edgeP95RgbByteDifference' ] ) if ( Number.isFinite( trace.visualErrorGates?.[ key ] ) === false || trace.visualErrorGates[ key ] < 0 ) throw new Error( `Governor ${ key } gate must be finite and nonnegative.` );
	const settledVisualError = trace.visualErrorByTier?.[ trace.settledState ];
	for ( const key of [ 'meanRgbByteDifference', 'edgeMaskPixels', 'edgeMeanRgbByteDifference', 'edgeP95RgbByteDifference' ] ) if ( Number.isFinite( settledVisualError?.[ key ] ) === false || settledVisualError[ key ] < 0 ) throw new Error( `Governor settled tier requires a finite nonnegative ${ key }.` );
	for ( const transition of trace.transitions ) for ( const key of [ 'rebuildCpuSubmissionMs', 'rebuildGpuMs', 'fromResourceBytes', 'toResourceBytes' ] ) {

		if ( Number.isFinite( transition[ key ] ) === false || transition[ key ] < 0 ) throw new Error( `Governor transition ${ key } must be finite and nonnegative.` );

	}
	for ( const transition of trace.transitions ) {

		const window = trace.windows[ transition.window ];
		if ( window?.measuredTier !== transition.from || window?.tier !== transition.to ) throw new Error( 'Governor transition tier lineage does not match its measurement window.' );
		requireRecomputed( transition.gpuP95, window.gpuP95, 'Governor transition triggering p95' );
		if ( transition.rebuildTimestampRow === null || typeof transition.rebuildTimestampRow !== 'object' ) throw new Error( 'Governor transition lacks its attributed rebuild row.' );
		requireRecomputed( transition.rebuildGpuMs, transition.rebuildTimestampRow.sceneMs + transition.rebuildTimestampRow.outputMs, 'Governor transition rebuild GPU total' );
		if ( Number.isFinite( transition.lastFrameResolveResidualMs ) === false || transition.lastFrameResolveResidualMs > 0.001 ) throw new Error( 'Governor transition rebuild timestamp does not reconcile.' );

	}
	const adapterClass = requireAdapterClass( trace.adapterClass ?? 'unknown' );
	if ( trace.oscillationDetected === true ) return 'FAIL';
	const finalTransition = trace.transitions.at( - 1 );
	if ( finalTransition && finalTransition.window > trace.windowCount - trace.cooldownWindows - 1 ) return 'INSUFFICIENT_EVIDENCE';
	const finalWindow = trace.windows.at( - 1 );
	if ( finalWindow.measuredTier !== trace.settledState ) return 'INSUFFICIENT_EVIDENCE';
	if (
		finalWindow.gpuP95 > trace.targetMs ||
		settledVisualError.meanRgbByteDifference > trace.visualErrorGates.meanRgbByteDifference ||
		settledVisualError.edgeP95RgbByteDifference > trace.visualErrorGates.edgeP95RgbByteDifference
	) return 'FAIL';
	if ( adapterClass !== 'hardware' ) return 'INSUFFICIENT_EVIDENCE';
	return 'PASS';

}

export function classifyPerformanceCompliance( performanceVerdict, governorVerdict ) {

	const verdicts = new Set( [ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED' ] );
	if ( verdicts.has( performanceVerdict ) === false || verdicts.has( governorVerdict ) === false ) throw new Error( 'Performance compliance requires valid performance and governor verdicts.' );
	if ( performanceVerdict === 'FAIL' || governorVerdict === 'FAIL' ) return 'FAIL';
	if ( performanceVerdict === 'PASS' && governorVerdict === 'PASS' ) return 'PASS';
	if ( performanceVerdict === 'NOT_CLAIMED' && governorVerdict === 'NOT_CLAIMED' ) return 'NOT_CLAIMED';
	return 'INSUFFICIENT_EVIDENCE';

}

export function classifyMechanismProof( proof, diagnosticDifferences, pipeline ) {

	if ( proof === null || proof === undefined ) return 'INSUFFICIENT_EVIDENCE';
	if ( proof.proofKind !== 'native-browser-runtime' ) throw new Error( 'Mechanism proof must come from the native browser runtime.' );
	if ( Array.isArray( proof.routeExecutions ) === false || proof.routeExecutions.length !== MECHANISM_MODES.length ) throw new Error( 'Mechanism proof must execute every output route exactly once.' );
	const routeIds = new Set();
	for ( const mode of MECHANISM_MODES ) {

		const execution = proof.routeExecutions.find( ( entry ) => entry.mode === mode );
		if ( ! execution ) throw new Error( `Mechanism proof did not execute ${ mode }.` );
		if ( execution.outputNodeId !== `${ mode }-output-node` || execution.selectedOutputNodeId !== execution.outputNodeId ) throw new Error( `Mechanism ${ mode } output-node identity drifted.` );
		if ( execution.selectedOutputNodeIdentityVerified !== true ) throw new Error( `Mechanism ${ mode } did not select its actual TSL output node.` );
		if ( execution.graphMarkedDirtyBeforeRender !== true ) throw new Error( `Mechanism ${ mode } did not mark the RenderPipeline graph dirty.` );
		if ( execution.renderSubmissionDelta !== 1 || execution.renderSubmissionCountAfter - execution.renderSubmissionCountBefore !== 1 ) throw new Error( `Mechanism ${ mode } did not submit exactly one observed runtime render.` );
		routeIds.add( execution.outputNodeId );

	}
	if ( routeIds.size !== MECHANISM_MODES.length ) throw new Error( 'Mechanism routes do not own distinct output nodes.' );
	for ( const key of [ 'unknownModeRejected', 'modeStatePreserved', 'outputNodeIdentityPreserved' ] ) {

		if ( proof.negativeControls?.[ key ] !== true ) throw new Error( `Mechanism negative control ${ key } did not pass.` );

	}
	if ( typeof proof.negativeControls?.unknownModeError !== 'string' || /Unknown mode/.test( proof.negativeControls.unknownModeError ) === false ) throw new Error( 'Mechanism unknown-mode negative control lacks the runtime rejection reason.' );
	for ( const signal of [ 'output', 'normal', 'emissive', 'depth' ] ) if ( proof.reachableSignals?.includes( signal ) !== true ) throw new Error( `Mechanism proof cannot reach ${ signal }.` );
	for ( const resource of [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] ) if ( proof.reachableResources?.includes( resource ) !== true ) throw new Error( `Mechanism proof cannot reach ${ resource }.` );
	for ( const mode of [ 'normal', 'emissive' ] ) {

		const difference = diagnosticDifferences?.[ mode ];
		if ( Number.isFinite( difference ) === false || difference <= 1 ) throw new Error( `${ mode } diagnostic does not materially differ from final output.` );

	}
	const pipelineModes = Object.keys( pipeline?.captureRoutes ?? {} );
	if ( MECHANISM_MODES.some( ( mode ) => pipelineModes.includes( mode ) === false ) ) throw new Error( 'Runtime pipeline graph omits an executed mechanism route.' );
	return 'PASS';

}

function writeArtifacts( session, artifacts ) {

	return Promise.all( Object.entries( artifacts ).map( ( [ filename, artifact ] ) => {

		const contents = `${ JSON.stringify( artifact, null, 2 ) }\n`;
		return typeof session.writeArtifact === 'function'
			? session.writeArtifact( filename, contents )
			: writeFile( join( session.outputDir, filename ), contents );

	} ) );

}

export async function writeIncompleteV2RuntimeBundle( session, input ) {

	const { captures, runtime, diagnosticDifference, diagnosticDifferences = null } = input;
	const metrics = runtime.metrics;
	const pipeline = runtime.pipeline;
	const resources = runtime.resources;
	const gpuTiming = runtime.gpuTiming;
	const performanceTrace = runtime.performanceTrace;
	const governorTrace = runtime.governorTrace;
	const mechanismProof = runtime.mechanismProof;
	const lifecycle = summarizeLifecycleEvidence( runtime.lifecycle );
	const finalCapture = captures.find( ( capture ) => capture.filename === 'final.design.png' );
	const targetReadbackCapture = session.profile === 'performance'
		? captures.find( ( capture ) => capture.filename === 'final.performance.png' )
		: finalCapture;
	if ( ! finalCapture ) throw new Error( 'Runtime v2 assembler requires final.design.png capture metadata.' );
	if ( ! targetReadbackCapture ) throw new Error( 'Runtime v2 assembler requires capture metadata for the final resource state.' );
	if ( metrics.nativeWebGPU !== true || metrics.initialized !== true ) throw new Error( 'Runtime v2 assembler requires initialized native WebGPU metrics.' );
	if ( metrics.viewport.width !== session.profileConfig.width || metrics.viewport.height !== session.profileConfig.height || metrics.viewport.dpr !== session.profileConfig.dpr ) {

		throw new Error( 'Runtime v2 assembler received a noncanonical final viewport state.' );

	}
	const targetRate = 60;
	const targetIntervalMs = 1000 / targetRate;
	const performanceGates = {
		cpuP95: HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value,
		gpuP95: HARDWARE_PERFORMANCE_CONTRACT.gpuP95Maximum.value,
		deadlineMissRatio: HARDWARE_PERFORMANCE_CONTRACT.maximumDeadlineMissRatio.value
	};
	const adapterClass = requireAdapterClass( metrics.adapterClass ?? performanceTrace?.adapterClass ?? 'unknown' );
	if ( performanceTrace !== null && performanceTrace.adapterClass !== adapterClass ) throw new Error( 'Performance trace adapter class disagrees with the runtime adapter.' );
	const performanceVerdict = classifyPerformanceTrace( performanceTrace, performanceGates, adapterClass );
	const gpuAttributionVerdict = classifyGpuStageAttribution( performanceTrace );
	const governorVerdict = classifyGovernorTrace( governorTrace );
	const performanceComplianceVerdict = classifyPerformanceCompliance( performanceVerdict, governorVerdict );
	const mechanismVerdict = classifyMechanismProof( mechanismProof, diagnosticDifferences, pipeline );
	const hardwarePerformanceClaim = performanceTrace !== null && adapterClass === 'hardware';
	const candidateClaimVerdicts = {
		visualCorrectness: 'PASS',
		mechanismCorrectness: mechanismVerdict,
		performanceCompliance: performanceComplianceVerdict,
		gpuAttribution: gpuAttributionVerdict,
		lifecycleStability: lifecycle === null ? 'INSUFFICIENT_EVIDENCE' : 'PASS'
	};
	const pipelineGraph = createRuntimePipelineGraph( pipeline, resources );
	const pipelineGraphDigest = digest( canonicalize( pipelineGraph ) );
	const imageHashes = Object.fromEntries( VISUAL_SIGNOFF_IMAGES.map( ( filename ) => {

		const capture = captures.find( ( entry ) => entry.filename === filename );
		if ( typeof capture?.pngSha256 !== 'string' ) throw new Error( `Runtime v2 assembler is missing the retained PNG hash for ${ filename }.` );
		return [ filename, capture.pngSha256 ];

	} ) );
	const liveDeviceErrors = [
		...( metrics.uncapturedErrors ?? [] ),
		...( metrics.lastDeviceError ? [ metrics.lastDeviceError ] : [] ),
		...( metrics.deviceLostObserved ? [ 'GPU device loss observed' ] : [] )
	];
	const promotion = resolveBundlePromotion( {
		labId: session.lab.id,
		sourceClosureHash: session.sourceClosureHash ?? session.lab.sourceHash,
		buildRevision: session.buildRevision ?? 'unavailable-capture-build-revision',
		pipelineGraphDigest,
		captureProfile: session.profile,
		adapterClass,
		claimVerdicts: candidateClaimVerdicts,
		imageHashes,
		deviceState: {
			deviceLostObserved: metrics.deviceLostObserved === true,
			uncapturedErrors: metrics.uncapturedErrors ?? [],
			deviceErrors: liveDeviceErrors
		},
		visualSignoff: input.visualSignoff ?? session.visualSignoff ?? null
	} );
	const claimVerdicts = promotion.claimVerdicts;
	const knownCompromises = [
		...( performanceTrace === null
			? [ 'Correctness capture only; no sustained performance window was run.' ]
			: [ 'A sustained CPU/GPU/cadence trace with scene-MRT and final-output attribution was captured.' ] ),
		...( governorTrace === null ? [ 'The quality governor was not exercised.' ] : [] ),
		...( performanceTrace === null ? [ 'One resolved render timestamp proves availability but not per-stage GPU attribution.' ] : [] ),
		...( lifecycle === null ? [ 'No lifecycle create/render/resize/mode/tier/dispose loop was run.' ] : [] ),
		...( promotion.promotion.status !== 'APPROVED' ? [ 'Authored direct visual signoff is absent; visualCorrectness remains INSUFFICIENT_EVIDENCE.' ] : [] ),
		...( adapterClass === 'software' ? [ 'Software-adapter timestamps are retained only as diagnostic data and cannot support a hardware performance claim.' ] : [] ),
		performanceTrace === null
			? 'Owned adapter identity, features, and limits are serialized; physical display refresh and presentation cadence were not measured by this profile.'
			: 'Owned adapter identity, features, and limits are serialized; physical display refresh remains unmeasured while requestAnimationFrame cadence is measured separately.'
	];
	const visualContract = schema( {
		contractRevision: 'webgpu-validation-runtime-v2-1',
		subject: 'native WebGPU validation subject',
		identity: [ session.lab.id, session.lab.sourceHash, session.profile, metrics.tier ],
		invariants: [ {
			id: 'diagnostic-route-separation',
			statement: 'The diagnostic mosaic is assembled from live final, no-post, normal, and emissive output-node captures.',
			domain: 'image',
			truthSource: 'capture hook render-target readbacks',
			diagnostic: 'diagnostics.mosaic.png',
			metric: 'mean RGB byte difference from final',
			gate: G( 1, 'mean-rgb-byte-difference', 'frozen minimum diagnostic separation' ),
			requiredArtifacts: [ 'pipeline-graph.json', 'final.design.png', 'diagnostics.mosaic.png' ],
			blockingFailure: 'diagnostic routes collapse to final output'
		} ],
		requiredImages: [ ...REQUIRED_V2_IMAGES, 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
		requiredDiagnostics: [ 'final', 'no-post', 'normal', 'emissive', 'near/design/far', 'seed pair', 'temporal pair' ],
		requiredMetrics: [ 'native backend', 'readback layout', 'pipeline owners', 'resource inventory', 'claim-separated verdicts' ],
		blockingFailures: [ 'non-WebGPU backend', 'unlabelled numeric', 'bad padded stride', 'false diagnostic route', 'publishable incomplete claims' ],
		allowedDivergences: knownCompromises,
		performanceClaims: {
			gpuTimingRequirement: hardwarePerformanceClaim ? 'required' : 'not-claimed',
			claims: hardwarePerformanceClaim ? [ 'named current-hardware-adapter total-frame performance at 1920x1080 DPR 1' ] : []
		},
		imageComparisons: [
			{
				id: 'diagnostic-runtime-transport',
				baseline: 'final.design.png',
				candidate: 'diagnostics.mosaic.png',
				maxDifferingRatio: G( 1, 'ratio', 'structural ceiling; minimum separation is validated independently' )
			},
			... [ 'normal', 'emissive' ].map( ( route ) => ( {
				id: `${ route }-runtime-route`,
				baseline: 'final.design.png',
				candidate: `diagnostic.${ route }.png`,
				maxDifferingRatio: G( 1, 'ratio', 'structural ceiling; mechanism metrics enforce minimum separation' )
			} ) )
		]
	} );
	const adapterInfo = Object.fromEntries( Object.entries( metrics.adapter?.info ?? {} ).map( ( [ key, value ] ) => [ key, typeof value === 'number' ? M( value, 'adapter property', metrics.adapter.identitySource ) : value ] ) );
	const adapterLimits = Object.fromEntries( Object.entries( metrics.adapter?.limits ?? {} ).map( ( [ key, value ] ) => [ key, M( value, 'limit unit', metrics.adapter.identitySource ) ] ) );
	const rendererInfo = schema( {
		threeRevision: '0.185.1',
		renderer: metrics.rendererState.renderer,
		backend: 'WebGPU',
		captureProfile: session.profile,
		adapterClass,
		outputColorSpace: metrics.rendererState.outputColorSpace,
		toneMapping: metrics.rendererState.toneMapping,
		toneMappingExposure: M( metrics.rendererState.toneMappingExposure, 'ratio', 'live renderer state' ),
		sampleCount: M( metrics.rendererState.sampleCount, 'sample/pixel', 'live renderer state' ),
		depthMode: metrics.rendererState.depthMode,
		outputBufferType: metrics.rendererState.outputBufferType,
		compatibilityMode: metrics.rendererState.compatibilityMode,
		timestampSupport: gpuTiming.verdict === 'PASS',
		adapterInfo: { ...adapterInfo, identitySource: metrics.adapter?.identitySource ?? 'unavailable' },
		adapterFeatures: metrics.adapter?.features ?? [],
		adapterLimits,
		initializationState: 'await renderer.init completed; backend.isWebGPUBackend true',
		deviceLostObserved: metrics.deviceLostObserved === true,
		uncapturedErrors: [ ...( metrics.uncapturedErrors ?? [] ) ],
		deviceErrors: liveDeviceErrors,
		rendererInfoSnapshots: [ {
			source: 'LabController.getMetrics.rendererInfo',
			serializationPolicy: metrics.rendererInfo.serialization.policy,
			numericCounters: 'retained in capture-session.json; not promoted without per-counter provenance'
		} ]
	} );
	const refreshPeriod = D( targetIntervalMs, 'ms', '1000 / authored 60 Hz correctness target' );
	const performanceEnvelope = schema( {
		gpuTimingRequirement: hardwarePerformanceClaim ? 'required' : 'not-claimed',
		refreshPeriod,
		browserMainThreadReserve: A( 1, 'ms', 'authored target envelope' ),
		compositorGpuReserve: A( 1, 'ms', 'authored target envelope' ),
		cpuSafetyReserve: A( 1, 'ms', 'authored target envelope' ),
		gpuSafetyReserve: A( 1, 'ms', 'authored target envelope' ),
		cpuSceneEnvelope: D( performanceGates.cpuP95, 'ms', 'exact 60 Hz refresh period - browser reserve - CPU reserve' ),
		gpuSceneEnvelope: D( performanceGates.gpuP95, 'ms', 'exact 60 Hz refresh period - compositor reserve - GPU reserve' ),
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
		captureProfile: session.profile,
		adapterClass,
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
		sampleFrames: performanceTrace === null ? null : M( performanceTrace.sampleFrames, 'frame', 'sustained batch population' ),
		timestampResolveCount: performanceTrace === null ? null : M( performanceTrace.timestampResolveCount, 'resolve', 'batched timestamp resolution count' ),
		timestampMappingCadence: performanceTrace?.timestampMappingCadence ?? 'not-claimed',
		gpuSamples: gpuSamples.length === 0 ? null : DA( gpuSamples, 'ms', 'sum of two measured render-context timestamps per sustained frame' ),
		gpuP50: gpuSamples.length === 0 ? null : D( percentile( gpuSamples, 0.5 ), 'ms', 'p50 of derived sustained frame totals' ),
		gpuP95: gpuSamples.length === 0 ? null : D( percentile( gpuSamples, 0.95 ), 'ms', 'p95 of derived sustained frame totals' ),
		gpuStageAttribution: performanceTrace === null ? null : {
			'scene-mrt': {
				samples: MA( performanceTrace.gpuStageSamples[ 'scene-mrt' ], 'ms', 'resolved r185 render-context timestamps' ),
				p50: D( performanceTrace.gpuStageP50[ 'scene-mrt' ], 'ms', 'p50 of scene MRT timestamp samples' ),
				p95: D( performanceTrace.gpuStageP95[ 'scene-mrt' ], 'ms', 'p95 of scene MRT timestamp samples' )
			},
			'final-output': {
				samples: MA( performanceTrace.gpuStageSamples[ 'final-output' ], 'ms', 'resolved r185 render-context timestamps' ),
				p50: D( performanceTrace.gpuStageP50[ 'final-output' ], 'ms', 'p50 of final-output timestamp samples' ),
				p95: D( performanceTrace.gpuStageP95[ 'final-output' ], 'ms', 'p95 of final-output timestamp samples' )
			},
			timestampRows: performanceTrace.timestampRows.map( ( row ) => timestampEvidenceRow( row, 'sustained timestamp batch' ) ),
			lastFrameResolveResidual: D( performanceTrace.lastFrameResolveResidualMs, 'ms', 'Three r185 final-frame aggregate minus the final attributed stage sum' ),
			reconciliationGate: G( 0.001, 'ms', 'frozen timestamp-sum tolerance' ),
			reconciliationScope: performanceTrace.timestampReconciliationScope,
			independentPerFrameTotalsAvailable: false,
			verdict: gpuAttributionVerdict
		},
		excludedPhases: performanceTrace === null
			? [ 'renderer initialization', 'pipeline compilation', 'readback mapping', 'PNG encoding', 'no sustained timing window' ]
			: [ 'renderer initialization', 'pipeline compilation', 'PNG encoding', 'timestamp readback excluded from CPU render samples', 'timestamp resolution and mapping deferred until after cadence sampling' ]
	} );
	const qualityGovernor = governorTrace === null ? schema( {
		enabled: false,
		states: [ metrics.tier ],
		inputMetric: 'none in correctness capture',
		filter: 'none',
		hysteresis: A( 0, 'ms', 'quality governor not exercised' ),
		minimumResidence: A( 0, 'window', 'quality governor not exercised' ),
		cooldown: A( 0, 'window', 'quality governor not exercised' ),
		windows: [],
		transitions: [],
		settledState: metrics.tier,
		oscillationDetected: false,
		verdict: 'NOT_CLAIMED'
	} ) : schema( {
		enabled: true,
		states: governorTrace.states,
		inputMetric: 'resolved total-render GPU timestamp p95',
		filter: `${ governorTrace.framesPerWindow }-frame percentile window`,
		target: G( governorTrace.targetMs, 'ms', '60 Hz scene budget after reserves' ),
		hysteresis: G( governorTrace.hysteresisMs, 'ms', 'frozen upgrade margin' ),
		minimumResidence: G( governorTrace.minimumResidenceWindows, 'window', 'frozen transition residence' ),
		cooldown: G( governorTrace.cooldownWindows, 'window', 'frozen post-transition cooldown' ),
		windows: governorTrace.windows.map( ( window ) => ( {
			window: M( window.window, 'window', 'measured governor sequence' ),
			measuredTier: window.measuredTier,
			resultingTier: window.tier,
			gpuSamples: DA( window.gpuSamples, 'ms', 'sum of measured render-context timestamps in governor window' ),
			gpuP95: D( window.gpuP95, 'ms', 'p95 of derived governor frame totals' ),
			timestampRows: window.timestampRows.map( ( row ) => timestampEvidenceRow( row, `governor window ${ window.window } timestamp batch` ) ),
			lastFrameResolveResidual: D( window.lastFrameResolveResidualMs, 'ms', 'Three r185 final-frame aggregate minus final governor-window stage sum' ),
			visualError: M( governorTrace.visualErrorByTier[ window.measuredTier ].meanRgbByteDifference, 'mean-rgb-byte-difference', 'fixed tier render-target comparison' ),
			visualErrorGate: G( governorTrace.visualErrorGates.meanRgbByteDifference, 'mean-rgb-byte-difference', 'frozen whole-frame tier-degradation gate' ),
			edgeMaskPixels: M( governorTrace.visualErrorByTier[ window.measuredTier ].edgeMaskPixels, 'pixel', 'reference-gradient edge mask' ),
			edgeMeanVisualError: M( governorTrace.visualErrorByTier[ window.measuredTier ].edgeMeanRgbByteDifference, 'mean-rgb-byte-difference', 'reference-edge-mask tier comparison' ),
			edgeP95VisualError: M( governorTrace.visualErrorByTier[ window.measuredTier ].edgeP95RgbByteDifference, 'mean-rgb-byte-difference', 'reference-edge-mask tier comparison' ),
			edgeP95VisualErrorGate: G( governorTrace.visualErrorGates.edgeP95RgbByteDifference, 'mean-rgb-byte-difference', 'frozen reference-edge p95 tier-degradation gate' ),
			decision: window.decision,
			residence: M( window.residence, 'window', 'governor state counter' ),
			cooldown: M( window.cooldown, 'window', 'governor cooldown counter' )
		} ) ),
		transitions: governorTrace.transitions.map( ( transition ) => ( {
			window: M( transition.window, 'window', 'governor transition record' ),
			from: transition.from,
			to: transition.to,
			cause: transition.cause,
			gpuP95: M( transition.gpuP95, 'ms', 'triggering governor window' ),
			rebuildCpuSubmission: M( transition.rebuildCpuSubmissionMs, 'ms', 'first render after tier transition' ),
			rebuildGpu: M( transition.rebuildGpuMs, 'ms', 'first attributed GPU frame after tier transition' ),
			rebuildTimestampRow: timestampEvidenceRow( transition.rebuildTimestampRow, `governor transition ${ transition.window } rebuild` ),
			lastFrameResolveResidual: D( transition.lastFrameResolveResidualMs, 'ms', 'Three r185 rebuild-frame aggregate minus attributed stage sum' ),
			fromResourceBytes: M( transition.fromResourceBytes, 'byte', 'render-target ledger before transition' ),
			toResourceBytes: M( transition.toResourceBytes, 'byte', 'render-target ledger after transition' )
		} ) ),
		finalStableGpuP95: M( governorTrace.windows.at( - 1 ).gpuP95, 'ms', 'final governor window' ),
		finalStableVisualError: M( governorTrace.visualErrorByTier[ governorTrace.settledState ].meanRgbByteDifference, 'mean-rgb-byte-difference', 'fixed settled-tier render-target comparison' ),
		visualErrorGate: G( governorTrace.visualErrorGates.meanRgbByteDifference, 'mean-rgb-byte-difference', 'frozen whole-frame tier-degradation gate' ),
		finalStableEdgeP95VisualError: M( governorTrace.visualErrorByTier[ governorTrace.settledState ].edgeP95RgbByteDifference, 'mean-rgb-byte-difference', 'reference-edge-mask settled-tier comparison' ),
		edgeP95VisualErrorGate: G( governorTrace.visualErrorGates.edgeP95RgbByteDifference, 'mean-rgb-byte-difference', 'frozen reference-edge p95 tier-degradation gate' ),
		settledState: governorTrace.settledState,
		oscillationDetected: governorTrace.oscillationDetected,
		verdict: governorVerdict
	} );
	const targets = resources.renderTargets.map( ( target ) => targetArtifact( target, targetReadbackCapture ) );
	const totalTargetBytes = resources.renderTargets.reduce( ( sum, target ) => sum + target.bytes, 0 );
	const renderTargets = schema( {
		targets,
		accountingScope: 'lab-owned-render-targets-only',
		completeness: 'PARTIAL',
		trackedRenderTargetBytes: D( totalTargetBytes, 'byte', 'sum of LabController render-target byte records' ),
		trackedPeakLiveRenderTargetBytes: D( totalTargetBytes, 'byte', 'all reported lab-owned validation targets simultaneously live' )
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
		accountingScope: resources.accountingScope,
		completeness: resources.completeness,
		inventoryCompleteness: resources.inventoryCompleteness,
		labOwnedNonTargetResources: resources.labOwnedNonTargetResources,
		opaqueRendererInternalResidency: resources.opaqueRendererInternalResidency,
		trackedRenderTargetBytes: D( totalTargetBytes, 'byte', 'sum of exact logical lab-owned render-target allocations only' ),
		trackedPeakLiveRenderTargetBytes: D( totalTargetBytes, 'byte', 'reported lab-owned render targets simultaneously live' ),
		uploadChurnPerFrame: {
			status: 'NOT_CLAIMED',
			value: null,
			reason: 'The current renderer metrics do not expose per-frame upload bytes.'
		}
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
			measured: D( diagnosticSimilarity, 'ratio', '1 - minimum measured mean RGB byte difference / 255' ),
			gate: G( 0.99, 'ratio', 'diagnostics must differ materially from final' ),
			verdict: 'PASS',
			worstCaseArtifact: 'diagnostics.mosaic.png'
		} ],
		spatialErrorMaps: [],
		worstCaseArtifacts: [ 'diagnostics.mosaic.png' ]
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
			rowType: snapshot.rowType,
			cycle: M( snapshot.cycle, 'cycle', 'fresh-controller lifecycle runner result' ),
			beforeRendererBytes: M( snapshot.beforeRendererBytes, 'byte', 'renderer-info memory total before disposal' ),
			afterRendererBytes: M( snapshot.afterRendererBytes, 'byte', 'renderer-info memory total after disposal' ),
			targetBytes: M( snapshot.targetBytes, 'byte', 'described render-target bytes before disposal' ),
			storageBytes: M( snapshot.storageBytes, 'byte', 'described storage bytes before disposal' ),
			retainedTargetBytes: M( snapshot.retainedTargetBytes, 'byte', 'post-settle render-target inventory' ),
			retainedStorageBytes: M( snapshot.retainedStorageBytes, 'byte', 'post-settle storage inventory' ),
			retainedListenerCount: M( snapshot.retainedListenerCount, 'listener', 'post-settle subject listener registry' ),
			retainedControlCount: M( snapshot.retainedControlCount, 'control', 'post-settle subject control registry' ),
			retainedMaterialCount: M( snapshot.retainedMaterialCount, 'material', 'post-settle subject material registry' ),
			postDisposeErrorCount: M( snapshot.postDisposeErrorCount, 'error', 'post-settle delayed and device error channels' ),
			rendererStateDisposition: snapshot.rendererStateDisposition,
			rendererStateBeforeDigest: snapshot.rendererStateBeforeDigest,
			rendererStateAfterDigest: snapshot.rendererStateAfterDigest,
			deviceLossObserved: snapshot.deviceLossObserved,
			settleAnimationFrames: M( snapshot.settleAnimationFrames, 'frame', 'post-disposal observation window' ),
			disposeStatus: snapshot.disposeStatus
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
		proofKind: mechanismProof.proofKind,
		captureProfile: session.profile,
		pipelineGraphDigest,
		runtimeReachability: {
			signals: [ ...mechanismProof.reachableSignals ],
			resources: [ ...mechanismProof.reachableResources ],
			routes: mechanismProof.routeExecutions.map( ( execution ) => execution.mode )
		},
		routeExecutions: mechanismProof.routeExecutions.map( ( execution ) => ( {
			mode: execution.mode,
			outputNodeId: execution.outputNodeId,
			selectedOutputNodeId: execution.selectedOutputNodeId,
			selectedOutputNodeIdentityVerified: execution.selectedOutputNodeIdentityVerified,
			graphMarkedDirtyBeforeRender: execution.graphMarkedDirtyBeforeRender,
			renderSubmissionCountBefore: M( execution.renderSubmissionCountBefore, 'submission', 'native mechanism reachability profile' ),
			renderSubmissionCountAfter: M( execution.renderSubmissionCountAfter, 'submission', 'native mechanism reachability profile' ),
			renderSubmissionDelta: M( execution.renderSubmissionDelta, 'submission', 'native mechanism reachability profile' )
		} ) ),
		negativeControls: mechanismProof.negativeControls,
		diagnosticComparisons: [ 'normal', 'emissive' ].map( ( route ) => ( {
			route,
			baseline: 'final.design.png',
			candidate: `diagnostic.${ route }.png`,
			meanRgbByteDifference: M( diagnosticDifferences[ route ], 'mean-rgb-byte-difference', `final versus live ${ route } output-node readback` ),
			minimumDifferenceGate: G( 1, 'mean-rgb-byte-difference', 'frozen diagnostic-route separation threshold' ),
			verdict: diagnosticDifferences[ route ] > 1 ? 'PASS' : 'FAIL'
		} ) ),
		metrics: [
			{ id: 'diagnostic-mean-rgb-byte-difference', measured: M( diagnosticDifference, 'mean-rgb-byte-difference', 'minimum of final-vs-normal and final-vs-emissive' ), captures: [ 'diagnostic.normal.png', 'diagnostic.emissive.png' ] },
			{ id: 'render-timestamp-availability', verdict: gpuTiming.verdict, measured: gpuTiming.renderMs === null ? null : M( gpuTiming.renderMs, 'ms', 'single resolved render timestamp' ) },
			...( performanceTrace === null ? [] : [ {
				id: 'sustained-performance-trace',
				verdict: performanceVerdict,
				cpuP95: M( performanceTrace.cpuP95, 'ms', `${ performanceTrace.sampleFrames } sustained RenderPipeline CPU submission samples` ),
				gpuP95: M( performanceTrace.gpuP95, 'ms', `${ performanceTrace.sampleFrames } sustained WebGPU render timestamp samples` ),
				presentationP95: M( performanceTrace.presentationP95, 'ms', `${ performanceTrace.presentationSamples.length } requestAnimationFrame cadence intervals with rendering enabled` ),
				deadlineMissRatio: M( performanceTrace.deadlineMissRatio, 'ratio', 'measured cadence intervals above 16.6667 ms' )
			}, {
				id: 'per-stage-gpu-attribution',
				verdict: gpuAttributionVerdict,
				sceneMrtP95: M( performanceTrace.gpuStageP95[ 'scene-mrt' ], 'ms', '120 resolved scene MRT render-context timestamps' ),
				finalOutputP95: M( performanceTrace.gpuStageP95[ 'final-output' ], 'ms', '120 resolved final-output render-context timestamps' ),
				lastFrameResolveResidual: M( performanceTrace.lastFrameResolveResidualMs, 'ms', 'Three r185 final-frame aggregate minus attributed stage sum' ),
				independentPerFrameTotalsAvailable: false
			}, {
				id: 'quality-governor-stress',
				verdict: governorVerdict,
				windowCount: M( governorTrace.windowCount, 'window', 'measured governor trace' ),
				transitionCount: M( governorTrace.transitions.length, 'transition', 'measured governor trace' ),
				settledState: governorTrace.settledState,
				oscillationDetected: governorTrace.oscillationDetected,
				finalStableGpuP95: M( governorTrace.windows.at( - 1 ).gpuP95, 'ms', 'final governor window' ),
				finalStableVisualError: M( governorTrace.visualErrorByTier[ governorTrace.settledState ].meanRgbByteDifference, 'mean-rgb-byte-difference', 'settled-tier comparison' ),
				finalStableEdgeP95VisualError: M( governorTrace.visualErrorByTier[ governorTrace.settledState ].edgeP95RgbByteDifference, 'mean-rgb-byte-difference', 'reference-edge-mask settled-tier comparison' )
			} ] ),
			{ id: 'readback-captures', records: captureMetrics }
		],
		verdicts: claimVerdicts,
		verdict: mechanismVerdict
	} );
	const artifacts = {
		'visual-contract.json': visualContract,
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
	await writeArtifacts( session, artifacts );
	return {
		bundleKind: 'raw-capture-candidate',
		publishable: false,
		claimVerdicts,
		requiredArtifactCount: M( Object.keys( artifacts ).length + 1, 'artifact', 'thirteen hook-written normative JSON files plus the offline-finalized manifest' ),
		requiredImageCount: M( REQUIRED_V2_IMAGES.length, 'image', 'v2 standard image contract' ),
		pipelineGraphDigest,
		diagnosticDifference: M( diagnosticDifference, 'mean-rgb-byte-difference', 'minimum live diagnostic separation from final output' )
	};

}
