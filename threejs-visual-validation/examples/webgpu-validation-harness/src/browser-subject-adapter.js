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

import { unpackAlignedReadback } from './readback.js';
import { buildValidationResourceLedger, emptyValidationResourceLedger } from './resource-ledger.js';
import { snapshotGpuAdapter, snapshotRendererInfo } from './renderer-info-snapshot.js';

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
const MODE_OUTPUT_NODE_IDS = Object.freeze( {
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
	const scenePass = pass( scene, camera );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );

	const outputNode = scenePass.getTextureNode( 'output' );
	const normalNode = scenePass.getTextureNode( 'normal' );
	const emissiveNode = scenePass.getTextureNode( 'emissive' );
	const depthNode = scenePass.getTextureNode( 'depth' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	const finalLinearNode = vec4( outputNode.rgb.add( emissiveNode.rgb.mul( float( 0.12 ) ) ), outputNode.a );
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

	function requireLive() {

		if ( disposed ) throw new Error( 'Validation subject is disposed.' );

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

	async function renderTo( target ) {

		const previousTarget = renderer.getRenderTarget();
		activeFinalRenderTarget = target;
		try {

			renderer.setRenderTarget( target );
			const start = performance.now();
			renderPipeline.render();
			renderSubmissionCount ++;
			const cpuMs = performance.now() - start;
			cpuFrameSamples.push( cpuMs );
			return cpuMs;

		} finally {

			renderer.setRenderTarget( previousTarget );
			activeFinalRenderTarget = null;

		}

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

	applyCamera();
	applyTime();
	applyTier();
	renderer.setPixelRatio( dpr );
	renderer.setSize( width, height, false );

	const controller = {
		async ready() {

			requireLive();
			await this.renderOnce();

		},

		async setScenario( id ) {

			requireKnown( SCENARIOS, id, 'scenario' );
			scenario = id;
			const scenarioIndex = SCENARIO_IDS.indexOf( id );
			marker.position.x = - 2.15 + ( scenarioIndex % 4 ) * 0.22;
			marker.position.z = - 0.5 + Math.floor( scenarioIndex / 4 ) * 0.5;
			marker.updateMatrixWorld( true );

		},

		async setMode( id ) {

			requireKnown( MODES, id, 'mode' );
			mode = id;
			applyMode();

		},

		async runMechanismReachabilityProfile() {

			requireLive();
			const originalMode = mode;
			const routeExecutions = [];
			for ( const id of Object.keys( MODE_OUTPUT_NODE_IDS ) ) {

				await this.setMode( id );
				const before = renderSubmissionCount;
				const selectedOutputNodeId = Object.entries( modeNodes ).find( ( [ , node ] ) => node === renderPipeline.outputNode )?.[ 0 ] ?? null;
				const selectedOutputNodeIdentityVerified = renderPipeline.outputNode === modeNodes[ id ];
				const graphMarkedDirtyBeforeRender = renderPipeline.needsUpdate === true;
				await renderTo( null );
				routeExecutions.push( {
					mode: id,
					outputNodeId: MODE_OUTPUT_NODE_IDS[ id ],
					selectedOutputNodeId: selectedOutputNodeId === null ? null : MODE_OUTPUT_NODE_IDS[ selectedOutputNodeId ],
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

				await this.setMode( '__invalid-mechanism-route__' );

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
			await this.setMode( originalMode );
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

		},

		async setTier( id ) {

			requireKnown( TIERS, id, 'tier' );
			tier = id;
			applyTier();

		},

		async setSeed( nextSeed ) {

			requireKnown( SEEDS, nextSeed, 'seed' );
			seed = nextSeed >>> 0;
			applyTime();

		},

		async setCamera( id ) {

			requireKnown( CAMERAS, id, 'camera' );
			cameraId = id;
			applyCamera();

		},

		async setTime( seconds ) {

			if ( Number.isFinite( seconds ) === false || seconds < 0 ) throw new Error( 'Time must be a finite nonnegative number.' );
			timeSeconds = seconds;
			applyTime();

		},

		async step( deltaSeconds ) {

			if ( Number.isFinite( deltaSeconds ) === false || deltaSeconds < 0 ) throw new Error( 'Delta time must be finite and nonnegative.' );
			timeSeconds += deltaSeconds;
			applyTime();
			await this.renderOnce();

		},

		async resetHistory( cause ) {

			if ( typeof cause !== 'string' || cause.length === 0 ) throw new Error( 'History reset cause is required.' );
			resetEvents.push( { cause, timeSeconds } );
			renderPipeline.needsUpdate = true;

		},

		async resize( nextWidth, nextHeight, nextDpr ) {

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

		},

		async renderOnce() {

			requireLive();
			await renderTo( null );

		},

		async capturePixels( target = mode ) {

			requireLive();
			requireKnown( MODES, target, 'capture target' );
			const previousMode = mode;
			if ( target !== mode ) await this.setMode( target );
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
			if ( previousMode !== mode ) await this.setMode( previousMode );
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

		},

		describePipeline() {

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
				captureRoutes: Object.fromEntries( Object.entries( MODE_OUTPUT_NODE_IDS ).map( ( [ id, outputNodeId ] ) => [ id, { mode: id, outputNodeId } ] ) ),
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

			if ( disposed ) return resourceLedgerObserver.current();
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
				labId: 'webgpu-validation-harness',
				threeRevision: '185',
				runtimeProfile,
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

			if ( timestampQueriesRequested === false ) return { verdict: 'NOT_CLAIMED', renderMs: null, computeMs: null, reason: 'Correctness profile does not request GPU timestamps.' };
			try {

				const renderMs = await renderer.resolveTimestampsAsync( 'render' );
				const computeMs = await renderer.resolveTimestampsAsync( 'compute' );
				if ( Number.isFinite( renderMs ) === false ) throw new Error( 'render timestamp unavailable' );
				return { verdict: 'PASS', renderMs, computeMs: Number.isFinite( computeMs ) ? computeMs : null, reason: null };

			} catch ( error ) {

				return { verdict: 'INSUFFICIENT_EVIDENCE', renderMs: null, computeMs: null, reason: error.message };

			}

		},

		async runPerformanceProfile( configuration = {} ) {

			requireLive();
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

		},

		async runGovernorStressProfile( configuration = {} ) {

			requireLive();
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

		},

		async dispose() {

			if ( disposed ) return disposeEvidence;
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
