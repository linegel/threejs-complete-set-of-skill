import { createHash } from 'node:crypto';

import { numericDatum, stableStringify } from './physical-evidence-common.js';
import {
	CORRECTNESS_CAPTURE_RECIPE_KIND,
	CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
	CORRECTNESS_CAPTURE_RECIPES
} from './correctness-capture-recipes.js';
import { VALIDATION_MODE_OUTPUT_NODE_IDS } from './browser-subject-adapter.js';

const HASH_A = `sha256:${ 'a'.repeat( 64 ) }`;
const HASH_B = `sha256:${ 'b'.repeat( 64 ) }`;
const HASH_C = `sha256:${ 'c'.repeat( 64 ) }`;
const HASH_D = `sha256:${ 'd'.repeat( 64 ) }`;

export const CORRECTNESS_STANDARD_OUTPUTS = Object.freeze( [
	'final.design.png',
	'no-post.design.png',
	'diagnostics.mosaic.png',
	'camera.near.png',
	'camera.design.png',
	'camera.far.png',
	'seed-0001.final.png',
	'seed-9e3779b9.final.png',
	'temporal.t000.png',
	'temporal.t001.png'
] );

function hashFixtureValue( value ) {

	return `sha256:${ createHash( 'sha256' ).update( stableStringify( value ) ).digest( 'hex' ) }`;

}

