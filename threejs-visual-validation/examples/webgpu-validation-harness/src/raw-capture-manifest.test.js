import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { encodeRgbaPng } from '../../../../scripts/lib/png-rgba.mjs';
import {
	createCorrectnessCaptureSessionFixture,
	createCorrectnessCaptureLayoutsFixture,
	createCorrectnessResourceLedgerFixture,
	createCorrectnessRuntimeFixture,
	createCorrectnessStateFixture
} from './correctness-capture-session.fixture.js';
import { CORRECTNESS_CAPTURE_RECIPES } from './correctness-capture-recipes.js';
import { reconstructDiagnosticMosaic } from './diagnostic-mosaic.js';
import { validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';
import { canonicalSha256, NORMATIVE_JSON_PATHS, STANDARD_IMAGE_PATHS } from './evidence-manifest-contract.js';
import { correctnessCaptureRequest, parseCorrectnessCaptureArgs } from './capture-correctness.js';
import {
	DIRECT_RECIPE_IMAGE_PATHS,
	RAW_IMAGE_PATHS,
	SUPPLEMENTAL_NORMATIVE_IMAGE_PATHS,
	SUPPLEMENTAL_NORMATIVE_JSON_PATHS,
	finalizeRawCorrectnessCapture
} from './raw-capture-manifest.js';

const PNG_FIXTURES = new Map();
let RAW_FIXTURE_CACHE_DIR = null;

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function png( index, width, height ) {

	const key = `${ index }:${ width }x${ height }`;
	if ( PNG_FIXTURES.has( key ) ) return PNG_FIXTURES.get( key ).png;

	const data = new Uint8Array( width * height * 4 );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const offset = ( y * width + x ) * 4;
		data.set( [
			( x + index * 17 ) & 0xff,
			( y * 3 + index * 29 ) & 0xff,
			( ( x >> 3 ) ^ ( y >> 3 ) ^ ( index * 31 ) ) & 0xff,
			255
		], offset );

	}
	const encoded = encodeRgbaPng( { width, height, data } );
	PNG_FIXTURES.set( key, { data: Buffer.from( data ), png: encoded } );
	return encoded;

}

function rgba( index, width, height ) {

	png( index, width, height );
	return PNG_FIXTURES.get( `${ index }:${ width }x${ height }` ).data;

}

function paddedRgba( compact, width, height ) {

	const rowBytes = width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const padded = Buffer.alloc( bytesPerRow * height );
	for ( let row = 0; row < height; row ++ ) compact.copy( padded, row * bytesPerRow, row * rowBytes, ( row + 1 ) * rowBytes );
	return { bytes: padded, rowBytes, bytesPerRow };

}

async function linkCachedRawFixture( outputDir, path, bytes ) {

	RAW_FIXTURE_CACHE_DIR ??= await mkdtemp( join( tmpdir(), 'threejs-raw-readback-cache-' ) );
	const digest = sha256( bytes );
	const cached = join( RAW_FIXTURE_CACHE_DIR, digest.slice( 'sha256:'.length ) );
	try {

		await writeFile( cached, bytes, { flag: 'wx' } );

	} catch ( error ) {

		if ( error.code !== 'EEXIST' ) throw error;

	}
	await mkdir( dirname( join( outputDir, path ) ), { recursive: true } );
	await link( cached, join( outputDir, path ) );
	return digest;

}

function numericEvidence( value, unit, label, source ) {

	return { value, unit, label, source };

}

