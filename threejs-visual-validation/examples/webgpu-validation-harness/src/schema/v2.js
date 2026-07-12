import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { assertLabelledNumerics, numericValue, validateNumericArray, validateNumericDatum } from '../numeric-evidence.js';
import { DIAGNOSTIC_MOSAIC_RECIPE, DIAGNOSTIC_MOSAIC_SOURCES, reconstructDiagnosticMosaic } from '../diagnostic-mosaic.js';
import { assertDistinctBundleFiles, resolveConfinedPath } from '../path-confinement.js';
import { assertNonBlankGeneratedPng, compareGeneratedRgbaPngs, decodeGeneratedRgbaPixels } from '../png.js';
import { getAlignedReadbackLayout } from '../readback.js';
import { buildDemoRegistry } from '../../../../../scripts/lib/lab-registry.mjs';

export const EVIDENCE_SCHEMA_VERSION = 2;

export const CLAIM_VERDICTS = Object.freeze( [
	'PASS',
	'FAIL',
	'INSUFFICIENT_EVIDENCE',
	'NOT_CLAIMED'
] );

export const REQUIRED_V2_ARTIFACTS = Object.freeze( [
	'visual-contract.json',
	'evidence-manifest.json',
	'renderer-info.json',
	'pipeline-graph.json',
	'performance-envelope.json',
	'frame-trace.json',
	'quality-governor.json',
	'render-targets.json',
	'storage-resources.json',
	'resident-resources.json',
	'bandwidth-model.json',
	'visual-errors.json',
	'leak-loop.json',
	'mechanism-metrics.json'
] );

export const REQUIRED_V2_IMAGES = Object.freeze( [
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

const CLAIM_CLASSES = Object.freeze( [
	'visualCorrectness',
	'mechanismCorrectness',
	'performanceCompliance',
	'gpuAttribution',
	'lifecycleStability'
] );

const BROWSER_CAPTURE_KINDS = new Set( [
	'browser-capture',
	'browser-capture-incomplete'
] );

const OWNERSHIP_SINGLETONS = new Set( [
	'renderer',
	'render-pipeline',
	'tone-map',
	'output-transform'
] );
const CAPTURE_PROFILES = new Set( [ 'correctness', 'performance', 'schema-fixture' ] );
const ADAPTER_CLASSES = new Set( [ 'hardware', 'software', 'virtual', 'unknown' ] );
const MECHANISM_MODES = Object.freeze( [ 'final', 'no-post', 'normal', 'emissive' ] );

function canonicalize( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalize );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonicalize( value[ key ] ) ] ) );
	return value;

}

