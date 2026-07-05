import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';

import { createDiagnosticPng } from './png.js';
import { getExpectedWebGPUReadbackLayout, getRequiredImagePaths, validateArtifactBundle } from './schema/artifact-schemas.js';
import { r185NodePipelineImports } from './browser-webgpu-surface.js';

function makeCameraRecord() {

	return {
		bookmark: 'design',
		matrixWorld: [
			1, 0, 0, 0,
			0, 1, 0, 0,
			0, 0, 1, 0,
			0, 4, 8, 1
		],
		projectionMatrix: [
			1.299, 0, 0, 0,
			0, 1.732, 0, 0,
			0, 0, -1.002, -1,
			0, 0, -0.2002, 0
		],
		near: 0.1,
		far: 100,
		fov: 50
	};

}

export function createDefaultVisualContract() {

	const invariants = [
		'primary silhouette visible without post-processing',
		'diagnostics expose final, no-post, and MRT-like control channels',
		'timing explicitly labels unavailable GPU timestamps'
	];

	return {
		subject: 'webgpu-validation-harness-demo',
		identity: [ 'deterministic evidence bundle', 'fixed camera', 'nonblank captures' ],
		silhouette: [ 'primary shape remains visible in images/no-post.design.png' ],
		materialSeparation: [ 'diagnostic mosaic separates beauty, depth/normal proxy, and emissive proxy' ],
		motion: [ 'temporal checkpoints use fixed frame indices' ],
		cameraEnvelope: { near: 2, design: 8, far: 18 },
		lightingEnvelope: [ 'scene-linear HDR is recorded before output conversion' ],
		invariants,
		invariantArtifacts: {
			[ invariants[ 0 ] ]: {
				requiredImages: [ 'images/no-post.design.png', 'images/final.design.png' ],
				requiredDiagnostics: [ 'no-post baseline', 'nonblank PNG check' ],
				requiredMetrics: [ 'renderer-info.json.info.render.calls' ],
				blockingFailures: [ 'blank no-post capture', 'final-only evidence' ]
			},
			[ invariants[ 1 ] ]: {
				requiredImages: [ 'images/diagnostics.mosaic.png' ],
				requiredDiagnostics: [ 'diagnostic mosaic', 'render-targets.json' ],
				requiredMetrics: [ 'render-targets.json.totalBytes' ],
				blockingFailures: [ 'missing diagnostics', 'undeclared render-target owner' ]
			},
			[ invariants[ 2 ] ]: {
				requiredImages: [ 'images/temporal.t000.png', 'images/temporal.t001.png' ],
				requiredDiagnostics: [ 'timing label', 'temporal checkpoints' ],
				requiredMetrics: [ 'timings.json.cpuFrameMs', 'timings.json.gpuTimingLabel' ],
				blockingFailures: [ 'GPU timing claimed from CPU-only proxy', 'temporal checkpoints absent' ]
			}
		},
		allowedDivergences: [ 'Node run emits synthetic PNGs; browser runs replace them with canvas captures.' ],
		requiredImages: getRequiredImagePaths(),
		requiredDiagnostics: [ 'backend manifest', 'no-post baseline', 'diagnostic mosaic', 'seed sweep', 'temporal checkpoints', 'leak-loop' ],
		requiredMetrics: [ 'renderer-info.json', 'render-targets.json', 'storage-resources.json', 'timings.json', 'leak-loop.json' ],
		blockingFailures: [ 'final-only evidence bundle', 'blank PNG', 'missing nullable backend reason', 'unlabelled CPU-only timing' ],
		frameBudgetMs: {
			desktopDiscrete: 8,
			desktopIntegrated: 16,
			mobile: 24
		},
		memoryBudgetMB: 128
	};

}

export function createRendererInfoRecord() {

	return {
		threeRevision: THREE.REVISION,
		renderer: 'WebGPURenderer',
		isPrimaryBackend: null,
		coordinateSystem: null,
		initialized: false,
		outputBufferType: null,
		compatibilityMode: null,
		trackTimestamp: null,
		features: null,
		limits: null,
		unavailableReason: 'Node evidence generation did not create a browser WebGPU renderer.',
		info: {
			render: { calls: 1, triangles: 2, points: 0, lines: 0, frame: 1, timestamp: null },
			compute: { calls: 0, frameCalls: 0, timestamp: null },
			memory: { geometries: 0, textures: 0 }
		}
	};

}

