import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertNonBlankGeneratedPng } from '../png.js';

export const artifactSchemas = {
	'visual-contract.json': {
		required: [
			'subject',
			'identity',
			'invariants',
			'invariantArtifacts',
			'requiredImages',
			'requiredDiagnostics',
			'requiredMetrics',
			'blockingFailures',
			'frameBudgetMs',
			'memoryBudgetMB'
		],
		nullable: []
	},
	'evidence-manifest.json': {
		required: [
			'skill',
			'sceneId',
			'threeRevision',
			'renderer',
			'backend',
			'qualityTier',
			'viewport',
			'camera',
			'seed',
			'time',
			'colorPipeline',
			'postStack',
			'thresholds',
			'stochasticMasks',
			'knownCompromises'
		],
		nullable: [ 'gpuAdapter' ]
	},
	'renderer-info.json': {
		required: [
			'threeRevision',
			'renderer',
			'isPrimaryBackend',
			'coordinateSystem',
			'initialized',
			'outputBufferType',
			'compatibilityMode',
			'trackTimestamp',
			'features',
			'limits',
			'unavailableReason',
			'info'
		],
		nullable: [ 'features', 'limits', 'compatibilityMode', 'trackTimestamp', 'unavailableReason' ]
	},
	'render-targets.json': {
		required: [ 'required', 'targets', 'totalBytes' ],
		nullable: []
	},
	'storage-resources.json': {
		required: [ 'required', 'resources', 'totalBytes' ],
		nullable: []
	},
	'timings.json': {
		required: [
			'required',
			'warmupFrames',
			'sampleFrames',
			'cpuFrameMs',
			'gpuFrameMs',
			'gpuTimingUnavailable',
			'gpuTimingLabel',
			'qualityTierChanges'
		],
		nullable: [ 'gpuFrameMs' ]
	},
	'leak-loop.json': {
		required: [ 'required', 'loops', 'summary', 'allowedCacheNotes' ],
		nullable: []
	}
};

const requiredImages = [
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/camera.near.png',
	'images/camera.design.png',
	'images/camera.far.png',
	'images/seed-0001.final.png',
	'images/seed-stress.final.png',
	'images/temporal.t000.png',
	'images/temporal.t001.png'
];

const allowedQualityTiers = new Set( [
	'native-compute',
	'native-budgeted',
	'node-schema-fixture'
] );

export function getRequiredImagePaths() {

	return [ ...requiredImages ];

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) {

		throw new Error( `${ label } must be an object.` );

	}

}

function requireKeys( object, keys, label ) {

	for ( const key of keys ) {

		if ( Object.hasOwn( object, key ) === false ) {

			throw new Error( `${ label } is missing required field "${ key }".` );

		}

	}

}

function requireFiniteNumber( value, label ) {

	if ( typeof value !== 'number' || Number.isFinite( value ) === false ) {

		throw new Error( `${ label } must be a finite number.` );

	}

}

function requireFiniteNumberArray( value, length, label ) {

	if ( Array.isArray( value ) === false || value.length !== length ) {

		throw new Error( `${ label } must be an array of ${ length } numbers.` );

	}

	for ( const [ index, entry ] of value.entries() ) {

		requireFiniteNumber( entry, `${ label }[${ index }]` );

	}

}

function assertMetricTriplet( value, label ) {

	requireObject( value, label );
	requireKeys( value, [ 'median', 'p95', 'unit' ], label );

	if ( value.unit !== 'ms' ) {

		throw new Error( `${ label }.unit must be "ms".` );

	}

}

function validateCameraRecord( camera ) {

	requireObject( camera, 'evidence-manifest.json.camera' );
	requireKeys( camera, [ 'bookmark', 'matrixWorld', 'projectionMatrix', 'near', 'far' ], 'evidence-manifest.json.camera' );

	if ( camera.manuallyOrbited === true ) {

		throw new Error( 'Manually orbited camera evidence is invalid; use fixed camera matrices.' );

	}

	if ( typeof camera.bookmark !== 'string' || camera.bookmark.length === 0 ) {

		throw new Error( 'evidence-manifest.json.camera.bookmark must name the fixed camera.' );

	}

	requireFiniteNumberArray( camera.matrixWorld, 16, 'evidence-manifest.json.camera.matrixWorld' );
	requireFiniteNumberArray( camera.projectionMatrix, 16, 'evidence-manifest.json.camera.projectionMatrix' );
	requireFiniteNumber( camera.near, 'evidence-manifest.json.camera.near' );
	requireFiniteNumber( camera.far, 'evidence-manifest.json.camera.far' );

	if ( camera.near <= 0 || camera.far <= camera.near ) {

		throw new Error( 'evidence-manifest.json.camera must have positive near/far planes with far > near.' );

	}

}