function sha256Digest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( value ).digest( 'hex' ) }`;

}

function canonicalDigest( value ) {

	return sha256Digest( JSON.stringify( canonicalize( value ) ) );

}

function normalizedSha256( value ) {

	return String( value ?? '' ).startsWith( 'sha256:' ) ? String( value ) : `sha256:${ value }`;

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) {

		throw new Error( `${ label } must be an object.` );

	}

}

function requireArray( value, label, minimumLength = 0 ) {

	if ( Array.isArray( value ) === false || value.length < minimumLength ) {

		throw new Error( `${ label } must be an array with at least ${ minimumLength } entries.` );

	}

}

function requireString( value, label ) {

	if ( typeof value !== 'string' || value.length === 0 ) throw new Error( `${ label } must be a non-empty string.` );

}

function requireBoolean( value, label ) {

	if ( typeof value !== 'boolean' ) throw new Error( `${ label } must be a boolean.` );

}

function percentile( samples, quantile ) {

	const sorted = [ ...samples ].sort( ( left, right ) => left - right );
	const position = ( sorted.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? sorted[ lower ] : sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

function requireRecomputed( reported, expected, label, tolerance = 1e-9 ) {

	if ( Number.isFinite( reported ) === false || Math.abs( reported - expected ) > tolerance ) throw new Error( `${ label } does not match its raw evidence population.` );

}

function numericPopulation( datum, label ) {

	validateNumericArray( datum, label );
	if ( datum.values.length === 0 || datum.values.some( ( value ) => Number.isFinite( value ) === false || value < 0 ) ) throw new Error( `${ label } requires finite nonnegative samples.` );
	return datum.values;

}

function requireKeys( object, keys, label ) {

	requireObject( object, label );
	for ( const key of keys ) {

		if ( Object.hasOwn( object, key ) === false ) throw new Error( `${ label } is missing required field "${ key }".` );

	}

}

function requireSchemaVersion( artifact, label ) {

	requireObject( artifact, label );
	if ( artifact.schemaVersion !== EVIDENCE_SCHEMA_VERSION ) {

		throw new Error( `${ label}.schemaVersion must equal ${ EVIDENCE_SCHEMA_VERSION }.` );

	}

}

function requireVerdict( value, label ) {

	if ( CLAIM_VERDICTS.includes( value ) === false ) {

		throw new Error( `${ label } must be PASS, FAIL, INSUFFICIENT_EVIDENCE, or NOT_CLAIMED.` );

	}

}

function requireLabelledArtifact( artifact, label ) {

	requireSchemaVersion( artifact, label );
	assertLabelledNumerics( artifact );

}

function requireNumericProvenance( datum, allowed, label ) {

	if ( datum === null || typeof datum !== 'object' || allowed.includes( datum.label ) === false ) throw new Error( `${ label } requires ${ allowed.join( ' or ' ) } numeric provenance.` );
	if ( typeof datum.source !== 'string' || datum.source.length === 0 || /fixture|forged|synthetic/i.test( datum.source ) ) throw new Error( `${ label } has non-runtime numeric provenance.` );

}

function rejectSyntheticStrings( value, label ) {

	const text = JSON.stringify( value );
	if ( /contract[- ]fixture|not instantiated|forged|synthetic/i.test( text ) ) throw new Error( `${ label } retains synthetic fixture identity.` );

}

function emptyFailureLists( captureSession ) {

	for ( const key of [ 'pageErrors', 'consoleErrors', 'requestErrors' ] ) {

		if ( Array.isArray( captureSession[ key ] ) === false || captureSession[ key ].length > 0 ) throw new Error( `Finalized shared capture-session contains ${ key }.` );

	}
	const postDispose = captureSession.postDisposeSnapshot;
	requireObject( postDispose, 'capture-session.json.postDisposeSnapshot' );
	for ( const key of [ 'gpuEvents', 'threeGpuEvents', 'imagePipelineGpuEvents', 'deviceErrors' ] ) {

		const value = postDispose[ key ];
		if ( value !== null && value !== undefined && ( Array.isArray( value ) === false || value.length > 0 ) ) throw new Error( `Finalized shared capture-session contains delayed post-dispose ${ key }.` );

	}
	if ( postDispose.labError !== null && postDispose.labError !== undefined ) throw new Error( 'Finalized shared capture-session contains a delayed lab error.' );

}

function validateSessionBackendIdentity( metrics, label ) {

	requireObject( metrics, label );
	const evidence = metrics.rendererBackendEvidence;
	requireObject( evidence, `${ label }.rendererBackendEvidence` );
	if (
		metrics.nativeWebGPU !== true || metrics.initialized !== true ||
		evidence.isWebGPUBackend !== true || evidence.deviceIdentityVerified !== true ||
		evidence.lossPromiseObservedOnActualDevice !== true ||
		evidence.deviceIdentitySource !== 'strict identity equality between requested GPUDevice and renderer.backend.device after renderer.init()' ||
		metrics.rendererDeviceStatus !== 'active' || metrics.deviceLossGeneration !== 0 || metrics.deviceLostObserved === true ||
		( metrics.uncapturedErrors?.length ?? 0 ) > 0 || metrics.lastDeviceError
	) throw new Error( `Finalized shared capture-session ${ label } lacks exact live backend-device identity proof.` );

}

async function validateArtifactLedger( artifactDir, manifest, captureSession, contract ) {

	const ledger = manifest.promotion?.artifactLedger;
	requireKeys( ledger, [ 'algorithm', 'selfPolicy', 'entries', 'digest' ], 'evidence-manifest.json.promotion.artifactLedger' );
	if ( ledger.algorithm !== 'shared-capture-write-ledger-sha256-v1' || ledger.selfPolicy !== 'evidence-manifest-excluded-to-avoid-self-hash' ) throw new Error( 'Publishable evidence has no valid normative file/hash ledger.' );
	requireArray( ledger.entries, 'evidence-manifest.json.promotion.artifactLedger.entries', REQUIRED_V2_ARTIFACTS.length - 1 + contract.requiredImages.length + 1 );
	const paths = new Set();
	for ( const entry of ledger.entries ) {

		requireKeys( entry, [ 'path', 'sha256', 'byteLength', 'kind' ], 'artifact ledger entry' );
		requireString( entry.path, 'artifact ledger entry.path' );
		if ( entry.path === 'evidence-manifest.json' || paths.has( entry.path ) ) throw new Error( 'Normative file/hash ledger contains a self-hash or duplicate path.' );
		paths.add( entry.path );
		const path = await resolveConfinedPath( artifactDir, entry.path, { label: `artifact ledger ${ entry.path }` } );
		const bytes = await readFile( path );
		if ( entry.byteLength !== bytes.byteLength || normalizedSha256( entry.sha256 ) !== sha256Digest( bytes ) ) throw new Error( `Artifact ledger hash mismatch for ${ entry.path }.` );

	}
	for ( const required of [ ...REQUIRED_V2_ARTIFACTS.filter( ( path ) => path !== 'evidence-manifest.json' ), ...contract.requiredImages, 'capture-session.json' ] ) if ( paths.has( required ) === false ) throw new Error( `Normative file/hash ledger omits ${ required }.` );
	if ( canonicalDigest( ledger.entries ) !== ledger.digest ) throw new Error( 'Normative file/hash ledger digest is stale.' );
	const freshWrites = new Set( captureSession.artifactWrites.map( ( entry ) => entry.path ) );
	for ( const entry of ledger.entries ) if ( entry.path !== 'capture-session.json' && freshWrites.has( entry.path ) === false ) throw new Error( `Artifact ledger path ${ entry.path } was not written by the finalized shared capture-session.` );
	return ledger;

}

function unpackCaptureRows( bytes, layout, label, { requireZeroPadding = false } = {} ) {

	for ( const key of [ 'width', 'height', 'rowBytes', 'bytesPerRow', 'byteLength' ] ) if ( Number.isInteger( layout?.[ key ] ) === false || layout[ key ] <= 0 ) throw new Error( `${ label } has an invalid integer ${ key }.` );
	if ( layout.rowBytes !== layout.width * 4 || layout.bytesPerRow < layout.rowBytes || bytes.byteLength !== layout.byteLength ) throw new Error( `${ label } layout does not reconcile with its bytes.` );
	const compact = Buffer.alloc( layout.rowBytes * layout.height );
	for ( let row = 0; row < layout.height; row ++ ) {

		const sourceOffset = row * layout.bytesPerRow;
		if ( sourceOffset + layout.rowBytes > bytes.byteLength ) throw new Error( `${ label } row ${ row } exceeds retained bytes.` );
		bytes.copy( compact, row * layout.rowBytes, sourceOffset, sourceOffset + layout.rowBytes );
		if ( requireZeroPadding ) for ( let index = sourceOffset + layout.rowBytes; index < Math.min( sourceOffset + layout.bytesPerRow, bytes.byteLength ); index ++ ) if ( bytes[ index ] !== 0 ) throw new Error( `${ label } contains nonzero normalized padding.` );

	}
	if ( layout.origin === 'bottom-left' ) {

		const flipped = Buffer.alloc( compact.byteLength );
		for ( let row = 0; row < layout.height; row ++ ) compact.copy( flipped, row * layout.rowBytes, ( layout.height - 1 - row ) * layout.rowBytes, ( layout.height - row ) * layout.rowBytes );
		return flipped;

	}
	if ( layout.origin !== 'top-left' ) throw new Error( `${ label } has an unknown row origin.` );
	return compact;

}

async function validateCaptureReadbackBindings( artifactDir, captureSession, contract ) {

	const directByPng = new Map();
	for ( const capture of captureSession.writtenCaptures ) {

		requireKeys( capture, [ 'width', 'height', 'transport', 'normalized', 'png' ], 'capture-session.json.writtenCaptures[]' );
		const references = [
			[ capture.transport.artifact, 'transport readback' ],
			[ capture.normalized.artifact, 'normalized readback' ],
			[ capture.png, 'capture PNG' ]
		];
		const retained = {};
		for ( const [ reference, name ] of references ) {

			requireKeys( reference, [ 'path', 'sha256', 'byteLength' ], `${ name } reference` );
			const path = await resolveConfinedPath( artifactDir, reference.path, { label: `${ name } ${ reference.path }` } );
			const bytes = await readFile( path );
			if ( bytes.byteLength !== reference.byteLength || sha256Digest( bytes ) !== normalizedSha256( reference.sha256 ) ) throw new Error( `${ name } hash or byte length does not match retained bytes.` );
			retained[ name ] = bytes;

		}
		if ( capture.transport.rendererCopy?.rawBytesRetained !== true ) throw new Error( `${ capture.png.path } does not retain the renderer transport bytes.` );
		const transportCompact = unpackCaptureRows( retained[ 'transport readback' ], capture.transport.layout, `${ capture.png.path } transport` );
		const normalizedLayout = {
			width: capture.width,
			height: capture.height,
			rowBytes: capture.width * 4,
			bytesPerRow: capture.normalized.bytesPerRow,
			byteLength: capture.normalized.byteLength,
			origin: capture.normalized.origin
		};
		const normalizedCompact = unpackCaptureRows( retained[ 'normalized readback' ], normalizedLayout, `${ capture.png.path } normalized`, { requireZeroPadding: true } );
		if ( transportCompact.equals( normalizedCompact ) === false ) throw new Error( `${ capture.png.path } raw transport does not bind to its normalized pixels.` );
		if ( sha256Digest( normalizedCompact ) !== normalizedSha256( capture.normalized.compactRgbaSha256 ) ) throw new Error( `${ capture.png.path } normalized compact hash is stale.` );
		const decoded = decodeGeneratedRgbaPixels( retained[ 'capture PNG' ] );
		if ( decoded.width !== capture.width || decoded.height !== capture.height || Buffer.from( decoded.pixels ).equals( normalizedCompact ) === false ) throw new Error( `${ capture.png.path } PNG is not byte-derived from its normalized readback.` );
		if ( capture.png.derivedFromCompactRgbaSha256 !== capture.normalized.compactRgbaSha256 ) throw new Error( `${ capture.png.path } PNG derivation metadata is stale.` );
		if ( capture.controllerNormalized && capture.controllerNormalized.reconciliationStatus !== 'PASS' ) throw new Error( `${ capture.png.path } controller-normalized reconciliation did not pass.` );
		directByPng.set( capture.png.path, { capture, compact: normalizedCompact } );

	}
	const outputs = new Map( captureSession.outputPlan.filter( ( output ) => output.status === 'CAPTURED' ).map( ( output ) => [ output.filename, output ] ) );
	for ( const image of contract.requiredImages ) {

		const direct = directByPng.get( image );
		const output = outputs.get( image );
		if ( ! direct && ! output ) throw new Error( `Finalized capture-session has no direct or validated derived evidence for ${ image }.` );
		if ( output ) {

			const path = await resolveConfinedPath( artifactDir, image, { label: `captured output ${ image }` } );
			const bytes = await readFile( path );
			if ( output.artifact?.sha256 !== sha256Digest( bytes ) || output.artifact?.byteLength !== bytes.byteLength ) throw new Error( `Captured output ${ image } hash is stale.` );
			if ( direct === undefined && output.derivation?.validationStatus !== 'PASS' ) throw new Error( `Derived output ${ image } lacks shared-runner validation.` );

		}

	}
	const hookCaptures = captureSession.hookResult?.captures;
	requireArray( hookCaptures, 'capture-session.json.hookResult.captures', contract.requiredImages.length );
	for ( const record of hookCaptures ) {

		const direct = directByPng.get( record.filename );
		if ( direct && record.pngSha256 !== direct.capture.png.sha256 ) throw new Error( `${ record.filename } hook capture record lost its PNG hash binding.` );
		if ( record.filename === 'diagnostics.mosaic.png' && typeof record.pngSha256 !== 'string' ) throw new Error( 'diagnostics.mosaic capture record is missing pngSha256.' );

	}
	const mosaicOutput = captureSession.hookResult?.standardOutputs?.find( ( output ) => output?.filename === 'diagnostics.mosaic.png' );
	requireObject( mosaicOutput, 'capture-session.json.hookResult diagnostics mosaic output' );
	if ( mosaicOutput.derivation?.algorithm !== DIAGNOSTIC_MOSAIC_RECIPE ) throw new Error( 'diagnostics.mosaic uses an unknown derivation recipe.' );
	if ( JSON.stringify( mosaicOutput.sourceCaptures ) !== JSON.stringify( DIAGNOSTIC_MOSAIC_SOURCES ) ) throw new Error( 'diagnostics.mosaic source order does not match the named recipe.' );
	const mosaicRawReference = mosaicOutput.pixelEvidence?.normalized?.rawArtifact;
	requireKeys( mosaicRawReference, [ 'path', 'sha256', 'byteLength' ], 'diagnostics.mosaic normalized raw reference' );
	const mosaicRawPath = await resolveConfinedPath( artifactDir, mosaicRawReference.path, { label: 'diagnostics.mosaic normalized raw artifact' } );
	const mosaicRawBytes = await readFile( mosaicRawPath );
	if ( mosaicRawBytes.byteLength !== mosaicRawReference.byteLength || sha256Digest( mosaicRawBytes ) !== normalizedSha256( mosaicRawReference.sha256 ) ) throw new Error( 'diagnostics.mosaic normalized raw artifact hash is stale.' );
	const mosaicCompact = unpackCaptureRows( mosaicRawBytes, {
		width: mosaicOutput.width,
		height: mosaicOutput.height,
		rowBytes: mosaicOutput.width * 4,
		bytesPerRow: mosaicOutput.pixelEvidence.normalized.paddedBytesPerRow,
		byteLength: mosaicRawReference.byteLength,
		origin: mosaicOutput.pixelEvidence.normalized.origin
	}, 'diagnostics.mosaic normalized derivation', { requireZeroPadding: true } );
	const sources = new Map( DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename ) => {

		const source = directByPng.get( filename );
		if ( ! source ) throw new Error( `diagnostics.mosaic cannot reach retained source readback ${ filename }.` );
		return [ filename, { width: source.capture.width, height: source.capture.height, data: source.compact } ];

	} ) );
	const reconstructed = reconstructDiagnosticMosaic( sources );
	if ( Buffer.from( reconstructed.data ).equals( mosaicCompact ) === false ) throw new Error( 'diagnostics.mosaic pixels do not reconstruct exactly from the four named retained readbacks.' );
	if ( reconstructed.recipe.quadrants.length !== mosaicOutput.derivation.quadrants?.length ) throw new Error( 'diagnostics.mosaic quadrant recipe is incomplete.' );
	for ( let index = 0; index < reconstructed.recipe.quadrants.length; index ++ ) {

		const expected = reconstructed.recipe.quadrants[ index ];
		const observed = mosaicOutput.derivation.quadrants[ index ];
		for ( const key of [ 'source', 'sampling' ] ) if ( observed?.[ key ] !== expected[ key ] ) throw new Error( `diagnostics.mosaic quadrant ${ index } ${ key } drifted.` );
		if ( JSON.stringify( observed.outputRect ) !== JSON.stringify( expected.outputRect ) ) throw new Error( `diagnostics.mosaic quadrant ${ index } output rectangle drifted.` );
		if ( normalizedSha256( observed.sourceCompactRgbaSha256 ) !== sha256Digest( sources.get( expected.source ).data ).replace( /^sha256:/, '' ) ) throw new Error( `diagnostics.mosaic quadrant ${ index } source hash drifted.` );

	}
	return directByPng;

}

export async function validateFinalizedCaptureSession( artifactDir, manifest, contract ) {

	let path;
	try {

		path = await resolveConfinedPath( artifactDir, 'capture-session.json', { label: 'finalized shared capture-session' } );

	} catch {

		throw new Error( 'Publishable browser evidence requires a finalized shared capture-session.' );

	}
	const bytes = await readFile( path );
	const captureSession = JSON.parse( bytes.toString( 'utf8' ) );
	requireKeys( captureSession, [
		'schemaVersion', 'labId', 'sourceClosureHash', 'sourceClosure', 'buildRevision', 'threeRevision',
		'profile', 'profileConfig', 'automationSurface', 'adapterClass', 'adapterIdentity', 'route',
		'startedAt', 'finishedAt', 'runtime', 'finalRuntime', 'postDisposeSnapshot', 'outputPlan',
		'writtenCaptures', 'artifactWrites', 'hookResult', 'pageErrors', 'consoleErrors', 'requestErrors', 'note'
	], 'capture-session.json' );
	if ( captureSession.schemaVersion !== 2 || captureSession.labId !== 'webgpu-validation-harness' || captureSession.profile !== 'performance' || captureSession.automationSurface !== 'codex-in-app-browser' ) throw new Error( 'Finalized shared capture-session identity is invalid.' );
	if ( captureSession.note !== 'Capture-session record only; it is not a complete v2 evidence bundle.' ) throw new Error( 'Finalized shared capture-session does not use the shared runner contract.' );
	const startedAt = Date.parse( captureSession.startedAt );
	const finishedAt = Date.parse( captureSession.finishedAt );
	if ( Number.isFinite( startedAt ) === false || Number.isFinite( finishedAt ) === false || finishedAt < startedAt ) throw new Error( 'Finalized shared capture-session timestamps are invalid.' );
	if ( captureSession.hookResult?.status !== 'incomplete' || captureSession.hookResult?.publishable !== false ) throw new Error( 'Capture hook must always finish as incomplete before offline promotion.' );
	emptyFailureLists( captureSession );
	validateSessionBackendIdentity( captureSession.runtime?.metrics, 'runtime.metrics' );
	validateSessionBackendIdentity( captureSession.finalRuntime?.metrics, 'finalRuntime.metrics' );
	requireArray( captureSession.outputPlan, 'capture-session.json.outputPlan', REQUIRED_V2_IMAGES.length );
	requireArray( captureSession.writtenCaptures, 'capture-session.json.writtenCaptures', REQUIRED_V2_IMAGES.length );
	requireArray( captureSession.artifactWrites, 'capture-session.json.artifactWrites', REQUIRED_V2_ARTIFACTS.length + REQUIRED_V2_IMAGES.length );
	const registry = buildDemoRegistry();
	const currentLab = registry.demos.find( ( demo ) => demo.id === 'webgpu-validation-harness' );
	if ( ! currentLab ) throw new Error( 'Current demo registry does not contain webgpu-validation-harness.' );
	const expectedClosure = {
		algorithm: 'demo-registry-transitive-source-closure-v2',
		roots: [ ...( currentLab.sourceHashInputs ?? currentLab.canonicalSource ) ],
		files: null,
		threeRevision: '0.185.1',
		sourceHash: currentLab.sourceHash,
		buildRevision: registry.buildRevision
	};
	if ( canonicalDigest( captureSession.sourceClosure ) !== canonicalDigest( expectedClosure ) ) throw new Error( 'Finalized shared capture-session source closure does not match current source recomputation.' );
	for ( const [ actual, expected, label ] of [
		[ captureSession.sourceClosureHash, currentLab.sourceHash, 'capture-session source hash' ],
		[ captureSession.buildRevision, registry.buildRevision, 'capture-session build revision' ],
		[ manifest.sourceClosureHash, currentLab.sourceHash, 'manifest source hash' ],
		[ manifest.buildRevision, registry.buildRevision, 'manifest build revision' ]
	] ) if ( actual !== expected ) throw new Error( `${ label } does not match current registry recomputation.` );
	const ledger = await validateArtifactLedger( artifactDir, manifest, captureSession, contract );
	await validateCaptureReadbackBindings( artifactDir, captureSession, contract );
	return { captureSession, captureSessionSha256: sha256Digest( bytes ), artifactLedger: ledger };

}

function validateClaimVerdicts( verdicts, bundleKind ) {

	requireKeys( verdicts, CLAIM_CLASSES, 'evidence-manifest.json.claimVerdicts' );

	for ( const claim of CLAIM_CLASSES ) {

		requireVerdict( verdicts[ claim ], `claimVerdicts.${ claim }` );

		if ( bundleKind === 'contract-fixture' && verdicts[ claim ] !== 'NOT_CLAIMED' ) {

			throw new Error( `Contract fixture cannot claim ${ claim }; its verdict must be NOT_CLAIMED.` );

		}

	}

	if ( bundleKind === 'browser-capture' ) {

		for ( const claim of CLAIM_CLASSES ) {

			if ( verdicts[ claim ] !== 'PASS' ) throw new Error( `Publishable browser capture requires ${ claim } verdict PASS.` );

		}

	}

	if ( bundleKind === 'browser-capture-incomplete' && CLAIM_CLASSES.every( ( claim ) => verdicts[ claim ] === 'PASS' ) ) {

		throw new Error( 'Incomplete browser capture cannot report every required claim as PASS.' );

	}

}

function validateVisualContract( contract ) {

	requireLabelledArtifact( contract, 'visual-contract.json' );
	requireKeys( contract, [
		'contractRevision', 'subject', 'identity', 'invariants', 'requiredImages',
		'requiredDiagnostics', 'requiredMetrics', 'blockingFailures', 'allowedDivergences',
		'performanceClaims', 'imageComparisons'
	], 'visual-contract.json' );

	requireString( contract.contractRevision, 'visual-contract.json.contractRevision' );
	requireString( contract.subject, 'visual-contract.json.subject' );
	requireArray( contract.identity, 'visual-contract.json.identity', 1 );
	requireArray( contract.invariants, 'visual-contract.json.invariants', 1 );
	requireArray( contract.requiredImages, 'visual-contract.json.requiredImages', 1 );

	if ( contract.requiredImages.length === 1 && contract.requiredImages[ 0 ] === 'final.design.png' ) {

		throw new Error( 'final-only evidence is invalid; no-post and diagnostic captures are mandatory.' );

	}

	for ( const image of REQUIRED_V2_IMAGES ) {

		if ( contract.requiredImages.includes( image ) === false ) throw new Error( `visual-contract.json is missing required image ${ image }.` );

	}

	if ( contract.requiredImages.includes( 'no-post.design.png' ) === false ) {

		throw new Error( 'A final-only evidence contract is invalid; no-post and diagnostic evidence are mandatory.' );

	}

	for ( const [ index, invariant ] of contract.invariants.entries() ) {

		const label = `visual-contract.json.invariants[${ index }]`;
		requireKeys( invariant, [ 'id', 'statement', 'domain', 'truthSource', 'diagnostic', 'metric', 'gate', 'requiredArtifacts', 'blockingFailure' ], label );
		for ( const key of [ 'id', 'statement', 'domain', 'truthSource', 'diagnostic', 'metric', 'blockingFailure' ] ) requireString( invariant[ key ], `${ label }.${ key }` );
		validateNumericDatum( invariant.gate, `${ label }.gate` );
		requireArray( invariant.requiredArtifacts, `${ label }.requiredArtifacts`, 1 );

	}

	requireKeys( contract.performanceClaims, [ 'gpuTimingRequirement', 'claims' ], 'visual-contract.json.performanceClaims' );
	requireArray( contract.performanceClaims.claims, 'visual-contract.json.performanceClaims.claims' );
	if ( [ 'required', 'not-claimed' ].includes( contract.performanceClaims.gpuTimingRequirement ) === false ) {

		throw new Error( 'visual-contract.json.performanceClaims.gpuTimingRequirement must be required or not-claimed.' );

	}

	requireArray( contract.imageComparisons, 'visual-contract.json.imageComparisons', 1 );
	for ( const [ index, comparison ] of contract.imageComparisons.entries() ) {

		const label = `visual-contract.json.imageComparisons[${ index }]`;
		requireKeys( comparison, [ 'id', 'baseline', 'candidate', 'maxDifferingRatio' ], label );
		requireString( comparison.id, `${ label }.id` );
		requireString( comparison.baseline, `${ label }.baseline` );
		requireString( comparison.candidate, `${ label }.candidate` );
		validateNumericDatum( comparison.maxDifferingRatio, `${ label }.maxDifferingRatio` );

	}

}

function validateEvidenceManifest( manifest ) {

	requireLabelledArtifact( manifest, 'evidence-manifest.json' );
	requireKeys( manifest, [
		'bundleKind', 'publishable', 'skill', 'sceneId', 'threeRevision', 'evidenceBundleId',
		'captureProfile', 'automationSurface', 'adapterClass', 'sourceClosureHash', 'buildRevision',
		'targetId', 'device', 'browser', 'os', 'gpuAdapter', 'displayRefresh',
		'targetPresentationRate', 'renderer', 'backend', 'qualityState', 'viewport',
		'camera', 'seed', 'time', 'assets', 'colorPipeline', 'stochasticMasks',
		'knownCompromises', 'pipelineGraphDigest', 'claimVerdicts', 'promotion'
	], 'evidence-manifest.json' );

	if ( [ ...BROWSER_CAPTURE_KINDS, 'contract-fixture' ].includes( manifest.bundleKind ) === false ) throw new Error( 'Unknown evidence bundleKind.' );
	requireBoolean( manifest.publishable, 'evidence-manifest.json.publishable' );
	if ( manifest.bundleKind === 'contract-fixture' && manifest.publishable !== false ) throw new Error( 'Fixture-only bundle cannot be publishable.' );
	if ( manifest.bundleKind === 'browser-capture' && manifest.publishable !== true ) throw new Error( 'Browser capture bundle must explicitly mark publishable true.' );
	if ( manifest.bundleKind === 'browser-capture' && manifest.captureProfile !== 'performance' ) throw new Error( 'Publishable browser capture requires the hardware performance profile.' );
	if ( manifest.bundleKind === 'browser-capture-incomplete' && manifest.publishable !== false ) throw new Error( 'Incomplete browser capture must explicitly mark publishable false.' );
	if ( manifest.skill !== 'threejs-visual-validation' ) throw new Error( 'evidence-manifest.json skill id is wrong.' );
	if ( manifest.threeRevision !== '0.185.1' ) throw new Error( 'Canonical v2 evidence requires Three 0.185.1.' );
	if ( CAPTURE_PROFILES.has( manifest.captureProfile ) === false ) throw new Error( 'evidence-manifest.json.captureProfile is invalid.' );
	if ( ADAPTER_CLASSES.has( manifest.adapterClass ) === false ) throw new Error( 'evidence-manifest.json.adapterClass is invalid.' );
	for ( const key of [ 'automationSurface', 'sourceClosureHash', 'buildRevision' ] ) requireString( manifest[ key ], `evidence-manifest.json.${ key }` );
	for ( const key of [ 'sceneId', 'evidenceBundleId', 'targetId', 'device', 'browser', 'os', 'renderer', 'qualityState', 'seed', 'pipelineGraphDigest' ] ) requireString( manifest[ key ], `evidence-manifest.json.${ key }` );
	validateNumericDatum( manifest.displayRefresh, 'evidence-manifest.json.displayRefresh' );
	validateNumericDatum( manifest.targetPresentationRate, 'evidence-manifest.json.targetPresentationRate' );
	requireKeys( manifest.backend, [ 'isWebGPUBackend', 'initialized', 'timestampAvailable', 'unavailableReason', 'features', 'limits', 'deviceLostObserved', 'uncapturedErrors' ], 'evidence-manifest.json.backend' );
	requireBoolean( manifest.backend.isWebGPUBackend, 'evidence-manifest.json.backend.isWebGPUBackend' );
	requireBoolean( manifest.backend.initialized, 'evidence-manifest.json.backend.initialized' );
	requireBoolean( manifest.backend.timestampAvailable, 'evidence-manifest.json.backend.timestampAvailable' );

	if ( BROWSER_CAPTURE_KINDS.has( manifest.bundleKind ) && ( manifest.backend.isWebGPUBackend !== true || manifest.backend.initialized !== true ) ) {

		throw new Error( 'Canonical browser capture requires initialized native WebGPU.' );

	}

	requireKeys( manifest.viewport, [ 'width', 'height', 'dpr' ], 'evidence-manifest.json.viewport' );
	for ( const key of [ 'width', 'height', 'dpr' ] ) validateNumericDatum( manifest.viewport[ key ], `evidence-manifest.json.viewport.${ key }` );
	requireKeys( manifest.camera, [ 'bookmark', 'matrixWorld', 'projectionMatrix', 'near', 'far' ], 'evidence-manifest.json.camera' );
	requireString( manifest.camera.bookmark, 'evidence-manifest.json.camera.bookmark' );
	validateNumericArray( manifest.camera.matrixWorld, 'evidence-manifest.json.camera.matrixWorld' );
	validateNumericArray( manifest.camera.projectionMatrix, 'evidence-manifest.json.camera.projectionMatrix' );
	validateNumericDatum( manifest.camera.near, 'evidence-manifest.json.camera.near' );
	validateNumericDatum( manifest.camera.far, 'evidence-manifest.json.camera.far' );
	requireKeys( manifest.time, [ 'fixed', 'seconds', 'frame' ], 'evidence-manifest.json.time' );
	requireBoolean( manifest.time.fixed, 'evidence-manifest.json.time.fixed' );
	validateNumericDatum( manifest.time.seconds, 'evidence-manifest.json.time.seconds' );
	validateNumericDatum( manifest.time.frame, 'evidence-manifest.json.time.frame' );
	validateClaimVerdicts( manifest.claimVerdicts, manifest.bundleKind );
	if ( manifest.adapterClass === 'software' && manifest.claimVerdicts.performanceCompliance !== 'NOT_CLAIMED' ) throw new Error( 'software-adapter-hardware-claim: software timing must remain NOT_CLAIMED for performance compliance.' );
	if ( manifest.claimVerdicts.performanceCompliance === 'PASS' && manifest.adapterClass !== 'hardware' ) throw new Error( 'Hardware performance PASS requires a named hardware adapter.' );

}

function validateRendererInfo( rendererInfo, manifest ) {

	requireLabelledArtifact( rendererInfo, 'renderer-info.json' );
	requireKeys( rendererInfo, [
		'threeRevision', 'renderer', 'backend', 'outputColorSpace', 'toneMapping',
		'captureProfile', 'adapterClass',
		'toneMappingExposure', 'sampleCount', 'depthMode', 'outputBufferType',
		'compatibilityMode', 'timestampSupport', 'adapterFeatures', 'adapterLimits',
		'initializationState', 'deviceLostObserved', 'uncapturedErrors', 'deviceErrors', 'rendererInfoSnapshots'
	], 'renderer-info.json' );
	if ( rendererInfo.threeRevision !== manifest.threeRevision ) throw new Error( 'renderer-info.json Three revision disagrees with manifest.' );
	if ( BROWSER_CAPTURE_KINDS.has( manifest.bundleKind ) && rendererInfo.backend !== 'WebGPU' ) throw new Error( 'renderer-info.json does not record WebGPU backend.' );
	if ( rendererInfo.captureProfile !== manifest.captureProfile ) throw new Error( 'renderer-info.json capture profile disagrees with manifest.' );
	if ( rendererInfo.adapterClass !== manifest.adapterClass ) throw new Error( 'renderer-info.json adapter class disagrees with manifest.' );
	requireBoolean( rendererInfo.deviceLostObserved, 'renderer-info.json.deviceLostObserved' );
	requireArray( rendererInfo.uncapturedErrors, 'renderer-info.json.uncapturedErrors' );
	requireArray( rendererInfo.deviceErrors, 'renderer-info.json.deviceErrors' );
	if ( rendererInfo.deviceLostObserved !== manifest.backend.deviceLostObserved || JSON.stringify( rendererInfo.uncapturedErrors ) !== JSON.stringify( manifest.backend.uncapturedErrors ) ) throw new Error( 'forged-clean-device-state: renderer and manifest device state disagree.' );

}

function validatePipelineGraph( graph, manifest ) {

	requireLabelledArtifact( graph, 'pipeline-graph.json' );
	requireKeys( graph, [
		'runtimeProfile', 'performanceTimestampMode', 'timestampQueriesRequired', 'timestampQueriesRequested', 'timestampQueriesActive',
		'graphDigest', 'owners', 'ownerClaims', 'signals', 'sceneSubmissions',
		'computeDispatches', 'resources', 'finalToneMapOwner',
		'finalOutputTransformOwner', 'captureRoutes'
	], 'pipeline-graph.json' );
	if ( graph.graphDigest !== manifest.pipelineGraphDigest ) throw new Error( 'stale-pipeline-graph: manifest digest does not match pipeline-graph.json.' );
	if ( BROWSER_CAPTURE_KINDS.has( manifest.bundleKind ) ) {

		const { schemaVersion, graphDigest, ...graphBody } = graph;
		if ( canonicalDigest( graphBody ) !== graphDigest ) throw new Error( 'stale-pipeline-graph: graph digest does not match the canonical runtime graph.' );

	}
	if ( graph.runtimeProfile !== manifest.captureProfile && manifest.captureProfile !== 'schema-fixture' ) throw new Error( 'Pipeline runtime profile disagrees with the capture profile.' );
	for ( const key of [ 'timestampQueriesRequired', 'timestampQueriesRequested', 'timestampQueriesActive' ] ) requireBoolean( graph[ key ], `pipeline-graph.json.${ key }` );
	requireString( graph.finalToneMapOwner, 'pipeline-graph.json.finalToneMapOwner' );
	requireString( graph.finalOutputTransformOwner, 'pipeline-graph.json.finalOutputTransformOwner' );
	if ( graph.finalToneMapOwner === 'duplicate' || graph.finalOutputTransformOwner === 'duplicate' ) throw new Error( 'duplicate-output-owner is forbidden.' );
	requireArray( graph.ownerClaims, 'pipeline-graph.json.ownerClaims', 4 );
	for ( const [ index, claim ] of graph.ownerClaims.entries() ) {

		const label = `pipeline-graph.json.ownerClaims[${ index }]`;
		requireKeys( claim, [ 'semantic', 'owner', 'producerCount' ], label );
		requireString( claim.semantic, `${ label }.semantic` );
		requireString( claim.owner, `${ label }.owner` );
		validateNumericDatum( claim.producerCount, `${ label }.producerCount` );
		if ( OWNERSHIP_SINGLETONS.has( claim.semantic ) && numericValue( claim.producerCount, `${ label }.producerCount` ) !== 1 ) {

			throw new Error( `duplicate-output-owner: ${ claim.semantic } must have exactly one producer.` );

		}

	}

	requireKeys( graph.captureRoutes, MECHANISM_MODES, 'pipeline-graph.json.captureRoutes' );
	const outputNodeIds = new Set();
	for ( const mode of MECHANISM_MODES ) {

		requireKeys( graph.captureRoutes[ mode ], [ 'mode', 'outputNodeId' ], `pipeline-graph.json.captureRoutes.${ mode }` );
		if ( graph.captureRoutes[ mode ].mode !== mode ) throw new Error( `false-diagnostic-route: ${ mode } route does not select ${ mode } mode.` );
		requireString( graph.captureRoutes[ mode ].outputNodeId, `pipeline-graph.json.captureRoutes.${ mode }.outputNodeId` );
		outputNodeIds.add( graph.captureRoutes[ mode ].outputNodeId );

	}

	if ( outputNodeIds.size !== MECHANISM_MODES.length ) {

		throw new Error( 'false-diagnostic-route: final, no-post, normal, and emissive routes must own distinct output nodes.' );

	}

}

function validatePerformance( envelope, trace, manifest, contract ) {

	requireLabelledArtifact( envelope, 'performance-envelope.json' );
	requireLabelledArtifact( trace, 'frame-trace.json' );
	requireKeys( envelope, [
		'gpuTimingRequirement', 'refreshPeriod', 'browserMainThreadReserve',
		'compositorGpuReserve', 'cpuSafetyReserve', 'gpuSafetyReserve',
		'cpuSceneEnvelope', 'gpuSceneEnvelope', 'cpuP95Gate', 'gpuP95Gate',
		'deadlineMissRatioGate'
	], 'performance-envelope.json' );
	if ( envelope.gpuTimingRequirement !== contract.performanceClaims.gpuTimingRequirement ) throw new Error( 'GPU timing requirement drifted between contract and envelope.' );
	requireKeys( trace, [ 'clockSource', 'warmup', 'cold', 'sustained', 'gpuTimingAvailable', 'renderTimestamp', 'computeTimestamp', 'presentationCadence', 'excludedPhases' ], 'frame-trace.json' );
	requireKeys( trace, [ 'captureProfile', 'adapterClass' ], 'frame-trace.json' );
	if ( trace.captureProfile !== manifest.captureProfile ) throw new Error( 'Frame trace capture profile disagrees with manifest.' );
	if ( trace.adapterClass !== manifest.adapterClass ) throw new Error( 'Frame trace adapter class disagrees with manifest.' );
	requireBoolean( trace.gpuTimingAvailable, 'frame-trace.json.gpuTimingAvailable' );

	for ( const segmentName of [ 'warmup', 'cold', 'sustained' ] ) {

		const segment = trace[ segmentName ];
		requireKeys( segment, [ 'cpuSamples', 'presentationSamples', 'cpuP50', 'cpuP95', 'presentationP95', 'deadlineMissRatio' ], `frame-trace.json.${ segmentName }` );
		const cpuSamples = numericPopulation( segment.cpuSamples, `frame-trace.json.${ segmentName }.cpuSamples` );
		const presentationSamples = numericPopulation( segment.presentationSamples, `frame-trace.json.${ segmentName }.presentationSamples` );
		for ( const key of [ 'cpuP50', 'cpuP95', 'presentationP95', 'deadlineMissRatio' ] ) validateNumericDatum( segment[ key ], `frame-trace.json.${ segmentName }.${ key }` );
		requireRecomputed( numericValue( segment.cpuP50 ), percentile( cpuSamples, 0.5 ), `frame-trace.json.${ segmentName }.cpuP50` );
		requireRecomputed( numericValue( segment.cpuP95 ), percentile( cpuSamples, 0.95 ), `frame-trace.json.${ segmentName }.cpuP95` );
		requireRecomputed( numericValue( segment.presentationP95 ), percentile( presentationSamples, 0.95 ), `frame-trace.json.${ segmentName }.presentationP95` );
		const deadline = numericValue( envelope.refreshPeriod, 'performance-envelope.json.refreshPeriod' );
		const missRatio = presentationSamples.filter( ( value ) => value > deadline ).length / presentationSamples.length;
		requireRecomputed( numericValue( segment.deadlineMissRatio ), missRatio, `frame-trace.json.${ segmentName }.deadlineMissRatio` );

	}

	const cpuP95 = numericValue( trace.sustained.cpuP95, 'frame-trace.json.sustained.cpuP95' );
	const cpuGate = numericValue( envelope.cpuP95Gate, 'performance-envelope.json.cpuP95Gate' );
	const gpuGate = numericValue( envelope.gpuP95Gate, 'performance-envelope.json.gpuP95Gate' );
	const deadlineMissRatio = numericValue( trace.sustained.deadlineMissRatio, 'frame-trace.json.sustained.deadlineMissRatio' );
	const deadlineMissRatioGate = numericValue( envelope.deadlineMissRatioGate, 'performance-envelope.json.deadlineMissRatioGate' );
	if ( manifest.adapterClass !== 'hardware' ) {

		if ( contract.performanceClaims.gpuTimingRequirement !== 'not-claimed' || contract.performanceClaims.claims.length !== 0 ) throw new Error( 'nonhardware-adapter-hardware-claim: software, virtual, and unknown traces cannot advertise hardware performance claims.' );
		if ( envelope.gpuTimingRequirement !== 'not-claimed' ) throw new Error( 'nonhardware-adapter-hardware-claim: nonhardware traces cannot require hardware performance timing.' );

	}
	if ( manifest.claimVerdicts.performanceCompliance === 'PASS' && cpuP95 > cpuGate ) {

		throw new Error( `p95-overrun: CPU sustained p95 ${ cpuP95 } exceeds gate ${ cpuGate }.` );

	}

	if ( envelope.gpuTimingRequirement === 'required' ) {

		if ( trace.gpuTimingAvailable !== true || trace.renderTimestamp === null ) {

			if ( manifest.claimVerdicts.gpuAttribution !== 'INSUFFICIENT_EVIDENCE' ) {

				throw new Error( 'missing-timestamp: required GPU timing must yield INSUFFICIENT_EVIDENCE.' );

			}

		} else {

			validateNumericDatum( trace.renderTimestamp, 'frame-trace.json.renderTimestamp' );
			if ( trace.computeTimestamp !== null ) validateNumericDatum( trace.computeTimestamp, 'frame-trace.json.computeTimestamp' );
			if ( manifest.claimVerdicts.gpuAttribution !== 'PASS' && manifest.claimVerdicts.gpuAttribution !== 'INSUFFICIENT_EVIDENCE' ) throw new Error( 'Timestamp-backed GPU attribution must be PASS or INSUFFICIENT_EVIDENCE.' );
			const gpuP95 = numericValue( trace.renderTimestamp, 'frame-trace.json.renderTimestamp' );
			if ( manifest.claimVerdicts.performanceCompliance === 'PASS' && gpuP95 > gpuGate ) throw new Error( `p95-overrun: GPU sustained p95 ${ gpuP95 } exceeds gate ${ gpuGate }.` );

		}

	}
	if ( manifest.claimVerdicts.performanceCompliance === 'PASS' && deadlineMissRatio > deadlineMissRatioGate ) throw new Error( `deadline-overrun: miss ratio ${ deadlineMissRatio } exceeds gate ${ deadlineMissRatioGate }.` );
	if ( manifest.claimVerdicts.gpuAttribution === 'PASS' ) {
		if ( envelope.gpuTimingRequirement !== 'required' || contract.performanceClaims.gpuTimingRequirement !== 'required' || trace.gpuTimingAvailable !== true || manifest.backend.timestampAvailable !== true ) throw new Error( 'missing-timestamp: GPU attribution PASS requires positive timestamp availability and a required timing contract.' );
		requireKeys( trace, [ 'sampleFrames', 'timestampResolveCount', 'timestampMappingCadence', 'gpuSamples', 'gpuP50', 'gpuP95' ], 'frame-trace.json' );
		const sampleFrames = readTaggedInteger( trace.sampleFrames, 'frame-trace.json.sampleFrames' );
		const timestampResolveCount = readTaggedInteger( trace.timestampResolveCount, 'frame-trace.json.timestampResolveCount' );
		validateTimestampBatchPolicy( sampleFrames, timestampResolveCount, trace.timestampMappingCadence );
		const gpuSamples = numericPopulation( trace.gpuSamples, 'frame-trace.json.gpuSamples' );
		if ( gpuSamples.length !== sampleFrames ) throw new Error( 'GPU sample population does not equal sampleFrames.' );
		validateNumericDatum( trace.gpuP50, 'frame-trace.json.gpuP50' );
		validateNumericDatum( trace.gpuP95, 'frame-trace.json.gpuP95' );
		requireRecomputed( numericValue( trace.gpuP50 ), percentile( gpuSamples, 0.5 ), 'frame-trace.json.gpuP50' );
		requireRecomputed( numericValue( trace.gpuP95 ), percentile( gpuSamples, 0.95 ), 'frame-trace.json.gpuP95' );
		requireRecomputed( numericValue( trace.renderTimestamp ), percentile( gpuSamples, 0.95 ), 'frame-trace.json.renderTimestamp' );

		const attribution = trace.gpuStageAttribution;
		requireKeys( attribution, [ 'scene-mrt', 'final-output', 'timestampRows', 'lastFrameResolveResidual', 'reconciliationGate', 'reconciliationScope', 'independentPerFrameTotalsAvailable', 'verdict' ], 'frame-trace.json.gpuStageAttribution' );
		const stageSamples = {};
		for ( const id of [ 'scene-mrt', 'final-output' ] ) {

			requireKeys( attribution[ id ], [ 'samples', 'p50', 'p95' ], `frame-trace.json.gpuStageAttribution.${ id }` );
			stageSamples[ id ] = numericPopulation( attribution[ id ].samples, `frame-trace.json.gpuStageAttribution.${ id }.samples` );
			if ( stageSamples[ id ].length !== sampleFrames ) throw new Error( `${ id } attribution sample count must equal sampleFrames.` );
			validateNumericDatum( attribution[ id ].p50, `frame-trace.json.gpuStageAttribution.${ id }.p50` );
			validateNumericDatum( attribution[ id ].p95, `frame-trace.json.gpuStageAttribution.${ id }.p95` );
			requireRecomputed( numericValue( attribution[ id ].p50 ), percentile( stageSamples[ id ], 0.5 ), `frame-trace.json.gpuStageAttribution.${ id }.p50` );
			requireRecomputed( numericValue( attribution[ id ].p95 ), percentile( stageSamples[ id ], 0.95 ), `frame-trace.json.gpuStageAttribution.${ id }.p95` );

		}
		requireArray( attribution.timestampRows, 'frame-trace.json.gpuStageAttribution.timestampRows', sampleFrames );
		if ( attribution.timestampRows.length !== sampleFrames || attribution.independentPerFrameTotalsAvailable !== false ) throw new Error( 'GPU timestamp rows must cover every frame without claiming unavailable independent totals.' );
		for ( let index = 0; index < sampleFrames; index ++ ) {

			const row = attribution.timestampRows[ index ];
			requireKeys( row, [ 'frameId', 'sceneUid', 'outputUid', 'sceneMs', 'outputMs', 'totalMs', 'residualMs', 'totalProvenance', 'independentPerFrameTotalAvailable' ], `frame-trace.json.gpuStageAttribution.timestampRows[${ index }]` );
			for ( const key of [ 'frameId', 'sceneMs', 'outputMs', 'totalMs' ] ) validateNumericDatum( row[ key ], `frame-trace.json.gpuStageAttribution.timestampRows[${ index }].${ key }` );
			if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) throw new Error( `GPU timestamp row ${ index } overclaims independent reconciliation.` );
			const sceneMs = numericValue( row.sceneMs );
			const outputMs = numericValue( row.outputMs );
			requireRecomputed( sceneMs, stageSamples[ 'scene-mrt' ][ index ], `GPU timestamp row ${ index } scene stage` );
			requireRecomputed( outputMs, stageSamples[ 'final-output' ][ index ], `GPU timestamp row ${ index } output stage` );
			requireRecomputed( numericValue( row.totalMs ), sceneMs + outputMs, `GPU timestamp row ${ index } total` );
			requireRecomputed( gpuSamples[ index ], sceneMs + outputMs, `GPU timestamp row ${ index } population total` );

		}
		validateNumericDatum( attribution.lastFrameResolveResidual, 'frame-trace.json.gpuStageAttribution.lastFrameResolveResidual' );
		validateNumericDatum( attribution.reconciliationGate, 'frame-trace.json.gpuStageAttribution.reconciliationGate' );
		if ( attribution.verdict !== 'PASS' ) throw new Error( 'GPU attribution PASS requires a PASS stage-attribution verdict.' );
		if ( numericValue( attribution.lastFrameResolveResidual ) > numericValue( attribution.reconciliationGate ) ) throw new Error( 'gpu-attribution-mismatch: final-frame Three resolve does not reconcile with attributed stages.' );

	}

}

function validateQualityGovernor( governor ) {

	requireLabelledArtifact( governor, 'quality-governor.json' );
	requireKeys( governor, [ 'enabled', 'states', 'inputMetric', 'filter', 'hysteresis', 'minimumResidence', 'transitions', 'settledState', 'oscillationDetected' ], 'quality-governor.json' );
	requireBoolean( governor.enabled, 'quality-governor.json.enabled' );
	requireBoolean( governor.oscillationDetected, 'quality-governor.json.oscillationDetected' );
	if ( governor.oscillationDetected ) throw new Error( 'governor-oscillation: quality governor did not settle.' );
	if ( governor.states.includes( governor.settledState ) === false ) throw new Error( 'Quality governor settled outside declared states.' );
	if ( governor.enabled ) {

		requireKeys( governor, [ 'target', 'cooldown', 'windows', 'finalStableGpuP95', 'finalStableVisualError', 'visualErrorGate', 'finalStableEdgeP95VisualError', 'edgeP95VisualErrorGate', 'verdict' ], 'quality-governor.json' );
		requireVerdict( governor.verdict, 'quality-governor.json.verdict' );
		requireArray( governor.windows, 'quality-governor.json.windows', 6 );
		for ( const [ index, window ] of governor.windows.entries() ) {

			requireKeys( window, [ 'window', 'measuredTier', 'resultingTier', 'gpuSamples', 'gpuP95', 'timestampRows', 'lastFrameResolveResidual', 'visualError', 'visualErrorGate', 'edgeMaskPixels', 'edgeMeanVisualError', 'edgeP95VisualError', 'edgeP95VisualErrorGate', 'decision', 'residence', 'cooldown' ], `quality-governor.json.windows[${ index }]` );
			const gpuSamples = numericPopulation( window.gpuSamples, `quality-governor.json.windows[${ index }].gpuSamples` );
			for ( const key of [ 'window', 'gpuP95', 'visualError', 'visualErrorGate', 'edgeMaskPixels', 'edgeMeanVisualError', 'edgeP95VisualError', 'edgeP95VisualErrorGate', 'residence', 'cooldown' ] ) validateNumericDatum( window[ key ], `quality-governor.json.windows[${ index }].${ key }` );
			requireRecomputed( numericValue( window.gpuP95 ), percentile( gpuSamples, 0.95 ), `quality-governor.json.windows[${ index }].gpuP95` );
			requireArray( window.timestampRows, `quality-governor.json.windows[${ index }].timestampRows`, gpuSamples.length );
			if ( window.timestampRows.length !== gpuSamples.length ) throw new Error( `quality-governor.json.windows[${ index }] timestamp rows do not cover its GPU samples.` );
			for ( let frame = 0; frame < gpuSamples.length; frame ++ ) {

				const row = window.timestampRows[ frame ];
				requireKeys( row, [ 'sceneMs', 'outputMs', 'totalMs' ], `quality-governor.json.windows[${ index }].timestampRows[${ frame }]` );
				for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) validateNumericDatum( row[ key ], `quality-governor.json.windows[${ index }].timestampRows[${ frame }].${ key }` );
				requireRecomputed( numericValue( row.totalMs ), numericValue( row.sceneMs ) + numericValue( row.outputMs ), `quality-governor.json.windows[${ index }].timestampRows[${ frame }].totalMs` );
				requireRecomputed( gpuSamples[ frame ], numericValue( row.totalMs ), `quality-governor.json.windows[${ index }].gpuSamples[${ frame }]` );

			}
			validateNumericDatum( window.lastFrameResolveResidual, `quality-governor.json.windows[${ index }].lastFrameResolveResidual` );
			if ( numericValue( window.lastFrameResolveResidual ) > 0.001 ) throw new Error( `quality-governor.json.windows[${ index }] timestamp resolve does not reconcile.` );
			if ( governor.verdict === 'PASS' && numericValue( window.edgeMaskPixels ) <= 0 ) throw new Error( 'fabricated-governor-edge-mask: PASS requires a nonempty measured edge mask in every window.' );

		}
		for ( const [ index, transition ] of governor.transitions.entries() ) {

			requireKeys( transition, [ 'window', 'from', 'to', 'cause', 'gpuP95', 'rebuildCpuSubmission', 'rebuildGpu', 'rebuildTimestampRow', 'lastFrameResolveResidual', 'fromResourceBytes', 'toResourceBytes' ], `quality-governor.json.transitions[${ index }]` );
			for ( const key of [ 'window', 'gpuP95', 'rebuildCpuSubmission', 'rebuildGpu', 'fromResourceBytes', 'toResourceBytes' ] ) validateNumericDatum( transition[ key ], `quality-governor.json.transitions[${ index }].${ key }` );
			const sourceWindow = governor.windows[ numericValue( transition.window ) ];
			if ( sourceWindow === undefined ) throw new Error( `quality-governor.json.transitions[${ index }] references a missing window.` );
			requireRecomputed( numericValue( transition.gpuP95 ), numericValue( sourceWindow.gpuP95 ), `quality-governor.json.transitions[${ index }].gpuP95` );
			requireKeys( transition.rebuildTimestampRow, [ 'sceneMs', 'outputMs', 'totalMs' ], `quality-governor.json.transitions[${ index }].rebuildTimestampRow` );
			for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) validateNumericDatum( transition.rebuildTimestampRow[ key ], `quality-governor.json.transitions[${ index }].rebuildTimestampRow.${ key }` );
			requireRecomputed( numericValue( transition.rebuildTimestampRow.totalMs ), numericValue( transition.rebuildTimestampRow.sceneMs ) + numericValue( transition.rebuildTimestampRow.outputMs ), `quality-governor.json.transitions[${ index }].rebuildTimestampRow.totalMs` );
			requireRecomputed( numericValue( transition.rebuildGpu ), numericValue( transition.rebuildTimestampRow.totalMs ), `quality-governor.json.transitions[${ index }].rebuildGpu` );
			validateNumericDatum( transition.lastFrameResolveResidual, `quality-governor.json.transitions[${ index }].lastFrameResolveResidual` );
			if ( numericValue( transition.lastFrameResolveResidual ) > 0.001 ) throw new Error( `quality-governor.json.transitions[${ index }] timestamp resolve does not reconcile.` );

		}
		for ( const key of [ 'target', 'cooldown', 'finalStableGpuP95', 'finalStableVisualError', 'visualErrorGate', 'finalStableEdgeP95VisualError', 'edgeP95VisualErrorGate' ] ) validateNumericDatum( governor[ key ], `quality-governor.json.${ key }` );
		requireRecomputed( numericValue( governor.finalStableGpuP95 ), numericValue( governor.windows.at( - 1 ).gpuP95 ), 'quality-governor.json.finalStableGpuP95' );
		if ( governor.verdict === 'PASS' && numericValue( governor.finalStableGpuP95 ) > numericValue( governor.target ) ) throw new Error( 'governor-performance-overrun: settled tier exceeds its GPU p95 target.' );
		if ( governor.verdict === 'PASS' && numericValue( governor.finalStableVisualError ) > numericValue( governor.visualErrorGate ) ) throw new Error( 'governor-visual-overrun: settled tier exceeds its visual-error gate.' );
		if ( governor.verdict === 'PASS' && numericValue( governor.finalStableEdgeP95VisualError ) > numericValue( governor.edgeP95VisualErrorGate ) ) throw new Error( 'governor-edge-visual-overrun: settled tier exceeds its edge-domain visual-error gate.' );

	}

}

function readTaggedInteger( datum, label ) {

	const value = numericValue( datum, label );
	if ( Number.isInteger( value ) === false ) throw new Error( `${ label } must be an integer.` );
	return value;

}

export function validateTimestampBatchPolicy( sampleFrames, timestampResolveCount, mappingCadence ) {

	if ( Number.isInteger( sampleFrames ) === false || sampleFrames <= 0 || Number.isInteger( timestampResolveCount ) === false || timestampResolveCount <= 0 ) throw new Error( 'Timestamp batch policy requires positive integer frame and resolve counts.' );
	if ( mappingCadence !== 'once-per-batch' || timestampResolveCount >= sampleFrames ) throw new Error( 'per-frame-timestamp-mapping: sustained GPU timestamps must resolve in a smaller number of batches than frames.' );
	return true;

}

function validateRenderTargets( targets ) {

	requireLabelledArtifact( targets, 'render-targets.json' );
	requireKeys( targets, [ 'targets', 'accountingScope', 'completeness', 'trackedRenderTargetBytes', 'trackedPeakLiveRenderTargetBytes' ], 'render-targets.json' );
	requireString( targets.accountingScope, 'render-targets.json.accountingScope' );
	requireString( targets.completeness, 'render-targets.json.completeness' );
	validateNumericDatum( targets.trackedRenderTargetBytes, 'render-targets.json.trackedRenderTargetBytes' );
	validateNumericDatum( targets.trackedPeakLiveRenderTargetBytes, 'render-targets.json.trackedPeakLiveRenderTargetBytes' );
	requireArray( targets.targets, 'render-targets.json.targets', 1 );
	let trackedBytes = 0;
	for ( const [ index, target ] of targets.targets.entries() ) {

		const label = `render-targets.json.targets[${ index }]`;
		requireKeys( target, [ 'name', 'owner', 'semantic', 'width', 'height', 'format', 'bytesPerTexel', 'sampleCount', 'memoryBytes', 'lifetime', 'loadOp', 'storeOp', 'readback' ], label );
		const width = readTaggedInteger( target.width, `${ label }.width` );
		const height = readTaggedInteger( target.height, `${ label }.height` );
		const bytesPerTexel = readTaggedInteger( target.bytesPerTexel, `${ label }.bytesPerTexel` );
		trackedBytes += numericValue( target.memoryBytes, `${ label }.memoryBytes` );
		const expected = getAlignedReadbackLayout( width, height, bytesPerTexel );
		requireKeys( target.readback, [ 'rowBytes', 'bytesPerRow', 'minimumByteLength', 'fullyPaddedByteLength', 'alignment' ], `${ label }.readback` );
		for ( const key of [ 'rowBytes', 'bytesPerRow', 'minimumByteLength', 'fullyPaddedByteLength', 'alignment' ] ) {

			const actual = readTaggedInteger( target.readback[ key ], `${ label }.readback.${ key }` );
			if ( actual !== expected[ key ] ) throw new Error( `bad-padded-stride: ${ label }.readback.${ key } does not match WebGPU alignment.` );

		}

	}
	if ( trackedBytes !== numericValue( targets.trackedRenderTargetBytes ) ) throw new Error( 'Tracked render-target bytes do not reconcile with the target inventory.' );

}

function validateResourceArtifact( artifact, label, requiredKeys ) {

	requireLabelledArtifact( artifact, label );
	requireKeys( artifact, requiredKeys, label );

}

function validateResidentResources( residentResources ) {

	validateResourceArtifact( residentResources, 'resident-resources.json', [
		'textures', 'geometry', 'buffers', 'histories', 'staging', 'readback', 'pipelineEstimate',
		'accountingScope', 'completeness', 'inventoryCompleteness', 'labOwnedNonTargetResources',
		'opaqueRendererInternalResidency', 'trackedRenderTargetBytes', 'trackedPeakLiveRenderTargetBytes',
		'uploadChurnPerFrame'
	] );
	for ( const key of [ 'accountingScope', 'completeness', 'inventoryCompleteness' ] ) requireString( residentResources[ key ], `resident-resources.json.${ key }` );
	validateNumericDatum( residentResources.trackedRenderTargetBytes, 'resident-resources.json.trackedRenderTargetBytes' );
	validateNumericDatum( residentResources.trackedPeakLiveRenderTargetBytes, 'resident-resources.json.trackedPeakLiveRenderTargetBytes' );
	requireKeys( residentResources.opaqueRendererInternalResidency, [ 'status', 'reason' ], 'resident-resources.json.opaqueRendererInternalResidency' );
	if ( residentResources.opaqueRendererInternalResidency.status !== 'NOT_CLAIMED' ) throw new Error( 'Opaque renderer-internal residency must remain NOT_CLAIMED.' );
	requireKeys( residentResources.uploadChurnPerFrame, [ 'status', 'value', 'reason' ], 'resident-resources.json.uploadChurnPerFrame' );
	if ( residentResources.uploadChurnPerFrame.status !== 'NOT_CLAIMED' || residentResources.uploadChurnPerFrame.value !== null ) throw new Error( 'fabricated-upload-churn: unavailable upload bytes must remain NOT_CLAIMED with a null value.' );
	requireString( residentResources.uploadChurnPerFrame.reason, 'resident-resources.json.uploadChurnPerFrame.reason' );

}

function validateVisualErrors( visualErrors ) {

	requireLabelledArtifact( visualErrors, 'visual-errors.json' );
	requireKeys( visualErrors, [ 'metrics', 'spatialErrorMaps', 'worstCaseArtifacts' ], 'visual-errors.json' );
	requireArray( visualErrors.metrics, 'visual-errors.json.metrics', 1 );
	for ( const [ index, metric ] of visualErrors.metrics.entries() ) {

		const label = `visual-errors.json.metrics[${ index }]`;
		requireKeys( metric, [ 'id', 'domain', 'truthSource', 'alignment', 'mask', 'measured', 'gate', 'verdict', 'worstCaseArtifact' ], label );
		validateNumericDatum( metric.measured, `${ label }.measured` );
		validateNumericDatum( metric.gate, `${ label }.gate` );
		requireVerdict( metric.verdict, `${ label }.verdict` );
		if ( numericValue( metric.measured, `${ label }.measured` ) > numericValue( metric.gate, `${ label }.gate` ) || metric.verdict === 'FAIL' ) {

			throw new Error( `visual-error-overrun: metric ${ metric.id } exceeded its frozen gate.` );

		}

	}

}

function validateLeakLoop( leakLoop, manifest ) {

	requireLabelledArtifact( leakLoop, 'leak-loop.json' );
	requireKeys( leakLoop, [ 'operations', 'cycles', 'before', 'after', 'trend', 'gates', 'allowedCachePlateaus', 'deviceErrors', 'verdict' ], 'leak-loop.json' );
	validateNumericDatum( leakLoop.cycles, 'leak-loop.json.cycles' );
	requireVerdict( leakLoop.verdict, 'leak-loop.json.verdict' );

	if ( manifest.bundleKind === 'browser-capture' ) {

		const cycles = numericValue( leakLoop.cycles, 'leak-loop.json.cycles' );
		if ( cycles < 50 || cycles > 100 ) throw new Error( 'Lifecycle evidence must cover 50-100 cycles.' );
		if ( leakLoop.verdict !== 'PASS' ) throw new Error( 'Lifecycle stability PASS requires leak-loop verdict PASS.' );
		requireArray( leakLoop.cycleSnapshots, 'leak-loop.json.cycleSnapshots', cycles );
		if ( leakLoop.cycleSnapshots.length !== cycles ) throw new Error( 'Lifecycle cycleSnapshot count does not match cycles.' );
		for ( const [ index, snapshot ] of leakLoop.cycleSnapshots.entries() ) {

			requireKeys( snapshot, [
				'rowType', 'cycle', 'beforeRendererBytes', 'afterRendererBytes', 'targetBytes', 'storageBytes',
				'retainedTargetBytes', 'retainedStorageBytes', 'retainedListenerCount', 'retainedControlCount',
				'retainedMaterialCount', 'postDisposeErrorCount', 'rendererStateDisposition',
				'rendererStateBeforeDigest', 'rendererStateAfterDigest', 'deviceLossObserved',
				'settleAnimationFrames', 'disposeStatus'
			], `leak-loop.json.cycleSnapshots[${ index }]` );
			if ( snapshot.rowType !== 'settled-lifecycle-cycle-v2' || snapshot.disposeStatus !== 'PASS' ) throw new Error( `Lifecycle cycle ${ index } is not a successful typed settled row.` );
			for ( const key of [
				'cycle', 'beforeRendererBytes', 'afterRendererBytes', 'targetBytes', 'storageBytes',
				'retainedTargetBytes', 'retainedStorageBytes', 'retainedListenerCount', 'retainedControlCount',
				'retainedMaterialCount', 'postDisposeErrorCount', 'settleAnimationFrames'
			] ) validateNumericDatum( snapshot[ key ], `leak-loop.json.cycleSnapshots[${ index }].${ key }` );
			requireString( snapshot.rendererStateDisposition, `leak-loop.json.cycleSnapshots[${ index }].rendererStateDisposition` );
			for ( const key of [ 'rendererStateBeforeDigest', 'rendererStateAfterDigest' ] ) {

				requireString( snapshot[ key ], `leak-loop.json.cycleSnapshots[${ index }].${ key }` );
				if ( /^sha256:[0-9a-f]{64}$/.test( snapshot[ key ] ) === false ) throw new Error( `Lifecycle cycle ${ index } has an invalid ${ key }.` );

			}
			requireBoolean( snapshot.deviceLossObserved, `leak-loop.json.cycleSnapshots[${ index }].deviceLossObserved` );
			if (
				numericValue( snapshot.cycle ) !== index ||
				numericValue( snapshot.afterRendererBytes ) !== 0 ||
				[ 'retainedTargetBytes', 'retainedStorageBytes', 'retainedListenerCount', 'retainedControlCount', 'retainedMaterialCount', 'postDisposeErrorCount' ]
					.some( ( key ) => numericValue( snapshot[ key ] ) !== 0 ) ||
				![ 'RESTORED', 'OWNED_RENDERER_DISPOSED' ].includes( snapshot.rendererStateDisposition ) ||
				( snapshot.rendererStateDisposition === 'RESTORED' && snapshot.rendererStateBeforeDigest !== snapshot.rendererStateAfterDigest ) ||
				snapshot.deviceLossObserved !== false ||
				numericValue( snapshot.settleAnimationFrames ) < 2
			) throw new Error( `Lifecycle cycle ${ index } retained runtime state, lost its device, or skipped post-dispose settling.` );

		}

	}

	for ( const resource of [ 'targetBytes', 'storageBytes' ] ) {

		const before = numericValue( leakLoop.before[ resource ], `leak-loop.json.before.${ resource }` );
		const after = numericValue( leakLoop.after[ resource ], `leak-loop.json.after.${ resource }` );
		const allowedGrowth = numericValue( leakLoop.gates[ resource ], `leak-loop.json.gates.${ resource }` );
		if ( after - before > allowedGrowth ) {

			const prefix = resource === 'targetBytes' ? 'target-leak' : 'storage-leak';
			throw new Error( `${ prefix }: ${ resource } grew beyond its frozen gate.` );

		}

	}

	if ( leakLoop.deviceErrors.length > 0 ) throw new Error( 'Lifecycle evidence contains device errors.' );
	if ( manifest.claimVerdicts.lifecycleStability === 'PASS' && leakLoop.verdict !== 'PASS' ) throw new Error( 'Lifecycle manifest claim does not reconcile with leak-loop verdict.' );

}

function validateMechanismMetrics( mechanism, graph, manifest ) {

	requireLabelledArtifact( mechanism, 'mechanism-metrics.json' );
	requireKeys( mechanism, [
		'subjectAdapter', 'proofKind', 'captureProfile', 'pipelineGraphDigest',
		'runtimeReachability', 'routeExecutions', 'negativeControls',
		'diagnosticComparisons', 'metrics', 'verdicts', 'verdict'
	], 'mechanism-metrics.json' );
	requireString( mechanism.subjectAdapter, 'mechanism-metrics.json.subjectAdapter' );
	requireString( mechanism.proofKind, 'mechanism-metrics.json.proofKind' );
	if ( mechanism.captureProfile !== manifest.captureProfile ) throw new Error( 'Mechanism capture profile disagrees with manifest.' );
	if ( mechanism.pipelineGraphDigest !== graph.graphDigest ) throw new Error( 'stale-mechanism-graph: mechanism proof does not bind the current pipeline graph.' );
	requireVerdict( mechanism.verdict, 'mechanism-metrics.json.verdict' );
	if ( mechanism.verdict !== manifest.claimVerdicts.mechanismCorrectness ) throw new Error( 'Mechanism verdict disagrees with the manifest claim verdict.' );
	requireKeys( mechanism.verdicts, CLAIM_CLASSES, 'mechanism-metrics.json.verdicts' );
	for ( const claim of CLAIM_CLASSES ) if ( mechanism.verdicts[ claim ] !== manifest.claimVerdicts[ claim ] ) throw new Error( `Mechanism verdict ledger disagrees on ${ claim }.` );
	requireKeys( mechanism.runtimeReachability, [ 'signals', 'resources', 'routes' ], 'mechanism-metrics.json.runtimeReachability' );
	for ( const key of [ 'signals', 'resources', 'routes' ] ) requireArray( mechanism.runtimeReachability[ key ], `mechanism-metrics.json.runtimeReachability.${ key }` );
	requireArray( mechanism.routeExecutions, 'mechanism-metrics.json.routeExecutions' );
	requireArray( mechanism.diagnosticComparisons, 'mechanism-metrics.json.diagnosticComparisons' );
	requireArray( mechanism.metrics, 'mechanism-metrics.json.metrics' );

	if ( manifest.claimVerdicts.mechanismCorrectness !== 'PASS' ) return;
	if ( BROWSER_CAPTURE_KINDS.has( manifest.bundleKind ) === false || mechanism.proofKind !== 'native-browser-runtime' || /fixture/i.test( mechanism.subjectAdapter ) ) throw new Error( 'Synthetic fixture cannot support mechanism acceptance.' );
	for ( const signal of [ 'output', 'normal', 'emissive', 'depth' ] ) if ( mechanism.runtimeReachability.signals.includes( signal ) === false ) throw new Error( `mechanism-unreachable: ${ signal } signal is absent.` );
	for ( const resource of [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] ) if ( mechanism.runtimeReachability.resources.includes( resource ) === false ) throw new Error( `mechanism-unreachable: ${ resource } resource is absent.` );
	if ( mechanism.routeExecutions.length !== MECHANISM_MODES.length ) throw new Error( 'Mechanism PASS requires exactly four runtime route executions.' );
	const executionModes = new Set();
	for ( const execution of mechanism.routeExecutions ) {

		requireKeys( execution, [
			'mode', 'outputNodeId', 'selectedOutputNodeId', 'selectedOutputNodeIdentityVerified',
			'graphMarkedDirtyBeforeRender', 'renderSubmissionCountBefore',
			'renderSubmissionCountAfter', 'renderSubmissionDelta'
		], 'mechanism-metrics.json.routeExecutions[]' );
		if ( MECHANISM_MODES.includes( execution.mode ) === false || executionModes.has( execution.mode ) ) throw new Error( 'Mechanism route execution IDs are missing or duplicated.' );
		executionModes.add( execution.mode );
		const route = graph.captureRoutes[ execution.mode ];
		if ( execution.outputNodeId !== route.outputNodeId || execution.selectedOutputNodeId !== route.outputNodeId ) throw new Error( `mechanism-unreachable: ${ execution.mode } did not select the graph-owned output node.` );
		if ( execution.selectedOutputNodeIdentityVerified !== true || execution.graphMarkedDirtyBeforeRender !== true ) throw new Error( `mechanism-unreachable: ${ execution.mode } lacks live node selection or graph invalidation.` );
		const before = readTaggedInteger( execution.renderSubmissionCountBefore, `${ execution.mode }.renderSubmissionCountBefore` );
		const after = readTaggedInteger( execution.renderSubmissionCountAfter, `${ execution.mode }.renderSubmissionCountAfter` );
		const delta = readTaggedInteger( execution.renderSubmissionDelta, `${ execution.mode }.renderSubmissionDelta` );
		if ( delta !== 1 || after - before !== 1 ) throw new Error( `mechanism-unreachable: ${ execution.mode } did not perform exactly one runtime render.` );

	}
	for ( const mode of MECHANISM_MODES ) if ( executionModes.has( mode ) === false || mechanism.runtimeReachability.routes.includes( mode ) === false ) throw new Error( `mechanism-unreachable: ${ mode } route is absent.` );
	requireKeys( mechanism.negativeControls, [ 'unknownModeRejected', 'unknownModeError', 'modeStatePreserved', 'outputNodeIdentityPreserved' ], 'mechanism-metrics.json.negativeControls' );
	for ( const key of [ 'unknownModeRejected', 'modeStatePreserved', 'outputNodeIdentityPreserved' ] ) if ( mechanism.negativeControls[ key ] !== true ) throw new Error( `Mechanism negative control ${ key } failed.` );
	requireString( mechanism.negativeControls.unknownModeError, 'mechanism-metrics.json.negativeControls.unknownModeError' );
	if ( /Unknown mode/.test( mechanism.negativeControls.unknownModeError ) === false ) throw new Error( 'Mechanism unknown-mode rejection reason is missing.' );
	if ( mechanism.diagnosticComparisons.length !== 2 ) throw new Error( 'Mechanism PASS requires normal and emissive diagnostic comparisons.' );
	for ( const route of [ 'normal', 'emissive' ] ) {

		const comparison = mechanism.diagnosticComparisons.find( ( entry ) => entry.route === route );
		requireKeys( comparison, [ 'route', 'baseline', 'candidate', 'meanRgbByteDifference', 'minimumDifferenceGate', 'verdict' ], `mechanism-metrics.json diagnostic ${ route }` );
		if ( comparison.baseline !== 'final.design.png' || comparison.candidate !== `diagnostic.${ route }.png` ) throw new Error( `mechanism-path-mismatch: ${ route } comparison is not bound to its runtime capture.` );
		if ( comparison.verdict !== 'PASS' || numericValue( comparison.meanRgbByteDifference ) <= numericValue( comparison.minimumDifferenceGate ) ) throw new Error( `false-diagnostic-route: ${ route } diagnostic does not differ materially from final.` );

	}

}

export function validatePublishableProvenance( artifacts ) {

	const contract = artifacts[ 'visual-contract.json' ];
	const manifest = artifacts[ 'evidence-manifest.json' ];
	const rendererInfo = artifacts[ 'renderer-info.json' ];
	const trace = artifacts[ 'frame-trace.json' ];
	const governor = artifacts[ 'quality-governor.json' ];
	const leakLoop = artifacts[ 'leak-loop.json' ];
	const mechanism = artifacts[ 'mechanism-metrics.json' ];
	const visualErrors = artifacts[ 'visual-errors.json' ];
	const renderTargets = artifacts[ 'render-targets.json' ];
	const residentResources = artifacts[ 'resident-resources.json' ];
	if ( manifest.bundleKind !== 'browser-capture' ) return;
	if ( contract.contractRevision !== 'webgpu-validation-runtime-v2-1' || contract.subject !== 'native WebGPU validation subject' ) throw new Error( 'Publishable evidence retains a non-runtime visual contract identity.' );
	if ( manifest.sceneId !== 'webgpu-validation-harness-browser-capture' || manifest.automationSurface !== 'codex-in-app-browser' || manifest.renderer !== 'WebGPURenderer' ) throw new Error( 'Publishable evidence retains a non-runtime manifest identity.' );
	if ( rendererInfo.renderer !== 'WebGPURenderer' || rendererInfo.backend !== 'WebGPU' || rendererInfo.initializationState !== 'await renderer.init completed; backend.isWebGPUBackend true' ) throw new Error( 'Publishable evidence lacks the initialized runtime renderer identity.' );
	rejectSyntheticStrings( { contractRevision: contract.contractRevision, subject: contract.subject, knownCompromises: manifest.knownCompromises }, 'publishable contract and limitations' );
	rejectSyntheticStrings( { renderer: rendererInfo.renderer, initializationState: rendererInfo.initializationState, adapterInfo: rendererInfo.adapterInfo }, 'publishable renderer identity' );
	rejectSyntheticStrings( { subjectAdapter: mechanism.subjectAdapter, proofKind: mechanism.proofKind }, 'publishable mechanism identity' );
	requireObject( manifest.gpuAdapter, 'evidence-manifest.json.gpuAdapter' );
	requireObject( rendererInfo.adapterInfo, 'renderer-info.json.adapterInfo' );
	requireString( manifest.gpuAdapter.identitySource, 'evidence-manifest.json.gpuAdapter.identitySource' );
	requireString( rendererInfo.adapterInfo.identitySource, 'renderer-info.json.adapterInfo.identitySource' );
	for ( const key of [ 'cpuSamples', 'presentationSamples', 'cpuP50', 'cpuP95', 'presentationP95', 'deadlineMissRatio' ] ) requireNumericProvenance( trace.sustained[ key ], [ 'Measured' ], `frame-trace.json.sustained.${ key }` );
	for ( const key of [ 'sampleFrames', 'timestampResolveCount' ] ) requireNumericProvenance( trace[ key ], [ 'Measured' ], `frame-trace.json.${ key }` );
	for ( const key of [ 'gpuSamples', 'gpuP50', 'gpuP95' ] ) requireNumericProvenance( trace[ key ], [ 'Derived' ], `frame-trace.json.${ key }` );
	requireNumericProvenance( trace.renderTimestamp, [ 'Derived', 'Measured' ], 'frame-trace.json.renderTimestamp' );
	for ( const stage of [ 'scene-mrt', 'final-output' ] ) {

		requireNumericProvenance( trace.gpuStageAttribution[ stage ].samples, [ 'Measured' ], `frame-trace.json.gpuStageAttribution.${ stage }.samples` );
		for ( const percentileName of [ 'p50', 'p95' ] ) requireNumericProvenance( trace.gpuStageAttribution[ stage ][ percentileName ], [ 'Derived' ], `frame-trace.json.gpuStageAttribution.${ stage }.${ percentileName }` );

	}
	requireNumericProvenance( trace.gpuStageAttribution.lastFrameResolveResidual, [ 'Derived' ], 'frame-trace.json.gpuStageAttribution.lastFrameResolveResidual' );
	requireNumericProvenance( trace.gpuStageAttribution.reconciliationGate, [ 'Gated' ], 'frame-trace.json.gpuStageAttribution.reconciliationGate' );
	for ( const key of [ 'target', 'hysteresis', 'minimumResidence', 'cooldown', 'visualErrorGate', 'edgeP95VisualErrorGate' ] ) requireNumericProvenance( governor[ key ], [ 'Gated' ], `quality-governor.json.${ key }` );
	for ( const [ index, window ] of governor.windows.entries() ) {

		for ( const key of [ 'window', 'visualError', 'edgeMaskPixels', 'edgeMeanVisualError', 'edgeP95VisualError', 'residence', 'cooldown' ] ) requireNumericProvenance( window[ key ], [ 'Measured' ], `quality-governor.json.windows[${ index }].${ key }` );
		for ( const key of [ 'gpuSamples', 'gpuP95' ] ) requireNumericProvenance( window[ key ], [ 'Derived' ], `quality-governor.json.windows[${ index }].${ key }` );
		for ( const key of [ 'visualErrorGate', 'edgeP95VisualErrorGate' ] ) requireNumericProvenance( window[ key ], [ 'Gated' ], `quality-governor.json.windows[${ index }].${ key }` );

	}
	requireNumericProvenance( leakLoop.cycles, [ 'Measured' ], 'leak-loop.json.cycles' );
	for ( const [ index, snapshot ] of leakLoop.cycleSnapshots.entries() ) for ( const key of [
		'cycle', 'beforeRendererBytes', 'afterRendererBytes', 'targetBytes', 'storageBytes',
		'retainedTargetBytes', 'retainedStorageBytes', 'retainedListenerCount', 'retainedControlCount',
		'retainedMaterialCount', 'postDisposeErrorCount', 'settleAnimationFrames'
	] ) requireNumericProvenance( snapshot[ key ], [ 'Measured' ], `leak-loop.json.cycleSnapshots[${ index }].${ key }` );
	for ( const execution of mechanism.routeExecutions ) for ( const key of [ 'renderSubmissionCountBefore', 'renderSubmissionCountAfter', 'renderSubmissionDelta' ] ) requireNumericProvenance( execution[ key ], [ 'Measured' ], `mechanism-metrics.json.${ execution.mode }.${ key }` );
	for ( const comparison of mechanism.diagnosticComparisons ) {

		requireNumericProvenance( comparison.meanRgbByteDifference, [ 'Measured' ], `mechanism-metrics.json.${ comparison.route }.meanRgbByteDifference` );
		requireNumericProvenance( comparison.minimumDifferenceGate, [ 'Gated' ], `mechanism-metrics.json.${ comparison.route }.minimumDifferenceGate` );

	}
	for ( const metric of visualErrors.metrics ) {

		requireNumericProvenance( metric.measured, [ 'Measured', 'Derived' ], `visual-errors.json.${ metric.id }.measured` );
		requireNumericProvenance( metric.gate, [ 'Gated' ], `visual-errors.json.${ metric.id }.gate` );

	}
	if ( renderTargets.accountingScope !== 'lab-owned-render-targets-only' || renderTargets.completeness !== 'PARTIAL' ) throw new Error( 'Render-target totals must remain explicitly partial and lab-owned.' );
	if ( residentResources.accountingScope !== 'lab-owned-render-targets-only' || residentResources.completeness !== 'PARTIAL' || residentResources.opaqueRendererInternalResidency.status !== 'NOT_CLAIMED' ) throw new Error( 'Resident-resource accounting overclaims renderer-internal completeness.' );
	if ( visualErrors.metrics.some( ( metric ) => metric.verdict !== 'PASS' ) || mechanism.verdict !== 'PASS' || leakLoop.verdict !== 'PASS' || governor.verdict !== 'PASS' || trace.gpuStageAttribution.verdict !== 'PASS' ) throw new Error( 'Publishable claim verdicts do not reconcile with their normative evidence classifiers.' );

}

async function validatePromotionRecord( artifactDir, contract, manifest, rendererInfo, captureFinalization ) {

	const promotion = manifest.promotion;
	requireKeys( promotion, [ 'status', 'bindingDigest', 'binding', 'visualSignoff' ], 'evidence-manifest.json.promotion' );
	if ( manifest.bundleKind === 'contract-fixture' ) {

		if ( promotion.status !== 'NOT_APPLICABLE' || promotion.binding !== null || promotion.visualSignoff !== null ) throw new Error( 'Contract fixture promotion state must remain NOT_APPLICABLE.' );
		return;

	}
	if ( manifest.bundleKind === 'browser-capture-incomplete' && promotion.status === 'NOT_APPLICABLE' ) return;
	if ( manifest.bundleKind === 'browser-capture-incomplete' && promotion.status === 'CAPTURE_SESSION_PENDING' ) {

		if ( promotion.binding !== null || promotion.bindingDigest !== null || promotion.visualSignoff !== null ) throw new Error( 'Capture-time evidence cannot contain an offline promotion binding or signoff.' );
		requireKeys( promotion.candidateClaimVerdicts, CLAIM_CLASSES, 'evidence-manifest.json.promotion.candidateClaimVerdicts' );
		return;

	}
	if ( promotion.status !== 'PENDING_VISUAL_SIGNOFF' && promotion.status !== 'APPROVED' ) throw new Error( 'Browser capture promotion status is invalid.' );
	requireObject( promotion.binding, 'evidence-manifest.json.promotion.binding' );
	requireString( promotion.bindingDigest, 'evidence-manifest.json.promotion.bindingDigest' );
	if ( canonicalDigest( promotion.binding ) !== promotion.bindingDigest ) throw new Error( 'visual-signoff-digest-mismatch: promotion binding digest is stale.' );
	for ( const [ key, expected ] of [
		[ 'labId', 'webgpu-validation-harness' ],
		[ 'sourceClosureHash', manifest.sourceClosureHash ],
		[ 'buildRevision', manifest.buildRevision ],
		[ 'pipelineGraphDigest', manifest.pipelineGraphDigest ],
		[ 'captureProfile', manifest.captureProfile ],
		[ 'adapterClass', manifest.adapterClass ]
	] ) if ( promotion.binding[ key ] !== expected ) throw new Error( `visual-signoff-digest-mismatch: promotion binding ${ key } disagrees with the bundle.` );
	requireKeys( promotion.binding.deviceState, [ 'deviceLostObserved', 'uncapturedErrors', 'deviceErrors' ], 'evidence-manifest.json.promotion.binding.deviceState' );
	if (
		promotion.binding.deviceState.deviceLostObserved !== manifest.backend.deviceLostObserved ||
		JSON.stringify( promotion.binding.deviceState.uncapturedErrors ) !== JSON.stringify( manifest.backend.uncapturedErrors ) ||
		JSON.stringify( promotion.binding.deviceState.deviceErrors ) !== JSON.stringify( rendererInfo.deviceErrors )
	) throw new Error( 'forged-clean-device-state: promotion binding does not match live renderer device evidence.' );
	requireObject( promotion.binding.images, 'evidence-manifest.json.promotion.binding.images' );
	const expectedImages = contract.requiredImages;
	if ( JSON.stringify( Object.keys( promotion.binding.images ) ) !== JSON.stringify( expectedImages ) ) throw new Error( 'Visual signoff binding does not enumerate the contract image set.' );
	for ( const image of expectedImages ) {

		const path = await resolveConfinedPath( artifactDir, image, { label: `visual signoff image ${ image }` } );
		if ( promotion.binding.images[ image ] !== sha256Digest( await readFile( path ) ) ) throw new Error( `visual-signoff-digest-mismatch: ${ image } hash changed after review binding.` );

	}
	if ( manifest.bundleKind === 'browser-capture' ) {

		if ( captureFinalization === null ) throw new Error( 'Publishable promotion has no finalized shared capture-session.' );
		requireKeys( promotion.binding.captureFinalization, [ 'captureSessionSha256', 'artifactLedgerSha256' ], 'promotion.binding.captureFinalization' );
		if (
			promotion.binding.captureFinalization.captureSessionSha256 !== captureFinalization.captureSessionSha256 ||
			promotion.binding.captureFinalization.artifactLedgerSha256 !== captureFinalization.artifactLedger.digest
		) throw new Error( 'Promotion binding does not match the finalized capture-session and artifact ledger.' );
		if ( promotion.status !== 'APPROVED' || promotion.visualSignoff === null ) throw new Error( 'missing-visual-signoff: publishable browser capture requires an approved authored signoff.' );
		const signoff = promotion.visualSignoff;
		if ( signoff.provenance !== 'Authored' || signoff.decision !== 'APPROVED' || signoff.bindingDigest !== promotion.bindingDigest ) throw new Error( 'missing-visual-signoff: signoff is not an Authored APPROVED decision bound to this bundle.' );
		for ( const key of [ 'reviewer', 'reviewedAt', 'reviewMethod' ] ) requireString( signoff[ key ], `evidence-manifest.json.promotion.visualSignoff.${ key }` );
		if ( JSON.stringify( signoff.reviewedImages ) !== JSON.stringify( expectedImages ) ) throw new Error( 'missing-visual-signoff: signoff did not review every bound image.' );
		if ( promotion.binding.deviceState.deviceLostObserved || promotion.binding.deviceState.uncapturedErrors.length > 0 || promotion.binding.deviceState.deviceErrors.length > 0 ) throw new Error( 'forged-clean-device-state: device errors block bundle promotion.' );

	} else if ( promotion.status !== 'PENDING_VISUAL_SIGNOFF' || promotion.visualSignoff !== null ) {

		throw new Error( 'Incomplete browser capture must remain pending without a visual signoff.' );

	}

}

async function evaluateImages( artifactDir, contract ) {

	const nonblankImages = {};
	for ( const imagePath of contract.requiredImages ) {

		const confined = await resolveConfinedPath( artifactDir, imagePath, { label: `required image ${ imagePath }` } );
		nonblankImages[ imagePath ] = assertNonBlankGeneratedPng( await readFile( confined ), imagePath );

	}

	const comparisons = [];
	for ( const comparison of contract.imageComparisons ) {

		const paths = await assertDistinctBundleFiles( artifactDir, comparison.baseline, comparison.candidate, `image comparison ${ comparison.id }` );
		const diff = compareGeneratedRgbaPngs( await readFile( paths.baseline ), await readFile( paths.candidate ) );
		const gate = numericValue( comparison.maxDifferingRatio, `image comparison ${ comparison.id }.maxDifferingRatio` );
		if ( diff.ratio > gate ) throw new Error( `Image comparison ${ comparison.id } exceeded its frozen gate.` );
		comparisons.push( { id: comparison.id, ratio: diff.ratio, gate, verdict: 'PASS' } );

	}

	const finalPath = await resolveConfinedPath( artifactDir, 'final.design.png', { label: 'final image' } );
	const diagnosticsPath = await resolveConfinedPath( artifactDir, 'diagnostics.mosaic.png', { label: 'diagnostics image' } );
	const diagnosticDiff = compareGeneratedRgbaPngs( await readFile( finalPath ), await readFile( diagnosticsPath ) );
	if ( diagnosticDiff.ratio < 0.01 ) throw new Error( 'false-diagnostic-route: diagnostics mosaic does not materially differ from final output.' );

	return { nonblankImages, comparisons, diagnosticDifferingRatio: diagnosticDiff.ratio };

}

export async function readV2BundleArtifacts( artifactDir ) {

	const artifacts = {};
	for ( const file of REQUIRED_V2_ARTIFACTS ) {

		const path = await resolveConfinedPath( artifactDir, file, { label: file } );
		artifacts[ file ] = JSON.parse( await readFile( path, 'utf8' ) );

	}

	return artifacts;

}

export async function validateV2ArtifactBundle( artifactDir ) {

	const artifacts = await readV2BundleArtifacts( artifactDir );
	const contract = artifacts[ 'visual-contract.json' ];
	const manifest = artifacts[ 'evidence-manifest.json' ];
	const rendererInfo = artifacts[ 'renderer-info.json' ];
	const graph = artifacts[ 'pipeline-graph.json' ];
	const envelope = artifacts[ 'performance-envelope.json' ];
	const trace = artifacts[ 'frame-trace.json' ];
	const governor = artifacts[ 'quality-governor.json' ];
	const renderTargets = artifacts[ 'render-targets.json' ];
	const storageResources = artifacts[ 'storage-resources.json' ];
	const residentResources = artifacts[ 'resident-resources.json' ];
	const bandwidth = artifacts[ 'bandwidth-model.json' ];
	const visualErrors = artifacts[ 'visual-errors.json' ];
	const leakLoop = artifacts[ 'leak-loop.json' ];
	const mechanismMetrics = artifacts[ 'mechanism-metrics.json' ];
	const captureFinalization = manifest.bundleKind === 'browser-capture'
		? await validateFinalizedCaptureSession( artifactDir, manifest, contract )
		: null;

	validateVisualContract( contract );
	validateEvidenceManifest( manifest );
	validateRendererInfo( rendererInfo, manifest );
	validatePipelineGraph( graph, manifest );
	validatePerformance( envelope, trace, manifest, contract );
	validateQualityGovernor( governor );
	if ( manifest.claimVerdicts.performanceCompliance === 'PASS' && ( governor.enabled !== true || governor.verdict !== 'PASS' ) ) throw new Error( 'Performance compliance PASS requires an enabled quality governor with verdict PASS.' );
	validateRenderTargets( renderTargets );
	validateResourceArtifact( storageResources, 'storage-resources.json', [ 'resources', 'totalResidentBytes', 'dispatchOwnership', 'synchronization', 'resetPolicy' ] );
	validateResidentResources( residentResources );
	validateResourceArtifact( bandwidth, 'bandwidth-model.json', [ 'passes', 'lowerBoundBytesPerFrame', 'upperBoundBytesPerFrame', 'bytesPerSecond', 'assumptions', 'hardwareCountersAvailable', 'verdict' ] );
	validateVisualErrors( visualErrors );
	validateLeakLoop( leakLoop, manifest );
	validateMechanismMetrics( mechanismMetrics, graph, manifest );
	validatePublishableProvenance( artifacts );
	const imageEvidence = await evaluateImages( artifactDir, contract );
	await validatePromotionRecord( artifactDir, contract, manifest, rendererInfo, captureFinalization );

	return {
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		bundleKind: manifest.bundleKind,
		publishable: manifest.publishable,
		captureProfile: manifest.captureProfile,
		adapterClass: manifest.adapterClass,
		sourceClosureHash: manifest.sourceClosureHash,
		buildRevision: manifest.buildRevision,
		sceneId: manifest.sceneId,
		claimVerdicts: manifest.claimVerdicts,
		requiredArtifacts: [ ...REQUIRED_V2_ARTIFACTS ],
		requiredImages: contract.requiredImages,
		imageEvidence,
		captureFinalization: captureFinalization === null ? null : {
			captureSessionSha256: captureFinalization.captureSessionSha256,
			artifactLedgerDigest: captureFinalization.artifactLedger.digest
		}
	};

}
