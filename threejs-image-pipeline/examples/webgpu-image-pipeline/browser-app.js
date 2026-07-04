import {
	REVISION,
	RenderTarget,
	SRGBColorSpace,
	UnsignedByteType,
	Vector3
} from 'three/webgpu';

import { createWebGpuImagePipeline } from './main.js';
import {
	ARTIFACT_RELATIVE_DIR,
	FIXED_SEED,
	QUALITY_TIER,
	REQUIRED_IMAGES,
	SCENE_ID,
	THREE_REVISION_LABEL
} from './artifact-config.js';

const canvas = document.getElementById( 'view' );
const status = document.getElementById( 'status' );

const cameraBookmarks = {
	near: { position: [ 0, 1.1, 3.5 ], target: [ 0, 0, 0 ], fov: 44 },
	design: { position: [ 0, 1.3, 5.5 ], target: [ 0, 0, 0 ], fov: 50 },
	far: { position: [ 0, 1.7, 8.2 ], target: [ 0, 0, 0 ], fov: 54 }
};

const captureState = {
	camera: 'design',
	mode: 'final',
	seed: FIXED_SEED,
	timeSeconds: 0,
	frame: 0,
	staticControl: false
};

function setStatus( message ) {

	status.textContent = message;

}

function modeToDebugMode( mode ) {

	if ( mode === 'no-post' ) return 'no-post baseline';
	if ( mode === 'diagnostics' ) return 'normal';
	if ( [
		'normal',
		'velocity',
		'linear depth',
		'albedo',
		'AO.r',
		'emissive',
		'bloom contribution',
		'pre-tone-map HDR',
		'post-tone-map output',
		'debug baseline AO final-color multiply'
	].includes( mode ) ) return mode;
	return 'final';

}

function setCameraBookmark( app, name ) {

	const bookmark = cameraBookmarks[ name ] ?? cameraBookmarks.design;
	const camera = app.camera;

	camera.fov = bookmark.fov;
	camera.position.fromArray( bookmark.position );
	camera.lookAt( new Vector3().fromArray( bookmark.target ) );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld( true );
	return bookmark;

}

function applyCameraMotion( app, bookmark, seconds ) {

	const camera = app.camera;
	const target = new Vector3().fromArray( bookmark.target );

	camera.position.x += Math.sin( seconds * 0.45 ) * 0.18;
	camera.position.y += Math.cos( seconds * 0.55 ) * 0.06;
	target.x += Math.sin( seconds * 0.7 ) * 0.08;
	camera.lookAt( target );
	camera.updateMatrixWorld( true );

}

function setTime( app, seconds, staticControl ) {

	app.setTime?.( seconds );

	if ( staticControl !== true ) {

		const bookmark = cameraBookmarks[ captureState.camera ] ?? cameraBookmarks.design;
		applyCameraMotion( app, bookmark, seconds );

	}

}

function makeCameraRecord( app, bookmarkName = captureState.camera ) {

	setCameraBookmark( app, bookmarkName );

	return {
		bookmark: bookmarkName,
		matrixWorld: Array.from( app.camera.matrixWorld.elements ),
		projectionMatrix: Array.from( app.camera.projectionMatrix.elements ),
		near: app.camera.near,
		far: app.camera.far,
		fov: app.camera.fov
	};

}

function rendererInfoRecord( app ) {

	const renderer = app.renderer;
	const backend = renderer.backend ?? {};

	return {
		threeRevision: REVISION,
		renderer: 'WebGPURenderer',
		isPrimaryBackend: backend.isWebGPUBackend === true,
		coordinateSystem: renderer.coordinateSystem ?? null,
		initialized: renderer.initialized === true,
		outputBufferType: typeof renderer.getOutputBufferType === 'function' ? renderer.getOutputBufferType() : null,
		compatibilityMode: backend.compatibilityMode ?? null,
		trackTimestamp: backend.trackTimestamp ?? null,
		features: backend.device?.features ? [ ...backend.device.features ] : null,
		limits: backend.device?.limits ? { ...backend.device.limits } : null,
		unavailableReason: backend.device ? null : 'renderer.backend.device unavailable',
		info: renderer.info
	};

}

