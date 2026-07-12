import assert from 'node:assert/strict';
import { test } from 'node:test';

import { numericDatum } from './physical-evidence-common.js';
import { HARDWARE_PERFORMANCE_ROUTE_PLAN, PHYSICAL_ROUTE_PLAN } from './in-app-evidence-plan.js';
import {
	hashPhysicalRecord,
	validateCorrectnessCaptureSession,
	validateHardwarePerformanceSession,
	validatePhysicalRouteSession
} from './physical-session-validator.js';

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

	return {
		schemaVersion: 1,
		profile,
		automationSurface: 'codex-in-app-browser',
		browser: { webdriver: false, headless: false, visibilityState: 'visible' },
		adapter: { adapterClass: 'hardware', identity: { vendor: 'Apple', device: 'M-series' } },
		refresh: {
			hz: numericDatum( 60, 'Hz', 'Measured', 'idle-rAF' ),
			measurementDuration: numericDatum( 2100, 'ms', 'Measured', 'idle-rAF' )
		},
		immutableBuild: immutableBuild(),
		routeOrder: plan.map( ( route ) => route.key ),
		routes: plan.map( routeRecord ),
		serving: serving( plan )
	};

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
		sampleFrames: numericDatum( 120, 'frame', 'Measured', 'timestamp batch' ),
		resolveCount: numericDatum( 1, 'resolve', 'Measured', 'timestamp batch' ),
		gpuSamples: { values: timestampRows.map( ( row ) => row.totalMs ), unit: 'ms', label: 'Measured', source: 'WebGPU timestamp rows' },
		timestampRows,
		lastFrameResolveResidualMs: 0.01,
		independentPerFrameTotalsAvailable: false,
		reconciliationScope: 'Independent Three aggregate checked only for the final-frame resolve.'
	};

}

function sustainedWindow() {

	return {
		duration: numericDatum( 30000, 'ms', 'Measured', 'monotonic clock' ),
		sampleCount: numericDatum( 120, 'sample', 'Measured', 'rAF intervals' ),
		presentationSamples: { values: Array( 120 ).fill( 16.67 ), unit: 'ms', label: 'Measured', source: 'rAF intervals' },
		maximumPresentationGap: numericDatum( 16.67, 'ms', 'Measured', 'rAF intervals' ),
		presentationCoverage: numericDatum( 1, 'ratio', 'Measured', 'observed/expected intervals' ),
		gpuTimestampBatches: [ timestampBatch() ]
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
			settledResidenceWindows: numericDatum( 2, 'window', 'Measured', 'governor trace' )
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

	assert.deepEqual( validateHardwarePerformanceSession( performanceSession() ), { valid: true, profile: 'performance', sustainedWindowCount: 2 } );

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
		[ 'presentation gap', ( value ) => { value.sustainedWindows[ 0 ].maximumPresentationGap.value = 101; }, /presentation-gap/ ],
		[ 'coverage gap', ( value ) => { value.sustainedWindows[ 0 ].presentationCoverage.value = 0.9; }, /presentation-coverage/ ],
		[ 'per-frame resolves', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].resolveCount.value = 120; }, /per frame/ ],
		[ 'missing timestamp row', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].timestampRows.pop(); }, /explicit timestamp row/ ],
		[ 'fabricated per-frame total', ( value ) => { value.sustainedWindows[ 0 ].gpuTimestampBatches[ 0 ].timestampRows[ 0 ].independentPerFrameTotalAvailable = true; }, /fabricates/ ],
		[ 'unsettled governor', ( value ) => { value.governor.settled = false; }, /did not settle/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = structuredClone( performanceSession() );
		mutate( value );
		assert.throws( () => validateHardwarePerformanceSession( value ), pattern, name );

	}

} );
