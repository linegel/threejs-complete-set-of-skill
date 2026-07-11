import {
	REVISION,
	NoColorSpace,
	RenderTarget,
	UnsignedByteType,
	Vector3
} from 'three/webgpu';

import { createWebGpuImagePipeline } from './main.js';
import {
	ARTIFACT_CONTRACT_VERSION,
	ARTIFACT_NUMERIC_PROVENANCE,
	ARTIFACT_RELATIVE_DIR,
	CAPTURE_PROFILE,
	DIAGNOSTIC_IMAGES,
	FIXED_SEED,
	QUALITY_TIER,
	REQUIRED_IMAGES,
	SCENE_ID,
	THREE_REVISION_LABEL
} from './artifact-config.js';

const canvas = document.getElementById( 'view' );
const status = document.getElementById( 'status' );

const CAMERA_BOOKMARKS = Object.freeze( {
	near: { position: [ 0, 1.1, 3.5 ], target: [ 0, 0, 0 ], fov: 44 },
	design: { position: [ 0, 1.3, 5.5 ], target: [ 0, 0, 0 ], fov: 50 },
	far: { position: [ 0, 1.7, 8.2 ], target: [ 0, 0, 0 ], fov: 54 }
} );

const ARTIFACT_GATES = Object.freeze( {
	frameBudgetMs: {
		desktopDiscrete: 50,
		desktopIntegrated: 75,
		mobile: 100
	},
	memoryBudgetMiB: 512,
	textureCacheAllowance: 2,
	nonblankRange: 8,
	repeatViewMaxPixelRatio: 0.02,
	diagnosticFinalMeanDifference: 6,
	postFinalMeanDifference: 0.25,
	minimumDiagnosticRange: 2,
	minimumNormalUniqueColors: 4,
	minimumDepthUniqueValues: 4,
	minimumCrossSignalDifference: 0.05
} );

const captureState = {
	camera: 'design',
	mode: 'final',
	timeSeconds: 0,
	frame: 0,
	variantLabel: 'design'
};

function setStatus( message ) {

	status.textContent = message;

}

function modeToDebugMode( mode ) {

	if ( mode === 'no-post' ) return 'no-post baseline';
	if ( mode === 'diagnostics' ) return 'normal';
	if ( [
		'normal',
		'emissive',
		'linear depth',
		'AO.r',
		'bloom contribution',
		'pre-tone-map HDR',
		'post-tone-map output',
		'authored AO split scaffold',
		'debug baseline AO final-color multiply'
	].includes( mode ) ) return mode;
	return 'final';

}

function setCameraBookmark( app, name ) {

	const bookmark = CAMERA_BOOKMARKS[ name ] ?? CAMERA_BOOKMARKS.design;
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

	// [Authored] Small deterministic motion makes the two legacy seed-named
	// time variants visibly distinct. It is not temporal-reconstruction proof.
	camera.position.x += Math.sin( seconds * 0.45 ) * 0.18;
	camera.position.y += Math.cos( seconds * 0.55 ) * 0.06;
	target.x += Math.sin( seconds * 0.7 ) * 0.08;
	camera.lookAt( target );
	camera.updateMatrixWorld( true );

}

function applyCaptureState( app, nextState = {} ) {

	Object.assign( captureState, nextState );
	const bookmark = setCameraBookmark( app, captureState.camera );
	app.setTime( captureState.timeSeconds );
	applyCameraMotion( app, bookmark, captureState.timeSeconds );
	app.setDebugMode( modeToDebugMode( captureState.mode ) );

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

function backendFailures() {

	const gpu = window.__imagePipelineGpuEvents ?? { uncapturedErrors: [], deviceLoss: null };
	return [
		...( window.__imagePipelineErrors ?? [] ),
		...gpu.uncapturedErrors,
		...( gpu.deviceLoss ? [ `device-lost: ${ gpu.deviceLoss.reason ?? 'unknown' }: ${ gpu.deviceLoss.message }` ] : [] )
	];

}

async function renderOnce( app, waitForPresentation = true ) {

	app.render();
	if ( waitForPresentation ) await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );

}

