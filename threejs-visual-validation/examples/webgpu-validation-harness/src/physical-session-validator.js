import { createHash } from 'node:crypto';

import {
	HARDWARE_PERFORMANCE_PROFILE,
	CORRECTNESS_PROFILE,
	PHYSICAL_EVIDENCE_SCHEMA_VERSION,
	PHYSICAL_ROUTE_PROFILE,
	stableStringify
} from './physical-evidence-common.js';
import {
	HARDWARE_PERFORMANCE_CONTRACT,
	HARDWARE_PERFORMANCE_ROUTE_PLAN,
	PHYSICAL_ROUTE_PLAN
} from './in-app-evidence-plan.js';
import {
	CORRECTNESS_CAPTURE_RECIPE_KIND,
	CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
	CORRECTNESS_CAPTURE_RECIPES
} from './correctness-capture-recipes.js';
import { VALIDATION_MODE_OUTPUT_NODE_IDS } from './browser-subject-adapter.js';
import { TIER_ROUTE_LOCKS } from './route-locks.js';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PLAYWRIGHT_CORRECTNESS_SURFACE = 'playwright-headless-chromium';
const STANDARD_OUTPUTS = Object.freeze( [
	'final.design.png',
	'no-post.design.png',
	'diagnostics.mosaic.png',
	'camera.near.png',
	'camera.design.png',
	'camera.far.png',
	'seed-0001.final.png',
	'seed-9e3779b9.final.png',
	'temporal.t000.png',
	'temporal.t001.png'
] );
const CORRECTNESS_RECIPE_SET_DIGEST = stableHash( {
	schemaVersion: CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
	recipeKind: CORRECTNESS_CAPTURE_RECIPE_KIND,
	recipes: CORRECTNESS_CAPTURE_RECIPES
} );
const PERFORMANCE_TIER_SCENE_SCALES = Object.freeze( Object.fromEntries(
	[ 'target-performance', 'governor-stress' ].map( ( tier ) => {

		const recipe = CORRECTNESS_CAPTURE_RECIPES.find( ( candidate ) => candidate.id === `tier.${ tier }.final` );
		if ( recipe === undefined ) throw new Error( `Missing correctness recipe for performance tier ${ tier }.` );
		return [ tier, recipe.expectedSceneScale ];

	} )
) );
const CORRECTNESS_PARENT_LOCK = TIER_ROUTE_LOCKS[ 'webgpu-correctness' ];
const CORRECTNESS_PARENT_STATE = Object.freeze( Object.fromEntries(
	[ 'scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds' ].map( ( key ) => [ key, CORRECTNESS_PARENT_LOCK[ key ] ] )
) );
const REQUIRED_RESOURCE_SEMANTICS = Object.freeze( [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] );
const SCENE_RESOURCE_SEMANTICS = Object.freeze( [ 'output', 'normal', 'emissive', 'depth' ] );
const RESOURCE_FORMATS = Object.freeze( {
	output: { format: 'rgba16float', bytesPerTexel: 8 },
	normal: { format: 'rgba16float', bytesPerTexel: 8 },
	emissive: { format: 'rgba16float', bytesPerTexel: 8 },
	depth: { format: 'depth32float', bytesPerTexel: 4 },
	'capture-target': { format: 'rgba8unorm-srgb', bytesPerTexel: 4 }
} );
const DIAGNOSTIC_MOSAIC_SOURCES = Object.freeze( [
	'final.design.png',
	'no-post.design.png',
	'diagnostic.normal.png',
	'diagnostic.emissive.png'
] );

function fail( message ) {

	throw new Error( message );

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) fail( `${ label } must be an object.` );
	return value;

}

function requireArray( value, label ) {

	if ( Array.isArray( value ) === false ) fail( `${ label } must be an array.` );
	return value;

}

function requireHash( value, label ) {

	if ( SHA256.test( value ?? '' ) === false ) fail( `${ label } must be a SHA-256 digest.` );
	return value;

}

function stableHash( value ) {

	return `sha256:${ createHash( 'sha256' ).update( stableStringify( value ) ).digest( 'hex' ) }`;

}

function requireFinite( value, label, minimum = - Infinity ) {

	if ( Number.isFinite( value ) === false || value < minimum ) fail( `${ label } must be a finite number no smaller than ${ minimum }.` );
	return value;

}

function numeric( value, label, expectedLabel = null ) {

	requireObject( value, label );
	requireFinite( value.value, `${ label }.value` );
	if ( typeof value.unit !== 'string' || value.unit.length === 0 ) fail( `${ label }.unit is required.` );
	if ( expectedLabel !== null && value.label !== expectedLabel ) fail( `${ label } must be labelled ${ expectedLabel }.` );
	if ( typeof value.source !== 'string' || value.source.length === 0 ) fail( `${ label }.source is required.` );
	return value.value;

}

function numericArray( value, label, expectedLabel = null ) {

	requireObject( value, label );
	const values = requireArray( value.values, `${ label }.values` );
	if ( values.some( ( sample ) => Number.isFinite( sample ) === false || sample < 0 ) ) fail( `${ label } contains an invalid sample.` );
	if ( expectedLabel !== null && value.label !== expectedLabel ) fail( `${ label } must be labelled ${ expectedLabel }.` );
	if ( typeof value.unit !== 'string' || typeof value.source !== 'string' ) fail( `${ label } requires unit and source.` );
	return values;

}

function percentile( samples, q ) {

	if ( samples.length === 0 ) return null;
	const ordered = [ ...samples ].sort( ( a, b ) => a - b );
	const position = ( ordered.length - 1 ) * q;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? ordered[ lower ] : ordered[ lower ] + ( ordered[ upper ] - ordered[ lower ] ) * ( position - lower );

}

function assertImmutableBuild( build ) {

	requireObject( build, 'immutableBuild' );
	if ( build.schemaVersion !== 1 || build.kind !== 'immutable-physical-build' || build.immutable !== true ) fail( 'Session did not use an immutable physical build.' );
	if ( build.viteDevelopmentServer !== false || build.transformAtServe !== false || build.redirects !== false || build.spaFallback !== false ) fail( 'Physical evidence rejects Vite development transforms, redirects, and SPA fallback.' );
	requireHash( build.sourceClosureHash, 'immutableBuild.sourceClosureHash' );
	requireHash( build.buildRevision, 'immutableBuild.buildRevision' );
	requireHash( build.bundleHash, 'immutableBuild.bundleHash' );
	requireHash( build.contentAddress, 'immutableBuild.contentAddress' );
	if ( build.threeRevision !== '0.185.1' ) fail( 'Immutable build must use Three.js 0.185.1.' );
	requireObject( build.sourceClosure, 'immutableBuild.sourceClosure' );
	if ( build.sourceClosure.sourceHash !== build.sourceClosureHash || build.sourceClosure.buildRevision !== build.buildRevision || build.sourceClosure.threeRevision !== build.threeRevision ) fail( 'Immutable build source closure identity is inconsistent.' );
	if ( build.contentAddress !== stableHash( { sourceClosureHash: build.sourceClosureHash, buildRevision: build.buildRevision, threeRevision: build.threeRevision } ) ) fail( 'Immutable build content address does not bind source, build, and Three identities.' );
	for ( const requiredRoot of [ 'package.json', 'package-lock.json', 'labs/runtime/aligned-readback.mjs' ] ) if ( build.sourceClosure.roots?.includes( requiredRoot ) !== true ) fail( `Immutable build source closure omits ${ requiredRoot }.` );
	const files = requireObject( build.files, 'immutableBuild.files' );
	if ( Object.keys( files ).length === 0 ) fail( 'Immutable build file ledger is empty.' );
	for ( const [ path, descriptor ] of Object.entries( files ) ) {

		requireObject( descriptor, `immutableBuild.files.${ path }` );
		requireHash( descriptor.sha256, `immutableBuild.files.${ path }.sha256` );
		requireFinite( descriptor.byteLength, `immutableBuild.files.${ path }.byteLength`, 1 );

	}
	return build;

}

function assertCaptureEnvironment( session ) {

	if ( session.schemaVersion !== PHYSICAL_EVIDENCE_SCHEMA_VERSION ) fail( 'Physical evidence schema version is invalid.' );
	if ( session.automationSurface !== 'codex-in-app-browser' ) fail( 'Physical evidence requires automationSurface=codex-in-app-browser.' );
	if ( session.browser?.webdriver !== false || session.browser?.headless !== false ) fail( 'Headless or WebDriver-controlled evidence is rejected.' );
	if ( session.browser?.visibilityState !== 'visible' ) fail( 'Physical evidence requires a visible foreground page.' );
	if ( session.adapter?.adapterClass !== 'hardware' ) fail( 'Software, virtual, and unknown adapters cannot support physical evidence.' );
	requireObject( session.adapter.identity, 'adapter.identity' );
	if ( Object.keys( session.adapter.identity ).length === 0 ) fail( 'Physical adapter identity is empty.' );
	const refreshHz = numeric( session.refresh?.hz, 'refresh.hz', 'Measured' );
	if ( refreshHz <= 0 ) fail( 'Measured display refresh must be positive.' );
	const refreshIntervals = numericArray( session.refresh?.intervals, 'refresh.intervals', 'Measured' );
	if ( refreshIntervals.length < 120 || refreshIntervals.some( ( sample ) => sample <= 0 ) ) fail( 'Measured display refresh requires at least 120 positive foreground intervals.' );
	const refreshP50 = numeric( session.refresh?.p50, 'refresh.p50', 'Measured' );
	const refreshP95 = numeric( session.refresh?.p95, 'refresh.p95', 'Measured' );
	if ( Math.abs( refreshP50 - percentile( refreshIntervals, 0.5 ) ) > 1e-9 || Math.abs( refreshP95 - percentile( refreshIntervals, 0.95 ) ) > 1e-9 ) fail( 'Measured refresh percentiles do not reconcile with their interval population.' );
	if ( Math.abs( refreshHz - 1000 / refreshP50 ) > 1e-6 ) fail( 'Measured refresh Hz does not reconcile with the median interval.' );
	return assertImmutableBuild( session.immutableBuild );

}

function assertReadback( readback, startup, label ) {

	requireObject( readback, label );
	if ( readback.target !== startup.mode ) fail( `${ label } target does not match the locked mode.` );
	if ( readback.width !== startup.width || readback.height !== startup.height ) fail( `${ label } dimensions do not match the locked viewport.` );
	if ( readback.resourceFormat !== 'rgba8unorm-srgb' ) fail( `${ label } must bind the native sRGB RGBA8 capture-target resource format.` );
	if ( readback.format !== 'rgba8unorm' || readback.bytesPerPixel !== 4 ) fail( `${ label } must distinguish raw four-channel 8-bit copy bytes from the sRGB resource format.` );
	if ( readback.colorManaged !== true || readback.outputColorSpace !== 'srgb' || readback.encoding !== 'srgb' || readback.origin !== 'top-left' ) fail( `${ label } color/encoding/origin metadata is inconsistent with the capture target.` );
	const rowBytes = startup.width * 4;
	if ( readback.rowBytes !== rowBytes ) fail( `${ label } logical row bytes are invalid.` );
	if ( Number.isInteger( readback.sourceBytesPerRow ) === false || readback.sourceBytesPerRow < rowBytes || readback.sourceBytesPerRow % 256 !== 0 ) fail( `${ label } transport row stride is not a valid 256-byte-aligned integer.` );
	if ( readback.pixelByteLength !== rowBytes * startup.height ) fail( `${ label } compact pixel length is invalid.` );
	if ( readback.normalizedByteLength !== readback.sourceBytesPerRow * startup.height ) fail( `${ label } normalized padded byte length is invalid.` );
	const tightFinalRowLength = ( startup.height - 1 ) * readback.sourceBytesPerRow + rowBytes;
	if ( readback.sourceByteLength !== tightFinalRowLength && readback.sourceByteLength !== readback.normalizedByteLength ) fail( `${ label } transport byte length matches neither a tight nor padded final row.` );
	if ( readback.transportByteLength !== readback.sourceByteLength ) fail( `${ label } retained transport bytes do not match the renderer-returned byte length.` );
	for ( const [ layoutName, expectedByteLength ] of [ [ 'transportLayout', readback.sourceByteLength ], [ 'normalizedLayout', readback.normalizedByteLength ] ] ) {

		const layout = requireObject( readback[ layoutName ], `${ label }.${ layoutName }` );
		if ( layout.width !== startup.width || layout.height !== startup.height || layout.rowBytes !== rowBytes || layout.bytesPerRow !== readback.sourceBytesPerRow || layout.byteLength !== expectedByteLength || layout.format !== 'rgba8unorm' || layout.origin !== 'top-left' ) fail( `${ label }.${ layoutName } does not match the retained raw native copy bytes.` );

	}
	for ( const key of [ 'pixelSha256', 'transportSha256', 'normalizedSha256' ] ) requireHash( readback[ key ], `${ label }.${ key }` );

}

