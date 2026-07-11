import {
	AO_FIXTURE_IDS,
	assertFixtureManifestMatchesReference
} from './fixtures.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SUPPORTED_DEPTH_MODES = new Set( [ 'standard' ] );
const EXAMPLE_SOURCE_PATH = fileURLToPath( new URL( './main.js', import.meta.url ) );

export const DEFAULT_AO_CONFIG = Object.freeze( {
	enabled: true,
	targetScale: 0.5,
	samples: 16,
	radiusSceneUnits: 0.5,
	radiusUnits: 'project-world-units',
	directLightExcluded: true,
	emissiveExcluded: true,
	uiExcluded: true,
	bloomExcluded: true,
	inputPassSamples: 0,
	opaqueOnlyInput: true,
	reconstruction: 'materialized-rtt',
	visibilityCoordinates: 'screenUV',
	viewport: Object.freeze( {
		width: 1280,
		height: 720,
		aspect: 1280 / 720,
		projectionX: 1.357,
		projectionY: 2.414,
		texelSize: Object.freeze( [ 1 / 1280, 1 / 720 ] )
	} ),
	depthMode: 'standard',
	renderer: Object.freeze( {
		reversedDepthBuffer: false
	} ),
	temporal: Object.freeze( {
		enabled: false,
		velocitySource: null,
		depthRejection: true,
		cameraCutPolicy: 'recreate-traa'
	} ),
	disabledPassBypass: true,
	customBentNormal: Object.freeze( {
		enabled: false,
		oneWallFixtureStatus: 'disabled',
		directionalTintEnabled: false,
		algorithmClass: 'heuristic-screen-space-directional-visibility',
		acceptanceStatus: 'INSUFFICIENT_EVIDENCE'
	} )
} );

function nearlyEqual( a, b, epsilon = 1e-6 ) {
	return Math.abs( a - b ) <= epsilon;
}

function isPositiveFinite( value ) {
	return Number.isFinite( value ) && value > 0;
}

function normalizeTemporalConfig( config ) {
	if ( config.temporal === true ) {
		return {
			enabled: true,
			velocitySource: config.velocitySource ?? null,
			depthRejection: config.depthRejection === true,
			cameraCutPolicy: config.cameraCutPolicy ?? DEFAULT_AO_CONFIG.temporal.cameraCutPolicy
		};
	}

	return {
		...DEFAULT_AO_CONFIG.temporal,
		...( config.temporal ?? {} ),
		velocitySource: config.velocitySource ?? config.temporal?.velocitySource ?? DEFAULT_AO_CONFIG.temporal.velocitySource
	};
}

function readExampleSource() {
	return readFileSync( EXAMPLE_SOURCE_PATH, 'utf8' );
}

