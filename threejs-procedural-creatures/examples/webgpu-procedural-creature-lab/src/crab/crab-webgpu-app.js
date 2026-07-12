import {
	AmbientLight,
	Color,
	CylinderGeometry,
	DirectionalLight,
	HemisphereLight,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Quaternion,
	Scene,
	SphereGeometry,
	Vector3
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCrabGaitState, createFlatCrabSupportProvider, stepCrabGait } from './crab-gait.js';
import { createCoastalCrabRig } from './crab-rig.js';
import { COASTAL_CRAB_SPEC, CRAB_MORPHOLOGY_PROFILES } from './crab-spec.js';
import { CRAB_RENDER_DECISION, resolveCrabRenderTier, validateCrabGeometryStats } from './crab-render-contract.js';

const canvas = document.getElementById( 'lab-canvas' );
const status = document.getElementById( 'status' );
const params = new URLSearchParams( location.search );
const tierId = params.get( 'tier' ) ?? 'budgeted';
const profileId = params.get( 'profile' ) ?? 'ochre-rock';
const tier = resolveCrabRenderTier( tierId );
const rig = createCoastalCrabRig( profileId );
const slopeRadians = 0.15;
const slopeTangent = Math.tan( slopeRadians );
const support = createFlatCrabSupportProvider( { slopeRadians, waterDepthMeters: 0.04 } );
const gait = createCrabGaitState( { supportProvider: support } );
const profile = rig.profile;
const scene = new Scene();
scene.background = new Color( 0x8fd1e3 );
const camera = new PerspectiveCamera( 34, 1, 0.01, 10 );
camera.position.set( 0.64, 0.48, 0.72 );
camera.lookAt( 0, 0.05, 0 );

const renderer = new WebGPURenderer( { canvas, antialias: true } );
renderer.setPixelRatio( Math.min( devicePixelRatio, tier.dprCap ) );
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = 'srgb';

scene.add( new HemisphereLight( 0xdff7ff, 0x66452f, 1.7 ) );
scene.add( new AmbientLight( 0xffffff, 0.35 ) );
const sun = new DirectionalLight( 0xfff0d0, 3.2 );
sun.position.set( -0.8, 1.3, 0.7 );
sun.castShadow = true;
sun.shadow.mapSize.set( tierId === 'full' ? 2048 : 1024, tierId === 'full' ? 2048 : 1024 );
scene.add( sun );

const sand = new Mesh( new PlaneGeometry( 1.5, 1.1, 1, 1 ), new MeshStandardMaterial( { color: 0xd8b477, roughness: 0.92 } ) );
sand.geometry.rotateX( -Math.PI / 2 );
sand.rotation.z = slopeRadians;
sand.receiveShadow = true;
scene.add( sand );
const water = new Mesh( new PlaneGeometry( 1.6, 0.42 ), new MeshStandardMaterial( { color: 0x168fba, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.72 } ) );
water.geometry.rotateX( -Math.PI / 2 );
water.position.set( 0, -0.018, -0.39 );
scene.add( water );

const shellMaterial = new MeshStandardMaterial( { color: profile.shellColor, roughness: 0.58, metalness: 0.02 } );
const membraneMaterial = new MeshStandardMaterial( { color: profile.membraneColor, roughness: 0.92 } );
const dactylMaterial = new MeshStandardMaterial( { color: new Color( profile.shellColor ).multiplyScalar( 0.72 ), roughness: 0.72 } );
const eyeMaterial = new MeshStandardMaterial( { color: 0x101318, roughness: 0.22 } );

const sphereGeometry = new SphereGeometry( 1, tier.sphereWidth, tier.sphereHeight );
const eyeGeometry = new SphereGeometry( 1, Math.max( 6, Math.floor( tier.sphereWidth / 2 ) ), Math.max( 4, Math.floor( tier.sphereHeight / 2 ) ) );
const segmentGeometry = new CylinderGeometry( 1, 0.78, 1, tier.radialSegments, 1, false );
const carapace = new InstancedMesh( sphereGeometry, shellMaterial, 1 );
const membrane = new InstancedMesh( sphereGeometry, membraneMaterial, 1 );
const eyes = new InstancedMesh( eyeGeometry, eyeMaterial, 2 );
const shellSegments = new InstancedMesh( segmentGeometry, shellMaterial, 24 );
const dactylSegments = new InstancedMesh( segmentGeometry, dactylMaterial, 12 );
for ( const mesh of [ carapace, membrane, eyes, shellSegments, dactylSegments ] ) {

	mesh.instanceMatrix.setUsage( 35048 );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	scene.add( mesh );

}

function geometryCount( geometry ) {

	return { triangles: geometry.index.count / 3, vertices: geometry.attributes.position.count };

}

