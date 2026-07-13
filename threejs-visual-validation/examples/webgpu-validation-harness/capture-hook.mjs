import { createHash } from 'node:crypto';

import { unpackAlignedRows } from '../../../labs/runtime/aligned-readback.mjs';
import { encodeRgbaPng } from '../../../scripts/lib/png-rgba.mjs';
import {
	computeCaptureSourceClosure,
	validateCaptureSourceClosure
} from './src/capture-source-closure.js';
import {
	DIAGNOSTIC_MOSAIC_RECIPE,
	DIAGNOSTIC_MOSAIC_SOURCES,
	reconstructDiagnosticMosaic as reconstructNamedDiagnosticMosaic
} from './src/diagnostic-mosaic.js';
import {
	CORRECTNESS_CAPTURE_RECIPES,
	correctnessCaptureRecipeDigest
} from './src/correctness-capture-recipes.js';
import { stableStringify } from './src/physical-evidence-common.js';
import {
	classifyGpuStageAttribution,
	classifyMechanismProof,
	classifyPerformanceTrace,
	writeIncompleteV2RuntimeBundle
} from './src/runtime-v2-bundle.js';

const DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE = 1;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const TIER_VISUAL_EVIDENCE_FILENAME = 'tier-visual-evidence.json';
export const TIER_VISUAL_ERROR_GATES = Object.freeze( {
	meanRgbByteDifference: 8,
	edgeP95RgbByteDifference: 32
} );
export const TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS = 2;
export const DIRECT_CAPTURE_RECIPE_ORDER = Object.freeze( CORRECTNESS_CAPTURE_RECIPES.map( ( recipe ) => recipe.id ) );
if ( DIRECT_CAPTURE_RECIPE_ORDER.length !== 14 ) throw new Error( `Correctness capture requires exactly 14 direct recipes, observed ${ DIRECT_CAPTURE_RECIPE_ORDER.length }.` );
export { DIAGNOSTIC_MOSAIC_RECIPE, DIAGNOSTIC_MOSAIC_SOURCES };

