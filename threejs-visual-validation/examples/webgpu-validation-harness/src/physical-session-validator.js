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

function assertCorrectnessArtifactWrites( session ) {

	const writes = requireArray( session.artifactWrites, 'artifactWrites' );
	if ( writes.length === 0 ) fail( 'Correctness capture artifact write ledger is empty.' );
	const paths = new Set();
	let captureSessionExcluded = false;
	for ( const [ index, write ] of writes.entries() ) {

		const label = `artifactWrites[${ index }]`;
		requireObject( write, label );
		if ( typeof write.path !== 'string' || write.path.length === 0 || paths.has( write.path ) ) fail( `${ label } has a missing or duplicated path.` );
		paths.add( write.path );
		if ( write.contentBinding === 'self-excluded-finalized-offline' ) {

			if ( write.path !== 'capture-session.json' || write.sha256 !== null || write.byteLength !== null ) fail( 'Only capture-session.json may use the finalized self-exclusion record.' );
			captureSessionExcluded = true;
			continue;

		}
		if ( write.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) fail( `${ label } has an unsupported content binding.` );
		requireHash( write.sha256, `${ label }.sha256` );
		requireFinite( write.byteLength, `${ label }.byteLength`, 1 );

	}
	if ( captureSessionExcluded === false ) fail( 'Correctness capture did not finalize capture-session.json outside its own hash ledger.' );
	return paths;

}

function assertCorrectnessReadbackCapture( capture, writePaths, label ) {

	requireObject( capture, label );
	for ( const [ kind, descriptor ] of [
		[ 'PNG', capture.png ],
		[ 'transport', capture.transport?.artifact ],
		[ 'normalized', capture.normalized?.artifact ]
	] ) {

		requireObject( descriptor, `${ label}.${ kind }` );
		if ( typeof descriptor.path !== 'string' || writePaths.has( descriptor.path ) === false ) fail( `${ label} ${ kind } artifact is absent from the immutable write ledger.` );
		requireHash( descriptor.sha256, `${ label}.${ kind }.sha256` );
		requireFinite( descriptor.byteLength, `${ label}.${ kind }.byteLength`, 1 );

	}
	if ( capture.bytesPerPixel !== 4 || capture.bytesPerRow !== capture.width * 4 ) fail( `${ label } is not compact RGBA8.` );
	if ( Number.isInteger( capture.normalized?.bytesPerRow ) === false || capture.normalized.bytesPerRow < capture.bytesPerRow || capture.normalized.bytesPerRow % 256 !== 0 ) fail( `${ label } normalized row stride is not 256-byte aligned.` );
	if ( capture.normalized?.byteLength !== capture.normalized.bytesPerRow * capture.height ) fail( `${ label } normalized byte length is inconsistent.` );
	if ( capture.origin !== 'top-left' || capture.normalized?.origin !== 'top-left' ) fail( `${ label } does not preserve top-left readback origin.` );

}