function applyCaptureState( app, nextState = {} ) {

	Object.assign( captureState, nextState );
	captureState.staticControl = nextState.staticControl === true;
	setCameraBookmark( app, captureState.camera );
	setTime( app, captureState.timeSeconds, captureState.staticControl );
	app.setDebugMode( modeToDebugMode( captureState.mode ) );

}

async function renderOnce( app ) {

	await app.render();
	await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );

}

function rendererMemorySnapshot( app ) {

	const memory = app.renderer.info.memory ?? {};
	const snapshot = {};

	for ( const [ key, value ] of Object.entries( memory ) ) {

		if ( typeof value === 'number' && Number.isFinite( value ) ) snapshot[ key ] = value;

	}

	snapshot.geometries = snapshot.geometries ?? 0;
	snapshot.textures = snapshot.textures ?? 0;
	return snapshot;

}

function leakSnapshot( app ) {

	return {
		rendererInfoMemory: rendererMemorySnapshot( app ),
		targetBytes: app.estimateTargetBytes?.() ?? 0,
		storageBytes: 0
	};

}

function leakDeltas( before, after ) {

	return {
		geometries: after.rendererInfoMemory.geometries - before.rendererInfoMemory.geometries,
		textures: after.rendererInfoMemory.textures - before.rendererInfoMemory.textures,
		targetBytes: after.targetBytes - before.targetBytes,
		storageBytes: after.storageBytes - before.storageBytes
	};

}

function leakPass( deltas, thresholds ) {

	return [ 'geometries', 'textures', 'targetBytes', 'storageBytes' ].every( ( key ) => deltas[ key ] <= thresholds[ key ] );

}

function thresholdRecord( textures = 0 ) {

	return { geometries: 0, textures, targetBytes: 0, storageBytes: 0 };

}

async function runLifecycleLoop( app, name, operation, thresholds, iterations = 3 ) {

	const before = leakSnapshot( app );
	const operations = [];
	let operationPass = true;

	for ( let i = 0; i < iterations; i ++ ) {

		const operationRecord = await operation( i );
		await renderOnce( app );
		const restoredSnapshot = leakSnapshot( app );

		operations.push( {
			iteration: i + 1,
			...operationRecord,
			restoredSnapshot
		} );

		if ( operationRecord?.pass === false ) operationPass = false;

	}

	const after = leakSnapshot( app );
	const deltas = leakDeltas( before, after );

	return {
		name,
		iterations,
		before,
		after,
		deltas,
		thresholds,
		pass: operationPass && leakPass( deltas, thresholds ),
		operations
	};

}

