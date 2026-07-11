import * as THREE from 'three/webgpu';
import { color, float, materialAO, screenUV, vec3, vec4 } from 'three/tsl';
import {
	AO_TIERS,
	createGTAOStage,
	inferPaddedLayout
} from '../webgpu-node-gtao/main.js';
import {
	createImagePipelineAOHostAdapter,
	validateImagePipelineAOOwnership
} from './host-adapter.js';

export const INTEGRATION_SCENARIOS = Object.freeze( [ 'wall-receiver', 'direct-emissive' ] );
export const INTEGRATION_MODES = Object.freeze( [
	'final',
	'raw-ao',
	'denoised-ao',
	'temporal-ao',
	'normal',
	'depth',
	'velocity',
	'indirect-visibility',
	'owner-graph'
] );

function material( baseColor, { roughness = 0.7, emissiveColor = null, emissiveIntensity = 0 } = {} ) {

	const value = new THREE.MeshStandardNodeMaterial( { roughness, metalness: 0 } );
	value.colorNode = color( baseColor );
	value.aoNode = materialAO;
	if ( emissiveColor !== null ) value.emissiveNode = color( emissiveColor ).mul( float( emissiveIntensity ) );
	return value;

}

function createIntegrationScene() {

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x0a1118 );
	const camera = new THREE.PerspectiveCamera( 52, 1, 0.1, 100 );
	camera.position.set( 3.4, 2.2, 5.3 );
	camera.lookAt( 0, 0.65, 0 );

	const groups = new Map();
	for ( const id of INTEGRATION_SCENARIOS ) {

		const group = new THREE.Group();
		group.name = `image-pipeline-ao:${ id }`;
		groups.set( id, group );
		scene.add( group );

	}

	const wallGroup = groups.get( 'wall-receiver' );
	const floor = new THREE.Mesh( new THREE.PlaneGeometry( 8, 8 ), material( 0x697885, { roughness: 0.86 } ) );
	floor.rotation.x = - Math.PI / 2;
	wallGroup.add( floor );
	const wall = new THREE.Mesh( new THREE.BoxGeometry( 0.28, 2.1, 3.8 ), material( 0x8998a5, { roughness: 0.78 } ) );
	wall.position.set( - 1.05, 1.05, - 0.4 );
	wallGroup.add( wall );
	const movingBlock = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), material( 0xc39f6c, { roughness: 0.58 } ) );
	movingBlock.position.set( 0.45, 0.5, 0 );
	wallGroup.add( movingBlock );

	const directGroup = groups.get( 'direct-emissive' );
	const directFloor = new THREE.Mesh( new THREE.PlaneGeometry( 8, 8 ), material( 0x65717b, { roughness: 0.86 } ) );
	directFloor.rotation.x = - Math.PI / 2;
	directGroup.add( directFloor );
	const occluder = new THREE.Mesh( new THREE.BoxGeometry( 0.9, 1.5, 0.9 ), material( 0x4f5964, { roughness: 0.82 } ) );
	occluder.position.set( 0, 0.75, 0 );
	directGroup.add( occluder );
	const emitter = new THREE.Mesh( new THREE.SphereGeometry( 0.22, 32, 16 ), material( 0x1d0905, {
		roughness: 0.2,
		emissiveColor: 0xffa448,
		emissiveIntensity: 10
	} ) );
	emitter.position.set( 1.05, 0.55, 0.15 );
	directGroup.add( emitter );

	const key = new THREE.DirectionalLight( 0xfff1dc, 4 );
	key.position.set( 3.5, 5, 2.5 );
	scene.add( key, new THREE.HemisphereLight( 0xb8d3ff, 0x1a211d, 1.1 ) );

	return { scene, camera, groups, movingBlock };

}

function textureIndex( renderTarget, name ) {

	const index = renderTarget.textures.findIndex( ( texture ) => texture.name === name );
	if ( index < 0 ) throw new Error( `Integration render target has no ${ name } texture.` );
	return index;

}

async function captureTarget( renderer, renderTarget, targetIndex ) {

	const { width, height } = renderTarget;
	const pixels = await renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height, targetIndex );
	const source = new Uint8Array( pixels.buffer, pixels.byteOffset, pixels.byteLength );
	const layout = inferPaddedLayout( source.byteLength, width, height );
	const packed = new Uint8Array( layout.rowBytes * height );
	for ( let row = 0; row < height; row ++ ) {

		packed.set( source.subarray( row * layout.bytesPerRow, row * layout.bytesPerRow + layout.rowBytes ), row * layout.rowBytes );

	}
	return { width, height, bytesPerTexel: layout.bytesPerTexel, bytesPerRow: layout.bytesPerRow, packedRowBytes: layout.rowBytes, componentType: pixels.constructor.name, data: packed };

}

