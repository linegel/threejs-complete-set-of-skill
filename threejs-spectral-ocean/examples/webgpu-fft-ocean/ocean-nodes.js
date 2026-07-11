import * as THREE from 'three/webgpu';
import {
	Fn,
	abs,
	cameraPosition,
	clamp,
	dFdx,
	dFdy,
	dot,
	exp,
	float,
	fract,
	length,
	max,
	mix,
	modelNormalMatrix,
	mrt,
	normalView,
	output,
	pass,
	positionGeometry,
	positionWorld,
	pow,
	reflect,
	refract,
	select,
	smoothstep,
	texture,
	uniform,
	vec2,
	vec3,
	vec4,
	normalize
} from 'three/tsl';

import { OCEAN_DEBUG_MODES, OCEAN_EXAMPLE_CLAIM_BOUNDARY } from './constants.js';

function resolveOceanDebugMode( mode ) {
	if ( typeof mode === 'number' && Object.values( OCEAN_DEBUG_MODES ).includes( mode ) ) return mode;
	if ( typeof mode === 'string' && Object.hasOwn( OCEAN_DEBUG_MODES, mode ) ) return OCEAN_DEBUG_MODES[ mode ];
	throw new Error( `Unknown ocean debug mode "${ mode }".` );
}

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

function partitionGeometryBands( cascades, sizeMeters, segments, nyquistSafety ) {
	if ( ! Number.isFinite( sizeMeters ) || sizeMeters <= 0 || ! Number.isInteger( segments ) || segments < 1 ) {
		throw new Error( 'Ocean geometry-band partition requires positive size and segment counts.' );
	}
	if ( ! Number.isFinite( nyquistSafety ) || nyquistSafety <= 0 || nyquistSafety > 1 ) {
		throw new Error( 'Ocean geometry Nyquist safety must be in (0,1].' );
	}
	const nyquist = Math.PI * segments / sizeMeters;
	const resolved = cascades.filter( ( cascade ) => cascade.cutoffHigh <= nyquist * nyquistSafety + 1e-9 );
	if ( resolved.length === 0 ) {
		throw new Error( `Ocean mesh resolves no complete cascade: safe Nyquist=${ nyquist * nyquistSafety } rad/m.` );
	}
	const resolvedSet = new Set( resolved );
	return {
		nyquist,
		safeNyquist: nyquist * nyquistSafety,
		resolved,
		detail: cascades.filter( ( cascade ) => ! resolvedSet.has( cascade ) )
	};
}

function exactDielectricFresnelTSL( cosIncident, incidentIor, transmittedIor ) {
	const eta = incidentIor.div( transmittedIor );
	const sinTransmittedSquared = eta.mul( eta ).mul( float( 1 ).sub( cosIncident.mul( cosIncident ) ) );
	const transmissionPossible = sinTransmittedSquared.lessThanEqual( 1 );
	const cosTransmitted = max( float( 1 ).sub( sinTransmittedSquared ), 0 ).sqrt();
	const rs = incidentIor.mul( cosIncident ).sub( transmittedIor.mul( cosTransmitted ) )
		.div( max( incidentIor.mul( cosIncident ).add( transmittedIor.mul( cosTransmitted ) ), 1e-6 ) );
	const rp = transmittedIor.mul( cosIncident ).sub( incidentIor.mul( cosTransmitted ) )
		.div( max( transmittedIor.mul( cosIncident ).add( incidentIor.mul( cosTransmitted ) ), 1e-6 ) );
	return vec3(
		select( transmissionPossible, rs.mul( rs ).add( rp.mul( rp ) ).mul( 0.5 ), float( 1 ) ),
		select( transmissionPossible, float( 1 ), float( 0 ) ),
		cosTransmitted
	);
}