async function buildLeakLoopEvidence( app ) {

	const viewport = app.getViewport?.() ?? { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
	const baseWidth = viewport.width;
	const baseHeight = viewport.height;
	const baseDpr = viewport.dpr;
	const baseSceneScale = app.scenePass.getResolutionScale?.() ?? 1;
	const resizeThresholds = thresholdRecord( 2 );
	const dprThresholds = thresholdRecord( 2 );
	const qualityThresholds = thresholdRecord( 2 );
	const debugThresholds = thresholdRecord( 2 );
	const historyThresholds = thresholdRecord( 2 );
	const assetThresholds = thresholdRecord( 2 );
	const sceneThresholds = thresholdRecord( 0 );
	const disposeThresholds = thresholdRecord( 0 );
	const knownInternalCacheDeltas = [
		{ loop: 'resize', key: 'textures', allowance: resizeThresholds.textures, reason: 'Renderer/pass resize can keep a bounded replacement attachment cache until renderer disposal.' },
		{ loop: 'dpr-change', key: 'textures', allowance: dprThresholds.textures, reason: 'Drawing-buffer DPR changes can keep a bounded replacement attachment cache until renderer disposal.' },
		{ loop: 'quality-tier-switch', key: 'textures', allowance: qualityThresholds.textures, reason: 'Resolution-scale changes can keep a bounded replacement attachment cache until renderer disposal.' },
		{ loop: 'debug-mode-switch', key: 'textures', allowance: debugThresholds.textures, reason: 'First diagnostic graph activation may retain a bounded material/pass texture binding cache.' },
		{ loop: 'history-reset', key: 'textures', allowance: historyThresholds.textures, reason: 'The documented resize reset path can keep a bounded replacement attachment cache until renderer disposal.' },
		{ loop: 'asset-reload', key: 'textures', allowance: assetThresholds.textures, reason: 'Checker DataTexture replacement may retain one old/new texture pair until renderer disposal.' }
	];

	const loops = [];

	loops.push( await runLifecycleLoop( app, 'resize', async ( iteration ) => {

		const changedWidth = Math.max( 320, baseWidth + ( iteration % 2 === 0 ? 96 : - 72 ) );
		const changedHeight = Math.max( 240, baseHeight + ( iteration % 2 === 0 ? 48 : - 54 ) );

		app.resize( changedWidth, changedHeight, baseDpr );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.resize( baseWidth, baseHeight, baseDpr );

		return {
			operation: 'renderer/canvas size changed and restored',
			changed: { width: changedWidth, height: changedHeight, dpr: baseDpr },
			changedSnapshot,
			pass: true
		};

	}, resizeThresholds ) );

	loops.push( await runLifecycleLoop( app, 'dpr-change', async ( iteration ) => {

		const changedDpr = Math.max( 0.5, baseDpr * ( iteration % 2 === 0 ? 1.25 : 0.75 ) );

		app.resize( baseWidth, baseHeight, changedDpr );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.resize( baseWidth, baseHeight, baseDpr );

		return {
			operation: 'renderer pixel ratio changed with app.resize() and restored',
			changed: { width: baseWidth, height: baseHeight, dpr: changedDpr },
			changedSnapshot,
			pass: true
		};

	}, dprThresholds ) );

	loops.push( await runLifecycleLoop( app, 'quality-tier-switch', async ( iteration ) => {

		const changedScale = iteration % 2 === 0 ? 0.75 : 0.5;

		app.setSceneResolutionScale( changedScale );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.setSceneResolutionScale( baseSceneScale );

		return {
			operation: 'scenePass.setResolutionScale() changed and restored',
			changed: { sceneResolutionScale: changedScale },
			changedSnapshot,
			pass: true
		};

	}, qualityThresholds ) );

	// Warm every diagnostic graph once BEFORE the baseline snapshot: first
	// activation lazily allocates that mode's pass targets, which is
	// initialization, not leakage. A leak is growth AFTER warm-up.
	const debugModes = [ 'normal', 'velocity', 'linear depth', 'AO.r', 'bloom contribution' ];

	for ( const mode of debugModes ) {

		app.setDebugMode( mode );
		await renderOnce( app );

	}

	app.setDebugMode( 'final' );
	await renderOnce( app );

	loops.push( await runLifecycleLoop( app, 'debug-mode-switch', async () => {

		let changedSnapshot = null;

		for ( const mode of debugModes ) {

			app.setDebugMode( mode );
			await renderOnce( app );
			changedSnapshot = leakSnapshot( app );

		}

		app.setDebugMode( 'final' );

		return {
			operation: 'RenderPipeline outputNode debug modes fully cycled after warm-up and restored',
			changed: { debugModes: [ ...debugModes ] },
			changedSnapshot,
			pass: true
		};

	}, debugThresholds ) );

	loops.push( await runLifecycleLoop( app, 'history-reset', async ( iteration ) => {

		const resetWidth = Math.max( 320, baseWidth + 1 + iteration );

		app.resize( resetWidth, baseHeight, baseDpr );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.resize( baseWidth, baseHeight, baseDpr );

		return {
			operation: 'temporal path is disabled; documented resize reset event is retriggered',
			resetEvents: [ 'resize' ],
			changed: { width: resetWidth, height: baseHeight, dpr: baseDpr },
			changedSnapshot,
			pass: true
		};

	}, historyThresholds ) );

	loops.push( await runLifecycleLoop( app, 'asset-reload', async () => {

		const texture = app.reloadCheckerTexture();
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );

		return {
			operation: 'checker DataTexture disposed, recreated, reassigned, and rendered',
			changed: { checkerTexture: texture },
			changedSnapshot,
			pass: true
		};

	}, assetThresholds ) );

	loops.push( await runLifecycleLoop( app, 'scene-teardown', async () => {

		const hiddenCount = app.setMotionSubjectsVisible( false );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		const restoredCount = app.setMotionSubjectsVisible( true );

		return {
			operation: 'motion-subject meshes removed from scene and re-added',
			changed: { visibleMotionSubjects: hiddenCount },
			restored: { visibleMotionSubjects: restoredCount },
			changedSnapshot,
			pass: hiddenCount === 0 && restoredCount === 3
		};

	}, sceneThresholds ) );

	loops.push( await runLifecycleLoop( app, 'dispose-recreate', async () => {

		const secondaryCanvas = document.createElement( 'canvas' );
		const secondary = await createWebGpuImagePipeline( secondaryCanvas );

		secondary.resize( 320, 180, 1 );
		const createdSnapshot = leakSnapshot( secondary );
		await renderOnce( secondary );
		const renderedSnapshot = leakSnapshot( secondary );
		secondary.dispose();
		const disposedSnapshot = leakSnapshot( secondary );
		const secondaryDeltas = leakDeltas( createdSnapshot, disposedSnapshot );
		const secondaryPass = secondaryDeltas.geometries <= 0 && secondaryDeltas.textures <= 0;

		return {
			operation: 'secondary offscreen pipeline created, rendered once, disposed fully',
			secondary: {
				createdSnapshot,
				renderedSnapshot,
				disposedSnapshot,
				deltas: secondaryDeltas,
				pass: secondaryPass
			},
			pass: secondaryPass
		};

	}, disposeThresholds ) );

	app.resize( baseWidth, baseHeight, baseDpr );
	app.setSceneResolutionScale( baseSceneScale );
	app.setDebugMode( 'final' );
	applyCaptureState( app, { camera: 'design', mode: 'final', timeSeconds: 0, frame: 0 } );
	await renderOnce( app );

	return {
		required: true,
		loops,
		summary: {
			pass: loops.every( ( loop ) => loop.pass === true ) && ( window.__imagePipelineErrors ?? [] ).length === 0,
			uncapturedBackendErrors: window.__imagePipelineErrors ?? [],
			knownInternalCacheDeltas
		},
		allowedCacheNotes: knownInternalCacheDeltas.map( ( entry ) => `${ entry.loop }.${ entry.key }: ${ entry.reason }` )
	};

}