export function createEvidenceManifest( artifactDir ) {

	return {
		skill: 'threejs-visual-validation',
		sceneId: 'webgpu-validation-harness-demo',
		threeRevision: THREE.REVISION,
		browser: 'not-run',
		os: process.platform,
		gpuAdapter: null,
		renderer: 'WebGPURenderer',
		backend: {
			isPrimaryBackend: null,
			coordinateSystem: null,
			initialized: false,
			deviceLostObserved: false,
			uncapturedErrors: [],
			features: null,
			limits: null,
			unavailableReason: 'Browser WebGPU backend is unavailable during Node artifact generation.'
		},
		qualityTier: 'node-schema-fixture',
		viewport: { width: 96, height: 64, dpr: 1 },
		camera: makeCameraRecord(),
		seed: 'seed-0001',
		time: { fixed: true, seconds: 0, frame: 0 },
		assets: [],
		colorPipeline: {
			rendererOutputColorSpace: 'SRGBColorSpace',
			rendererToneMapping: 'NoToneMapping',
			rendererToneMappingExposure: 1,
			outputBufferType: 'HalfFloatType',
			toneMapOwner: 'RenderPipeline',
			outputTransformOwner: 'renderOutput',
			hdrWorkingType: 'HalfFloatType',
			colorTextures: [],
			dataTextures: [],
			screenshotEncoding: 'PNG sRGB from harness capture'
		},
		postStack: {
			renderPipeline: 'RenderPipeline',
			outputColorTransform: false,
			renderOutputOwner: true,
			scenePasses: 1,
			mrtOutputs: [ 'output', 'normal', 'emissive' ],
			importAnchors: Object.keys( r185NodePipelineImports )
		},
		thresholds: {
			nonblank: { minRange: 8 },
			budgetProfile: 'desktopDiscrete',
			perViewPixelDiff: {
				final: {
					baseline: 'images/final.design.png',
					candidate: 'images/final.design.png',
					maxRatio: 0
				}
			},
			cameraMatrixRequired: true
		},
		stochasticMasks: [
			{ name: 'none', path: null, reason: 'deterministic synthetic bundle' }
		],
		knownCompromises: [
			`Node-only artifact generation wrote ${ artifactDir }; browser runs must replace synthetic PNGs with WebGPU canvas captures.`
		]
	};

}

export function createTargetInventory() {

	const readback = getExpectedWebGPUReadbackLayout( 96, 64, 4 );

	return {
		required: true,
		totalBytes: 96 * 64 * 8 * 3,
		targets: [
			{
				name: 'scene-output',
				role: 'beauty',
				owner: 'scene pass MRT output',
				width: 96,
				height: 64,
				dprScale: 'full',
				format: 'RGBAFormat',
				type: 'HalfFloatType',
				colorSpace: 'scene-linear HDR',
				samples: 1,
				depthStencil: 'depth texture from scene pass',
				mrtCount: 3,
				lifetime: 'capture-only',
				memoryBytes: 96 * 64 * 8,
				readback
			},
			{
				name: 'scene-normal',
				role: 'normal diagnostic',
				owner: 'scene pass MRT normal',
				width: 96,
				height: 64,
				dprScale: 'full',
				format: 'RGBAFormat',
				type: 'HalfFloatType',
				colorSpace: 'NoColorSpace',
				samples: 1,
				depthStencil: 'shared scene depth',
				mrtCount: 3,
				lifetime: 'capture-only',
				memoryBytes: 96 * 64 * 8,
				readback
			},
			{
				name: 'scene-emissive',
				role: 'emissive diagnostic',
				owner: 'scene pass MRT emissive',
				width: 96,
				height: 64,
				dprScale: 'full',
				format: 'RGBAFormat',
				type: 'HalfFloatType',
				colorSpace: 'scene-linear HDR',
				samples: 1,
				depthStencil: 'shared scene depth',
				mrtCount: 3,
				lifetime: 'capture-only',
				memoryBytes: 96 * 64 * 8,
				readback
			}
		]
	};

}

export function createStorageInventory() {

	return {
		required: true,
		totalBytes: 0,
		resources: [
			{
				name: 'none',
				kind: 'not used by demo contract',
				dimensions: 0,
				format: null,
				bytes: 0,
				ownerDispatch: null,
				dispatchSize: null,
				workgroupAssumptions: null,
				synchronization: 'none',
				readbackPolicy: 'none',
				resetPolicy: 'not applicable'
			}
		]
	};

}

