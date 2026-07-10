import {
	AmbientLight,
	BoxGeometry,
	Color,
	DirectionalLight,
	HalfFloatType,
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

export async function createNativeWebGPUValidationSubject( canvas, options = {} ) {

	if ( canvas === null || typeof canvas !== 'object' ) throw new Error( 'A canvas is required.' );

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true,
		...options.rendererParameters
	} );
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = NeutralToneMapping;

	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) {

		renderer.dispose();
		throw new Error( 'WebGPU backend required for canonical visual validation. No fallback is activated.' );

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

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );

	const outputNode = scenePass.getTextureNode( 'output' );
	const normalNode = scenePass.getTextureNode( 'normal' );
	const emissiveNode = scenePass.getTextureNode( 'emissive' );
	const depthNode = scenePass.getTextureNode( 'depth' );
	const finalLinearNode = vec4( outputNode.rgb.add( emissiveNode.rgb.mul( float( 0.12 ) ) ), outputNode.a );
	const modeNodes = {
		final: renderOutput( finalLinearNode ),
		'no-post': renderOutput( outputNode ),
		normal: renderOutput( vec4( normalNode.rgb.mul( 0.5 ).add( 0.5 ), 1 ) ),
		emissive: renderOutput( vec4( emissiveNode.rgb, 1 ) )
	};
	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = modeNodes.final;
	renderPipeline.needsUpdate = true;

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
	const cpuFrameSamples = [];
	const resetEvents = [];

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

	}

	async function renderTo( target ) {

		const previousTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( target );
		const start = performance.now();
		renderPipeline.render();
		cpuFrameSamples.push( performance.now() - start );
		renderer.setRenderTarget( previousTarget );

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
			if ( previousMode !== mode ) await this.setMode( previousMode );
			return {
				target,
				width: pixelWidth,
				height: pixelHeight,
				format: 'rgba8unorm',
				encoding: renderer.outputColorSpace,
				pixels: unpacked.pixels,
				readbackLayout: unpacked.layout,
				sourceByteLength: unpacked.sourceByteLength
			};

		},

		describePipeline() {

			return {
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
				finalToneMapOwner: 'renderOutput',
				finalOutputTransformOwner: 'renderOutput',
				outputColorTransform: renderPipeline.outputColorTransform,
				activeMode: mode,
				activeOutputNode: `${ mode }-output-node`,
				needsUpdate: renderPipeline.needsUpdate
			};

		},

		describeResources() {

			const pixelWidth = captureTarget.width;
			const pixelHeight = captureTarget.height;
			return {
				renderTargets: [
					{ name: 'output', owner: 'scene-pass', width: pixelWidth, height: pixelHeight, format: 'rgba16float', bytes: pixelWidth * pixelHeight * 8 },
					{ name: 'normal', owner: 'scene-pass', width: pixelWidth, height: pixelHeight, format: 'rgba16float', bytes: pixelWidth * pixelHeight * 8 },
					{ name: 'emissive', owner: 'scene-pass', width: pixelWidth, height: pixelHeight, format: 'rgba16float', bytes: pixelWidth * pixelHeight * 8 },
					{ name: 'capture-target', owner: 'validation-capture', width: pixelWidth, height: pixelHeight, format: 'rgba8unorm', bytes: pixelWidth * pixelHeight * 4 }
				],
				storageResources: [],
				readbackPolicy: 'render target copy with 256-byte aligned rows; unpacked after map completion'
			};

		},

		getMetrics() {

			return {
				scenario,
				mode,
				tier,
				camera: cameraId,
				seed: `0x${ seed.toString( 16 ).padStart( 8, '0' ) }`,
				timeSeconds,
				viewport: { width, height, dpr },
				cpuFrameMs: {
					samples: [ ...cpuFrameSamples ],
					p50: percentile( cpuFrameSamples, 0.5 ),
					p95: percentile( cpuFrameSamples, 0.95 )
				},
				resetEvents: [ ...resetEvents ],
				rendererInfo: structuredClone( renderer.info )
			};

		},

		async resolveGpuTimings() {

			try {

				const renderMs = await renderer.resolveTimestampsAsync( 'render' );
				const computeMs = await renderer.resolveTimestampsAsync( 'compute' );
				if ( Number.isFinite( renderMs ) === false ) throw new Error( 'render timestamp unavailable' );
				return { verdict: 'PASS', renderMs, computeMs: Number.isFinite( computeMs ) ? computeMs : null, reason: null };

			} catch ( error ) {

				return { verdict: 'INSUFFICIENT_EVIDENCE', renderMs: null, computeMs: null, reason: error.message };

			}

		},

		async dispose() {

			if ( disposed ) return;
			disposed = true;
			scene.traverse( disposeObject );
			captureTarget.dispose();
			renderPipeline.dispose();
			renderer.dispose();
			captureTarget = null;

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
