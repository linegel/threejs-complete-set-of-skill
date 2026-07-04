import {
	AO_FIXTURE_IDS,
	assertFixtureManifestMatchesReference
} from './fixtures.js';

const DEPTH_MODES = new Set( [ 'standard', 'reversed', 'logarithmic' ] );

export const DEFAULT_AO_CONFIG = Object.freeze( {
	enabled: true,
	targetScale: 0.5,
	samples: 16,
	radiusMeters: 0.5,
	radiusUnits: 'world-meters',
	directLightExcluded: true,
	emissiveExcluded: true,
	uiExcluded: true,
	bloomExcluded: true,
	viewport: Object.freeze( {
		width: 1280,
		height: 720,
		aspect: 1280 / 720,
		projectionX: 1.357,
		projectionY: 2.414,
		texelSize: Object.freeze( [ 1 / 1280, 1 / 720 ] )
	} ),
	depthMode: 'reversed',
	temporal: Object.freeze( {
		enabled: false,
		velocitySource: null,
		depthRejection: true,
		cameraCutReset: true
	} ),
	disabledPassBypass: true,
	customBentNormal: Object.freeze( {
		enabled: false,
		oneWallFixtureStatus: 'disabled',
		directionalTintEnabled: false
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
			cameraCutReset: config.cameraCutReset === true
		};
	}

	return {
		...DEFAULT_AO_CONFIG.temporal,
		...( config.temporal ?? {} ),
		velocitySource: config.velocitySource ?? config.temporal?.velocitySource ?? DEFAULT_AO_CONFIG.temporal.velocitySource
	};
}

export function validateAOConfig( config = {} ) {
	const merged = {
		...DEFAULT_AO_CONFIG,
		...config,
		viewport: {
			...DEFAULT_AO_CONFIG.viewport,
			...( config.viewport ?? {} )
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

	if ( ! isPositiveFinite( merged.radiusMeters ) || merged.radiusUnits !== 'world-meters' ) {
		errors.push( 'radius must be declared in positive world-meters.' );
	}

	for ( const flag of [ 'directLightExcluded', 'emissiveExcluded', 'uiExcluded', 'bloomExcluded' ] ) {
		if ( merged[ flag ] !== true ) {
			errors.push( `${ flag } must be true; AO may not darken that contribution.` );
		}
	}

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

	if ( ! DEPTH_MODES.has( merged.depthMode ) ) {
		errors.push( 'depthMode must be one of standard, reversed, or logarithmic.' );
	}

	if ( temporal.enabled === true ) {
		if ( ! temporal.velocitySource ) errors.push( 'temporal AO requires a velocity source.' );
		if ( temporal.depthRejection !== true ) errors.push( 'temporal AO requires depth rejection.' );
		if ( temporal.cameraCutReset !== true ) errors.push( 'temporal AO requires camera-cut reset.' );
	}

	if ( merged.enabled === false && merged.disabledPassBypass !== true ) {
		errors.push( 'disabled AO must bypass the AO node instead of setting intensity to zero.' );
	}

	if ( customBentNormal.enabled === true ) {
		if ( ! [ 'pending', 'passed', 'failed' ].includes( customBentNormal.oneWallFixtureStatus ) ) {
			errors.push( 'custom bent-normal one-wall fixture status must be pending, passed, or failed.' );
		}
		if ( customBentNormal.oneWallFixtureStatus !== 'passed' && customBentNormal.directionalTintEnabled === true ) {
			errors.push( 'directional bent-normal tint must stay disabled until the one-wall fixture passes.' );
		}
	}

	const fixtureIds = assertFixtureManifestMatchesReference( AO_FIXTURE_IDS );

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
			cameraCutReset: true
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
