import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertNonBlankGeneratedPng, compareGeneratedRgbaPngs } from '../png.js';

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
			'browser',
			'os',
			'gpuAdapter',
			'renderer',
			'backend',
			'qualityTier',
			'viewport',
			'camera',
			'seed',
			'time',
			'assets',
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
			'renderTimestampMs',
			'computeTimestampMs',
			'qualityTierChanges'
		],
		nullable: [ 'gpuFrameMs', 'renderTimestampMs', 'computeTimestampMs' ]
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

const requiredLeakLoopNames = [
	'resize',
	'dpr-change',
	'quality-tier-switch',
	'debug-mode-switch',
	'history-reset',
	'asset-reload',
	'scene-teardown',
	'dispose-recreate'
];

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

function requireBoolean( value, label ) {

	if ( typeof value !== 'boolean' ) {

		throw new Error( `${ label } must be a boolean.` );

	}

}

function requireString( value, label ) {

	if ( typeof value !== 'string' || value.length === 0 ) {

		throw new Error( `${ label } must be a non-empty string.` );

	}

}

function requireStringOrNull( value, label ) {

	if ( value !== null && typeof value !== 'string' ) {

		throw new Error( `${ label } must be a string or null.` );

	}

}

function requireArray( value, label ) {

	if ( Array.isArray( value ) === false ) {

		throw new Error( `${ label } must be an array.` );

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
	requireFiniteNumber( value.median, `${ label }.median` );
	requireFiniteNumber( value.p95, `${ label }.p95` );

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
	requireObject( thresholds.perViewPixelDiff, 'evidence-manifest.json.thresholds.perViewPixelDiff' );

	if ( thresholds.nonblank.minRange <= 0 ) {

		throw new Error( 'evidence-manifest.json.thresholds.nonblank.minRange must be positive.' );

	}

	if ( thresholds.cameraMatrixRequired !== true ) {

		throw new Error( 'evidence-manifest.json.thresholds.cameraMatrixRequired must be true.' );

	}

	if ( Object.hasOwn( thresholds, 'budgetProfile' ) ) {

		requireString( thresholds.budgetProfile, 'evidence-manifest.json.thresholds.budgetProfile' );

	}

	if ( Object.keys( thresholds.perViewPixelDiff ).length === 0 ) {

		throw new Error( 'evidence-manifest.json.thresholds.perViewPixelDiff must declare at least one PNG comparison.' );

	}

	for ( const [ view, record ] of Object.entries( thresholds.perViewPixelDiff ) ) {

		requireObject( record, `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }` );
		requireKeys( record, [ 'baseline', 'candidate', 'maxRatio' ], `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }` );
		requireString( record.baseline, `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }.baseline` );
		requireString( record.candidate, `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }.candidate` );
		requireFiniteNumber( record.maxRatio, `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }.maxRatio` );

		if ( record.maxRatio < 0 || record.maxRatio > 1 ) {

			throw new Error( `evidence-manifest.json.thresholds.perViewPixelDiff.${ view }.maxRatio must be in [0, 1].` );

		}

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

function validateViewport( viewport ) {

	requireObject( viewport, 'evidence-manifest.json.viewport' );
	requireKeys( viewport, [ 'width', 'height', 'dpr' ], 'evidence-manifest.json.viewport' );
	requireFiniteNumber( viewport.width, 'evidence-manifest.json.viewport.width' );
	requireFiniteNumber( viewport.height, 'evidence-manifest.json.viewport.height' );
	requireFiniteNumber( viewport.dpr, 'evidence-manifest.json.viewport.dpr' );

	if ( viewport.width <= 0 || viewport.height <= 0 || viewport.dpr <= 0 ) {

		throw new Error( 'evidence-manifest.json.viewport values must be positive.' );

	}

}

function validateBackendRecord( backend ) {

	requireObject( backend, 'evidence-manifest.json.backend' );
	requireKeys( backend, [
		'isPrimaryBackend',
		'coordinateSystem',
		'initialized',
		'deviceLostObserved',
		'uncapturedErrors',
		'features',
		'limits',
		'unavailableReason'
	], 'evidence-manifest.json.backend' );

	if ( backend.isPrimaryBackend !== null ) {

		requireBoolean( backend.isPrimaryBackend, 'evidence-manifest.json.backend.isPrimaryBackend' );

	}

	requireBoolean( backend.initialized, 'evidence-manifest.json.backend.initialized' );
	requireBoolean( backend.deviceLostObserved, 'evidence-manifest.json.backend.deviceLostObserved' );
	requireArray( backend.uncapturedErrors, 'evidence-manifest.json.backend.uncapturedErrors' );

	if ( backend.features !== null ) {

		requireArray( backend.features, 'evidence-manifest.json.backend.features' );

	}

	if ( backend.limits !== null ) {

		requireObject( backend.limits, 'evidence-manifest.json.backend.limits' );

	}

	if ( backend.features === null && typeof backend.unavailableReason !== 'string' ) {

		throw new Error( 'evidence-manifest.json.backend needs unavailableReason when features are null.' );

	}

}

function validateAssets( assets ) {

	requireArray( assets, 'evidence-manifest.json.assets' );

	for ( const asset of assets ) {

		requireObject( asset, 'evidence-manifest.json.assets[]' );
		requireKeys( asset, [ 'id' ], 'evidence-manifest.json.assets[]' );
		requireString( asset.id, 'evidence-manifest.json.assets[].id' );

		if ( Object.hasOwn( asset, 'url' ) ) {

			requireString( asset.url, 'evidence-manifest.json.assets[].url' );

		}

		if ( Object.hasOwn( asset, 'hash' ) ) {

			requireString( asset.hash, 'evidence-manifest.json.assets[].hash' );

		}

	}

}

export function getExpectedWebGPUReadbackLayout( width, height, bytesPerTexel = 4 ) {

	requireFiniteNumber( width, 'readback.width' );
	requireFiniteNumber( height, 'readback.height' );
	requireFiniteNumber( bytesPerTexel, 'readback.bytesPerTexel' );

	if ( Number.isInteger( width ) === false || Number.isInteger( height ) === false || width <= 0 || height <= 0 ) {

		throw new Error( 'readback dimensions must be positive integers.' );

	}

	const rowBytes = width * bytesPerTexel;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const byteLength = ( ( height - 1 ) * bytesPerRow ) + rowBytes;

	return { rowBytes, bytesPerRow, byteLength };

}

function validateReadbackLayout( target ) {

	if ( Object.hasOwn( target, 'readback' ) === false ) {

		return;

	}

	const { readback } = target;
	requireObject( readback, `render-target ${ target.name }.readback` );
	requireKeys( readback, [ 'rowBytes', 'bytesPerRow', 'byteLength' ], `render-target ${ target.name }.readback` );

	const expected = getExpectedWebGPUReadbackLayout( target.width, target.height, readback.bytesPerTexel ?? 4 );

	for ( const key of [ 'rowBytes', 'bytesPerRow', 'byteLength' ] ) {

		requireFiniteNumber( readback[ key ], `render-target ${ target.name }.readback.${ key }` );

		if ( Number.isInteger( readback[ key ] ) === false ) {

			throw new Error( `render-target ${ target.name }.readback.${ key } must be an integer.` );

		}

		if ( readback[ key ] !== expected[ key ] ) {

			throw new Error( `render-target ${ target.name }.readback.${ key } must match WebGPU padded row layout.` );

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

	requireObject( contract.frameBudgetMs, 'visual-contract.json.frameBudgetMs' );

	for ( const key of [ 'desktopDiscrete', 'desktopIntegrated', 'mobile' ] ) {

		requireFiniteNumber( contract.frameBudgetMs[ key ], `visual-contract.json.frameBudgetMs.${ key }` );

		if ( contract.frameBudgetMs[ key ] <= 0 ) {

			throw new Error( `visual-contract.json.frameBudgetMs.${ key } must be positive.` );

		}

	}

	requireFiniteNumber( contract.memoryBudgetMB, 'visual-contract.json.memoryBudgetMB' );

	if ( contract.memoryBudgetMB <= 0 ) {

		throw new Error( 'visual-contract.json.memoryBudgetMB must be positive.' );

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

function getBudgetProfile( manifest, contract ) {

	const profile = manifest.thresholds.budgetProfile ?? 'desktopDiscrete';

	if ( Object.hasOwn( contract.frameBudgetMs, profile ) === false ) {

		throw new Error( `Budget profile "${ profile }" is not present in visual-contract.json.frameBudgetMs.` );

	}

	return profile;

}

function makeBudgetResult( name, state, measured, budget, detail ) {

	return { name, state, measured, budget, detail };

}

function assertPassOrThrow( result, strict ) {

	if ( result.state === 'FAIL' ) {

		throw new Error( `${ result.name } exceeded budget: measured ${ result.measured } > budget ${ result.budget }. ${ result.detail }` );

	}

	if ( strict === true && result.state === 'SKIP' ) {

		throw new Error( `${ result.name } is SKIP under --strict. ${ result.detail }` );

	}

}

function evaluateBudgetSummary( contract, manifest, timings, renderTargets, storageResources, strict = false ) {

	const profile = getBudgetProfile( manifest, contract );
	const frameBudget = contract.frameBudgetMs[ profile ];
	const memoryBudgetBytes = contract.memoryBudgetMB * 1024 * 1024;
	const results = [];

	if ( timings.cpuFrameMs !== null && typeof timings.cpuFrameMs === 'object' && Number.isFinite( timings.cpuFrameMs.median ) ) {

		const measured = timings.cpuFrameMs.median;
		results.push( makeBudgetResult(
			'cpuFrameMs.median',
			measured <= frameBudget ? 'PASS' : 'FAIL',
			measured,
			frameBudget,
			`profile=${ profile }`
		) );

	}

	if ( timings.gpuTimingUnavailable === true ) {

		results.push( makeBudgetResult(
			'gpuFrameMs.median',
			'SKIP',
			null,
			frameBudget,
			'GPU timestamp timing unavailable; CPU-only proxy cannot prove GPU headroom.'
		) );

	} else if ( timings.gpuFrameMs !== null && typeof timings.gpuFrameMs === 'object' && Number.isFinite( timings.gpuFrameMs.median ) ) {

		const measured = timings.gpuFrameMs.median;
		results.push( makeBudgetResult(
			'gpuFrameMs.median',
			measured <= frameBudget ? 'PASS' : 'FAIL',
			measured,
			frameBudget,
			`profile=${ profile }`
		) );

	}

	const renderTargetMemoryBytes = Number.isFinite( timings.renderTargetMemoryBytes ) ? timings.renderTargetMemoryBytes : renderTargets.totalBytes;
	const storageMemoryBytes = Number.isFinite( timings.storageMemoryBytes ) ? timings.storageMemoryBytes : storageResources.totalBytes;

	if ( Number.isFinite( renderTargetMemoryBytes ) || Number.isFinite( storageMemoryBytes ) ) {

		const measured = ( Number.isFinite( renderTargetMemoryBytes ) ? renderTargetMemoryBytes : 0 ) + ( Number.isFinite( storageMemoryBytes ) ? storageMemoryBytes : 0 );
		results.push( makeBudgetResult(
			'totalGpuMemoryBytes',
			measured <= memoryBudgetBytes ? 'PASS' : 'FAIL',
			measured,
			memoryBudgetBytes,
			`memoryBudgetMB=${ contract.memoryBudgetMB }`
		) );

	}

	for ( const result of results ) {

		assertPassOrThrow( result, strict );

	}

	return {
		strict,
		profile,
		results
	};

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

		throw new Error( 'Canonical visual validation requires a WebGPU backend.' );

	}

	if ( manifest.colorPipeline.toneMapOwner === manifest.colorPipeline.outputTransformOwner && manifest.colorPipeline.toneMapOwner === 'duplicate' ) {

		throw new Error( 'Duplicate tone/output owner sentinel is not allowed.' );

	}

	requireString( manifest.browser, 'evidence-manifest.json.browser' );
	requireString( manifest.os, 'evidence-manifest.json.os' );
	requireStringOrNull( manifest.gpuAdapter, 'evidence-manifest.json.gpuAdapter' );
	requireString( manifest.renderer, 'evidence-manifest.json.renderer' );
	validateBackendRecord( manifest.backend );
	validateViewport( manifest.viewport );
	validateCameraRecord( manifest.camera );
	validateAssets( manifest.assets );
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

		if ( timings.renderTimestampMs !== null || timings.computeTimestampMs !== null || timings.gpuFrameMs !== null ) {

			throw new Error( 'CPU-only proxy timing must not carry GPU timestamp values.' );

		}

	} else {

		assertMetricTriplet( timings.gpuFrameMs, 'timings.json.gpuFrameMs' );
		requireFiniteNumber( timings.renderTimestampMs, 'timings.json.renderTimestampMs' );

		if ( timings.gpuTimingLabel !== 'GPU timestamp' ) {

			throw new Error( 'Available GPU timing must be labelled "GPU timestamp".' );

		}

		if ( timings.computeTimestampMs !== null ) {

			requireFiniteNumber( timings.computeTimestampMs, 'timings.json.computeTimestampMs' );

		}

	}

	return true;

}

function resolveBundlePath( artifactDir, relativePath, label ) {

	if ( relativePath.startsWith( '/' ) || relativePath.includes( '..' ) ) {

		throw new Error( `${ label } must be a bundle-relative path without "..".` );

	}

	return join( artifactDir, relativePath );

}

async function evaluatePixelDiffSummary( artifactDir, manifest ) {

	const records = manifest.thresholds.perViewPixelDiff;
	const results = [];

	for ( const [ view, record ] of Object.entries( records ) ) {

		const baseline = await readFile( resolveBundlePath( artifactDir, record.baseline, `perViewPixelDiff.${ view }.baseline` ) );
		const candidate = await readFile( resolveBundlePath( artifactDir, record.candidate, `perViewPixelDiff.${ view }.candidate` ) );
		const diff = compareGeneratedRgbaPngs( baseline, candidate );
		const result = {
			view,
			state: diff.ratio <= record.maxRatio ? 'PASS' : 'FAIL',
			ratio: diff.ratio,
			maxRatio: record.maxRatio,
			differingPixels: diff.differingPixels,
			totalPixels: diff.totalPixels,
			maxChannelDelta: diff.maxChannelDelta,
			baseline: record.baseline,
			candidate: record.candidate
		};

		if ( result.state === 'FAIL' ) {

			throw new Error( `perViewPixelDiff.${ view } exceeded threshold: ratio ${ result.ratio } > ${ result.maxRatio }.` );

		}

		results.push( result );

	}

	return { results };

}

export function validateInventories( renderTargets, storageResources ) {

	requireObject( renderTargets, 'render-targets.json' );
	requireObject( storageResources, 'storage-resources.json' );
	requireKeys( renderTargets, artifactSchemas[ 'render-targets.json' ].required, 'render-targets.json' );
	requireKeys( storageResources, artifactSchemas[ 'storage-resources.json' ].required, 'storage-resources.json' );

	if ( renderTargets.required !== true || storageResources.required !== true ) {

		throw new Error( 'render-targets.json and storage-resources.json must mark inventories as required.' );

	}

	if ( Array.isArray( renderTargets.targets ) === false || renderTargets.targets.length === 0 ) {

		throw new Error( 'render-targets.json must list at least one target.' );

	}

	for ( const target of renderTargets.targets ) {

		requireObject( target, 'render-targets.json.targets[]' );
		requireKeys( target, [
			'name',
			'role',
			'owner',
			'width',
			'height',
			'dprScale',
			'format',
			'type',
			'colorSpace',
			'samples',
			'depthStencil',
			'mrtCount',
			'lifetime',
			'memoryBytes'
		], 'render-targets.json.targets[]' );
		requireString( target.name, 'render-targets.json.targets[].name' );
		requireString( target.owner, `render-target ${ target.name }.owner` );
		requireFiniteNumber( target.width, `render-target ${ target.name }.width` );
		requireFiniteNumber( target.height, `render-target ${ target.name }.height` );
		requireFiniteNumber( target.memoryBytes, `render-target ${ target.name }.memoryBytes` );
		validateReadbackLayout( target );

	}

	if ( Array.isArray( storageResources.resources ) === false || storageResources.resources.length === 0 ) {

		throw new Error( 'storage-resources.json must list storage evidence or an explicit none record.' );

	}

	for ( const resource of storageResources.resources ) {

		requireObject( resource, 'storage-resources.json.resources[]' );
		requireKeys( resource, [
			'name',
			'kind',
			'dimensions',
			'format',
			'bytes',
			'ownerDispatch',
			'dispatchSize',
			'workgroupAssumptions',
			'synchronization',
			'readbackPolicy',
			'resetPolicy'
		], 'storage-resources.json.resources[]' );
		requireString( resource.name, 'storage-resources.json.resources[].name' );
		requireFiniteNumber( resource.bytes, `storage resource ${ resource.name }.bytes` );

	}

	return true;

}

export function validateLeakLoop( leakLoop ) {

	requireObject( leakLoop, 'leak-loop.json' );
	requireKeys( leakLoop, artifactSchemas[ 'leak-loop.json' ].required, 'leak-loop.json' );

	if ( leakLoop.loops.length === 0 ) {

		throw new Error( 'leak-loop.json must record at least one lifecycle loop.' );

	}

	const loopNames = new Set( leakLoop.loops.map( ( loop ) => loop.name ) );

	for ( const name of requiredLeakLoopNames ) {

		if ( loopNames.has( name ) === false ) {

			throw new Error( `leak-loop.json is missing required lifecycle loop "${ name }".` );

		}

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

export async function validateArtifactBundle( artifactDir, options = {} ) {

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

	const budgetSummary = evaluateBudgetSummary( contract, manifest, timings, renderTargets, storageResources, options.strict === true );
	const pixelDiffSummary = await evaluatePixelDiffSummary( artifactDir, manifest );

	const nonblankImages = {};
	for ( const imagePath of contract.requiredImages ) {

		const png = await readFile( join( artifactDir, imagePath ) );
		nonblankImages[ imagePath ] = assertNonBlankGeneratedPng( png, imagePath );

	}

	return {
		sceneId: manifest.sceneId,
		requiredArtifacts: Object.keys( artifactSchemas ),
		requiredImages: contract.requiredImages,
		nonblankImages,
		summary: {
			budgets: budgetSummary,
			perViewPixelDiff: pixelDiffSummary
		}
	};

}