async function drainTimestampQueries( app ) {

	if (
		app.renderer.backend.trackTimestamp === true
		&& app.renderer.hasFeature( 'timestamp-query' ) === true
	) {

		await app.renderer.resolveTimestampsAsync( 'render' );

	}

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
		targetBytes: app.estimateTargetBytes(),
		storageBytes: 0
	};

}

function leakDeltas( before, after ) {

	const rendererInfoMemory = {};
	for ( const key of new Set( [
		...Object.keys( before.rendererInfoMemory ),
		...Object.keys( after.rendererInfoMemory )
	] ) ) {

		rendererInfoMemory[ key ] = ( after.rendererInfoMemory[ key ] ?? 0 ) - ( before.rendererInfoMemory[ key ] ?? 0 );

	}

	return {
		geometries: after.rendererInfoMemory.geometries - before.rendererInfoMemory.geometries,
		textures: after.rendererInfoMemory.textures - before.rendererInfoMemory.textures,
		targetBytes: after.targetBytes - before.targetBytes,
		storageBytes: after.storageBytes - before.storageBytes,
		rendererInfoMemory
	};

}

function thresholdRecord( textures = 0 ) {

	return { geometries: 0, textures, targetBytes: 0, storageBytes: 0 };

}

function leakPass( deltas, thresholds ) {

	return [ 'geometries', 'textures', 'targetBytes', 'storageBytes' ]
		.every( ( key ) => deltas[ key ] <= thresholds[ key ] );

}

async function runLifecycleLoop( app, name, operation, thresholds ) {

	await app.renderer.backend.device.queue.onSubmittedWorkDone();
	const before = leakSnapshot( app );
	const operations = [];
	let operationPass = true;

	for ( let i = 0; i < CAPTURE_PROFILE.lifecycleIterations; i ++ ) {

		const operationRecord = await operation( i );
		await renderOnce( app );
		await app.renderer.backend.device.queue.onSubmittedWorkDone();
		operations.push( {
			iteration: i + 1,
			...operationRecord,
			restoredSnapshot: leakSnapshot( app )
		} );
		if ( operationRecord?.pass === false ) operationPass = false;

	}

	await app.renderer.backend.device.queue.onSubmittedWorkDone();
	const after = leakSnapshot( app );
	const deltas = leakDeltas( before, after );
	// [Gated: timestamp-query] Prevent the fixed-size r185 query pool from
	// overflowing during long artifact lifecycle sequences. These drains are not
	// added to the recorded performance sample.
	await drainTimestampQueries( app );
	return {
		name,
		iterations: CAPTURE_PROFILE.lifecycleIterations,
		before,
		after,
		deltas,
		thresholds,
		pass: operationPass && leakPass( deltas, thresholds ),
		operations,
		counterClassification: 'All r185 renderer.info.memory counters are recorded in deltas.rendererInfoMemory; shared-schema pass/fail still gates only its four legacy counters.'
	};

}