function assertRouteRecord( record, plan, build, sessionAdapter, label ) {

	requireObject( record, label );
	if ( record.key !== plan.key || record.kind !== plan.kind || record.id !== plan.id ) fail( `${ label } route identity/order mismatch.` );
	if ( stableStringify( record.startup ) !== stableStringify( plan.startup ) ) fail( `${ label } startup state differs from the immutable route lock.` );
	if ( record.runtimeProfile !== plan.runtimeProfile ) fail( `${ label } runtime profile is not the predeclared route profile.` );
	if ( record.controllerReady !== true || record.finalUrlMatches !== true ) fail( `${ label } did not reach the exact ready route.` );
	if ( record.sourceClosureHash !== build.sourceClosureHash || record.buildRevision !== build.buildRevision || record.threeRevision !== build.threeRevision ) fail( `${ label } source/build/Three identity drifted.` );
	requireHash( record.pipelineGraphDigest, `${ label }.pipelineGraphDigest` );
	requireHash( record.resourceDigest, `${ label }.resourceDigest` );
	if ( stableHash( requireObject( record.pipelineGraph, `${ label }.pipelineGraph` ) ) !== record.pipelineGraphDigest ) fail( `${ label } pipeline graph digest does not bind the described runtime graph.` );
	if ( stableHash( requireObject( record.resources, `${ label }.resources` ) ) !== record.resourceDigest ) fail( `${ label } resource digest does not bind the described runtime inventory.` );
	const backend = requireObject( record.backend, `${ label }.backend` );
	if ( backend.isWebGPUBackend !== true || backend.initialized !== true || backend.deviceIdentityVerified !== true ) fail( `${ label } lacks initialized native WebGPU device identity proof.` );
	if ( Number.isInteger( backend.rendererDeviceGeneration ) === false || backend.rendererDeviceGeneration < 1 ) fail( `${ label } renderer device generation is invalid.` );
	if ( Number.isInteger( backend.controllerGeneration ) === false || backend.controllerGeneration < 1 ) fail( `${ label } controller generation is invalid.` );
	if ( backend.deviceLostObserved !== false || backend.deviceLossGeneration !== 0 ) fail( `${ label } observed device loss.` );
	if ( requireArray( backend.uncapturedErrors, `${ label }.backend.uncapturedErrors` ).length > 0 ) fail( `${ label } has uncaptured device errors.` );
	if ( record.adapter?.adapterClass !== 'hardware' || stableStringify( record.adapter?.info ) !== stableStringify( sessionAdapter.identity ) ) fail( `${ label } route adapter identity differs from the named hardware session adapter.` );
	const state = requireObject( record.state, `${ label }.state` );
	for ( const key of [ 'scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds' ] ) if ( state[ key ] !== plan.startup[ key ] ) fail( `${ label } runtime ${ key } drifted from its route lock.` );
	if ( state.viewport?.width !== plan.startup.width || state.viewport?.height !== plan.startup.height || state.viewport?.dpr !== plan.startup.dpr ) fail( `${ label } runtime viewport drifted from its route lock.` );
	assertReadback( record.readback, plan.startup, `${ label }.readback` );
	const lifecycle = requireObject( record.lifecycle, `${ label }.lifecycle` );
	if ( lifecycle.disposeCompleted !== true || lifecycle.twoAnimationFramesSettled !== true ) fail( `${ label } did not dispose and settle for two animation frames.` );
	if ( requireArray( lifecycle.delayedErrors, `${ label }.lifecycle.delayedErrors` ).length > 0 ) fail( `${ label } contains delayed post-disposal errors.` );
	if ( requireArray( record.errors, `${ label }.errors` ).length > 0 ) fail( `${ label } contains page, console, request, or controller errors.` );

}

function assertServedBytes( session, build, expectedRoutePlan ) {

	const serving = requireObject( session.serving, 'serving' );
	requireHash( serving.ledgerSha256, 'serving.ledgerSha256' );
	requireHash( serving.buildManifestFileSha256, 'serving.buildManifestFileSha256' );
	const entries = requireArray( serving.entries, 'serving.entries' );
	if ( entries.length === 0 ) fail( 'Served-byte ledger is empty.' );
	const lockedRouteRequests = new Set();
	for ( const [ index, entry ] of entries.entries() ) {

		requireObject( entry, `serving.entries[${ index }]` );
		if ( entry.status !== 200 || entry.redirected !== false || entry.fallback !== false || entry.transformed !== false || entry.responseKind !== 'exact-prebuilt-byte' ) fail( `serving.entries[${ index }] is not an exact static byte response.` );
		requireHash( entry.sha256, `serving.entries[${ index }].sha256` );
		const descriptor = build.files[ entry.resolvedPath ];
		if ( entry.resolvedPath === 'immutable-build-manifest.json' ) {

			if ( entry.sha256 !== serving.buildManifestFileSha256 ) fail( 'Served immutable manifest hash mismatch.' );

		} else if ( descriptor === undefined || descriptor.sha256 !== entry.sha256 || descriptor.byteLength !== entry.byteLength ) fail( `Served bytes for ${ entry.resolvedPath } do not match the immutable build ledger.` );
		if ( entry.resolvedPath === 'index.html' ) {

			const parameters = new URLSearchParams( entry.query ?? '' );
			const key = `${ parameters.get( 'lockKind' ) }/${ parameters.get( 'lockId' ) }`;
			if ( expectedRoutePlan.some( ( route ) => route.key === key ) ) lockedRouteRequests.add( key );

		}

	}
	for ( const route of expectedRoutePlan ) if ( lockedRouteRequests.has( route.key ) === false ) fail( `Served-byte ledger omits locked route ${ route.key }.` );

}

function assertRouteSequence( session, plan, build ) {

	const expectedOrder = plan.map( ( route ) => route.key );
	if ( stableStringify( session.routeOrder ) !== stableStringify( expectedOrder ) ) fail( 'Physical route order differs from the canonical plan.' );
	const routes = requireArray( session.routes, 'routes' );
	if ( routes.length !== plan.length ) fail( `Physical route session requires ${ plan.length } route records.` );
	for ( let index = 0; index < plan.length; index ++ ) assertRouteRecord( routes[ index ], plan[ index ], build, session.adapter, `routes[${ index }]` );

}

function assertCaptureSessionInterval( session ) {

	const startedAt = Date.parse( session.startedAt );
	const finishedAt = Date.parse( session.finishedAt );
	if ( Number.isFinite( startedAt ) === false || Number.isFinite( finishedAt ) === false || finishedAt < startedAt ) fail( 'Correctness capture session has an invalid capture interval.' );

}

function requirePositiveInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value < 1 ) fail( `${ label } must be a positive integer.` );
	return value;

}

function requireNonnegativeInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value < 0 ) fail( `${ label } must be a nonnegative integer.` );
	return value;

}

function requireFiniteArray( value, length, label ) {

	const entries = requireArray( value, label );
	if ( entries.length !== length || entries.some( ( entry ) => Number.isFinite( entry ) === false ) ) fail( `${ label } must contain exactly ${ length } finite values.` );
	return entries;

}

function assertStableDigest( value, digest, label ) {

	requireHash( digest, `${ label } digest` );
	if ( stableHash( value ) !== digest ) fail( `${ label } digest does not bind its complete state.` );

}

function assertCanonicalParentState( state, label ) {

	requireObject( state, label );
	for ( const [ key, expected ] of Object.entries( CORRECTNESS_PARENT_STATE ) ) if ( state[ key ] !== expected ) fail( `${ label}.${ key } differs from the tier/webgpu-correctness parent lock.` );

}

function assertCaptureStateSnapshot( state, label ) {

	requireObject( state, label );
	const viewport = requireObject( state.viewport, `${ label }.viewport` );
	for ( const key of [ 'width', 'height', 'dpr' ] ) requireFinite( viewport[ key ], `${ label }.viewport.${ key }`, Number.EPSILON );
	requireFinite( state.passScale, `${ label }.passScale`, Number.EPSILON );
	for ( const key of [ 'outputNodeMode', 'outputNodeId', 'outputNodeUuid', 'outputNodeType' ] ) if ( typeof state[ key ] !== 'string' || state[ key ].length === 0 ) fail( `${ label }.${ key } is required.` );
	if ( state.outputNodeMode !== state.mode || state.outputNodeId !== VALIDATION_MODE_OUTPUT_NODE_IDS[ state.mode ] ) fail( `${ label } output-node identity does not match its active mode.` );
	requireFiniteArray( state.cameraState?.matrixWorld, 16, `${ label }.cameraState.matrixWorld` );
	requireFiniteArray( state.cameraState?.projectionMatrix, 16, `${ label }.cameraState.projectionMatrix` );
	requireFiniteArray( state.subjectMatrixWorld, 16, `${ label }.subjectMatrixWorld` );
	requireFiniteArray( state.markerPosition, 3, `${ label }.markerPosition` );
	for ( const target of [ 'captureTarget', 'sceneTarget' ] ) {

		requirePositiveInteger( state[ target ]?.width, `${ label }.${ target }.width` );
		requirePositiveInteger( state[ target ]?.height, `${ label }.${ target }.height` );

	}
	const rendererTarget = requireObject( state.rendererTarget, `${ label }.rendererTarget` );
	if ( rendererTarget.kind !== 'presentation' || rendererTarget.textureUuid !== null ) fail( `${ label } did not restore presentation as the renderer target before evidence sampling.` );
	const device = requireObject( state.device, `${ label }.device` );
	for ( const key of [ 'controllerGeneration', 'rendererDeviceGeneration' ] ) requirePositiveInteger( device[ key ], `${ label }.device.${ key }` );
	requireNonnegativeInteger( device.deviceLossGeneration, `${ label }.device.deviceLossGeneration` );
	requireNonnegativeInteger( device.uncapturedErrorCount, `${ label }.device.uncapturedErrorCount` );
	if ( device.rendererDeviceStatus !== 'active' || device.deviceLostObserved !== false || device.backendDeviceIdentityVerified !== true || device.nativeWebGPUBackend !== true || device.deviceLossGeneration !== 0 || device.uncapturedErrorCount !== 0 ) fail( `${ label } does not bind one healthy native WebGPU device generation.` );
	return state;

}

function resourceTargetIndex( ledger, label ) {

	requireObject( ledger, label );
	if ( ledger.schemaVersion !== 1 || ledger.state !== 'live' ) fail( `${ label } must be a live schema-v1 resource ledger.` );
	const targets = requireArray( ledger.renderTargets, `${ label }.renderTargets` );
	if ( targets.length !== REQUIRED_RESOURCE_SEMANTICS.length ) fail( `${ label } must contain exactly ${ REQUIRED_RESOURCE_SEMANTICS.length } render-target resources.` );
	const index = new Map();
	for ( const [ rowIndex, target ] of targets.entries() ) {

		const rowLabel = `${ label }.renderTargets[${ rowIndex }]`;
		requireObject( target, rowLabel );
		if ( REQUIRED_RESOURCE_SEMANTICS.includes( target.semantic ) === false || index.has( target.semantic ) ) fail( `${ rowLabel } has an unknown or duplicated semantic.` );
		if ( typeof target.textureUuid !== 'string' || target.textureUuid.length === 0 ) fail( `${ rowLabel }.textureUuid is required.` );
		if ( typeof target.owner !== 'string' || target.owner.length === 0 ) fail( `${ rowLabel }.owner is required.` );
		const contract = RESOURCE_FORMATS[ target.semantic ];
		for ( const key of [ 'width', 'height', 'depth', 'sampleCount', 'bytesPerTexel', 'bytes', 'logicalBytes', 'liveBytes' ] ) requirePositiveInteger( target[ key ], `${ rowLabel }.${ key }` );
		if ( target.depth !== 1 || target.sampleCount !== 1 || target.format !== contract.format || target.bytesPerTexel !== contract.bytesPerTexel || target.liveness !== 'live' ) fail( `${ rowLabel } format, sampling, or liveness differs from the validation-subject contract.` );
		const expectedBytes = target.width * target.height * target.depth * target.sampleCount * target.bytesPerTexel;
		if ( target.bytes !== expectedBytes || target.logicalBytes !== expectedBytes || target.liveBytes !== expectedBytes ) fail( `${ rowLabel } byte accounting does not reconcile with its extent and format.` );
		index.set( target.semantic, target );

	}
	for ( const semantic of REQUIRED_RESOURCE_SEMANTICS ) if ( index.has( semantic ) === false ) fail( `${ label } omits ${ semantic }.` );
	const textureUuids = [ ...index.values() ].map( ( target ) => target.textureUuid );
	if ( new Set( textureUuids ).size !== textureUuids.length ) fail( `${ label } aliases required render-target texture identities.` );
	const mrt = requireObject( ledger.sceneMrt, `${ label }.sceneMrt` );
	if ( typeof mrt.uuid !== 'string' || mrt.uuid.length === 0 || mrt.type !== 'MRTNode' || mrt.liveness !== 'live' ) fail( `${ label }.sceneMrt has no live MRT identity.` );
	const outputs = requireArray( mrt.outputs, `${ label }.sceneMrt.outputs` );
	if ( stableStringify( outputs.map( ( output ) => output.semantic ).sort() ) !== stableStringify( [ 'emissive', 'normal', 'output' ] ) ) fail( `${ label }.sceneMrt outputs are incomplete.` );
	if ( new Set( outputs.map( ( output ) => output.nodeUuid ) ).size !== outputs.length || outputs.some( ( output ) => typeof output.nodeUuid !== 'string' || output.nodeUuid.length === 0 ) ) fail( `${ label }.sceneMrt output identities are invalid.` );
	for ( const key of [ 'geometries', 'geometryAllocations', 'storageResources' ] ) requireArray( ledger[ key ], `${ label }.${ key }` );
	if ( ledger.geometries.length === 0 || ledger.geometryAllocations.length === 0 || ledger.storageResources.length !== 0 ) fail( `${ label } does not describe the static subject's geometry/no-storage contract.` );
	const trackedTargetBytes = [ ...index.values() ].reduce( ( sum, target ) => sum + target.liveBytes, 0 );
	if ( ledger.trackedRenderTargetBytes !== trackedTargetBytes ) fail( `${ label }.trackedRenderTargetBytes does not reconcile with live target identities.` );
	return index;

}