export function validateCorrectnessCaptureSession( session ) {

	requireObject( session, 'correctness capture session' );
	if ( session.schemaVersion !== 2 || session.profile !== CORRECTNESS_PROFILE ) fail( 'Expected a schema-v2 correctness capture session.' );
	if ( session.automationSurface !== PLAYWRIGHT_CORRECTNESS_SURFACE || session.browser?.automationSurface !== PLAYWRIGHT_CORRECTNESS_SURFACE ) fail( 'Correctness capture requires automationSurface=playwright-headless-chromium.' );
	if ( session.profileConfig?.width !== 1200 || session.profileConfig?.height !== 800 || session.profileConfig?.dpr !== 1 ) fail( 'Correctness capture must use 1200x800 at DPR 1.' );
	if ( ! [ 'hardware', 'software', 'unknown' ].includes( session.adapterClass ) ) fail( 'Correctness capture adapter class is invalid.' );
	requireObject( session.adapterIdentity, 'adapterIdentity' );
	if ( session.threeRevision !== '0.185.1' ) fail( 'Correctness capture must use Three.js 0.185.1.' );
	for ( const key of [ 'sourceHash', 'sourceClosureHash', 'buildRevision' ] ) requireHash( session[ key ], key );
	if ( session.sourceHash !== session.sourceClosureHash ) fail( 'Correctness capture source and source-closure hashes differ.' );
	requireObject( session.sourceClosure, 'sourceClosure' );
	if ( session.sourceClosure.sourceHash !== session.sourceClosureHash || session.sourceClosure.buildRevision !== session.buildRevision || session.sourceClosure.threeRevision !== session.threeRevision ) fail( 'Correctness capture source closure identity is inconsistent.' );
	assertCaptureSessionInterval( session );
	if ( session.route?.requestedUrl !== session.url || session.route?.finalUrl !== session.finalUrl || session.route?.browserEntry !== session.browserEntry || session.route?.manifestLabId !== session.labId ) fail( 'Correctness capture route identity is inconsistent.' );
	for ( const field of [ 'pageErrors', 'consoleErrors', 'requestErrors' ] ) if ( requireArray( session[ field ], field ).length > 0 ) fail( `Correctness capture contains ${ field }.` );
	const metrics = requireObject( session.runtime?.metrics, 'runtime.metrics' );
	if ( metrics.nativeWebGPU !== true || metrics.initialized !== true || String( metrics.backend ?? metrics.backendKind ?? '' ).toLowerCase() !== 'webgpu' ) fail( 'Correctness capture lacks initialized native WebGPU proof.' );
	const writePaths = assertCorrectnessArtifactWrites( session );
	const captures = requireArray( session.writtenCaptures, 'writtenCaptures' );
	if ( captures.length === 0 ) fail( 'Correctness capture contains no render-target readbacks.' );
	captures.forEach( ( capture, index ) => assertCorrectnessReadbackCapture( capture, writePaths, `writtenCaptures[${ index }]` ) );
	const outputs = requireArray( session.outputPlan, 'outputPlan' );
	if ( outputs.length !== STANDARD_OUTPUTS.length ) fail( `Correctness capture must disposition all ${ STANDARD_OUTPUTS.length } standard outputs.` );
	const names = new Set();
	for ( const filename of STANDARD_OUTPUTS ) {

		const output = outputs.find( ( candidate ) => candidate?.id === filename.slice( 0, -4 ) );
		if ( ! output || names.has( output.id ) ) fail( `Correctness capture omits or duplicates ${ filename }.` );
		names.add( output.id );
		if ( output.status === 'CAPTURED' ) {

			if ( output.filename !== filename || writePaths.has( filename ) === false ) fail( `${ filename } is not bound to this capture session.` );
			requireHash( output.artifact?.sha256, `${ filename } artifact hash` );
			requireFinite( output.artifact?.byteLength, `${ filename } artifact byteLength`, 1 );

		} else if ( output.status !== 'NOT_APPLICABLE' || typeof output.reason !== 'string' || output.reason.length === 0 || ! output.graphProof ) fail( `${ filename } has no captured output or structural N/A proof.` );

	}
	for ( const required of [ 'final.design.png', 'diagnostics.mosaic.png' ] ) if ( outputs.find( ( output ) => output.filename === required )?.status !== 'CAPTURED' ) fail( `${ required } is required correctness evidence.` );
	return { valid: true, profile: session.profile, outputCount: outputs.length, captureCount: captures.length, adapterClass: session.adapterClass };

}

export function validatePhysicalRouteSession( session ) {

	requireObject( session, 'physical route session' );
	if ( session.profile !== PHYSICAL_ROUTE_PROFILE ) fail( 'Expected a physical-route session.' );
	const build = assertCaptureEnvironment( session );
	assertRouteSequence( session, PHYSICAL_ROUTE_PLAN, build );
	assertServedBytes( session, build, PHYSICAL_ROUTE_PLAN );
	return { valid: true, profile: session.profile, routeCount: session.routes.length };

}

function assertPerformanceWindow( window, index ) {

	const label = `sustainedWindows[${ index }]`;
	requireObject( window, label );
	const duration = numeric( window.duration, `${ label }.duration`, 'Measured' );
	const sampleCount = numeric( window.sampleCount, `${ label }.sampleCount`, 'Measured' );
	const maxGap = numeric( window.maximumPresentationGap, `${ label }.maximumPresentationGap`, 'Measured' );
	const coverage = numeric( window.presentationCoverage, `${ label }.presentationCoverage`, 'Measured' );
	const presentationSamples = numericArray( window.presentationSamples, `${ label }.presentationSamples`, 'Measured' );
	if ( duration < HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumDuration.value ) fail( `${ label } is shorter than 30 seconds.` );
	if ( sampleCount < HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumSamples.value || presentationSamples.length < HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumSamples.value ) fail( `${ label } has fewer than 120 presentation samples.` );
	if ( maxGap > HARDWARE_PERFORMANCE_CONTRACT.maximumPresentationGap.value ) fail( `${ label } exceeds the presentation-gap gate.` );
	if ( coverage < HARDWARE_PERFORMANCE_CONTRACT.minimumPresentationCoverage.value || coverage > 1.05 ) fail( `${ label } fails the presentation-coverage gate.` );
	const batches = requireArray( window.gpuTimestampBatches, `${ label }.gpuTimestampBatches` );
	if ( batches.length === 0 ) fail( `${ label } has no GPU timestamp batches.` );
	for ( const [ batchIndex, batch ] of batches.entries() ) {

		const batchLabel = `${ label }.gpuTimestampBatches[${ batchIndex }]`;
		if ( batch.verdict !== 'PASS' || batch.mappingCadence !== 'once-per-batch' ) fail( `${ batchLabel } is not a passing batched timestamp population.` );
		const frames = numeric( batch.sampleFrames, `${ batchLabel }.sampleFrames`, 'Measured' );
		const resolves = numeric( batch.resolveCount, `${ batchLabel }.resolveCount`, 'Measured' );
		if ( frames < 1 || resolves < 1 || resolves >= frames ) fail( `${ batchLabel } mapped timestamps per frame or has invalid coverage.` );
		const gpuSamples = numericArray( batch.gpuSamples, `${ batchLabel }.gpuSamples`, 'Measured' );
		if ( gpuSamples.length !== frames ) fail( `${ batchLabel } timestamp sample count does not match its frame population.` );
		const timestampRows = requireArray( batch.timestampRows, `${ batchLabel }.timestampRows` );
		if ( timestampRows.length !== frames ) fail( `${ batchLabel } must bind every frame to an explicit timestamp row.` );
		for ( const [ rowIndex, row ] of timestampRows.entries() ) {

			const rowLabel = `${ batchLabel }.timestampRows[${ rowIndex }]`;
			requireObject( row, rowLabel );
			for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) requireFinite( row[ key ], `${ rowLabel }.${ key }`, 0 );
			if ( Math.abs( row.sceneMs + row.outputMs - row.totalMs ) > 1e-9 ) fail( `${ rowLabel } total is not derived from its explicit stages.` );
			if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) fail( `${ rowLabel } fabricates an independent per-frame aggregate.` );

		}
		if ( batch.independentPerFrameTotalsAvailable !== false ) fail( `${ batchLabel } falsely claims independent per-frame aggregate timestamps.` );
		requireFinite( batch.lastFrameResolveResidualMs, `${ batchLabel }.lastFrameResolveResidualMs`, 0 );
		if ( typeof batch.reconciliationScope !== 'string' || /final-frame/i.test( batch.reconciliationScope ) === false ) fail( `${ batchLabel } does not confine the independent resolve residual to the final frame.` );

	}

}