const sphereCount = geometryCount( sphereGeometry );
const eyeCount = geometryCount( eyeGeometry );
const segmentCount = geometryCount( segmentGeometry );
const geometryStats = Object.freeze( {
	semanticSlots: 40,
	drawFamilies: 5,
	triangles: sphereCount.triangles * 2 + eyeCount.triangles * 2 + segmentCount.triangles * 36,
	vertices: sphereCount.vertices * 2 + eyeCount.vertices * 2 + segmentCount.vertices * 36
} );
validateCrabGeometryStats( tierId, geometryStats );

const matrix = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const quaternion = new Quaternion();
const up = new Vector3( 0, 1, 0 );
const direction = new Vector3();

function setEllipsoid( target, index, center, radii ) {

	position.fromArray( center );
	scale.fromArray( radii );
	quaternion.identity();
	matrix.compose( position, quaternion, scale );
	target.setMatrixAt( index, matrix );

}

function setLink( target, index, start, end, radius ) {

	position.set( ( start[ 0 ] + end[ 0 ] ) * 0.5, ( start[ 1 ] + end[ 1 ] ) * 0.5, ( start[ 2 ] + end[ 2 ] ) * 0.5 );
	direction.set( end[ 0 ] - start[ 0 ], end[ 1 ] - start[ 1 ], end[ 2 ] - start[ 2 ] );
	const length = Math.max( direction.length(), 1e-5 );
	quaternion.setFromUnitVectors( up, direction.multiplyScalar( 1 / length ) );
	scale.set( radius, length, radius );
	matrix.compose( position, quaternion, scale );
	target.setMatrixAt( index, matrix );

}

function visualOffsetForRoot( root ) {

	const loopX = ( ( root[ 0 ] + 0.42 ) % 0.84 ) - 0.42;
	return [ loopX - root[ 0 ], slopeTangent * loopX - root[ 1 ], 0 ];

}

function addOffset( point, offset ) {

	return [ point[ 0 ] + offset[ 0 ], point[ 1 ] + offset[ 1 ], point[ 2 ] + offset[ 2 ] ];

}

function updateCrab( pose ) {

	const offset = visualOffsetForRoot( pose.rootPositionMeters );
	const root = addOffset( pose.rootPositionMeters, offset );
	const carapaceCenter = [ root[ 0 ], root[ 1 ] + 0.061, root[ 2 ] ];
	setEllipsoid( carapace, 0, carapaceCenter, [ 0.09 * profile.carapaceLengthScale, 0.026, 0.0625 * profile.carapaceWidthScale ] );
	setEllipsoid( membrane, 0, [ root[ 0 ], root[ 1 ] + 0.044, root[ 2 ] ], [ 0.076, 0.016, 0.052 ] );
	for ( const [ index, side ] of [ 1, -1 ].entries() ) setEllipsoid( eyes, index, [ root[ 0 ] + 0.061, root[ 1 ] + 0.087, root[ 2 ] + side * 0.029 ], [ 0.008, 0.012, 0.008 ] );

	let shellIndex = 0;
	let dactylIndex = 0;
	for ( const leg of pose.legs ) {

		const hip = addOffset( [ leg.hip[ 0 ] + pose.rootPositionMeters[ 0 ], leg.hip[ 1 ] + pose.rootPositionMeters[ 1 ], leg.hip[ 2 ] ], offset );
		const coxa = addOffset( [ leg.coxaEnd[ 0 ] + pose.rootPositionMeters[ 0 ], leg.coxaEnd[ 1 ] + pose.rootPositionMeters[ 1 ], leg.coxaEnd[ 2 ] ], offset );
		const knee = addOffset( [ leg.knee[ 0 ] + pose.rootPositionMeters[ 0 ], leg.knee[ 1 ] + pose.rootPositionMeters[ 1 ], leg.knee[ 2 ] ], offset );
		const foot = addOffset( leg.footWorld, offset );
		setLink( shellSegments, shellIndex++, hip, coxa, 0.0072 );
		setLink( shellSegments, shellIndex++, coxa, knee, 0.0062 );
		setLink( dactylSegments, dactylIndex++, knee, foot, 0.0046 );

	}
	const opening = pose.clawAngleDegrees * Math.PI / 180;
	for ( const side of [ 1, -1 ] ) {

		const points = [
			[ root[ 0 ] + 0.055, root[ 1 ] + 0.058, side * 0.045 ],
			[ root[ 0 ] + 0.085, root[ 1 ] + 0.057, side * 0.071 ],
			[ root[ 0 ] + 0.112, root[ 1 ] + 0.055, side * 0.088 ],
			[ root[ 0 ] + 0.141, root[ 1 ] + 0.054, side * 0.101 ],
			[ root[ 0 ] + 0.171, root[ 1 ] + 0.054, side * 0.093 ]
		];
		for ( let index = 0; index < 4; index += 1 ) setLink( shellSegments, shellIndex++, points[ index ], points[ index + 1 ], index === 3 ? 0.018 : 0.0085 );
		const fixedEnd = [ points[ 4 ][ 0 ] + 0.044, points[ 4 ][ 1 ] - 0.002, points[ 4 ][ 2 ] - side * 0.018 ];
		const hingedEnd = [ points[ 4 ][ 0 ] + Math.cos( opening ) * 0.042, points[ 4 ][ 1 ] + 0.003, points[ 4 ][ 2 ] + side * Math.sin( opening ) * 0.042 ];
		setLink( dactylSegments, dactylIndex++, points[ 4 ], fixedEnd, 0.0062 );
		setLink( dactylSegments, dactylIndex++, points[ 4 ], hingedEnd, 0.0062 );

	}
	for ( const mesh of [ carapace, membrane, eyes, shellSegments, dactylSegments ] ) mesh.instanceMatrix.needsUpdate = true;

}