async function buildLeakLoopEvidence( app ) {

	const viewport = app.getViewport();
	const baseSceneScale = app.scenePass.getResolutionScale();
	const boundedCache = thresholdRecord( ARTIFACT_GATES.textureCacheAllowance );
	const strict = thresholdRecord();
	const loops = [];

	loops.push( await runLifecycleLoop( app, 'resize', async ( iteration ) => {

		const widthDelta = iteration % 2 === 0 ? 96 : - 72;
		const heightDelta = iteration % 2 === 0 ? 48 : - 54;
		const changed = {
			width: Math.max( 320, viewport.width + widthDelta ),
			height: Math.max( 240, viewport.height + heightDelta ),
			dpr: viewport.dpr
		};

		app.resize( changed.width, changed.height, changed.dpr );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.resize( viewport.width, viewport.height, viewport.dpr );
		return { operation: 'renderer/canvas extent changed and restored', changed, changedSnapshot, pass: true };

	}, boundedCache ) );

	loops.push( await runLifecycleLoop( app, 'dpr-change', async ( iteration ) => {

		const changedDpr = Math.max( 0.5, viewport.dpr * ( iteration % 2 === 0 ? 1.25 : 0.75 ) );
		app.resize( viewport.width, viewport.height, changedDpr );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.resize( viewport.width, viewport.height, viewport.dpr );
		return {
			operation: 'renderer DPR changed and restored',
			changed: { ...viewport, dpr: changedDpr },
			changedSnapshot,
			pass: true
		};

	}, boundedCache ) );

	loops.push( await runLifecycleLoop( app, 'quality-tier-switch', async ( iteration ) => {

		const changedScale = iteration % 2 === 0 ? 0.75 : 0.5;
		app.setSceneResolutionScale( changedScale );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		app.setSceneResolutionScale( baseSceneScale );
		return {
			operation: 'authored scene resolution scale changed and restored; no adaptive controller is claimed',
			changed: { sceneResolutionScale: changedScale },
			changedSnapshot,
			pass: true
		};

	}, boundedCache ) );

	const debugModes = [ 'normal', 'emissive', 'linear depth', 'AO.r', 'bloom contribution', 'pre-tone-map HDR' ];
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
			operation: 'actual RenderPipeline diagnostic outputs cycled after warm-up and restored',
			changed: { debugModes: [ ...debugModes ] },
			changedSnapshot,
			pass: true
		};

	}, boundedCache ) );

	// The shared artifact schema requires these stable loop names. The graph has
	// no temporal history and no external assets, so these are explicit N/A
	// steady-render sentinels and are never cited as feature proof.
	loops.push( await runLifecycleLoop( app, 'history-reset', async () => ( {
		operation: 'not applicable: temporal history is disabled; steady-render leak sentinel only',
		claimStatus: 'N/A; does not prove a reset path',
		pass: app.diagnostics.claimBoundary.temporal.includes( 'not-implemented' )
	} ), strict ) );

	loops.push( await runLifecycleLoop( app, 'asset-reload', async () => ( {
		operation: 'not applicable: fixture has no external/reloadable assets; steady-render leak sentinel only',
		claimStatus: 'N/A; does not prove asset reload lifecycle',
		pass: true
	} ), strict ) );

	loops.push( await runLifecycleLoop( app, 'scene-teardown', async () => {

		const fixtures = [ ...app.fixtureMeshes ];
		for ( const fixture of fixtures ) app.scene.remove( fixture );
		await renderOnce( app );
		const changedSnapshot = leakSnapshot( app );
		for ( const fixture of fixtures ) app.scene.add( fixture );
		const restoredCount = fixtures.filter( ( fixture ) => fixture.parent === app.scene ).length;
		return {
			operation: 'all fixture meshes removed from the scene and reattached without disposal',
			changed: { attachedFixtureMeshes: 0 },
			restored: { attachedFixtureMeshes: restoredCount },
			changedSnapshot,
			pass: restoredCount === fixtures.length
		};

	}, strict ) );

	loops.push( await runLifecycleLoop( app, 'dispose-recreate', async () => {

		const secondaryCanvas = document.createElement( 'canvas' );
		const secondary = await createWebGpuImagePipeline( secondaryCanvas, { preset: 'feature-demo' } );
		secondary.resize( 320, 180, 1 );
		await renderOnce( secondary, false );
		await secondary.renderer.backend.device.queue.onSubmittedWorkDone();
		const renderedSnapshot = leakSnapshot( secondary );
		const firstDispose = secondary.dispose();
		const secondDispose = secondary.dispose();
		const disposedSnapshot = leakSnapshot( secondary );
		const deltas = leakDeltas( renderedSnapshot, disposedSnapshot );
		return {
			operation: 'secondary offscreen pipeline created, rendered, and disposed',
			secondary: { renderedSnapshot, disposedSnapshot, deltas, firstDispose, secondDispose },
			pass: firstDispose === true && secondDispose === false && deltas.geometries <= 0 && deltas.textures <= 0
		};

	}, strict ) );

	app.resize( viewport.width, viewport.height, viewport.dpr );
	app.setSceneResolutionScale( baseSceneScale );
	applyCaptureState( app, { camera: 'design', mode: 'final', timeSeconds: 0, frame: 0 } );
	await renderOnce( app );

	const knownInternalCacheDeltas = [
		'resize.textures: authored allowance for bounded replacement attachments after warm-up',
		'dpr-change.textures: authored allowance for bounded replacement attachments after warm-up',
		'quality-tier-switch.textures: authored allowance for bounded replacement attachments after warm-up',
		'debug-mode-switch.textures: authored allowance for bounded first-use diagnostic bindings after warm-up'
	];

	return {
		required: true,
		loops,
		summary: {
			pass: loops.every( ( loop ) => loop.pass === true ) && backendFailures().length === 0,
			uncapturedBackendErrors: backendFailures(),
			claimBoundary: 'Only actual resize/DPR/scale/debug/scene/dispose operations are evidence; history and asset loops are explicit N/A schema sentinels.'
		},
		allowedCacheNotes: knownInternalCacheDeltas
	};

}