export function validateHardwarePerformanceSession( session ) {

	requireObject( session, 'hardware performance session' );
	if ( session.profile !== HARDWARE_PERFORMANCE_PROFILE ) fail( 'Expected a hardware-performance session.' );
	const build = assertCaptureEnvironment( session );
	assertRouteSequence( session, HARDWARE_PERFORMANCE_ROUTE_PLAN, build );
	assertServedBytes( session, build, HARDWARE_PERFORMANCE_ROUTE_PLAN );
	if ( session.viewport?.width !== 1920 || session.viewport?.height !== 1080 || session.viewport?.dpr !== 1 ) fail( 'Hardware performance capture must use 1920x1080 at DPR 1.' );
	if ( numeric( session.refresh?.measurementDuration, 'refresh.measurementDuration', 'Measured' ) < HARDWARE_PERFORMANCE_CONTRACT.idleRefreshMinimumDuration.value ) fail( 'Idle-rAF refresh measurement is shorter than two seconds.' );
	if ( numeric( session.hostReserve?.p95, 'hostReserve.p95', 'Measured' ) < 0 ) fail( 'Measured host reserve is invalid.' );
	const compositor = requireObject( session.compositorReserve, 'compositorReserve' );
	if ( compositor.verdict === 'PASS' ) {

		if ( compositor.measurement?.label !== 'Measured' ) fail( 'Compositor reserve PASS requires a Measured numeric datum.' );
		numeric( compositor.measurement, 'compositorReserve.measurement', 'Measured' );
		if ( typeof compositor.api !== 'string' || compositor.api.length === 0 ) fail( 'Measured compositor reserve requires the real timing API identity.' );

	} else if ( compositor.verdict !== 'NOT_CLAIMED' ) fail( 'Compositor reserve must remain NOT_CLAIMED unless a real measured API is recorded.' );
	if ( numeric( session.cold?.duration, 'cold.duration', 'Measured' ) < HARDWARE_PERFORMANCE_CONTRACT.coldMinimumDuration.value ) fail( 'Cold performance segment is shorter than two seconds.' );
	const windows = requireArray( session.sustainedWindows, 'sustainedWindows' );
	if ( windows.length < HARDWARE_PERFORMANCE_CONTRACT.minimumSustainedWindows.value ) fail( 'Hardware performance evidence requires at least two sustained windows.' );
	windows.forEach( assertPerformanceWindow );
	const governor = requireObject( session.governor, 'governor' );
	if ( governor.verdict !== 'PASS' || governor.oscillationDetected !== false || governor.settled !== true || typeof governor.settledState !== 'string' ) fail( 'Quality governor did not settle cleanly.' );
	if ( numeric( governor.settledResidenceWindows, 'governor.settledResidenceWindows', 'Measured' ) < 2 ) fail( 'Quality governor lacks a two-window settled residence.' );
	return { valid: true, profile: session.profile, sustainedWindowCount: windows.length };

}

export function hashPhysicalRecord( record ) {

	return `sha256:${ createHash( 'sha256' ).update( stableStringify( record ) ).digest( 'hex' ) }`;

}