function buildEvidence( app, timing, leakLoop ) {

	const rendererInfo = rendererInfoRecord( app );
	const graph = app.diagnostics.configValidation;
	const viewport = {
		width: window.innerWidth,
		height: window.innerHeight,
		dpr: window.devicePixelRatio || 1
	};
	const captureTargetBytes = viewport.width * viewport.height * 4;
	const renderTargetBytes = graph.estimatedBytes + captureTargetBytes;

	return {
		visualContract: {
			subject: SCENE_ID,
			identity: [
				'one WebGPU RenderPipeline owns final image output',
				'one scene pass owns shared MRT output/normal/emissive/velocity signals',
				'diagnostic modes expose no-post, depth, normal, debug-only albedo, velocity, AO, bloom, and output ownership'
			],
			silhouette: [ 'grounded objects, a corner occluder, and contact surfaces remain visible in final, no-post, near, design, and far captures' ],
			materialSeparation: [ 'textured non-emissive albedo remains separate from emissive and bloom diagnostics' ],
			motion: [ 'temporal captures use deterministic object and camera motion; static velocity control renders the same state twice' ],
			cameraEnvelope: { near: 3.5, design: 5.5, far: 8.2 },
			lightingEnvelope: [ 'scene HDR is visible without bloom, AO, or final presentation treatment' ],
			invariants: [
				'shared MRT graph remains one scene render',
				'no-post evidence remains nonblank',
				'diagnostics expose albedo, velocity, AO contact, bloom selectivity, and linear-depth contracts'
			],
			invariantArtifacts: {
				'shared MRT graph remains one scene render': {
					requiredImages: [ 'images/final.design.png', 'images/diagnostics.mosaic.png' ],
					requiredDiagnostics: [ 'pipelineConfig.js', 'validateImagePipelineConfig.js' ],
					requiredMetrics: [ 'evidence-manifest.json.postStack', 'render-targets.json.totalBytes' ],
					blockingFailures: [ 'duplicate scene render', 'missing MRT producer', 'missing diagnostic mode' ]
				},
				'no-post evidence remains nonblank': {
					requiredImages: [ 'images/no-post.design.png' ],
					requiredDiagnostics: [ 'no-post baseline' ],
					requiredMetrics: [ 'timings.json.cpuFrameMs' ],
					blockingFailures: [ 'blank no-post capture', 'final-only evidence' ]
				},
				'diagnostics expose albedo, velocity, AO contact, bloom selectivity, and linear-depth contracts': {
					requiredImages: [ 'images/diagnostics.mosaic.png', 'images/temporal.t001.png', 'images/velocity.static.png', 'images/velocity.motion.png', 'images/AO.static.png', 'images/bloom.static.png', 'images/normal.static.png', 'images/albedo.static.png' ],
					requiredDiagnostics: [ 'velocity', 'linear depth', 'normal', 'debug-only albedo', 'AO.r', 'bloom contribution' ],
					requiredMetrics: [ 'renderer-info.json.info', 'evidence-manifest.json.postStack.mrtOutputs' ],
					blockingFailures: [ 'missing velocity MRT', 'raw depth used as linear depth', 'missing albedo diagnostic', 'missing diagnostic mosaic' ]
				}
			},
			requiredImages: [
				...REQUIRED_IMAGES,
				'images/velocity.static.png',
				'images/velocity.motion.png',
				'images/AO.static.png',
				'images/bloom.static.png',
				'images/normal.static.png',
				'images/albedo.static.png'
			],
			// The static-velocity control proves its claim BY being flat; it is
			// exempt from the blanket nonblank gate and asserted near-zero by
			// validate-image-pipeline-artifacts.mjs instead.
			flatControlImages: [ 'images/velocity.static.png' ],
			requiredDiagnostics: [ 'no-post baseline', 'normal diagnostic', 'debug-only albedo diagnostic', 'velocity MRT', 'linear depth', 'AO.r', 'bloom contribution' ],
			requiredMetrics: [ 'renderer-info.json', 'render-targets.json', 'storage-resources.json', 'timings.json', 'leak-loop.json' ],
			blockingFailures: [ 'non-primary WebGPU backend', 'blank PNG', 'final-only evidence', 'duplicate tone/output owner' ],
			allowedDivergences: [
				'This example validates the shared image-pipeline graph; domain-specific AO/bloom/exposure quality remains in atomic skills.',
				'GPU timestamp timing may be unavailable and is labelled as CPU-only proxy.'
			],
			frameBudgetMs: { desktopDiscrete: 12, desktopIntegrated: 24, mobile: 33 },
			memoryBudgetMB: 256
		},
		evidenceManifest: {
			skill: 'threejs-visual-validation',
			sceneId: SCENE_ID,
			threeRevision: THREE_REVISION_LABEL.replace( 'r', '' ),
			browser: navigator.userAgent,
			os: navigator.platform,
			gpuAdapter: null,
			renderer: 'WebGPURenderer',
			backend: {
				isPrimaryBackend: rendererInfo.isPrimaryBackend,
				coordinateSystem: rendererInfo.coordinateSystem,
				initialized: rendererInfo.initialized,
				deviceLostObserved: false,
				uncapturedErrors: window.__imagePipelineErrors ?? [],
				features: rendererInfo.features,
				limits: rendererInfo.limits,
				unavailableReason: rendererInfo.unavailableReason
			},
			qualityTier: QUALITY_TIER,
			viewport,
			camera: makeCameraRecord( app, 'design' ),
			seed: FIXED_SEED,
			time: { fixed: true, seconds: captureState.timeSeconds, frame: captureState.frame },
			assets: [],
			colorPipeline: {
				toneMapOwner: 'renderOutput',
				outputTransformOwner: 'renderOutput',
				outputColorTransform: false,
				lutDomain: app.diagnostics.configValidation ? 'display-referred sRGB' : 'not configured',
				hdrWorkingType: 'HalfFloatType',
				dataSignals: [ 'normal', 'velocity', 'depth', 'linearDepth' ],
				screenshotEncoding: 'WebGPU RenderTarget readback encoded as PNG'
			},
			postStack: {
				renderPipeline: 'RenderPipeline',
				scenePasses: graph.sceneRenderCount,
				mrtOutputs: graph.requiredMRT,
				debugOnlyAlbedo: 'diagnostic diffuse-color capture; not a production MRT attachment',
				diagnosticModes: graph.diagnosticModes,
				outputNodeOwner: 'RenderPipeline.outputNode'
			},
			thresholds: {
				nonblank: { minRange: 8 },
				cameraMatrixRequired: true,
				perViewPixelDiff: { final: 0.01, diagnostics: 0.02 },
				falsifiability: {
					aoContactVariance: 0.5,
					velocityStaticMean: 3,
					velocityMotionMean: 4,
					temporalMeanDiff: 2,
					bloomOutsideMean: 8,
					normalUniqueColors: 24,
					albedoUniqueColors: 12
				}
			},
			stochasticMasks: [
				{ name: 'none', path: null, reason: 'fixed camera, fixed seed, fixed capture time' }
			],
			knownCompromises: [
				'Browser evidence records CPU timing; GPU timestamp availability remains target-dependent.'
			]
		},
		rendererInfo,
		renderTargets: {
			required: true,
			totalBytes: renderTargetBytes,
			targets: [
				{
					name: 'scene-pass-mrt',
					role: 'output/normal/emissive/velocity shared gbuffer; albedo is a debug-only diffuse capture',
					owner: 'scene pass',
					width: viewport.width,
					height: viewport.height,
					dprScale: 'full',
					format: 'RGBA16F/RG16F/depth mix',
					type: 'HalfFloatType plus depth',
					colorSpace: 'scene-linear HDR plus data/no-color',
					samples: app.renderer.samples ?? 1,
					depthStencil: 'depth texture owned by PassNode',
					mrtCount: graph.requiredMRT.length,
					lifetime: 'browser validation page',
					memoryBytes: graph.estimatedBytes
				},
				{
					name: 'capture-target',
					role: 'PNG readback',
					owner: 'capture.mjs',
					width: viewport.width,
					height: viewport.height,
					dprScale: 'full',
					format: 'RGBA8 readback',
					type: 'UnsignedByteType',
					colorSpace: 'SRGBColorSpace',
					samples: 1,
					depthStencil: 'none',
					mrtCount: 1,
					lifetime: 'capture only',
					memoryBytes: captureTargetBytes
				}
			]
		},
		storageResources: {
			required: true,
			totalBytes: 0,
			resources: [
				{
					name: 'none',
					kind: 'not used by this image-pipeline Phase 1 example',
					dimensions: 0,
					format: null,
					bytes: 0,
					ownerDispatch: null,
					dispatchSize: null,
					workgroupAssumptions: null,
					synchronization: 'none',
					readbackPolicy: 'none',
					resetPolicy: 'not applicable'
				}
			]
		},
		timings: {
			required: true,
			warmupFrames: 4,
			sampleFrames: 16,
			cpuFrameMs: timing.cpuFrameMs,
			gpuFrameMs: null,
			renderTimestampMs: null,
			computeTimestampMs: null,
			gpuTimingUnavailable: true,
			gpuTimingLabel: 'CPU-only proxy',
			unavailableReason: 'renderer constructed without trackTimestamp; timestamp-query capture is a Wave C item',
			readbackCaptureMs: timing.readbackCaptureMs,
			qualityTierChanges: [],
			passCount: 1,
			dispatchCount: app.renderer.info.compute?.calls ?? 0,
			drawCalls: app.renderer.info.render.calls,
			triangles: app.renderer.info.render.triangles
		},
		leakLoop
	};

}