function metricFromSamples( samples ) {

	const sorted = [ ...samples ].sort( ( a, b ) => a - b );
	const nearestRank = ( probability ) => sorted[ Math.max( 0, Math.ceil( probability * sorted.length ) - 1 ) ];
	return {
		median: Number( nearestRank( 0.5 ).toFixed( 3 ) ),
		p95: Number( nearestRank( 0.95 ).toFixed( 3 ) ),
		unit: 'ms'
	};

}

async function measureFrames( app ) {

	for ( let i = 0; i < CAPTURE_PROFILE.warmupFrames; i ++ ) {

		applyCaptureState( app, { camera: 'design', mode: 'final', timeSeconds: 0, frame: i } );
		await renderOnce( app, false );

	}

	const cpuSamples = [];
	const gpuSamples = [];
	const timestampSupported = app.renderer.hasFeature( 'timestamp-query' ) === true && app.renderer.backend.trackTimestamp === true;

	for ( let i = 0; i < CAPTURE_PROFILE.sampleFrames; i ++ ) {

		applyCaptureState( app, { timeSeconds: i / 30, frame: i } );
		const start = performance.now();
		await renderOnce( app, false );
		cpuSamples.push( performance.now() - start );

		if ( timestampSupported ) {

			const duration = await app.renderer.resolveTimestampsAsync( 'render' );
			if ( Number.isFinite( duration ) && duration > 0 ) gpuSamples.push( duration );

		}

	}

	const gpuMetric = gpuSamples.length === CAPTURE_PROFILE.sampleFrames ? metricFromSamples( gpuSamples ) : null;
	return {
		cpuFrameMs: metricFromSamples( cpuSamples ),
		gpuFrameMs: gpuMetric,
		gpuTimingUnavailable: gpuMetric === null,
		gpuTimingUnavailableReason: gpuMetric === null
			? 'timestamp-query unsupported or did not yield one finite positive sample per measured frame'
			: null,
		readbackCaptureMs: null,
		measurementContract: {
			cpu: 'Measured JS graph submission only; excludes presentation and timestamp-readback stalls.',
			gpu: gpuMetric === null
				? 'Optional timestamp diagnostic unavailable; no GPU claim.'
				: 'Raw serialized r185 timestamp diagnostic only; named-adapter and complete-residency evidence are absent.',
			promotion: 'INSUFFICIENT_EVIDENCE',
			quantile: 'nearest-rank over the recorded sample array'
		}
	};

}

