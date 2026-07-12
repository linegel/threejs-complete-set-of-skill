import {
	ACESFilmicToneMapping,
	AmbientLight,
	BoxGeometry,
	BufferGeometry,
	Color,
	CylinderGeometry,
	DirectionalLight,
	Float32BufferAttribute,
	Mesh,
	MeshStandardNodeMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	WebGPURenderer
} from 'three/webgpu';
import { color } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
	createGpuBoundedSkiffGraph,
	createSkiffMaterialNodes,
	createWaterMaterialNodes
} from './bounded-skiff-webgpu.js';

const canvas = document.querySelector( '#lab-canvas' );
const status = document.querySelector( '#status' );
const backendValue = document.querySelector( '#backend-value' );
const tickValue = document.querySelector( '#tick-value' );
const couplingValue = document.querySelector( '#coupling-value' );
const storageValue = document.querySelector( '#storage-value' );
const motionValue = document.querySelector( '#motion-value' );
const diagnosticsValue = document.querySelector( '#diagnostics-value' );
const captureDiagnosticsButton = document.querySelector( '#capture-diagnostics' );
const cameraButtons = [ ...document.querySelectorAll( '[data-camera]' ) ];
const cameraButtonHandlers = new Map( cameraButtons.map( ( button ) => [ button, () => setCameraFromButton( button ) ] ) );

function setCameraFromButton( button ) {

	window.__THREEJS_LAB__?.setCamera?.( button.dataset.camera );

}
const errorValue = document.querySelector( '#error' );

function closedSkiffHullGeometry() {

	const rings = [
		{ x: -1.55, width: 0.46, bottom: -0.42 },
		{ x: -0.65, width: 0.68, bottom: -0.55 },
		{ x: 0.55, width: 0.62, bottom: -0.50 },
		{ x: 1.55, width: 0.08, bottom: -0.18 }
	];
	const positions = [];
	for ( const ring of rings ) positions.push(
		ring.x, 0.43, ring.width,
		ring.x, ring.bottom, ring.width * 0.24,
		ring.x, ring.bottom, -ring.width * 0.24,
		ring.x, 0.43, -ring.width
	);
	const indices = [];
	for ( let ring = 0; ring < rings.length - 1; ring += 1 ) {

		for ( let side = 0; side < 4; side += 1 ) {

			const nextSide = ( side + 1 ) % 4;
			const a = ring * 4 + side;
			const b = ( ring + 1 ) * 4 + side;
			const c = ( ring + 1 ) * 4 + nextSide;
			const d = ring * 4 + nextSide;
			indices.push( a, b, d, b, c, d );

		}

	}
	indices.push( 0, 1, 3, 1, 2, 3 );
	const last = ( rings.length - 1 ) * 4;
	indices.push( last, last + 3, last + 1, last + 1, last + 3, last + 2 );
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setIndex( indices );
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return geometry;

}

function bakedBox( width, height, depth, x, y, z ) {

	const geometry = new BoxGeometry( width, height, depth );
	geometry.translate( x, y, z );
	return geometry;

}

function bakedCylinder( radius, length, x, y, z, rotationZ = Math.PI * 0.5 ) {

	const geometry = new CylinderGeometry( radius, radius, length, 10 );
	geometry.rotateZ( rotationZ );
	geometry.translate( x, y, z );
	return geometry;

}

function makeSkiffMaterial( graph, hex, roughness, metalness = 0 ) {

	const material = new MeshStandardNodeMaterial();
	const nodes = createSkiffMaterialNodes( graph );
	material.positionNode = nodes.position;
	material.normalNode = nodes.normal;
	material.colorNode = color( hex );
	material.roughness = roughness;
	material.metalness = metalness;
	return material;

}

function addSkiff( scene, graph ) {

	const orange = makeSkiffMaterial( graph, 0xe85722, 0.34 );
	const deck = makeSkiffMaterial( graph, 0xf2dfbb, 0.72 );
	const dark = makeSkiffMaterial( graph, 0x17242a, 0.42, 0.08 );
	const metal = makeSkiffMaterial( graph, 0xa6bbc0, 0.24, 0.72 );
	const parts = [
		new Mesh( closedSkiffHullGeometry(), orange ),
		new Mesh( bakedBox( 2.65, 0.12, 1.05, -0.05, 0.46, 0 ), deck ),
		new Mesh( bakedBox( 0.55, 0.13, 1.02, -0.55, 0.67, 0 ), dark ),
		new Mesh( bakedBox( 0.55, 0.13, 0.98, 0.42, 0.67, 0 ), dark ),
		new Mesh( bakedBox( 0.46, 0.58, 0.52, 0.42, 0.92, 0 ), orange ),
		new Mesh( bakedBox( 0.08, 0.44, 0.62, 0.61, 1.22, 0 ), metal ),
		new Mesh( bakedCylinder( 0.045, 2.8, -0.05, 0.49, 0.67 ), dark ),
		new Mesh( bakedCylinder( 0.045, 2.8, -0.05, 0.49, -0.67 ), dark ),
		new Mesh( bakedBox( 0.30, 0.68, 0.34, -1.56, 0.11, 0 ), dark )
	];
	for ( const part of parts ) {

		part.castShadow = true;
		part.receiveShadow = true;
		part.frustumCulled = false;
		scene.add( part );

	}
	return Object.freeze( {
		parts,
		materials: Object.freeze( [ orange, deck, dark, metal ] ),
		dispose() {

		for ( const part of parts ) part.geometry.dispose();
		for ( const material of [ orange, deck, dark, metal ] ) material.dispose();

		}
	} );

}