function metricFromSamples( samples ) {

	const sorted = [ ...samples ].sort( ( a, b ) => a - b );

	return {
		median: Number( sorted[ Math.floor( sorted.length / 2 ) ].toFixed( 3 ) ),
		p95: Number( sorted[ Math.min( sorted.length - 1, Math.floor( sorted.length * 0.95 ) ) ].toFixed( 3 ) ),
		unit: 'ms'
	};

}

function packedReadbackBytesPerRow( width, height, pixelLength ) {

	const rowBytes = width * 4;
	const compactLength = rowBytes * height;

	if ( pixelLength === compactLength ) return rowBytes;

	const alignedRowBytes = Math.ceil( rowBytes / 256 ) * 256;
	const paddedLength = alignedRowBytes * ( height - 1 ) + rowBytes;

	if ( pixelLength !== paddedLength ) {

		throw new Error( `Unexpected WebGPU readback length ${ pixelLength }; expected ${ compactLength } or ${ paddedLength }.` );

	}

	return alignedRowBytes;

}

async function measureFrames( app ) {

	const samples = [];

	for ( let i = 0; i < 16; i ++ ) {

		const start = performance.now();
		applyCaptureState( app, { timeSeconds: i / 30, frame: i } );
		await renderOnce( app );
		samples.push( performance.now() - start );

	}

	return {
		cpuFrameMs: metricFromSamples( samples ),
		readbackCaptureMs: { median: 0, p95: 0, unit: 'ms' }
	};

}