export function createTimingRecord( timestampEvidence = null ) {

	const renderTimestampMs = timestampEvidence?.gpuTimingUnavailable === false && Number.isFinite( timestampEvidence.renderTimestampMs ) ? timestampEvidence.renderTimestampMs : null;
	const computeTimestampMs = timestampEvidence?.gpuTimingUnavailable === false && Number.isFinite( timestampEvidence.computeTimestampMs ) ? timestampEvidence.computeTimestampMs : null;
	const hasGpuTiming = renderTimestampMs !== null;

	return {
		required: true,
		warmupFrames: 0,
		sampleFrames: 2,
		cpuFrameMs: { median: 0.1, p95: 0.2, unit: 'ms' },
		gpuFrameMs: hasGpuTiming ? { median: renderTimestampMs, p95: renderTimestampMs, unit: 'ms' } : null,
		gpuTimingUnavailable: hasGpuTiming === false,
		gpuTimingLabel: hasGpuTiming ? 'GPU timestamp' : 'CPU-only proxy',
		renderTimestampMs,
		computeTimestampMs,
		readbackCaptureMs: { median: 0.3, p95: 0.5, unit: 'ms' },
		drawCalls: 1,
		triangles: 2,
		passCount: 1,
		dispatchCount: 0,
		renderTargetMemoryBytes: createTargetInventory().totalBytes,
		storageMemoryBytes: 0,
		qualityTierChanges: []
	};

}

export function createLeakLoopRecord() {

	const before = { rendererInfoMemory: { geometries: 0, textures: 0 }, targetBytes: createTargetInventory().totalBytes, storageBytes: 0 };
	const makeLoop = ( name ) => ( {
		name,
		iterations: 2,
		before,
		after: before,
		deltas: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
		thresholds: { geometries: 0, textures: 0, targetBytes: 0, storageBytes: 0 },
		pass: true
	} );

	return {
		required: true,
		loops: [
			makeLoop( 'resize' ),
			makeLoop( 'dpr-change' ),
			makeLoop( 'quality-tier-switch' ),
			makeLoop( 'debug-mode-switch' ),
			makeLoop( 'history-reset' ),
			makeLoop( 'asset-reload' ),
			makeLoop( 'scene-teardown' ),
			makeLoop( 'dispose-recreate' )
		],
		summary: { pass: true, uncapturedBackendErrors: [], knownInternalCacheDeltas: [] },
		allowedCacheNotes: [ 'Node demo has no renderer-owned internal caches; browser runs must replace this with real before/after renderer.info values.' ]
	};

}

async function writeJson( path, data ) {

	await writeFile( path, `${ JSON.stringify( data, null, 2 ) }\n` );

}

async function readFixtureJson( path ) {

	const url = new URL( `../fixtures/${ path }`, import.meta.url );
	return JSON.parse( await readFile( url, 'utf8' ) );

}

async function copyPixelDiffFixture( artifactDir, name ) {

	const targetDir = join( artifactDir, 'fixtures/pixel-diff' );
	await mkdir( targetDir, { recursive: true } );
	await copyFile( new URL( `../fixtures/pixel-diff/${ name }`, import.meta.url ), join( targetDir, name ) );

}

export async function writeDefaultEvidenceBundle( artifactDir, options = {} ) {

	await mkdir( join( artifactDir, 'images' ), { recursive: true } );

	const manifest = createEvidenceManifest( artifactDir );
	let timings = createTimingRecord( options.timestampEvidence );

	if ( options.fixture === 'over-budget' ) {

		timings = await readFixtureJson( 'budgets/over-budget-timings.json' );

	} else if ( options.fixture === 'pixel-diff-fail' ) {

		await copyPixelDiffFixture( artifactDir, 'identical-a.png' );
		await copyPixelDiffFixture( artifactDir, 'one-pixel-off.png' );
		manifest.thresholds.perViewPixelDiff.final = {
			baseline: 'fixtures/pixel-diff/identical-a.png',
			candidate: 'fixtures/pixel-diff/one-pixel-off.png',
			maxRatio: 0.01
		};

	} else if ( options.fixture !== undefined && options.fixture !== null ) {

		throw new Error( `Unknown fixture "${ options.fixture }"; valid fixtures: over-budget, pixel-diff-fail. A silently ignored fixture name would turn a negative test into a false pass.` );

	}

	await writeJson( join( artifactDir, 'visual-contract.json' ), createDefaultVisualContract() );
	await writeJson( join( artifactDir, 'evidence-manifest.json' ), manifest );
	await writeJson( join( artifactDir, 'renderer-info.json' ), createRendererInfoRecord() );
	await writeJson( join( artifactDir, 'render-targets.json' ), createTargetInventory() );
	await writeJson( join( artifactDir, 'storage-resources.json' ), createStorageInventory() );
	await writeJson( join( artifactDir, 'timings.json' ), timings );
	await writeJson( join( artifactDir, 'leak-loop.json' ), createLeakLoopRecord() );

	for ( const imagePath of getRequiredImagePaths() ) {

		await writeFile( join( artifactDir, imagePath ), createDiagnosticPng( 96, 64, imagePath ) );

	}

	return validateArtifactBundle( artifactDir, { strict: options.strict === true } );

}