function captureBinding( capture ) {

	const transaction = capture.evidence.transaction;
	const effectiveTargets = new Map( capture.evidence.resources.effective.renderTargets.map( ( target ) => [ target.semantic, target ] ) );
	const resourceBinding = ( target ) => Object.fromEntries( [
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
	return {
		recipeId: capture.target,
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
			artifact: capture.normalized.artifact,
			compactRgbaSha256: capture.normalized.compactRgbaSha256,
			compactByteLength: capture.normalized.compactByteLength,
			width: capture.width,
			height: capture.height
		},
		captureEvidenceSha256: canonicalSha256( capture.evidence ),
		effectiveState: capture.evidence.effectiveState,
		passScale: capture.evidence.passScale,
		resources: {
			captureTarget: resourceBinding( effectiveTargets.get( 'capture-target' ) ),
			sceneMrt: [ 'output', 'normal', 'emissive' ].map( ( semantic ) => resourceBinding( effectiveTargets.get( semantic ) ) )
		}
	};

}

function tierVisualEvidenceDocument( writtenCaptures ) {

	const byTarget = new Map( writtenCaptures.map( ( capture ) => [ capture.target, capture ] ) );
	const binding = {
		reference: captureBinding( byTarget.get( 'tier.target-performance.final' ) ),
		candidate: captureBinding( byTarget.get( 'tier.governor-stress.final' ) )
	};
	const metrics = {
		meanRgbByteDifference: numericEvidence( 1, 'mean-rgb-byte-difference', 'Measured', 'fixture retained tier readbacks' ),
		edgeMaskPixels: numericEvidence( 16, 'pixels', 'Measured', 'fixture reference edge mask' ),
		edgeMeanRgbByteDifference: numericEvidence( 1, 'mean-rgb-byte-difference', 'Measured', 'fixture reference edge mask' ),
		edgeP95RgbByteDifference: numericEvidence( 2, 'mean-rgb-byte-difference', 'Measured', 'fixture reference edge mask p95' )
	};
	const gates = {
		meanRgbByteDifference: numericEvidence( 8, 'mean-rgb-byte-difference', 'Gated', 'frozen correctness-capture tier degradation gate' ),
		edgeP95RgbByteDifference: numericEvidence( 32, 'mean-rgb-byte-difference', 'Gated', 'frozen correctness-capture reference-edge p95 gate' )
	};
	return {
		schemaVersion: 1,
		kind: 'validation-harness-tier-visual-evidence-v1',
		binding,
		metrics,
		gates,
		bindingSha256: canonicalSha256( { binding, metrics, gates } ),
		verdict: 'PASS'
	};

}

const correctnessState = createCorrectnessStateFixture;
const resourceLedger = createCorrectnessResourceLedgerFixture;

function correctnessRuntime( metrics ) {

	const runtime = createCorrectnessRuntimeFixture( { finalized: true } );
	Object.assign( runtime.metrics, metrics );
	return runtime;

}

async function refinalizeSessionDocument( outputDir, session, mutate ) {

	const document = JSON.parse( JSON.stringify( session ) );
	await mutate( document );
	const bytes = Buffer.from( `${ JSON.stringify( document, null, 2 ) }\n` );
	await writeFile( join( outputDir, 'capture-session.json' ), bytes );
	return bindFinalizedSessionBytes( document, bytes );

}

function insertWriteBeforeFinalizedSession( document, write ) {

	const finalized = document.artifactWrites.pop();
	if ( finalized?.path !== 'capture-session.json' ) throw new Error( 'Fixture write ledger does not end with capture-session.json.' );
	document.artifactWrites.push( {
		...write,
		sequence: document.artifactWrites.length + 1
	} );
	document.artifactWrites.push( {
		...finalized,
		sequence: document.artifactWrites.length + 1
	} );

}

function bindFinalizedSessionBytes( session, sessionBytes ) {

	Object.defineProperty( session, 'finalizedCaptureSessionFile', {
		configurable: false,
		enumerable: false,
		writable: false,
		value: {
			path: 'capture-session.json',
			contentBinding: 'finalized-file-hash-for-offline-promotion',
			sha256: sha256( sessionBytes ),
			byteLength: sessionBytes.byteLength
		}
	} );
	return session;

}

async function createRawSessionFixture() {

	const outputDir = await mkdtemp( join( tmpdir(), 'threejs-raw-capture-manifest-' ) );
	const artifactWrites = [];
	let sequence = 0;
	const write = async ( path, bytes, kind = 'hook-artifact' ) => {

		const payload = Buffer.isBuffer( bytes ) ? bytes : Buffer.from( bytes );
		if ( kind === 'writeCapture-transport' || kind === 'writeCapture-normalized' || path.endsWith( '.bin' ) ) await linkCachedRawFixture( outputDir, path, payload );
		else {

			await mkdir( dirname( join( outputDir, path ) ), { recursive: true } );
			await writeFile( join( outputDir, path ), payload );

		}
		const record = {
			sequence: ++ sequence,
			path,
			kind,
			existedBefore: false,
			contentBinding: 'sha256-byte-length-immutable-buffer-v1',
			sha256: sha256( payload ),
			byteLength: payload.byteLength
		};
		artifactWrites.push( record );
		return record;

	};
	for ( const path of NORMATIVE_JSON_PATHS ) {

		if ( path === 'evidence-manifest.json' ) continue;
		const artifact = path === 'pipeline-graph.json' ? {
			schemaVersion: 2,
			owners: { renderer: 'validation-subject', renderPipeline: 'validation-subject' },
			signals: [],
			sceneSubmissions: [],
			computeDispatches: [],
			resources: [],
			finalToneMapOwner: 'renderOutput',
			finalOutputTransformOwner: 'renderOutput'
		} : { schemaVersion: 2 };
		await write( path, `${ JSON.stringify( artifact ) }\n` );

	}
	const sharedSession = createCorrectnessCaptureSessionFixture();
	const recipeSetDigest = sharedSession.writtenCaptures[ 0 ].evidence.recipe.setDigest;
	const parentState = correctnessState();
	const parentResources = resourceLedger( 1200, 800 );
	let submissionCounters = { renderSubmissionCount: 10, scenePassExecutionCount: 10, modeSelectionCount: 5 };
	let resetEvents = [];
	const writtenCaptures = [];
	for ( const [ index, recipe ] of CORRECTNESS_CAPTURE_RECIPES.entries() ) {

		const entryState = structuredClone( parentState );
		const effectiveState = correctnessState( recipe );
		const restoredState = structuredClone( parentState );
		const entrySubmissions = structuredClone( submissionCounters );
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
		submissionCounters = restoredSubmissions;
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
		const fullWidth = effectiveState.captureTarget.width;
		const fullHeight = effectiveState.captureTarget.height;
		const compact = rgba( index, fullWidth, fullHeight );
		const padded = paddedRgba( compact, fullWidth, fullHeight );
		const stem = recipe.capture.filename.slice( 0, - '.png'.length );
		const transportPath = `transport-readbacks/${ stem }.rgba8.bin`;
		const normalizedPath = `normalized-readbacks/${ stem }.rgba8.padded.bin`;
		const pngBinding = await write( recipe.capture.filename, png( index, fullWidth, fullHeight ), 'writeCapture-png' );
		const transportBinding = await write( transportPath, padded.bytes, 'writeCapture-transport' );
		const normalizedBinding = await write( normalizedPath, padded.bytes, 'writeCapture-normalized' );
		const compactSha256 = sha256( compact );
		const effectiveResources = resourceLedger( fullWidth, fullHeight, recipe.expectedSceneScale );
		const captureRenderTrace = [];
		let renderTime = recipe.effectiveState.timeline.initialTimeSeconds;
		for ( const deltaSeconds of recipe.effectiveState.timeline.stepSeconds ) {

			captureRenderTrace.push( {
				sequence: entrySubmissions.renderSubmissionCount + captureRenderTrace.length + 1,
				timeSeconds: renderTime,
				target: 'presentation',
				mode: recipe.effectiveState.mode,
				tier: recipe.effectiveState.tier
			} );
			renderTime += deltaSeconds;

		}
		captureRenderTrace.push( {
			sequence: entrySubmissions.renderSubmissionCount + captureRenderTrace.length + 1,
			timeSeconds: renderTime,
			target: 'capture-target',
			mode: recipe.effectiveState.mode,
			tier: recipe.effectiveState.tier
		} );
		const evidence = {
			schemaVersion: 1,
			evidenceKind: 'validation-harness-correctness-capture-transaction-v1',
			claimScope: { correctness: true, performance: false, gpuAttribution: false },
			recipe: {
				id: recipe.id,
				schemaVersion: recipe.schemaVersion,
				digest: canonicalSha256( recipe ),
				setDigest: recipeSetDigest,
				parentRoute: structuredClone( recipe.parentRoute ),
				captureFilename: recipe.capture.filename,
				target: recipe.capture.target,
				declaredEffectiveState: structuredClone( recipe.effectiveState ),
				expectedSceneScale: recipe.expectedSceneScale
			},
			transaction: {
				schemaVersion: 1,
				transactionId: `capture-${ index + 1 }`,
				sequence: index + 1,
				status: 'COMMITTED',
				recipeId: recipe.id,
				entryStateDigest: canonicalSha256( entryState ),
				restoredStateDigest: canonicalSha256( restoredState ),
				restorationVerdict: 'PASS',
				phaseVerdicts: { capture: 'PASS', restore: 'PASS', settle: 'PASS', verify: 'PASS' }
			},
			entryState,
			parentStartupStateDigest: canonicalSha256( entryState ),
			effectiveState,
			effectiveStateDigest: canonicalSha256( effectiveState ),
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
				captureRenderTrace,
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
			layouts: createCorrectnessCaptureLayoutsFixture( fullWidth, fullHeight )
		};
		writtenCaptures.push( {
			target: recipe.id,
			captureMode: recipe.capture.target,
			width: fullWidth,
			height: fullHeight,
			bytesPerPixel: 4,
			bytesPerRow: padded.rowBytes,
			sourceBytesPerRow: padded.bytesPerRow,
			sourceByteLength: padded.bytes.byteLength,
			transportByteLength: padded.bytes.byteLength,
			sourceLayout: 'padded',
			sourceOrigin: 'top-left',
			origin: 'top-left',
			orientationTransform: 'none',
			sourceFormat: 'rgba8unorm',
			format: 'rgba8',
			colorEncoding: { colorManaged: true },
			png: {
				path: recipe.capture.filename,
				sha256: pngBinding.sha256,
				byteLength: pngBinding.byteLength,
				encoding: 'png-rgba8-srgb',
				derivedFromCompactRgbaSha256: compactSha256,
				width: fullWidth,
				height: fullHeight
			},
			transport: {
				artifact: { path: transportPath, sha256: transportBinding.sha256, byteLength: transportBinding.byteLength },
				layout: {
					width: fullWidth,
					height: fullHeight,
					rowBytes: padded.rowBytes,
					bytesPerRow: padded.bytesPerRow,
					byteLength: padded.bytes.byteLength,
					origin: 'top-left'
				}
			},
			normalized: {
				layout: 'cpu-normalized-padded-rgba8',
				alignmentBytes: 256,
				bytesPerRow: padded.bytesPerRow,
				byteLength: padded.bytes.byteLength,
				origin: 'top-left',
				orientationTransform: 'none',
				compact: {
					layout: 'compact-rgba8',
					origin: 'top-left',
					bytesPerRow: padded.rowBytes,
					byteLength: compact.byteLength,
					sha256: compactSha256
				},
				compactRgbaSha256: compactSha256,
				compactByteLength: compact.byteLength,
				artifact: { path: normalizedPath, sha256: normalizedBinding.sha256, byteLength: normalizedBinding.byteLength }
			},
			evidence
		} );

	}

	const mosaicIndex = DIRECT_RECIPE_IMAGE_PATHS.length;
	const mosaicCompact = rgba( mosaicIndex, 1200, 800 );
	const mosaicPadded = paddedRgba( mosaicCompact, 1200, 800 );
	const mosaicPaddedPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin';
	const mosaicCompactPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin';
	const mosaicBinding = await write( 'diagnostics.mosaic.png', png( mosaicIndex, 1200, 800 ), 'hook-artifact' );
	const mosaicPaddedBinding = await write( mosaicPaddedPath, mosaicPadded.bytes, 'hook-artifact' );
	const mosaicCompactBinding = await write( mosaicCompactPath, mosaicCompact, 'hook-artifact' );
	const mosaicOutput = {
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: 'diagnostics.mosaic.png',
		width: 1200,
		height: 800,
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
		derivation: { algorithm: 'quadrant-nearest-v1' },
		file: { path: 'diagnostics.mosaic.png', sha256: mosaicBinding.sha256, byteLength: mosaicBinding.byteLength },
		pixelEvidence: {
			png: {
				path: 'diagnostics.mosaic.png',
				sha256: mosaicBinding.sha256,
				byteLength: mosaicBinding.byteLength,
				derivedFromPackedRgbaSha256: sha256( mosaicCompact )
			},
			normalized: {
				rawArtifact: { path: mosaicPaddedPath, sha256: mosaicPaddedBinding.sha256, byteLength: mosaicPaddedBinding.byteLength },
				packedArtifact: { path: mosaicCompactPath, sha256: mosaicCompactBinding.sha256, byteLength: mosaicCompactBinding.byteLength },
				packedRgbaSha256: sha256( mosaicCompact ),
				packedByteLength: mosaicCompact.byteLength,
				paddedBytesPerRow: mosaicPadded.bytesPerRow,
				width: 1200,
				height: 800,
				rowBytes: mosaicPadded.rowBytes,
				bytesPerRow: mosaicPadded.bytesPerRow,
				origin: 'top-left',
				paddingVerifiedZero: true
			}
		}
	};
	const tierVisualEvidence = tierVisualEvidenceDocument( writtenCaptures );
	await write( SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ], `${ JSON.stringify( tierVisualEvidence, null, 2 ) }\n` );
	await write( 'capture-boundary.json', `${ JSON.stringify( { schemaVersion: 2, publishable: false } ) }\n` );
	const sourceClosureHash = canonicalSha256( { source: 'raw-capture-test' } );
	const buildRevision = canonicalSha256( { build: 'raw-capture-test' } );
	const metrics = {
		initialized: true,
		nativeWebGPU: true,
		backend: 'webgpu',
		rendererBackendEvidence: {
			isWebGPUBackend: true,
			deviceIdentityVerified: true,
			deviceIdentitySource: 'strict identity equality between requested GPUDevice and renderer.backend.device after renderer.init()'
		},
		rendererDeviceGeneration: 1,
		captureTransaction: { active: null, poisoned: null, nextSequence: 15 },
		postCommitPoison: null,
		controllerOperation: { active: null },
		disposal: { started: false },
		adapter: { features: [ 'timestamp-query' ] },
		rendererState: { outputColorSpace: 'srgb', toneMapping: 'NeutralToneMapping' },
		scenario: 'browser-capture',
		mode: 'final',
		tier: 'webgpu-correctness',
		camera: 'design',
		seed: 1,
		seedHex: '0x00000001',
		timeSeconds: 0
	};
	const state = structuredClone( sharedSession.route.lockedState );
	const { url, browserEntry } = sharedSession;
	const imageWrites = new Map( artifactWrites.filter( ( record ) => RAW_IMAGE_PATHS.includes( record.path ) ).map( ( record ) => [ record.path, record ] ) );
	const outputPlan = STANDARD_IMAGE_PATHS.map( ( filename ) => {

		const binding = imageWrites.get( filename );
		if ( filename === 'diagnostics.mosaic.png' ) return {
			id: 'diagnostics.mosaic',
			status: 'CAPTURED',
			filename,
			sourceCaptures: structuredClone( mosaicOutput.sourceCaptures ),
			artifact: { path: filename, sha256: binding.sha256, byteLength: binding.byteLength },
			derivation: { kind: 'hook-validated-derived-output', validationStatus: 'PASS' }
		};
		return {
			id: filename.slice( 0, - '.png'.length ),
			status: 'CAPTURED',
			filename,
			artifact: { path: filename, sha256: binding.sha256, byteLength: binding.byteLength },
			derivation: { kind: 'direct-render-target-readback', validationStatus: 'PASS' }
		};

	} );
	const runtime = correctnessRuntime( metrics );
	const session = {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		sourceHash: sourceClosureHash,
		sourceClosure: {
			sourceHash: sourceClosureHash,
			buildRevision,
			threeRevision: '0.185.1'
		},
		profile: 'correctness',
		profileConfig: { width: 1200, height: 800, dpr: 1 },
		automationSurface: 'playwright-headless-chromium',
		adapterClass: 'software',
		adapterIdentity: { vendor: 'fixture', architecture: 'software' },
		browser: { name: 'Chromium', version: 'fixture', platform: 'fixture-os', automationSurface: 'playwright-headless-chromium' },
		sourceClosureHash,
		buildRevision,
		threeRevision: '0.185.1',
		browserEntry,
		url,
		finalUrl: url,
		route: {
			requestedUrl: url,
			finalUrl: url,
			browserEntry,
			manifestLabId: 'webgpu-validation-harness',
			observedRuntimeLabId: 'webgpu-validation-harness',
			lockedState: state,
			observedState: state,
			finalState: state
		},
		startedAt: '2026-07-12T12:00:00.000Z',
		finishedAt: '2026-07-12T12:01:00.000Z',
		runtime,
		finalRuntime: structuredClone( runtime ),
		postDisposeSnapshot: { disposed: true },
		outputPlan,
		writtenCaptures,
		artifactWrites,
		hookResult: {
			status: 'incomplete',
			publishable: false,
			gpuTiming: structuredClone( sharedSession.hookResult.gpuTiming ),
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
			standardOutputs: [ mosaicOutput ],
			tierVisualEvidence
		},
		pageErrors: [],
		consoleErrors: [],
		requestErrors: []
	};
	artifactWrites.push( {
		sequence: ++ sequence,
		path: 'capture-session.json',
		kind: 'capture-session-record',
		existedBefore: false,
		contentBinding: 'self-excluded-finalized-offline',
		sha256: null,
		byteLength: null
	} );
	const sessionBytes = Buffer.from( `${ JSON.stringify( session, null, 2 ) }\n` );
	await writeFile( join( outputDir, 'capture-session.json' ), sessionBytes );
	bindFinalizedSessionBytes( session, sessionBytes );
	return { outputDir, session };

}

