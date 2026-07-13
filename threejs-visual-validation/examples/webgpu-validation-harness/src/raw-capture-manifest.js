import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas } from './checked-json-schema.js';
import { CORRECTNESS_CAPTURE_RECIPES } from './correctness-capture-recipes.js';
import {
	CORRECTNESS_SESSION_PATH,
	CORRECTNESS_WRITE_LEDGER_PATH,
	createCorrectnessWriteLedger
} from './correctness-write-ledger.js';
import { validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';
import {
	NORMATIVE_JSON_PATHS,
	STANDARD_IMAGE_PATHS,
	assertEvidenceManifestContract,
	canonicalSha256,
	routeStateDigest
} from './evidence-manifest-contract.js';
import { validateCorrectnessCaptureSession } from './physical-session-validator.js';
import { readPngDimensions } from './png-image-contract.js';

const SUPPLEMENTAL_NORMATIVE_IMAGE_PATHS = Object.freeze( [
	'diagnostic.normal.png',
	'diagnostic.emissive.png',
	'odd-size.final.png',
	'tier.target-performance.final.png',
	'tier.governor-stress.final.png'
] );
const SUPPLEMENTAL_NORMATIVE_JSON_PATHS = Object.freeze( [ 'tier-visual-evidence.json' ] );
const SESSION_SUPPLEMENTAL_JSON_PATHS = Object.freeze( [ 'capture-boundary.json' ] );
const RAW_IMAGE_PATHS = Object.freeze( [ ...STANDARD_IMAGE_PATHS, ...SUPPLEMENTAL_NORMATIVE_IMAGE_PATHS ] );
const DIRECT_RECIPE_IMAGE_PATHS = Object.freeze( CORRECTNESS_CAPTURE_RECIPES.map( ( recipe ) => recipe.capture.filename ) );
const MANIFEST_PATH = 'evidence-manifest.json';
const SESSION_PATH = CORRECTNESS_SESSION_PATH;
const WRITE_LEDGER_PATH = CORRECTNESS_WRITE_LEDGER_PATH;

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function jsonBytes( value ) {

	return Buffer.from( `${ JSON.stringify( value, null, 2 ) }\n` );

}

function jsonSafe( value ) {

	if ( value === undefined ) return null;
	return JSON.parse( JSON.stringify( value ) );

}

function parseFinalizedCorrectnessSession( suppliedSession, sessionBytes ) {

	let parsedSession;
	try {

		parsedSession = JSON.parse( sessionBytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new Error( `Finalized capture-session.json is invalid JSON: ${ error.message }` );

	}
	const canonicalBytes = jsonBytes( parsedSession );
	if ( canonicalBytes.equals( sessionBytes ) === false ) throw new Error( 'Finalized capture-session.json is not the canonical two-space JSON document emitted by the shared capture runner.' );

	const enumerableSession = jsonSafe( suppliedSession );
	if ( canonicalSha256( enumerableSession ) !== canonicalSha256( parsedSession ) ) throw new Error( 'Supplied in-memory capture session canonically drifted from finalized capture-session.json.' );
	if ( jsonBytes( enumerableSession ).equals( sessionBytes ) === false ) throw new Error( 'Supplied in-memory capture session enumerable serialization drifted from finalized capture-session.json.' );

	validateCorrectnessCaptureSession( parsedSession );
	return parsedSession;

}

function requireSha256( value, label ) {

	if ( /^sha256:[0-9a-f]{64}$/.test( value ?? '' ) === false ) throw new Error( `${ label } must be a sha256: digest.` );
	return value;

}

function requireChoice( choices, value, label ) {

	if ( choices.includes( value ) === false ) throw new Error( `${ label } must be one of ${ choices.join( ', ' ) }.` );
	return value;

}

function normalizeSeed( value ) {

	if ( typeof value === 'string' && /^0x[0-9a-f]{8}$/.test( value ) ) return value;
	if ( Number.isInteger( value ) && value >= 0 && value <= 0xffffffff ) return `0x${ ( value >>> 0 ).toString( 16 ).padStart( 8, '0' ) }`;
	throw new Error( 'Raw capture route requires a uint32 seed.' );

}

function captureRoute( session ) {

	const state = session.finalRuntime?.metrics ?? session.route?.finalState ?? session.route?.observedState ?? {};
	const route = {
		path: state.tier === 'webgpu-correctness'
			? '/demos/webgpu-validation-harness/tier/webgpu-correctness/'
			: '/demos/webgpu-validation-harness/',
		scenario: state.scenario ?? 'browser-capture',
		mechanism: null,
		mode: state.mode ?? 'final',
		tier: state.tier ?? 'webgpu-correctness',
		camera: state.camera ?? 'design',
		seed: normalizeSeed( state.seedHex ?? state.seed ?? 1 ),
		timeSeconds: {
			value: state.timeSeconds ?? 0,
			unit: 'seconds',
			label: 'Measured',
			source: 'final LabController correctness-capture state'
		}
	};
	route.stateDigest = routeStateDigest( route );
	return route;

}

function limitationsForRawCorrectness() {

	return [
		{
			id: 'visual-review-pending',
			status: 'ACTIVE',
			statement: 'The deterministic readbacks have not yet received the separate authored visual review required for release promotion.',
			affectedClaims: [ 'visualCorrectness' ]
		},
		{
			id: 'physical-route-not-joined',
			status: 'ACTIVE',
			statement: 'The immutable Codex in-app Browser physical-route session has not been joined to this raw correctness lane.',
			affectedClaims: [ 'visualCorrectness', 'mechanismCorrectness' ]
		},
		{
			id: 'hardware-performance-not-claimed',
			status: 'ACTIVE',
			statement: 'This Playwright correctness lane does not claim physical-browser cadence or hardware GPU performance.',
			affectedClaims: [ 'performanceCompliance', 'gpuAttribution' ]
		}
	];

}

function currentWriteIndex( session ) {

	if ( Array.isArray( session.artifactWrites ) === false ) throw new Error( 'Finalized capture session has no immutable artifact write ledger.' );
	const index = new Map();
	for ( const record of session.artifactWrites ) {

		if ( typeof record?.path !== 'string' || record.path.length === 0 || index.has( record.path ) ) throw new Error( `Capture write ledger has an invalid or duplicate path ${ record?.path ?? '<missing>' }.` );
		index.set( record.path, record );

	}
	if ( index.has( MANIFEST_PATH ) ) throw new Error( 'The browser hook must not write evidence-manifest.json; raw-session finalization owns that self-excluded file.' );
	return index;

}

async function requireCurrentWrite( outputDir, writeIndex, path ) {

	const record = writeIndex.get( path );
	if ( record?.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) throw new Error( `Current capture did not content-bind ${ path }.` );
	const bytes = await readFile( join( outputDir, path ) );
	if ( record.byteLength !== bytes.byteLength || record.sha256 !== sha256( bytes ) ) throw new Error( `Current capture binding drifted for ${ path }.` );
	return { record, bytes };

}

function assertDescriptorBinding( descriptor, record, label ) {

	if ( descriptor?.path !== record.path || descriptor.sha256 !== record.sha256 || descriptor.byteLength !== record.byteLength ) throw new Error( `${ label } does not match its immutable capture write.` );
	return descriptor.path;

}

function addUniqueReference( references, path, label ) {

	if ( references.has( path ) ) throw new Error( `${ label } aliases an already referenced capture artifact ${ path }.` );
	references.add( path );

}

async function requireFrozenRecipeCaptureClosure( session, outputDir, writeIndex ) {

	if ( Array.isArray( session.writtenCaptures ) === false || session.writtenCaptures.length !== CORRECTNESS_CAPTURE_RECIPES.length ) throw new Error( `Frozen correctness capture requires exactly ${ CORRECTNESS_CAPTURE_RECIPES.length } direct recipe readbacks.` );
	const capturesByTarget = new Map();
	for ( const capture of session.writtenCaptures ) {

		if ( typeof capture?.target !== 'string' || capturesByTarget.has( capture.target ) ) throw new Error( `Frozen correctness capture has a missing or duplicate recipe target ${ capture?.target ?? '<missing>' }.` );
		capturesByTarget.set( capture.target, capture );

	}

	const rawReadbacks = new Set();
	for ( const [ index, recipe ] of CORRECTNESS_CAPTURE_RECIPES.entries() ) {

		const capture = capturesByTarget.get( recipe.id );
		if ( capture === undefined ) throw new Error( `Frozen correctness capture omits recipe ${ recipe.id }.` );
		if ( session.writtenCaptures[ index ] !== capture ) throw new Error( `Frozen correctness capture recipe ${ recipe.id } is out of canonical order.` );
		if ( capture.png?.path !== recipe.capture.filename ) throw new Error( `Frozen correctness capture recipe ${ recipe.id } is not bound to ${ recipe.capture.filename }.` );
		const png = await requireCurrentWrite( outputDir, writeIndex, recipe.capture.filename );
		assertDescriptorBinding( capture.png, png.record, `${ recipe.id } PNG binding` );
		for ( const [ kind, descriptor ] of [
			[ 'transport', capture.transport?.artifact ],
			[ 'normalized', capture.normalized?.artifact ]
		] ) {

			if ( typeof descriptor?.path !== 'string' ) throw new Error( `${ recipe.id } ${ kind } readback path is missing.` );
			const binding = await requireCurrentWrite( outputDir, writeIndex, descriptor.path );
			assertDescriptorBinding( descriptor, binding.record, `${ recipe.id } ${ kind } readback binding` );
			addUniqueReference( rawReadbacks, descriptor.path, `${ recipe.id } ${ kind } readback` );

		}

	}

	const mosaic = session.hookResult?.standardOutputs?.find( ( output ) => output?.filename === 'diagnostics.mosaic.png' );
	if ( mosaic?.status !== 'CAPTURED' || mosaic.id !== 'diagnostics.mosaic' ) throw new Error( 'Frozen correctness capture omits the producer-declared diagnostics mosaic.' );
	const expectedSources = [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ];
	if ( JSON.stringify( mosaic.sourceCaptures ) !== JSON.stringify( expectedSources ) ) throw new Error( 'Diagnostics mosaic source capture closure drifted from the hook contract.' );
	const mosaicPng = await requireCurrentWrite( outputDir, writeIndex, 'diagnostics.mosaic.png' );
	assertDescriptorBinding( mosaic.file ?? mosaic.pixelEvidence?.png, mosaicPng.record, 'Diagnostics mosaic PNG binding' );
	for ( const [ kind, descriptor ] of [
		[ 'normalized padded', mosaic.pixelEvidence?.normalized?.rawArtifact ],
		[ 'normalized compact', mosaic.pixelEvidence?.normalized?.packedArtifact ]
	] ) {

		if ( typeof descriptor?.path !== 'string' ) throw new Error( `Diagnostics mosaic ${ kind } artifact is missing.` );
		const binding = await requireCurrentWrite( outputDir, writeIndex, descriptor.path );
		assertDescriptorBinding( descriptor, binding.record, `Diagnostics mosaic ${ kind } binding` );
		addUniqueReference( rawReadbacks, descriptor.path, `Diagnostics mosaic ${ kind } artifact` );

	}
	return rawReadbacks;

}

async function requireTierVisualEvidence( session, outputDir, writeIndex ) {

	const path = SUPPLEMENTAL_NORMATIVE_JSON_PATHS[ 0 ];
	const { record, bytes } = await requireCurrentWrite( outputDir, writeIndex, path );
	let document;
	try {

		document = JSON.parse( bytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new Error( `${ path } is invalid JSON: ${ error.message }` );

	}
	if ( jsonBytes( document ).equals( bytes ) === false ) throw new Error( `${ path } is not canonical two-space JSON.` );
	const schemas = await loadCheckedEvidenceSchemas();
	assertCheckedJsonSchema( schemas.tierVisualEvidence, document, path );
	if ( document.schemaVersion !== 1 || document.kind !== 'validation-harness-tier-visual-evidence-v1' || document.verdict !== 'PASS' ) throw new Error( `${ path } does not contain the passing producer contract.` );
	if ( canonicalSha256( document ) !== canonicalSha256( session.hookResult?.tierVisualEvidence ) ) throw new Error( `${ path } drifted from the finalized hook result.` );
	if ( document.bindingSha256 !== canonicalSha256( { binding: document.binding, metrics: document.metrics, gates: document.gates } ) ) throw new Error( `${ path } binding digest is invalid.` );
	for ( const [ side, recipeId, filename ] of [
		[ 'reference', 'tier.target-performance.final', 'tier.target-performance.final.png' ],
		[ 'candidate', 'tier.governor-stress.final', 'tier.governor-stress.final.png' ]
	] ) {

		const binding = document.binding?.[ side ];
		if ( binding?.recipeId !== recipeId || binding.filename !== filename ) throw new Error( `${ path } ${ side } identity drifted from ${ recipeId }.` );
		const image = await requireCurrentWrite( outputDir, writeIndex, filename );
		if ( binding.pngSha256 !== image.record.sha256 ) throw new Error( `${ path } ${ side } PNG hash does not bind ${ filename }.` );
		const dimensions = readPngDimensions( image.bytes, filename );
		if ( dimensions.width !== 1920 || dimensions.height !== 1080 ) throw new Error( `${ filename } dimensions ${ dimensions.width }x${ dimensions.height } do not match 1920x1080.` );
		const normalized = binding.normalized?.artifact;
		if ( typeof normalized?.path !== 'string' ) throw new Error( `${ path } ${ side } normalized artifact is missing.` );
		const normalizedWrite = await requireCurrentWrite( outputDir, writeIndex, normalized.path );
		assertDescriptorBinding( normalized, normalizedWrite.record, `${ path } ${ side } normalized binding` );

	}
	return capturedFile( path, 'supplementary-json', record );

}

function selfManifestFile() {

	return {
		path: MANIFEST_PATH,
		status: 'self-excluded',
		kind: 'evidence-manifest',
		reason: 'The evidence manifest cannot bind its own final serialized bytes.'
	};

}

function capturedFile( path, kind, binding ) {

	return {
		path,
		status: 'captured',
		kind,
		sha256: binding.sha256,
		byteLength: binding.byteLength
	};

}

function capturedImage( path, binding, hookResult ) {

	const role = path.slice( 0, - '.png'.length );
	if ( path !== 'diagnostics.mosaic.png' ) return {
		path,
		status: 'captured',
		kind: 'direct-capture',
		role,
		mediaType: 'image/png',
		sha256: binding.sha256,
		byteLength: binding.byteLength
	};
	const derived = hookResult?.standardOutputs?.find( ( output ) => output.filename === path );
	if ( derived === undefined ) throw new Error( 'Diagnostics mosaic producer record is missing.' );
	const sourceCaptures = derived.sourceCaptures;
	return {
		path,
		status: 'captured',
		kind: 'derived-image',
		role,
		mediaType: 'image/png',
		sha256: binding.sha256,
		byteLength: binding.byteLength,
		derivation: {
			method: 'deterministic four-route diagnostic contact sheet',
			implementation: 'capture-hook.mjs',
			parametersDigest: canonicalSha256( derived?.derivation ?? { sourceCaptures } )
		},
		sourceCaptures
	};

}

function rawClaimVerdicts( session ) {

	const candidate = session.hookResult?.bundle?.claimVerdicts ?? {};
	const mechanismCorrectness = requireChoice(
		[ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE' ],
		candidate.mechanismCorrectness ?? 'INSUFFICIENT_EVIDENCE',
		'mechanism correctness verdict'
	);
	const lifecycleStability = requireChoice(
		[ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE' ],
		candidate.lifecycleStability ?? 'INSUFFICIENT_EVIDENCE',
		'lifecycle stability verdict'
	);
	return {
		visualCorrectness: 'INSUFFICIENT_EVIDENCE',
		mechanismCorrectness,
		performanceCompliance: 'NOT_CLAIMED',
		gpuAttribution: 'NOT_CLAIMED',
		lifecycleStability,
		visualError: 'PASS'
	};

}

function identity( kind, value ) {

	return { kind, digest: canonicalSha256( jsonSafe( value ) ) };

}

function captureSessionReference( session, route, limitations, document, writeLedger ) {

	const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
	if ( metrics.initialized !== true || metrics.nativeWebGPU !== true || metrics.rendererBackendEvidence?.isWebGPUBackend !== true ) throw new Error( 'Raw capture finalization requires initialized native WebGPU proof from the final runtime snapshot.' );
	const profile = requireChoice( [ 'correctness', 'physical-route', 'performance' ], session.profile, 'capture profile' );
	const adapterClass = requireChoice( [ 'hardware', 'software', 'unknown' ], session.adapterClass, 'adapter class' );
	const sourceClosureHash = requireSha256( session.sourceClosureHash ?? session.sourceHash, 'capture source closure hash' );
	const buildRevision = requireSha256( session.buildRevision, 'capture build revision' );
	const timestampFeatures = metrics.adapter?.features ?? metrics.adapterIdentity?.features ?? [];
	return {
		sessionId: `${ session.labId }:${ profile }:${ sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 ) }`,
		profile,
		automationSurface: session.automationSurface,
		adapterClass,
		adapterIdentity: identity( 'gpu-adapter', session.adapterIdentity ?? metrics.adapterIdentity ?? metrics.adapter ),
		deviceIdentity: identity( 'gpu-device', {
			adapterIdentity: session.adapterIdentity ?? metrics.adapterIdentity ?? metrics.adapter,
			rendererBackendEvidence: metrics.rendererBackendEvidence,
			rendererDeviceGeneration: metrics.rendererDeviceGeneration
		} ),
		browserIdentity: identity( 'browser', session.browser ),
		osIdentity: identity( 'operating-system', { platform: session.browser?.platform ?? 'unavailable' } ),
		refreshIdentity: identity( 'display-refresh', { status: 'unmeasured-correctness-lane' } ),
		colorIdentity: identity( 'color-pipeline', metrics.rendererState ),
		limitationsDigest: canonicalSha256( limitations ),
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		startedAt: session.startedAt,
		finishedAt: session.finishedAt,
		routePath: route.path,
		routeDigest: canonicalSha256( route ),
		stateDigest: route.stateDigest,
		document,
		writeLedger,
		rendererInitialized: true,
		isWebGPUBackend: true,
		timestampQuerySupported: Array.isArray( timestampFeatures ) && timestampFeatures.includes( 'timestamp-query' )
	};

}

function promotionNotEligible() {

	return {
		status: 'NOT_ELIGIBLE',
		binding: null,
		bindingDigest: null,
		visualSignoff: {
			status: 'NOT_REVIEWED',
			reviewer: null,
			reviewedAt: null,
			reviewDigest: null,
			reviewedImages: [],
			notes: []
		}
	};

}

export async function finalizeRawCorrectnessCapture( session, outputDir ) {

	if ( typeof outputDir !== 'string' || outputDir.length === 0 ) throw new Error( 'Raw correctness finalization requires its output directory.' );
	const sessionBinding = session?.finalizedCaptureSessionFile;
	if ( sessionBinding?.path !== SESSION_PATH || sessionBinding.contentBinding !== 'finalized-file-hash-for-offline-promotion' ) throw new Error( 'Finalized shared capture-session binding is unavailable.' );
	const sessionBytes = await readFile( join( outputDir, SESSION_PATH ) );
	if ( sessionBinding.sha256 !== sha256( sessionBytes ) || sessionBinding.byteLength !== sessionBytes.byteLength ) throw new Error( 'Finalized capture-session bytes drifted before raw manifest assembly.' );
	const finalizedSessionBinding = {
		path: SESSION_PATH,
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: sha256( sessionBytes ),
		byteLength: sessionBytes.byteLength
	};
	const finalizedSession = parseFinalizedCorrectnessSession( session, sessionBytes );
	const writeIndex = currentWriteIndex( finalizedSession );
	const rawReadbackPaths = await requireFrozenRecipeCaptureClosure( finalizedSession, outputDir, writeIndex );
	const tierVisualEvidence = await requireTierVisualEvidence( finalizedSession, outputDir, writeIndex );

	const route = captureRoute( finalizedSession );
	const limitations = limitationsForRawCorrectness();
	const sourceClosureHash = requireSha256( finalizedSession.sourceClosureHash ?? finalizedSession.sourceHash, 'capture source closure hash' );
	const suffix = sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 );
	const sessionId = `${ finalizedSession.labId }:correctness:${ suffix }`;
	const writeLedger = createCorrectnessWriteLedger( finalizedSession, {
		kind: 'capture-session-document',
		path: SESSION_PATH,
		sha256: finalizedSessionBinding.sha256,
		byteLength: finalizedSessionBinding.byteLength
	} );
	if ( writeLedger.sessionId !== sessionId ) throw new Error( 'Correctness write-ledger session identity changed during raw manifest assembly.' );
	const writeLedgerBytes = writeLedger.bytes;
	await writeFile( join( outputDir, WRITE_LEDGER_PATH ), writeLedgerBytes );
	const writeLedgerBinding = {
		kind: 'capture-session-write-ledger',
		path: WRITE_LEDGER_PATH,
		sha256: sha256( writeLedgerBytes ),
		byteLength: writeLedgerBytes.byteLength
	};
	const documentBinding = {
		kind: 'capture-session-document',
		path: SESSION_PATH,
		sha256: finalizedSessionBinding.sha256,
		byteLength: finalizedSessionBinding.byteLength
	};

	const normative = [];
	for ( const path of NORMATIVE_JSON_PATHS ) {

		if ( path === MANIFEST_PATH ) {

			normative.push( selfManifestFile() );
			continue;

		}
		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		normative.push( capturedFile( path, 'normative-json', record ) );

	}
	const images = [];
	for ( const path of RAW_IMAGE_PATHS ) {

		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		images.push( capturedImage( path, record, finalizedSession.hookResult ) );

	}
	const supplemental = [ tierVisualEvidence ];
	for ( const path of SESSION_SUPPLEMENTAL_JSON_PATHS ) {

		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		supplemental.push( capturedFile( path, 'supplementary-json', record ) );

	}
	for ( const path of rawReadbackPaths ) {

		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		supplemental.push( capturedFile( path, 'raw-readback', record ) );

	}
	const consumed = new Set( [
		...NORMATIVE_JSON_PATHS,
		...RAW_IMAGE_PATHS,
		...SUPPLEMENTAL_NORMATIVE_JSON_PATHS,
		...SESSION_SUPPLEMENTAL_JSON_PATHS,
		...rawReadbackPaths,
		SESSION_PATH
	] );
	for ( const path of writeIndex.keys() ) {

		if ( consumed.has( path ) ) continue;
		throw new Error( `Current capture emitted an undeclared artifact ${ path }.` );

	}
	const captureSession = captureSessionReference(
		finalizedSession,
		route,
		limitations,
		documentBinding,
		writeLedgerBinding
	);
	if ( captureSession.sessionId !== sessionId ) throw new Error( 'Capture-session identity changed during raw manifest assembly.' );
	const manifest = {
		schemaVersion: 2,
		labId: finalizedSession.labId,
		bundleId: `${ finalizedSession.labId }:raw-correctness:${ suffix }:v2`,
		bundleKind: 'raw-capture-session',
		publishable: false,
		skill: 'threejs-visual-validation',
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision: finalizedSession.buildRevision,
		route,
		limitations,
		claimVerdicts: rawClaimVerdicts( finalizedSession ),
		captureSessions: [ captureSession ],
		files: [
			...normative,
			capturedFile( SESSION_PATH, 'capture-session-document', finalizedSessionBinding ),
			capturedFile( WRITE_LEDGER_PATH, 'capture-session-write-ledger', writeLedgerBinding ),
			...supplemental
		],
		images,
		promotion: promotionNotEligible()
	};
	const schemas = await loadCheckedEvidenceSchemas();
	assertCheckedJsonSchema( schemas.evidenceManifest, manifest, 'raw evidence-manifest.json' );
	assertEvidenceManifestContract( manifest );
	await writeFile( join( outputDir, MANIFEST_PATH ), jsonBytes( manifest ) );
	return validateUnifiedV2ArtifactBundle( outputDir );

}

export {
	DIRECT_RECIPE_IMAGE_PATHS,
	RAW_IMAGE_PATHS,
	SUPPLEMENTAL_NORMATIVE_IMAGE_PATHS,
	SUPPLEMENTAL_NORMATIVE_JSON_PATHS
};