function validateThresholds( thresholds ) {

	requireObject( thresholds, 'evidence-manifest.json.thresholds' );
	requireObject( thresholds.nonblank, 'evidence-manifest.json.thresholds.nonblank' );
	requireFiniteNumber( thresholds.nonblank.minRange, 'evidence-manifest.json.thresholds.nonblank.minRange' );

	if ( thresholds.nonblank.minRange <= 0 ) {

		throw new Error( 'evidence-manifest.json.thresholds.nonblank.minRange must be positive.' );

	}

	if ( thresholds.cameraMatrixRequired !== true ) {

		throw new Error( 'evidence-manifest.json.thresholds.cameraMatrixRequired must be true.' );

	}

}

function validateStochasticMasks( masks ) {

	if ( Array.isArray( masks ) === false || masks.length === 0 ) {

		throw new Error( 'evidence-manifest.json.stochasticMasks must list named mask records.' );

	}

	for ( const mask of masks ) {

		requireObject( mask, 'evidence-manifest.json.stochasticMasks[]' );
		requireKeys( mask, [ 'name', 'path', 'reason' ], 'evidence-manifest.json.stochasticMasks[]' );

		if ( typeof mask.name !== 'string' || mask.name.length === 0 ) {

			throw new Error( 'Every stochastic mask needs a stable name.' );

		}

		if ( mask.path !== null && typeof mask.path !== 'string' ) {

			throw new Error( 'Every stochastic mask path must be a string or null.' );

		}

		if ( typeof mask.reason !== 'string' || mask.reason.length === 0 ) {

			throw new Error( 'Every stochastic mask needs a reason.' );

		}

	}

}

export function validateVisualContract( contract ) {

	requireObject( contract, 'visual-contract.json' );
	requireKeys( contract, artifactSchemas[ 'visual-contract.json' ].required, 'visual-contract.json' );

	if ( contract.invariants.length === 0 ) {

		throw new Error( 'visual-contract.json must declare at least one invariant.' );

	}

	if ( contract.requiredImages.includes( 'images/final.design.png' ) && contract.requiredImages.length === 1 ) {

		throw new Error( 'A final-only visual contract is insufficient; no-post and diagnostic evidence are required.' );

	}

	if ( contract.requiredImages.includes( 'images/no-post.design.png' ) === false ) {

		throw new Error( 'visual-contract.json must require images/no-post.design.png.' );

	}

	if ( contract.requiredDiagnostics.length === 0 || contract.requiredMetrics.length === 0 ) {

		throw new Error( 'visual-contract.json must bind invariants to diagnostics and metrics.' );

	}

	for ( const invariant of contract.invariants ) {

		const binding = contract.invariantArtifacts[ invariant ];
		requireObject( binding, `visual-contract invariant "${ invariant }"` );
		requireKeys( binding, [ 'requiredImages', 'requiredDiagnostics', 'requiredMetrics', 'blockingFailures' ], `visual-contract invariant "${ invariant }"` );

		if ( binding.requiredImages.length === 0 || binding.requiredDiagnostics.length === 0 || binding.requiredMetrics.length === 0 ) {

			throw new Error( `Invariant "${ invariant }" is not bound to enough evidence.` );

		}

	}

	return true;

}

export function validateEvidenceManifest( manifest ) {

	requireObject( manifest, 'evidence-manifest.json' );
	requireKeys( manifest, artifactSchemas[ 'evidence-manifest.json' ].required, 'evidence-manifest.json' );

	if ( manifest.skill !== 'threejs-visual-validation' ) {

		throw new Error( 'evidence-manifest.json has the wrong skill id.' );

	}

	if ( allowedQualityTiers.has( manifest.qualityTier ) === false ) {

		throw new Error( `evidence-manifest.json qualityTier "${ manifest.qualityTier }" is not allowed.` );

	}

	if ( manifest.qualityTier !== 'node-schema-fixture' && manifest.backend?.isPrimaryBackend !== true ) {

		throw new Error( 'Canonical visual validation requires a WebGPU backend; route explicit WebGPU-unavailable fallback teaching elsewhere.' );

	}

	if ( manifest.colorPipeline.toneMapOwner === manifest.colorPipeline.outputTransformOwner && manifest.colorPipeline.toneMapOwner === 'duplicate' ) {

		throw new Error( 'Duplicate tone/output owner sentinel is not allowed.' );

	}

	validateCameraRecord( manifest.camera );
	validateThresholds( manifest.thresholds );
	validateStochasticMasks( manifest.stochasticMasks );

	return true;

}