async function initialize() {

	window.__imagePipelineErrors = [];
	window.addEventListener( 'unhandledrejection', ( event ) => {

		window.__imagePipelineErrors.push( String( event.reason?.message ?? event.reason ) );

	} );

	if ( ! navigator.gpu ) {

		throw new Error( 'WebGPU is unavailable; image-pipeline validation requires a primary WebGPU backend.' );

	}

	const app = await createWebGpuImagePipeline( canvas );

	if ( app.renderer.backend?.isWebGPUBackend !== true ) {

		throw new Error( 'Image-pipeline validation requires renderer.backend.isWebGPUBackend === true.' );

	}

	app.resize( window.innerWidth, window.innerHeight, window.devicePixelRatio || 1 );
	const captureTarget = new RenderTarget( window.innerWidth, window.innerHeight, {
		samples: 1,
		type: UnsignedByteType
	} );
	captureTarget.texture.colorSpace = SRGBColorSpace;
	app.renderer.initRenderTarget?.( captureTarget );
	const timing = await measureFrames( app );

	async function capturePixels( nextState ) {

		const readbackStart = performance.now();
		applyCaptureState( app, nextState );

		if ( captureState.staticControl === true ) {

			await renderOnce( app );
			applyCaptureState( app, nextState );

		} else {

			// Velocity is a two-frame signal: VelocityNode differences current and
			// previous matrices, so the captured frame needs a deterministic
			// previous frame on the same motion curve. The static control instead
			// renders the SAME state twice, proving the zero-delta side.
			const warmupSeconds = Math.max( 0, ( nextState.timeSeconds ?? 0 ) - 0.25 );
			applyCaptureState( app, { ...nextState, timeSeconds: warmupSeconds } );
			await renderOnce( app );
			applyCaptureState( app, nextState );

		}

		const width = window.innerWidth;
		const height = window.innerHeight;
		captureTarget.setSize( width, height );
		app.renderer.setRenderTarget( captureTarget );
		await app.render();
		const pixels = await app.renderer.readRenderTargetPixelsAsync( captureTarget, 0, 0, width, height );
		app.renderer.setRenderTarget( null );
		await renderOnce( app );

		timing.readbackCaptureMs = metricFromSamples( [ performance.now() - readbackStart ] );

		return {
			width,
			height,
			bytesPerRow: packedReadbackBytesPerRow( width, height, pixels.length ),
			pixels: Array.from( pixels )
		};

	}

	applyCaptureState( app, { camera: 'design', mode: 'final', timeSeconds: 0, frame: 0 } );
	await renderOnce( app );
	setStatus( `${ SCENE_ID } ready\n${ ARTIFACT_RELATIVE_DIR }\n${ app.diagnostics.configValidation.requiredMRT.join( ', ' ) }` );
	let cachedLeakLoop = null;

	window.__imagePipelineValidation = {
		ready: true,
		async setCapture( nextState ) {

			applyCaptureState( app, nextState );
			await renderOnce( app );
			return { ...captureState };

		},
		capturePixels,
		async getEvidence() {

			cachedLeakLoop = cachedLeakLoop ?? await buildLeakLoopEvidence( app );
			return buildEvidence( app, timing, cachedLeakLoop );

		}
	};

}

initialize().catch( ( error ) => {

	console.error( error );
	setStatus( error.message );
	window.__imagePipelineValidation = {
		ready: false,
		error: error.message
	};

} );