async function replaceImageAndRebind( outputDir, path, bytes ) {

	await writeFile( join( outputDir, path ), bytes );
	const manifestPath = join( outputDir, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	const image = manifest.images.find( ( entry ) => entry.path === path );
	image.sha256 = sha256( bytes );
	image.byteLength = bytes.byteLength;
	await writeFile( manifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n` );

}

async function replaceFileAndRebind( outputDir, path, bytes ) {

	await writeFile( join( outputDir, path ), bytes );
	const manifestPath = join( outputDir, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	const file = manifest.files.find( ( entry ) => entry.path === path );
	file.sha256 = sha256( bytes );
	file.byteLength = bytes.byteLength;
	await writeFile( manifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n` );

}

test( 'offline raw finalization binds the current correctness session without claiming publication', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	const result = await finalizeRawCorrectnessCapture( session, outputDir );
	assert.equal( result.bundleKind, 'raw-capture-session' );
	assert.equal( result.publishable, false );
	assert.deepEqual( result.captureProfiles, [ 'correctness' ] );
	assert.equal( result.claimVerdicts.visualCorrectness, 'INSUFFICIENT_EVIDENCE' );
	assert.equal( result.claimVerdicts.mechanismCorrectness, 'PASS' );
	assert.equal( result.claimVerdicts.performanceCompliance, 'NOT_CLAIMED' );
	const manifest = JSON.parse( await readFile( join( outputDir, 'evidence-manifest.json' ), 'utf8' ) );
	assert.equal( manifest.files.find( ( file ) => file.path === 'evidence-manifest.json' ).status, 'self-excluded' );
	assert.equal( manifest.captureSessions[ 0 ].adapterClass, 'software' );
	assert.equal( manifest.images.find( ( image ) => image.path === 'diagnostics.mosaic.png' ).kind, 'derived-image' );
	assert.equal( session.outputPlan.length, 10 );
	assert.deepEqual( session.writtenCaptures.map( ( capture ) => capture.png.path ), DIRECT_RECIPE_IMAGE_PATHS );
	assert.equal( session.writtenCaptures.length, 14 );
	assert.equal( SUPPLEMENTAL_NORMATIVE_IMAGE_PATHS.every( ( path ) => session.outputPlan.some( ( output ) => output.filename === path ) === false ), true );
	for ( const path of [ 'tier.target-performance.final.png', 'tier.governor-stress.final.png' ] ) {

		assert.equal( manifest.images.find( ( image ) => image.path === path )?.kind, 'direct-capture' );

	}
	assert.equal( manifest.files.find( ( file ) => file.path === SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ] )?.kind, 'supplementary-json' );

} );

