import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { numericDatum } from './physical-evidence-common.js';
import { HARDWARE_PERFORMANCE_CONTRACT, HARDWARE_PERFORMANCE_ROUTE_PLAN, PHYSICAL_ROUTE_PLAN } from './in-app-evidence-plan.js';
import { validatePhysicalEvidenceRecordFile } from './physical-validate-record.js';
import {
	hashPhysicalRecord,
	validateCorrectnessCaptureSession,
	validateHardwarePerformanceSession,
	validatePhysicalRouteSession
} from './physical-session-validator.js';
import { finalizeImportedPhysicalRecord, loadVerifiedImportedPhysicalRecord } from './verified-physical-record.js';

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
	const resources = { route: plan.key, targets: [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] };
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

function timestampBatch() {

	const timestampRows = Array.from( { length: 120 }, ( _, frameId ) => ( {
		frameId,
		sceneUid: `scene:${ frameId }`,
		outputUid: `output:${ frameId }`,
		sceneMs: 1,
		outputMs: 0.5,
		totalMs: 1.5,
		residualMs: null,
		totalProvenance: 'Derived',
		independentPerFrameTotalAvailable: false
	} ) );
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
		lastFrameResolveResidualMs: 0,
		independentPerFrameTotalsAvailable: false,
		reconciliationScope: 'Independent Three aggregate checked only for the final-frame resolve.'
	};

}

function sustainedWindow() {

	const presentationSamples = Array( 1800 ).fill( 16.67 );
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

	return {
		adapterClass: 'hardware',
		windowCount: 6,
		framesPerWindow: 30,
		targetMs: 1000 / 60 - 2,
		hysteresisMs: 2,
		minimumResidenceWindows: 2,
		cooldownWindows: 2,
		states: [ 'target-performance', 'governor-stress' ],
		windows: [
			governorWindow( 0, 'target-performance', 'target-performance', 16, 'hold', 1, 0 ),
			governorWindow( 1, 'target-performance', 'governor-stress', 16, 'degrade', 0, 2 ),
			governorWindow( 2, 'governor-stress', 'governor-stress', 13, 'hold', 1, 1 ),
			governorWindow( 3, 'governor-stress', 'governor-stress', 13, 'hold', 2, 0 ),
			governorWindow( 4, 'governor-stress', 'governor-stress', 13, 'hold', 3, 0 ),
			governorWindow( 5, 'governor-stress', 'governor-stress', 13, 'hold', 4, 0 )
		],
		transitions: [ {
			window: 1,
			from: 'target-performance',
			to: 'governor-stress',
			cause: 'gpu-p95-over-budget',
			gpuP95: 16,
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
			fromResourceBytes: 100,
			toResourceBytes: 60
		} ],
		settledState: 'governor-stress',
		oscillationDetected: false
	};

}

function performanceSession() {

	return {
		...baseSession( 'performance', HARDWARE_PERFORMANCE_ROUTE_PLAN ),
		viewport: { width: 1920, height: 1080, dpr: 1 },
		hostReserve: { p95: numericDatum( 0.5, 'ms', 'Measured', 'idle host shell' ) },
		compositorReserve: { verdict: 'NOT_CLAIMED', reason: 'no real API' },
		cold: { duration: numericDatum( 2000, 'ms', 'Measured', 'monotonic clock' ) },
		sustainedWindows: [ sustainedWindow(), sustainedWindow() ],
		governor: {
			verdict: 'PASS',
			oscillationDetected: false,
			settled: true,
			settledState: 'governor-stress',
			settledResidenceWindows: numericDatum( 4, 'window', 'Measured', 'governor trace' ),
			trace: governorTrace()
		}
	};

}

const STANDARD_OUTPUTS = [
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
];