export function createOceanSurfaceMaterial( cascades, {
	sunDirection = new THREE.Vector3( - 0.42, 0.62, 0.66 ).normalize(),
	debugMode = 'final',
	geometrySizeMeters = 400,
	geometrySegments = 384,
	geometryNyquistSafety = 0.8,
	combinedSurface = null,
	opticalComposer = null
} = {} ) {
	if ( ! Array.isArray( cascades ) || cascades.length === 0 ) throw new Error( 'Ocean material requires at least one cascade.' );
	const bandPartition = partitionGeometryBands( cascades, geometrySizeMeters, geometrySegments, geometryNyquistSafety );
	const vertexDisplacementCascades = bandPartition.resolved;
	const detailNormalCascades = bandPartition.detail;
	const sunDirectionNode = uniform( sunDirection.clone().normalize() );
	const sunColorNode = uniform( new THREE.Color( 0xfff1dc ) );
	const horizonColorNode = uniform( new THREE.Color( 0x9fb8cc ) );
	const zenithColorNode = uniform( new THREE.Color( 0x2a5b9c ) );
	const deepColorNode = uniform( new THREE.Color( 0x071a26 ) );
	const scatterColorNode = uniform( new THREE.Color( 0x2e8f8f ) );
	const foamColorNode = uniform( new THREE.Color( 0xdce7ea ) );
	const foamThresholdNode = uniform( 0.4 );
	const foamScaleNode = uniform( 2.5 );
	const debugModeNode = uniform( resolveOceanDebugMode( debugMode ) );
	const absorptionNode = uniform( new THREE.Vector3( 0.18, 0.075, 0.035 ) );

	// Base local XZ is the periodic parameter coordinate. positionWorld would
	// depend on positionNode and create a displacement-sampling cycle.
	const xz = positionGeometry.xz;
	const foamTextureNodes = ( combinedSurface?.cascades ?? [] )
		.filter( ( cascade ) => cascade.foamHistoryTexture )
		.map( ( cascade ) => ( {
			index: cascade.index,
			patchLength: cascade.patchLength,
			textureNode: texture( cascade.foamHistoryTexture )
		} ) );
	const vertexDisplacement = addSampledCascades( vertexDisplacementCascades, 'displacementTexture', xz );
	const derivatives = addSampledCascades( vertexDisplacementCascades, 'derivativesTexture', xz );
	const crossJacobian = addSampledCascades( vertexDisplacementCascades, 'crossJacobianFoamTexture', xz );
	const displacedPosition = positionGeometry.add( vec3( vertexDisplacement.x, vertexDisplacement.y, vertexDisplacement.z ) );
	const tangentA = float( 1.0 ).add( derivatives.z );
	const tangentB = crossJacobian.x;
	const tangentC = float( 1.0 ).add( derivatives.w );
	const combinedJacobian = tangentA.mul( tangentC ).sub( tangentB.mul( tangentB ) );
	const resolvedNormalLocal = normalize( vec3(
		derivatives.y.mul( tangentB ).sub( tangentC.mul( derivatives.x ) ),
		combinedJacobian,
		tangentB.mul( derivatives.x ).sub( derivatives.y.mul( tangentA ) )
	) );
	const resolvedNormalWorld = normalize( modelNormalMatrix.mul( resolvedNormalLocal ) );
	const footprint = max( length( dFdx( positionWorld.xz ) ), length( dFdy( positionWorld.xz ) ) );
	let detailSlope = vec2( 0, 0 );
	for ( const cascade of detailNormalCascades ) {
		const sample = sampleCascade( cascade.derivativesTexture, xz, cascade.patchLength );
		const lowPass = float( 1 ).sub( smoothstep( Math.PI * 0.5, Math.PI, footprint.mul( cascade.cutoffHigh ) ) );
		detailSlope = detailSlope.add( sample.xy.mul( lowPass ) );
	}
	const shadingNormalLocal = normalize( resolvedNormalLocal.add( vec3( detailSlope.x.negate(), 0, detailSlope.y.negate() ) ) );
	const shadingNormalWorld = normalize( modelNormalMatrix.mul( shadingNormalLocal ) );
	const viewDirection = normalize( cameraPosition.sub( positionWorld ) );
	const underwater = dot( resolvedNormalWorld, viewDirection ).lessThan( 0 );
	const interfaceNormal = select( underwater, shadingNormalWorld.negate(), shadingNormalWorld );
	const incidentIor = select( underwater, float( 1.333 ), float( 1.0 ) );
	const transmittedIor = select( underwater, float( 1.0 ), float( 1.333 ) );
	const eta = incidentIor.div( transmittedIor );
	const cosIncident = clamp( dot( interfaceNormal, viewDirection ), 0, 1 );
	const fresnelTerms = exactDielectricFresnelTSL( cosIncident, incidentIor, transmittedIor );
	const fresnel = fresnelTerms.x;
	const transmissionPossible = fresnelTerms.y;
	const reflectedDirection = normalize( reflect( viewDirection.negate(), interfaceNormal ) );
	const reflection = skyRadianceTSL( {
		direction: reflectedDirection,
		sunDirection: sunDirectionNode,
		sunColor: sunColorNode,
		horizonColor: horizonColorNode,
		zenithColor: zenithColorNode
	} );
	const rawRefracted = refract( viewDirection.negate(), interfaceNormal, eta );
	const refractedDirection = rawRefracted.div( max( length( rawRefracted ), 1e-6 ) );
	const refractedSky = skyRadianceTSL( {
		direction: refractedDirection,
		sunDirection: sunDirectionNode,
		sunColor: sunColorNode,
		horizonColor: horizonColorNode,
		zenithColor: zenithColorNode
	} );
	const crest = smoothstep( - 0.1, 1.1, vertexDisplacement.y );
	const halfVector = normalize( sunDirectionNode.add( viewDirection ) );
	const scatter = pow( max( dot( shadingNormalWorld, halfVector ), 0.0 ), 4.0 ).mul( crest );
	const body = mix( deepColorNode, scatterColorNode, scatter.add( 0.12 ).clamp( 0.0, 1.0 ) );
	const pathLength = select(
		underwater,
		abs( cameraPosition.y.sub( positionWorld.y ) ).div( max( abs( refractedDirection.y ), 0.05 ) ).clamp( 0, 50 ),
		float( 1.25 )
	);
	const transmission = exp( absorptionNode.mul( pathLength.negate() ) );
	const transmittedRadiance = select( underwater, refractedSky, body );
	const transported = transmission.mul( transmittedRadiance ).add( float( 1 ).sub( transmission ).mul( scatterColorNode ) );
	const water = reflection.mul( fresnel ).add( transported.mul( float( 1 ).sub( fresnel ) ) );
	let unfoamedFraction = float( 1 );
	let accumulatedFoamSource = float( 0 );
	for ( const cascade of foamTextureNodes ) {
		const sample = cascade.textureNode.sample( fract( xz.div( cascade.patchLength ) ) );
		unfoamedFraction = unfoamedFraction.mul( float( 1 ).sub( sample.r.clamp( 0, 1 ) ) );
		accumulatedFoamSource = accumulatedFoamSource.add( max( sample.g, 0 ) );
	}
	const instantaneousFoamSource = max( foamThresholdNode.sub( combinedJacobian ).mul( foamScaleNode ), 0 );
	const foamCoverage = foamTextureNodes.length > 0
		? float( 1 ).sub( unfoamedFraction ).clamp( 0, 1 )
		: smoothstep( 0.2, 0.9, instantaneousFoamSource );
	const foamSource = foamTextureNodes.length > 0 ? accumulatedFoamSource : instantaneousFoamSource;
	const foamLight = float( 0.55 ).add( float( 0.6 ).mul( max( dot( shadingNormalWorld, sunDirectionNode ), 0.0 ) ) );
	const shadedFoam = foamColorNode.mul( foamLight );
	const opticalInputs = {
		parameterXZ: xz,
		displacement: vertexDisplacement,
		derivatives,
		crossDerivative: tangentB,
		jacobian: combinedJacobian,
		normalWorld: shadingNormalWorld,
		foamCoverage,
		reflection,
		bodyRadiance: body,
		defaultWaterRadiance: water,
		defaultFoamRadiance: shadedFoam
	};
	const finalColor = typeof opticalComposer === 'function'
		? opticalComposer( opticalInputs )
		: mix( water, shadedFoam, foamCoverage );

	const heightDebug = vec3( abs( vertexDisplacement.y ).mul( 0.18 ) );
	const displacementDebug = vec3( abs( vertexDisplacement.x ), abs( vertexDisplacement.y ), abs( vertexDisplacement.z ) ).mul( 0.25 );
	const slopesDebug = vec3( derivatives.x.abs(), derivatives.y.abs(), crossJacobian.x.abs() ).mul( 0.5 );
	const jacobianDebug = mix( vec3( 0.95, 0.18, 0.05 ), vec3( 0.04, 0.12, 0.18 ), combinedJacobian.clamp( 0.0, 1.0 ) );
	const foamDebug = vec3( foamCoverage, foamSource.mul( 0.1 ).clamp( 0, 1 ), combinedJacobian.clamp( 0, 1 ) );
	const normalDebug = shadingNormalWorld.mul( 0.5 ).add( 0.5 );
	const firstCascadeUv = fract( xz.div( cascades[ 0 ].patchLength ).add( 0.5 ) );
	const spectrumSample = texture( cascades[ 0 ].spectrumTexture, firstCascadeUv );
	const fftSample = texture( cascades[ 0 ].fftHeightTexture, firstCascadeUv );
	const spectrumFftDebug = vec3( pow( abs( spectrumSample.x ), 0.25 ), pow( abs( spectrumSample.y ), 0.25 ), abs( fftSample.x ).mul( 0.12 ) ).clamp( 0, 1 );
	const cascadePalette = [ vec3( 0.95, 0.28, 0.08 ), vec3( 0.08, 0.75, 0.95 ), vec3( 0.72, 0.18, 0.95 ) ];
	let cascadeDebug = vec3( 0, 0, 0 );
	for ( const [ index, cascade ] of cascades.entries() ) {
		cascadeDebug = cascadeDebug.add( cascadePalette[ index ].mul( abs( sampleCascade( cascade.displacementTexture, xz, cascade.patchLength ).y ).mul( 0.35 ) ) );
	}
	const underwaterOpticsDebug = mix(
		water,
		vec3( fresnel, float( 1 ).sub( transmissionPossible ), transmission.x.add( transmission.y ).add( transmission.z ).div( 3 ) ),
		smoothstep( - 0.1, 0.1, xz.x )
	);
	const diagnosticsTop = mix( spectrumFftDebug, cascadeDebug, smoothstep( - 0.1, 0.1, xz.x ) );
	const diagnosticsBottom = mix( jacobianDebug, foamDebug, smoothstep( - 0.1, 0.1, xz.x ) );
	const diagnosticsMosaic = mix( diagnosticsBottom, diagnosticsTop, smoothstep( - 0.1, 0.1, xz.y ) );
	const cpuQueryDebug = mix( vec3( 0.025, 0.06, 0.09 ), normalDebug, 0.35 );
	let colorNode = finalColor;
	colorNode = mix( colorNode, heightDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.height ) );
	colorNode = mix( colorNode, displacementDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.displacement ) );
	colorNode = mix( colorNode, slopesDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.slopes ) );
	colorNode = mix( colorNode, jacobianDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.jacobian ) );
	colorNode = mix( colorNode, foamDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.foam ) );
	colorNode = mix( colorNode, normalDebug, debugModeNode.equal( OCEAN_DEBUG_MODES.normal ) );
	colorNode = mix( colorNode, spectrumFftDebug, debugModeNode.equal( OCEAN_DEBUG_MODES[ 'spectrum-fft' ] ) );
	colorNode = mix( colorNode, cascadeDebug, debugModeNode.equal( OCEAN_DEBUG_MODES[ 'cascade-bands' ] ) );
	colorNode = mix( colorNode, underwaterOpticsDebug, debugModeNode.equal( OCEAN_DEBUG_MODES[ 'underwater-optics' ] ) );
	colorNode = mix( colorNode, cpuQueryDebug, debugModeNode.equal( OCEAN_DEBUG_MODES[ 'cpu-query' ] ) );
	colorNode = mix( colorNode, transported, debugModeNode.equal( OCEAN_DEBUG_MODES[ 'no-post' ] ) );
	colorNode = mix( colorNode, diagnosticsMosaic, debugModeNode.equal( OCEAN_DEBUG_MODES.diagnostics ) );

	const material = new THREE.MeshBasicNodeMaterial( {
		side: THREE.DoubleSide,
		transparent: false,
		depthWrite: true
	} );
	material.positionNode = displacedPosition;
	material.colorNode = colorNode;
	material.userData.oceanUniforms = {
		sunDirectionNode,
		debugModeNode,
		foamThresholdNode,
		foamScaleNode
	};
	material.userData.claimBoundary = OCEAN_EXAMPLE_CLAIM_BOUNDARY;
	material.userData.requiredObjectTransform = 'identity rotation and scale; displacement is authored in the world-aligned XZ frame';
	material.userData.vertexDisplacementCascadeCount = vertexDisplacementCascades.length;
	material.userData.vertexMaxWavenumber = Math.max( ...vertexDisplacementCascades.map( ( cascade ) => cascade.cutoffHigh ?? Infinity ) );
	material.userData.geometryBandContract = {
		sizeMeters: geometrySizeMeters,
		segments: geometrySegments,
		nyquistSafety: geometryNyquistSafety,
		nyquist: bandPartition.nyquist,
		safeNyquist: bandPartition.safeNyquist,
		resolvedCascadeIndices: vertexDisplacementCascades.map( ( cascade ) => cascade.index ),
		detailCascadeIndices: detailNormalCascades.map( ( cascade ) => cascade.index )
	};
	material.userData.subGridShading = 'native-resolution per-cascade slope samples with a fragment-footprint Nyquist fade; geometric normal uses only the same complete bands as vertex displacement';
	material.userData.combinedSurface = combinedSurface;
	material.userData.oceanOpticalHandoff = opticalInputs;
	material.userData.syncCombinedSurface = ( nextCombinedSurface ) => {
		if ( ! nextCombinedSurface ) return;
		for ( const binding of foamTextureNodes ) {
			const next = nextCombinedSurface.cascades?.find( ( cascade ) => cascade.index === binding.index );
			if ( next?.foamHistoryTexture ) binding.textureNode.value = next.foamHistoryTexture;
		}
		material.userData.combinedSurface = nextCombinedSurface;
	};
	material.userData.oceanDiagnosticNodes = {
		sampleSpace: 'parameter-xz-per-cascade-native-resolution',
		resolvedGeometricNormal: resolvedNormalWorld,
		shadingNormal: shadingNormalWorld,
		subGridNormalContribution: detailSlope,
		finalWithoutFoam: water,
		finalWithoutDetail: transported,
		spectrumFft: spectrumFftDebug,
		cascadeBands: cascadeDebug,
		underwaterOptics: underwaterOpticsDebug,
		diagnosticsMosaic
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
		direction: normalize( positionGeometry ),
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
	if ( debugMode !== undefined ) uniforms.debugModeNode.value = resolveOceanDebugMode( debugMode );
	if ( sunDirection ) uniforms.sunDirectionNode.value.copy( sunDirection ).normalize();
	if ( foamThreshold !== undefined ) uniforms.foamThresholdNode.value = foamThreshold;
	if ( foamScale !== undefined ) uniforms.foamScaleNode.value = foamScale;
}

