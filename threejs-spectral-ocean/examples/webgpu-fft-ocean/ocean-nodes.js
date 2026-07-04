import * as THREE from 'three/webgpu';
import {
	Fn,
	abs,
	cameraPosition,
	dot,
	float,
	fract,
	max,
	mix,
	mrt,
	normalView,
	output,
	pass,
	positionLocal,
	positionWorld,
	pow,
	reflect,
	smoothstep,
	texture,
	uniform,
	vec2,
	vec3,
	vec4,
	normalize
} from 'three/tsl';

import { OCEAN_DEBUG_MODES } from './constants.js';

export const skyRadianceTSL = Fn( ( {
	direction,
	sunDirection,
	sunColor,
	horizonColor,
	zenithColor
} ) => {
	const vertical = smoothstep( - 0.05, 0.4, direction.y );
	const gradient = mix( horizonColor, zenithColor, vertical );
	const sunAlignment = max( dot( direction, sunDirection ), 0.0 );
	const disc = sunColor.mul( pow( sunAlignment, 1200.0 ) ).mul( 8.0 );
	const halo = sunColor.mul( pow( sunAlignment, 7.0 ) ).mul( 0.35 );
	return gradient.add( disc ).add( halo );
} );

function sampleCascade( textureMap, xz, patchLength ) {
	return texture( textureMap, fract( xz.div( patchLength ) ) );
}

function addSampledCascades( cascades, textureName, xz ) {
	let value = vec4( 0, 0, 0, 0 );
	for ( const cascade of cascades ) {
		value = value.add( sampleCascade( cascade[ textureName ], xz, cascade.patchLength ) );
	}
	return value;
}

function buildFoamCoverage( cascades, xz, foamThreshold, foamScale ) {
	let foam = float( 0 );
	for ( const cascade of cascades.slice( 0, 2 ) ) {
		const displacement = sampleCascade( cascade.displacementTexture, xz, cascade.patchLength );
		foam = foam.add( max( foamThreshold.sub( displacement.a ).mul( foamScale ), 0.0 ) );
	}
	return smoothstep( 0.2, 0.9, foam );
}

export function createOceanSurfaceMaterial( cascades, {
	sunDirection = new THREE.Vector3( - 0.42, 0.62, 0.66 ).normalize(),
	debugMode = 'final'
} = {} ) {
	const sunDirectionNode = uniform( sunDirection.clone().normalize() );
	const sunColorNode = uniform( new THREE.Color( 0xfff1dc ) );
	const horizonColorNode = uniform( new THREE.Color( 0x9fb8cc ) );
	const zenithColorNode = uniform( new THREE.Color( 0x2a5b9c ) );
	const deepColorNode = uniform( new THREE.Color( 0x071a26 ) );
	const scatterColorNode = uniform( new THREE.Color( 0x2e8f8f ) );
	const foamColorNode = uniform( new THREE.Color( 0xdce7ea ) );
	const foamThresholdNode = uniform( 0.4 );
	const foamScaleNode = uniform( 2.5 );
	const debugModeNode = uniform( OCEAN_DEBUG_MODES[ debugMode ] ?? OCEAN_DEBUG_MODES.final );

	const xz = positionLocal.xz;
	const displacement = addSampledCascades( cascades, 'displacementTexture', xz );
	const derivatives = addSampledCascades( cascades, 'derivativesTexture', xz );
	const crossJacobian = addSampledCascades( cascades, 'crossJacobianFoamTexture', xz );
	const displacedPosition = positionLocal.add( vec3( displacement.x, displacement.y, displacement.z ) );
	const denominatorX = max( float( 0.18 ), float( 1.0 ).add( derivatives.z ) );
	const denominatorZ = max( float( 0.18 ), float( 1.0 ).add( derivatives.w ) );
	const resolvedNormal = normalize( vec3(
		derivatives.x.negate().div( denominatorX ),
		1.0,
		derivatives.y.negate().div( denominatorZ )
	) );
	const viewDirection = normalize( cameraPosition.sub( positionWorld ) );
	const fresnel = float( 0.02 ).add( float( 0.98 ).mul( pow( float( 1.0 ).sub( max( dot( resolvedNormal, viewDirection ), 0.0 ) ), 5.0 ) ) );
	const reflectedDirection = normalize( reflect( viewDirection.negate(), resolvedNormal ) );
	const reflection = skyRadianceTSL( {
		direction: reflectedDirection,
		sunDirection: sunDirectionNode,
		sunColor: sunColorNode,
		horizonColor: horizonColorNode,
		zenithColor: zenithColorNode
	} );
	const crest = smoothstep( - 0.1, 1.1, displacement.y );
	const halfVector = normalize( sunDirectionNode.add( viewDirection ) );
	const scatter = pow( max( dot( resolvedNormal, halfVector ), 0.0 ), 4.0 ).mul( crest );
	const body = mix( deepColorNode, scatterColorNode, scatter.add( 0.12 ).clamp( 0.0, 1.0 ) );
	const water = mix( body, reflection, fresnel );
	const foamCoverage = buildFoamCoverage( cascades, xz, foamThresholdNode, foamScaleNode );
	const foamLight = float( 0.55 ).add( float( 0.6 ).mul( max( dot( resolvedNormal, sunDirectionNode ), 0.0 ) ) );
	const shadedFoam = foamColorNode.mul( foamLight );
	const finalColor = mix( water, shadedFoam, foamCoverage );

	const heightDebug = vec3( abs( displacement.y ).mul( 0.18 ) );
	const displacementDebug = vec3( abs( displacement.x ), abs( displacement.y ), abs( displacement.z ) ).mul( 0.25 );
	const slopesDebug = vec3( derivatives.x.abs(), derivatives.y.abs(), crossJacobian.x.abs() ).mul( 0.5 );
	const jacobianDebug = mix( vec3( 0.95, 0.18, 0.05 ), vec3( 0.04, 0.12, 0.18 ), crossJacobian.y.clamp( 0.0, 1.0 ) );
	const foamDebug = vec3( foamCoverage );
	const normalDebug = resolvedNormal.mul( 0.5 ).add( 0.5 );
	let colorNode = finalColor;
	colorNode = mix( colorNode, heightDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.height ) );
	colorNode = mix( colorNode, displacementDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.displacement ) );
	colorNode = mix( colorNode, slopesDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.slopes ) );
	colorNode = mix( colorNode, jacobianDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.jacobian ) );
	colorNode = mix( colorNode, foamDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.foam ) );
	colorNode = mix( colorNode, normalDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.normal ) );

	const material = new THREE.MeshStandardNodeMaterial( {
		side: THREE.DoubleSide,
		roughness: 0.03,
		metalness: 0.0
	} );
	material.positionNode = displacedPosition;
	material.normalNode = resolvedNormal;
	material.colorNode = colorNode;
	material.roughnessNode = float( 0.035 );
	material.metalnessNode = float( 0.0 );
	material.userData.oceanUniforms = {
		sunDirectionNode,
		debugModeNode,
		foamThresholdNode,
		foamScaleNode
	};

	return material;
}