function byteHash( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

export function createCorrectnessStateFixture( recipe = null ) {

	const state = recipe?.effectiveState ?? {
		scenario: 'browser-capture',
		mode: 'final',
		tier: 'webgpu-correctness',
		camera: 'design',
		seed: 1,
		timeSeconds: 0,
		viewport: { width: 1200, height: 800, dpr: 1 }
	};
	const scale = recipe?.expectedSceneScale ?? 1;
	const fullWidth = Math.round( state.viewport.width * state.viewport.dpr );
	const fullHeight = Math.round( state.viewport.height * state.viewport.dpr );
	const outputNodeId = VALIDATION_MODE_OUTPUT_NODE_IDS[ state.mode ];
	return {
		schemaVersion: 1,
		scenario: state.scenario,
		mode: state.mode,
		tier: state.tier,
		camera: state.camera,
		seed: state.seed,
		timeSeconds: state.timeSeconds,
		viewport: structuredClone( state.viewport ),
		passScale: scale,
		outputNodeMode: state.mode,
		outputNodeId,
		outputNodeUuid: `output-node-${ state.mode }`,
		outputNodeType: 'RenderOutputNode',
		cameraState: {
			matrixWorld: Array.from( { length: 16 }, ( _, index ) => index % 5 === 0 ? 1 : 0 ),
			projectionMatrix: Array.from( { length: 16 }, ( _, index ) => index + 0.25 )
		},
		subjectMatrixWorld: Array.from( { length: 16 }, ( _, index ) => index % 5 === 0 ? 1 : 0 ),
		markerPosition: [ - 2.15, 0, - 0.5 ],
		captureTarget: { width: fullWidth, height: fullHeight },
		sceneTarget: {
			width: Math.max( 1, Math.round( fullWidth * scale ) ),
			height: Math.max( 1, Math.round( fullHeight * scale ) )
		},
		rendererTarget: { kind: 'presentation', textureUuid: null },
		device: {
			controllerGeneration: 1,
			rendererDeviceGeneration: 1,
			deviceLossGeneration: 0,
			rendererDeviceStatus: 'active',
			deviceLostObserved: false,
			backendDeviceIdentityVerified: true,
			nativeWebGPUBackend: true,
			uncapturedErrorCount: 0
		}
	};

}

export function createCorrectnessResourceLedgerFixture( width, height, scale = 1 ) {

	const sceneWidth = Math.max( 1, Math.round( width * scale ) );
	const sceneHeight = Math.max( 1, Math.round( height * scale ) );
	const contracts = {
		output: [ 'rgba16float', 8, 'scene-pass' ],
		normal: [ 'rgba16float', 8, 'scene-pass' ],
		emissive: [ 'rgba16float', 8, 'scene-pass' ],
		depth: [ 'depth32float', 4, 'scene-pass' ],
		'capture-target': [ 'rgba8unorm-srgb', 4, 'validation-capture' ]
	};
	const renderTargets = Object.entries( contracts ).map( ( [ semantic, [ format, bytesPerTexel, owner ] ] ) => {

		const targetWidth = semantic === 'capture-target' ? width : sceneWidth;
		const targetHeight = semantic === 'capture-target' ? height : sceneHeight;
		const bytes = targetWidth * targetHeight * bytesPerTexel;
		return {
			semantic,
			owner,
			targetName: semantic === 'capture-target' ? 'validation-capture-target' : 'validation-scene-target',
			textureUuid: `texture-${ semantic }`,
			width: targetWidth,
			height: targetHeight,
			depth: 1,
			format,
			sampleCount: 1,
			bytesPerTexel,
			bytes,
			logicalBytes: bytes,
			liveBytes: bytes,
			liveness: 'live'
		};

	} );
	return {
		schemaVersion: 1,
		state: 'live',
		renderTargets,
		sceneMrt: {
			uuid: 'mrt-validation-scene',
			type: 'MRTNode',
			liveness: 'live',
			outputs: [ 'output', 'normal', 'emissive' ].map( ( semantic ) => ( {
				semantic,
				nodeUuid: `node-${ semantic }`,
				nodeType: 'PassMultipleTextureNode'
			} ) )
		},
		geometries: [ { uuid: 'geometry-subject', allocationIds: [ 'allocation-subject' ], liveness: 'live' } ],
		geometryAllocations: [ {
			id: 'allocation-subject',
			bindings: [ 'geometry-subject:position' ],
			logicalBytes: 128,
			liveBytes: 128,
			liveness: 'live'
		} ],
		storageResources: [],
		trackedRenderTargetBytes: renderTargets.reduce( ( sum, target ) => sum + target.liveBytes, 0 ),
		trackedGeometryBytes: 128
	};

}

export function createCorrectnessRuntimeFixture( { finalized = false } = {} ) {

	return {
		metrics: {
			nativeWebGPU: true,
			initialized: true,
			backend: 'webgpu',
			runtimeProfile: 'correctness',
			timestampQueriesRequired: false,
			timestampQueriesRequested: false,
			timestampQueriesActive: false,
			captureTransaction: { active: null, poisoned: null, nextSequence: finalized ? 15 : 1 },
			postCommitPoison: null,
			controllerOperation: { active: null, nextSequence: finalized ? 20 : 2 },
			disposal: { started: false },
			routeLock: { kind: 'tier', id: 'webgpu-correctness' },
			scenario: 'browser-capture',
			mode: 'final',
			tier: 'webgpu-correctness',
			camera: 'design',
			seed: 1,
			timeSeconds: 0,
			viewport: { width: 1200, height: 800, dpr: 1 }
		},
		pipeline: {
			runtimeProfile: 'correctness',
			timestampQueriesRequired: false,
			timestampQueriesRequested: false,
			timestampQueriesActive: false
		},
		resources: createCorrectnessResourceLedgerFixture( 1200, 800 )
	};

}

export function createTierResourceBindingFixture( target ) {

	return Object.fromEntries( [
		'semantic',
		'owner',
		'targetName',
		'textureUuid',
		'width',
		'height',
		'format',
		'bytes',
		'logicalBytes',
		'liveBytes',
		'liveness'
	].map( ( key ) => [ key, target[ key ] ?? null ] ) );

}

export function createCorrectnessCaptureLayoutsFixture( width, height, sourceByteLength = null ) {

	const rowBytes = width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const minimumByteLength = bytesPerRow * ( height - 1 ) + rowBytes;
	const fullyPaddedByteLength = bytesPerRow * height;
	const transportByteLength = sourceByteLength ?? fullyPaddedByteLength;
	return {
		readback: { width, height, bytesPerTexel: 4, rowBytes, bytesPerRow, minimumByteLength, fullyPaddedByteLength, alignment: 256 },
		transport: {
			width,
			height,
			rowBytes,
			bytesPerRow,
			byteLength: transportByteLength,
			format: 'rgba8unorm',
			origin: 'top-left',
			padding: transportByteLength === fullyPaddedByteLength ? 'full-final-row' : 'tight-final-row'
		},
		normalized: { width, height, rowBytes, bytesPerRow, byteLength: fullyPaddedByteLength, format: 'rgba8unorm', origin: 'top-left' }
	};

}

export function createCorrectnessCaptureSessionFixture() {

	const recipeSetDigest = hashFixtureValue( {
		schemaVersion: CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
		recipeKind: CORRECTNESS_CAPTURE_RECIPE_KIND,
		recipes: CORRECTNESS_CAPTURE_RECIPES
	} );
	const parentState = createCorrectnessStateFixture();
	const parentResources = createCorrectnessResourceLedgerFixture( 1200, 800 );
	let submissions = { renderSubmissionCount: 10, scenePassExecutionCount: 10, modeSelectionCount: 5 };
	let resetEvents = [];
	const writtenCaptures = [];
	for ( const [ index, recipe ] of CORRECTNESS_CAPTURE_RECIPES.entries() ) {

		const entryState = structuredClone( parentState );
		const effectiveState = createCorrectnessStateFixture( recipe );
		const restoredState = structuredClone( parentState );
		const entrySubmissions = structuredClone( submissions );
		const captureRenders = 1 + recipe.effectiveState.timeline.stepSeconds.length;
		const effectiveSubmissions = {
			renderSubmissionCount: entrySubmissions.renderSubmissionCount + captureRenders,
			scenePassExecutionCount: entrySubmissions.scenePassExecutionCount + captureRenders,
			modeSelectionCount: entrySubmissions.modeSelectionCount + 1
		};
		const restoredSubmissions = {
			renderSubmissionCount: effectiveSubmissions.renderSubmissionCount + 1,
			scenePassExecutionCount: effectiveSubmissions.scenePassExecutionCount + 1,
			modeSelectionCount: effectiveSubmissions.modeSelectionCount + 1
		};
		submissions = restoredSubmissions;
		const entryResetEvents = structuredClone( resetEvents );
		const appendedDuringCapture = recipe.effectiveState.timeline.resetHistoryCause === null ? [] : [ {
			cause: recipe.effectiveState.timeline.resetHistoryCause,
			timeSeconds: recipe.effectiveState.timeline.initialTimeSeconds
		} ];
		resetEvents = [ ...resetEvents, ...appendedDuringCapture ];
		const telemetry = {
			entry: { resetEventCount: entryResetEvents.length, resetEvents: entryResetEvents },
			effective: { resetEventCount: resetEvents.length, resetEvents: structuredClone( resetEvents ) },
			restored: { resetEventCount: resetEvents.length, resetEvents: structuredClone( resetEvents ) },
			appendedDuringCapture: structuredClone( appendedDuringCapture ),
			appendedDuringRestoration: [],
			historyResetDelta: appendedDuringCapture.length,
			restorationHistoryResetDelta: 0
		};
		const effectiveResources = createCorrectnessResourceLedgerFixture(
			Math.round( recipe.effectiveState.viewport.width * recipe.effectiveState.viewport.dpr ),
			Math.round( recipe.effectiveState.viewport.height * recipe.effectiveState.viewport.dpr ),
			recipe.expectedSceneScale
		);
		const width = effectiveState.captureTarget.width;
		const height = effectiveState.captureTarget.height;
		const layouts = createCorrectnessCaptureLayoutsFixture( width, height );
		const evidence = {
			schemaVersion: 1,
			evidenceKind: 'validation-harness-correctness-capture-transaction-v1',
			claimScope: { correctness: true, performance: false, gpuAttribution: false },
			recipe: {
				id: recipe.id,
				schemaVersion: recipe.schemaVersion,
				digest: hashFixtureValue( recipe ),
				setDigest: recipeSetDigest,
				parentRoute: structuredClone( recipe.parentRoute ),
				captureFilename: recipe.capture.filename,
				target: recipe.capture.target,
				declaredEffectiveState: structuredClone( recipe.effectiveState ),
				expectedSceneScale: recipe.expectedSceneScale
			},
			transaction: {
				schemaVersion: 1,
				status: 'COMMITTED',
				transactionId: `capture-${ index + 1 }`,
				sequence: index + 1,
				recipeId: recipe.id,
				entryStateDigest: hashFixtureValue( entryState ),
				restoredStateDigest: hashFixtureValue( restoredState ),
				restorationVerdict: 'PASS',
				phaseVerdicts: { capture: 'PASS', restore: 'PASS', settle: 'PASS', verify: 'PASS' }
			},
			entryState,
			parentStartupStateDigest: hashFixtureValue( entryState ),
			effectiveState,
			effectiveStateDigest: hashFixtureValue( effectiveState ),
			restoredState,
			resources: {
				entry: structuredClone( parentResources ),
				effective: effectiveResources,
				restored: structuredClone( parentResources )
			},
			submissions: {
				entry: entrySubmissions,
				effective: effectiveSubmissions,
				restored: restoredSubmissions,
				captureDelta: { renderSubmissions: captureRenders, scenePassExecutions: captureRenders, modeSelections: 1 },
				restorationDelta: { renderSubmissions: 1, scenePassExecutions: 1, modeSelections: 1 },
				captureRenderTrace: [],
				restorationRenderTrace: [ {
					sequence: effectiveSubmissions.renderSubmissionCount + 1,
					timeSeconds: entryState.timeSeconds,
					target: 'presentation',
					mode: entryState.mode,
					tier: entryState.tier
				} ]
			},
			telemetry,
			runtimeProfile: 'correctness',
			passScale: recipe.expectedSceneScale,
			layouts
		};
		let traceTime = recipe.effectiveState.timeline.initialTimeSeconds;
		for ( const deltaSeconds of recipe.effectiveState.timeline.stepSeconds ) {

			evidence.submissions.captureRenderTrace.push( {
				sequence: entrySubmissions.renderSubmissionCount + evidence.submissions.captureRenderTrace.length + 1,
				timeSeconds: traceTime,
				target: 'presentation',
				mode: recipe.effectiveState.mode,
				tier: recipe.effectiveState.tier
			} );
			traceTime += deltaSeconds;

		}
		evidence.submissions.captureRenderTrace.push( {
			sequence: entrySubmissions.renderSubmissionCount + evidence.submissions.captureRenderTrace.length + 1,
			timeSeconds: traceTime,
			target: 'capture-target',
			mode: recipe.effectiveState.mode,
			tier: recipe.effectiveState.tier
		} );
		const bytesPerRow = layouts.readback.rowBytes;
		const sourceBytesPerRow = layouts.readback.bytesPerRow;
		const sourceByteLength = layouts.readback.fullyPaddedByteLength;
		const stem = recipe.capture.filename.slice( 0, - 4 );
		writtenCaptures.push( {
			target: recipe.id,
			captureMode: recipe.capture.target,
			width,
			height,
			bytesPerPixel: 4,
			bytesPerRow,
			sourceBytesPerRow,
			sourceByteLength,
			transportByteLength: sourceByteLength,
			sourceLayout: 'padded',
			sourceOrigin: 'top-left',
			origin: 'top-left',
			orientationTransform: 'none',
			sourceFormat: 'rgba8unorm',
			format: 'rgba8',
			colorEncoding: { colorManaged: true },
			evidence,
			transport: {
				artifact: { path: `transport-readbacks/${ stem }.rgba8.bin`, sha256: HASH_B, byteLength: sourceByteLength },
				layout: structuredClone( layouts.transport )
			},
			normalized: {
				artifact: { path: `normalized-readbacks/${ stem }.rgba8.padded.bin`, sha256: HASH_C, byteLength: sourceByteLength },
				layout: 'cpu-normalized-padded-rgba8',
				alignmentBytes: 256,
				bytesPerRow: sourceBytesPerRow,
				byteLength: sourceByteLength,
				origin: 'top-left',
				orientationTransform: 'none',
				compact: {
					layout: 'compact-rgba8',
					origin: 'top-left',
					bytesPerRow,
					byteLength: bytesPerRow * height,
					sha256: HASH_D
				},
				compactRgbaSha256: HASH_D,
				compactByteLength: bytesPerRow * height
			},
			png: {
				path: recipe.capture.filename,
				sha256: HASH_A,
				byteLength: 64,
				encoding: 'png-rgba8-srgb',
				derivedFromCompactRgbaSha256: HASH_D,
				width,
				height
			}
		} );

	}
	const tierCapture = ( id ) => writtenCaptures.find( ( capture ) => capture.target === id );
	const tierBinding = ( capture ) => {

		const effectiveTargets = new Map( capture.evidence.resources.effective.renderTargets.map( ( target ) => [ target.semantic, target ] ) );
		const transaction = capture.evidence.transaction;
		return {
			recipeId: capture.evidence.recipe.id,
			recipeDigest: capture.evidence.recipe.digest,
			filename: capture.png.path,
			pngSha256: capture.png.sha256,
			transaction: {
				transactionId: transaction.transactionId,
				sequence: transaction.sequence,
				status: transaction.status,
				entryStateDigest: transaction.entryStateDigest,
				restoredStateDigest: transaction.restoredStateDigest,
				restorationVerdict: transaction.restorationVerdict
			},
			normalized: {
				artifact: structuredClone( capture.normalized.artifact ),
				compactRgbaSha256: capture.normalized.compactRgbaSha256,
				compactByteLength: capture.normalized.compactByteLength,
				width: capture.width,
				height: capture.height
			},
			captureEvidenceSha256: hashFixtureValue( capture.evidence ),
			effectiveState: structuredClone( capture.evidence.effectiveState ),
			passScale: capture.evidence.passScale,
			resources: {
				captureTarget: createTierResourceBindingFixture( effectiveTargets.get( 'capture-target' ) ),
				sceneMrt: [ 'output', 'normal', 'emissive' ].map( ( semantic ) => createTierResourceBindingFixture( effectiveTargets.get( semantic ) ) )
			}
		};

	};
	const tierVisualEvidence = {
		schemaVersion: 1,
		kind: 'validation-harness-tier-visual-evidence-v1',
		binding: {
			reference: tierBinding( tierCapture( 'tier.target-performance.final' ) ),
			candidate: tierBinding( tierCapture( 'tier.governor-stress.final' ) )
		},
		metrics: {
			meanRgbByteDifference: numericDatum( 2, 'mean-rgb-byte-difference', 'Measured', 'fixed readbacks' ),
			edgeMaskPixels: numericDatum( 100, 'pixels', 'Measured', 'reference edge mask' ),
			edgeMeanRgbByteDifference: numericDatum( 3, 'mean-rgb-byte-difference', 'Measured', 'reference edge mask' ),
			edgeP95RgbByteDifference: numericDatum( 4, 'mean-rgb-byte-difference', 'Measured', 'reference edge mask' )
		},
		gates: {
			meanRgbByteDifference: numericDatum( 8, 'mean-rgb-byte-difference', 'Gated', 'frozen correctness gate' ),
			edgeP95RgbByteDifference: numericDatum( 32, 'mean-rgb-byte-difference', 'Gated', 'frozen correctness gate' )
		},
		bindingSha256: null,
		verdict: 'PASS'
	};
	tierVisualEvidence.bindingSha256 = hashFixtureValue( {
		binding: tierVisualEvidence.binding,
		metrics: tierVisualEvidence.metrics,
		gates: tierVisualEvidence.gates
	} );
	const mosaic = {
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: 'diagnostics.mosaic.png',
		width: 2400,
		height: 1600,
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
		derivation: { kind: 'four-route-contact-sheet' },
		file: { path: 'diagnostics.mosaic.png', sha256: HASH_D, byteLength: 80 },
		pixelEvidence: {
			png: { path: 'diagnostics.mosaic.png', sha256: HASH_D, byteLength: 80, derivedFromPackedRgbaSha256: HASH_C },
			normalized: {
				rawArtifact: { path: 'normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin', sha256: HASH_B, byteLength: 15564800 },
				packedArtifact: { path: 'normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin', sha256: HASH_C, byteLength: 15360000 },
				packedRgbaSha256: HASH_C,
				packedByteLength: 15360000,
				paddedBytesPerRow: 9728,
				width: 2400,
				height: 1600,
				rowBytes: 9600,
				bytesPerRow: 9728,
				origin: 'top-left',
				paddingVerifiedZero: true
			}
		}
	};
	const outputPlan = CORRECTNESS_STANDARD_OUTPUTS.map( ( filename ) => {

		if ( filename === 'diagnostics.mosaic.png' ) return {
			id: 'diagnostics.mosaic',
			status: 'CAPTURED',
			filename,
			sourceCaptures: structuredClone( mosaic.sourceCaptures ),
			artifact: structuredClone( mosaic.file ),
			derivation: { kind: 'hook-validated-derived-output', validationStatus: 'PASS' }
		};
		const capture = writtenCaptures.find( ( candidate ) => candidate.png.path === filename );
		return {
			id: filename.slice( 0, - 4 ),
			status: 'CAPTURED',
			filename,
			artifact: structuredClone( capture.png ),
			derivation: {
				kind: 'direct-render-target-readback',
				validationStatus: 'PASS',
				pixelEvidence: structuredClone( capture.png )
			}
		};

	} );
	const artifactWrites = [];
	const write = ( path, kind, sha256, byteLength ) => artifactWrites.push( {
		sequence: artifactWrites.length + 1,
		path,
		kind,
		existedBefore: false,
		contentBinding: 'sha256-byte-length-immutable-buffer-v1',
		sha256,
		byteLength
	} );
	for ( const capture of writtenCaptures ) {

		write( capture.png.path, 'writeCapture-png', capture.png.sha256, capture.png.byteLength );
		write( capture.transport.artifact.path, 'writeCapture-transport', capture.transport.artifact.sha256, capture.transport.artifact.byteLength );
		write( capture.normalized.artifact.path, 'writeCapture-normalized', capture.normalized.artifact.sha256, capture.normalized.artifact.byteLength );

	}
	write( mosaic.file.path, 'hook-artifact', mosaic.file.sha256, mosaic.file.byteLength );
	write( mosaic.pixelEvidence.normalized.rawArtifact.path, 'hook-artifact', mosaic.pixelEvidence.normalized.rawArtifact.sha256, mosaic.pixelEvidence.normalized.rawArtifact.byteLength );
	write( mosaic.pixelEvidence.normalized.packedArtifact.path, 'hook-artifact', mosaic.pixelEvidence.normalized.packedArtifact.sha256, mosaic.pixelEvidence.normalized.packedArtifact.byteLength );
	const tierBytes = Buffer.from( `${ JSON.stringify( tierVisualEvidence, null, 2 ) }\n` );
	write( 'tier-visual-evidence.json', 'hook-artifact', byteHash( tierBytes ), tierBytes.byteLength );
	artifactWrites.push( {
		sequence: artifactWrites.length + 1,
		path: 'capture-session.json',
		kind: 'capture-session-record',
		existedBefore: false,
		contentBinding: 'self-excluded-finalized-offline',
		sha256: null,
		byteLength: null
	} );
	const runtime = createCorrectnessRuntimeFixture();
	const browserEntry = 'threejs-visual-validation/examples/webgpu-validation-harness/tier/webgpu-correctness/index.html';
	const url = `http://127.0.0.1:4173/${ browserEntry }?capture=1&profile=correctness`;
	const parentRouteState = { scenario: 'browser-capture', mode: 'final', tier: 'webgpu-correctness', camera: 'design', seed: 1, timeSeconds: 0 };
	return {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		sourceHash: HASH_A,
		sourceClosureHash: HASH_A,
		sourceClosure: { sourceHash: HASH_A, buildRevision: HASH_B, threeRevision: '0.185.1' },
		buildRevision: HASH_B,
		threeRevision: '0.185.1',
		profile: 'correctness',
		profileConfig: { width: 1200, height: 800, dpr: 1 },
		automationSurface: 'playwright-headless-chromium',
		adapterClass: 'hardware',
		adapterIdentity: { vendor: 'Apple', device: 'M-series' },
		browser: { automationSurface: 'playwright-headless-chromium', name: 'Chromium', platform: 'macOS' },
		browserEntry,
		url,
		finalUrl: url,
		route: {
			requestedUrl: url,
			finalUrl: url,
			browserEntry,
			manifestLabId: 'webgpu-validation-harness',
			lockedState: structuredClone( parentRouteState ),
			observedState: structuredClone( parentRouteState ),
			finalState: structuredClone( parentRouteState )
		},
		startedAt: '2026-07-12T09:00:00.000Z',
		finishedAt: '2026-07-12T09:01:00.000Z',
		runtime,
		finalRuntime: createCorrectnessRuntimeFixture( { finalized: true } ),
		outputPlan,
		writtenCaptures,
		artifactWrites,
		hookResult: {
			status: 'incomplete',
			publishable: false,
			bundle: {
				bundleKind: 'raw-capture-candidate',
				publishable: false,
				claimVerdicts: {
					visualCorrectness: 'INSUFFICIENT_EVIDENCE',
					mechanismCorrectness: 'PASS',
					performanceCompliance: 'NOT_CLAIMED',
					gpuAttribution: 'INSUFFICIENT_EVIDENCE',
					lifecycleStability: 'PASS'
				}
			},
			gpuTiming: {
				verdict: 'NOT_CLAIMED',
				renderMs: null,
				computeMs: null,
				reason: 'Correctness profile does not request GPU timestamps.'
			},
			standardOutputs: [ mosaic ],
			tierVisualEvidence
		},
		pageErrors: [],
		consoleErrors: [],
		requestErrors: []
	};

}