function assertHardwarePerformanceRouteResources( session ) {

	const bytesByTier = {};
	for ( let index = 0; index < HARDWARE_PERFORMANCE_ROUTE_PLAN.length; index ++ ) {

		const plan = HARDWARE_PERFORMANCE_ROUTE_PLAN[ index ];
		const route = session.routes[ index ];
		const label = `routes[${ index }].resources`;
		const targets = resourceTargetIndex( route.resources, label );
		const sceneScale = PERFORMANCE_TIER_SCENE_SCALES[ plan.id ];
		if ( Number.isFinite( sceneScale ) === false || sceneScale <= 0 || sceneScale > 1 ) fail( `${ label } has no frozen scene scale for ${ plan.id }.` );
		const fullWidth = Math.round( plan.startup.width * plan.startup.dpr );
		const fullHeight = Math.round( plan.startup.height * plan.startup.dpr );
		const sceneWidth = Math.max( 1, Math.floor( fullWidth * sceneScale ) );
		const sceneHeight = Math.max( 1, Math.floor( fullHeight * sceneScale ) );
		for ( const semantic of REQUIRED_RESOURCE_SEMANTICS ) {

			const target = targets.get( semantic );
			const expectedWidth = semantic === 'capture-target' ? fullWidth : sceneWidth;
			const expectedHeight = semantic === 'capture-target' ? fullHeight : sceneHeight;
			if ( target.width !== expectedWidth || target.height !== expectedHeight ) fail( `${ label}.${ semantic} extent ${ target.width }x${ target.height } does not match locked tier ${ plan.id } extent ${ expectedWidth }x${ expectedHeight }.` );

		}
		bytesByTier[ plan.id ] = route.resources.trackedRenderTargetBytes;

	}
	if ( bytesByTier[ 'target-performance' ] <= bytesByTier[ 'governor-stress' ] ) fail( 'Hardware performance tier resource inventories do not preserve the declared degradation order.' );
	return Object.freeze( bytesByTier );

}

function resourceIdentityClosure( ledger ) {

	return {
		sceneMrt: {
			uuid: ledger.sceneMrt.uuid,
			type: ledger.sceneMrt.type,
			outputs: ledger.sceneMrt.outputs.map( ( output ) => ( { semantic: output.semantic, nodeUuid: output.nodeUuid, nodeType: output.nodeType ?? null } ) ).sort( ( left, right ) => left.semantic.localeCompare( right.semantic ) )
		},
		renderTargets: ledger.renderTargets.map( ( target ) => ( {
			semantic: target.semantic,
			owner: target.owner,
			textureUuid: target.textureUuid,
			format: target.format,
			depth: target.depth,
			sampleCount: target.sampleCount,
			bytesPerTexel: target.bytesPerTexel
		} ) ).sort( ( left, right ) => left.semantic.localeCompare( right.semantic ) ),
		geometries: ledger.geometries.map( ( geometry ) => ( {
			uuid: geometry.uuid,
			allocationIds: [ ...( geometry.allocationIds ?? [] ) ].sort(),
			liveness: geometry.liveness
		} ) ).sort( ( left, right ) => String( left.uuid ).localeCompare( String( right.uuid ) ) ),
		geometryAllocations: ledger.geometryAllocations.map( ( allocation ) => ( {
			id: allocation.id,
			bindings: [ ...( allocation.bindings ?? [] ) ].sort(),
			logicalBytes: allocation.logicalBytes,
			liveBytes: allocation.liveBytes,
			liveness: allocation.liveness
		} ) ).sort( ( left, right ) => String( left.id ).localeCompare( String( right.id ) ) )
	};

}

function restorableResourceState( ledger ) {

	return {
		identity: resourceIdentityClosure( ledger ),
		extents: ledger.renderTargets.map( ( target ) => ( {
			semantic: target.semantic,
			width: target.width,
			height: target.height,
			logicalBytes: target.logicalBytes,
			liveBytes: target.liveBytes
		} ) ).sort( ( left, right ) => left.semantic.localeCompare( right.semantic ) ),
		trackedRenderTargetBytes: ledger.trackedRenderTargetBytes,
		trackedGeometryBytes: ledger.trackedGeometryBytes
	};

}

function assertResourcePhase( resources, recipe, label ) {

	requireObject( resources, label );
	const entry = requireObject( resources.entry, `${ label }.entry` );
	const effective = requireObject( resources.effective, `${ label }.effective` );
	const restored = requireObject( resources.restored, `${ label }.restored` );
	const entryTargets = resourceTargetIndex( entry, `${ label }.entry` );
	const effectiveTargets = resourceTargetIndex( effective, `${ label }.effective` );
	resourceTargetIndex( restored, `${ label }.restored` );
	if ( stableStringify( restorableResourceState( entry ) ) !== stableStringify( restorableResourceState( restored ) ) ) fail( `${ label } did not restore resource identities, extents, and live bytes.` );
	if ( stableStringify( resourceIdentityClosure( entry ) ) !== stableStringify( resourceIdentityClosure( effective ) ) ) fail( `${ label } changed live resource identities while applying the recipe.` );
	const viewport = recipe.effectiveState.viewport;
	const fullWidth = Math.round( viewport.width * viewport.dpr );
	const fullHeight = Math.round( viewport.height * viewport.dpr );
	const sceneWidth = Math.max( 1, Math.round( fullWidth * recipe.expectedSceneScale ) );
	const sceneHeight = Math.max( 1, Math.round( fullHeight * recipe.expectedSceneScale ) );
	for ( const semantic of REQUIRED_RESOURCE_SEMANTICS ) {

		const target = effectiveTargets.get( semantic );
		const width = semantic === 'capture-target' ? fullWidth : sceneWidth;
		const height = semantic === 'capture-target' ? fullHeight : sceneHeight;
		if ( target.width !== width || target.height !== height ) fail( `${ label }.effective ${ semantic} extent ${ target.width }x${ target.height } does not match ${ width }x${ height }.` );

	}
	for ( const semantic of REQUIRED_RESOURCE_SEMANTICS ) {

		const target = entryTargets.get( semantic );
		if ( target.width !== CORRECTNESS_PARENT_LOCK.width || target.height !== CORRECTNESS_PARENT_LOCK.height ) fail( `${ label }.entry ${ semantic } does not retain the canonical ${ CORRECTNESS_PARENT_LOCK.width }x${ CORRECTNESS_PARENT_LOCK.height } parent extent.` );

	}
	return { entry, effective, restored };

}

function counterSnapshot( value, label ) {

	requireObject( value, label );
	for ( const key of [ 'renderSubmissionCount', 'scenePassExecutionCount', 'modeSelectionCount' ] ) requireNonnegativeInteger( value[ key ], `${ label }.${ key }` );
	return value;

}

function assertSubmissionArithmetic( submissions, recipe, entryState, previousRestored, label ) {

	requireObject( submissions, label );
	const entry = counterSnapshot( submissions.entry, `${ label }.entry` );
	const effective = counterSnapshot( submissions.effective, `${ label }.effective` );
	const restored = counterSnapshot( submissions.restored, `${ label }.restored` );
	if ( previousRestored !== null && stableStringify( entry ) !== stableStringify( previousRestored ) ) fail( `${ label }.entry does not continue from the previous committed restoration.` );
	const expectedCaptureRenders = 1 + recipe.effectiveState.timeline.stepSeconds.length;
	const expected = {
		captureDelta: { renderSubmissions: expectedCaptureRenders, scenePassExecutions: expectedCaptureRenders, modeSelections: 1 },
		restorationDelta: { renderSubmissions: 1, scenePassExecutions: 1, modeSelections: 1 }
	};
	for ( const [ deltaName, before, after ] of [
		[ 'captureDelta', entry, effective ],
		[ 'restorationDelta', effective, restored ]
	] ) {

		const delta = requireObject( submissions[ deltaName ], `${ label }.${ deltaName }` );
		const observed = {
			renderSubmissions: after.renderSubmissionCount - before.renderSubmissionCount,
			scenePassExecutions: after.scenePassExecutionCount - before.scenePassExecutionCount,
			modeSelections: after.modeSelectionCount - before.modeSelectionCount
		};
		if ( stableStringify( delta ) !== stableStringify( observed ) ) fail( `${ label }.${ deltaName } does not reconcile with its cumulative counters.` );
		if ( stableStringify( delta ) !== stableStringify( expected[ deltaName ] ) ) fail( `${ label }.${ deltaName } differs from the frozen recipe execution cost.` );

	}
	const captureRenderTrace = requireArray( submissions.captureRenderTrace, `${ label }.captureRenderTrace` );
	const restorationRenderTrace = requireArray( submissions.restorationRenderTrace, `${ label }.restorationRenderTrace` );
	const expectedCaptureTrace = [];
	let renderTime = recipe.effectiveState.timeline.initialTimeSeconds;
	for ( const deltaSeconds of recipe.effectiveState.timeline.stepSeconds ) {

		expectedCaptureTrace.push( {
			sequence: entry.renderSubmissionCount + expectedCaptureTrace.length + 1,
			timeSeconds: renderTime,
			target: 'presentation',
			mode: recipe.effectiveState.mode,
			tier: recipe.effectiveState.tier
		} );
		renderTime += deltaSeconds;

	}
	expectedCaptureTrace.push( {
		sequence: entry.renderSubmissionCount + expectedCaptureTrace.length + 1,
		timeSeconds: renderTime,
		target: 'capture-target',
		mode: recipe.effectiveState.mode,
		tier: recipe.effectiveState.tier
	} );
	const expectedRestorationTrace = [ {
		sequence: effective.renderSubmissionCount + 1,
		timeSeconds: entryState.timeSeconds,
		target: 'presentation',
		mode: entryState.mode,
		tier: entryState.tier
	} ];
	if ( stableStringify( captureRenderTrace ) !== stableStringify( expectedCaptureTrace ) ) fail( `${ label }.captureRenderTrace does not bind the recipe's adjacent render timeline.` );
	if ( stableStringify( restorationRenderTrace ) !== stableStringify( expectedRestorationTrace ) ) fail( `${ label }.restorationRenderTrace does not bind the single parent-state restoration render.` );
	return restored;

}