export function createOceanSkyMaterial( {
	sunDirection = new THREE.Vector3( - 0.42, 0.62, 0.66 ).normalize()
} = {} ) {
	const sunDirectionNode = uniform( sunDirection.clone().normalize() );
	const material = new THREE.MeshBasicNodeMaterial( {
		side: THREE.BackSide,
		depthWrite: false
	} );
	material.colorNode = skyRadianceTSL( {
		direction: normalize( positionLocal ),
		sunDirection: sunDirectionNode,
		sunColor: uniform( new THREE.Color( 0xfff1dc ) ),
		horizonColor: uniform( new THREE.Color( 0x9fb8cc ) ),
		zenithColor: uniform( new THREE.Color( 0x2a5b9c ) )
	} );
	material.userData.oceanUniforms = { sunDirectionNode };
	return material;
}

export function updateOceanSurfaceMaterial( material, {
	debugMode,
	sunDirection,
	foamThreshold,
	foamScale
} = {} ) {
	const uniforms = material.userData.oceanUniforms;
	if ( ! uniforms ) return;
	if ( debugMode !== undefined ) uniforms.debugModeNode.value = OCEAN_DEBUG_MODES[ debugMode ] ?? OCEAN_DEBUG_MODES.final;
	if ( sunDirection ) uniforms.sunDirectionNode.value.copy( sunDirection ).normalize();
	if ( foamThreshold !== undefined ) uniforms.foamThresholdNode.value = foamThreshold;
	if ( foamScale !== undefined ) uniforms.foamScaleNode.value = foamScale;
}

export function createOceanMesh( material, {
	sizeMeters = 400,
	segments = 384
} = {} ) {
	const geometry = new THREE.PlaneGeometry( sizeMeters, sizeMeters, segments, segments );
	geometry.rotateX( - Math.PI / 2 );
	return new THREE.Mesh( geometry, material );
}

export function createOceanRenderPipeline( renderer, scene, camera, {
	enableMrt = true
} = {} ) {
	const pipeline = new THREE.RenderPipeline( renderer );
	const scenePass = pass( scene, camera );

	if ( enableMrt ) {
		scenePass.setMRT( mrt( {
			output,
			normal: normalView
		} ) );
		pipeline.outputNode = scenePass.getTextureNode( 'output' );
	} else {
		pipeline.outputNode = scenePass;
	}

	pipeline.outputColorTransform = true;
	return pipeline;
}