async function boot() {

	const renderer = new WebGPURenderer( { canvas, antialias: true } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.08;
	renderer.shadowMap.enabled = true;
	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Native WebGPU backend is required; this route has no fallback.' );

	const scene = new Scene();
	scene.background = new Color( 0x071722 );
	const camera = new PerspectiveCamera( 42, innerWidth / innerHeight, 0.05, 80 );
	camera.position.set( 6.2, 3.8, 6.5 );
	camera.lookAt( 0, 0.15, 0 );
	const controls = new OrbitControls( camera, canvas );
	controls.target.set( 0, 0.05, 0 );
	controls.enableDamping = true;
	controls.minDistance = 3;
	controls.maxDistance = 18;
	controls.maxPolarAngle = Math.PI * 0.48;

	const ambient = new AmbientLight( 0x8cc9e8, 1.6 );
	const sun = new DirectionalLight( 0xffd7a0, 5.4 );
	sun.position.set( 5, 8, 3 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 1024, 1024 );
	sun.shadow.camera.left = -8;
	sun.shadow.camera.right = 8;
	sun.shadow.camera.top = 8;
	sun.shadow.camera.bottom = -8;
	scene.add( ambient, sun );

	const graph = createGpuBoundedSkiffGraph( renderer );
	const waterGeometry = new PlaneGeometry( 18, 18, 96, 96 );
	waterGeometry.rotateX( -Math.PI * 0.5 );
	const waterNodes = createWaterMaterialNodes( graph );
	const waterMaterial = new MeshStandardNodeMaterial();
	waterMaterial.positionNode = waterNodes.position;
	waterMaterial.normalNode = waterNodes.normal;
	waterMaterial.colorNode = waterNodes.color;
	waterMaterial.roughness = 0.18;
	waterMaterial.metalness = 0.05;
	const water = new Mesh( waterGeometry, waterMaterial );
	water.receiveShadow = true;
	water.frustumCulled = false;
	scene.add( water );
	const skiff = addSkiff( scene, graph );

	let paused = false;
	let previousTime = performance.now() * 0.001;
	let disposed = false;
	let lastMotionTick = 0;

	function updateHud() {

		const metrics = graph.describe();
		backendValue.textContent = 'WEBGPU';
		tickValue.textContent = String( metrics.submittedTick );
		couplingValue.textContent = 'TWO-WAY · 2 ITER';
		storageValue.textContent = `${ metrics.storageBytes } B · 0 READBACK`;
		motionValue.textContent = metrics.submittedTick > lastMotionTick ? 'ANIMATING' : paused ? 'PAUSED' : 'WAITING';
		lastMotionTick = metrics.submittedTick;
		status.dataset.state = 'running';

	}

	function frame( milliseconds ) {

		if ( disposed ) return;
		const seconds = milliseconds * 0.001;
		const delta = Math.min( 0.1, Math.max( 0, seconds - previousTime ) );
		previousTime = seconds;
		if ( ! paused ) graph.advancePresentationDelta( delta );
		controls.update();
		renderer.render( scene, camera );
		updateHud();

	}

	function setCamera( cameraId ) {

		const cameras = {
			hero: [ 6.2, 3.8, 6.5 ],
			broadside: [ 0.6, 2.2, 7.8 ],
			overhead: [ 0.2, 10.5, 0.3 ]
		};
		const position = cameras[ cameraId ];
		if ( ! position ) throw new Error( `Unknown camera ${ cameraId }.` );
		camera.position.set( ...position );
		camera.lookAt( controls.target );
		controls.update();

	}

	async function captureDiagnostics() {

		captureDiagnosticsButton.disabled = true;
		captureDiagnosticsButton.textContent = 'READING GPU…';
		try {

			const capture = await graph.captureGpuState();
			const value = capture.values;
			diagnosticsValue.textContent = `h ${ value[ 0 ].toFixed( 3 ) } m · r ${ value[ 1 ].toFixed( 3 ) } · p ${ value[ 2 ].toFixed( 3 ) } · water ${ value[ 8 ].toFixed( 3 ) } m · residual ${ value[ 10 ].toExponential( 1 ) }`;

		} finally {

			captureDiagnosticsButton.disabled = false;
			captureDiagnosticsButton.textContent = 'CAPTURE GPU DIAGNOSTICS';

		}

	}

	function resize() {

		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( innerWidth, innerHeight );

	}

	addEventListener( 'resize', resize );
	captureDiagnosticsButton.addEventListener( 'click', captureDiagnostics );
	for ( const button of cameraButtons ) button.addEventListener( 'click', cameraButtonHandlers.get( button ) );
	renderer.setAnimationLoop( frame );
	updateHud();
	window.__THREEJS_LAB__ = Object.freeze( {
		ready: true,
		getState: () => Object.freeze( { ...graph.describe(), paused, camera: Object.freeze( camera.position.toArray() ) } ),
		captureGpuState: () => graph.captureGpuState(),
		setPaused( value ) { paused = Boolean( value ); },
		setCamera,
		dispose() {

			if ( disposed ) return;
			disposed = true;
			renderer.setAnimationLoop( null );
			removeEventListener( 'resize', resize );
			captureDiagnosticsButton.removeEventListener( 'click', captureDiagnostics );
			for ( const button of cameraButtons ) button.removeEventListener( 'click', cameraButtonHandlers.get( button ) );
			controls.dispose();
			skiff.dispose();
			waterGeometry.dispose();
			waterMaterial.dispose();
			graph.dispose();
			renderer.dispose();

		}
	} );

}

boot().catch( ( error ) => {

	status.dataset.state = 'error';
	errorValue.textContent = error?.stack ?? String( error );
	window.__THREEJS_LAB__ = Object.freeze( { ready: false, error: String( error ) } );

} );