export function validateExampleSourceContracts( source = readExampleSource() ) {
	const errors = [];
	const rendererOptionsMatch = source.match( /new\s+THREE\.WebGPURenderer\s*\(\s*\{[\s\S]*?\}\s*\)/ );

	if ( /builtinAOContext\s*\(\s*visibility\s*,/.test( source ) ) {
		errors.push( 'builtinAOContext must be assigned to a scene pass context, not wrapped around an already-rendered pass texture.' );
	}

	if ( ! /litScenePass\.contextNode\s*=\s*builtinAOContext\s*\(/.test( source ) ) {
		errors.push( 'litScenePass.contextNode must apply builtinAOContext before the lit scene render.' );
	}

	if ( ! /baselineScenePass\s*=\s*pass\s*\(\s*scene\s*,\s*camera\s*\)/.test( source ) ||
		! /case\s+AO_DEBUG_MODES\.disabled[\s\S]*?return\s+stage\.baselineOutput/.test( source ) ) {
		errors.push( 'disabled AO must select an unmodified full-scene baseline pass.' );
	}

	if ( ! /gbufferPass\s*=\s*pass\s*\(\s*scene\s*,\s*camera\s*,\s*\{\s*samples\s*:\s*0\s*\}\s*\)/.test( source ) ) {
		errors.push( 'AO input pass must explicitly disable MSAA with { samples: 0 }.' );
	}

	if ( ! /gbufferPass\.transparent\s*=\s*false/.test( source ) ) {
		errors.push( 'AO input pass must exclude transparent draws.' );
	}

	if ( ! /rtt\s*\(\s*denoisedAO[\s\S]*?format\s*:\s*THREE\.RedFormat[\s\S]*?type\s*:\s*THREE\.UnsignedByteType/.test( source ) ) {
		errors.push( 'DenoiseNode must be materialized once through an R8 rtt target.' );
	}

	if ( ! /reconstructedAO\.sample\s*\(\s*screenUV\s*\)\.r/.test( source ) ) {
		errors.push( 'material-context visibility must sample the reconstructed texture with screenUV.' );
	}

	if ( /const\s+visibility\s*=\s*(?:denoisedAO|rawAO|reconstructedAO)\.r/.test( source ) ) {
		errors.push( 'implicit TextureNode coordinates are forbidden for material-context AO.' );
	}

	if ( rendererOptionsMatch === null || ! /reversedDepthBuffer\s*:\s*false/.test( rendererOptionsMatch[ 0 ] ) ) {
		errors.push( 'r185 GTAONode scaffold must use standard depth.' );
	}

	if ( rendererOptionsMatch === null || ! /antialias\s*:\s*false/.test( rendererOptionsMatch[ 0 ] ) ) {
		errors.push( 'diagnostic scaffold must not inherit renderer MSAA into scene passes.' );
	}

	if ( ! /resetTemporalHistory\s*\(\s*\)\s*\{/.test( source ) ||
		! /previous\.dispose\?\.\(\)/.test( source ) ||
		! /traaNode\.dispose\?\.\(\)/.test( source ) ) {
		errors.push( 'camera-cut handling must recreate and dispose TRAANode; r185 exposes no public reset API.' );
	}

	if ( ! /renderPipeline\.outputColorTransform\s*=\s*false/.test( source ) ||
		! /renderPipeline\.outputNode\s*=\s*renderOutput\s*\(/.test( source ) ) {
		errors.push( 'renderOutput must be the sole tone-map/output-transform owner.' );
	}

	if ( ! /describeAOModeReachability\s*\(\s*mode/.test( source ) ||
		! /sceneSubmissionCount\s*:\s*reachability\.sceneSubmissionCount/.test( source ) ) {
		errors.push( 'runtime graph must derive mode-specific one, two, or three scene submissions from reachable passes.' );
	}

	if ( ! /calculateAOResourceInventory\s*\(\s*width\s*,\s*height\s*,\s*dpr/.test( source ) ||
		! /traa-history-depth/.test( source ) || ! /baseline-depth/.test( source ) ) {
		errors.push( 'runtime resource accounting must include graph-owned depth, lit, baseline, bent-normal, and TRAA resources.' );
	}

	if ( ! /heuristic-screen-space-directional-visibility/.test( source ) ||
		! /directionalTintEnabled\s*:\s*false/.test( source ) ||
		! /acceptanceStatus\s*:\s*'INSUFFICIENT_EVIDENCE'/.test( source ) ) {
		errors.push( 'experimental bent-normal output must be classified honestly and kept out of directional lighting.' );
	}

	if ( ! /inferPaddedLayout/.test( source ) || /pixels\.length\s*\/\s*height/.test( source ) ) {
		errors.push( 'render-target readback must infer an integer 256-byte-aligned row stride.' );
	}

	if ( /traaNode\??\.reset\s*\(/.test( source ) ) {
		errors.push( 'TRAANode.reset() is not an r185 API.' );
	}

	if ( errors.length > 0 ) {
		throw new Error( `Invalid example source contract:\n- ${ errors.join( '\n- ' ) }` );
	}

	return true;
}

export function validateAOConfig( config = {} ) {
	const merged = {
		...DEFAULT_AO_CONFIG,
		...config,
		viewport: {
			...DEFAULT_AO_CONFIG.viewport,
			...( config.viewport ?? {} )
		},
		renderer: {
			...DEFAULT_AO_CONFIG.renderer,
			...( config.renderer ?? {} )
		},
		temporal: normalizeTemporalConfig( config ),
		customBentNormal: {
			...DEFAULT_AO_CONFIG.customBentNormal,
			...( config.customBentNormal ?? {} )
		}
	};
	const errors = [];
	const viewport = merged.viewport;
	const texelSize = viewport.texelSize ?? [];
	const temporal = merged.temporal;
	const customBentNormal = merged.customBentNormal;

	if ( ! isPositiveFinite( merged.targetScale ) || merged.targetScale > 1 ) {
		errors.push( 'targetScale must be > 0 and <= 1.' );
	}

	if ( ! Number.isInteger( merged.samples ) || merged.samples < 4 || merged.samples > 64 ) {
		errors.push( 'samples must be an integer between 4 and 64.' );
	}

	if ( ! isPositiveFinite( merged.radiusSceneUnits ) || merged.radiusUnits !== 'project-world-units' ) {
		errors.push( 'radius must be positive and use declared project world units.' );
	}

	for ( const flag of [ 'directLightExcluded', 'emissiveExcluded', 'uiExcluded', 'bloomExcluded' ] ) {
		if ( merged[ flag ] !== true ) {
			errors.push( `${ flag } must be true; AO may not darken that contribution.` );
		}
	}

	if ( merged.inputPassSamples !== 0 ) errors.push( 'AO input pass must be single-sampled.' );
	if ( merged.opaqueOnlyInput !== true ) errors.push( 'AO input pass must exclude transparent draws.' );
	if ( merged.reconstruction !== 'materialized-rtt' ) errors.push( 'denoise must be materialized before material-context use.' );
	if ( merged.visibilityCoordinates !== 'screenUV' ) errors.push( 'visibility must use screenUV coordinates.' );

	if ( ! isPositiveFinite( viewport.width ) || ! isPositiveFinite( viewport.height ) ) {
		errors.push( 'viewport width and height must be positive.' );
	} else {
		const expectedAspect = viewport.width / viewport.height;
		if ( ! Number.isFinite( viewport.aspect ) || ! nearlyEqual( viewport.aspect, expectedAspect, 1e-4 ) ) {
			errors.push( 'non-square viewport metadata must include an accurate aspect ratio.' );
		}
		if ( viewport.width !== viewport.height ) {
			if ( ! isPositiveFinite( viewport.projectionX ) || ! isPositiveFinite( viewport.projectionY ) ) {
				errors.push( 'non-square viewport metadata must include both projection axes.' );
			}
			if ( ! nearlyEqual( texelSize[ 0 ], 1 / viewport.width, 1e-8 ) || ! nearlyEqual( texelSize[ 1 ], 1 / viewport.height, 1e-8 ) ) {
				errors.push( 'non-square viewport metadata must include independent X/Y texel sizes.' );
			}
		}
	}

	if ( ! SUPPORTED_DEPTH_MODES.has( merged.depthMode ) || merged.renderer.reversedDepthBuffer !== false ) {
		errors.push( 'canonical r185 GTAO scaffold supports standard non-reversed depth only.' );
	}

	if ( temporal.enabled === true ) {
		if ( ! temporal.velocitySource ) errors.push( 'temporal AO requires a velocity source.' );
		if ( temporal.depthRejection !== true ) errors.push( 'temporal AO requires depth rejection.' );
		if ( temporal.cameraCutPolicy !== 'recreate-traa' ) errors.push( 'camera cuts must recreate TRAANode; r185 exposes no reset API.' );
	}

	if ( merged.enabled === false && merged.disabledPassBypass !== true ) {
		errors.push( 'disabled AO must bypass the AO graph instead of setting intensity to zero.' );
	}

	if ( customBentNormal.enabled === true ) {
		if ( ! [ 'pending', 'passed', 'failed' ].includes( customBentNormal.oneWallFixtureStatus ) ) {
			errors.push( 'custom bent-normal one-wall fixture status must be pending, passed, or failed.' );
		}
		if ( customBentNormal.oneWallFixtureStatus !== 'passed' && customBentNormal.directionalTintEnabled === true ) {
			errors.push( 'directional bent-normal tint must stay disabled until the one-wall fixture passes.' );
		}
	}
	if ( customBentNormal.algorithmClass !== 'heuristic-screen-space-directional-visibility' ||
		customBentNormal.acceptanceStatus !== 'INSUFFICIENT_EVIDENCE' ) {
		errors.push( 'bent-normal diagnostic must remain heuristic and insufficient until measured one-wall evidence exists.' );
	}

	const fixtureIds = assertFixtureManifestMatchesReference( AO_FIXTURE_IDS );
	validateExampleSourceContracts( config.exampleSource );

	if ( errors.length > 0 ) {
		throw new Error( `Invalid AO config:\n- ${ errors.join( '\n- ' ) }` );
	}

	return {
		pass: true,
		config: merged,
		fixtureIds
	};
}

function fixtureConfig( name ) {
	if ( name === 'temporal-missing-velocity' ) {
		return {
			temporal: true,
			velocitySource: null,
			depthRejection: true,
			cameraCutPolicy: 'recreate-traa'
		};
	}

	if ( name === 'temporal-invalid-cut-policy' ) {
		return {
			temporal: true,
			velocitySource: 'mrt-velocity',
			depthRejection: true,
			cameraCutPolicy: 'reset-method'
		};
	}

	if ( name === 'disabled-without-bypass' ) {
		return {
			enabled: false,
			disabledPassBypass: false
		};
	}

	if ( name === 'bent-tint-before-wall-pass' ) {
		return {
			customBentNormal: {
				enabled: true,
				oneWallFixtureStatus: 'pending',
				directionalTintEnabled: true
			}
		};
	}

	if ( name === 'broken-screen-coordinate-contract' ) {
		return {
			exampleSource: [
				'const gbufferPass = pass( scene, camera, { samples: 0 } );',
				'gbufferPass.transparent = false;',
				'const denoisedAO = denoise( rawAO, sceneDepth, sceneNormal, camera );',
				'const reconstructedAO = rtt( denoisedAO, null, null, { format: THREE.RedFormat, type: THREE.UnsignedByteType } );',
				'const visibility = reconstructedAO.r;',
				'litScenePass.contextNode = builtinAOContext( visibility );',
				'const baselineScenePass = pass( scene, camera );',
				'const baselineOutput = baselineScenePass.getTextureNode( "output" );',
				'[ AO_DEBUG_MODES.disabled ]: baselineOutput',
				'const renderer = new THREE.WebGPURenderer( { antialias: false, reversedDepthBuffer: false } );',
				'function resetTemporalHistory() {}',
				'previousTRAANode?.dispose?.();',
				'traaNode?.dispose?.();'
			].join( '\n' )
		};
	}

	if ( name === 'unsupported-reversed-depth' ) {
		return {
			depthMode: 'reversed',
			renderer: {
				reversedDepthBuffer: true
			}
		};
	}

	return {};
}

if ( process.argv[ 1 ] && import.meta.url.endsWith( process.argv[ 1 ].replaceAll( '\\', '/' ) ) ) {
	const fixtureArgIndex = process.argv.indexOf( '--fixture' );
	const fixtureName = fixtureArgIndex === - 1 ? 'valid' : process.argv[ fixtureArgIndex + 1 ];

	try {
		const result = validateAOConfig( fixtureConfig( fixtureName ) );
		console.log( JSON.stringify( {
			pass: true,
			fixture: fixtureName,
			targetScale: result.config.targetScale,
			samples: result.config.samples,
			radiusUnits: result.config.radiusUnits,
			depthMode: result.config.depthMode,
			fixtureIds: result.fixtureIds
		}, null, 2 ) );
	} catch ( error ) {
		console.error( error.message );
		process.exitCode = 1;
	}
}