function assertCaptureEnvelopeLayouts( layouts, capture, label ) {

	requireObject( layouts, label );
	const rowBytes = capture.width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const minimumByteLength = bytesPerRow * ( capture.height - 1 ) + rowBytes;
	const fullyPaddedByteLength = bytesPerRow * capture.height;
	const expectedReadback = {
		width: capture.width,
		height: capture.height,
		bytesPerTexel: 4,
		rowBytes,
		bytesPerRow,
		minimumByteLength,
		fullyPaddedByteLength,
		alignment: 256
	};
	const expectedTransport = {
		width: capture.width,
		height: capture.height,
		rowBytes,
		bytesPerRow,
		byteLength: capture.sourceByteLength,
		format: 'rgba8unorm',
		origin: 'top-left',
		padding: capture.sourceByteLength === fullyPaddedByteLength ? 'full-final-row' : 'tight-final-row'
	};
	const expectedNormalized = {
		width: capture.width,
		height: capture.height,
		rowBytes,
		bytesPerRow,
		byteLength: fullyPaddedByteLength,
		format: 'rgba8unorm',
		origin: 'top-left'
	};
	if ( stableStringify( layouts.readback ) !== stableStringify( expectedReadback ) || stableStringify( layouts.transport ) !== stableStringify( expectedTransport ) || stableStringify( layouts.normalized ) !== stableStringify( expectedNormalized ) ) fail( `${ label } does not exactly join the renderer, retained transport, and normalized artifact layouts.` );
	if ( capture.sourceBytesPerRow !== bytesPerRow || capture.normalized.bytesPerRow !== bytesPerRow || capture.normalized.byteLength !== fullyPaddedByteLength ) fail( `${ label } disagrees with serialized capture stride or length metadata.` );

}

function resetTelemetrySnapshot( value, label ) {

	requireObject( value, label );
	const count = requireNonnegativeInteger( value.resetEventCount, `${ label }.resetEventCount` );
	const events = requireArray( value.resetEvents, `${ label }.resetEvents` );
	if ( events.length !== count ) fail( `${ label }.resetEventCount does not match its append-only event rows.` );
	for ( const [ index, event ] of events.entries() ) {

		requireObject( event, `${ label }.resetEvents[${ index }]` );
		if ( typeof event.cause !== 'string' || event.cause.length === 0 || Number.isFinite( event.timeSeconds ) === false || event.timeSeconds < 0 ) fail( `${ label }.resetEvents[${ index }] is invalid.` );

	}
	return value;

}

function assertResetTelemetry( telemetry, recipe, previousRestored, label ) {

	requireObject( telemetry, label );
	const entry = resetTelemetrySnapshot( telemetry.entry, `${ label }.entry` );
	const effective = resetTelemetrySnapshot( telemetry.effective, `${ label }.effective` );
	const restored = resetTelemetrySnapshot( telemetry.restored, `${ label }.restored` );
	if ( previousRestored !== null && stableStringify( entry ) !== stableStringify( previousRestored ) ) fail( `${ label }.entry does not continue the prior append-only reset telemetry.` );
	if ( stableStringify( effective.resetEvents.slice( 0, entry.resetEventCount ) ) !== stableStringify( entry.resetEvents ) ) fail( `${ label } rewrote or removed preexisting reset telemetry.` );
	if ( stableStringify( restored ) !== stableStringify( effective ) ) fail( `${ label } restoration mutated append-only reset telemetry.` );
	const expectedCaptureDelta = recipe.effectiveState.timeline.resetHistoryCause === null ? 0 : 1;
	if ( telemetry.historyResetDelta !== expectedCaptureDelta || telemetry.restorationHistoryResetDelta !== 0 ) fail( `${ label } reset deltas differ from the frozen recipe/restoration contract.` );
	const appendedDuringCapture = requireArray( telemetry.appendedDuringCapture, `${ label }.appendedDuringCapture` );
	const appendedDuringRestoration = requireArray( telemetry.appendedDuringRestoration, `${ label }.appendedDuringRestoration` );
	if ( appendedDuringCapture.length !== expectedCaptureDelta || appendedDuringRestoration.length !== 0 ) fail( `${ label } reset append populations differ from their declared deltas.` );
	if ( stableStringify( appendedDuringCapture ) !== stableStringify( effective.resetEvents.slice( entry.resetEventCount ) ) ) fail( `${ label }.appendedDuringCapture is not the exact append slice.` );
	if ( expectedCaptureDelta === 1 ) {

		const expected = { cause: recipe.effectiveState.timeline.resetHistoryCause, timeSeconds: recipe.effectiveState.timeline.initialTimeSeconds };
		if ( stableStringify( appendedDuringCapture[ 0 ] ) !== stableStringify( expected ) ) fail( `${ label } appended the wrong reset cause or event time.` );

	}
	return restored;

}

function assertCorrectnessArtifactWrites( session ) {

	const writes = requireArray( session.artifactWrites, 'artifactWrites' );
	if ( writes.length === 0 ) fail( 'Correctness capture artifact write ledger is empty.' );
	const writeIndex = new Map();
	let captureSessionExcluded = false;
	for ( const [ rowIndex, write ] of writes.entries() ) {

		const label = `artifactWrites[${ rowIndex }]`;
		requireObject( write, label );
		if ( write.sequence !== rowIndex + 1 ) fail( `${ label }.sequence is not contiguous and canonical.` );
		if ( typeof write.path !== 'string' || write.path.length === 0 || write.path.startsWith( '/' ) || write.path.includes( '\\' ) || write.path.split( '/' ).includes( '..' ) ) fail( `${ label } has an invalid confined path.` );
		if ( writeIndex.has( write.path ) ) fail( `${ label } duplicates ${ write.path }.` );
		if ( typeof write.kind !== 'string' || write.kind.length === 0 || typeof write.existedBefore !== 'boolean' ) fail( `${ label } omits write provenance.` );
		if ( write.contentBinding === 'self-excluded-finalized-offline' ) {

			if ( write.path !== 'capture-session.json' || write.kind !== 'capture-session-record' || write.sha256 !== null || write.byteLength !== null || rowIndex !== writes.length - 1 ) fail( 'Only the final capture-session.json row may use the finalized self-exclusion record.' );
			captureSessionExcluded = true;
			writeIndex.set( write.path, write );
			continue;

		}
		if ( write.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) fail( `${ label } has an unsupported content binding.` );
		requireHash( write.sha256, `${ label }.sha256` );
		requirePositiveInteger( write.byteLength, `${ label }.byteLength` );
		writeIndex.set( write.path, write );

	}
	if ( captureSessionExcluded === false ) fail( 'Correctness capture did not finalize capture-session.json outside its own hash ledger.' );
	return writeIndex;

}

function assertArtifactWriteJoin( descriptor, writeIndex, label, expectedPath = null, expectedKind = null ) {

	requireObject( descriptor, label );
	if ( typeof descriptor.path !== 'string' || ( expectedPath !== null && descriptor.path !== expectedPath ) ) fail( `${ label }.path does not match its declared artifact path.` );
	requireHash( descriptor.sha256, `${ label }.sha256` );
	requirePositiveInteger( descriptor.byteLength, `${ label }.byteLength` );
	const write = writeIndex.get( descriptor.path );
	if ( write === undefined || write.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) fail( `${ label } is absent from the immutable write ledger.` );
	if ( expectedKind !== null && write.kind !== expectedKind ) fail( `${ label } write kind ${ write.kind } does not match ${ expectedKind }.` );
	if ( write.sha256 !== descriptor.sha256 || write.byteLength !== descriptor.byteLength ) fail( `${ label } hash/length does not exactly join its immutable write-ledger row.` );
	return write;

}

function assertCorrectnessReadbackCapture( capture, recipe, writeIndex, label ) {

	requireObject( capture, label );
	if ( capture.target !== recipe.id ) fail( `${ label }.target does not match recipe ${ recipe.id }.` );
	if ( capture.captureMode !== recipe.capture.target || capture.captureMode !== capture.evidence?.recipe?.target || capture.captureMode !== capture.evidence?.effectiveState?.mode ) fail( `${ label }.captureMode does not match the frozen recipe target and effective output mode.` );
	const width = Math.round( recipe.effectiveState.viewport.width * recipe.effectiveState.viewport.dpr );
	const height = Math.round( recipe.effectiveState.viewport.height * recipe.effectiveState.viewport.dpr );
	if ( capture.width !== width || capture.height !== height ) fail( `${ label } dimensions do not match recipe ${ recipe.id }.` );
	if ( capture.bytesPerPixel !== 4 || capture.bytesPerRow !== width * 4 ) fail( `${ label } is not compact RGBA8.` );
	if ( Number.isInteger( capture.sourceBytesPerRow ) === false || capture.sourceBytesPerRow < capture.bytesPerRow || capture.sourceBytesPerRow % 256 !== 0 ) fail( `${ label } renderer-returned row stride is not 256-byte aligned.` );
	const tightTransportLength = ( height - 1 ) * capture.sourceBytesPerRow + capture.bytesPerRow;
	const paddedTransportLength = capture.sourceBytesPerRow * height;
	if ( capture.sourceByteLength !== tightTransportLength && capture.sourceByteLength !== paddedTransportLength ) fail( `${ label } renderer-returned byte length is not a valid tight/full-final-row copy.` );
	if ( capture.transportByteLength !== capture.sourceByteLength ) fail( `${ label } retained transport length differs from the renderer-returned bytes.` );
	if ( capture.origin !== 'top-left' || capture.format !== 'rgba8' ) fail( `${ label } does not retain normalized top-left RGBA8 pixels.` );
	const stem = recipe.capture.filename.slice( 0, - 4 );
	const png = requireObject( capture.png, `${ label }.png` );
	const transport = requireObject( capture.transport, `${ label }.transport` );
	const normalized = requireObject( capture.normalized, `${ label }.normalized` );
	assertArtifactWriteJoin( png, writeIndex, `${ label }.png`, recipe.capture.filename, 'writeCapture-png' );
	assertArtifactWriteJoin( transport.artifact, writeIndex, `${ label }.transport.artifact`, `transport-readbacks/${ stem }.rgba8.bin`, 'writeCapture-transport' );
	assertArtifactWriteJoin( normalized.artifact, writeIndex, `${ label }.normalized.artifact`, `normalized-readbacks/${ stem }.rgba8.padded.bin`, 'writeCapture-normalized' );
	if ( transport.artifact.byteLength !== capture.transportByteLength ) fail( `${ label } transport artifact length does not match its retained bytes.` );
	const transportLayout = requireObject( transport.layout, `${ label }.transport.layout` );
	if ( transportLayout.width !== width || transportLayout.height !== height || transportLayout.rowBytes !== capture.bytesPerRow || transportLayout.bytesPerRow !== capture.sourceBytesPerRow || transportLayout.byteLength !== capture.sourceByteLength || transportLayout.origin !== 'top-left' ) fail( `${ label }.transport.layout does not bind the renderer-returned copy layout.` );
	if ( normalized.layout !== 'cpu-normalized-padded-rgba8' || normalized.origin !== 'top-left' || normalized.alignmentBytes !== 256 || Number.isInteger( normalized.bytesPerRow ) === false || normalized.bytesPerRow < capture.bytesPerRow || normalized.bytesPerRow % 256 !== 0 ) fail( `${ label } normalized row layout is not a 256-byte-aligned top-left RGBA8 artifact.` );
	if ( normalized.byteLength !== normalized.bytesPerRow * height || normalized.artifact.byteLength !== normalized.byteLength ) fail( `${ label } normalized byte length is inconsistent.` );
	const compact = requireObject( normalized.compact, `${ label }.normalized.compact` );
	if ( compact.layout !== 'compact-rgba8' || compact.origin !== 'top-left' || compact.bytesPerRow !== capture.bytesPerRow || compact.byteLength !== capture.bytesPerRow * height || compact.sha256 !== normalized.compactRgbaSha256 || compact.byteLength !== normalized.compactByteLength ) fail( `${ label } compact readback derivation is inconsistent.` );
	requireHash( normalized.compactRgbaSha256, `${ label }.normalized.compactRgbaSha256` );
	if ( png.encoding !== 'png-rgba8-srgb' || png.width !== width || png.height !== height || png.derivedFromCompactRgbaSha256 !== normalized.compactRgbaSha256 ) fail( `${ label } PNG is not bound to its retained compact RGBA pixels.` );
	return capture;

}