test( 'raw finalization requires the complete frozen recipe and tier-evidence closure', async () => {

	{

		const { outputDir, session } = await createRawSessionFixture();
		const incomplete = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			document.writtenCaptures.pop();

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( incomplete, outputDir ), /exactly 14 direct recipe readbacks/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		const duplicated = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			document.writtenCaptures.at( - 1 ).target = document.writtenCaptures[ 0 ].target;

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( duplicated, outputDir ), /does not match recipe|duplicate recipe target/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		const reordered = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			[ document.writtenCaptures[ 0 ], document.writtenCaptures[ 1 ] ] = [ document.writtenCaptures[ 1 ], document.writtenCaptures[ 0 ] ];

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( reordered, outputDir ), /does not match recipe|canonical order/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		const missingTierDocument = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			document.artifactWrites = document.artifactWrites.filter( ( record ) => record.path !== SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ] );
			document.artifactWrites.forEach( ( record, index ) => { record.sequence = index + 1; } );

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( missingTierDocument, outputDir ), /tier-visual-evidence\.json.*(?:absent|content-bind)|did not content-bind tier-visual-evidence\.json/ );

	}

} );

test( 'raw finalization rejects undeclared and duplicate capture writes', async () => {

	{

		const { outputDir, session } = await createRawSessionFixture();
		const bytes = Buffer.from( '{"schemaVersion":1}\n' );
		await writeFile( join( outputDir, 'undeclared.json' ), bytes );
		const undeclared = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			insertWriteBeforeFinalizedSession( document, {
				path: 'undeclared.json',
				kind: 'hook-artifact',
				existedBefore: false,
				contentBinding: 'sha256-byte-length-immutable-buffer-v1',
				sha256: sha256( bytes ),
				byteLength: bytes.byteLength
			} );

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( undeclared, outputDir ), /undeclared artifact undeclared\.json/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		const duplicate = await refinalizeSessionDocument( outputDir, session, ( document ) => {

			insertWriteBeforeFinalizedSession( document, document.artifactWrites[ 0 ] );

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( duplicate, outputDir ), /duplicates .*|duplicated path|duplicate path/ );

	}

} );

test( 'tier visual evidence is byte-bound and binds both tier PNG hashes', async () => {

	{

		const { outputDir, session } = await createRawSessionFixture();
		await writeFile( join( outputDir, SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ] ), Buffer.from( '{"drifted":true}\n' ) );
		await assert.rejects( finalizeRawCorrectnessCapture( session, outputDir ), /binding drifted for tier-visual-evidence\.json/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		const path = SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ];
		const document = JSON.parse( await readFile( join( outputDir, path ), 'utf8' ) );
		document.binding.reference.pngSha256 = canonicalSha256( { forged: 'tier-reference-png' } );
		document.bindingSha256 = canonicalSha256( { binding: document.binding, metrics: document.metrics, gates: document.gates } );
		const bytes = Buffer.from( `${ JSON.stringify( document, null, 2 ) }\n` );
		await writeFile( join( outputDir, path ), bytes );
		const forged = await refinalizeSessionDocument( outputDir, session, ( finalized ) => {

			const record = finalized.artifactWrites.find( ( entry ) => entry.path === path );
			record.sha256 = sha256( bytes );
			record.byteLength = bytes.byteLength;
			finalized.hookResult.tierVisualEvidence = document;

		} );
		await assert.rejects( finalizeRawCorrectnessCapture( forged, outputDir ), /Tier reference binding|reference PNG hash does not bind tier\.target-performance\.final\.png/ );

	}

} );