function buildEvidence( app, timing, leakLoop ) {

	const rendererInfo = rendererInfoRecord( app );
	const graph = app.diagnostics.configValidation;
	const viewport = app.getViewport();
	const sceneScale = app.scenePass.getResolutionScale();
	const physicalSceneWidth = Math.floor( viewport.width * viewport.dpr * sceneScale );
	const physicalSceneHeight = Math.floor( viewport.height * viewport.dpr * sceneScale );
	const captureTargetBytes = viewport.width * viewport.height * CAPTURE_PROFILE.readbackBytesPerTexel;
	const selectedMrtLogicalBytes = app.estimateTargetBytes();
	const accountedRenderTargetBytes = selectedMrtLogicalBytes + captureTargetBytes;
	const diagnosticImages = [ ...DIAGNOSTIC_IMAGES ];
	const requiredImages = [ ...REQUIRED_IMAGES, ...diagnosticImages ];
	const gpuEvents = window.__imagePipelineGpuEvents ?? { uncapturedErrors: [], deviceLoss: null };
	const cameraEnvelope = Object.fromEntries(
		Object.entries( CAMERA_BOOKMARKS ).map( ( [ name, value ] ) => [ name, value.position[ 2 ] ] )
	);

	return {
		visualContract: {
			subject: SCENE_ID,
			contractVersion: ARTIFACT_CONTRACT_VERSION,
			claimBoundary: app.diagnostics.claimBoundary,
			numericProvenance: {
				...ARTIFACT_NUMERIC_PROVENANCE,
				ARTIFACT_GATES: 'Authored fixed-fixture falsifiability/liveness gates; never product performance recommendations.'
			},
			identity: [
				'one native-WebGPU RenderPipeline owns final image presentation',
				'one primary scene pass exposes output plus the authored normal/emissive demonstration attachments; depth remains separate',
				'actual diagnostics expose normal, emissive, linear depth, GTAO visibility, bloom contribution, and pre-tone-map HDR'
			],
			silhouette: [ 'ground, shaded box, and emissive sphere remain visible across fixed camera captures' ],
			materialSeparation: [ 'non-emissive shaded surfaces remain distinguishable from the selective emissive/bloom fixture' ],
			motion: [ 'legacy seed-named captures are deterministic authored-time variants; no temporal reconstruction or stochastic-seed claim is made' ],
			cameraEnvelope,
			lightingEnvelope: [ 'scene HDR and no-post output remain nonblank under authored key plus ambient lighting' ],
			invariants: [
				'primary graph records one scene render and keeps depth outside MRT color outputs',
				'no-post output remains independently inspectable',
				'only implemented diagnostic signals are required'
			],
			invariantArtifacts: {
				'primary graph records one scene render and keeps depth outside MRT color outputs': {
					requiredImages: [ 'images/final.design.png', 'images/diagnostics.mosaic.png' ],
					requiredDiagnostics: [ 'pipelineConfig.js', 'validateImagePipelineConfig.js' ],
					requiredMetrics: [ 'evidence-manifest.json.postStack', 'render-targets.json.accountingStatus' ],
					blockingFailures: [ 'duplicate scene render', 'depth in MRT color outputs', 'undeclared attachment consumer' ]
				},
				'no-post output remains independently inspectable': {
					requiredImages: [ 'images/no-post.design.png' ],
					requiredDiagnostics: [ 'no-post baseline' ],
					requiredMetrics: [ 'timings.json.measurementContract' ],
					blockingFailures: [ 'blank no-post capture', 'final-only evidence' ]
				},
				'only implemented diagnostic signals are required': {
					requiredImages: [ 'images/diagnostics.mosaic.png', ...diagnosticImages ],
					requiredDiagnostics: [ 'normal', 'emissive', 'linear depth', 'AO.r', 'bloom contribution', 'pre-tone-map HDR' ],
					requiredMetrics: [ 'evidence-manifest.json.postStack.mrtOutputs', 'evidence-manifest.json.claimBoundary' ],
					blockingFailures: [ 'missing selected MRT producer', 'raw depth relabelled as linear', 'unimplemented signal cited as evidence' ]
				}
			},
			requiredImages,
			requiredDiagnostics: [ 'no-post baseline', 'normal', 'emissive', 'linear depth', 'AO.r', 'bloom contribution', 'pre-tone-map HDR' ],
			requiredMetrics: [ 'renderer-info.json', 'render-targets.json', 'storage-resources.json', 'timings.json', 'leak-loop.json' ],
			blockingFailures: [ 'non-primary WebGPU backend', 'blank PNG', 'final-only evidence', 'duplicate output owner', 'stale artifact contract version' ],
			allowedDivergences: [
				'The selected MRT is an authored feature-demo choice, not a target-performance conclusion.',
				'Physical target residency excludes private GTAO/Bloom allocations and is therefore not proven.',
				'Raw timestamp diagnostics do not promote performance without a named adapter and complete residency evidence.'
			],
			performancePromotion: {
				state: 'INSUFFICIENT_EVIDENCE',
				reason: 'GPU adapter identity and complete physical residency are unavailable; this feature fixture cannot be promoted as a performance tier.'
			},
			frameBudgetMs: ARTIFACT_GATES.frameBudgetMs,
			frameBudgetClassification: 'Authored capture-liveness ceilings required by the shared schema; not product frame budgets.',
			memoryBudgetMB: ARTIFACT_GATES.memoryBudgetMiB,
			memoryBudgetClassification: 'Authored lower-bound-accounting gate required by the shared schema; not physical residency proof.'
		},
		evidenceManifest: {
			skill: 'threejs-visual-validation',
			sceneId: SCENE_ID,
			contractVersion: ARTIFACT_CONTRACT_VERSION,
			claimBoundary: app.diagnostics.claimBoundary,
			numericProvenance: ARTIFACT_NUMERIC_PROVENANCE,
			threeRevision: THREE_REVISION_LABEL.replace( 'r', '' ),
			browser: navigator.userAgent,
			os: navigator.platform,
			gpuAdapter: null,
			renderer: 'WebGPURenderer',
			backend: {
				isPrimaryBackend: rendererInfo.isPrimaryBackend,
				coordinateSystem: rendererInfo.coordinateSystem,
				initialized: rendererInfo.initialized,
				deviceLostObserved: gpuEvents.deviceLoss !== null,
				deviceLoss: gpuEvents.deviceLoss,
				uncapturedErrors: [ ...gpuEvents.uncapturedErrors ],
				features: rendererInfo.features,
				limits: rendererInfo.limits,
				unavailableReason: rendererInfo.unavailableReason
			},
			qualityTier: QUALITY_TIER,
			qualityTierClassification: 'Shared-schema label only; bundle is an explicit unmeasured feature fixture.',
			viewport,
			camera: makeCameraRecord( app, 'design' ),
			seed: FIXED_SEED,
			seedClassification: 'Stable artifact identity only; this deterministic fixture has no stochastic seed input.',
			time: { fixed: true, seconds: captureState.timeSeconds, frame: captureState.frame },
			assets: [],
			colorPipeline: {
				toneMapOwner: 'renderOutput using renderer NeutralToneMapping context',
				outputTransformOwner: 'renderOutput',
				outputColorTransform: false,
				lutDomain: null,
				hdrWorkingType: 'HalfFloatType',
				dataSignals: [ 'normal', 'depth', 'linearDepth' ],
				sceneLinearSignals: [ 'output', 'emissive', 'bloom contribution', 'pre-tone-map HDR' ],
				screenshotEncoding: 'RGBA8 WebGPU RenderTarget readback encoded as PNG'
			},
			postStack: {
				renderPipeline: 'RenderPipeline',
				scenePasses: graph.sceneRenderCount,
				mrtOutputs: graph.requiredMRT,
				depthOwner: 'PassNode depth texture; not an MRT color output',
				diagnosticModes: graph.diagnosticModes,
				outputNodeOwner: 'RenderPipeline.outputNode',
				temporal: 'unsupported; no executable reset/reseed owner',
				exposure: 'not implemented',
				gradingLut: 'not implemented'
			},
			thresholds: {
				budgetProfile: 'desktopDiscrete',
				classification: 'Authored artifact falsifiability/liveness gates only.',
				nonblank: { minRange: ARTIFACT_GATES.nonblankRange },
				cameraMatrixRequired: true,
				perViewPixelDiff: {
					designRepeat: {
						baseline: 'images/final.design.png',
						candidate: 'images/camera.design.png',
						maxRatio: ARTIFACT_GATES.repeatViewMaxPixelRatio
					}
				},
				falsifiability: {
					diagnosticFinalMeanDifference: ARTIFACT_GATES.diagnosticFinalMeanDifference,
					postFinalMeanDifference: ARTIFACT_GATES.postFinalMeanDifference,
					minimumDiagnosticRange: ARTIFACT_GATES.minimumDiagnosticRange,
					minimumNormalUniqueColors: ARTIFACT_GATES.minimumNormalUniqueColors,
					minimumDepthUniqueValues: ARTIFACT_GATES.minimumDepthUniqueValues,
					minimumCrossSignalDifference: ARTIFACT_GATES.minimumCrossSignalDifference
				}
			},
			stochasticMasks: [
				{ name: 'none', path: null, reason: 'fixed camera and authored time; fixture has no stochastic input' }
			],
			knownCompromises: [
				'MRT selection lacks a paired target measurement and is not a performance recommendation.',
				'Browser AO uses the explicitly-authored split scaffold; it is not physical direct/indirect-light proof.',
				'Target-byte accounting is a selected-color lower bound and excludes depth, private effects, padding, compression, and allocator behavior.',
				'Legacy seed-named image slots are deterministic time variants, not seed or temporal-AA evidence.'
			]
		},
		rendererInfo,
		renderTargets: {
			required: true,
			totalBytes: null,
			accountingStatus: 'Logical selected-MRT color lower bound plus RGBA8 capture target; not total physical GPU residency.',
			accountedLowerBoundBytes: accountedRenderTargetBytes,
			performanceGate: { state: 'INSUFFICIENT_EVIDENCE', reason: 'Depth, private effect targets, alignment, allocator behavior, and physical residency are not measured.' },
			excludedFromTotal: [ 'scene depth', 'GTAONode private targets', 'BloomNode private targets', 'backend alignment', 'allocator granularity', 'compression' ],
			targets: [
				{
					name: 'scene-pass-selected-color-attachments',
					role: `${ graph.requiredMRT.join( '/' ) } selected color outputs; depth is separately owned and excluded from this lower bound`,
					owner: 'primary PassNode',
					width: physicalSceneWidth,
					height: physicalSceneHeight,
					dprScale: viewport.dpr * sceneScale,
					format: 'RGBA16F per selected default attachment',
					type: 'HalfFloatType',
					colorSpace: 'scene-linear color or no-color data according to signal semantics',
					samples: 1,
					depthStencil: 'separate PassNode depth texture; bytes excluded',
					mrtCount: graph.requiredMRT.length,
					lifetime: 'persistent PassNode ownership until dispose',
					memoryBytes: selectedMrtLogicalBytes
				},
				{
					name: 'capture-target',
					role: 'PNG readback staging render target',
					owner: 'browser-app capturePixels',
					width: viewport.width,
					height: viewport.height,
					dprScale: 1,
					format: 'RGBA8',
					type: 'UnsignedByteType',
					colorSpace: 'NoColorSpace storage; final mode already contains explicit sRGB output codes from renderOutput',
					samples: 1,
					depthStencil: 'none',
					mrtCount: 1,
					lifetime: 'artifact capture session',
					memoryBytes: captureTargetBytes
				}
			]
		},
		storageResources: {
			required: true,
			totalBytes: null,
			accountedApplicationStorageBytes: 0,
			performanceGate: { state: 'INSUFFICIENT_EVIDENCE', reason: 'Zero application-owned storage is not total GPU residency evidence.' },
			resources: [
				{
					name: 'none',
					kind: 'no application-owned storage buffer/texture in this feature fixture',
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
			warmupFrames: CAPTURE_PROFILE.warmupFrames,
			sampleFrames: CAPTURE_PROFILE.sampleFrames,
			cpuFrameMs: timing.cpuFrameMs,
			gpuFrameMs: null,
			renderTimestampMs: null,
			computeTimestampMs: null,
			gpuTimingUnavailable: true,
			gpuTimingLabel: 'CPU-only proxy',
			unavailableReason: 'INSUFFICIENT_EVIDENCE: GPU adapter identity is unavailable, so raw timestamps cannot promote a required performance claim.',
			rawRenderTimestampDiagnosticMs: timing.gpuFrameMs,
			performanceGate: { state: 'INSUFFICIENT_EVIDENCE', reason: 'Named adapter plus complete required timing profile is absent.' },
			readbackCaptureMs: timing.readbackCaptureMs,
			measurementContract: timing.measurementContract,
			qualityTierChanges: [],
			sceneRenderCount: graph.sceneRenderCount,
			dispatchCountSnapshot: app.renderer.info.compute?.calls ?? 0,
			drawCallsSnapshot: app.renderer.info.render.drawCalls,
			trianglesSnapshot: app.renderer.info.render.triangles
		},
		leakLoop
	};

}

function packedReadbackBytesPerRow( width, height, pixelLength ) {

	const rowBytes = width * CAPTURE_PROFILE.readbackBytesPerTexel;
	const compactLength = rowBytes * height;
	if ( pixelLength === compactLength ) return rowBytes;

	const alignment = CAPTURE_PROFILE.webgpuCopyRowAlignment;
	const alignedRowBytes = Math.ceil( rowBytes / alignment ) * alignment;
	const paddedLength = alignedRowBytes * ( height - 1 ) + rowBytes;
	if ( pixelLength !== paddedLength ) {

		throw new Error( `Unexpected WebGPU readback length ${ pixelLength }; expected ${ compactLength } or ${ paddedLength }.` );

	}
	return alignedRowBytes;

}

async function initialize() {

	window.__imagePipelineErrors = [];
	window.__imagePipelineGpuEvents = { uncapturedErrors: [], deviceLoss: null };
	window.addEventListener( 'unhandledrejection', ( event ) => {

		window.__imagePipelineErrors.push( String( event.reason?.message ?? event.reason ) );

	} );

	if ( ! navigator.gpu ) throw new Error( 'WebGPU is unavailable; image-pipeline validation requires native WebGPU.' );
	const app = await createWebGpuImagePipeline( canvas, { preset: 'feature-demo' } );
	if ( app.renderer.backend?.isWebGPUBackend !== true ) {

		throw new Error( 'Image-pipeline validation requires renderer.backend.isWebGPUBackend === true.' );

	}
	const device = app.renderer.backend.device;
	device.addEventListener( 'uncapturederror', ( event ) => {

		window.__imagePipelineGpuEvents.uncapturedErrors.push( {
			type: event.error?.constructor?.name ?? 'GPUError',
			message: event.error?.message ?? 'Unknown uncaptured GPU error'
		} );

	} );
	device.lost.then( ( info ) => {

		if ( info.reason === 'destroyed' ) return;
		window.__imagePipelineGpuEvents.deviceLoss = {
			reason: info.reason ?? null,
			message: info.message ?? 'Unknown device-loss reason'
		};

	} );

	app.resize( window.innerWidth, window.innerHeight, window.devicePixelRatio || 1 );
	const captureTarget = new RenderTarget( window.innerWidth, window.innerHeight, {
		samples: 1,
		type: UnsignedByteType
	} );
	// The final graph already executes renderOutput(..., renderer.outputColorSpace).
	// Store those encoded codes in unorm data; an sRGB render-target format could
	// apply an additional hardware transfer. Data diagnostics also require no
	// color transform.
	captureTarget.texture.colorSpace = NoColorSpace;
	app.renderer.initRenderTarget?.( captureTarget );
	const timing = await measureFrames( app );

	async function capturePixels( nextState ) {

		const readbackStart = performance.now();
		applyCaptureState( app, nextState );
		await renderOnce( app, false );

		const viewport = app.getViewport();
		const width = viewport.width;
		const height = viewport.height;
		captureTarget.setSize( width, height );
		app.renderer.setRenderTarget( captureTarget );
		await renderOnce( app, false );
		const pixels = await app.renderer.readRenderTargetPixelsAsync( captureTarget, 0, 0, width, height );
		app.renderer.setRenderTarget( null );
		await renderOnce( app, false );
		await drainTimestampQueries( app );

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
	setStatus( `${ SCENE_ID } ready\n${ ARTIFACT_RELATIVE_DIR }\nselected MRT: ${ app.diagnostics.configValidation.requiredMRT.join( ', ' ) }` );
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
	window.__imagePipelineValidation = { ready: false, error: error.message };

} );