export async function createImagePipelineAOIntegration( {
	canvas,
	width = 1200,
	height = 800,
	dpr = 1,
	tier: initialTier = 'ultra',
	scenario: initialScenario = 'wall-receiver',
	mode: initialMode = 'final',
	seed = 1
} = {} ) {

	if ( AO_TIERS[ initialTier ] === undefined ) throw new Error( `Unknown AO integration tier: ${ initialTier }` );
	const renderer = new THREE.WebGPURenderer( { canvas, antialias: false, outputBufferType: THREE.HalfFloatType, trackTimestamp: true } );
	renderer.setPixelRatio( dpr );
	renderer.setSize( width, height, false );
	await renderer.init();
	if ( renderer.backend.isWebGPUBackend !== true ) throw new Error( 'Image-pipeline AO integration requires native WebGPU; fallback is not activated.' );

	const { scene, camera, groups, movingBlock } = createIntegrationScene();
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	const renderPipeline = new THREE.RenderPipeline( renderer );
	const stage = createGTAOStage( { scene, camera, tier: AO_TIERS[ initialTier ] } );
	const host = createImagePipelineAOHostAdapter( { renderPipeline, scene, camera } );
	host.attachAOStage( stage );
	const presentationTarget = new THREE.RenderTarget( renderer.domElement.width, renderer.domElement.height, {
		type: THREE.UnsignedByteType,
		depthBuffer: false
	} );
	presentationTarget.texture.colorSpace = renderer.outputColorSpace;
	presentationTarget.texture.name = 'integration-image-pipeline-ao-presentation-rgba8';

	let tierId = initialTier;
	let scenarioId = initialScenario;
	let mode = initialMode;
	let timeSeconds = 0;
	let currentSeed = seed >>> 0;
	let temporalEnabled = false;

	function nodeForMode( id ) {

		switch ( id ) {

			case 'final': return stage.materialContextOutput;
			case 'raw-ao': return vec4( vec3( stage.rawAO.sample( screenUV ).r ), 1 );
			case 'denoised-ao': return vec4( vec3( stage.reconstructedAO.sample( screenUV ).r ), 1 );
			case 'temporal-ao': return stage.traaNode;
			case 'normal': return vec4( stage.sceneNormal.sample( screenUV ).rgb.mul( 0.5 ).add( 0.5 ), 1 );
			case 'depth': return vec4( vec3( stage.linearDepth ), 1 );
			case 'velocity': return vec4( stage.velocityNode.sample( screenUV ).rg.mul( 0.5 ).add( 0.5 ), 0, 1 );
			case 'indirect-visibility': return vec4( vec3( float( 1 ).sub( stage.reconstructedAO.sample( screenUV ).r ) ), 1 );
			case 'owner-graph': return vec4( 0.2, 0.72, 1, 1 );
			default: throw new Error( `Unknown AO integration mode: ${ id }` );

		}

	}

	async function setScenario( id ) {

		if ( ! INTEGRATION_SCENARIOS.includes( id ) ) throw new Error( `Unknown AO integration scenario: ${ id }` );
		scenarioId = id;
		for ( const [ key, group ] of groups ) group.visible = key === id;
		await resetHistory( 'scenario-change' );

	}

	async function setMode( id ) {

		if ( ! INTEGRATION_MODES.includes( id ) ) throw new Error( `Unknown AO integration mode: ${ id }` );
		mode = id;
		temporalEnabled = id === 'temporal-ao';
		stage.setTemporalEnabled( temporalEnabled );
		host.setOutput( id, nodeForMode( id ), { diagnostic: id !== 'final' && id !== 'temporal-ao' } );

	}

	async function setTier( id ) {

		if ( AO_TIERS[ id ] === undefined ) throw new Error( `Unknown AO integration tier: ${ id }` );
		tierId = id;
		stage.setTier( AO_TIERS[ id ] );
		renderPipeline.needsUpdate = true;

	}

	async function setSeed( nextSeed ) {

		if ( ! Number.isInteger( nextSeed ) ) throw new Error( 'AO integration seed must be an integer.' );
		currentSeed = nextSeed >>> 0;
		const normalized = currentSeed / 0xffffffff;
		movingBlock.rotation.set( normalized * 0.4, normalized * Math.PI * 2, normalized * 0.25 );
		await resetHistory( 'seed-change' );

	}

	async function setCamera( id ) {

		if ( id === 'near' ) camera.position.set( 2.1, 1.45, 3.1 );
		else if ( id === 'design' ) camera.position.set( 3.4, 2.2, 5.3 );
		else if ( id === 'far' ) camera.position.set( 5.6, 3.5, 8.4 );
		else throw new Error( `Unknown AO integration camera: ${ id }` );
		camera.lookAt( 0, 0.65, 0 );
		camera.updateMatrixWorld();
		await resetHistory( 'camera-change' );

	}

	async function setTime( seconds ) {

		if ( ! Number.isFinite( seconds ) ) throw new Error( 'AO integration time must be finite.' );
		timeSeconds = seconds;
		movingBlock.position.x = 0.45 + Math.sin( timeSeconds * 0.7 ) * 0.9;
		movingBlock.rotation.y = timeSeconds * 0.35;

	}

	async function step( deltaSeconds ) {

		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'AO integration delta must be finite and nonnegative.' );
		await setTime( timeSeconds + deltaSeconds );

	}

	async function resetHistory() {

		stage.resetTemporalHistory();
		if ( mode === 'temporal-ao' ) host.setOutput( mode, stage.traaNode, { diagnostic: false } );

	}

	async function resize( nextWidth, nextHeight, nextDpr = 1 ) {

		if ( ! Number.isInteger( nextWidth ) || ! Number.isInteger( nextHeight ) || nextWidth < 1 || nextHeight < 1 || ! Number.isFinite( nextDpr ) || nextDpr <= 0 ) throw new Error( 'AO integration extent and DPR must be positive.' );
		width = nextWidth;
		height = nextHeight;
		dpr = nextDpr;
		renderer.setPixelRatio( dpr );
		renderer.setSize( width, height, false );
		presentationTarget.setSize( renderer.domElement.width, renderer.domElement.height );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		await resetHistory( 'resize' );

	}

	async function renderOnce() {

		renderPipeline.render();

	}

	async function capturePixels( target = 'lit-output' ) {

		if ( target === 'presentation' ) {

			const previousTarget = renderer.getRenderTarget();
			try {

				renderer.setRenderTarget( presentationTarget );
				renderPipeline.render();

			} finally {

				renderer.setRenderTarget( previousTarget );

			}
			return {
				...await captureTarget( renderer, presentationTarget, 0 ),
				target,
				format: 'rgba8unorm',
				outputColorSpace: renderer.outputColorSpace,
				bytesPerPixel: 4
			};

		}
		await renderOnce();
		if ( target === 'lit-output' ) return captureTarget( renderer, stage.litScenePass.renderTarget, textureIndex( stage.litScenePass.renderTarget, 'output' ) );
		if ( target === 'gbuffer-output' ) return captureTarget( renderer, stage.gbufferPass.renderTarget, textureIndex( stage.gbufferPass.renderTarget, 'output' ) );
		if ( target === 'normal' ) return captureTarget( renderer, stage.gbufferPass.renderTarget, textureIndex( stage.gbufferPass.renderTarget, 'normal' ) );
		if ( target === 'velocity' ) return captureTarget( renderer, stage.gbufferPass.renderTarget, textureIndex( stage.gbufferPass.renderTarget, 'velocity' ) );
		if ( target === 'raw-ao' ) return captureTarget( renderer, stage.gtaoNode._aoRenderTarget, 0 );
		if ( target === 'denoised-ao' ) return captureTarget( renderer, stage.reconstructedAO.renderTarget, 0 );
		throw new Error( `Unknown AO integration capture target: ${ target }` );

	}

	function describePipeline() {

		const graph = host.describeRuntimeGraph( {
			physicalWidth: Math.round( width * dpr ),
			physicalHeight: Math.round( height * dpr ),
			aoScale: AO_TIERS[ tierId ].resolutionScale,
			temporalEnabled
		} );
		const verdict = validateImagePipelineAOOwnership( graph );
		if ( verdict.valid !== true ) throw new Error( verdict.errors.join( '; ' ) );
		return graph;

	}

	function describeResources() {

		return { resources: describePipeline().resources, physicalResidencyVerdict: 'INSUFFICIENT_EVIDENCE' };

	}

	function getMetrics() {

		return {
			backend: renderer.backend.isWebGPUBackend === true ? 'webgpu' : 'unsupported',
			threeRevision: THREE.REVISION,
			tier: tierId,
			scenario: scenarioId,
			mode,
			seed: currentSeed,
			timeSeconds,
			gpuTiming: { verdict: 'INSUFFICIENT_EVIDENCE', samples: [] },
			rendererInfo: renderer.info
		};

	}

	async function dispose() {

		stage.dispose();
		renderPipeline.dispose();
		presentationTarget.dispose();
		const geometries = new Set();
		const materials = new Set();
		scene.traverse( ( object ) => {

			if ( object.geometry ) geometries.add( object.geometry );
			if ( object.material ) materials.add( object.material );

		} );
		for ( const geometry of geometries ) geometry.dispose();
		for ( const value of materials ) value.dispose();
		renderer.dispose();

	}

	await setTier( initialTier );
	await setScenario( initialScenario );
	await setSeed( seed );
	await setMode( initialMode );

	return {
		ready: async () => {},
		setScenario,
		setMode,
		setTier,
		setSeed,
		setCamera,
		setTime,
		step,
		resetHistory,
		resize,
		renderOnce,
		capturePixels,
		describePipeline,
		describeResources,
		getMetrics,
		dispose,
		renderer,
		renderPipeline,
		scene,
		camera,
		stage,
		host
	};

}
