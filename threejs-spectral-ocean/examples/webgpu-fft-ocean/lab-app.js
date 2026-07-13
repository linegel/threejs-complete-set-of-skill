import {
	AgXToneMapping,
	BackSide,
	Color,
	HalfFloatType,
	Mesh,
	MeshBasicNodeMaterial,
	PerspectiveCamera,
	RenderTarget,
	Scene,
	SphereGeometry,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { color } from 'three/tsl';
import {
	bindWebGPUDeviceIdentity,
	captureRuntimeProfileFields,
	markWebGPUDeviceDisposed,
	markWebGPUDeviceDisposing,
	webgpuDeviceIdentityMetrics
} from '../../../labs/runtime/webgpu-device-identity.mjs';
import {
	OCEAN_DEBUG_MODES,
	OCEAN_LAB_MANIFEST,
	OCEAN_MECHANISM_ROUTES,
	OCEAN_QUALITY_TIERS,
	createOceanMesh,
	createOceanRenderPipeline,
	createOceanSurfaceMaterial,
	createCpuWaterHeightSampler,
	createWebGPUFftOcean,
	updateOceanSurfaceMaterial
} from './index.js';

const MECHANISM_STARTUP = Object.freeze( Object.fromEntries(
	OCEAN_LAB_MANIFEST.mechanisms.map( ( mechanism ) => [ mechanism.id, Object.freeze( { ...mechanism.startup } ) ] )
) );

const CAMERA_POSES = Object.freeze( {
	near: { position: [ 3.5, 2.2, 5.5 ], target: [ 0, 0, 0 ] },
	design: { position: [ 16, 11, 22 ], target: [ 0, 0, 0 ] },
	far: { position: [ 40, 28, 52 ], target: [ 0, 0, 0 ] },
	underwater: { position: [ 5.5, - 2.8, 8.5 ], target: [ 0, 0.4, 0 ] }
} );

function routeSelection( pathname, searchParams ) {
	const mechanismMatch = pathname.match( /\/mechanism\/([^/]+)/ );
	const tierMatch = pathname.match( /\/tier\/([^/]+)/ );
	// Capture sessions must not run the free animation loop: it races setTime/rebuild
	// and throws non-finite deltas into pageerror collectors.
	const captureMode = searchParams.get( 'capture' ) === '1';
	return {
		mechanism: mechanismMatch?.[ 1 ] ?? searchParams.get( 'mechanism' ),
		tier: tierMatch?.[ 1 ] ?? searchParams.get( 'tier' ) ?? 'low',
		mode: searchParams.get( 'mode' ),
		seed: searchParams.has( 'seed' ) ? Number( searchParams.get( 'seed' ) ) : 0x00000001,
		animate: ! captureMode && searchParams.get( 'animate' ) !== '0'
	};
}

function alignedBytesPerRow( width, bytesPerTexel ) {
	return Math.ceil( width * bytesPerTexel / 256 ) * 256;
}

function padReadbackRows( pixels, width, height ) {
	if ( ! ( pixels instanceof Uint8Array ) ) throw new Error( 'Ocean RGBA8 capture expected Uint8Array readback.' );
	const rowBytes = width * 4;
	const bytesPerRow = alignedBytesPerRow( width, 4 );
	const tightBytes = rowBytes * height;
	const minimumPaddedBytes = bytesPerRow * ( height - 1 ) + rowBytes;
	if ( pixels.byteLength !== tightBytes && pixels.byteLength < minimumPaddedBytes ) {
		throw new Error( `Ocean readback byte length ${ pixels.byteLength } cannot encode ${ width }x${ height } RGBA8 rows.` );
	}
	const padded = new Uint8Array( bytesPerRow * height );
	const sourceStride = pixels.byteLength === tightBytes ? rowBytes : bytesPerRow;
	for ( let row = 0; row < height; row += 1 ) {
		padded.set( pixels.subarray( row * sourceStride, row * sourceStride + rowBytes ), row * bytesPerRow );
	}
	return { pixels: padded, bytesPerRow };
}

export class OceanLabController {
	constructor( { canvas, selection } ) {
		this.canvas = canvas;
		this.selection = selection;
		this.renderer = null;
		this.scene = null;
		this.camera = null;
		this.pipeline = null;
		this.ocean = null;
		this.surface = null;
		this.time = 0;
		this.seed = selection.seed >>> 0;
		this.tier = selection.tier;
		this.mode = selection.mechanism ? MECHANISM_STARTUP[ selection.mechanism ]?.mode : ( selection.mode ?? 'final' );
		this.cameraId = selection.mechanism ? MECHANISM_STARTUP[ selection.mechanism ]?.camera : 'design';
		this.cpuQueryProbes = [];
		this.cpuProbeMeshes = [];
		this.cpuProbeGeometry = null;
		this.cpuProbeMaterial = null;
		this.disposed = false;
		this._readyPromise = this.initialize();
	}

	async initialize() {
		if ( ! Object.hasOwn( OCEAN_QUALITY_TIERS, this.tier ) ) throw new Error( `Unknown ocean tier "${ this.tier }".` );
		if ( ! Object.hasOwn( OCEAN_DEBUG_MODES, this.mode ) ) throw new Error( `Unknown ocean mode "${ this.mode }".` );
		if ( this.selection.mechanism && ! OCEAN_MECHANISM_ROUTES.includes( this.selection.mechanism ) ) {
			throw new Error( `Unknown ocean mechanism "${ this.selection.mechanism }".` );
		}

			this.renderer = new WebGPURenderer( { canvas: this.canvas, antialias: false, outputBufferType: HalfFloatType } );
			await this.renderer.init();
			if ( this.renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Native WebGPU is required; no alternate renderer is activated.' );
			this.deviceIdentity = bindWebGPUDeviceIdentity( this.renderer );
			this.renderer.toneMapping = AgXToneMapping;
		this.renderer.setPixelRatio( 1 );
		this.renderer.setSize( Math.max( 1, this.canvas.clientWidth ), Math.max( 1, this.canvas.clientHeight ), false );

		this.scene = new Scene();
		this.scene.background = new Color( 0x07111b );
		this.camera = new PerspectiveCamera( 48, 1, 0.05, 1200 );
		this.setCameraPose( this.cameraId );

		const skyMaterial = new MeshBasicNodeMaterial( { side: BackSide, depthWrite: false } );
		skyMaterial.colorNode = color( 0x173a65 );
		const sky = new Mesh( new SphereGeometry( 500, 24, 16 ), skyMaterial );
		sky.name = 'ocean-lab-sky';
		this.scene.add( sky );
		this.sky = sky;

		await this.rebuildOcean();
		this.resize( Math.max( 1, this.canvas.clientWidth ), Math.max( 1, this.canvas.clientHeight ), 1 );
		await this.renderOnce();
		return this;
	}

	ready() {
		return this._readyPromise;
	}

	setCameraPose( id ) {
		const pose = CAMERA_POSES[ id ];
		if ( ! pose ) throw new Error( `Unknown ocean camera "${ id }".` );
		this.cameraId = id;
		this.camera.position.set( ...pose.position );
		this.camera.lookAt( ...pose.target );
		this.camera.updateMatrixWorld( true );
	}

	clearCpuQueryProbes() {
		for ( const mesh of this.cpuProbeMeshes ) this.scene?.remove( mesh );
		this.cpuProbeMeshes = [];
		this.cpuProbeGeometry?.dispose();
		this.cpuProbeMaterial?.dispose();
		this.cpuProbeGeometry = null;
		this.cpuProbeMaterial = null;
		this.cpuQueryProbes = [];
		this.cpuSampler = null;
	}

	refreshCpuQueryProbes() {
		this.clearCpuQueryProbes();
		if ( this.mode !== 'cpu-query' || ! this.ocean ) return;
		this.cpuSampler = createCpuWaterHeightSampler( {
			quality: this.tier,
			seed: this.seed,
			dominantBinCount: 64
		} );
		const queryPoints = [ [ - 12, - 8 ], [ - 5, 6 ], [ 0, 0 ], [ 7, - 4 ], [ 13, 9 ] ];
		this.cpuProbeGeometry = new SphereGeometry( 0.18, 10, 8 );
		this.cpuProbeMaterial = new MeshBasicNodeMaterial();
		this.cpuProbeMaterial.colorNode = color( 0xffd34f );
		const truncation = this.cpuSampler.estimateTruncationError();
		for ( const [ index, [ x, z ] ] of queryPoints.entries() ) {
			const sample = this.cpuSampler.sampleAtWorldXZ( x, z, this.time );
			if ( sample.status !== 'converged' ) continue;
			const marker = new Mesh( this.cpuProbeGeometry, this.cpuProbeMaterial );
			marker.name = `ocean-cpu-query-probe-${ index }`;
			marker.position.set( x, sample.height + 0.22, z );
			this.scene.add( marker );
			this.cpuProbeMeshes.push( marker );
			this.cpuQueryProbes.push( {
				id: marker.name,
				worldXZ: [ x, z ],
				height: sample.height,
				horizontalResidual: sample.horizontalResidual,
				iterations: sample.iterations,
				status: sample.status,
				parameterHeightBound: truncation.parameterHeightBound,
				worldHeightBound: truncation.worldHeightBound
			} );
		}
	}

	updateCpuQueryProbePositions() {
		if ( this.mode !== 'cpu-query' || ! this.cpuSampler ) return;
		for ( let index = 0; index < this.cpuQueryProbes.length; index += 1 ) {
			const record = this.cpuQueryProbes[ index ];
			const sample = this.cpuSampler.sampleAtWorldXZ( record.worldXZ[ 0 ], record.worldXZ[ 1 ], this.time );
			if ( sample.status !== 'converged' ) continue;
			record.height = sample.height;
			record.horizontalResidual = sample.horizontalResidual;
			record.iterations = sample.iterations;
			this.cpuProbeMeshes[ index ].position.y = sample.height + 0.22;
		}
	}

	async rebuildOcean( { replayTime = this.time, replayHistory = true } = {} ) {
		this.clearCpuQueryProbes();
		if ( this.surface ) {
			this.scene.remove( this.surface );
			this.surface.geometry.dispose();
			this.surface.material.dispose();
		}
		this.pipeline?.dispose();
		this.ocean?.dispose();

		this.ocean = await createWebGPUFftOcean( this.renderer, { quality: this.tier, seed: this.seed } );
		const sizeMeters = 180;
		const segments = 192;
		const replayStep = 1 / 60;
		if ( replayHistory ) {
			let replayCursor = 0;
			while ( replayCursor + replayStep <= replayTime + 1e-12 ) {
				replayCursor += replayStep;
				await this.ocean.update( replayCursor, replayStep );
			}
			if ( replayCursor < replayTime ) await this.ocean.update( replayTime, replayTime - replayCursor );
		} else if ( replayTime > 0 ) {
			// A reset samples the current spectrum while retaining the freshly
			// cleared foam histories. dt=0 is correct only for this reset path.
			await this.ocean.update( replayTime, 0 );
		}
		const material = createOceanSurfaceMaterial( this.ocean.materialCascades, {
			debugMode: this.mode,
			geometrySizeMeters: sizeMeters,
			geometrySegments: segments,
			combinedSurface: this.ocean.combinedSurface
		} );
		this.surface = createOceanMesh( material, { sizeMeters, segments } );
		this.scene.add( this.surface );
		this.pipeline = createOceanRenderPipeline( this.renderer, this.scene, this.camera );
		this.refreshCpuQueryProbes();
	}

	async setScenario( id ) {
		if ( id !== 'directional-sea' ) throw new Error( `Unknown ocean scenario "${ id }".` );
		await this.renderOnce();
	}

	async setMode( id ) {
		if ( ! Object.hasOwn( OCEAN_DEBUG_MODES, id ) ) throw new Error( `Unknown ocean mode "${ id }".` );
		this.mode = id;
		updateOceanSurfaceMaterial( this.surface.material, { debugMode: id } );
		this.refreshCpuQueryProbes();
		this.pipeline.outputNode = this.pipeline.scenePass;
		this.pipeline.needsUpdate = true;
		await this.renderOnce();
	}

	async setTier( id ) {
		if ( ! Object.hasOwn( OCEAN_QUALITY_TIERS, id ) ) throw new Error( `Unknown ocean tier "${ id }".` );
		if ( id === this.tier ) return;
		this.tier = id;
		await this.rebuildOcean();
		await this.renderOnce();
	}

	async setSeed( seed ) {
		if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( `Invalid ocean seed "${ seed }".` );
		this.seed = seed >>> 0;
		await this.rebuildOcean();
		await this.renderOnce();
	}

	async setCamera( id ) {
		this.setCameraPose( id );
		await this.renderOnce();
	}

	async setTime( seconds ) {
		if ( ! Number.isFinite( seconds ) || seconds < 0 ) throw new Error( 'Ocean time must be finite and non-negative.' );
		this.time = seconds;
		// Fixed-time captures replay from a cleared history with a fixed 60 Hz
		// integration schedule. Foam therefore cannot depend on the presentation
		// cadence that happened to precede the capture.
		await this.rebuildOcean( { replayTime: seconds } );
		await this.renderOnce();
	}

	async step( deltaSeconds ) {
		if ( this.disposed ) return;
		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'Ocean delta must be finite and non-negative.' );
		this.time += deltaSeconds;
		await this.ocean.update( this.time, deltaSeconds );
		this.surface.material.userData.syncCombinedSurface( this.ocean.combinedSurface );
		this.updateCpuQueryProbePositions();
		this.pipeline.render();
	}

	async resetHistory( cause ) {
		if ( typeof cause !== 'string' || cause.length === 0 ) throw new Error( 'Ocean history reset requires a cause.' );
		await this.rebuildOcean( { replayTime: this.time, replayHistory: false } );
		await this.renderOnce();
	}

	resize( width, height, dpr ) {
		if ( ! [ width, height, dpr ].every( Number.isFinite ) || width < 1 || height < 1 || dpr <= 0 ) throw new Error( 'Invalid ocean resize request.' );
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.viewportDpr = dpr;
		this.renderer.setPixelRatio( dpr );
		this.renderer.setSize( width, height, false );
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	async renderOnce() {
		if ( this.disposed ) throw new Error( 'Ocean lab is disposed.' );
		this.pipeline.render();
	}

	async capturePixels( target = 'final' ) {
		if ( target !== 'final' && ! Object.hasOwn( OCEAN_DEBUG_MODES, target ) ) throw new Error( `Unknown ocean capture target "${ target }".` );
		const previousMode = this.mode;
		const captureMode = target === 'final' ? 'final' : target;
		if ( this.mode !== captureMode ) await this.setMode( captureMode );
		const width = this.renderer.domElement.width;
		const height = this.renderer.domElement.height;
		const renderTarget = new RenderTarget( width, height, { type: UnsignedByteType } );
		const previousTarget = this.renderer.getRenderTarget();
		try {
			this.renderer.setRenderTarget( renderTarget );
			this.pipeline.render();
			const rawPixels = await this.renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height );
			const readback = padReadbackRows( rawPixels, width, height );
			return {
				target,
				width,
				height,
				bytesPerPixel: 4,
				bytesPerRow: readback.bytesPerRow,
				format: 'rgba8',
				colorManaged: true,
				outputColorSpace: 'srgb',
				pixels: readback.pixels
			};
		} finally {
			this.renderer.setRenderTarget( previousTarget );
			renderTarget.dispose();
			if ( this.mode !== previousMode ) await this.setMode( previousMode );
		}
	}

	describePipeline() {
		const dispatches = this.ocean.describeDispatches();
		return {
			...captureRuntimeProfileFields(),
			owners: { renderer: OCEAN_LAB_MANIFEST.id, finalPipeline: OCEAN_LAB_MANIFEST.id, toneMap: OCEAN_LAB_MANIFEST.id, outputColorTransform: OCEAN_LAB_MANIFEST.id },
			signals: [ { id: 'displacement', producer: OCEAN_LAB_MANIFEST.id }, { id: 'derivatives', producer: OCEAN_LAB_MANIFEST.id }, { id: 'jacobian', producer: OCEAN_LAB_MANIFEST.id }, { id: 'shared-foam-history', producer: OCEAN_LAB_MANIFEST.id } ],
			sceneSubmissions: [ { id: 'ocean-scene', kind: 'lit-output', count: 1 } ],
			computeDispatches: dispatches.frameNodes.map( ( name, order ) => ( { name, order, reachable: true } ) ),
			resources: this.describeResources().resources,
			layoutGate: dispatches.layoutGate,
			compiledLayoutGate: dispatches.compiledLayoutGate,
			finalToneMapOwner: OCEAN_LAB_MANIFEST.id,
			finalOutputTransformOwner: OCEAN_LAB_MANIFEST.id
		};
	}

	describeResources() {
		const resources = [ ...this.ocean.describeResources().resources ];
		resources.push( { name: 'ocean-surface-geometry', owner: OCEAN_LAB_MANIFEST.id, kind: 'geometry', bytes: this.surface?.userData.geometryBytes ?? 0, residency: 'allocated-live' } );
		const skyGeometryBytes = this.sky ? Object.values( this.sky.geometry.attributes ).reduce( ( total, attribute ) => total + attribute.array.byteLength, this.sky.geometry.index?.array.byteLength ?? 0 ) : 0;
		resources.push( { name: 'ocean-sky-geometry', owner: OCEAN_LAB_MANIFEST.id, kind: 'geometry', bytes: skyGeometryBytes, residency: 'allocated-live' } );
		for ( const resource of [
			{ name: 'ocean-surface-node-material', kind: 'node-material' },
			{ name: 'ocean-sky-node-material', kind: 'node-material' },
			{ name: 'ocean-final-render-pipeline', kind: 'render-pipeline' },
			{ name: 'ocean-scene-pass', kind: 'scene-pass' },
			{ name: 'ocean-webgpu-renderer', kind: 'renderer' }
		] ) resources.push( { ...resource, owner: OCEAN_LAB_MANIFEST.id, bytes: null, byteStatus: 'backend-allocation-size-not-exposed', residency: 'allocated-live' } );
		const passTarget = this.pipeline?.scenePass?.renderTarget;
		if ( passTarget ) {
			for ( const targetTexture of passTarget.textures ) {
				const bytesPerTexel = targetTexture.type === HalfFloatType ? 8 : 4;
				resources.push( { name: `scene-pass:${ targetTexture.name || 'output' }`, owner: OCEAN_LAB_MANIFEST.id, kind: 'render-target', width: passTarget.width, height: passTarget.height, bytesPerTexel, bytes: passTarget.width * passTarget.height * bytesPerTexel, residency: 'allocated-live' } );
			}
			if ( passTarget.depthTexture ) resources.push( { name: 'scene-pass:depth', owner: OCEAN_LAB_MANIFEST.id, kind: 'depth-target', width: passTarget.width, height: passTarget.height, bytesPerTexel: 4, bytes: passTarget.width * passTarget.height * 4, residency: 'allocated-live' } );
		}
		const countedBytes = resources.reduce( ( total, resource ) => total + ( Number.isFinite( resource.bytes ) ? resource.bytes : 0 ), 0 );
		return {
			resources,
			totalBytes: countedBytes,
			peakLiveBytes: countedBytes,
			unquantifiedResourceCount: resources.filter( ( resource ) => ! Number.isFinite( resource.bytes ) ).length,
			byteAccountingScope: 'all enumerable texture and geometry allocations; backend pipeline/material/renderer allocations inventoried but unquantified'
		};
	}

	getMetrics() {
		const identity = webgpuDeviceIdentityMetrics( this.deviceIdentity, this.renderer );
		// Do not overwrite identity.backend with a non-string object — backendProven()
		// stringifies metrics.backend and rejects anything other than "webgpu"/"webgpubackend".
		return {
			labId: OCEAN_LAB_MANIFEST.id,
			...identity,
			isWebGPUBackend: this.renderer.backend?.isWebGPUBackend === true,
			backendIsWebGPU: this.renderer.backend?.isWebGPUBackend === true,
			threeRevision: '185',
			threePackageVersion: '0.185.1',
			scenario: 'directional-sea',
			tier: this.tier,
			mode: this.mode,
			mechanism: this.selection.mechanism ?? null,
			camera: this.cameraId,
			seed: this.seed,
			time: this.time,
			timeSeconds: this.time,
			viewport: {
				width: this.viewportWidth ?? this.renderer.domElement.clientWidth,
				height: this.viewportHeight ?? this.renderer.domElement.clientHeight,
				dpr: this.viewportDpr ?? this.renderer.getPixelRatio()
			},
			gpuReadback: this.ocean.gpuReadback,
			dispatchesPerFrame: this.ocean.diagnostics.dispatchesPerFrame,
			resourceBytes: this.describeResources().totalBytes,
			geometryBandContract: this.surface.material.userData.geometryBandContract,
			foamFilterContract: this.ocean.combinedSurface.filterContract,
			cpuQueryProbes: this.cpuQueryProbes.map( ( probe ) => ( { ...probe } ) )
		};
	}

	async dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		markWebGPUDeviceDisposing( this.deviceIdentity );
		this.clearCpuQueryProbes();
		this.pipeline?.dispose();
		this.ocean?.dispose();
		this.surface?.geometry.dispose();
		this.surface?.material.dispose();
		this.sky?.geometry.dispose();
		this.sky?.material.dispose();
		this.renderer?.dispose();
		markWebGPUDeviceDisposed( this.deviceIdentity );
	}
}