export function createOceanMesh( material, {
	sizeMeters = 400,
	segments = 384
} = {} ) {
	if ( ! Number.isFinite( sizeMeters ) || sizeMeters <= 0 || ! Number.isInteger( segments ) || segments < 1 ) {
		throw new Error( 'Ocean mesh requires positive finite sizeMeters and positive integer segments.' );
	}
	const vertexNyquist = Math.PI * segments / sizeMeters;
	const vertexMaxWavenumber = material.userData.vertexMaxWavenumber;
	const bandContract = material.userData.geometryBandContract;
	if ( ! bandContract || bandContract.sizeMeters !== sizeMeters || bandContract.segments !== segments ) {
		throw new Error( 'Ocean mesh size/segments must match the material geometry-band contract.' );
	}
	if ( ! Number.isFinite( vertexMaxWavenumber ) || vertexMaxWavenumber > vertexNyquist ) {
		throw new Error( `Ocean vertex displacement exceeds mesh Nyquist support: ${ vertexMaxWavenumber } > ${ vertexNyquist } rad/m.` );
	}
	const geometry = new THREE.PlaneGeometry( sizeMeters, sizeMeters, segments, segments );
	geometry.rotateX( - Math.PI / 2 );
	const mesh = new THREE.Mesh( geometry, material );
	mesh.name = 'WebGPU FFT-ocean numerical scaffold';
	mesh.frustumCulled = false;
	mesh.userData.vertexNyquistWavenumber = vertexNyquist;
	mesh.userData.geometryBytes = Object.values( geometry.attributes )
		.reduce( ( bytes, attribute ) => bytes + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0 );
	return mesh;
}

export function createOceanRenderPipeline( renderer, scene, camera, {
	enableMrt = false
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
	const disposePipeline = pipeline.dispose.bind( pipeline );
	let disposed = false;
	pipeline.scenePass = scenePass;
	pipeline.dispose = () => {
		if ( disposed ) return;
		disposed = true;
		scenePass.dispose();
		disposePipeline();
	};
	return pipeline;
}