export function validateRendererInfo( rendererInfo ) {

	requireObject( rendererInfo, 'renderer-info.json' );
	requireKeys( rendererInfo, artifactSchemas[ 'renderer-info.json' ].required, 'renderer-info.json' );

	if ( rendererInfo.features === null && typeof rendererInfo.unavailableReason !== 'string' ) {

		throw new Error( 'renderer-info.json needs unavailableReason when features are null.' );

	}

	return true;

}

export function validateTimings( timings ) {

	requireObject( timings, 'timings.json' );
	requireKeys( timings, artifactSchemas[ 'timings.json' ].required, 'timings.json' );
	assertMetricTriplet( timings.cpuFrameMs, 'timings.json.cpuFrameMs' );

	if ( timings.gpuTimingUnavailable === true ) {

		if ( timings.gpuTimingLabel !== 'CPU-only proxy' ) {

			throw new Error( 'Missing GPU timing must be labelled "CPU-only proxy".' );

		}

	} else {

		assertMetricTriplet( timings.gpuFrameMs, 'timings.json.gpuFrameMs' );

	}

	return true;

}

export function validateInventories( renderTargets, storageResources ) {

	requireObject( renderTargets, 'render-targets.json' );
	requireObject( storageResources, 'storage-resources.json' );
	requireKeys( renderTargets, artifactSchemas[ 'render-targets.json' ].required, 'render-targets.json' );
	requireKeys( storageResources, artifactSchemas[ 'storage-resources.json' ].required, 'storage-resources.json' );

	if ( renderTargets.required !== true || storageResources.required !== true ) {

		throw new Error( 'render-targets.json and storage-resources.json must mark inventories as required.' );

	}

	return true;

}

export function validateLeakLoop( leakLoop ) {

	requireObject( leakLoop, 'leak-loop.json' );
	requireKeys( leakLoop, artifactSchemas[ 'leak-loop.json' ].required, 'leak-loop.json' );

	if ( leakLoop.loops.length === 0 ) {

		throw new Error( 'leak-loop.json must record at least one lifecycle loop.' );

	}

	for ( const loop of leakLoop.loops ) {

		requireKeys( loop, [ 'name', 'iterations', 'before', 'after', 'deltas', 'pass', 'thresholds' ], `leak-loop ${ loop.name ?? '<unnamed>' }` );

		if ( loop.pass !== true ) {

			throw new Error( `leak-loop ${ loop.name } failed its pass flag.` );

		}

		for ( const key of [ 'geometries', 'textures', 'targetBytes', 'storageBytes' ] ) {

			requireFiniteNumber( loop.deltas?.[ key ], `leak-loop ${ loop.name }.deltas.${ key }` );
			requireFiniteNumber( loop.thresholds?.[ key ], `leak-loop ${ loop.name }.thresholds.${ key }` );

			if ( loop.deltas[ key ] > loop.thresholds[ key ] ) {

				throw new Error( `leak-loop ${ loop.name } delta ${ key } exceeded threshold.` );

			}

		}

	}

	if ( leakLoop.summary?.pass !== true ) {

		throw new Error( 'leak-loop.json summary must pass.' );

	}

	if ( Array.isArray( leakLoop.summary.uncapturedBackendErrors ) && leakLoop.summary.uncapturedBackendErrors.length > 0 ) {

		throw new Error( 'leak-loop.json contains uncaptured backend errors.' );

	}

	return true;

}

export async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

export async function validateArtifactBundle( artifactDir ) {

	const contract = await readJson( join( artifactDir, 'visual-contract.json' ) );
	const manifest = await readJson( join( artifactDir, 'evidence-manifest.json' ) );
	const rendererInfo = await readJson( join( artifactDir, 'renderer-info.json' ) );
	const renderTargets = await readJson( join( artifactDir, 'render-targets.json' ) );
	const storageResources = await readJson( join( artifactDir, 'storage-resources.json' ) );
	const timings = await readJson( join( artifactDir, 'timings.json' ) );
	const leakLoop = await readJson( join( artifactDir, 'leak-loop.json' ) );

	validateVisualContract( contract );
	validateEvidenceManifest( manifest );
	validateRendererInfo( rendererInfo );
	validateInventories( renderTargets, storageResources );
	validateTimings( timings );
	validateLeakLoop( leakLoop );

	const nonblankImages = {};
	for ( const imagePath of contract.requiredImages ) {

		const png = await readFile( join( artifactDir, imagePath ) );
		nonblankImages[ imagePath ] = assertNonBlankGeneratedPng( png, imagePath );

	}

	return {
		sceneId: manifest.sceneId,
		requiredArtifacts: Object.keys( artifactSchemas ),
		requiredImages: contract.requiredImages,
		nonblankImages
	};

}