function assertRecipeCaptureEvidence( capture, recipe, index, previous, label ) {

	const evidence = requireObject( capture.evidence, `${ label }.evidence` );
	if ( evidence.schemaVersion !== 1 || evidence.evidenceKind !== 'validation-harness-correctness-capture-transaction-v1' || evidence.runtimeProfile !== CORRECTNESS_PROFILE ) fail( `${ label }.evidence is not a correctness-only recipe transaction envelope.` );
	if ( stableStringify( evidence.claimScope ) !== stableStringify( { correctness: true, performance: false, gpuAttribution: false } ) ) fail( `${ label }.evidence claim scope is not correctness-only.` );
	const recipeEvidence = requireObject( evidence.recipe, `${ label }.evidence.recipe` );
	if ( recipeEvidence.id !== recipe.id || recipeEvidence.schemaVersion !== recipe.schemaVersion || recipeEvidence.captureFilename !== recipe.capture.filename || recipeEvidence.target !== recipe.capture.target || recipeEvidence.expectedSceneScale !== recipe.expectedSceneScale ) fail( `${ label } recipe identity differs from the frozen contract.` );
	if ( stableStringify( recipeEvidence.parentRoute ) !== stableStringify( recipe.parentRoute ) || stableStringify( recipeEvidence.declaredEffectiveState ) !== stableStringify( recipe.effectiveState ) ) fail( `${ label } recipe parent/effective-state contract drifted.` );
	if ( recipeEvidence.digest !== stableHash( recipe ) || recipeEvidence.setDigest !== CORRECTNESS_RECIPE_SET_DIGEST ) fail( `${ label } recipe or recipe-set digest does not bind the canonical recipe table.` );
	const transaction = requireObject( evidence.transaction, `${ label }.evidence.transaction` );
	if ( transaction.schemaVersion !== 1 || transaction.status !== 'COMMITTED' || transaction.recipeId !== recipe.id || transaction.restorationVerdict !== 'PASS' ) fail( `${ label } transaction is not a committed recipe restoration.` );
	if ( transaction.sequence !== index + 1 || transaction.transactionId !== `capture-${ index + 1 }` ) fail( `${ label } transaction provenance is not canonical and ordered.` );
	const phases = requireObject( transaction.phaseVerdicts, `${ label }.evidence.transaction.phaseVerdicts` );
	if ( stableStringify( phases ) !== stableStringify( { capture: 'PASS', restore: 'PASS', settle: 'PASS', verify: 'PASS' } ) ) fail( `${ label } transaction phase verdicts are incomplete.` );
	const entryState = assertCaptureStateSnapshot( evidence.entryState, `${ label }.evidence.entryState` );
	const effectiveState = assertCaptureStateSnapshot( evidence.effectiveState, `${ label }.evidence.effectiveState` );
	const restoredState = assertCaptureStateSnapshot( evidence.restoredState, `${ label }.evidence.restoredState` );
	assertStableDigest( entryState, transaction.entryStateDigest, `${ label } entry state` );
	assertStableDigest( effectiveState, evidence.effectiveStateDigest, `${ label } effective state` );
	assertStableDigest( restoredState, transaction.restoredStateDigest, `${ label } restored state` );
	if ( evidence.parentStartupStateDigest !== transaction.entryStateDigest ) fail( `${ label } parent startup digest does not bind the transaction entry state.` );
	if ( transaction.entryStateDigest !== transaction.restoredStateDigest || stableStringify( entryState ) !== stableStringify( restoredState ) ) fail( `${ label } did not restore the full entry-state snapshot.` );
	assertCanonicalParentState( entryState, `${ label }.evidence.entryState` );
	if ( entryState.viewport.width !== CORRECTNESS_PARENT_LOCK.width || entryState.viewport.height !== CORRECTNESS_PARENT_LOCK.height || entryState.viewport.dpr !== CORRECTNESS_PARENT_LOCK.dpr || entryState.passScale !== 1 || entryState.outputNodeMode !== CORRECTNESS_PARENT_LOCK.mode || entryState.outputNodeId !== VALIDATION_MODE_OUTPUT_NODE_IDS[ CORRECTNESS_PARENT_LOCK.mode ] || entryState.captureTarget.width !== CORRECTNESS_PARENT_LOCK.width || entryState.captureTarget.height !== CORRECTNESS_PARENT_LOCK.height || entryState.sceneTarget.width !== CORRECTNESS_PARENT_LOCK.width || entryState.sceneTarget.height !== CORRECTNESS_PARENT_LOCK.height ) fail( `${ label } entry state is not the canonical correctness parent render state.` );
	for ( const key of [ 'scenario', 'tier', 'mode', 'camera', 'seed', 'timeSeconds' ] ) if ( effectiveState[ key ] !== recipe.effectiveState[ key ] ) fail( `${ label } effective ${ key } differs from its recipe.` );
	if ( stableStringify( effectiveState.viewport ) !== stableStringify( recipe.effectiveState.viewport ) || effectiveState.passScale !== recipe.expectedSceneScale || evidence.passScale !== recipe.expectedSceneScale ) fail( `${ label } effective viewport or scene scale differs from its recipe.` );
	if ( effectiveState.outputNodeMode !== recipe.capture.target || effectiveState.outputNodeId !== VALIDATION_MODE_OUTPUT_NODE_IDS[ recipe.capture.target ] ) fail( `${ label } effective output node does not match recipe target ${ recipe.capture.target }.` );
	const fullWidth = Math.round( recipe.effectiveState.viewport.width * recipe.effectiveState.viewport.dpr );
	const fullHeight = Math.round( recipe.effectiveState.viewport.height * recipe.effectiveState.viewport.dpr );
	if ( effectiveState.captureTarget.width !== fullWidth || effectiveState.captureTarget.height !== fullHeight || effectiveState.sceneTarget.width !== Math.max( 1, Math.round( fullWidth * recipe.expectedSceneScale ) ) || effectiveState.sceneTarget.height !== Math.max( 1, Math.round( fullHeight * recipe.expectedSceneScale ) ) ) fail( `${ label } effective target extents differ from its recipe.` );
	if ( stableStringify( entryState.device ) !== stableStringify( effectiveState.device ) || stableStringify( entryState.device ) !== stableStringify( restoredState.device ) ) fail( `${ label } crossed a device identity or generation during capture.` );
	const resources = assertResourcePhase( evidence.resources, recipe, `${ label }.evidence.resources` );
	const restoredSubmissions = assertSubmissionArithmetic( evidence.submissions, recipe, entryState, previous?.restoredSubmissions ?? null, `${ label }.evidence.submissions` );
	const restoredTelemetry = assertResetTelemetry( evidence.telemetry, recipe, previous?.restoredTelemetry ?? null, `${ label }.evidence.telemetry` );
	if ( previous !== null ) {

		if ( stableStringify( entryState ) !== stableStringify( previous.restoredState ) ) fail( `${ label } entry state does not continue from the previous committed recipe.` );
		if ( stableStringify( restorableResourceState( resources.entry ) ) !== stableStringify( restorableResourceState( previous.restoredResources ) ) ) fail( `${ label } entry resources do not continue from the previous committed recipe.` );

	}
	assertCaptureEnvelopeLayouts( evidence.layouts, capture, `${ label }.evidence.layouts` );
	return { transaction, entryState, effectiveState, restoredState, restoredResources: resources.restored, restoredSubmissions, restoredTelemetry };

}

function assertTierVisualEvidence( session, capturesByRecipe, writeIndex ) {

	const evidence = requireObject( session.hookResult?.tierVisualEvidence, 'hookResult.tierVisualEvidence' );
	if ( evidence.schemaVersion !== 1 || evidence.kind !== 'validation-harness-tier-visual-evidence-v1' || evidence.verdict !== 'PASS' ) fail( 'Tier visual evidence is not a passing schema-v1 comparison.' );
	const referenceCapture = capturesByRecipe.get( 'tier.target-performance.final' );
	const candidateCapture = capturesByRecipe.get( 'tier.governor-stress.final' );
	const bindings = [
		[ 'reference', referenceCapture, 'target-performance', 1, 1920, 1080 ],
		[ 'candidate', candidateCapture, 'governor-stress', 0.5, 960, 540 ]
	];
	for ( const [ key, capture, tier, passScale, sceneWidth, sceneHeight ] of bindings ) {

		const binding = requireObject( evidence.binding?.[ key ], `tierVisualEvidence.binding.${ key }` );
		const recipe = capture.evidence.recipe;
		const transaction = capture.evidence.transaction;
		if ( binding.recipeId !== recipe.id || binding.recipeDigest !== recipe.digest || binding.filename !== capture.png.path || binding.pngSha256 !== capture.png.sha256 || binding.passScale !== passScale ) fail( `Tier ${ key } binding does not identify its direct recipe capture.` );
		if ( stableStringify( binding.transaction ) !== stableStringify( {
			transactionId: transaction.transactionId,
			sequence: transaction.sequence,
			status: transaction.status,
			entryStateDigest: transaction.entryStateDigest,
			restoredStateDigest: transaction.restoredStateDigest,
			restorationVerdict: transaction.restorationVerdict
		} ) ) fail( `Tier ${ key } transaction binding drifted from its capture.` );
		if ( stableStringify( binding.effectiveState ) !== stableStringify( capture.evidence.effectiveState ) || binding.effectiveState.tier !== tier ) fail( `Tier ${ key } effective-state binding drifted.` );
		const normalized = capture.normalized;
		if ( binding.normalized?.artifact?.path !== normalized.artifact.path || binding.normalized?.artifact?.sha256 !== normalized.artifact.sha256 || binding.normalized?.artifact?.byteLength !== normalized.artifact.byteLength || binding.normalized?.compactRgbaSha256 !== normalized.compactRgbaSha256 || binding.normalized?.compactByteLength !== normalized.compactByteLength || binding.normalized?.width !== capture.width || binding.normalized?.height !== capture.height ) fail( `Tier ${ key } normalized readback binding drifted.` );
		if ( binding.captureEvidenceSha256 !== stableHash( capture.evidence ) ) fail( `Tier ${ key } capture-evidence digest is stale.` );
		const effectiveTargets = new Map( capture.evidence.resources.effective.renderTargets.map( ( target ) => [ target.semantic, target ] ) );
		const boundTargets = [ binding.resources?.captureTarget, ...( binding.resources?.sceneMrt ?? [] ) ];
		for ( const bound of boundTargets ) {

			const target = effectiveTargets.get( bound?.semantic );
			if ( target === undefined ) fail( `Tier ${ key } binds an unknown resource semantic.` );
			for ( const field of [ 'semantic', 'owner', 'targetName', 'textureUuid', 'width', 'height', 'format', 'bytes', 'logicalBytes', 'liveBytes', 'liveness' ] ) if ( bound[ field ] !== ( target[ field ] ?? null ) ) fail( `Tier ${ key } ${ bound.semantic } resource field ${ field } drifted.` );

		}
		if ( binding.resources.captureTarget.width !== 1920 || binding.resources.captureTarget.height !== 1080 ) fail( `Tier ${ key } capture-target extent is not 1920x1080.` );
		if ( binding.resources.sceneMrt.length !== 3 || binding.resources.sceneMrt.some( ( target ) => target.width !== sceneWidth || target.height !== sceneHeight ) ) fail( `Tier ${ key } scene-MRT extents are not bound to its tier scale.` );

	}
	if ( evidence.binding.reference.transaction.transactionId === evidence.binding.candidate.transaction.transactionId || evidence.binding.reference.transaction.sequence === evidence.binding.candidate.transaction.sequence || evidence.binding.reference.normalized.artifact.path === evidence.binding.candidate.normalized.artifact.path ) fail( 'Tier visual captures alias transaction or artifact provenance.' );
	const metrics = requireObject( evidence.metrics, 'tierVisualEvidence.metrics' );
	for ( const key of [ 'meanRgbByteDifference', 'edgeMaskPixels', 'edgeMeanRgbByteDifference', 'edgeP95RgbByteDifference' ] ) numeric( metrics[ key ], `tierVisualEvidence.metrics.${ key }`, 'Measured' );
	const gates = requireObject( evidence.gates, 'tierVisualEvidence.gates' );
	if ( numeric( gates.meanRgbByteDifference, 'tierVisualEvidence.gates.meanRgbByteDifference', 'Gated' ) !== 8 || numeric( gates.edgeP95RgbByteDifference, 'tierVisualEvidence.gates.edgeP95RgbByteDifference', 'Gated' ) !== 32 ) fail( 'Tier visual gates differ from the frozen correctness contract.' );
	if ( metrics.meanRgbByteDifference.value > gates.meanRgbByteDifference.value || metrics.edgeP95RgbByteDifference.value > gates.edgeP95RgbByteDifference.value || metrics.edgeMaskPixels.value < 1 ) fail( 'Tier visual PASS verdict exceeds its measured gates.' );
	if ( evidence.bindingSha256 !== stableHash( { binding: evidence.binding, metrics, gates } ) ) fail( 'Tier visual bindingSha256 does not bind its comparison record.' );
	const serialized = Buffer.from( `${ JSON.stringify( evidence, null, 2 ) }\n` );
	const descriptor = { path: 'tier-visual-evidence.json', sha256: `sha256:${ createHash( 'sha256' ).update( serialized ).digest( 'hex' ) }`, byteLength: serialized.byteLength };
	assertArtifactWriteJoin( descriptor, writeIndex, 'tier-visual-evidence.json', 'tier-visual-evidence.json', 'hook-artifact' );

}