function correctnessCaptureSession() {

	const normalizedBytesPerRow = 4864;
	const outputWrites = STANDARD_OUTPUTS.map( ( path, index ) => ( {
		sequence: index + 1,
		path,
		kind: 'hook-artifact',
		contentBinding: 'sha256-byte-length-immutable-buffer-v1',
		sha256: HASH_A,
		byteLength: 64
	} ) );
	return {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		sourceHash: HASH_A,
		sourceClosureHash: HASH_A,
		sourceClosure: { sourceHash: HASH_A, buildRevision: HASH_B, threeRevision: '0.185.1' },
		buildRevision: HASH_B,
		threeRevision: '0.185.1',
		profile: 'correctness',
		profileConfig: { width: 1200, height: 800, dpr: 1 },
		automationSurface: 'playwright-headless-chromium',
		adapterClass: 'hardware',
		adapterIdentity: { vendor: 'Apple', device: 'M-series' },
		browser: { automationSurface: 'playwright-headless-chromium', name: 'Chromium', platform: 'macOS' },
		browserEntry: 'threejs-visual-validation/examples/webgpu-validation-harness/index.html',
		url: 'http://127.0.0.1:4173/index.html?capture=1&profile=correctness',
		finalUrl: 'http://127.0.0.1:4173/index.html?capture=1&profile=correctness',
		route: {
			requestedUrl: 'http://127.0.0.1:4173/index.html?capture=1&profile=correctness',
			finalUrl: 'http://127.0.0.1:4173/index.html?capture=1&profile=correctness',
			browserEntry: 'threejs-visual-validation/examples/webgpu-validation-harness/index.html',
			manifestLabId: 'webgpu-validation-harness',
			lockedState: { scenario: 'browser-capture', mode: 'final', tier: 'webgpu-correctness', camera: 'design' },
			observedState: { scenario: 'browser-capture', mode: 'final', tier: 'webgpu-correctness', camera: 'design' },
			finalState: { scenario: 'browser-capture', mode: 'final', tier: 'webgpu-correctness', camera: 'design' }
		},
		startedAt: '2026-07-12T09:00:00.000Z',
		finishedAt: '2026-07-12T09:01:00.000Z',
		runtime: { metrics: { nativeWebGPU: true, initialized: true, backend: 'webgpu' } },
		outputPlan: STANDARD_OUTPUTS.map( ( filename ) => ( {
			id: filename.slice( 0, -4 ),
			status: 'CAPTURED',
			filename,
			artifact: { path: filename, sha256: HASH_A, byteLength: 64 }
		} ) ),
		writtenCaptures: [ {
			width: 1200,
			height: 800,
			bytesPerPixel: 4,
			bytesPerRow: 4800,
			origin: 'top-left',
			png: { path: 'final.design.png', sha256: HASH_A, byteLength: 64 },
			transport: { artifact: { path: 'transport-readbacks/final.design.rgba8.bin', sha256: HASH_B, byteLength: 3840000 } },
			normalized: {
				origin: 'top-left',
				bytesPerRow: normalizedBytesPerRow,
				byteLength: normalizedBytesPerRow * 800,
				artifact: { path: 'normalized-readbacks/final.design.rgba8.padded.bin', sha256: HASH_C, byteLength: normalizedBytesPerRow * 800 }
			}
		} ],
		artifactWrites: [
			...outputWrites,
			{ sequence: 11, path: 'transport-readbacks/final.design.rgba8.bin', kind: 'writeCapture-transport', contentBinding: 'sha256-byte-length-immutable-buffer-v1', sha256: HASH_B, byteLength: 3840000 },
			{ sequence: 12, path: 'normalized-readbacks/final.design.rgba8.padded.bin', kind: 'writeCapture-normalized', contentBinding: 'sha256-byte-length-immutable-buffer-v1', sha256: HASH_C, byteLength: normalizedBytesPerRow * 800 },
			{ sequence: 13, path: 'capture-session.json', kind: 'capture-session-record', contentBinding: 'self-excluded-finalized-offline', sha256: null, byteLength: null }
		],
		pageErrors: [],
		consoleErrors: [],
		requestErrors: []
	};

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
		captureCount: 1,
		adapterClass: 'hardware'
	} );
	const crossed = structuredClone( session );
	crossed.automationSurface = 'codex-in-app-browser';
	assert.throws( () => validateCorrectnessCaptureSession( crossed ), /playwright-headless-chromium/ );

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

test( 'hardware performance mutations reject short, discontinuous, or fabricated traces', () => {

	const mutations = [
		[ 'wrong viewport', ( value ) => { value.viewport.width = 1200; }, /1920x1080/ ],
		[ 'short refresh probe', ( value ) => { value.refresh.measurementDuration.value = 1000; }, /shorter than two seconds/ ],
		[ 'authored host reserve', ( value ) => { value.hostReserve.p95.label = 'Authored'; }, /Measured/ ],
		[ 'invented compositor reserve', ( value ) => { value.compositorReserve = { verdict: 'PASS', measurement: { label: 'Authored' } }; }, /Compositor reserve/ ],
		[ 'anonymous compositor API', ( value ) => { value.compositorReserve = { verdict: 'PASS', measurement: numericDatum( 0.5, 'ms', 'Measured', 'counter' ) }; }, /real timing API identity/ ],
		[ 'short cold trace', ( value ) => { value.cold.duration.value = 1999; }, /Cold performance/ ],
		[ 'one sustained window', ( value ) => { value.sustainedWindows.pop(); }, /at least two/ ],
		[ 'short sustained window', ( value ) => { value.sustainedWindows[ 0 ].duration.value = 29999; }, /shorter than 30 seconds/ ],
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
		[ 'missing governor transition', ( value ) => { value.governor.trace.transitions = []; }, /did not exercise/ ],
		[ 'forged governor p95', ( value ) => { value.governor.trace.windows[ 0 ].gpuP95 = 15; }, /does not reconcile/ ],
		[ 'forged governor timestamp row', ( value ) => { value.governor.trace.windows[ 0 ].timestampRows[ 0 ].sceneMs += 1; }, /not derived/ ],
		[ 'forged governor decision', ( value ) => { value.governor.trace.windows[ 1 ].decision = 'hold'; }, /decision does not follow/ ],
		[ 'forged governor cooldown', ( value ) => { value.governor.trace.windows[ 2 ].cooldown = 0; }, /committed state counters/ ],
		[ 'forged governor resource direction', ( value ) => { value.governor.trace.transitions[ 0 ].toResourceBytes = 120; }, /resource direction/ ],
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