test( 'raw finalization rejects a browser hook that prewrites the manifest', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	const finalizedDocument = JSON.parse( JSON.stringify( session ) );
	insertWriteBeforeFinalizedSession( finalizedDocument, {
		path: 'evidence-manifest.json',
		kind: 'hook-artifact',
		existedBefore: false,
		contentBinding: 'sha256-byte-length-immutable-buffer-v1',
		sha256: canonicalSha256( { stale: true } ),
		byteLength: 1
	} );
	const finalizedBytes = Buffer.from( `${ JSON.stringify( finalizedDocument, null, 2 ) }\n` );
	await writeFile( join( outputDir, 'capture-session.json' ), finalizedBytes );
	bindFinalizedSessionBytes( finalizedDocument, finalizedBytes );
	await assert.rejects( finalizeRawCorrectnessCapture( finalizedDocument, outputDir ), /must not write evidence-manifest/ );

} );

test( 'raw finalization rejects post-finalization in-memory route, evidence, and hook-result drift', async () => {

	for ( const mutate of [
		( session ) => { session.finalRuntime.metrics.mode = 'no-post'; },
		( session ) => { session.artifactWrites[ 0 ].sha256 = canonicalSha256( { forged: 'evidence-binding' } ); },
		( session ) => { session.hookResult.bundle.claimVerdicts.mechanismCorrectness = 'FAIL'; }
	] ) {

		const { outputDir, session } = await createRawSessionFixture();
		mutate( session );
		await assert.rejects( finalizeRawCorrectnessCapture( session, outputDir ), /canonically drifted from finalized capture-session\.json/ );

	}

} );