function assertCorrectnessClaimScope( session ) {

	for ( const [ rootLabel, runtime ] of [ [ 'runtime', session.runtime ], [ 'finalRuntime', session.finalRuntime ] ] ) {

		const metrics = requireObject( runtime?.metrics, `${ rootLabel }.metrics` );
		const pipeline = requireObject( runtime?.pipeline, `${ rootLabel }.pipeline` );
		if ( metrics.runtimeProfile !== CORRECTNESS_PROFILE || pipeline.runtimeProfile !== CORRECTNESS_PROFILE ) fail( `${ rootLabel } crossed out of the correctness runtime profile.` );
		if ( stableStringify( metrics.routeLock ) !== stableStringify( { kind: 'tier', id: 'webgpu-correctness' } ) ) fail( `${ rootLabel }.metrics does not bind the tier/webgpu-correctness controller route lock.` );
		for ( const [ label, value ] of [
			[ 'metrics.timestampQueriesRequired', metrics.timestampQueriesRequired ],
			[ 'metrics.timestampQueriesRequested', metrics.timestampQueriesRequested ],
			[ 'metrics.timestampQueriesActive', metrics.timestampQueriesActive ],
			[ 'pipeline.timestampQueriesRequired', pipeline.timestampQueriesRequired ],
			[ 'pipeline.timestampQueriesRequested', pipeline.timestampQueriesRequested ],
			[ 'pipeline.timestampQueriesActive', pipeline.timestampQueriesActive ]
		] ) if ( value !== false ) fail( `${ rootLabel}.${ label } must be false in correctness-only evidence.` );
		assertCanonicalParentState( metrics, `${ rootLabel }.metrics` );
		if ( metrics.viewport?.width !== CORRECTNESS_PARENT_LOCK.width || metrics.viewport?.height !== CORRECTNESS_PARENT_LOCK.height || metrics.viewport?.dpr !== CORRECTNESS_PARENT_LOCK.dpr ) fail( `${ rootLabel }.metrics viewport escaped the correctness parent route.` );

	}
	const hookResult = requireObject( session.hookResult, 'hookResult' );
	if ( hookResult.status !== 'incomplete' || hookResult.publishable !== false ) fail( 'Correctness capture hook result must remain nonpublishable and incomplete before lane joining and visual sign-off.' );
	const bundle = requireObject( hookResult.bundle, 'hookResult.bundle' );
	if ( bundle.bundleKind !== 'raw-capture-candidate' || bundle.publishable !== false ) fail( 'Correctness capture bundle must remain a raw nonpublishable candidate.' );
	const verdicts = requireObject( bundle.claimVerdicts, 'hookResult.bundle.claimVerdicts' );
	if ( verdicts.performanceCompliance !== 'NOT_CLAIMED' ) fail( 'Correctness-only capture must leave performanceCompliance NOT_CLAIMED.' );
	if ( verdicts.gpuAttribution !== 'INSUFFICIENT_EVIDENCE' ) fail( 'Correctness-only capture must leave gpuAttribution INSUFFICIENT_EVIDENCE.' );
	const gpuTiming = requireObject( hookResult.gpuTiming, 'hookResult.gpuTiming' );
	if ( gpuTiming.verdict !== 'NOT_CLAIMED' || gpuTiming.renderMs !== null || gpuTiming.computeMs !== null ) fail( 'Correctness-only capture must leave GPU timing NOT_CLAIMED with no timing values.' );
	const finalMetrics = requireObject( session.finalRuntime.metrics, 'finalRuntime.metrics' );
	const captureTransaction = requireObject( finalMetrics.captureTransaction, 'finalRuntime.metrics.captureTransaction' );
	if ( captureTransaction.active !== null || captureTransaction.poisoned !== null || captureTransaction.nextSequence !== CORRECTNESS_CAPTURE_RECIPES.length + 1 ) fail( 'Correctness session did not finalize all recipe transactions in a clean idle coordinator.' );
	if ( finalMetrics.postCommitPoison !== null ) fail( 'Correctness session retained a post-commit poison record.' );
	if ( finalMetrics.controllerOperation?.active !== null ) fail( 'Correctness session finalized while a controller operation was active.' );
	if ( finalMetrics.disposal?.started !== false ) fail( 'Correctness session final runtime was sampled after disposal began.' );

}

function assertCorrectnessRoute( session ) {

	if ( typeof session.browserEntry !== 'string' || session.browserEntry.endsWith( '/tier/webgpu-correctness/index.html' ) === false ) fail( 'Correctness capture must execute the locked tier/webgpu-correctness browser entry.' );
	let requested;
	let final;
	try {

		requested = new URL( session.url );
		final = new URL( session.finalUrl );

	} catch {

		fail( 'Correctness capture URL is invalid.' );

	}
	if ( requested.href !== final.href || requested.searchParams.getAll( 'capture' ).length !== 1 || requested.searchParams.get( 'capture' ) !== '1' || requested.searchParams.getAll( 'profile' ).length !== 1 || requested.searchParams.get( 'profile' ) !== CORRECTNESS_PROFILE || [ ...requested.searchParams.keys() ].some( ( key ) => ! [ 'capture', 'profile' ].includes( key ) ) ) fail( 'Correctness capture did not preserve its exact locked profile URL.' );
	const route = requireObject( session.route, 'route' );
	if ( route.requestedUrl !== session.url || route.finalUrl !== session.finalUrl || route.browserEntry !== session.browserEntry || route.manifestLabId !== session.labId ) fail( 'Correctness capture route identity is inconsistent.' );
	for ( const stateName of [ 'lockedState', 'observedState', 'finalState' ] ) {

		assertCanonicalParentState( route[ stateName ], `route.${ stateName }` );
		if ( stableStringify( route[ stateName ] ) !== stableStringify( route.lockedState ) ) fail( `route.${ stateName } differs from the immutable parent route state.` );

	}

}

function assertDiagnosticMosaicBinding( session, writeIndex ) {

	const output = session.outputPlan.find( ( entry ) => entry.id === 'diagnostics.mosaic' );
	const final = session.outputPlan.find( ( entry ) => entry.id === 'final.design' );
	if ( output.artifact.sha256 === final.artifact.sha256 ) fail( 'Diagnostics mosaic aliases final output.' );
	if ( stableStringify( output.sourceCaptures ) !== stableStringify( DIAGNOSTIC_MOSAIC_SOURCES ) || output.derivation?.kind !== 'hook-validated-derived-output' || output.derivation?.validationStatus !== 'PASS' ) fail( 'Diagnostics mosaic is not a validated derivation of the four direct output-node captures.' );
	const hookOutput = session.hookResult?.standardOutputs?.find( ( entry ) => entry?.filename === 'diagnostics.mosaic.png' );
	requireObject( hookOutput, 'hookResult diagnostics mosaic' );
	if ( hookOutput.id !== 'diagnostics.mosaic' || hookOutput.status !== 'CAPTURED' || stableStringify( hookOutput.sourceCaptures ) !== stableStringify( DIAGNOSTIC_MOSAIC_SOURCES ) ) fail( 'Hook result diagnostics mosaic identity is invalid.' );
	assertArtifactWriteJoin( hookOutput.file, writeIndex, 'hookResult diagnostics mosaic file', 'diagnostics.mosaic.png', 'hook-artifact' );
	if ( hookOutput.file.sha256 !== output.artifact.sha256 || hookOutput.file.byteLength !== output.artifact.byteLength ) fail( 'Output-plan mosaic does not join the hook-derived file evidence.' );
	const pixel = requireObject( hookOutput.pixelEvidence, 'hookResult diagnostics mosaic pixelEvidence' );
	assertArtifactWriteJoin( pixel.png, writeIndex, 'hookResult diagnostics mosaic PNG evidence', 'diagnostics.mosaic.png', 'hook-artifact' );
	assertArtifactWriteJoin( pixel.normalized?.rawArtifact, writeIndex, 'hookResult diagnostics mosaic normalized raw', 'normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin', 'hook-artifact' );
	assertArtifactWriteJoin( pixel.normalized?.packedArtifact, writeIndex, 'hookResult diagnostics mosaic normalized packed', 'normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin', 'hook-artifact' );
	if ( pixel.png.derivedFromPackedRgbaSha256 !== pixel.normalized.packedRgbaSha256 || pixel.normalized.packedArtifact.sha256 !== pixel.normalized.packedRgbaSha256 || pixel.normalized.paddingVerifiedZero !== true || pixel.normalized.origin !== 'top-left' ) fail( 'Diagnostics mosaic PNG is not bound to its retained normalized pixels.' );

}

export function validateCorrectnessCaptureSession( session ) {

	requireObject( session, 'correctness capture session' );
	if ( session.schemaVersion !== 2 || session.profile !== CORRECTNESS_PROFILE ) fail( 'Expected a schema-v2 correctness capture session.' );
	if ( session.automationSurface !== PLAYWRIGHT_CORRECTNESS_SURFACE || session.browser?.automationSurface !== PLAYWRIGHT_CORRECTNESS_SURFACE ) fail( 'Correctness capture requires automationSurface=playwright-headless-chromium.' );
	if ( session.profileConfig?.width !== CORRECTNESS_PARENT_LOCK.width || session.profileConfig?.height !== CORRECTNESS_PARENT_LOCK.height || session.profileConfig?.dpr !== CORRECTNESS_PARENT_LOCK.dpr ) fail( `Correctness capture must use ${ CORRECTNESS_PARENT_LOCK.width }x${ CORRECTNESS_PARENT_LOCK.height } at DPR ${ CORRECTNESS_PARENT_LOCK.dpr }.` );
	if ( ! [ 'hardware', 'software', 'unknown' ].includes( session.adapterClass ) ) fail( 'Correctness capture adapter class is invalid.' );
	requireObject( session.adapterIdentity, 'adapterIdentity' );
	if ( session.threeRevision !== '0.185.1' ) fail( 'Correctness capture must use Three.js 0.185.1.' );
	for ( const key of [ 'sourceHash', 'sourceClosureHash', 'buildRevision' ] ) requireHash( session[ key ], key );
	if ( session.sourceHash !== session.sourceClosureHash ) fail( 'Correctness capture source and source-closure hashes differ.' );
	requireObject( session.sourceClosure, 'sourceClosure' );
	if ( session.sourceClosure.sourceHash !== session.sourceClosureHash || session.sourceClosure.buildRevision !== session.buildRevision || session.sourceClosure.threeRevision !== session.threeRevision ) fail( 'Correctness capture source closure identity is inconsistent.' );
	assertCaptureSessionInterval( session );
	assertCorrectnessRoute( session );
	for ( const field of [ 'pageErrors', 'consoleErrors', 'requestErrors' ] ) if ( requireArray( session[ field ], field ).length > 0 ) fail( `Correctness capture contains ${ field }.` );
	const metrics = requireObject( session.runtime?.metrics, 'runtime.metrics' );
	if ( metrics.nativeWebGPU !== true || metrics.initialized !== true || String( metrics.backend ?? metrics.backendKind ?? '' ).toLowerCase() !== 'webgpu' ) fail( 'Correctness capture lacks initialized native WebGPU proof.' );
	assertCorrectnessClaimScope( session );
	const writeIndex = assertCorrectnessArtifactWrites( session );
	const captures = requireArray( session.writtenCaptures, 'writtenCaptures' );
	if ( captures.length !== CORRECTNESS_CAPTURE_RECIPES.length ) fail( `Correctness capture requires exactly ${ CORRECTNESS_CAPTURE_RECIPES.length } direct recipe readbacks.` );
	const capturesByRecipe = new Map();
	const transactions = new Set();
	const capturePaths = new Set();
	const outputNodesByMode = new Map();
	const outputModesByUuid = new Map();
	let previous = null;
	for ( let index = 0; index < CORRECTNESS_CAPTURE_RECIPES.length; index ++ ) {

		const recipe = CORRECTNESS_CAPTURE_RECIPES[ index ];
		const capture = assertCorrectnessReadbackCapture( captures[ index ], recipe, writeIndex, `writtenCaptures[${ index }]` );
		const proof = assertRecipeCaptureEvidence( capture, recipe, index, previous, `writtenCaptures[${ index }]` );
		if ( transactions.has( proof.transaction.transactionId ) ) fail( `Correctness capture aliases transaction ${ proof.transaction.transactionId }.` );
		transactions.add( proof.transaction.transactionId );
		const outputIdentity = { uuid: proof.effectiveState.outputNodeUuid, type: proof.effectiveState.outputNodeType };
		const priorIdentity = outputNodesByMode.get( proof.effectiveState.mode );
		if ( priorIdentity !== undefined && stableStringify( priorIdentity ) !== stableStringify( outputIdentity ) ) fail( `Correctness capture changed ${ proof.effectiveState.mode } output-node identity between recipes.` );
		const priorMode = outputModesByUuid.get( outputIdentity.uuid );
		if ( priorMode !== undefined && priorMode !== proof.effectiveState.mode ) fail( `Correctness capture aliases output-node UUID ${ outputIdentity.uuid } across ${ priorMode } and ${ proof.effectiveState.mode }.` );
		outputNodesByMode.set( proof.effectiveState.mode, outputIdentity );
		outputModesByUuid.set( outputIdentity.uuid, proof.effectiveState.mode );
		for ( const path of [ capture.png.path, capture.transport.artifact.path, capture.normalized.artifact.path ] ) {

			if ( capturePaths.has( path ) ) fail( `Correctness capture aliases artifact path ${ path }.` );
			capturePaths.add( path );

		}
		capturesByRecipe.set( recipe.id, capture );
		previous = proof;

	}
	if ( stableStringify( [ ...outputNodesByMode.keys() ].sort() ) !== stableStringify( Object.keys( VALIDATION_MODE_OUTPUT_NODE_IDS ).sort() ) ) fail( 'Correctness recipe set did not execute every canonical output-node identity.' );
	const outputs = requireArray( session.outputPlan, 'outputPlan' );
	if ( outputs.length !== STANDARD_OUTPUTS.length ) fail( `Correctness capture must disposition all ${ STANDARD_OUTPUTS.length } standard outputs.` );
	for ( let index = 0; index < STANDARD_OUTPUTS.length; index ++ ) {

		const filename = STANDARD_OUTPUTS[ index ];
		const output = requireObject( outputs[ index ], `outputPlan[${ index }]` );
		if ( output.id !== filename.slice( 0, - 4 ) || output.status !== 'CAPTURED' || output.filename !== filename ) fail( `Correctness output ${ filename } is missing, reordered, or not captured.` );
		assertArtifactWriteJoin( output.artifact, writeIndex, `${ filename } output artifact`, filename );
		if ( filename !== 'diagnostics.mosaic.png' ) {

			const capture = capturesByRecipe.get( filename.slice( 0, - 4 ) );
			if ( capture === undefined || output.derivation?.kind !== 'direct-render-target-readback' || output.derivation?.validationStatus !== 'PASS' || output.artifact.sha256 !== capture.png.sha256 || output.artifact.byteLength !== capture.png.byteLength ) fail( `${ filename } is not joined to its direct recipe readback.` );

		}

	}
	assertDiagnosticMosaicBinding( session, writeIndex );
	assertTierVisualEvidence( session, capturesByRecipe, writeIndex );
	return { valid: true, profile: session.profile, outputCount: outputs.length, captureCount: captures.length, recipeCount: CORRECTNESS_CAPTURE_RECIPES.length, adapterClass: session.adapterClass };

}

