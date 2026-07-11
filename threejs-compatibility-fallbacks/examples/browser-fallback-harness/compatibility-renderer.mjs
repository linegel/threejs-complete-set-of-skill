import * as THREE from 'three/webgpu';
import { evaluateBoundedWaterSample } from './fallback-core.mjs';

function displacePlane( geometry, branch, time ) {

	const positions = geometry.attributes.position;
	for ( let index = 0; index < positions.count; index ++ ) {

		const x = positions.getX( index );
		const z = positions.getY( index );
		positions.setZ( index, evaluateBoundedWaterSample( branch, x, z, time ) );

	}
	positions.needsUpdate = true;
	geometry.computeVertexNormals();

}

export async function createCompatibilityRepresentation( container, branch, authorization ) {

	if ( authorization?.explicitRequest !== true ) throw new Error( 'Compatibility renderer requires an explicit request.' );
	if ( authorization?.testedUnavailable !== true ) throw new Error( 'Compatibility renderer requires a tested unavailable-WebGPU condition.' );
	if ( ! [ 'precomputed-static', 'cpu-offline', 'feature-removed', 'maintained-legacy' ].includes( branch ) ) throw new RangeError( `Unknown compatibility branch: ${ branch }` );

	const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: true } );
	await renderer.init();
	if ( renderer.backend.isWebGPUBackend === true ) {

		renderer.dispose();
		throw new Error( 'forceWebGL compatibility renderer unexpectedly initialized a WebGPU backend.' );

	}

	renderer.setPixelRatio( 1 );
	renderer.setSize( 640, 360 );
	renderer.setClearColor( 0x071521, 1 );
	container.replaceChildren( renderer.domElement );

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera( 42, 640 / 360, 0.1, 40 );
	camera.position.set( 4.8, 3.8, 5.6 );
	camera.lookAt( 0, 0, 0 );

	const basin = new THREE.Mesh(
		new THREE.BoxGeometry( 5.8, 0.3, 4.2 ),
		new THREE.MeshBasicMaterial( { color: 0x25313a } )
	);
	basin.position.y = - 0.32;
	scene.add( basin );

	let water = null;
	if ( branch !== 'feature-removed' ) {

		const geometry = new THREE.PlaneGeometry( 5.5, 3.9, 64, 44 );
		displacePlane( geometry, branch, 0.91 );
		water = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial( {
				color: branch === 'precomputed-static' ? 0x2580aa : 0x31a6c8,
				transparent: true,
				opacity: 0.82,
				side: THREE.DoubleSide
			} )
		);
		water.rotation.x = - Math.PI / 2;
		scene.add( water );

	}

	renderer.render( scene, camera );

	return {
		backend: renderer.backend.constructor.name,
		isWebGPUBackend: renderer.backend.isWebGPUBackend === true,
		dispose() {

			water?.geometry.dispose();
			water?.material.dispose();
			basin.geometry.dispose();
			basin.material.dispose();
			renderer.dispose();
			container.replaceChildren();

		}
	};

}
