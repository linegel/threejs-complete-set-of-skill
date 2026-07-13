import {
	HARDWARE_PERFORMANCE_PROFILE,
	PHYSICAL_EVIDENCE_SCHEMA_VERSION,
	PHYSICAL_ROUTE_PROFILE,
	idleRefreshMeasurementComplete,
	numericDatum,
	requireCaptureTargetResourceFormat,
	sha256Hex
} from './physical-evidence-common.js';
import {
	HARDWARE_PERFORMANCE_CONTRACT,
	HARDWARE_PERFORMANCE_ROUTE_PLAN,
	PHYSICAL_ROUTE_PLAN
} from './in-app-evidence-plan.js';
import { canonicalUrlForRoute } from './route-locks.js';

const status = document.querySelector( '#status' );
const result = document.querySelector( '#result' );
const routeHost = document.querySelector( '#route-host' );
const routeButton = document.querySelector( '#run-routes' );
const performanceButton = document.querySelector( '#run-performance' );
const downloadButton = document.querySelector( '#download' );
const sessionToken = Array.from( crypto.getRandomValues( new Uint8Array( 24 ) ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

let immutableBuild = null;
let currentRecord = null;

function percentile( samples, q ) {

	if ( samples.length === 0 ) return null;
	const ordered = [ ...samples ].sort( ( a, b ) => a - b );
	const position = ( ordered.length - 1 ) * q;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? ordered[ lower ] : ordered[ lower ] + ( ordered[ upper ] - ordered[ lower ] ) * ( position - lower );

}

function twoAnimationFrames( frameWindow = window ) {

	return new Promise( ( resolve ) => frameWindow.requestAnimationFrame( () => frameWindow.requestAnimationFrame( resolve ) ) );

}

async function measureIdleRefresh() {

	const minimumDuration = HARDWARE_PERFORMANCE_CONTRACT.idleRefreshMinimumDuration.value;
	const timestamps = [];
	while ( idleRefreshMeasurementComplete( timestamps, minimumDuration ) === false ) timestamps.push( await new Promise( requestAnimationFrame ) );
	const intervals = timestamps.slice( 1 ).map( ( value, index ) => value - timestamps[ index ] );
	const duration = timestamps.at( -1 ) - timestamps[ 0 ];
	const p50 = percentile( intervals, 0.5 );
	const p95 = percentile( intervals, 0.95 );
	return {
		hz: numericDatum( 1000 / p50, 'Hz', 'Measured', 'foreground idle requestAnimationFrame median interval' ),
		measurementDuration: numericDatum( duration, 'ms', 'Measured', 'foreground idle requestAnimationFrame timestamps' ),
		intervals: { values: intervals, unit: 'ms', label: 'Measured', source: 'foreground idle requestAnimationFrame timestamps' },
		p50: numericDatum( p50, 'ms', 'Measured', 'foreground idle requestAnimationFrame interval distribution' ),
		p95: numericDatum( p95, 'ms', 'Measured', 'foreground idle requestAnimationFrame interval distribution' ),
		hostReserveP95: numericDatum( Math.max( 0, p95 - p50 ), 'ms', 'Measured', 'idle host-shell p95 interval minus median refresh period' )
	};

}

function observerEvents( frameWindow ) {

	return frameWindow.__THREEJS_PHYSICAL_OBSERVER__?.snapshot?.().events ?? [];

}

async function waitForController( frame ) {

	const started = performance.now();
	while ( performance.now() - started <= 30000 ) {

		const frameWindow = frame.contentWindow;
		if ( frameWindow?.__THREEJS_LAB_ERROR__ ) throw frameWindow.__THREEJS_LAB_ERROR__;
		if ( frameWindow?.__THREEJS_LAB__ && frameWindow.document.documentElement.dataset.ready === 'true' ) return frameWindow.__THREEJS_LAB__;
		await new Promise( requestAnimationFrame );

	}
	throw new Error( 'Timed out waiting for the locked native WebGPU controller.' );

}

function routeUrl( plan ) {

	const url = canonicalUrlForRoute( new URL( '/index.html', location.origin ), plan.kind, plan.id );
	url.searchParams.set( 'automationSurface', 'codex-in-app-browser' );
	url.searchParams.set( 'profile', plan.runtimeProfile );
	url.searchParams.set( 'physicalSession', sessionToken );
	return url;

}

async function openRoute( plan ) {

	status.textContent = `Opening ${ plan.key }…`;
	routeHost.dataset.active = 'true';
	const frame = document.createElement( 'iframe' );
	frame.title = `Physical evidence ${ plan.key }`;
	frame.src = routeUrl( plan ).href;
	routeHost.replaceChildren( frame );
	await new Promise( ( resolve, reject ) => {

		frame.addEventListener( 'load', resolve, { once: true } );
		frame.addEventListener( 'error', () => reject( new Error( `Failed to load ${ plan.key }.` ) ), { once: true } );

	} );
	const controller = await waitForController( frame );
	return { frame, controller, expectedUrl: routeUrl( plan ).href, plan };

}

async function summarizeReadback( capture, resources ) {

	return {
		target: capture.target,
		width: capture.width,
		height: capture.height,
		bytesPerPixel: capture.bytesPerPixel,
		rowBytes: capture.rowBytes,
		sourceBytesPerRow: capture.sourceBytesPerRow,
		format: capture.format,
		resourceFormat: requireCaptureTargetResourceFormat( resources ),
		colorManaged: capture.colorManaged,
		outputColorSpace: capture.outputColorSpace,
		encoding: capture.encoding,
		origin: capture.origin,
		sourceByteLength: capture.sourceByteLength,
		pixelByteLength: capture.pixels.byteLength,
		transportByteLength: capture.transport.data.byteLength,
		normalizedByteLength: capture.normalized.data.byteLength,
		pixelSha256: await sha256Hex( capture.pixels ),
		transportSha256: await sha256Hex( capture.transport.data ),
		normalizedSha256: await sha256Hex( capture.normalized.data ),
		transportLayout: capture.transport.layout,
		normalizedLayout: capture.normalized.layout
	};

}

async function closeRoute( context, extra = null ) {

	const { frame, controller, expectedUrl, plan } = context;
	const frameWindow = frame.contentWindow;
	await controller.renderOnce();
	const metrics = controller.getMetrics();
	const pipeline = controller.describePipeline();
	const resources = controller.describeResources();
	const capture = await controller.capturePixels( plan.startup.mode );
	const eventsBeforeDispose = observerEvents( frameWindow );
	const readback = await summarizeReadback( capture, resources );
	let disposeEvidence = null;
	let disposeError = null;
	try {

		disposeEvidence = await controller.dispose();

	} catch ( error ) {

		disposeError = error.message;

	}
	await twoAnimationFrames( frameWindow );
	const eventsAfterDispose = observerEvents( frameWindow );
	let postDisposeMetrics = null;
	let postDisposeError = null;
	try {

		postDisposeMetrics = controller.getMetrics();

	} catch ( error ) {

		postDisposeError = error.message;

	}
	const delayedEvents = eventsAfterDispose.slice( eventsBeforeDispose.length );
	const record = {
		key: plan.key,
		kind: plan.kind,
		id: plan.id,
		startup: plan.startup,
		runtimeProfile: plan.runtimeProfile,
		controllerReady: true,
		finalUrl: frameWindow.location.href,
		finalUrlMatches: frameWindow.location.href === expectedUrl,
		sourceClosureHash: immutableBuild.sourceClosureHash,
		buildRevision: immutableBuild.buildRevision,
		threeRevision: immutableBuild.threeRevision,
		pipelineGraphDigest: await sha256Hex( pipeline ),
		resourceDigest: await sha256Hex( resources ),
		pipelineGraph: pipeline,
		resources,
		backend: {
			isWebGPUBackend: metrics.nativeWebGPU,
			initialized: metrics.initialized,
			deviceIdentityVerified: metrics.rendererBackendEvidence?.deviceIdentityVerified === true,
			rendererDeviceGeneration: metrics.rendererDeviceGeneration,
			controllerGeneration: metrics.controllerGeneration,
			deviceLossGeneration: metrics.deviceLossGeneration,
			deviceLostObserved: metrics.deviceLostObserved,
			uncapturedErrors: metrics.uncapturedErrors ?? []
		},
		adapter: metrics.adapterIdentity,
		state: {
			scenario: metrics.scenario,
			mode: metrics.mode,
			tier: metrics.tier,
			camera: metrics.camera,
			seed: metrics.seed,
			timeSeconds: metrics.timeSeconds,
			viewport: metrics.viewport
		},
		readback,
		lifecycle: {
			disposeCompleted: disposeError === null,
			disposeEvidence,
			twoAnimationFramesSettled: true,
			postDisposeRendererDeviceStatus: postDisposeMetrics?.rendererDeviceStatus ?? 'unavailable',
			intentionalDeviceDestroyObserved: postDisposeMetrics?.intentionalDeviceDestroyObserved ?? null,
			delayedErrors: [
				...delayedEvents.map( ( event ) => event.message ),
				...( disposeError === null ? [] : [ disposeError ] ),
				...( postDisposeError === null ? [] : [ postDisposeError ] )
			]
		},
		errors: eventsBeforeDispose.map( ( event ) => event.message ),
		...( extra === null ? {} : { extra } )
	};
	frame.remove();
	routeHost.dataset.active = 'false';
	return { record, metrics };

}

async function collectRoute( plan, operation = null ) {

	const context = await openRoute( plan );
	const extra = operation === null ? null : await operation( context.controller );
	return closeRoute( context, extra );

}

async function collectPerformanceSegment( controller, minimumDurationMs, label, refreshPeriodMs ) {

	if ( Number.isFinite( refreshPeriodMs ) === false || refreshPeriodMs <= 0 ) throw new Error( `${ label } requires a positive measured refresh period.` );
	const started = performance.now();
	const timestampBatches = [];
	const presentationTimestamps = [];
	let samplePresentation = true;
	let finishPresentation;
	const presentationComplete = new Promise( ( resolve ) => { finishPresentation = resolve; } );
	function presentationFrame( timestamp ) {

		presentationTimestamps.push( timestamp );
		if ( samplePresentation ) requestAnimationFrame( presentationFrame );
		else finishPresentation();

	}
	requestAnimationFrame( presentationFrame );
	try {

		while ( performance.now() - started < minimumDurationMs ) {

			const batch = await controller.runPerformanceProfile( { warmupFrames: 30, sampleFrames: 240, presentationFrames: 240 } );
			timestampBatches.push( {
				verdict: batch.gpuSamples.length === batch.sampleFrames ? 'PASS' : 'FAIL',
				mappingCadence: batch.timestampMappingCadence,
				warmupFrames: numericDatum( batch.warmupFrames, 'frame', 'Measured', `${ label } warm-up CPU population` ),
				warmupCpuSamples: { values: batch.warmupCpuSamples, unit: 'ms', label: 'Measured', source: `${ label } performance.now render-call intervals before the sustained population` },
				sampleFrames: numericDatum( batch.sampleFrames, 'frame', 'Measured', `${ label } native timestamp batch population` ),
				cpuSamples: { values: batch.cpuSamples, unit: 'ms', label: 'Measured', source: `${ label } performance.now render-call intervals` },
				resolveCount: numericDatum( batch.timestampResolveCount, 'resolve', 'Measured', `${ label } native timestamp batch mapping` ),
				gpuSamples: { values: batch.gpuSamples, unit: 'ms', label: 'Measured', source: `${ label } resolved WebGPU render timestamp scopes` },
				timestampRows: batch.timestampRows,
				stageContextIds: batch.stageContextIds,
				lastFrameResolveResidualMs: batch.lastFrameResolveResidualMs,
				independentPerFrameTotalsAvailable: batch.independentPerFrameTotalsAvailable,
				reconciliationKind: batch.timestampReconciliationKind,
				reconciliationScope: batch.timestampReconciliationScope
			} );

		}

	} finally {

		samplePresentation = false;
		await presentationComplete;

	}
	const presentationSamples = presentationTimestamps.slice( 1 ).map( ( timestamp, index ) => timestamp - presentationTimestamps[ index ] );
	const duration = presentationTimestamps.at( -1 ) - presentationTimestamps[ 0 ];
	return {
		duration: numericDatum( duration, 'ms', 'Measured', `${ label } monotonic physical-browser clock` ),
		sampleCount: numericDatum( presentationSamples.length, 'sample', 'Measured', `${ label } foreground presentation interval population` ),
		presentationSamples: { values: presentationSamples, unit: 'ms', label: 'Measured', source: `${ label } foreground requestAnimationFrame intervals` },
		maximumPresentationGap: numericDatum( Math.max( ...presentationSamples ), 'ms', 'Measured', `${ label } foreground requestAnimationFrame intervals` ),
		presentationCoverage: numericDatum( duration === 0 ? 0 : presentationSamples.length / ( duration / refreshPeriodMs ), 'ratio', 'Derived', `${ label } continuous interval count divided by elapsed measured idle-refresh intervals` ),
		gpuTimestampBatches: timestampBatches
	};

}

async function collectBaseSession( profile, plan, refresh ) {

	return {
		schemaVersion: PHYSICAL_EVIDENCE_SCHEMA_VERSION,
		profile,
		automationSurface: 'codex-in-app-browser',
		startedAt: new Date().toISOString(),
		servedLedgerStartedAt: new Date( performance.timeOrigin ).toISOString(),
		browser: {
			webdriver: navigator.webdriver === true,
			headless: false,
			visibilityState: document.visibilityState,
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			userAgentDataPlatform: navigator.userAgentData?.platform ?? null,
			language: navigator.language
		},
		immutableBuild,
		refresh,
		routeOrder: plan.map( ( route ) => route.key ),
		routes: [],
		adapter: null,
		serving: {
			status: 'PENDING_OFFLINE_SERVED_BYTE_IMPORT',
			ledgerSha256: null,
			buildManifestFileSha256: null,
			entries: []
		},
		publishable: false,
		acceptanceStatus: 'incomplete',
		limitations: [
			'Raw in-app sessions are nonpublishable inputs to a separate offline release-bundle join.',
			'No evidence is promoted without a finalized Playwright correctness session and a distinct finalized Codex Browser physical-route session.'
		]
	};

}

async function runPhysicalRoutes() {

	const refresh = await measureIdleRefresh();
	const session = await collectBaseSession( PHYSICAL_ROUTE_PROFILE, PHYSICAL_ROUTE_PLAN, refresh );
	for ( const plan of PHYSICAL_ROUTE_PLAN ) {

		const { record, metrics } = await collectRoute( plan );
		session.routes.push( record );
		session.adapter ??= { adapterClass: metrics.adapterClass, identity: metrics.adapterIdentity?.info ?? {} };

	}
	session.finishedAt = new Date().toISOString();
	return session;

}

async function runHardwarePerformance() {

	const refresh = await measureIdleRefresh();
	const session = await collectBaseSession( HARDWARE_PERFORMANCE_PROFILE, HARDWARE_PERFORMANCE_ROUTE_PLAN, refresh );
	const target = await collectRoute( HARDWARE_PERFORMANCE_ROUTE_PLAN[ 0 ], async ( controller ) => ( {
		cold: await collectPerformanceSegment( controller, HARDWARE_PERFORMANCE_CONTRACT.coldMinimumDuration.value, 'cold segment', refresh.p50.value ),
		sustainedWindows: [
			await collectPerformanceSegment( controller, HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumDuration.value, 'sustained window 0', refresh.p50.value ),
			await collectPerformanceSegment( controller, HARDWARE_PERFORMANCE_CONTRACT.sustainedWindowMinimumDuration.value, 'sustained window 1', refresh.p50.value )
		]
	} ) );
	session.routes.push( target.record );
	session.adapter = { adapterClass: target.metrics.adapterClass, identity: target.metrics.adapterIdentity?.info ?? {} };
	const governor = await collectRoute( HARDWARE_PERFORMANCE_ROUTE_PLAN[ 1 ], async ( controller ) => {

		const trace = await controller.runGovernorStressProfile( {
			windowCount: HARDWARE_PERFORMANCE_CONTRACT.governorWindowCount.value,
			framesPerWindow: HARDWARE_PERFORMANCE_CONTRACT.governorFramesPerWindow.value
		} );
		await controller.setTier( 'governor-stress' );
		let settledResidence = 0;
		for ( let index = trace.windows.length - 1; index >= 0 && trace.windows[ index ].measuredTier === trace.settledState; index -- ) settledResidence ++;
		return {
			verdict: trace.oscillationDetected === false && settledResidence >= HARDWARE_PERFORMANCE_CONTRACT.governorMinimumResidence.value && trace.transitions.length >= HARDWARE_PERFORMANCE_CONTRACT.minimumGovernorTransitions.value ? 'PASS' : 'FAIL',
			settled: settledResidence >= HARDWARE_PERFORMANCE_CONTRACT.governorMinimumResidence.value,
			settledState: trace.settledState,
			settledResidenceWindows: numericDatum( settledResidence, 'window', 'Measured', 'final consecutive governor trace windows' ),
			oscillationDetected: trace.oscillationDetected,
			trace
		};

	} );
	session.routes.push( governor.record );
	session.viewport = { width: 1920, height: 1080, dpr: 1 };
	session.hostReserve = { p95: refresh.hostReserveP95, method: 'idle host-shell p95 interval minus median refresh period' };
	session.compositorReserve = { verdict: 'NOT_CLAIMED', reason: 'The browser surface exposes no compositor timing API; no value is inferred.' };
	session.cold = target.record.extra.cold;
	session.sustainedWindows = target.record.extra.sustainedWindows;
	session.governor = governor.record.extra;
	session.finishedAt = new Date().toISOString();
	return session;

}

function downloadCurrentRecord() {

	if ( currentRecord === null ) return;
	const blob = new Blob( [ `${ JSON.stringify( currentRecord, null, 2 ) }\n` ], { type: 'application/json' } );
	const anchor = document.createElement( 'a' );
	anchor.href = URL.createObjectURL( blob );
	anchor.download = `${ currentRecord.profile }.pending-served-byte-import.json`;
	anchor.click();
	setTimeout( () => URL.revokeObjectURL( anchor.href ), 0 );

}

async function run( operation ) {

	routeButton.disabled = true;
	performanceButton.disabled = true;
	downloadButton.disabled = true;
	try {

		currentRecord = await operation();
		window.__THREEJS_PHYSICAL_EVIDENCE__ = currentRecord;
		result.textContent = JSON.stringify( currentRecord, null, 2 );
		status.textContent = 'Session complete but incomplete until offline served-byte import and validation.';
		downloadButton.disabled = false;

	} catch ( error ) {

		status.textContent = `Session failed: ${ error.message }`;
		throw error;

	} finally {

		routeButton.disabled = false;
		performanceButton.disabled = false;

	}

}

async function initialize() {

	if ( navigator.webdriver === true ) throw new Error( 'Codex in-app physical evidence rejects WebDriver/headless execution.' );
	const response = await fetch( '../immutable-build-manifest.json', { cache: 'no-store', redirect: 'error' } );
	if ( response.ok === false ) throw new Error( 'Immutable build manifest is unavailable; Vite development execution is rejected.' );
	immutableBuild = await response.json();
	if ( immutableBuild.kind !== 'immutable-physical-build' || immutableBuild.immutable !== true ) throw new Error( 'Invalid immutable physical build manifest.' );
	if ( response.headers.get( 'x-threejs-immutable-build' ) !== immutableBuild.bundleHash ) throw new Error( 'Immutable server response does not match the build bundle hash.' );
	window.__THREEJS_PHYSICAL_EVIDENCE_HOST__ = Object.freeze( {
		automationSurface: 'codex-in-app-browser',
		immutableBuild: true,
		sessionToken,
		bundleHash: immutableBuild.bundleHash
	} );
	status.textContent = `Immutable build ready · ${ immutableBuild.bundleHash }`;

}

routeButton.addEventListener( 'click', () => run( runPhysicalRoutes ) );
performanceButton.addEventListener( 'click', () => run( runHardwarePerformance ) );
downloadButton.addEventListener( 'click', downloadCurrentRecord );

initialize().catch( ( error ) => {

	status.textContent = error.message;
	routeButton.disabled = true;
	performanceButton.disabled = true;
	window.__THREEJS_PHYSICAL_EVIDENCE_ERROR__ = error;
	throw error;

} );