export function validatePhysicalRouteSession( session ) {

	requireObject( session, 'physical route session' );
	if ( session.profile !== PHYSICAL_ROUTE_PROFILE ) fail( 'Expected a physical-route session.' );
	const build = assertCaptureEnvironment( session );
	assertRouteSequence( session, PHYSICAL_ROUTE_PLAN, build );
	assertServedBytes( session, build, PHYSICAL_ROUTE_PLAN );
	return { valid: true, profile: session.profile, routeCount: session.routes.length };

}

function assertPerformanceWindow( window, index, refreshPeriodMs, options = {} ) {

	const label = options.label ?? `sustainedWindows[${ index }]`;
	const minimumDuration = options.minimumDuration ?? HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumDuration.value;
	const minimumSamples = options.minimumSamples ?? HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumSamples.value;
	const enforceSustainedGates = options.enforceSustainedGates !== false;
	requireObject( window, label );
	const duration = numeric( window.duration, `${ label }.duration`, 'Measured' );
	const sampleCount = numeric( window.sampleCount, `${ label }.sampleCount`, 'Measured' );
	const maxGap = numeric( window.maximumPresentationGap, `${ label }.maximumPresentationGap`, 'Measured' );
	const coverage = numeric( window.presentationCoverage, `${ label }.presentationCoverage`, 'Derived' );
	const presentationSamples = numericArray( window.presentationSamples, `${ label }.presentationSamples`, 'Measured' );
	if ( duration < minimumDuration ) fail( `${ label } is shorter than its minimum duration.` );
	if ( sampleCount < minimumSamples || presentationSamples.length < minimumSamples ) fail( `${ label } has fewer than ${ minimumSamples } presentation samples.` );
	if ( sampleCount !== presentationSamples.length ) fail( `${ label } sampleCount does not match its presentation population.` );
	if ( presentationSamples.some( ( sample ) => sample <= 0 ) ) fail( `${ label } contains a nonpositive presentation interval.` );
	if ( Math.abs( presentationSamples.reduce( ( sum, sample ) => sum + sample, 0 ) - duration ) > 1e-6 ) fail( `${ label } presentation intervals do not cover the full segment duration.` );
	const observedMaximumGap = Math.max( ...presentationSamples );
	if ( Math.abs( observedMaximumGap - maxGap ) > 1e-9 ) fail( `${ label } maximumPresentationGap does not match its presentation population.` );
	if ( enforceSustainedGates && maxGap > HARDWARE_PERFORMANCE_CONTRACT.maximumPresentationGap.value ) fail( `${ label } exceeds the presentation-gap gate.` );
	const derivedCoverage = presentationSamples.length / ( duration / refreshPeriodMs );
	if ( Math.abs( coverage - derivedCoverage ) > 1e-9 ) fail( `${ label } presentation-coverage value does not reconcile with elapsed time and the refresh target.` );
	if ( enforceSustainedGates && ( coverage < HARDWARE_PERFORMANCE_CONTRACT.minimumPresentationCoverage.value || coverage > 1.05 ) ) fail( `${ label } fails the presentation-coverage gate.` );
	const presentationP95 = percentile( presentationSamples, 0.95 );
	if ( enforceSustainedGates && presentationP95 > HARDWARE_PERFORMANCE_CONTRACT.presentationP95Maximum.value ) fail( `${ label } presentation p95 exceeds the declared cadence gate.` );
	const deadlineMissRatio = presentationSamples.filter( ( sample ) => sample > HARDWARE_PERFORMANCE_CONTRACT.deadlineThreshold.value ).length / presentationSamples.length;
	if ( enforceSustainedGates && deadlineMissRatio > HARDWARE_PERFORMANCE_CONTRACT.maximumDeadlineMissRatio.value ) fail( `${ label } deadline-miss ratio exceeds the declared gate.` );
	const batches = requireArray( window.gpuTimestampBatches, `${ label }.gpuTimestampBatches` );
	if ( batches.length === 0 ) fail( `${ label } has no GPU timestamp batches.` );
	const windowWarmupCpuSamples = [];
	const windowCpuSamples = [];
	const windowGpuSamples = [];
	for ( const [ batchIndex, batch ] of batches.entries() ) {

		const batchLabel = `${ label }.gpuTimestampBatches[${ batchIndex }]`;
		if ( batch.verdict !== 'PASS' || batch.mappingCadence !== 'once-per-batch' ) fail( `${ batchLabel } is not a passing batched timestamp population.` );
		const warmupFrames = numeric( batch.warmupFrames, `${ batchLabel }.warmupFrames`, 'Measured' );
		const batchWarmupCpuSamples = numericArray( batch.warmupCpuSamples, `${ batchLabel }.warmupCpuSamples`, 'Measured' );
		const frames = numeric( batch.sampleFrames, `${ batchLabel }.sampleFrames`, 'Measured' );
		const resolves = numeric( batch.resolveCount, `${ batchLabel }.resolveCount`, 'Measured' );
		if ( frames < 1 || resolves < 1 || resolves >= frames ) fail( `${ batchLabel } mapped timestamps per frame or has invalid coverage.` );
		const cpuSamples = numericArray( batch.cpuSamples, `${ batchLabel }.cpuSamples`, 'Measured' );
		if ( batchWarmupCpuSamples.length !== warmupFrames ) fail( `${ batchLabel } warm-up CPU sample count does not match its frame population.` );
		windowWarmupCpuSamples.push( ...batchWarmupCpuSamples );
		if ( cpuSamples.length !== frames ) fail( `${ batchLabel } CPU sample count does not match its frame population.` );
		windowCpuSamples.push( ...cpuSamples );
		const gpuSamples = numericArray( batch.gpuSamples, `${ batchLabel }.gpuSamples`, 'Measured' );
		if ( gpuSamples.length !== frames ) fail( `${ batchLabel } timestamp sample count does not match its frame population.` );
		windowGpuSamples.push( ...gpuSamples );
		const timestampRows = requireArray( batch.timestampRows, `${ batchLabel }.timestampRows` );
		if ( timestampRows.length !== frames ) fail( `${ batchLabel } must bind every frame to an explicit timestamp row.` );
		for ( const [ rowIndex, row ] of timestampRows.entries() ) {

			const rowLabel = `${ batchLabel }.timestampRows[${ rowIndex }]`;
			requireObject( row, rowLabel );
			for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) requireFinite( row[ key ], `${ rowLabel }.${ key }`, 0 );
			if ( Math.abs( row.sceneMs + row.outputMs - row.totalMs ) > 1e-9 ) fail( `${ rowLabel } total is not derived from its explicit stages.` );
			if ( Math.abs( gpuSamples[ rowIndex ] - row.totalMs ) > 1e-9 ) fail( `${ rowLabel } total does not match the bound GPU sample.` );
			if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) fail( `${ rowLabel } fabricates an independent per-frame aggregate.` );

		}
		if ( batch.independentPerFrameTotalsAvailable !== false ) fail( `${ batchLabel } falsely claims independent per-frame aggregate timestamps.` );
		const lastFrameResolveResidualMs = requireFinite( batch.lastFrameResolveResidualMs, `${ batchLabel }.lastFrameResolveResidualMs`, 0 );
		if ( lastFrameResolveResidualMs > 0.001 ) fail( `${ batchLabel } final-frame timestamp resolve does not reconcile.` );
		if ( batch.reconciliationKind !== 'final-renderer-frame-aggregate' ) fail( `${ batchLabel } does not declare the final-renderer-frame aggregate reconciliation kind.` );
		if ( typeof batch.reconciliationScope !== 'string' || batch.reconciliationScope.length === 0 ) fail( `${ batchLabel } omits its reconciliation scope explanation.` );

	}
	const cpuP95 = percentile( windowCpuSamples, 0.95 );
	if ( enforceSustainedGates && cpuP95 > HARDWARE_PERFORMANCE_CONTRACT.cpuP95Maximum.value ) fail( `${ label } CPU p95 exceeds the declared current-adapter gate.` );
	const gpuP95 = percentile( windowGpuSamples, 0.95 );
	if ( enforceSustainedGates && gpuP95 > HARDWARE_PERFORMANCE_CONTRACT.gpuP95Maximum.value ) fail( `${ label } GPU p95 exceeds the declared current-adapter gate.` );
	return {
		warmupCpuSamples: windowWarmupCpuSamples,
		presentationSamples,
		cpuSamples: windowCpuSamples,
		gpuSamples: windowGpuSamples,
		presentationP50: percentile( presentationSamples, 0.5 ),
		presentationP95,
		deadlineMissRatio,
		cpuP50: percentile( windowCpuSamples, 0.5 ),
		cpuP95,
		gpuP50: percentile( windowGpuSamples, 0.5 ),
		gpuP95
	};

}

function assertGovernorTimestampRow( row, sample, label ) {

	requireObject( row, label );
	for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) requireFinite( row[ key ], `${ label }.${ key }`, 0 );
	if ( Math.abs( row.sceneMs + row.outputMs - row.totalMs ) > 1e-9 ) fail( `${ label } total is not derived from its explicit stages.` );
	if ( Math.abs( sample - row.totalMs ) > 1e-9 ) fail( `${ label } total does not match the bound GPU sample.` );
	if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) fail( `${ label } fabricates an independent per-frame aggregate.` );

}