export const outputPlan = Object.freeze( [
	{ id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
	{ id: 'no-post.design', status: 'CAPTURED', filename: 'no-post.design.png' },
	{
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: 'diagnostics.mosaic.png',
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ]
	},
	{ id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
	{ id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
	{ id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
	{ id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
	{ id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
	{ id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
	{ id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' }
] );

export const recomputeCaptureSourceClosure = computeCaptureSourceClosure;
export { validateCaptureSourceClosure };

function deepFreeze( value ) {

	if ( value === null || typeof value !== 'object' || Object.isFrozen( value ) ) return value;
	if ( ArrayBuffer.isView( value ) || value instanceof ArrayBuffer ) return value;
	for ( const child of Object.values( value ) ) deepFreeze( child );
	return Object.freeze( value );

}

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new Error( `${ label } must be an object.` );
	return value;

}

function requireSha256( value, label ) {

	if ( SHA256_PATTERN.test( value ?? '' ) === false ) throw new Error( `${ label } must be a sha256: digest.` );
	return value;

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

export function captureRecord( filename, capture ) {

	return {
		filename,
		target: capture.target,
		width: capture.width,
		height: capture.height,
		bytesPerPixel: capture.bytesPerPixel,
		bytesPerRow: capture.bytesPerRow,
		sourceBytesPerRow: capture.sourceBytesPerRow,
		sourceByteLength: capture.sourceByteLength,
		transportByteLength: capture.transportByteLength,
		sourceLayout: capture.sourceLayout,
		requestedLayout: capture.transport?.rendererCopy?.requestedLayout ?? null,
		transportLayout: capture.transport?.layout ?? null,
		normalizedLayout: capture.normalized?.layout ?? null,
		normalizedBytesPerRow: capture.normalized?.bytesPerRow ?? null,
		normalizedByteLength: capture.normalized?.byteLength ?? null,
		controllerNormalized: capture.controllerNormalized ?? null,
		format: capture.format,
		colorEncoding: capture.colorEncoding,
		pngSha256: capture.png.sha256,
		transportSha256: capture.transport.artifact.sha256,
		normalizedSha256: capture.normalized.artifact.sha256,
		evidence: capture.evidence
	};

}

export async function assertRecipeCaptureMetadata( filename, recipe, capture ) {

	requireRecord( recipe, 'Correctness capture recipe' );
	if ( recipe.capture?.filename !== filename ) throw new Error( `Recipe ${ recipe.id } is locked to filename ${ recipe.capture?.filename }, not ${ filename }.` );
	requireRecord( capture, `Capture metadata for ${ recipe.id }` );
	if ( capture.target !== recipe.id ) throw new Error( `Capture metadata target ${ capture.target } does not match recipe ${ recipe.id }.` );
	const evidence = requireRecord( capture.evidence, `Capture evidence for ${ recipe.id }` );
	const recipeEvidence = requireRecord( evidence.recipe, `Capture recipe evidence for ${ recipe.id }` );
	if ( recipeEvidence.id !== recipe.id ) throw new Error( `Capture recipe evidence ID ${ recipeEvidence.id } does not match ${ recipe.id }.` );
	if ( recipeEvidence.captureFilename !== filename ) throw new Error( `Capture recipe evidence filename ${ recipeEvidence.captureFilename } does not match ${ filename }.` );
	const expectedDigest = await correctnessCaptureRecipeDigest( recipe.id );
	requireSha256( recipeEvidence.digest, `Capture recipe ${ recipe.id } digest` );
	if ( recipeEvidence.digest !== expectedDigest ) throw new Error( `Capture recipe ${ recipe.id } digest does not match the frozen contract.` );
	const transaction = requireRecord( evidence.transaction, `Capture transaction evidence for ${ recipe.id }` );
	if ( transaction.status !== 'COMMITTED' ) throw new Error( `Capture recipe ${ recipe.id } transaction is not COMMITTED.` );
	if ( transaction.recipeId !== recipe.id ) throw new Error( `Capture transaction recipe ID ${ transaction.recipeId } does not match ${ recipe.id }.` );
	if ( transaction.restorationVerdict !== 'PASS' ) throw new Error( `Capture recipe ${ recipe.id } restoration did not PASS.` );
	if ( typeof transaction.transactionId !== 'string' || transaction.transactionId.length === 0 ) throw new Error( `Capture recipe ${ recipe.id } transaction ID is required.` );
	if ( Number.isInteger( transaction.sequence ) === false || transaction.sequence <= 0 ) throw new Error( `Capture recipe ${ recipe.id } transaction sequence must be a positive integer.` );
	requireSha256( transaction.entryStateDigest, `Capture recipe ${ recipe.id } entry-state digest` );
	requireSha256( transaction.restoredStateDigest, `Capture recipe ${ recipe.id } restored-state digest` );
	if ( transaction.entryStateDigest !== transaction.restoredStateDigest ) throw new Error( `Capture recipe ${ recipe.id } did not restore its entry-state digest.` );
	requireRecord( evidence.effectiveState, `Capture effective state for ${ recipe.id }` );
	requireRecord( evidence.resources, `Capture resource evidence for ${ recipe.id }` );
	return true;

}

async function captureRecipeAndWrite( session, captures, recipe ) {

	const filename = recipe.capture.filename;
	const metadata = await session.writeRecipeCapture( filename, recipe.id );
	await assertRecipeCaptureMetadata( filename, recipe, metadata );
	captures.push( captureRecord( filename, metadata ) );
	const normalizedBytes = await session.readArtifact( metadata.normalized.artifact.path );
	const compact = unpackAlignedRows( {
		source: normalizedBytes,
		width: metadata.width,
		height: metadata.height,
		bytesPerPixel: 4,
		bytesPerRow: metadata.normalized.bytesPerRow
	} );
	if ( sha256( compact ) !== metadata.normalized.compactRgbaSha256 ) throw new Error( `${ filename } normalized readback hash drifted before mosaic construction.` );
	return deepFreeze( { filename, recipeId: recipe.id, width: metadata.width, height: metadata.height, data: compact, metadata } );

}

function meanRgbByteDifference( a, b ) {

	if ( a.width !== b.width || a.height !== b.height ) throw new Error( 'Diagnostic comparison dimensions differ.' );
	let total = 0;
	let samples = 0;
	for ( let index = 0; index < a.data.length; index += 4 ) {

		for ( let channel = 0; channel < 3; channel ++ ) total += Math.abs( a.data[ index + channel ] - b.data[ index + channel ] );
		samples += 3;

	}
	return total / samples;

}

function percentile( values, quantile ) {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const position = ( sorted.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? sorted[ lower ] : sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

export function tierVisualErrorMetrics( reference, candidate ) {

	if ( reference.width !== candidate.width || reference.height !== candidate.height ) throw new Error( 'Tier comparison dimensions differ.' );
	const edgeDifferences = [];
	for ( let y = 1; y < reference.height - 1; y ++ ) for ( let x = 1; x < reference.width - 1; x ++ ) {

		const center = ( y * reference.width + x ) * 4;
		const neighbors = [ center - 4, center + 4, center - reference.width * 4, center + reference.width * 4 ];
		let gradient = 0;
		for ( const neighbor of neighbors ) for ( let channel = 0; channel < 3; channel ++ ) gradient = Math.max( gradient, Math.abs( reference.data[ center + channel ] - reference.data[ neighbor + channel ] ) );
		if ( gradient < 8 ) continue;
		let minimumDifference = Number.POSITIVE_INFINITY;
		const minimumY = Math.max( 0, y - TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS );
		const maximumY = Math.min( candidate.height - 1, y + TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS );
		const minimumX = Math.max( 0, x - TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS );
		const maximumX = Math.min( candidate.width - 1, x + TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS );
		for ( let candidateY = minimumY; candidateY <= maximumY; candidateY ++ ) for ( let candidateX = minimumX; candidateX <= maximumX; candidateX ++ ) {

			const candidateOffset = ( candidateY * candidate.width + candidateX ) * 4;
			const difference = (
				Math.abs( reference.data[ center ] - candidate.data[ candidateOffset ] ) +
				Math.abs( reference.data[ center + 1 ] - candidate.data[ candidateOffset + 1 ] ) +
				Math.abs( reference.data[ center + 2 ] - candidate.data[ candidateOffset + 2 ] )
			) / 3;
			minimumDifference = Math.min( minimumDifference, difference );

		}
		edgeDifferences.push( minimumDifference );

	}
	if ( edgeDifferences.length === 0 ) throw new Error( 'Tier comparison reference edge mask is empty.' );
	return {
		meanRgbByteDifference: meanRgbByteDifference( reference, candidate ),
		edgeMaskPixels: edgeDifferences.length,
		edgeMeanRgbByteDifference: edgeDifferences.reduce( ( sum, value ) => sum + value, 0 ) / edgeDifferences.length,
		edgeP95RgbByteDifference: percentile( edgeDifferences, 0.95 )
	};

}

function numericEvidence( value, unit, label, source ) {

	return { value, unit, label, source };

}

function requireResourceExtent( resources, semantic, width, height, recipeId ) {

	if ( Array.isArray( resources.renderTargets ) === false ) throw new Error( `${ recipeId } effective resource evidence must list renderTargets.` );
	const resource = resources.renderTargets.find( ( entry ) => entry?.semantic === semantic );
	if ( resource === undefined ) throw new Error( `${ recipeId } effective resource evidence omits ${ semantic }.` );
	if ( resource.width !== width || resource.height !== height ) throw new Error( `${ recipeId } ${ semantic } extent ${ resource.width }x${ resource.height } does not match ${ width }x${ height }.` );
	return {
		semantic,
		owner: resource.owner ?? null,
		targetName: resource.targetName ?? null,
		textureUuid: resource.textureUuid ?? null,
		width: resource.width,
		height: resource.height,
		format: resource.format ?? null,
		bytes: resource.bytes ?? null,
		logicalBytes: resource.logicalBytes ?? null,
		liveBytes: resource.liveBytes ?? null,
		liveness: resource.liveness ?? null
	};

}

function tierCaptureBinding( capture, expectation ) {

	const metadata = capture.metadata;
	const normalized = requireRecord( metadata.normalized, `${ capture.recipeId } normalized evidence` );
	const artifact = requireRecord( normalized.artifact, `${ capture.recipeId } normalized artifact` );
	const evidence = requireRecord( metadata.evidence, `${ capture.recipeId } capture evidence` );
	const recipe = requireRecord( evidence.recipe, `${ capture.recipeId } recipe evidence` );
	const transaction = requireRecord( evidence.transaction, `${ capture.recipeId } transaction evidence` );
	const effectiveState = requireRecord( evidence.effectiveState, `${ capture.recipeId } effective state` );
	const resources = requireRecord( evidence.resources, `${ capture.recipeId } resource evidence` );
	const effectiveResources = requireRecord( resources.effective, `${ capture.recipeId } effective resource ledger` );
	if ( transaction.status !== 'COMMITTED' || transaction.recipeId !== capture.recipeId || transaction.restorationVerdict !== 'PASS' ) throw new Error( `${ capture.recipeId } tier binding requires committed restoration evidence.` );
	if ( transaction.entryStateDigest !== transaction.restoredStateDigest ) throw new Error( `${ capture.recipeId } tier binding requires equal entry and restored state digests.` );
	if ( capture.width !== 1920 || capture.height !== 1080 ) throw new Error( `${ capture.recipeId } must retain a 1920x1080 tier readback.` );
	if ( effectiveState.tier !== expectation.tier ) throw new Error( `${ capture.recipeId } effective tier ${ effectiveState.tier } does not match ${ expectation.tier }.` );
	if ( evidence.passScale !== expectation.passScale ) throw new Error( `${ capture.recipeId } pass scale ${ evidence.passScale } does not match ${ expectation.passScale }.` );
	const captureTarget = requireResourceExtent( effectiveResources, 'capture-target', 1920, 1080, capture.recipeId );
	const sceneMrt = [ 'output', 'normal', 'emissive' ].map( ( semantic ) => requireResourceExtent(
		effectiveResources,
		semantic,
		expectation.sceneWidth,
		expectation.sceneHeight,
		capture.recipeId
	) );
	return {
		recipeId: capture.recipeId,
		recipeDigest: requireSha256( recipe.digest, `${ capture.recipeId } recipe digest` ),
		filename: capture.filename,
		pngSha256: requireSha256( metadata.png?.sha256, `${ capture.recipeId } PNG hash` ),
		transaction: {
			transactionId: transaction.transactionId,
			sequence: transaction.sequence,
			status: transaction.status,
			entryStateDigest: transaction.entryStateDigest,
			restoredStateDigest: transaction.restoredStateDigest,
			restorationVerdict: transaction.restorationVerdict
		},
		normalized: {
			artifact: {
				path: artifact.path,
				sha256: requireSha256( artifact.sha256, `${ capture.recipeId } normalized artifact hash` ),
				byteLength: artifact.byteLength
			},
			compactRgbaSha256: requireSha256( normalized.compactRgbaSha256, `${ capture.recipeId } compact RGBA hash` ),
			compactByteLength: normalized.compactByteLength,
			width: capture.width,
			height: capture.height
		},
		captureEvidenceSha256: sha256( Buffer.from( stableStringify( evidence ) ) ),
		effectiveState,
		passScale: evidence.passScale,
		resources: { captureTarget, sceneMrt }
	};

}

export function createTierVisualEvidence( reference, candidate ) {

	if ( reference?.recipeId !== 'tier.target-performance.final' ) throw new Error( 'Tier visual reference must be tier.target-performance.final.' );
	if ( candidate?.recipeId !== 'tier.governor-stress.final' ) throw new Error( 'Tier visual candidate must be tier.governor-stress.final.' );
	const measured = tierVisualErrorMetrics( reference, candidate );
	const binding = {
		reference: tierCaptureBinding( reference, { tier: 'target-performance', passScale: 1, sceneWidth: 1920, sceneHeight: 1080 } ),
		candidate: tierCaptureBinding( candidate, { tier: 'governor-stress', passScale: 0.5, sceneWidth: 960, sceneHeight: 540 } )
	};
	if ( typeof binding.reference.transaction.transactionId !== 'string' || binding.reference.transaction.transactionId.length === 0 ) throw new Error( 'Tier visual reference transaction ID is required.' );
	if ( typeof binding.candidate.transaction.transactionId !== 'string' || binding.candidate.transaction.transactionId.length === 0 ) throw new Error( 'Tier visual candidate transaction ID is required.' );
	if ( binding.reference.transaction.transactionId === binding.candidate.transaction.transactionId ) throw new Error( 'Tier visual captures must use distinct transactions.' );
	if ( Number.isInteger( binding.reference.transaction.sequence ) === false || Number.isInteger( binding.candidate.transaction.sequence ) === false ) throw new Error( 'Tier visual capture transaction sequences must be integers.' );
	if ( binding.reference.transaction.sequence === binding.candidate.transaction.sequence ) throw new Error( 'Tier visual captures must use distinct transaction sequences.' );
	if ( binding.reference.normalized.artifact.path === binding.candidate.normalized.artifact.path ) throw new Error( 'Tier visual captures must retain separate normalized artifact paths.' );
	const metrics = {
		meanRgbByteDifference: numericEvidence(
			measured.meanRgbByteDifference,
			'mean-rgb-byte-difference',
			'Measured',
			`${ binding.reference.normalized.compactRgbaSha256 } versus ${ binding.candidate.normalized.compactRgbaSha256 }`
		),
		edgeMaskPixels: numericEvidence(
			measured.edgeMaskPixels,
			'pixels',
			'Measured',
			'reference-image RGB gradient mask with threshold 8 bytes'
		),
		edgeMeanRgbByteDifference: numericEvidence(
			measured.edgeMeanRgbByteDifference,
			'mean-rgb-byte-difference',
			'Measured',
			`reference-edge-mask minimum within a ${ TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS }-pixel Chebyshev candidate neighborhood`
		),
		edgeP95RgbByteDifference: numericEvidence(
			measured.edgeP95RgbByteDifference,
			'mean-rgb-byte-difference',
			'Measured',
			`reference-edge-mask p95 of minima within a ${ TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS }-pixel Chebyshev candidate neighborhood`
		)
	};
	const gates = {
		meanRgbByteDifference: numericEvidence(
			TIER_VISUAL_ERROR_GATES.meanRgbByteDifference,
			'mean-rgb-byte-difference',
			'Gated',
			'frozen correctness-capture tier degradation gate'
		),
		edgeP95RgbByteDifference: numericEvidence(
			TIER_VISUAL_ERROR_GATES.edgeP95RgbByteDifference,
			'mean-rgb-byte-difference',
			'Gated',
			'frozen correctness-capture reference-edge p95 gate'
		)
	};
	const verdict = measured.meanRgbByteDifference <= TIER_VISUAL_ERROR_GATES.meanRgbByteDifference &&
		measured.edgeP95RgbByteDifference <= TIER_VISUAL_ERROR_GATES.edgeP95RgbByteDifference ? 'PASS' : 'FAIL';
	const bindingSha256 = sha256( Buffer.from( stableStringify( { binding, metrics, gates } ) ) );
	return deepFreeze( {
		schemaVersion: 1,
		kind: 'validation-harness-tier-visual-evidence-v1',
		binding,
		metrics,
		gates,
		bindingSha256,
		verdict
	} );

}

export function reconstructDiagnosticMosaic( sources ) {

	return reconstructNamedDiagnosticMosaic( sources, { hashPixels: sha256 } );

}

async function writeDerivedMosaic( session, mosaic ) {

	const png = encodeRgbaPng( mosaic );
	const rowBytes = mosaic.width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const padded = new Uint8Array( bytesPerRow * mosaic.height );
	for ( let row = 0; row < mosaic.height; row ++ ) padded.set(
		mosaic.data.subarray( row * rowBytes, ( row + 1 ) * rowBytes ),
		row * bytesPerRow
	);
	const pngPath = 'diagnostics.mosaic.png';
	const rawPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin';
	const packedPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin';
	await session.writeArtifact( pngPath, png );
	await session.writeArtifact( rawPath, padded );
	await session.writeArtifact( packedPath, mosaic.data );
	return {
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: pngPath,
		width: mosaic.width,
		height: mosaic.height,
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
		derivation: mosaic.recipe,
		file: { path: pngPath, sha256: sha256( png ), byteLength: png.byteLength },
		pixelEvidence: {
			png: {
				path: pngPath,
				sha256: sha256( png ),
				byteLength: png.byteLength,
				derivedFromPackedRgbaSha256: sha256( mosaic.data )
			},
			normalized: {
				rawArtifact: { path: rawPath, sha256: sha256( padded ), byteLength: padded.byteLength },
				packedArtifact: { path: packedPath, sha256: sha256( mosaic.data ), byteLength: mosaic.data.byteLength },
				packedRgbaSha256: sha256( mosaic.data ),
				packedByteLength: mosaic.data.byteLength,
				paddedBytesPerRow: bytesPerRow,
				width: mosaic.width,
				height: mosaic.height,
				rowBytes,
				bytesPerRow,
				origin: 'top-left',
				paddingVerifiedZero: true
			}
		}
	};

}

export function derivedMosaicCaptureRecord( mosaicOutput ) {

	return {
		filename: 'diagnostics.mosaic.png',
		target: 'final/no-post/normal/emissive',
		width: mosaicOutput.width,
		height: mosaicOutput.height,
		source: 'four actual output-node captures',
		pngSha256: mosaicOutput.file.sha256
	};

}

export function assertCanonicalCaptureLane( session ) {

	if ( session?.profile !== 'correctness' || session?.automationSurface !== 'playwright-headless-chromium' ) {

		throw new Error( 'Deterministic correctness capture requires the shared Playwright headless Chromium runner; physical-route and performance evidence use the immutable Codex in-app Browser runner.' );

	}
	return true;

}

export async function captureFrozenRecipeEvidence( session ) {

	if ( typeof session?.writeRecipeCapture !== 'function' ) throw new Error( 'Correctness capture session must expose writeRecipeCapture(filename, recipeId).' );
	const captures = [];
	const retained = new Map();
	for ( const recipe of CORRECTNESS_CAPTURE_RECIPES ) {

		const capture = await captureRecipeAndWrite( session, captures, recipe );
		retained.set( capture.filename, capture );

	}

	const final = retained.get( 'final.design.png' );
	const normal = retained.get( 'diagnostic.normal.png' );
	const emissive = retained.get( 'diagnostic.emissive.png' );
	const diagnosticDifferences = {
		normal: meanRgbByteDifference( final, normal ),
		emissive: meanRgbByteDifference( final, emissive )
	};
	const diagnosticDifference = Math.min( diagnosticDifferences.normal, diagnosticDifferences.emissive );
	if ( diagnosticDifference <= DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE ) throw new Error( 'Diagnostic outputs are not materially distinct from final output.' );
	const mosaicOutput = await writeDerivedMosaic( session, reconstructDiagnosticMosaic( retained ) );
	captures.push( derivedMosaicCaptureRecord( mosaicOutput ) );

	const odd = retained.get( 'odd-size.final.png' );
	if ( odd.width !== 641 || odd.height !== 359 ) throw new Error( `Odd-size capture drifted to ${ odd.width }x${ odd.height }.` );
	const tierVisualEvidence = createTierVisualEvidence(
		retained.get( 'tier.target-performance.final.png' ),
		retained.get( 'tier.governor-stress.final.png' )
	);
	await session.writeArtifact( TIER_VISUAL_EVIDENCE_FILENAME, `${ JSON.stringify( tierVisualEvidence, null, 2 ) }\n` );
	if ( tierVisualEvidence.verdict !== 'PASS' ) throw new Error(
		`Governor-stress tier exceeds frozen visual gates: mean ${ tierVisualEvidence.metrics.meanRgbByteDifference.value }/${ tierVisualEvidence.gates.meanRgbByteDifference.value }, edge p95 ${ tierVisualEvidence.metrics.edgeP95RgbByteDifference.value }/${ tierVisualEvidence.gates.edgeP95RgbByteDifference.value }.`
	);

	return {
		captures,
		retained,
		mosaicOutput,
		diagnosticDifference,
		diagnosticDifferences,
		tierVisualEvidence
	};

}

function equalLockedValue( actual, expected ) {

	return typeof actual === 'number' && typeof expected === 'number' ? Object.is( actual, expected ) : String( actual ) === String( expected );

}

export function assertControllerAtLockedState( session, metrics ) {

	const lockedState = requireRecord( session?.lockedState, 'Correctness capture locked state' );
	const current = requireRecord( metrics, 'Correctness capture controller metrics' );
	for ( const field of [ 'scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds' ] ) {

		const expected = lockedState[ field ];
		if ( expected === null || expected === undefined ) continue;
		if ( current[ field ] === null || current[ field ] === undefined ) throw new Error( `Controller metrics omit locked ${ field }.` );
		if ( equalLockedValue( current[ field ], expected ) === false ) throw new Error( `Controller ${ field }=${ current[ field ] } does not match locked ${ expected }.` );

	}
	const viewport = requireRecord( current.viewport, 'Correctness capture controller viewport' );
	const profile = requireRecord( session?.profileConfig, 'Correctness capture profile' );
	for ( const field of [ 'width', 'height', 'dpr' ] ) if ( equalLockedValue( viewport[ field ], profile[ field ] ) === false ) {

		throw new Error( `Controller viewport ${ field }=${ viewport[ field ] } does not match locked ${ profile[ field ] }.` );

	}
	return true;

}

export async function runLockedMechanismAndLifecycleProfiles( session ) {

	const beforeMechanism = await session.controllerCall( 'getMetrics' );
	assertControllerAtLockedState( session, beforeMechanism );
	const mechanismProof = await session.controllerCall( 'runMechanismReachabilityProfile' );
	const beforeLifecycle = await session.controllerCall( 'getMetrics' );
	assertControllerAtLockedState( session, beforeLifecycle );
	const lifecycle = await session.page.evaluate( async ( cycles ) => window.__THREEJS_LAB_LIFECYCLE__( cycles ), 50 );
	const metrics = await session.controllerCall( 'getMetrics' );
	assertControllerAtLockedState( session, metrics );
	return { mechanismProof, lifecycle, metrics };

}

export async function captureLab( session ) {

	assertCanonicalCaptureLane( session );
	const sourceClosure = computeCaptureSourceClosure();
	const {
		captures,
		mosaicOutput,
		diagnosticDifference,
		diagnosticDifferences,
		tierVisualEvidence
	} = await captureFrozenRecipeEvidence( session );

	const performanceTrace = null;
	const governorTrace = null;
	const { mechanismProof, lifecycle, metrics } = await runLockedMechanismAndLifecycleProfiles( session );

	const runtime = {
		metrics,
		pipeline: await session.controllerCall( 'describePipeline' ),
		resources: await session.controllerCall( 'describeResources' ),
		gpuTiming: await session.controllerCall( 'resolveGpuTimings' ),
		performanceTrace,
		governorTrace,
		mechanismProof,
		lifecycle
	};
	const performanceCompliance = classifyPerformanceTrace( performanceTrace, {
		cpuP95: 1000 / 60 - 2,
		gpuP95: 1000 / 60 - 2,
		deadlineMissRatio: 0.01
	}, runtime.metrics.adapterClass );
	const gpuAttribution = classifyGpuStageAttribution( performanceTrace );
	const mechanismCorrectness = classifyMechanismProof( mechanismProof, diagnosticDifferences, runtime.pipeline );
	const boundary = {
		schemaVersion: 2,
		bundleKind: 'browser-capture-session',
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		reason: performanceTrace === null
			? 'Native readbacks, runtime mechanism proof, and 50 lifecycle cycles exist; hardware performance and GPU attribution are not claimed by the correctness profile.'
			: runtime.metrics.adapterClass === 'software'
				? 'Native readbacks, runtime mechanism proof, attributed software-adapter diagnostics, governor diagnostics, and 50 lifecycle cycles exist; software timing cannot support hardware performance acceptance.'
				: 'Native readbacks, runtime mechanism proof, hardware timing, governor evidence, and 50 lifecycle cycles were captured; release promotion and direct visual sign-off remain separate.',
		claimVerdicts: {
			nativeWebGPUCorrectness: 'PASS',
			renderTargetReadback: 'PASS',
			mechanismCorrectness,
			performanceCompliance,
			gpuTimestampAvailability: runtime.gpuTiming.verdict,
			gpuAttribution,
			lifecycleStability: lifecycle === null ? 'INSUFFICIENT_EVIDENCE' : 'PASS'
		},
		diagnosticDifference: {
			value: diagnosticDifference,
			unit: 'mean-rgb-byte-difference',
			label: 'Measured',
			source: 'render-target output-node comparison'
		},
		diagnosticDifferences,
		captures,
		runtime
	};
	const bundle = await writeIncompleteV2RuntimeBundle( session, {
		captures,
		runtime,
		diagnosticDifference,
		diagnosticDifferences,
		sourceClosure
	} );
	await session.writeArtifact( 'capture-boundary.json', `${ JSON.stringify( boundary, null, 2 ) }\n` );
	return {
		status: 'incomplete',
		publishable: false,
		captures,
		gpuTiming: runtime.gpuTiming,
		bundle,
		sourceClosure,
		standardOutputs: [ mosaicOutput ],
		tierVisualEvidence
	};

}

export default captureLab;
