import {
	AmbientLight,
	BoxGeometry,
	Color,
	DirectionalLight,
	FloatType,
	HalfFloatType,
	InspectorBase,
	Mesh,
	MeshStandardNodeMaterial,
	NeutralToneMapping,
	NodeUpdateType,
	PerspectiveCamera,
	PlaneGeometry,
	RenderPipeline,
	RenderTarget,
	Scene,
	SRGBColorSpace,
	TorusKnotGeometry,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { color, emissive, float, mrt, normalView, output, pass, renderOutput, vec4 } from 'three/tsl';

import { createFailClosedCaptureCoordinator } from './capture-transaction.js';
import {
	correctnessCaptureRecipeDigest,
	correctnessCaptureRecipeSetDigest,
	getCorrectnessCaptureRecipe
} from './correctness-capture-recipes.js';
import { sha256Hex, stableStringify } from './physical-evidence-common.js';
import { unpackAlignedReadback } from './readback.js';
import {
	buildValidationResourceLedger,
	emptyValidationResourceLedger,
	validateValidationResourceLedger
} from './resource-ledger.js';
import { snapshotGpuAdapter, snapshotRendererInfo } from './renderer-info-snapshot.js';
import { TIER_ROUTE_LOCKS } from './route-locks.js';

const SCENARIO_IDS = [
	'browser-capture',
	'pipeline-graph-inspector',
	'resource-ledger',
	'timing-and-governor',
	'lifecycle-and-leaks',
	'visual-error-metrics',
	'mutation-gallery',
	'artifact-inspector'
];
const SCENARIOS = new Set( SCENARIO_IDS );
const MODES = new Set( [ 'final', 'no-post', 'normal', 'emissive' ] );
const TIERS = new Map( [
	[ 'schema-fixture', { passScale: 1, performanceClaim: false } ],
	[ 'webgpu-correctness', { passScale: 1, performanceClaim: false } ],
	[ 'target-performance', { passScale: 1, performanceClaim: true } ],
	[ 'governor-stress', { passScale: 0.5, performanceClaim: true } ],
	[ 'release', { passScale: 1, performanceClaim: true } ]
] );
const CAMERAS = new Map( [
	[ 'near', { position: [ 0.4, 1.2, 3.4 ], target: [ 0, 0.45, 0 ] } ],
	[ 'design', { position: [ 3.8, 2.8, 6.5 ], target: [ 0, 0.35, 0 ] } ],
	[ 'far', { position: [ 7.5, 5, 12 ], target: [ 0, 0.25, 0 ] } ]
] );
const SEEDS = new Set( [ 0x00000001, 0x9e3779b9 ] );
const RUNTIME_PROFILES = new Set( [ 'correctness', 'performance' ] );
export const VALIDATION_HARNESS_LAB_ID = 'webgpu-validation-harness';
export const FINAL_EMISSIVE_COMPOSITE_STRENGTH = 0.4;
export const VALIDATION_MODE_OUTPUT_NODE_IDS = Object.freeze( {
	final: 'final-output-node',
	'no-post': 'no-post-output-node',
	normal: 'normal-output-node',
	emissive: 'emissive-output-node'
} );
let nextControllerGeneration = 1;
let nextRendererDeviceGeneration = 1;

export const timestampResolutionPolicy = Object.freeze( {
	mappingCadence: 'once-per-batch',
	maximumQueriesPerBatch: 2048,
	contextsPerFrame: 2
} );

export function configureExplicitRenderSubmissionPass( passNode ) {

	if ( passNode === null || typeof passNode !== 'object' || typeof passNode.updateBefore !== 'function' ) throw new TypeError( 'Explicit render-submission cadence requires a PassNode.' );
	passNode.updateBeforeType = NodeUpdateType.RENDER;
	if ( passNode.updateBeforeType !== NodeUpdateType.RENDER ) throw new Error( 'PassNode did not retain explicit render-submission cadence.' );
	return passNode;

}

export function parseRenderTimestampUid( uid ) {

	const match = typeof uid === 'string' ? uid.match( /^r:(\d+):(\d+):f(\d+)$/ ) : null;
	if ( match === null ) throw new Error( `Render timestamp UID ${ String( uid ) } does not match Three r185 r:<frameCall>:<contextId>:f<frameId>.` );
	return Object.freeze( {
		uid,
		frameCall: Number.parseInt( match[ 1 ], 10 ),
		contextId: Number.parseInt( match[ 2 ], 10 ),
		frameId: Number.parseInt( match[ 3 ], 10 )
	} );

}

export function assertRendererBackendDeviceIdentity( requestedDevice, backendDevice ) {

	if ( backendDevice === null || typeof backendDevice !== 'object' ) throw new Error( 'Initialized WebGPU backend did not expose its actual GPUDevice.' );
	if ( requestedDevice === null || typeof requestedDevice !== 'object' || backendDevice !== requestedDevice ) throw new Error( 'Initialized WebGPU backend did not retain the exact requested GPUDevice.' );
	return backendDevice;

}

export function summarizeTimestampBatch( { entries, resolvedLastFrameTotalMs } ) {

	if ( Array.isArray( entries ) === false || entries.length === 0 ) throw new Error( 'Timestamp batch requires a nonempty explicit-stage population.' );
	const frames = new Map();
	const stageContextIds = new Map();
	for ( const entry of entries ) {

		const parsed = parseRenderTimestampUid( entry?.uid );
		if ( entry.stage !== 'scene-mrt' && entry.stage !== 'final-output' ) throw new Error( `Timestamp UID ${ parsed.uid } has no inspected render stage.` );
		if ( Number.isFinite( entry.durationMs ) === false || entry.durationMs < 0 ) throw new Error( `Timestamp UID ${ parsed.uid } has an invalid duration.` );
		if ( stageContextIds.has( entry.stage ) === false ) stageContextIds.set( entry.stage, parsed.contextId );
		if ( stageContextIds.get( entry.stage ) !== parsed.contextId ) throw new Error( `Timestamp stage ${ entry.stage } changed render-context identity within the batch.` );
		if ( frames.has( parsed.frameId ) === false ) frames.set( parsed.frameId, new Map() );
		const stages = frames.get( parsed.frameId );
		if ( stages.has( entry.stage ) ) throw new Error( `Timestamp frame ${ parsed.frameId } duplicates stage ${ entry.stage }.` );
		stages.set( entry.stage, { ...parsed, durationMs: entry.durationMs } );

	}
	if ( stageContextIds.size !== timestampResolutionPolicy.contextsPerFrame || stageContextIds.get( 'scene-mrt' ) === stageContextIds.get( 'final-output' ) ) throw new Error( 'Timestamp batch must bind two distinct stable render contexts to scene-mrt and final-output.' );
	const frameIds = [ ...frames.keys() ].sort( ( left, right ) => left - right );
	for ( let index = 1; index < frameIds.length; index ++ ) if ( frameIds[ index ] !== frameIds[ index - 1 ] + 1 ) throw new Error( 'Timestamp batch frame IDs must be contiguous.' );
	const rows = frameIds.map( ( frameId ) => {

		const stages = frames.get( frameId );
		const scene = stages.get( 'scene-mrt' );
		const output = stages.get( 'final-output' );
		if ( ! scene || ! output || stages.size !== timestampResolutionPolicy.contextsPerFrame ) throw new Error( `Timestamp frame ${ frameId } must contain exactly one scene-mrt and one final-output stage.` );
		return Object.freeze( {
			frameId,
			sceneUid: scene.uid,
			outputUid: output.uid,
			sceneMs: scene.durationMs,
			outputMs: output.durationMs,
			totalMs: scene.durationMs + output.durationMs,
			residualMs: null,
			totalProvenance: 'Derived',
			independentPerFrameTotalAvailable: false
		} );

	} );
	const stageSamples = {
		'scene-mrt': rows.map( ( row ) => row.sceneMs ),
		'final-output': rows.map( ( row ) => row.outputMs )
	};
	const totalSamples = rows.map( ( row ) => row.totalMs );
	if ( Number.isFinite( resolvedLastFrameTotalMs ) === false || resolvedLastFrameTotalMs < 0 ) throw new Error( 'Timestamp batch has no finite resolved final-frame total.' );
	return {
		rows,
		totalSamples,
		stageSamples,
		stageContextIds: Object.fromEntries( stageContextIds ),
		resolveCount: 1,
		lastFrameResolveResidualMs: Math.abs( resolvedLastFrameTotalMs - totalSamples.at( -1 ) ),
		independentPerFrameTotalsAvailable: false,
		reconciliationScope: 'Every frame is explicitly stage-bound and summed; Three r185 independently returns only the final-frame aggregate, checked separately.'
	};

}

class ValidationTimestampInspector extends InspectorBase {

	constructor( classifyStage ) {

		super();
		this.classifyStage = classifyStage;
		this.renderStages = new Map();

	}

	beginRender( uid, scene, camera, renderTarget ) {

		const stage = this.classifyStage( { uid, scene, camera, renderTarget } );
		if ( stage === null ) throw new Error( `Unclassified render context ${ uid } entered the validation timestamp population.` );
		const existing = this.renderStages.get( uid );
		if ( existing !== undefined && existing !== stage ) throw new Error( `Render context ${ uid } changed stage identity.` );
		this.renderStages.set( uid, stage );

	}

	stageFor( uid ) {

		return this.renderStages.get( uid ) ?? null;

	}

}

function requireKnown( collection, value, label ) {

	if ( collection.has( value ) === false ) throw new Error( `Unknown ${ label } "${ value }".` );

}

function percentile( samples, q ) {

	if ( samples.length === 0 ) return null;
	const sorted = [ ...samples ].sort( ( a, b ) => a - b );
	const position = ( sorted.length - 1 ) * q;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	if ( lower === upper ) return sorted[ lower ];
	return sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

function seededAngle( seed ) {

	let state = seed >>> 0;
	state ^= state << 13;
	state ^= state >>> 17;
	state ^= state << 5;
	return ( ( state >>> 0 ) / 0xffffffff ) * Math.PI * 2;

}

function disposeObject( object ) {

	object.geometry?.dispose?.();
	if ( Array.isArray( object.material ) ) object.material.forEach( ( material ) => material.dispose() );
	else object.material?.dispose?.();

}

function requireFrameCount( value, label, minimum, maximum ) {

	if ( Number.isInteger( value ) === false || value < minimum || value > maximum ) {

		throw new Error( `${ label } must be an integer in [${ minimum }, ${ maximum }].` );

	}
	return value;

}

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ label } must be an object.` );
	return value;

}

function requireSha256( value, label ) {

	if ( /^sha256:[0-9a-f]{64}$/.test( value ?? '' ) === false ) throw new Error( `${ label } must be a sha256: digest.` );
	return value;

}

export function cloneJsonSafeCaptureEvidence( value, label = 'capture evidence' ) {

	const ancestors = new Set();
	const clone = ( input, path ) => {

		if ( input === null || typeof input === 'string' || typeof input === 'boolean' ) return input;
		if ( typeof input === 'number' ) {

			if ( Number.isFinite( input ) === false ) throw new TypeError( `${ path } must contain only finite JSON numbers.` );
			return Object.is( input, - 0 ) ? 0 : input;

		}
		if ( typeof input !== 'object' ) throw new TypeError( `${ path } contains non-JSON ${ typeof input } data.` );
		if ( ArrayBuffer.isView( input ) || input instanceof ArrayBuffer ) throw new TypeError( `${ path } contains binary data instead of JSON metadata.` );
		if ( ancestors.has( input ) ) throw new TypeError( `${ path } contains a cycle.` );
		ancestors.add( input );
		let output;
		if ( Array.isArray( input ) ) {

			output = [];
			for ( const key of Reflect.ownKeys( input ) ) {

				if ( key === 'length' ) continue;
				if ( typeof key !== 'string' || /^(0|[1-9]\d*)$/.test( key ) === false || Number( key ) >= input.length ) throw new TypeError( `${ path } contains a non-JSON array property.` );
				const descriptor = Object.getOwnPropertyDescriptor( input, key );
				if ( descriptor?.enumerable !== true || Object.hasOwn( descriptor, 'value' ) === false ) throw new TypeError( `${ path }[${ key }] must be enumerable plain JSON data.` );

			}
			for ( let index = 0; index < input.length; index ++ ) {

				if ( Object.hasOwn( input, index ) === false ) throw new TypeError( `${ path } contains a sparse array hole at index ${ index }.` );
				const descriptor = Object.getOwnPropertyDescriptor( input, String( index ) );
				output.push( clone( descriptor.value, `${ path }[${ index }]` ) );

			}

		}
		else {

			const prototype = Object.getPrototypeOf( input );
			if ( prototype !== Object.prototype && prototype !== null ) throw new TypeError( `${ path } contains a non-plain object.` );
			output = {};
			for ( const key of Reflect.ownKeys( input ) ) {

				if ( typeof key !== 'string' ) throw new TypeError( `${ path } contains symbol-keyed data.` );
				if ( key === '__proto__' || key === 'constructor' || key === 'prototype' ) throw new TypeError( `${ path }.${ key } is a forbidden evidence key.` );
				const descriptor = Object.getOwnPropertyDescriptor( input, key );
				if ( descriptor?.enumerable !== true || Object.hasOwn( descriptor, 'value' ) === false ) throw new TypeError( `${ path }.${ key } must be enumerable plain JSON data.` );
				Object.defineProperty( output, key, {
					value: clone( descriptor.value, `${ path }.${ key }` ),
					enumerable: true,
					configurable: false,
					writable: false
				} );

			}

		}
		ancestors.delete( input );
		for ( const child of Object.values( output ) ) if ( child !== null && typeof child === 'object' && Object.isFrozen( child ) === false ) Object.freeze( child );
		return Object.freeze( output );

	};
	return clone( value, label );

}

export function assertCorrectnessCaptureRecipeContext( { runtimeProfile, routeLock, recipe } ) {

	requireRecord( recipe, 'correctness capture recipe' );
	if ( runtimeProfile !== 'correctness' ) throw new Error( 'Correctness capture recipes require the correctness runtime profile.' );
	if ( routeLock?.kind !== 'tier' || routeLock?.id !== 'webgpu-correctness' || routeLock.startup !== TIER_ROUTE_LOCKS[ 'webgpu-correctness' ] ) {

		throw new Error( 'Correctness capture recipes require the exact tier/webgpu-correctness parent route lock.' );

	}
	if ( recipe.parentRoute?.kind !== routeLock.kind || recipe.parentRoute?.id !== routeLock.id ) throw new Error( `Capture recipe ${ recipe.id ?? '<unknown>' } does not belong to the active parent route.` );
	return true;

}

export function assertCurrentLockedCaptureMode( target, currentMode ) {

	requireKnown( MODES, target, 'capture target' );
	requireKnown( MODES, currentMode, 'current mode' );
	if ( target !== currentMode ) throw new Error( `Capture target ${ target } is not the current locked mode ${ currentMode }.` );
	return true;

}

export function assertCaptureDeviceTupleUnchanged( entryDevice, observedDevice, phase = 'Capture' ) {

	requireRecord( entryDevice, 'entry device tuple' );
	requireRecord( observedDevice, 'observed device tuple' );
	if ( observedDevice.uncapturedErrorCount !== entryDevice.uncapturedErrorCount ) throw new Error( `${ phase } observed new uncaptured GPU errors.` );
	if ( stableStringify( observedDevice ) !== stableStringify( entryDevice ) ) throw new Error( `${ phase } observed GPU device identity or generation drift.` );
	return true;

}

export async function finalizeCaptureEvidenceWithDeviceGuard( {
	buildEvidence,
	entryDevice,
	observeDevice,
	onPoison,
	recipeId
} ) {

	if ( typeof buildEvidence !== 'function' || typeof observeDevice !== 'function' || typeof onPoison !== 'function' ) throw new TypeError( 'Capture evidence finalization requires buildEvidence, observeDevice, and onPoison functions.' );
	if ( typeof recipeId !== 'string' || recipeId.length === 0 ) throw new TypeError( 'Capture evidence finalization requires a recipe ID.' );
	const evidence = await buildEvidence();
	try {

		assertCaptureDeviceTupleUnchanged( entryDevice, observeDevice(), `Capture recipe ${ recipeId } final evidence` );

	} catch ( error ) {

		onPoison( Object.freeze( { recipeId, reason: String( error?.message ?? error ) } ) );
		throw error;

	}
	return evidence;

}

export function assertCorrectnessCaptureEntryState( state, routeLock ) {

	requireRecord( state, 'correctness capture entry state' );
	if ( routeLock?.kind !== 'tier' || routeLock?.id !== 'webgpu-correctness' || routeLock.startup !== TIER_ROUTE_LOCKS[ 'webgpu-correctness' ] ) throw new Error( 'Correctness capture entry state requires the exact tier/webgpu-correctness route lock.' );
	const startup = routeLock.startup;
	const expected = {
		scenario: startup.scenario,
		tier: startup.tier,
		mode: startup.mode,
		camera: startup.camera,
		seed: startup.seed,
		timeSeconds: startup.timeSeconds,
		viewport: { width: startup.width, height: startup.height, dpr: startup.dpr },
		passScale: TIERS.get( startup.tier ).passScale,
		outputNodeMode: startup.mode,
		outputNodeId: VALIDATION_MODE_OUTPUT_NODE_IDS[ startup.mode ],
		captureTarget: { width: Math.round( startup.width * startup.dpr ), height: Math.round( startup.height * startup.dpr ) },
		sceneTarget: { width: Math.floor( startup.width * TIERS.get( startup.tier ).passScale ), height: Math.floor( startup.height * TIERS.get( startup.tier ).passScale ) },
		rendererTarget: { kind: 'presentation', textureUuid: null }
	};
	for ( const key of Object.keys( expected ) ) if ( stableStringify( state[ key ] ) !== stableStringify( expected[ key ] ) ) throw new Error( `Correctness capture entry state ${ key } drifted from the locked parent route.` );
	const device = requireRecord( state.device, 'correctness capture entry device' );
	if ( device.rendererDeviceStatus !== 'active' || device.deviceLossGeneration !== 0 || device.deviceLostObserved !== false || device.backendDeviceIdentityVerified !== true || device.nativeWebGPUBackend !== true || device.uncapturedErrorCount !== 0 ) throw new Error( 'Correctness capture entry device is not a clean active native-WebGPU generation.' );
	return true;

}

function assertObservedRecipeState( observed, recipe ) {

	requireRecord( observed, 'observed effective capture state' );
	const declared = recipe.effectiveState;
	for ( const key of [ 'scenario', 'tier', 'mode', 'camera', 'seed', 'timeSeconds' ] ) {

		if ( observed[ key ] !== declared[ key ] ) throw new Error( `Observed capture state ${ key } does not match recipe ${ recipe.id }.` );

	}
	if ( stableStringify( observed.viewport ) !== stableStringify( declared.viewport ) ) throw new Error( `Observed capture viewport does not match recipe ${ recipe.id }.` );
	if ( observed.passScale !== recipe.expectedSceneScale ) throw new Error( `Observed capture pass scale does not match recipe ${ recipe.id }.` );
	if ( observed.outputNodeMode !== declared.mode || observed.outputNodeId !== VALIDATION_MODE_OUTPUT_NODE_IDS[ declared.mode ] || typeof observed.outputNodeUuid !== 'string' || observed.outputNodeUuid.length === 0 ) throw new Error( `Observed capture output-node identity does not match recipe ${ recipe.id }.` );
	const pixelWidth = Math.round( declared.viewport.width * declared.viewport.dpr );
	const pixelHeight = Math.round( declared.viewport.height * declared.viewport.dpr );
	if ( stableStringify( observed.captureTarget ) !== stableStringify( { width: pixelWidth, height: pixelHeight } ) ) throw new Error( `Observed capture target extent does not match recipe ${ recipe.id }.` );
	if ( stableStringify( observed.sceneTarget ) !== stableStringify( { width: Math.floor( pixelWidth * recipe.expectedSceneScale ), height: Math.floor( pixelHeight * recipe.expectedSceneScale ) } ) ) throw new Error( `Observed scene target extent does not match recipe ${ recipe.id }.` );

}

function assertCaptureLayouts( layouts, effectiveState, recipeId ) {

	requireRecord( layouts, 'capture layouts' );
	const readback = requireRecord( layouts.readback, 'capture layouts.readback' );
	const transport = requireRecord( layouts.transport, 'capture layouts.transport' );
	const normalized = requireRecord( layouts.normalized, 'capture layouts.normalized' );
	const width = effectiveState.captureTarget.width;
	const height = effectiveState.captureTarget.height;
	const rowBytes = width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const minimumByteLength = bytesPerRow * ( height - 1 ) + rowBytes;
	const fullyPaddedByteLength = bytesPerRow * height;
	const expectedReadback = { width, height, bytesPerTexel: 4, rowBytes, bytesPerRow, minimumByteLength, fullyPaddedByteLength, alignment: 256 };
	if ( stableStringify( readback ) !== stableStringify( expectedReadback ) ) throw new Error( `Capture recipe ${ recipeId } readback layout does not match the aligned target extent.` );
	for ( const layout of [ transport, normalized ] ) {

		if ( layout.width !== width || layout.height !== height || layout.rowBytes !== rowBytes || layout.bytesPerRow !== bytesPerRow || layout.format !== 'rgba8unorm' || layout.origin !== 'top-left' ) throw new Error( `Capture recipe ${ recipeId } retained layout does not match the aligned readback.` );

	}
	if ( transport.byteLength !== minimumByteLength && transport.byteLength !== fullyPaddedByteLength ) throw new Error( `Capture recipe ${ recipeId } transport byte length is not a permitted WebGPU copy length.` );
	const expectedPadding = transport.byteLength === fullyPaddedByteLength ? 'full-final-row' : 'tight-final-row';
	if ( transport.padding !== expectedPadding ) throw new Error( `Capture recipe ${ recipeId } transport padding classification is inconsistent.` );
	if ( normalized.byteLength !== fullyPaddedByteLength ) throw new Error( `Capture recipe ${ recipeId } normalized byte length is not fully padded.` );

}

function assertRecipeExecutionTrace( recipe, entryState, telemetry, submissions ) {

	requireRecord( telemetry, `Capture recipe ${ recipe.id } telemetry` );
	for ( const phase of [ 'entry', 'effective', 'restored' ] ) {

		const snapshot = requireRecord( telemetry[ phase ], `Capture recipe ${ recipe.id } telemetry.${ phase }` );
		if ( Number.isInteger( snapshot.resetEventCount ) === false || snapshot.resetEventCount < 0 || Array.isArray( snapshot.resetEvents ) === false || snapshot.resetEvents.length !== snapshot.resetEventCount ) throw new Error( `Capture recipe ${ recipe.id } telemetry.${ phase } has an invalid reset-event population.` );

	}
	if ( Number.isInteger( telemetry.historyResetDelta ) === false || Number.isInteger( telemetry.restorationHistoryResetDelta ) === false ) throw new Error( `Capture recipe ${ recipe.id } reset deltas must be integers.` );
	if ( telemetry.historyResetDelta !== telemetry.effective.resetEventCount - telemetry.entry.resetEventCount ) throw new Error( `Capture recipe ${ recipe.id } historyResetDelta does not reconcile.` );
	if ( telemetry.restorationHistoryResetDelta !== telemetry.restored.resetEventCount - telemetry.effective.resetEventCount ) throw new Error( `Capture recipe ${ recipe.id } restorationHistoryResetDelta does not reconcile.` );
	if ( stableStringify( telemetry.effective.resetEvents.slice( 0, telemetry.entry.resetEventCount ) ) !== stableStringify( telemetry.entry.resetEvents ) ) throw new Error( `Capture recipe ${ recipe.id } rewrote the entry reset-history prefix.` );
	if ( telemetry.restorationHistoryResetDelta !== 0 || stableStringify( telemetry.effective.resetEvents ) !== stableStringify( telemetry.restored.resetEvents ) ) throw new Error( `Capture recipe ${ recipe.id } restoration appended or rewound reset telemetry.` );
	if ( Array.isArray( telemetry.appendedDuringCapture ) === false || Array.isArray( telemetry.appendedDuringRestoration ) === false ) throw new Error( `Capture recipe ${ recipe.id } omits appended reset records.` );
	if ( stableStringify( telemetry.appendedDuringCapture ) !== stableStringify( telemetry.effective.resetEvents.slice( telemetry.entry.resetEventCount ) ) ) throw new Error( `Capture recipe ${ recipe.id } appended capture resets do not reconcile.` );
	if ( telemetry.appendedDuringRestoration.length !== 0 ) throw new Error( `Capture recipe ${ recipe.id } restoration appended reset records.` );
	const resetCause = recipe.effectiveState.timeline.resetHistoryCause;
	if ( resetCause === null ) {

		if ( telemetry.historyResetDelta !== 0 || telemetry.appendedDuringCapture.length !== 0 ) throw new Error( `Capture recipe ${ recipe.id } changed history without declaring a reset.` );

	} else {

		if ( telemetry.historyResetDelta !== 1 || telemetry.appendedDuringCapture.length !== 1 ) throw new Error( `Capture recipe ${ recipe.id } did not append exactly one history reset.` );
		const reset = telemetry.appendedDuringCapture[ 0 ];
		if ( reset.cause !== resetCause || reset.timeSeconds !== recipe.effectiveState.timeline.initialTimeSeconds ) throw new Error( `Capture recipe ${ recipe.id } reset history at the wrong cause or time.` );

	}
	const counterFields = [
		[ 'renderSubmissionCount', 'renderSubmissions' ],
		[ 'scenePassExecutionCount', 'scenePassExecutions' ],
		[ 'modeSelectionCount', 'modeSelections' ]
	];
	for ( const phase of [ 'entry', 'effective', 'restored' ] ) {

		const snapshot = requireRecord( submissions[ phase ], `Capture recipe ${ recipe.id } submissions.${ phase }` );
		for ( const [ counterField ] of counterFields ) if ( Number.isInteger( snapshot[ counterField ] ) === false || snapshot[ counterField ] < 0 ) throw new Error( `Capture recipe ${ recipe.id } submissions.${ phase}.${ counterField } must be a nonnegative integer.` );

	}
	for ( const [ deltaName, fromPhase, toPhase ] of [ [ 'captureDelta', 'entry', 'effective' ], [ 'restorationDelta', 'effective', 'restored' ] ] ) {

		const delta = requireRecord( submissions[ deltaName ], `Capture recipe ${ recipe.id } submissions.${ deltaName }` );
		for ( const [ counterField, deltaField ] of counterFields ) {

			if ( Number.isInteger( delta[ deltaField ] ) === false || delta[ deltaField ] < 0 ) throw new Error( `Capture recipe ${ recipe.id } submissions.${ deltaName }.${ deltaField } must be a nonnegative integer.` );
			if ( submissions[ toPhase ][ counterField ] !== submissions[ fromPhase ][ counterField ] + delta[ deltaField ] ) throw new Error( `Capture recipe ${ recipe.id } cumulative ${ counterField } does not reconcile with ${ deltaName }.` );

		}

	}
	const expectedCaptureRenders = recipe.effectiveState.timeline.stepSeconds.length + 1;
	if ( submissions.captureDelta?.renderSubmissions !== expectedCaptureRenders || submissions.captureDelta?.scenePassExecutions !== expectedCaptureRenders || submissions.captureDelta?.modeSelections !== 1 ) throw new Error( `Capture recipe ${ recipe.id } submission trace does not match its timeline and readback.` );
	if ( submissions.restorationDelta?.renderSubmissions !== 1 || submissions.restorationDelta?.scenePassExecutions !== 1 || submissions.restorationDelta?.modeSelections !== 1 ) throw new Error( `Capture recipe ${ recipe.id } did not execute exactly one restoration render.` );
	if ( Array.isArray( submissions.captureRenderTrace ) === false || Array.isArray( submissions.restorationRenderTrace ) === false ) throw new Error( `Capture recipe ${ recipe.id } omits per-submission trace evidence.` );
	const expectedTimes = [];
	let traceTime = recipe.effectiveState.timeline.initialTimeSeconds;
	for ( const deltaSeconds of recipe.effectiveState.timeline.stepSeconds ) {

		expectedTimes.push( traceTime );
		traceTime += deltaSeconds;

	}
	expectedTimes.push( traceTime );
	if ( stableStringify( submissions.captureRenderTrace.map( ( row ) => row.timeSeconds ) ) !== stableStringify( expectedTimes ) ) throw new Error( `Capture recipe ${ recipe.id } render times do not match its adjacent timeline.` );
	for ( let index = 0; index < submissions.captureRenderTrace.length; index ++ ) {

		const row = submissions.captureRenderTrace[ index ];
		const expectedTarget = index === submissions.captureRenderTrace.length - 1 ? 'capture-target' : 'presentation';
		if ( row.target !== expectedTarget || row.mode !== recipe.effectiveState.mode || row.tier !== recipe.effectiveState.tier ) throw new Error( `Capture recipe ${ recipe.id } per-submission state does not match its timeline.` );

	}
	if ( submissions.restorationRenderTrace.length !== 1 ) throw new Error( `Capture recipe ${ recipe.id } must retain one restoration submission row.` );
	const restoration = submissions.restorationRenderTrace[ 0 ];
	if ( restoration.target !== 'presentation' || restoration.timeSeconds !== entryState.timeSeconds || restoration.mode !== entryState.mode || restoration.tier !== entryState.tier ) throw new Error( `Capture recipe ${ recipe.id } restoration submission does not match its entry state.` );
	const allTrace = [ ...submissions.captureRenderTrace, ...submissions.restorationRenderTrace ];
	for ( let index = 0; index < allTrace.length; index ++ ) if ( allTrace[ index ].sequence !== submissions.entry.renderSubmissionCount + index + 1 ) throw new Error( `Capture recipe ${ recipe.id } render-submission sequence is not contiguous.` );
	if ( submissions.captureRenderTrace.at( - 1 )?.sequence !== submissions.effective.renderSubmissionCount || submissions.restorationRenderTrace.at( - 1 )?.sequence !== submissions.restored.renderSubmissionCount ) throw new Error( `Capture recipe ${ recipe.id } render-submission trace endpoints do not match cumulative counters.` );

}

function restorableResourceState( ledger ) {

	requireRecord( ledger, 'capture resource ledger' );
	if ( ledger.state !== 'live' ) throw new Error( 'Capture resource snapshots must describe live resources.' );
	const byId = ( left, right ) => stableStringify( left ).localeCompare( stableStringify( right ) );
	return cloneJsonSafeCaptureEvidence( {
		renderTargets: ledger.renderTargets.map( ( target ) => ( {
			semantic: target.semantic,
			textureUuid: target.textureUuid,
			width: target.width,
			height: target.height,
			depth: target.depth,
			format: target.format,
			sampleCount: target.sampleCount,
			logicalBytes: target.logicalBytes,
			liveBytes: target.liveBytes,
			liveness: target.liveness
		} ) ).sort( byId ),
		sceneMrt: ledger.sceneMrt,
		geometries: ledger.geometries.map( ( geometry ) => ( {
			uuid: geometry.uuid,
			allocationIds: geometry.allocationIds,
			liveness: geometry.liveness
		} ) ).sort( byId ),
		geometryAllocations: ledger.geometryAllocations.map( ( allocation ) => ( {
			id: allocation.id,
			bindings: allocation.bindings,
			logicalBytes: allocation.logicalBytes,
			liveBytes: allocation.liveBytes,
			liveness: allocation.liveness
		} ) ).sort( byId ),
		storageResources: ( ledger.storageResources ?? [] ).map( ( resource ) => ( {
			id: resource.id ?? resource.name ?? null,
			logicalBytes: resource.logicalBytes ?? resource.bytes ?? null,
			liveBytes: resource.liveBytes ?? null,
			liveness: resource.liveness ?? null
		} ) ).sort( byId ),
		transientResources: {
			timestampQuerySets: ( ledger.transientResources?.timestampQuerySets ?? [] ).map( ( resource ) => ( {
				id: resource.id,
				poolType: resource.poolType,
				maxQueries: resource.maxQueries,
				liveness: resource.liveness
			} ) ).sort( byId ),
			timestampBuffers: ( ledger.transientResources?.timestampBuffers ?? [] ).map( ( resource ) => ( {
				id: resource.id,
				poolType: resource.poolType,
				component: resource.component,
				logicalBytes: resource.logicalBytes,
				liveBytes: resource.liveBytes,
				liveness: resource.liveness
			} ) ).sort( byId ),
			readbackBuffers: ( ledger.transientResources?.readbackBuffers ?? [] ).map( ( resource ) => ( {
				id: resource.id,
				logicalBytes: resource.logicalBytes,
				liveBytes: resource.liveBytes,
				liveness: resource.liveness
			} ) ).sort( byId )
		},
		trackedRenderTargetBytes: ledger.trackedRenderTargetBytes,
		trackedGeometryBytes: ledger.trackedGeometryBytes,
		trackedTransientBytes: ledger.trackedTransientBytes,
		trackedLiveBytes: ledger.trackedLiveBytes,
		trackedLogicalBytes: ledger.trackedLogicalBytes
	}, 'restorable resource state' );

}

function assertRestoredResourceState( entryLedger, restoredLedger, recipeId ) {

	const entry = restorableResourceState( entryLedger );
	const restored = restorableResourceState( restoredLedger );
	if ( stableStringify( entry ) !== stableStringify( restored ) ) throw new Error( `Capture recipe ${ recipeId } did not restore resource identities, extents, or live bytes.` );

}

export async function buildCaptureRecipeEvidenceEnvelope( {
	recipe,
	recipeDigest,
	recipeSetDigest,
	routeLock,
	runtimeProfile,
	transaction,
	entryState,
	effectiveState,
	effectiveStateDigest,
	restoredState,
	resources,
	telemetry,
	submissions,
	layouts
} ) {

	assertCorrectnessCaptureRecipeContext( { runtimeProfile, routeLock, recipe } );
	if ( recipe !== getCorrectnessCaptureRecipe( recipe.id ) ) throw new Error( `Capture recipe ${ recipe.id } is not the frozen canonical recipe object.` );
	assertCorrectnessCaptureEntryState( entryState, routeLock );
	requireSha256( recipeDigest, 'capture recipe digest' );
	requireSha256( recipeSetDigest, 'capture recipe-set digest' );
	requireRecord( transaction, 'capture transaction' );
	if ( transaction.schemaVersion !== 1 || transaction.status !== 'COMMITTED' || typeof transaction.transactionId !== 'string' || transaction.transactionId.length === 0 || Number.isInteger( transaction.sequence ) === false || transaction.sequence <= 0 || transaction.recipeId !== recipe.id || transaction.restorationVerdict !== 'PASS' || stableStringify( transaction.phaseVerdicts ) !== stableStringify( { capture: 'PASS', restore: 'PASS', settle: 'PASS', verify: 'PASS' } ) ) throw new Error( `Capture transaction for ${ recipe.id } is not committed with proven restoration.` );
	requireSha256( transaction.entryStateDigest, 'capture transaction entry-state digest' );
	requireSha256( transaction.restoredStateDigest, 'capture transaction restored-state digest' );
	if ( transaction.entryStateDigest !== transaction.restoredStateDigest ) throw new Error( `Capture transaction for ${ recipe.id } did not restore the entry-state digest.` );
	requireSha256( effectiveStateDigest, 'capture effective-state digest' );
	const [ expectedRecipeDigest, expectedRecipeSetDigest, expectedEntryStateDigest, expectedEffectiveStateDigest, expectedRestoredStateDigest ] = await Promise.all( [
		correctnessCaptureRecipeDigest( recipe.id ),
		correctnessCaptureRecipeSetDigest(),
		sha256Hex( entryState ),
		sha256Hex( effectiveState ),
		sha256Hex( restoredState )
	] );
	if ( recipeDigest !== expectedRecipeDigest ) throw new Error( `Capture recipe ${ recipe.id } digest does not match the frozen recipe.` );
	if ( recipeSetDigest !== expectedRecipeSetDigest ) throw new Error( `Capture recipe ${ recipe.id } recipe-set digest does not match the frozen recipe set.` );
	if ( transaction.entryStateDigest !== expectedEntryStateDigest || transaction.restoredStateDigest !== expectedRestoredStateDigest ) throw new Error( `Capture transaction for ${ recipe.id } state digests do not match the retained states.` );
	if ( effectiveStateDigest !== expectedEffectiveStateDigest ) throw new Error( `Capture recipe ${ recipe.id } effective-state digest does not match the retained state.` );
	assertObservedRecipeState( effectiveState, recipe );
	if ( stableStringify( entryState ) !== stableStringify( restoredState ) ) throw new Error( `Capture transaction for ${ recipe.id } did not restore the exact observed state.` );
	requireRecord( resources, 'capture resources' );
	for ( const phase of [ 'entry', 'effective', 'restored' ] ) validateValidationResourceLedger( requireRecord( resources[ phase ], `capture resources.${ phase }` ) );
	assertRestoredResourceState( resources.entry, resources.restored, recipe.id );
	requireRecord( submissions, 'capture submissions' );
	assertRecipeExecutionTrace( recipe, entryState, telemetry, submissions );
	assertCaptureLayouts( layouts, effectiveState, recipe.id );

	return cloneJsonSafeCaptureEvidence( {
		schemaVersion: 1,
		evidenceKind: 'validation-harness-correctness-capture-transaction-v1',
		claimScope: {
			correctness: true,
			performance: false,
			gpuAttribution: false
		},
		recipe: {
			id: recipe.id,
			schemaVersion: recipe.schemaVersion,
			digest: recipeDigest,
			setDigest: recipeSetDigest,
			parentRoute: recipe.parentRoute,
			captureFilename: recipe.capture.filename,
			target: recipe.capture.target,
			declaredEffectiveState: recipe.effectiveState,
			expectedSceneScale: recipe.expectedSceneScale
		},
		transaction,
		parentStartupStateDigest: transaction.entryStateDigest,
		entryState,
		effectiveState,
		effectiveStateDigest,
		restoredState,
		resources,
		telemetry,
		submissions,
		runtimeProfile,
		passScale: effectiveState.passScale,
		layouts
	}, 'capture evidence envelope' );

}

export function createExclusiveControllerOperationGate( assertCaptureAvailable ) {

	if ( typeof assertCaptureAvailable !== 'function' ) throw new TypeError( 'Exclusive controller gate requires a capture-availability assertion.' );
	let active = null;
	let nextSequence = 1;

	function assertAvailable( operation, options = {} ) {

		const label = typeof operation === 'string' && operation.length > 0 ? operation : 'operation';
		if ( active !== null ) throw new Error( `Cannot start ${ label }; controller operation ${ active.id } is active.` );
		assertCaptureAvailable( label, options );
		return true;

	}

	async function run( operation, execute, options = {} ) {

		if ( typeof execute !== 'function' ) throw new TypeError( 'Exclusive controller operation requires an execute function.' );
		assertAvailable( operation, options );
		const sequence = nextSequence ++;
		active = Object.freeze( { id: `controller-operation-${ sequence }`, operation, sequence } );
		try {

			return await execute();

		} finally {

			active = null;

		}

	}

	function status() {

		return Object.freeze( {
			active: active === null ? null : { ...active },
			nextSequence
		} );

	}

	return Object.freeze( { assertAvailable, run, status } );

}

export function createJoinableControllerDisposal() {

	let promise = null;

	function joinOrStart( start ) {

		if ( promise !== null ) return promise;
		if ( typeof start !== 'function' ) throw new TypeError( 'Joinable controller disposal requires a start function.' );
		const result = start();
		promise = Promise.resolve( result );
		return promise;

	}

	function status() {

		return Object.freeze( { started: promise !== null } );

	}

	return Object.freeze( { joinOrStart, status } );

}

export function createValidationResourceLedgerObserver( { renderer, scenePass, captureTarget, geometries } ) {

	let currentLedger = null;
	let state = 'live';
	return Object.freeze( {
		describeLive() {

			if ( state !== 'live' ) throw new Error( 'Cannot observe live validation resources after disposal.' );
			currentLedger = buildValidationResourceLedger( {
				renderer,
				scenePass,
				captureTarget,
				geometries,
				previousLedger: currentLedger
			} );
			return currentLedger;

		},
		describeDisposed() {

			if ( state === 'disposed' ) return currentLedger;
			if ( currentLedger?.state !== 'live' ) throw new Error( 'Validation resource disposal requires an exact live predecessor observation.' );
			currentLedger = emptyValidationResourceLedger( { renderer, previousLedger: currentLedger } );
			state = 'disposed';
			return currentLedger;

		},
		current() {

			return currentLedger;

		}
	} );

}

export async function createNativeWebGPUValidationSubject( canvas, options = {} ) {

	if ( canvas === null || typeof canvas !== 'object' ) throw new Error( 'A canvas is required.' );
	if ( navigator.gpu === undefined ) throw new Error( 'WebGPU adapter required for canonical visual validation. No fallback is activated.' );
	const runtimeProfile = options.runtimeProfile ?? 'correctness';
	const routeLock = options.routeLock ?? null;
	const controllerGeneration = nextControllerGeneration ++;
	const rendererDeviceGeneration = nextRendererDeviceGeneration ++;
	requireKnown( RUNTIME_PROFILES, runtimeProfile, 'runtime profile' );
	const timestampQueriesRequired = runtimeProfile === 'performance';
	const timestampQueriesRequested = timestampQueriesRequired;
	const rendererParameters = { ...options.rendererParameters };
	let ownedDevice = null;
	let adapterSnapshot = null;
	if ( rendererParameters.device === undefined ) {

		const adapter = await navigator.gpu.requestAdapter( {
			powerPreference: rendererParameters.powerPreference,
			featureLevel: 'compatibility',
			xrCompatible: false
		} );
		if ( adapter === null ) throw new Error( 'Unable to create the canonical WebGPU adapter. No fallback is activated.' );
		adapterSnapshot = snapshotGpuAdapter( adapter );
		const deviceDescriptor = { requiredFeatures: [ ...adapter.features ] };
		if ( rendererParameters.requiredLimits !== undefined ) deviceDescriptor.requiredLimits = rendererParameters.requiredLimits;
		ownedDevice = await adapter.requestDevice( deviceDescriptor );
		rendererParameters.device = ownedDevice;

	}

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		...rendererParameters,
		trackTimestamp: timestampQueriesRequested
	} );
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = NeutralToneMapping;

	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) {

		renderer.dispose();
		ownedDevice?.destroy();
		throw new Error( 'WebGPU backend required for canonical visual validation. No fallback is activated.' );

	}
	const requestedDevice = rendererParameters.device ?? null;
	const rendererDevice = assertRendererBackendDeviceIdentity( requestedDevice, renderer.backend.device ?? null );
	let rendererDeviceStatus = 'active';
	let deviceLossGeneration = 0;
	let deviceLostObserved = false;
	let intentionalDeviceDestroyObserved = false;
	let lastDeviceError = null;
	const uncapturedErrors = [];
	let uncapturedErrorListenerInstalled = false;
	let disposeEvidence = null;
	let lossPromiseObservedOnActualDevice = false;
	if ( rendererDevice.lost && typeof rendererDevice.lost.then === 'function' ) {

		lossPromiseObservedOnActualDevice = true;
		rendererDevice.lost.then( ( info ) => {

			const reason = String( info?.reason ?? '' ).toLowerCase();
			if ( ( rendererDeviceStatus === 'disposing' || rendererDeviceStatus === 'disposed' ) && reason === 'destroyed' ) {

				intentionalDeviceDestroyObserved = true;
				return;

			}
			deviceLostObserved = true;
			deviceLossGeneration ++;
			rendererDeviceStatus = 'lost';
			lastDeviceError = String( info?.message ?? info?.reason ?? 'GPU device lost' );

		} );

	}
	const onUncapturedError = ( event ) => {

		const message = String( event?.error?.message ?? event?.message ?? 'uncaptured GPU device error' );
		uncapturedErrors.push( message );
		lastDeviceError = message;

	};
	if ( typeof rendererDevice.addEventListener === 'function' ) {

		rendererDevice.addEventListener( 'uncapturederror', onUncapturedError );
		uncapturedErrorListenerInstalled = true;

	}

	const scene = new Scene();
	scene.background = new Color( 0x070b14 );
	const camera = new PerspectiveCamera( 45, 1, 0.1, 100 );

	const key = new DirectionalLight( 0xffffff, 4 );
	key.position.set( 4, 7, 5 );
	const fill = new AmbientLight( 0x80a0ff, 0.35 );
	scene.add( key, fill );

	const subjectMaterial = new MeshStandardNodeMaterial();
	subjectMaterial.colorNode = color( 0x2468d8 );
	subjectMaterial.roughnessNode = float( 0.32 );
	subjectMaterial.metalnessNode = float( 0.18 );
	subjectMaterial.emissiveNode = color( 0xff5a16 ).mul( float( 1.7 ) );
	const subject = new Mesh( new TorusKnotGeometry( 1, 0.3, 192, 32 ), subjectMaterial );
	subject.position.y = 1.25;
	scene.add( subject );

	const groundMaterial = new MeshStandardNodeMaterial();
	groundMaterial.colorNode = color( 0x172033 );
	groundMaterial.roughnessNode = float( 0.82 );
	groundMaterial.metalnessNode = float( 0 );
	groundMaterial.emissiveNode = color( 0x000000 );
	const ground = new Mesh( new PlaneGeometry( 14, 14 ), groundMaterial );
	ground.rotation.x = - Math.PI / 2;
	scene.add( ground );

	const markerMaterial = new MeshStandardNodeMaterial();
	markerMaterial.colorNode = color( 0xd6e4ff );
	markerMaterial.roughnessNode = float( 0.55 );
	markerMaterial.metalnessNode = float( 0.05 );
	markerMaterial.emissiveNode = color( 0x000000 );
	const marker = new Mesh( new BoxGeometry( 0.65, 0.65, 0.65 ), markerMaterial );
	marker.position.set( - 2.15, 0.35, - 0.5 );
	scene.add( marker );
	const ownedControls = new Set();
	const ownedMaterials = new Set( [ subjectMaterial, groundMaterial, markerMaterial ] );
	const ownedGeometries = [ subject.geometry, ground.geometry, marker.geometry ];

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = configureExplicitRenderSubmissionPass( pass( scene, camera ) );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );

	const outputNode = scenePass.getTextureNode( 'output' );
	const normalNode = scenePass.getTextureNode( 'normal' );
	const emissiveNode = scenePass.getTextureNode( 'emissive' );
	const depthNode = scenePass.getTextureNode( 'depth' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	const finalLinearNode = vec4( outputNode.rgb.add( emissiveNode.rgb.mul( float( FINAL_EMISSIVE_COMPOSITE_STRENGTH ) ) ), outputNode.a );
	const modeNodes = {
		final: renderOutput( finalLinearNode ),
		'no-post': renderOutput( outputNode ),
		normal: renderOutput( vec4( normalNode.rgb.mul( 0.5 ).add( 0.5 ), 1 ) ),
		emissive: renderOutput( vec4( emissiveNode.rgb, 1 ) )
	};
	if ( new Set( Object.values( modeNodes ) ).size !== Object.keys( modeNodes ).length ) throw new Error( 'Validation output routes must own distinct TSL output nodes.' );
	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = modeNodes.final;
	renderPipeline.needsUpdate = true;
	let activeFinalRenderTarget = null;
	const timestampInspector = new ValidationTimestampInspector( ( render ) => {

		if ( render.scene === scene && render.camera === camera && render.renderTarget === scenePass.renderTarget ) return 'scene-mrt';
		if ( render.scene !== scene && render.renderTarget === activeFinalRenderTarget ) return 'final-output';
		return null;

	} );
	renderer.inspector = timestampInspector;
	let scenePassExecutionCount = 0;
	const updateScenePass = scenePass.updateBefore.bind( scenePass );
	scenePass.updateBefore = ( frame ) => {

		scenePassExecutionCount ++;
		return updateScenePass( frame );

	};

	let scenario = 'browser-capture';
	let mode = 'final';
	let tier = 'webgpu-correctness';
	let cameraId = 'design';
	let seed = 0x00000001;
	let timeSeconds = 0;
	let width = 1200;
	let height = 800;
	let dpr = 1;
	let disposed = false;
	let captureTarget = new RenderTarget( width, height, { type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.colorSpace = SRGBColorSpace;
	captureTarget.texture.name = 'validation-capture-rgba8';
	const resourceLedgerObserver = createValidationResourceLedgerObserver( {
		renderer,
		scenePass,
		captureTarget,
		geometries: ownedGeometries
	} );
	const cpuFrameSamples = [];
	const resetEvents = [];
	let renderSubmissionCount = 0;
	let modeSelectionCount = 0;
	let activeCaptureResourceRestoration = null;
	let postCommitPoison = null;

	function requireLive() {

		if ( disposed ) throw new Error( 'Validation subject is disposed.' );

	}

	function assertControllerAvailable( operation, options = {} ) {

		requireLive();
		operationGate.assertAvailable( operation, options );

	}

	async function runExclusiveControllerOperation( operation, execute, options = {} ) {

		requireLive();
		return operationGate.run( operation, execute, options );

	}

	function applyCamera() {

		const bookmark = CAMERAS.get( cameraId );
		camera.position.fromArray( bookmark.position );
		camera.lookAt( ...bookmark.target );
		camera.updateMatrixWorld( true );
		camera.updateProjectionMatrix();

	}

	function applyTime() {

		const base = seededAngle( seed );
		subject.rotation.set( 0.25 + 0.15 * Math.sin( timeSeconds * 0.7 ), base + timeSeconds * 0.42, timeSeconds * 0.17 );
		subject.updateMatrixWorld( true );

	}

	function applyTier() {

		scenePass.setResolutionScale( TIERS.get( tier ).passScale );

	}

	function applyMode() {

		renderPipeline.outputNode = modeNodes[ mode ];
		renderPipeline.needsUpdate = true;
		modeSelectionCount ++;

	}

	function setScenarioInternal( id ) {

		requireKnown( SCENARIOS, id, 'scenario' );
		scenario = id;
		const scenarioIndex = SCENARIO_IDS.indexOf( id );
		marker.position.x = - 2.15 + ( scenarioIndex % 4 ) * 0.22;
		marker.position.z = - 0.5 + Math.floor( scenarioIndex / 4 ) * 0.5;
		marker.updateMatrixWorld( true );

	}

	function setModeInternal( id ) {

		requireKnown( MODES, id, 'mode' );
		mode = id;
		applyMode();

	}

	function setTierInternal( id ) {

		requireKnown( TIERS, id, 'tier' );
		tier = id;
		applyTier();

	}

	function setSeedInternal( nextSeed ) {

		requireKnown( SEEDS, nextSeed, 'seed' );
		seed = nextSeed >>> 0;
		applyTime();

	}

	function setCameraInternal( id ) {

		requireKnown( CAMERAS, id, 'camera' );
		cameraId = id;
		applyCamera();

	}

	function setTimeInternal( seconds ) {

		if ( Number.isFinite( seconds ) === false || seconds < 0 ) throw new Error( 'Time must be a finite nonnegative number.' );
		timeSeconds = seconds;
		applyTime();

	}

	function resetHistoryInternal( cause ) {

		if ( typeof cause !== 'string' || cause.length === 0 ) throw new Error( 'History reset cause is required.' );
		resetEvents.push( { cause, timeSeconds } );
		renderPipeline.needsUpdate = true;

	}

	function resizeInternal( nextWidth, nextHeight, nextDpr ) {

		for ( const [ value, label ] of [ [ nextWidth, 'width' ], [ nextHeight, 'height' ], [ nextDpr, 'DPR' ] ] ) {

			if ( Number.isFinite( value ) === false || value <= 0 ) throw new Error( `${ label } must be finite and positive.` );

		}
		if ( Number.isInteger( nextWidth ) === false || Number.isInteger( nextHeight ) === false ) throw new Error( 'Viewport dimensions must be integers.' );
		width = nextWidth;
		height = nextHeight;
		dpr = nextDpr;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio( dpr );
		renderer.setSize( width, height, false );
		captureTarget.setSize( Math.max( 1, Math.round( width * dpr ) ), Math.max( 1, Math.round( height * dpr ) ) );

	}

	async function renderTo( target ) {

		const previousTarget = renderer.getRenderTarget();
		activeFinalRenderTarget = target;
		try {

			renderer.setRenderTarget( target );
			const start = performance.now();
			renderPipeline.render();
			renderSubmissionCount ++;
			if ( activeCaptureResourceRestoration !== null ) activeCaptureResourceRestoration.renderTrace.push( {
				sequence: renderSubmissionCount,
				timeSeconds,
				target: target === null ? 'presentation' : target === captureTarget ? 'capture-target' : 'other',
				mode,
				tier
			} );
			const cpuMs = performance.now() - start;
			cpuFrameSamples.push( cpuMs );
			return cpuMs;

		} finally {

			renderer.setRenderTarget( previousTarget );
			activeFinalRenderTarget = null;

		}

	}

	function advanceTimeInternal( deltaSeconds ) {

		if ( Number.isFinite( deltaSeconds ) === false || deltaSeconds < 0 ) throw new Error( 'Delta time must be finite and nonnegative.' );
		timeSeconds += deltaSeconds;
		applyTime();

	}

	async function stepInternal( deltaSeconds ) {

		advanceTimeInternal( deltaSeconds );
		await renderTo( null );

	}

	async function readbackCurrentModeInternal( target ) {

		assertCurrentLockedCaptureMode( target, mode );
		await renderTo( captureTarget );
		const pixelWidth = captureTarget.width;
		const pixelHeight = captureTarget.height;
		const padded = await renderer.readRenderTargetPixelsAsync( captureTarget, 0, 0, pixelWidth, pixelHeight );
		const unpacked = unpackAlignedReadback( padded, pixelWidth, pixelHeight, 4 );
		const normalizedPadded = new Uint8Array( unpacked.layout.fullyPaddedByteLength );
		for ( let row = 0; row < pixelHeight; row ++ ) normalizedPadded.set(
			unpacked.pixels.subarray( row * unpacked.layout.rowBytes, ( row + 1 ) * unpacked.layout.rowBytes ),
			row * unpacked.layout.bytesPerRow
		);
		return {
			target,
			width: pixelWidth,
			height: pixelHeight,
			bytesPerPixel: 4,
			rowBytes: unpacked.layout.rowBytes,
			sourceBytesPerRow: unpacked.layout.bytesPerRow,
			format: 'rgba8unorm',
			colorManaged: true,
			outputColorSpace: renderer.outputColorSpace,
			encoding: renderer.outputColorSpace,
			origin: 'top-left',
			transport: {
				layout: {
					width: pixelWidth,
					height: pixelHeight,
					rowBytes: unpacked.layout.rowBytes,
					bytesPerRow: unpacked.layout.bytesPerRow,
					byteLength: unpacked.sourceByteLength,
					format: 'rgba8unorm',
					origin: 'top-left',
					padding: unpacked.sourceByteLength === unpacked.layout.fullyPaddedByteLength ? 'full-final-row' : 'tight-final-row'
				},
				data: padded
			},
			normalized: {
				layout: {
					width: pixelWidth,
					height: pixelHeight,
					rowBytes: unpacked.layout.rowBytes,
					bytesPerRow: unpacked.layout.bytesPerRow,
					byteLength: unpacked.layout.fullyPaddedByteLength,
					format: 'rgba8unorm',
					origin: 'top-left'
				},
				data: normalizedPadded
			},
			pixels: unpacked.pixels,
			readbackLayout: unpacked.layout,
			sourceByteLength: unpacked.sourceByteLength
		};

	}

	function snapshotSubmissionState() {

		return {
			renderSubmissionCount,
			scenePassExecutionCount,
			modeSelectionCount
		};

	}

	function snapshotDeviceTuple() {

		return {
			controllerGeneration,
			rendererDeviceGeneration,
			deviceLossGeneration,
			rendererDeviceStatus,
			deviceLostObserved,
			backendDeviceIdentityVerified: rendererDevice === requestedDevice && rendererDevice === renderer.backend?.device,
			nativeWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
			uncapturedErrorCount: uncapturedErrors.length
		};

	}

	function snapshotRendererTargetIdentity() {

		const target = renderer.getRenderTarget();
		if ( target === null ) return { kind: 'presentation', textureUuid: null };
		if ( target === captureTarget ) return { kind: 'capture-target', textureUuid: captureTarget.texture.uuid };
		if ( target === scenePass.renderTarget ) return { kind: 'scene-pass', textureUuid: scenePass.renderTarget.texture.uuid };
		const textureUuid = target.texture?.uuid ?? target.textures?.[ 0 ]?.uuid ?? null;
		if ( typeof textureUuid !== 'string' || textureUuid.length === 0 ) throw new Error( 'Renderer retained an unknown render target without a stable texture UUID.' );
		return { kind: 'other', textureUuid };

	}

	function snapshotOutputNodeIdentity() {

		const matches = Object.entries( modeNodes ).filter( ( [ , node ] ) => node === renderPipeline.outputNode );
		if ( matches.length !== 1 ) throw new Error( 'RenderPipeline outputNode does not match exactly one canonical mode-node identity.' );
		const [ activeMode, node ] = matches[ 0 ];
		return {
			mode: activeMode,
			id: VALIDATION_MODE_OUTPUT_NODE_IDS[ activeMode ],
			uuid: node.uuid,
			type: node.type
		};

	}

	function snapshotCaptureState() {

		const outputIdentity = snapshotOutputNodeIdentity();
		return cloneJsonSafeCaptureEvidence( {
			schemaVersion: 1,
			scenario,
			mode,
			tier,
			camera: cameraId,
			seed,
			timeSeconds,
			viewport: { width, height, dpr },
			passScale: scenePass.getResolutionScale(),
			outputNodeMode: outputIdentity.mode,
			outputNodeId: outputIdentity.id,
			outputNodeUuid: outputIdentity.uuid,
			outputNodeType: outputIdentity.type,
			cameraState: {
				matrixWorld: camera.matrixWorld.toArray(),
				projectionMatrix: camera.projectionMatrix.toArray()
			},
			subjectMatrixWorld: subject.matrixWorld.toArray(),
			markerPosition: marker.position.toArray(),
			captureTarget: { width: captureTarget.width, height: captureTarget.height },
			sceneTarget: { width: scenePass.renderTarget.width, height: scenePass.renderTarget.height },
			rendererTarget: snapshotRendererTargetIdentity(),
			device: snapshotDeviceTuple()
		}, 'capture state snapshot' );

	}

	function snapshotCaptureTelemetry() {

		return cloneJsonSafeCaptureEvidence( {
			resetEventCount: resetEvents.length,
			resetEvents: resetEvents.map( ( event ) => ( { ...event } ) )
		}, 'capture telemetry snapshot' );

	}

	async function settleGpuQueueAndMicrotask( phase ) {

		if ( typeof rendererDevice.queue?.onSubmittedWorkDone !== 'function' ) throw new Error( `${ phase } cannot prove GPU queue settlement.` );
		await rendererDevice.queue.onSubmittedWorkDone();
		await Promise.resolve();

	}

	function restoreCaptureStateInternal( entryState ) {

		setScenarioInternal( entryState.scenario );
		setTierInternal( entryState.tier );
		setModeInternal( entryState.mode );
		setCameraInternal( entryState.camera );
		setSeedInternal( entryState.seed );
		setTimeInternal( entryState.timeSeconds );
		resizeInternal( entryState.viewport.width, entryState.viewport.height, entryState.viewport.dpr );

	}

	async function applyCorrectnessCaptureRecipeInternal( recipe ) {

		const state = recipe.effectiveState;
		setScenarioInternal( state.scenario );
		setTierInternal( state.tier );
		setModeInternal( state.mode );
		setCameraInternal( state.camera );
		setSeedInternal( state.seed );
		setTimeInternal( state.timeline.initialTimeSeconds );
		resizeInternal( state.viewport.width, state.viewport.height, state.viewport.dpr );
		if ( state.timeline.resetHistoryCause !== null ) resetHistoryInternal( state.timeline.resetHistoryCause );
		for ( const deltaSeconds of state.timeline.stepSeconds ) {

			await renderTo( null );
			advanceTimeInternal( deltaSeconds );

		}
		if ( timeSeconds !== state.timeSeconds ) throw new Error( `Capture recipe ${ recipe.id } timeline ended at ${ timeSeconds } instead of ${ state.timeSeconds }.` );

	}

	async function resolveAttributedRenderBatch( label, expectedFrames ) {

		const queryPool = renderer.backend.timestampQueryPool.render;
		const pendingUids = queryPool ? [ ...queryPool.queryOffsets.keys() ] : [];
		if ( pendingUids.length !== expectedFrames * timestampResolutionPolicy.contextsPerFrame ) throw new Error( `${ label } expected ${ expectedFrames * timestampResolutionPolicy.contextsPerFrame } render contexts, received ${ pendingUids.length }.` );
		const resolvedLastFrameTotalMs = await renderer.resolveTimestampsAsync( 'render' );
		const entries = pendingUids.map( ( uid ) => ( {
			uid,
			stage: timestampInspector.stageFor( uid ),
			durationMs: renderer.backend.getTimestamp( uid )
		} ) );
		return summarizeTimestampBatch( { entries, resolvedLastFrameTotalMs } );

	}

	function currentRenderTargetBytes() {

		return resourceLedgerObserver.describeLive().trackedRenderTargetBytes;

	}

	const captureCoordinator = createFailClosedCaptureCoordinator( {
		async snapshotState() {

			return snapshotCaptureState();

		},
		async digestState( state ) {

			return sha256Hex( state );

		},
		async restoreState( entryState ) {

			restoreCaptureStateInternal( entryState );
			await renderTo( null );

		},
		async settleRestoration( entryState ) {

			await settleGpuQueueAndMicrotask( 'Capture restoration' );
			assertCaptureDeviceTupleUnchanged( entryState.device, snapshotDeviceTuple(), 'Capture restoration' );

		},
		async verifyRestoration( evidence ) {

			assertCaptureDeviceTupleUnchanged( evidence.entryState.device, evidence.restoredState.device, 'Capture restoration verification' );
			if ( evidence.entryStateDigest !== evidence.restoredStateDigest ) return false;
			if ( stableStringify( evidence.entryState ) !== stableStringify( evidence.restoredState ) ) return false;
			if ( renderPipeline.outputNode !== modeNodes[ evidence.entryState.mode ] ) return false;
			if ( scenePass.getResolutionScale() !== evidence.entryState.passScale ) return false;
			if ( activeCaptureResourceRestoration?.recipeId !== evidence.recipe.id || activeCaptureResourceRestoration.entry === null ) throw new Error( `Capture recipe ${ evidence.recipe.id } has no entry resource snapshot.` );
			activeCaptureResourceRestoration.restored = resourceLedgerObserver.describeLive();
			assertRestoredResourceState( activeCaptureResourceRestoration.entry, activeCaptureResourceRestoration.restored, evidence.recipe.id );
			return true;

		}
	} );
	const operationGate = createExclusiveControllerOperationGate( ( operation, options ) => {

		if ( postCommitPoison !== null && options.allowPoisoned !== true ) throw new Error( `Cannot start ${ operation }; capture controller is poisoned after ${ postCommitPoison.recipeId }: ${ postCommitPoison.reason }` );
		captureCoordinator.assertAvailable( operation, options );

	} );
	const disposal = createJoinableControllerDisposal();

	applyCamera();
	applyTime();
	applyTier();
	renderer.setPixelRatio( dpr );
	renderer.setSize( width, height, false );

	const controller = {
		get labId() {

			return VALIDATION_HARNESS_LAB_ID;

		},
		async ready() {

			return runExclusiveControllerOperation( 'ready', async () => {

				await renderTo( null );

			} );

		},

		async setScenario( id ) {

			assertControllerAvailable( 'setScenario' );
			setScenarioInternal( id );

		},

		async setMode( id ) {

			assertControllerAvailable( 'setMode' );
			setModeInternal( id );

		},

		async runMechanismReachabilityProfile() {

			return runExclusiveControllerOperation( 'runMechanismReachabilityProfile', async () => {

				const originalMode = mode;
				const routeExecutions = [];
				for ( const id of Object.keys( VALIDATION_MODE_OUTPUT_NODE_IDS ) ) {

					setModeInternal( id );
					const before = renderSubmissionCount;
					const selectedOutputNodeId = Object.entries( modeNodes ).find( ( [ , node ] ) => node === renderPipeline.outputNode )?.[ 0 ] ?? null;
					const selectedOutputNodeIdentityVerified = renderPipeline.outputNode === modeNodes[ id ];
					const graphMarkedDirtyBeforeRender = renderPipeline.needsUpdate === true;
					await renderTo( null );
					routeExecutions.push( {
						mode: id,
						outputNodeId: VALIDATION_MODE_OUTPUT_NODE_IDS[ id ],
						selectedOutputNodeId: selectedOutputNodeId === null ? null : VALIDATION_MODE_OUTPUT_NODE_IDS[ selectedOutputNodeId ],
						selectedOutputNodeIdentityVerified,
						graphMarkedDirtyBeforeRender,
						renderSubmissionCountBefore: before,
						renderSubmissionCountAfter: renderSubmissionCount,
						renderSubmissionDelta: renderSubmissionCount - before
					} );

				}

				const modeBeforeNegativeControl = mode;
				const outputNodeBeforeNegativeControl = renderPipeline.outputNode;
				let unknownModeRejected = false;
				let unknownModeError = null;
				try {

					setModeInternal( '__invalid-mechanism-route__' );

				} catch ( error ) {

					unknownModeRejected = true;
					unknownModeError = error.message;

				}
				const negativeControls = {
					unknownModeRejected,
					unknownModeError,
					modeStatePreserved: mode === modeBeforeNegativeControl,
					outputNodeIdentityPreserved: renderPipeline.outputNode === outputNodeBeforeNegativeControl
				};
				setModeInternal( originalMode );
				return {
					proofKind: 'native-browser-runtime',
					runtimeProfile,
					routeExecutions,
					negativeControls,
					modeSelectionCount,
					renderSubmissionCount,
					reachableSignals: [ 'output', 'normal', 'emissive', 'depth' ],
					reachableResources: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ]
				};

			} );

		},

		async setTier( id ) {

			assertControllerAvailable( 'setTier' );
			setTierInternal( id );

		},

		async setSeed( nextSeed ) {

			assertControllerAvailable( 'setSeed' );
			setSeedInternal( nextSeed );

		},

		async setCamera( id ) {

			assertControllerAvailable( 'setCamera' );
			setCameraInternal( id );

		},

		async setTime( seconds ) {

			assertControllerAvailable( 'setTime' );
			setTimeInternal( seconds );

		},

		async step( deltaSeconds ) {

			return runExclusiveControllerOperation( 'step', async () => stepInternal( deltaSeconds ) );

		},

		async resetHistory( cause ) {

			assertControllerAvailable( 'resetHistory' );
			resetHistoryInternal( cause );

		},

		async resize( nextWidth, nextHeight, nextDpr ) {

			assertControllerAvailable( 'resize' );
			resizeInternal( nextWidth, nextHeight, nextDpr );

		},

		async renderOnce() {

			return runExclusiveControllerOperation( 'renderOnce', async () => {

				await renderTo( null );

			} );

		},

		async capturePixels( target = mode ) {

			return runExclusiveControllerOperation( 'capturePixels', async () => readbackCurrentModeInternal( target ) );

		},

		async captureRecipe( id ) {

			return runExclusiveControllerOperation( 'captureRecipe', async () => {

				const recipe = getCorrectnessCaptureRecipe( id );
				assertCorrectnessCaptureRecipeContext( { runtimeProfile, routeLock, recipe } );
				assertCorrectnessCaptureEntryState( snapshotCaptureState(), routeLock );
				const resourceRestoration = { recipeId: recipe.id, entry: null, restored: null, renderTrace: [] };
				activeCaptureResourceRestoration = resourceRestoration;
				try {

					const coordinated = await captureCoordinator.run( recipe, async ( transactionContext ) => {

						const entryResources = resourceLedgerObserver.describeLive();
						resourceRestoration.entry = entryResources;
						const entrySubmissions = snapshotSubmissionState();
						const entryTelemetry = snapshotCaptureTelemetry();
						await applyCorrectnessCaptureRecipeInternal( recipe );
						const readback = await readbackCurrentModeInternal( recipe.capture.target );
						await settleGpuQueueAndMicrotask( `Capture recipe ${ recipe.id }` );
						const effectiveState = snapshotCaptureState();
						assertCaptureDeviceTupleUnchanged( transactionContext.entryState.device, effectiveState.device, `Capture recipe ${ recipe.id }` );
						const effectiveResources = resourceLedgerObserver.describeLive();
						const effectiveSubmissions = snapshotSubmissionState();
						const effectiveTelemetry = snapshotCaptureTelemetry();
						const [ recipeDigest, recipeSetDigest, effectiveStateDigest ] = await Promise.all( [
							correctnessCaptureRecipeDigest( recipe.id ),
							correctnessCaptureRecipeSetDigest(),
							sha256Hex( effectiveState )
						] );
						return {
							...readback,
							captureEvidenceDraft: {
								recipeDigest,
								recipeSetDigest,
								entryState: transactionContext.entryState,
								effectiveState,
								effectiveStateDigest,
								entryResources,
								effectiveResources,
								entrySubmissions,
								effectiveSubmissions,
								entryTelemetry,
								effectiveTelemetry
							}
						};

					} );
					const restoredState = snapshotCaptureState();
					const restoredStateDigest = await sha256Hex( restoredState );
					try {

						assertCaptureDeviceTupleUnchanged( restoredState.device, snapshotDeviceTuple(), 'Post-commit evidence finalization' );

					} catch ( error ) {

						postCommitPoison = Object.freeze( { recipeId: recipe.id, reason: String( error?.message ?? error ) } );
						throw error;

					}
					if ( restoredStateDigest !== coordinated.transaction.restoredStateDigest ) throw new Error( `Capture recipe ${ recipe.id } restored-state digest drifted after commit.` );
					if ( resourceRestoration.restored === null ) throw new Error( `Capture recipe ${ recipe.id } has no verified restored resource snapshot.` );
					const restoredSubmissions = snapshotSubmissionState();
					const restoredTelemetry = snapshotCaptureTelemetry();
					const draft = coordinated.captureEvidenceDraft;
					const captureRenderCount = draft.effectiveSubmissions.renderSubmissionCount - draft.entrySubmissions.renderSubmissionCount;
					const telemetry = {
						entry: draft.entryTelemetry,
						effective: draft.effectiveTelemetry,
						restored: restoredTelemetry,
						appendedDuringCapture: draft.effectiveTelemetry.resetEvents.slice( draft.entryTelemetry.resetEventCount ),
						appendedDuringRestoration: restoredTelemetry.resetEvents.slice( draft.effectiveTelemetry.resetEventCount ),
						historyResetDelta: draft.effectiveTelemetry.resetEventCount - draft.entryTelemetry.resetEventCount,
						restorationHistoryResetDelta: restoredTelemetry.resetEventCount - draft.effectiveTelemetry.resetEventCount
					};
					const submissions = {
						entry: draft.entrySubmissions,
						effective: draft.effectiveSubmissions,
						restored: restoredSubmissions,
						captureDelta: {
							renderSubmissions: draft.effectiveSubmissions.renderSubmissionCount - draft.entrySubmissions.renderSubmissionCount,
							scenePassExecutions: draft.effectiveSubmissions.scenePassExecutionCount - draft.entrySubmissions.scenePassExecutionCount,
							modeSelections: draft.effectiveSubmissions.modeSelectionCount - draft.entrySubmissions.modeSelectionCount
						},
						restorationDelta: {
							renderSubmissions: restoredSubmissions.renderSubmissionCount - draft.effectiveSubmissions.renderSubmissionCount,
							scenePassExecutions: restoredSubmissions.scenePassExecutionCount - draft.effectiveSubmissions.scenePassExecutionCount,
							modeSelections: restoredSubmissions.modeSelectionCount - draft.effectiveSubmissions.modeSelectionCount
						},
						captureRenderTrace: resourceRestoration.renderTrace.slice( 0, captureRenderCount ),
						restorationRenderTrace: resourceRestoration.renderTrace.slice( captureRenderCount )
					};
					const evidence = await finalizeCaptureEvidenceWithDeviceGuard( {
						recipeId: recipe.id,
						entryDevice: restoredState.device,
						observeDevice: snapshotDeviceTuple,
						onPoison( poison ) {

							postCommitPoison = poison;

						},
						buildEvidence: () => buildCaptureRecipeEvidenceEnvelope( {
							recipe,
							recipeDigest: draft.recipeDigest,
							recipeSetDigest: draft.recipeSetDigest,
							routeLock,
							runtimeProfile,
							transaction: coordinated.transaction,
							entryState: draft.entryState,
							effectiveState: draft.effectiveState,
							effectiveStateDigest: draft.effectiveStateDigest,
							restoredState,
							resources: {
								entry: draft.entryResources,
								effective: draft.effectiveResources,
								restored: resourceRestoration.restored
							},
							telemetry,
							submissions,
							layouts: {
								readback: coordinated.readbackLayout,
								transport: coordinated.transport.layout,
								normalized: coordinated.normalized.layout
							}
						} )
					} );
					const { captureEvidenceDraft, target: captureMode, ...captureResult } = coordinated;
					return { ...captureResult, target: recipe.id, captureMode, evidence };

				} finally {

					if ( activeCaptureResourceRestoration === resourceRestoration ) activeCaptureResourceRestoration = null;

				}

			} );

		},

		describePipeline() {

			assertControllerAvailable( 'describePipeline' );
			const timestampQueriesActive = timestampQueriesRequested && renderer.backend?.trackTimestamp === true;
			return {
				runtimeProfile,
				performanceTimestampMode: runtimeProfile === 'performance' ? 'auto' : 'disabled',
				timestampQueriesRequired,
				timestampQueriesRequested,
				timestampQueriesActive,
				owners: {
					renderer: 'native-validation-subject',
					renderPipeline: 'native-validation-subject',
					toneMap: 'renderOutput',
					outputTransform: 'renderOutput'
				},
				signals: [
					{ id: 'output', producer: 'scene-pass', consumers: [ 'final', 'no-post' ] },
					{ id: 'normal', producer: 'scene-pass', consumers: [ 'normal' ] },
					{ id: 'emissive', producer: 'scene-pass', consumers: [ 'final', 'emissive' ] },
					{ id: 'depth', producer: 'scene-pass', consumers: [] }
				],
				sceneSubmissions: [ { id: 'scene-pass', kind: 'full-lit', count: 1 } ],
				computeDispatches: [],
				resources: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ],
				captureRoutes: Object.fromEntries( Object.entries( VALIDATION_MODE_OUTPUT_NODE_IDS ).map( ( [ id, outputNodeId ] ) => [ id, { mode: id, outputNodeId } ] ) ),
				finalToneMapOwner: 'renderOutput',
				finalOutputTransformOwner: 'renderOutput',
				outputColorTransform: renderPipeline.outputColorTransform,
				activeMode: mode,
				activeOutputNode: `${ mode }-output-node`,
				needsUpdate: renderPipeline.needsUpdate,
				renderSubmissionCount,
				modeSelectionCount
			};

		},

		describeResources() {

			if ( disposed && operationGate.status().active === null ) return resourceLedgerObserver.current();
			assertControllerAvailable( 'describeResources' );
			return resourceLedgerObserver.describeLive();

		},

		getMetrics() {

			const adapterClass = adapterSnapshot?.adapterClass ?? 'unknown';
			const adapterIdentity = {
				source: adapterSnapshot?.identitySource ?? 'renderer GPUDevice without retained adapter metadata',
				adapterClass,
				deviceType: adapterClass,
				deviceLabel: adapterSnapshot?.info?.description ?? adapterSnapshot?.info?.device ?? adapterSnapshot?.info?.architecture ?? 'unidentified WebGPU device',
				info: adapterSnapshot?.info ?? {},
				features: adapterSnapshot?.features ?? [],
				limits: adapterSnapshot?.limits ?? {}
			};
			const timestampQueriesActive = timestampQueriesRequested && renderer.backend?.trackTimestamp === true;
			const rendererInfo = snapshotRendererInfo( renderer.info );
			return {
				labId: VALIDATION_HARNESS_LAB_ID,
				threeRevision: '185',
				runtimeProfile,
				routeLock: routeLock === null ? null : { kind: routeLock.kind, id: routeLock.id },
				captureTransaction: captureCoordinator.status(),
				postCommitPoison,
				controllerOperation: operationGate.status(),
				disposal: disposal.status(),
				performanceTimestampMode: runtimeProfile === 'performance' ? 'auto' : 'disabled',
				timestampQueriesRequired,
				timestampQueriesRequested,
				timestampQueriesActive,
				nativeWebGPU: renderer.backend?.isWebGPUBackend === true,
				initialized: renderer.backend?.isWebGPUBackend === true,
				rendererType: 'WebGPURenderer',
				backend: 'WebGPU',
				backendKind: 'WebGPU',
				rendererBackend: 'WebGPUBackend',
				rendererDeviceStatus,
				controllerGeneration,
				rendererDeviceGeneration,
				deviceLossGeneration,
				rendererBackendEvidence: {
					backendKind: 'WebGPU',
					backendType: 'WebGPUBackend',
					isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
					initialized: true,
					deviceIdentityVerified: rendererDevice === requestedDevice && rendererDevice === renderer.backend.device,
					deviceIdentitySource: 'strict identity equality between requested GPUDevice and renderer.backend.device after renderer.init()',
					deviceType: adapterClass,
					lossPromiseObservedOnActualDevice,
					rendererDeviceGeneration
				},
				adapterClass,
				adapterIdentity,
				scenario,
				mode,
				tier,
				camera: cameraId,
				cameraState: {
					matrixWorld: camera.matrixWorld.toArray(),
					projectionMatrix: camera.projectionMatrix.toArray(),
					near: camera.near,
					far: camera.far
				},
				seed,
				seedHex: `0x${ seed.toString( 16 ).padStart( 8, '0' ) }`,
				timeSeconds,
				viewport: { width, height, dpr },
				cpuFrameMs: {
					samples: [ ...cpuFrameSamples ],
					p50: percentile( cpuFrameSamples, 0.5 ),
					p95: percentile( cpuFrameSamples, 0.95 )
				},
				resetEvents: [ ...resetEvents ],
				adapter: adapterSnapshot,
				deviceLostObserved,
				intentionalDeviceDestroyObserved,
				uncapturedErrors: [ ...uncapturedErrors ],
				lastDeviceError,
				listenerState: {
					uncapturedErrorListeners: uncapturedErrorListenerInstalled ? 1 : 0,
					runtimeEventListeners: uncapturedErrorListenerInstalled ? 1 : 0
				},
				lifecycleState: {
					activeControls: ownedControls.size,
					activeMaterials: ownedMaterials.size,
					rendererStateDisposition: disposed ? 'OWNED_RENDERER_DISPOSED' : 'ACTIVE_OWNED_RENDERER'
				},
				disposeEvidence,
				rendererState: {
					renderer: 'WebGPURenderer',
					outputColorSpace: renderer.outputColorSpace,
					toneMapping: 'NeutralToneMapping',
					toneMappingExposure: renderer.toneMappingExposure,
					outputBufferType: 'HalfFloatType',
					sampleCount: 1,
					depthMode: 'standard',
					compatibilityMode: null
				},
				rendererInfo: {
					...rendererInfo,
					rendererType: 'WebGPURenderer',
					threeRevision: '185',
					backendType: 'WebGPUBackend',
					adapterClass,
					adapterIdentity
				},
				renderSubmissionCount,
				modeSelectionCount
			};

		},

		async resolveGpuTimings() {

			return runExclusiveControllerOperation( 'resolveGpuTimings', async () => {

				if ( timestampQueriesRequested === false ) return { verdict: 'NOT_CLAIMED', renderMs: null, computeMs: null, reason: 'Correctness profile does not request GPU timestamps.' };
				try {

					const renderMs = await renderer.resolveTimestampsAsync( 'render' );
					const computeMs = await renderer.resolveTimestampsAsync( 'compute' );
					if ( Number.isFinite( renderMs ) === false ) throw new Error( 'render timestamp unavailable' );
					return { verdict: 'PASS', renderMs, computeMs: Number.isFinite( computeMs ) ? computeMs : null, reason: null };

				} catch ( error ) {

					return { verdict: 'INSUFFICIENT_EVIDENCE', renderMs: null, computeMs: null, reason: error.message };

				}

			} );

		},

		async runPerformanceProfile( configuration = {} ) {

			return runExclusiveControllerOperation( 'runPerformanceProfile', async () => {

			if ( TIERS.get( tier ).performanceClaim !== true ) throw new Error( `Tier ${ tier } does not declare a performance profile.` );
			if ( typeof requestAnimationFrame !== 'function' ) throw new Error( 'Presentation cadence sampling requires requestAnimationFrame.' );
			const warmupFrames = requireFrameCount( configuration.warmupFrames ?? 30, 'warmupFrames', 30, 120 );
			const sampleFrames = requireFrameCount( configuration.sampleFrames ?? 120, 'sampleFrames', 60, 240 );
			const presentationFrames = requireFrameCount( configuration.presentationFrames ?? 120, 'presentationFrames', 60, 240 );
			const warmupCpuSamples = [];
			const cpuSamples = [];
			const gpuSamples = [];
			const gpuStageSamples = { 'scene-mrt': [], 'final-output': [] };
			const presentationSamples = [];
			await renderer.resolveTimestampsAsync( 'render' );

			for ( let frame = 0; frame < warmupFrames; frame ++ ) {

				warmupCpuSamples.push( await renderTo( null ) );

			}
			await resolveAttributedRenderBatch( 'Warm-up batch', warmupFrames );

			for ( let frame = 0; frame < sampleFrames; frame ++ ) {

				cpuSamples.push( await renderTo( null ) );

			}
			const sustainedBatch = await resolveAttributedRenderBatch( 'Sustained batch', sampleFrames );
			gpuSamples.push( ...sustainedBatch.totalSamples );
			gpuStageSamples[ 'scene-mrt' ].push( ...sustainedBatch.stageSamples[ 'scene-mrt' ] );
			gpuStageSamples[ 'final-output' ].push( ...sustainedBatch.stageSamples[ 'final-output' ] );

			let previousPresentationTime = null;
			for ( let frame = 0; frame < presentationFrames; frame ++ ) {

				const presentationTime = await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
				if ( previousPresentationTime !== null ) presentationSamples.push( presentationTime - previousPresentationTime );
				previousPresentationTime = presentationTime;
				await renderTo( null );

			}
			await renderer.resolveTimestampsAsync( 'render' );

			const refreshPeriodMs = 1000 / 60;
			return {
				adapterClass: adapterSnapshot?.adapterClass ?? 'unknown',
				adapterIdentity: adapterSnapshot?.info ?? {},
				warmupFrames,
				sampleFrames,
				presentationFrames,
				warmupCpuSamples,
				cpuSamples,
				gpuSamples,
				gpuStageSamples,
				gpuStageP50: Object.fromEntries( Object.entries( gpuStageSamples ).map( ( [ id, values ] ) => [ id, percentile( values, 0.5 ) ] ) ),
				gpuStageP95: Object.fromEntries( Object.entries( gpuStageSamples ).map( ( [ id, values ] ) => [ id, percentile( values, 0.95 ) ] ) ),
				timestampRows: sustainedBatch.rows,
				stageContextIds: sustainedBatch.stageContextIds,
				lastFrameResolveResidualMs: sustainedBatch.lastFrameResolveResidualMs,
				independentPerFrameTotalsAvailable: sustainedBatch.independentPerFrameTotalsAvailable,
				timestampResolveCount: sustainedBatch.resolveCount,
				timestampMappingCadence: timestampResolutionPolicy.mappingCadence,
				timestampReconciliationScope: sustainedBatch.reconciliationScope,
				presentationSamples,
				cpuP50: percentile( cpuSamples, 0.5 ),
				cpuP95: percentile( cpuSamples, 0.95 ),
				gpuP50: percentile( gpuSamples, 0.5 ),
				gpuP95: percentile( gpuSamples, 0.95 ),
				presentationP50: percentile( presentationSamples, 0.5 ),
				presentationP95: percentile( presentationSamples, 0.95 ),
				deadlineIntervalMs: refreshPeriodMs,
				deadlineMissRatio: presentationSamples.filter( ( value ) => value > refreshPeriodMs ).length / presentationSamples.length,
				timestampScope: 'one batched WebGPU query resolve for the sustained population; per-frame totals are derived from two measured render-context timestamps',
				presentationScope: 'requestAnimationFrame cadence with rendering enabled; timestamp resolution and mapping are deferred until after the cadence window'
			};

			} );

		},

		async runGovernorStressProfile( configuration = {} ) {

			return runExclusiveControllerOperation( 'runGovernorStressProfile', async () => {

			const windowCount = requireFrameCount( configuration.windowCount ?? 6, 'windowCount', 6, 12 );
			const framesPerWindow = requireFrameCount( configuration.framesPerWindow ?? 30, 'framesPerWindow', 30, 60 );
			const targetMs = 1000 / 60 - 2;
			const hysteresisMs = 2;
			const minimumResidenceWindows = 2;
			const cooldownWindows = 2;
			const states = [ 'target-performance', 'governor-stress' ];
			let stateIndex = 0;
			let residence = 0;
			let cooldown = 0;
			const windows = [];
			const transitions = [];
			await renderer.resolveTimestampsAsync( 'render' );

			for ( let window = 0; window < windowCount; window ++ ) {

				const measuredTier = states[ stateIndex ];
				tier = measuredTier;
				applyTier();
				const gpuSamples = [];
				for ( let frame = 0; frame < framesPerWindow; frame ++ ) {

					await renderTo( null );

				}
				const timestampBatch = await resolveAttributedRenderBatch( `Governor window ${ window } batch`, framesPerWindow );
				gpuSamples.push( ...timestampBatch.totalSamples );
				const gpuP95 = percentile( gpuSamples, 0.95 );
				residence ++;
				if ( cooldown > 0 ) cooldown --;
				let decision = 'hold';
				if ( cooldown === 0 && residence >= minimumResidenceWindows ) {

					if ( gpuP95 > targetMs && stateIndex < states.length - 1 ) {

						const from = states[ stateIndex ];
						const fromResourceBytes = currentRenderTargetBytes();
						stateIndex ++;
						tier = states[ stateIndex ];
						applyTier();
						const rebuildCpuSubmissionMs = await renderTo( null );
						const rebuildBatch = await resolveAttributedRenderBatch( `Governor transition ${ window } degrade rebuild`, 1 );
						const rebuildGpuMs = rebuildBatch.totalSamples[ 0 ];
						const toResourceBytes = currentRenderTargetBytes();
						decision = 'degrade';
						transitions.push( { window, from, to: tier, cause: 'gpu-p95-over-budget', gpuP95, rebuildCpuSubmissionMs, rebuildGpuMs, rebuildTimestampRow: rebuildBatch.rows[ 0 ], lastFrameResolveResidualMs: rebuildBatch.lastFrameResolveResidualMs, fromResourceBytes, toResourceBytes } );
						residence = 0;
						cooldown = cooldownWindows;

					} else if ( gpuP95 < targetMs - hysteresisMs && stateIndex > 0 ) {

						const from = states[ stateIndex ];
						const fromResourceBytes = currentRenderTargetBytes();
						stateIndex --;
						tier = states[ stateIndex ];
						applyTier();
						const rebuildCpuSubmissionMs = await renderTo( null );
						const rebuildBatch = await resolveAttributedRenderBatch( `Governor transition ${ window } upgrade rebuild`, 1 );
						const rebuildGpuMs = rebuildBatch.totalSamples[ 0 ];
						const toResourceBytes = currentRenderTargetBytes();
						decision = 'upgrade';
						transitions.push( { window, from, to: tier, cause: 'gpu-p95-below-hysteresis', gpuP95, rebuildCpuSubmissionMs, rebuildGpuMs, rebuildTimestampRow: rebuildBatch.rows[ 0 ], lastFrameResolveResidualMs: rebuildBatch.lastFrameResolveResidualMs, fromResourceBytes, toResourceBytes } );
						residence = 0;
						cooldown = cooldownWindows;

					}

				}
				windows.push( {
					window,
					tier: states[ stateIndex ],
					measuredTier,
					gpuSamples,
					gpuP95,
					timestampRows: timestampBatch.rows,
					lastFrameResolveResidualMs: timestampBatch.lastFrameResolveResidualMs,
					decision,
					residence,
					cooldown
				} );

			}
			const transitionDirections = transitions.map( ( transition ) => transition.to === 'governor-stress' ? 1 : - 1 );
			const oscillationDetected = transitionDirections.some( ( direction, index ) => index > 0 && direction !== transitionDirections[ index - 1 ] );
			tier = states[ stateIndex ];
			applyTier();
			return {
				adapterClass: adapterSnapshot?.adapterClass ?? 'unknown',
				windowCount,
				framesPerWindow,
				targetMs,
				hysteresisMs,
				minimumResidenceWindows,
				cooldownWindows,
				states,
				windows,
				transitions,
				settledState: tier,
				oscillationDetected
			};

			} );

		},

		async dispose() {

			return disposal.joinOrStart( () => {

				assertControllerAvailable( 'dispose', { allowPoisoned: true } );
				return runExclusiveControllerOperation( 'dispose', async () => {

			resourceLedgerObserver.describeLive();
			disposed = true;
			rendererDeviceStatus = 'disposing';
			const queueSettlement = { status: 'PENDING', durationMs: null, error: null };
			try {

				if ( typeof rendererDevice.queue?.onSubmittedWorkDone !== 'function' ) throw new Error( 'GPUQueue.onSubmittedWorkDone is unavailable.' );
				const started = performance.now();
				await rendererDevice.queue.onSubmittedWorkDone();
				queueSettlement.status = 'PASS';
				queueSettlement.durationMs = performance.now() - started;

			} catch ( error ) {

				queueSettlement.status = 'FAIL';
				queueSettlement.error = String( error?.message ?? error );

			}
			if ( uncapturedErrorListenerInstalled && typeof rendererDevice.removeEventListener === 'function' ) {

				rendererDevice.removeEventListener( 'uncapturederror', onUncapturedError );
				uncapturedErrorListenerInstalled = false;

			}
			scene.traverse( disposeObject );
			scene.clear();
			ownedControls.clear();
			ownedMaterials.clear();
			captureTarget.dispose();
			renderPipeline.dispose();
			renderer.dispose();
			resourceLedgerObserver.describeDisposed();
			let deviceDestroy = { status: 'NOT_APPLICABLE', reason: 'renderer uses a caller-owned GPUDevice', intentionalDestroyObserved: false };
			if ( ownedDevice ) {

				ownedDevice.destroy();
				const lossInfo = await rendererDevice.lost;
				await Promise.resolve();
				const reason = String( lossInfo?.reason ?? '' ).toLowerCase();
				deviceDestroy = {
					status: reason === 'destroyed' && intentionalDeviceDestroyObserved ? 'PASS' : 'FAIL',
					reason: String( lossInfo?.reason ?? '' ),
					message: String( lossInfo?.message ?? '' ),
					intentionalDestroyObserved: intentionalDeviceDestroyObserved
				};

			}
			captureTarget = null;
			rendererDeviceStatus = 'disposed';
			disposeEvidence = Object.freeze( {
				controllerGeneration,
				rendererDeviceGeneration,
				queueSettlement: Object.freeze( queueSettlement ),
				deviceDestroy: Object.freeze( deviceDestroy ),
				listenersAfterDispose: uncapturedErrorListenerInstalled ? 1 : 0,
				controlsAfterDispose: ownedControls.size,
				materialsAfterDispose: ownedMaterials.size,
				rendererStateDisposition: 'OWNED_RENDERER_DISPOSED',
				uncapturedErrorsAfterDispose: [ ...uncapturedErrors ],
				deviceLostObserved
			} );
			if ( queueSettlement.status !== 'PASS' || deviceDestroy.status === 'FAIL' ) throw new Error( `Validation subject disposal settlement failed: ${ queueSettlement.error ?? deviceDestroy.reason }.` );
			return disposeEvidence;

				}, { allowPoisoned: true } );

			} );

		}
	};

	return controller;

}

export const nativeSubjectContract = Object.freeze( {
	scenarios: [ ...SCENARIO_IDS ],
	modes: [ ...MODES ],
	tiers: [ ...TIERS.keys() ],
	cameras: [ ...CAMERAS.keys() ],
	seeds: [ ...SEEDS ]
} );