function assertGovernorTrace( governor, tierResourceBytes ) {

	const trace = requireObject( governor.trace, 'governor.trace' );
	if ( trace.adapterClass !== 'hardware' ) fail( 'Quality governor trace requires a hardware adapter.' );
	if ( trace.windowCount !== HARDWARE_PERFORMANCE_CONTRACT.governorWindowCount.value || Number.isInteger( trace.windowCount ) === false ) fail( 'Quality governor window count differs from the fixed stress contract.' );
	if ( trace.framesPerWindow !== HARDWARE_PERFORMANCE_CONTRACT.governorFramesPerWindow.value || Number.isInteger( trace.framesPerWindow ) === false ) fail( 'Quality governor frame population differs from the fixed stress contract.' );
	if ( Math.abs( trace.targetMs - HARDWARE_PERFORMANCE_CONTRACT.governorTarget.value ) > 1e-9 ) fail( 'Quality governor target differs from the fixed stress contract.' );
	if ( Math.abs( trace.hysteresisMs - HARDWARE_PERFORMANCE_CONTRACT.governorHysteresis.value ) > 1e-9 ) fail( 'Quality governor hysteresis differs from the fixed stress contract.' );
	if ( trace.minimumResidenceWindows !== HARDWARE_PERFORMANCE_CONTRACT.governorMinimumResidence.value ) fail( 'Quality governor minimum residence differs from the fixed stress contract.' );
	if ( trace.cooldownWindows !== HARDWARE_PERFORMANCE_CONTRACT.governorCooldown.value ) fail( 'Quality governor cooldown differs from the fixed stress contract.' );
	const states = requireArray( trace.states, 'governor.trace.states' );
	if ( stableStringify( states ) !== stableStringify( [ 'target-performance', 'governor-stress' ] ) ) fail( 'Quality governor states differ from the fixed tier order.' );
	if ( trace.initialState !== 'governor-stress' ) fail( 'Quality governor initial state must match the locked governor-stress route.' );
	const windows = requireArray( trace.windows, 'governor.trace.windows' );
	if ( windows.length !== trace.windowCount ) fail( 'Quality governor window population does not match windowCount.' );
	const transitions = requireArray( trace.transitions, 'governor.trace.transitions' );
	if ( transitions.length < HARDWARE_PERFORMANCE_CONTRACT.minimumGovernorTransitions.value ) fail( 'Quality governor did not exercise a real tier transition.' );

	let stateIndex = states.indexOf( trace.initialState );
	let residence = 0;
	let cooldown = 0;
	let transitionIndex = 0;
	for ( const [ index, window ] of windows.entries() ) {

		const label = `governor.trace.windows[${ index }]`;
		requireObject( window, label );
		if ( window.window !== index ) fail( `${ label } sequence index drifted.` );
		if ( window.measuredTier !== states[ stateIndex ] ) fail( `${ label } measured tier does not match the active governor state.` );
		const gpuSamples = requireArray( window.gpuSamples, `${ label }.gpuSamples` );
		if ( gpuSamples.length !== trace.framesPerWindow || gpuSamples.some( ( sample ) => Number.isFinite( sample ) === false || sample < 0 ) ) fail( `${ label } does not contain the fixed finite GPU population.` );
		const gpuP95 = percentile( gpuSamples, 0.95 );
		if ( Number.isFinite( window.gpuP95 ) === false || Math.abs( window.gpuP95 - gpuP95 ) > 1e-9 ) fail( `${ label } GPU p95 does not reconcile with its sample population.` );
		const timestampRows = requireArray( window.timestampRows, `${ label }.timestampRows` );
		if ( timestampRows.length !== trace.framesPerWindow ) fail( `${ label } timestamp rows do not cover the fixed GPU population.` );
		for ( let frame = 0; frame < timestampRows.length; frame ++ ) assertGovernorTimestampRow( timestampRows[ frame ], gpuSamples[ frame ], `${ label }.timestampRows[${ frame }]` );
		const resolveResidual = requireFinite( window.lastFrameResolveResidualMs, `${ label }.lastFrameResolveResidualMs`, 0 );
		if ( resolveResidual > 0.001 ) fail( `${ label } final-frame timestamp resolve does not reconcile.` );

		residence ++;
		if ( cooldown > 0 ) cooldown --;
		let decision = 'hold';
		let nextStateIndex = stateIndex;
		if ( cooldown === 0 && residence >= trace.minimumResidenceWindows ) {

			if ( gpuP95 > trace.targetMs && stateIndex < states.length - 1 ) {

				decision = 'degrade';
				nextStateIndex ++;

			} else if ( gpuP95 < trace.targetMs - trace.hysteresisMs && stateIndex > 0 ) {

				decision = 'upgrade';
				nextStateIndex --;

			}

		}
		if ( window.decision !== decision ) fail( `${ label } decision does not follow target, hysteresis, residence, and cooldown.` );
		if ( decision === 'hold' ) {

			if ( transitions[ transitionIndex ]?.window === index ) fail( `${ label } records an unexpected transition.` );

		} else {

			const transition = requireObject( transitions[ transitionIndex ], `governor.trace.transitions[${ transitionIndex }]` );
			const from = states[ stateIndex ];
			const to = states[ nextStateIndex ];
			const expectedCause = decision === 'degrade' ? 'gpu-p95-over-budget' : 'gpu-p95-below-hysteresis';
			if ( transition.window !== index || transition.from !== from || transition.to !== to || transition.cause !== expectedCause ) fail( `${ label } transition lineage does not match its decision.` );
			if ( Math.abs( transition.gpuP95 - gpuP95 ) > 1e-9 ) fail( `${ label } transition p95 does not match its triggering population.` );
			requireFinite( transition.rebuildCpuSubmissionMs, `${ label } transition rebuildCpuSubmissionMs`, 0 );
			const rebuildGpuMs = requireFinite( transition.rebuildGpuMs, `${ label } transition rebuildGpuMs`, 0 );
			assertGovernorTimestampRow( transition.rebuildTimestampRow, rebuildGpuMs, `${ label } transition rebuildTimestampRow` );
			if ( requireFinite( transition.lastFrameResolveResidualMs, `${ label } transition lastFrameResolveResidualMs`, 0 ) > 0.001 ) fail( `${ label } transition rebuild timestamp does not reconcile.` );
			const fromResourceBytes = requireFinite( transition.fromResourceBytes, `${ label } transition fromResourceBytes`, 0 );
			const toResourceBytes = requireFinite( transition.toResourceBytes, `${ label } transition toResourceBytes`, 0 );
			if ( fromResourceBytes !== tierResourceBytes[ from ] || toResourceBytes !== tierResourceBytes[ to ] ) fail( `${ label } transition resource bytes do not match the locked tier resource inventories.` );
			if ( decision === 'degrade' ? toResourceBytes >= fromResourceBytes : toResourceBytes <= fromResourceBytes ) fail( `${ label } transition resource direction contradicts the tier change.` );
			stateIndex = nextStateIndex;
			residence = 0;
			cooldown = trace.cooldownWindows;
			transitionIndex ++;

		}
		if ( window.tier !== states[ stateIndex ] || window.residence !== residence || window.cooldown !== cooldown ) fail( `${ label } committed state counters do not match the governor state machine.` );

	}
	if ( transitionIndex !== transitions.length ) fail( 'Quality governor trace contains transitions not produced by its state machine.' );
	const directions = transitions.map( ( transition ) => states.indexOf( transition.to ) - states.indexOf( transition.from ) );
	const oscillationDetected = directions.some( ( direction, index ) => index > 0 && direction !== directions[ index - 1 ] );
	if ( trace.oscillationDetected !== oscillationDetected ) fail( 'Quality governor oscillation verdict does not reconcile with its transitions.' );
	if ( oscillationDetected ) fail( 'Quality governor trace oscillated.' );
	if ( trace.settledState !== states[ stateIndex ] ) fail( 'Quality governor settled state does not match the final state-machine state.' );
	let settledResidence = 0;
	for ( let index = windows.length - 1; index >= 0 && windows[ index ].measuredTier === trace.settledState; index -- ) settledResidence ++;
	if ( settledResidence < HARDWARE_PERFORMANCE_CONTRACT.governorMinimumResidence.value ) fail( 'Quality governor lacks a two-window settled residence.' );
	if ( governor.verdict !== 'PASS' || governor.settled !== true || governor.settledState !== trace.settledState || governor.oscillationDetected !== trace.oscillationDetected ) fail( 'Quality governor summary does not match its trace.' );
	if ( numeric( governor.settledResidenceWindows, 'governor.settledResidenceWindows', 'Measured' ) !== settledResidence ) fail( 'Quality governor settled residence does not reconcile with measured-tier windows.' );
	return { transitionCount: transitions.length, settledResidence };

}

export function validateHardwarePerformanceSession( session ) {

	requireObject( session, 'hardware performance session' );
	if ( session.profile !== HARDWARE_PERFORMANCE_PROFILE ) fail( 'Expected a hardware-performance session.' );
	const build = assertCaptureEnvironment( session );
	assertRouteSequence( session, HARDWARE_PERFORMANCE_ROUTE_PLAN, build );
	assertServedBytes( session, build, HARDWARE_PERFORMANCE_ROUTE_PLAN );
	const tierResourceBytes = assertHardwarePerformanceRouteResources( session );
	if ( session.viewport?.width !== 1920 || session.viewport?.height !== 1080 || session.viewport?.dpr !== 1 ) fail( 'Hardware performance capture must use 1920x1080 at DPR 1.' );
	if ( numeric( session.refresh?.measurementDuration, 'refresh.measurementDuration', 'Measured' ) < HARDWARE_PERFORMANCE_CONTRACT.idleRefreshMinimumDuration.value ) fail( 'Idle-rAF refresh measurement is shorter than two seconds.' );
	if ( numeric( session.hostReserve?.p95, 'hostReserve.p95', 'Measured' ) < 0 ) fail( 'Measured host reserve is invalid.' );
	const refreshP50 = numeric( session.refresh.p50, 'refresh.p50', 'Measured' );
	const refreshP95 = numeric( session.refresh.p95, 'refresh.p95', 'Measured' );
	if ( Math.abs( session.hostReserve.p95.value - Math.max( 0, refreshP95 - refreshP50 ) ) > 1e-9 ) fail( 'Measured host reserve does not reconcile with the idle refresh distribution.' );
	const compositor = requireObject( session.compositorReserve, 'compositorReserve' );
	if ( compositor.verdict === 'PASS' ) {

		if ( compositor.measurement?.label !== 'Measured' ) fail( 'Compositor reserve PASS requires a Measured numeric datum.' );
		numeric( compositor.measurement, 'compositorReserve.measurement', 'Measured' );
		if ( typeof compositor.api !== 'string' || compositor.api.length === 0 ) fail( 'Measured compositor reserve requires the real timing API identity.' );

	} else if ( compositor.verdict !== 'NOT_CLAIMED' ) fail( 'Compositor reserve must remain NOT_CLAIMED unless a real measured API is recorded.' );
	const coldSummary = assertPerformanceWindow( session.cold, 0, refreshP50, {
		label: 'cold',
		minimumDuration: HARDWARE_PERFORMANCE_CONTRACT.coldMinimumDuration.value,
		minimumSamples: HARDWARE_PERFORMANCE_CONTRACT.coldMinimumSamples.value,
		enforceSustainedGates: false
	} );
	const windows = requireArray( session.sustainedWindows, 'sustainedWindows' );
	if ( windows.length < HARDWARE_PERFORMANCE_CONTRACT.minimumSustainedWindows.value ) fail( 'Hardware performance evidence requires at least two sustained windows.' );
	const windowSummaries = windows.map( ( window, index ) => assertPerformanceWindow( window, index, refreshP50 ) );
	const governor = requireObject( session.governor, 'governor' );
	const governorSummary = assertGovernorTrace( governor, tierResourceBytes );
	const presentationSamples = windowSummaries.flatMap( ( window ) => window.presentationSamples );
	const cpuSamples = windowSummaries.flatMap( ( window ) => window.cpuSamples );
	const gpuSamples = windowSummaries.flatMap( ( window ) => window.gpuSamples );
	return {
		valid: true,
		profile: session.profile,
		sustainedWindowCount: windows.length,
		frameTargetMs: HARDWARE_PERFORMANCE_CONTRACT.frameTarget.value,
		coldCpuP50Ms: coldSummary.cpuP50,
		coldCpuP95Ms: coldSummary.cpuP95,
		coldGpuP50Ms: coldSummary.gpuP50,
		coldGpuP95Ms: coldSummary.gpuP95,
		coldPresentationP95Ms: coldSummary.presentationP95,
		presentationP50Ms: percentile( presentationSamples, 0.5 ),
		presentationP95Ms: percentile( presentationSamples, 0.95 ),
		deadlineMissRatio: presentationSamples.filter( ( sample ) => sample > HARDWARE_PERFORMANCE_CONTRACT.deadlineThreshold.value ).length / presentationSamples.length,
		cpuP50Ms: percentile( cpuSamples, 0.5 ),
		cpuP95Ms: percentile( cpuSamples, 0.95 ),
		gpuP50Ms: percentile( gpuSamples, 0.5 ),
		gpuP95Ms: percentile( gpuSamples, 0.95 ),
		governorTransitionCount: governorSummary.transitionCount,
		governorSettledResidenceWindows: governorSummary.settledResidence
	};

}

export function hashPhysicalRecord( record ) {

	return `sha256:${ createHash( 'sha256' ).update( stableStringify( record ) ).digest( 'hex' ) }`;

}