const controls = new OrbitControls( camera, canvas );
controls.target.set( 0, 0.055, 0 );
controls.enableDamping = true;
controls.minDistance = 0.28;
controls.maxDistance = 2;

let accumulator = 0;
let priorTime = null;
let frameCount = 0;
let pose = stepCrabGait( gait );

function resize() {

	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if ( canvas.width !== width * renderer.getPixelRatio() || canvas.height !== height * renderer.getPixelRatio() ) renderer.setSize( width, height, false );
	camera.aspect = width / Math.max( height, 1 );
	camera.updateProjectionMatrix();

}

function setCamera( id ) {

	if ( id === 'top' ) camera.position.set( 0, 0.78, 0.001 );
	else if ( id === 'side' ) camera.position.set( 0.62, 0.18, 0.02 );
	else camera.position.set( 0.64, 0.48, 0.72 );
	controls.target.set( 0, 0.055, 0 );
	controls.update();

}

setCamera( params.get( 'camera' ) ?? 'hero' );
addEventListener( 'keydown', ( event ) => {

	if ( event.key === '1' ) setCamera( 'hero' );
	if ( event.key === '2' ) setCamera( 'side' );
	if ( event.key === '3' ) setCamera( 'top' );

} );

async function boot() {

	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'coastal crab canonical route requires native WebGPU' );
	window.__crab = {
		ready: true,
		backend: renderer.backend.constructor.name,
		tier: tierId,
		profile: profileId,
		rig,
		geometryStats,
		representationDecision: CRAB_RENDER_DECISION,
		setCamera,
		setProfile( nextProfile ) { location.search = `?tier=${ tierId }&profile=${ encodeURIComponent( nextProfile ) }`; },
		profiles: CRAB_MORPHOLOGY_PROFILES.map( ( entry ) => entry.id ),
		metrics() { return { tick: gait.tick, stanceCount: pose.stanceCount, swingCount: pose.swingCount, activeGroup: pose.activeGroup, clawAngleDegrees: pose.clawAngleDegrees, support: support.describe(), frameCount }; }
	};
	status.textContent = `WEBGPU · ${ tierId.toUpperCase() } · ${ profileId } · ${ geometryStats.triangles } tris · 40 slots`;
	renderer.setAnimationLoop( ( time ) => {

		resize();
		const dt = priorTime === null ? 1 / 60 : Math.min( ( time - priorTime ) / 1000, 0.1 );
		priorTime = time;
		accumulator += dt;
		while ( accumulator >= COASTAL_CRAB_SPEC.locomotion.fixedTimeStepSeconds ) {

			gait.rootPositionMeters[ 1 ] = slopeTangent * ( gait.rootPositionMeters[ 0 ] + COASTAL_CRAB_SPEC.locomotion.speedMps / 60 );
			const threat = Math.floor( gait.timeSeconds / 2 ) % 2 === 1;
			pose = stepCrabGait( gait, { behavior: threat ? 'threat' : 'lateral-walk' } );
			accumulator -= COASTAL_CRAB_SPEC.locomotion.fixedTimeStepSeconds;

		}
		updateCrab( pose );
		controls.update();
		renderer.render( scene, camera );
		frameCount += 1;
		if ( frameCount % 30 === 0 ) status.textContent = `WEBGPU · ${ tierId.toUpperCase() } · tick ${ gait.tick } · stance ${ pose.stanceCount }/8 · claw ${ pose.clawAngleDegrees }° · ${ geometryStats.triangles } tris`;

	} );

}

boot().catch( ( error ) => {

	status.textContent = `FAILED: ${ error.message }`;
	window.__crab = { ready: false, error: error.message };
	throw error;

} );