test( 'raw finalization rejects enumerable-order drift from the finalized session document', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	const reorderedSession = Object.fromEntries( Object.entries( session ).reverse() );
	bindFinalizedSessionBytes( reorderedSession, await readFile( join( outputDir, 'capture-session.json' ) ) );
	await assert.rejects( finalizeRawCorrectnessCapture( reorderedSession, outputDir ), /enumerable serialization drifted/ );

} );

test( 'raw finalization rejects malformed and noncanonical finalized session bytes', async () => {

	{

		const { outputDir } = await createRawSessionFixture();
		const malformed = Buffer.from( '{"schemaVersion":2' );
		await writeFile( join( outputDir, 'capture-session.json' ), malformed );
		const supplied = bindFinalizedSessionBytes( { schemaVersion: 2 }, malformed );
		await assert.rejects( finalizeRawCorrectnessCapture( supplied, outputDir ), /invalid JSON/ );

	}
	{

		const { outputDir } = await createRawSessionFixture();
		const document = JSON.parse( await readFile( join( outputDir, 'capture-session.json' ), 'utf8' ) );
		const noncanonical = Buffer.from( JSON.stringify( document ) );
		await writeFile( join( outputDir, 'capture-session.json' ), noncanonical );
		const supplied = bindFinalizedSessionBytes( document, noncanonical );
		await assert.rejects( finalizeRawCorrectnessCapture( supplied, outputDir ), /not the canonical two-space JSON document/ );

	}
	{

		const { outputDir } = await createRawSessionFixture();
		const document = JSON.parse( await readFile( join( outputDir, 'capture-session.json' ), 'utf8' ) );
		document.profile = 'performance';
		const invalidCorrectnessSession = Buffer.from( `${ JSON.stringify( document, null, 2 ) }\n` );
		await writeFile( join( outputDir, 'capture-session.json' ), invalidCorrectnessSession );
		const supplied = bindFinalizedSessionBytes( document, invalidCorrectnessSession );
		await assert.rejects( finalizeRawCorrectnessCapture( supplied, outputDir ), /Expected a schema-v2 correctness capture session/ );

	}

} );

