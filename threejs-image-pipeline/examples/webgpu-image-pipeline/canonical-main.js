import {
	AmbientLight,
	BoxGeometry,
	Color,
	DirectionalLight,
	HalfFloatType,
	Mesh,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	PerspectiveCamera,
	RenderPipeline,
	Scene,
	SphereGeometry,
	Vector2,
	Vector3,
	WebGPURenderer
} from 'three/webgpu';
import {
	color,
	diffuseColor,
	emissive,
	float,
	mrt,
	normalView,
	output,
	pass,
	renderOutput,
	rtt,
	texture,
	uint,
	vec3,
	vec4,
	velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

import { createExposureColorStage } from '../../../threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/stage.js';
import {
	bindWebGPUDeviceIdentity,
	captureRuntimeProfileFields,
	markWebGPUDeviceDisposed,
	markWebGPUDeviceDisposing,
	webgpuDeviceIdentityMetrics,
} from '../../../labs/runtime/webgpu-device-identity.mjs';
import { REVISION } from 'three';

export const IMAGE_PIPELINE_TIERS = Object.freeze( {
	full: Object.freeze( { normal: true, emissive: true, temporal: true, ao: true, bloom: true, exposureTier: 'full-histogram', aoScale: 0.5, bloomScale: 0.5, diagnosticAlbedoPass: false } ),
	reduced: Object.freeze( { normal: false, emissive: true, temporal: false, ao: true, bloom: true, exposureTier: 'balanced-log-reduction', aoScale: 0.5, bloomScale: 0.33, diagnosticAlbedoPass: false } ),
	debug: Object.freeze( { normal: true, emissive: true, temporal: true, ao: true, bloom: true, exposureTier: 'full-histogram', aoScale: 1, bloomScale: 0.5, diagnosticAlbedoPass: true } )
} );

export const IMAGE_PIPELINE_MECHANISM_ROUTES = Object.freeze( {
	'signal-inspector': { tier: 'debug', mode: 'normal' },
	'ao-bloom-exposure-order': { tier: 'full', mode: 'ao' },
	'temporal-velocity-and-history': { tier: 'full', mode: 'temporal-history' },
	'output-and-color-ownership': { tier: 'full', mode: 'final' },
	'resource-budget': { tier: 'debug', mode: 'final' },
	'diagnostic-extra-pass': { tier: 'debug', mode: 'albedo-extra-pass' }
} );

export function resolveImagePipelineRoute( id ) {

	const route = IMAGE_PIPELINE_MECHANISM_ROUTES[ id ];
	if ( ! route ) throw new Error( `Unknown image-pipeline mechanism route "${ id }".` );
	return route;

}

export function resolveImagePipelineTier( id ) {

	const tier = IMAGE_PIPELINE_TIERS[ id ];
	if ( ! tier ) throw new Error( `Unknown image-pipeline tier "${ id }".` );
	return tier;

}

function createNodeMaterial( colorValue, emissiveValue = 0x000000, emissiveIntensity = 0, roughness = 0.5 ) {

	const material = new MeshStandardNodeMaterial( { roughness, metalness: 0 } );
	material.colorNode = color( colorValue );
	material.emissiveNode = color( emissiveValue ).mul( emissiveIntensity );
	return material;

}

export async function createCanonicalImagePipeline( canvas, { tierId = 'full', mode = 'final' } = {} ) {

	const tier = resolveImagePipelineTier( tierId );
	const renderer = new WebGPURenderer( { canvas, antialias: false, outputBufferType: HalfFloatType, trackTimestamp: true } );
	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Canonical image pipeline requires native WebGPU; fallback is not activated.' );
	const deviceIdentity = bindWebGPUDeviceIdentity( renderer );

	const scene = new Scene();
	scene.background = new Color( 0x070b14 );
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
	camera.position.set( 0, 1.3, 5.5 );
	camera.lookAt( 0, 0, 0 );
	const ambient = new AmbientLight( 0x8ea9d6, 0.8 );
	const key = new DirectionalLight( 0xffdfb5, 4 );
	key.position.set( 3, 5, 4 );
	const subject = new Mesh( new BoxGeometry( 1.4, 1.4, 1.4 ), createNodeMaterial( 0x4f8fe8, 0x030814, 1, 0.42 ) );
	const ground = new Mesh( new PlaneGeometry( 12, 12 ), createNodeMaterial( 0x182436, 0x000000, 0, 0.88 ) );
	ground.rotation.x = - Math.PI / 2;
	ground.position.y = - 0.7;
	const emitter = new Mesh( new SphereGeometry( 0.28, 32, 16 ), createNodeMaterial( 0x2a0710, 0xff315f, 9, 0.28 ) );
	emitter.position.set( 1.45, 0.15, - 0.15 );
	scene.add( ambient, key, subject, ground, emitter );
	let currentSeed = 1;
	let seedPhase = 0;
	let seededSubjectZ = 0;
	let viewportWidth = 1;
	let viewportHeight = 1;
	let viewportDpr = 1;

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	const mrtOutputs = { output };
	if ( tier.normal ) mrtOutputs.normal = normalView;
	if ( tier.emissive ) mrtOutputs.emissive = emissive;
	if ( tier.temporal ) mrtOutputs.velocity = velocity;
	scenePass.setMRT( mrt( mrtOutputs ) );
	const hdr = scenePass.getTextureNode( 'output' );
	const depth = scenePass.getTextureNode( 'depth' );
	const viewZ = scenePass.getViewZNode( 'depth' );
	const linearDepth = scenePass.getLinearDepthNode( 'depth' );
	const normalizedViewDistance = viewZ.negate().sub( camera.near ).div( camera.far - camera.near ).clamp( 0, 1 );
	const normal = tier.normal ? scenePass.getTextureNode( 'normal' ) : null;
	const emissiveTexture = tier.emissive ? scenePass.getTextureNode( 'emissive' ) : null;
	const velocityTexture = tier.temporal ? scenePass.getTextureNode( 'velocity' ) : null;
	const aoNode = tier.ao ? ao( depth, normal, camera ) : null;
	if ( aoNode ) aoNode.resolutionScale = tier.aoScale;
	const visibility = aoNode?.getTextureNode().r ?? float( 1 );
	// The stock pass exposes final HDR, not separated direct/indirect radiance.
	// GTAO therefore remains a reachable diagnostic only. The canonical final
	// graph must not darken direct light or emissive with an invented split.
	const stableInput = rtt( hdr, null, null, { type: HalfFloatType, depthBuffer: false } );
	const bloomNode = tier.bloom ? bloom( emissiveTexture ?? hdr ) : null;
	if ( bloomNode ) bloomNode.setResolutionScale( tier.bloomScale );
	const bloomTexture = bloomNode?.getTextureNode() ?? null;
	const albedoPass = tier.diagnosticAlbedoPass ? pass( scene, camera ) : null;
	if ( albedoPass ) albedoPass.setMRT( mrt( { output, albedo: diffuseColor.rgb } ) );
	const albedoTexture = albedoPass?.getTextureNode( 'albedo' ) ?? null;

	let temporalGeneration = 0;
	let resetLog = [];
	let temporalNode = null;
	let temporalTexture = stableInput;
	let temporalHistoryTexture = null;
	let exposureStage = null;
	let finalNode = null;
	let modes = {};
	let currentMode = mode;

	function disposeDynamicGraph() {

		exposureStage?.dispose();
		temporalNode?.dispose?.();
		exposureStage = null;
		temporalNode = null;
		temporalHistoryTexture = null;

	}

	function buildDynamicGraph( cause ) {

		disposeDynamicGraph();
		if ( tier.temporal ) {

			temporalNode = traa( stableInput, depth, velocityTexture, camera );
			temporalTexture = temporalNode.getTextureNode();
			// [Gated: installed r185 TRAANode diagnostics] r185 exposes no public
			// history getter. This version-locked view samples the actual owned
			// history target and is never used by the final graph.
			temporalHistoryTexture = texture( temporalNode._historyRenderTarget.texture );
			temporalGeneration += 1;

		} else temporalTexture = stableInput;
		const preBloom = temporalTexture;
		const hdrComposite = bloomTexture ? vec4( preBloom.rgb.add( bloomTexture.rgb ), preBloom.a ) : preBloom;
		exposureStage = createExposureColorStage( {
			renderer,
			meterSourceTextureNode: preBloom,
			hdrColorNode: hdrComposite,
			tierId: tier.exposureTier
		} );
		finalNode = exposureStage.outputNode;
		const compress = ( value ) => vec4( value.rgb.div( value.rgb.add( 1 ) ), 1 );
		const withDependency = ( value, dependency ) => value.add( dependency.mul( float( 0 ) ) );
		modes = {
			final: finalNode,
			'no-post': renderOutput( hdr ),
			output: compress( hdr ),
			depth: vec4( vec3( depth ), 1 ),
			'view-z': vec4( vec3( normalizedViewDistance.oneMinus() ), 1 ),
			'linear-depth': vec4( vec3( linearDepth.oneMinus() ), 1 ),
			normal: normal ? vec4( normal.xyz.mul( 0.5 ).add( 0.5 ), 1 ) : vec4( vec3( 0 ), 1 ),
			emissive: emissiveTexture ? compress( emissiveTexture ) : vec4( vec3( 0 ), 1 ),
			velocity: velocityTexture ? vec4( velocityTexture.xy.mul( 0.5 ).add( 0.5 ), 0, 1 ) : vec4( vec3( 0 ), 1 ),
			ao: vec4( vec3( visibility ), 1 ),
			bloom: bloomTexture ? compress( bloomTexture ) : vec4( vec3( 0 ), 1 ),
			exposure: withDependency( vec4( vec3( exposureStage.reduction.floatState.element( uint( 0 ) ).z.add( 4 ).div( 8 ).clamp( 0, 1 ) ), 1 ), preBloom ),
			'temporal-current': compress( stableInput ),
			'temporal-history': temporalHistoryTexture ? withDependency( compress( temporalHistoryTexture ), temporalTexture ) : vec4( vec3( 0 ), 1 ),
			'temporal-resolved': tier.temporal ? compress( temporalTexture ) : compress( stableInput ),
			'albedo-extra-pass': albedoTexture ? vec4( albedoTexture.rgb, 1 ) : vec4( vec3( 0 ), 1 )
		};
		if ( ! modes[ currentMode ] ) currentMode = 'final';
		renderPipeline.outputNode = modes[ currentMode ];
		renderPipeline.outputColorTransform = false;
		renderPipeline.needsUpdate = true;
		resetLog.push( { cause, generation: temporalGeneration, freshHistoryRequired: tier.temporal } );

	}

	buildDynamicGraph( 'initialization' );
	// Warm the complete graph through RenderPipeline.render(). In r185,
	// PassNode.compileAsync() compiles only the scene variants and can build
	// NodeMaterial outside the TSL stack used by this MRT graph.

	function setMode( id ) {

		// Builtin capture recipes request no-post/diagnostics display aliases.
		// no-post is a real mode; diagnostics must be a non-final, non-blank view.
		// Prefer temporal-history / normal over raw velocity (often near-flat NDC).
		const resolved = id === 'diagnostics'
			? ( modes[ 'temporal-history' ]
				? 'temporal-history'
				: ( modes.normal ? 'normal' : ( modes.output ? 'output' : 'velocity' ) ) )
			: id;
		if ( ! modes[ resolved ] ) throw new Error( `Unknown or unavailable image-pipeline mode "${ id }".` );
		currentMode = resolved;
		renderPipeline.outputNode = modes[ resolved ];
		renderPipeline.needsUpdate = true;
		return resolved;

	}

	async function resetHistory( cause ) {

		if ( ! cause ) throw new Error( 'History reset requires a cause.' );
		if ( tier.temporal ) buildDynamicGraph( cause );
		else resetLog.push( { cause, generation: 0, status: 'not-applicable' } );
		return resetLog.at( - 1 );

	}

	function resize( width, height, dpr = 1 ) {

		if ( width <= 0 || height <= 0 || dpr <= 0 ) throw new Error( 'Image-pipeline extent and DPR must be positive.' );
		viewportWidth = Math.floor( width );
		viewportHeight = Math.floor( height );
		viewportDpr = dpr;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio( dpr );
		renderer.setSize( viewportWidth, viewportHeight, false );
		if ( tier.temporal ) buildDynamicGraph( 'resize-or-dpr' );

	}

	function setTime( seconds ) {

		subject.position.x = Math.sin( seconds * 0.4 ) * 0.6;
		subject.position.z = seededSubjectZ;
		subject.rotation.y = seconds * 0.3 + seedPhase;
		subject.updateMatrixWorld( true );
		return seconds;

	}

	function setSeed( seed ) {

		if ( seed !== 1 && seed !== 0x9e3779b9 ) throw new Error( `Unsupported image-pipeline seed ${ seed }.` );
		currentSeed = seed >>> 0;
		let hash = currentSeed;
		hash ^= hash >>> 16;
		hash = Math.imul( hash, 0x7feb352d );
		hash ^= hash >>> 15;
		hash = Math.imul( hash, 0x846ca68b );
		hash ^= hash >>> 16;
		const unit = ( hash >>> 0 ) / 0xffffffff;
		seedPhase = ( unit - 0.5 ) * 0.36;
		seededSubjectZ = ( unit - 0.5 ) * 0.5;
		emitter.position.set( 1.1 + unit * 0.7, 0.05 + unit * 0.3, - 0.35 + unit * 0.4 );
		emitter.updateMatrixWorld( true );
		return currentSeed;

	}

	function render( deltaSeconds = 0 ) {

		exposureStage.beforeRender( deltaSeconds );
		renderPipeline.render();
		exposureStage.meterAfterRender();

	}

	function describePipeline() {

		const profileFields = captureRuntimeProfileFields();
		return {
			owners: { renderer: 'canonical-image-pipeline', primaryScenePass: 'scenePass', jitter: tier.temporal ? 'TRAANode' : null, exposure: 'exposure-color-stage', toneMap: 'exposure-color-stage', outputTransform: 'exposure-color-stage' },
			signals: [ 'output', 'depth', ...( tier.normal ? [ 'normal' ] : [] ), ...( tier.emissive ? [ 'emissive' ] : [] ), ...( tier.temporal ? [ 'velocity', 'history' ] : [] ) ],
			sceneSubmissions: [ { id: 'scenePass', count: 1 }, ...( currentMode === 'albedo-extra-pass' ? [ { id: 'albedoDiagnosticPass', count: 1 } ] : [] ) ],
			computeDispatches: [ 'adaptExposureState', ...exposureStage.describe().meterDispatchOrder ],
			dispatchCounts: exposureStage.describe().dispatchCounts,
			depth: {
				rawProducer: 'scenePass.depth',
				viewZProducer: 'scenePass.getViewZNode(depth)',
				linearDepthProducer: 'scenePass.getLinearDepthNode(depth)',
				near: camera.near,
				far: camera.far,
				reversedDepthBuffer: renderer.reversedDepthBuffer === true,
				viewZDiagnosticEncoding: '1 - clamp((-viewZ - near) / (far - near), 0, 1)'
			},
			ao: { node: aoNode ? 'GTAONode' : null, application: 'diagnostic-only', finalReachable: false, reason: 'primary pass does not expose separated indirect radiance' },
			temporal: { node: temporalNode ? 'TRAANode' : null, currentDiagnostic: 'stable-pre-bloom-rtt', historyDiagnostic: temporalHistoryTexture ? 'TRAANode.history' : null, resolvedDiagnostic: temporalNode ? 'TRAANode.resolve' : null, resetStrategy: 'dispose and rebuild TRAANode; first render seeds fresh history' },
			finalToneMapOwner: 'exposure-color-stage/toneMapping()',
			finalOutputTransformOwner: 'exposure-color-stage/renderOutput()',
			tierId,
			mode: currentMode,
			temporalGeneration,
			resetLog: [ ...resetLog ],
			...profileFields,
			// Correctness capture must keep timestamps inactive even if the renderer was created with trackTimestamp.
			timestampQueriesRequired: false,
			timestampQueriesRequested: false,
			timestampQueriesActive: false,
		};

	}

	function describeResources() {

		const drawingBuffer = renderer.getDrawingBufferSize( new Vector2() );
		const attachmentRecords = [
			{ id: 'output', owner: 'scenePass', producer: 'scenePass.getTextureNode(output)', storageClass: 'HalfFloatType color attachment', physicalBytes: null },
			{ id: 'depth', owner: 'scenePass', producer: 'scenePass.getTextureNode(depth)', storageClass: 'backend-selected depth attachment', physicalBytes: null },
			...( tier.normal ? [ { id: 'normal', owner: 'scenePass', producer: 'MRT normalView', storageClass: 'PassNode color attachment', physicalBytes: null } ] : [] ),
			...( tier.emissive ? [ { id: 'emissive', owner: 'scenePass', producer: 'MRT emissive', storageClass: 'PassNode color attachment', physicalBytes: null } ] : [] ),
			...( tier.temporal ? [ { id: 'velocity', owner: 'scenePass', producer: 'MRT velocity', storageClass: 'PassNode color attachment', physicalBytes: null } ] : [] )
		];
		return {
			attachments: [ 'output', 'depth', ...( tier.normal ? [ 'normal' ] : [] ), ...( tier.emissive ? [ 'emissive' ] : [] ), ...( tier.temporal ? [ 'velocity' ] : [] ) ],
			attachmentRecords,
			drawingBuffer: { width: drawingBuffer.x, height: drawingBuffer.y, dpr: renderer.getPixelRatio() },
			persistentPrivateTargets: [
				...( aoNode ? [ { id: 'GTAONode', owner: 'GTAONode', bytes: null, evidence: 'physical allocation requires runtime inventory' } ] : [] ),
				...( bloomNode ? [ { id: 'BloomNode', owner: 'BloomNode', bytes: null, evidence: 'private bright/mip targets require runtime inventory' } ] : [] ),
				...( temporalNode ? [ { id: 'TRAANode.history', owner: 'TRAANode', bytes: null }, { id: 'TRAANode.resolve', owner: 'TRAANode', bytes: null } ] : [] )
			],
			materializedFullscreenTargets: [ { id: 'stable-pre-bloom-rtt', owner: 'canonical-image-pipeline', bytes: null } ],
			exposure: exposureStage.describe(),
			knownStorageBytes: exposureStage.describe().storageBytes.totalBytes,
			physicalResidencyVerdict: 'INSUFFICIENT_EVIDENCE'
		};

	}

	function describeRendererInfo() {

		return {
			backend: renderer.backend?.constructor?.name ?? null,
			isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
			memory: { ...( renderer.info?.memory ?? {} ) },
			render: { ...( renderer.info?.render ?? {} ) },
			compute: { ...( renderer.info?.compute ?? {} ) }
		};

	}

	let disposed = false;
	function dispose() {

		if ( disposed ) return false;
		disposed = true;
		markWebGPUDeviceDisposing( deviceIdentity );
		disposeDynamicGraph();
		stableInput.dispose?.();
		aoNode?.dispose?.();
		bloomNode?.dispose?.();
		albedoPass?.dispose?.();
		scenePass.dispose?.();
		renderPipeline.dispose?.();
		for ( const mesh of [ subject, ground, emitter ] ) { mesh.geometry.dispose(); mesh.material.dispose(); }
		renderer.dispose();
		markWebGPUDeviceDisposed( deviceIdentity );
		return true;

	}

	setSeed( 1 );
	setTime( 0 );
	setMode( mode );
	return {
		renderer,
		renderPipeline,
		scene,
		camera,
		scenePass,
		tierId,
		tier,
		modes: () => Object.keys( modes ),
		setMode,
		resetHistory,
		resize,
		setSeed,
		setTime,
		render,
		describePipeline,
		describeResources,
		readbackExposureState: () => exposureStage.readback(),
		getMetrics: () => {

			// Force correctness-profile timestamp flags for capture-lab-browser (renderer may be constructed with trackTimestamp).
			const identityMetrics = webgpuDeviceIdentityMetrics( deviceIdentity, renderer, { runtimeProfile: 'correctness' } );
			return {
				verdict: 'INSUFFICIENT_EVIDENCE',
				reason: 'Current-adapter timestamp and physical-allocation evidence have not been accepted.',
				seed: currentSeed,
				threeRevision: REVISION,
				...identityMetrics,
				timestampQueriesRequired: false,
				timestampQueriesRequested: false,
				timestampQueriesActive: false,
				viewport: {
					width: viewportWidth,
					height: viewportHeight,
					dpr: viewportDpr,
				},
				rendererInfo: {
					...identityMetrics.rendererInfo,
					...describeRendererInfo(),
				},
				exposure: exposureStage.describe(),
			};

		},
		dispose
	};

}