const status = document.querySelector( '#message' );
const error = document.querySelector( '#error' );
const selection = routeSelection( location.pathname, new URLSearchParams( location.search ) );
const controller = new OceanLabController( { canvas: document.querySelector( '#lab-canvas' ), selection } );
window.__LAB_CONTROLLER__ = controller;
window.__LAB_MANIFEST__ = OCEAN_LAB_MANIFEST;
window.__LAB_STATE__ = { ready: false, error: null };

controller.ready().then( () => {
	window.__LAB_STATE__.ready = true;
	status.textContent = `WebGPU active · tier ${ controller.tier } · mode ${ controller.mode } · GPU readback ${ controller.ocean.gpuReadback.status }`;
	if ( selection.animate ) {
		let previous = performance.now();
		let busy = false;
		const frame = async ( now ) => {
			if ( controller.disposed ) return;
			if ( ! busy ) {
				busy = true;
				try { await controller.step( Math.min( ( now - previous ) / 1000, 1 / 30 ) ); } finally { busy = false; }
			}
			previous = now;
			requestAnimationFrame( frame );
		};
		requestAnimationFrame( frame );
	}
} ).catch( ( cause ) => {
	window.__LAB_STATE__.error = cause instanceof Error ? cause.message : String( cause );
	error.textContent = `\nBLOCKED: ${ window.__LAB_STATE__.error }`;
} );