test( 'the correctness wrapper forwards only the deterministic capture lane', () => {

	assert.equal( parseCorrectnessCaptureArgs( [] ).profile, 'correctness' );
	assert.equal( parseCorrectnessCaptureArgs( [ '--profile', 'correctness', '--target', 'presentation' ] ).target, 'presentation' );
	const request = correctnessCaptureRequest( parseCorrectnessCaptureArgs( [] ) );
	assert.equal( request.browserEntryOverride, 'threejs-visual-validation/examples/webgpu-validation-harness/tier/webgpu-correctness/index.html' );
	assert.deepEqual( request.captureState, {
		tier: 'webgpu-correctness',
		mode: 'final',
		camera: 'design',
		seed: 1,
		timeSeconds: 0,
		scenario: 'browser-capture'
	} );
	assert.throws( () => parseCorrectnessCaptureArgs( [ '--profile', 'performance' ] ), /immutable Codex in-app Browser/ );
	assert.throws( () => parseCorrectnessCaptureArgs( [ '--profile' ] ), /requires a value/ );

} );

test( 'raw image mutations reject flat, pixel-aliased, and corrupt evidence after hash rebinding', async () => {

	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const flat = encodeRgbaPng( {
			width: 1200,
			height: 800,
			data: new Uint8Array( 1200 * 800 * 4 ).fill( 32 )
		} );
		await replaceImageAndRebind( outputDir, 'final.design.png', flat );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /blank or effectively flat/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const final = await readFile( join( outputDir, 'final.design.png' ) );
		await replaceImageAndRebind( outputDir, 'diagnostics.mosaic.png', final );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /aliases decoded pixels/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const corrupt = Buffer.from( await readFile( join( outputDir, 'final.design.png' ) ) );
		corrupt[ corrupt.length - 8 ] ^= 1;
		await replaceImageAndRebind( outputDir, 'final.design.png', corrupt );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /CRC mismatch/ );

	}

} );

test( 'a rehashed bare numeric claim cannot bypass recursive provenance', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	await finalizeRawCorrectnessCapture( session, outputDir );
	const forged = Buffer.from( `${ JSON.stringify( { schemaVersion: 2, claimedGpuMs: 0 } ) }\n` );
	await replaceFileAndRebind( outputDir, 'visual-contract.json', forged );
	await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /unlabelled numeric value/ );

} );
