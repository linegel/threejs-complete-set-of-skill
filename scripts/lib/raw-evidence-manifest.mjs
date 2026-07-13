import { assertEvidenceManifestContract, canonicalSha256, routeStateDigest } from './evidence-manifest-contract.mjs';
import { loadCheckedSchemas, validateCheckedJsonSchema } from './checked-json-schema.mjs';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VERDICTS = new Set( [ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE', 'NOT_CLAIMED' ] );

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ label } must be an object.` );
	return value;

}

function requireString( value, label ) {

	if ( typeof value !== 'string' || value.length === 0 ) throw new TypeError( `${ label } must be a non-empty string.` );
	return value;

}

function requireSha256( value, label ) {

	if ( SHA256_PATTERN.test( value ?? '' ) === false ) throw new TypeError( `${ label } must be a sha256 digest.` );
	return value;

}

function requirePositiveInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value <= 0 ) throw new TypeError( `${ label } must be a positive integer.` );
	return value;

}

function jsonSafe( value ) {

	if ( value === undefined ) return null;
	return JSON.parse( JSON.stringify( value ) );

}

export function capturedEvidenceFile( path, kind, binding ) {

	requireString( path, 'evidence file path' );
	requireString( kind, `${ path } evidence kind` );
	requireRecord( binding, `${ path } binding` );
	return Object.freeze( {
		path,
		status: 'captured',
		kind,
		sha256: requireSha256( binding.sha256, `${ path } SHA-256` ),
		byteLength: requirePositiveInteger( binding.byteLength, `${ path } byteLength` )
	} );

}

export function selfExcludedManifestFile() {

	return Object.freeze( {
		path: 'evidence-manifest.json',
		status: 'self-excluded',
		kind: 'evidence-manifest',
		reason: 'The evidence manifest cannot bind its own final serialized bytes.'
	} );

}

export function capturedEvidenceImage( { path, role, binding, kind = 'direct-capture', sourceCaptures, derivation } ) {

	requireString( path, 'evidence image path' );
	requireString( role, `${ path } role` );
	requireRecord( binding, `${ path } binding` );
	const image = {
		path,
		status: 'captured',
		kind,
		role,
		mediaType: 'image/png',
		sha256: requireSha256( binding.sha256, `${ path } SHA-256` ),
		byteLength: requirePositiveInteger( binding.byteLength, `${ path } byteLength` )
	};
	if ( sourceCaptures !== undefined ) image.sourceCaptures = [ ...sourceCaptures ];
	if ( derivation !== undefined ) image.derivation = structuredClone( derivation );
	return Object.freeze( image );

}

export function notApplicableEvidenceImage( { path, role, reason, pipelineGraphDigest } ) {

	requireString( path, 'evidence image path' );
	requireString( role, `${ path } role` );
	requireString( reason, `${ path } N/A reason` );
	requireSha256( pipelineGraphDigest, `${ path } pipeline graph digest` );
	return Object.freeze( {
		path,
		status: 'not-applicable',
		kind: 'not-applicable',
		role,
		notApplicableProof: Object.freeze( {
			reason,
			pipelineGraphPath: 'pipeline-graph.json',
			pipelineGraphDigest
		} )
	} );

}

export function notEligiblePromotion() {

	return Object.freeze( {
		status: 'NOT_ELIGIBLE',
		binding: null,
		bindingDigest: null,
		visualSignoff: Object.freeze( {
			status: 'NOT_REVIEWED',
			reviewer: null,
			reviewedAt: null,
			reviewDigest: null,
			reviewedImages: Object.freeze( [] ),
			notes: Object.freeze( [] )
		} )
	} );

}

function identity( kind, value ) {

	return Object.freeze( { kind, digest: canonicalSha256( jsonSafe( value ) ) } );

}

export function createRawCaptureSessionReference( { session, route, limitations, document, writeLedger } ) {

	requireRecord( session, 'capture session' );
	requireRecord( route, 'capture route' );
	const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
	if ( metrics.initialized !== true || metrics.nativeWebGPU !== true || metrics.rendererBackendEvidence?.isWebGPUBackend !== true ) {

		throw new Error( 'Raw evidence requires initialized native WebGPU proof from the final runtime snapshot.' );

	}
	const profile = session.profile;
	if ( ! [ 'correctness', 'physical-route', 'performance' ].includes( profile ) ) throw new Error( `Unsupported capture profile ${ profile }.` );
	const adapterClass = session.adapterClass;
	if ( ! [ 'hardware', 'software', 'unknown' ].includes( adapterClass ) ) throw new Error( `Unsupported adapter class ${ adapterClass }.` );
	const sourceClosureHash = requireSha256( session.sourceClosureHash ?? session.sourceHash, 'capture source closure hash' );
	const buildRevision = requireSha256( session.buildRevision, 'capture build revision' );
	const suffix = sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 );
	const adapterIdentity = session.adapterIdentity ?? metrics.adapterIdentity ?? metrics.adapter ?? { status: 'unavailable' };
	const timestampFeatures = metrics.adapter?.features ?? metrics.adapterIdentity?.features ?? [];
	return Object.freeze( {
		sessionId: `${ session.labId }:${ profile }:${ suffix }`,
		profile,
		automationSurface: session.automationSurface,
		adapterClass,
		adapterIdentity: identity( 'gpu-adapter', adapterIdentity ),
		deviceIdentity: identity( 'gpu-device', {
			adapterIdentity,
			rendererBackendEvidence: metrics.rendererBackendEvidence,
			rendererDeviceGeneration: metrics.rendererDeviceGeneration
		} ),
		browserIdentity: identity( 'browser', session.browser ),
		osIdentity: identity( 'operating-system', { platform: session.browser?.platform ?? 'unavailable' } ),
		refreshIdentity: identity( 'display-refresh', profile === 'correctness' ? { status: 'unmeasured-correctness-lane' } : session.refreshIdentity ),
		colorIdentity: identity( 'color-pipeline', metrics.rendererState ?? {
			outputColorSpace: metrics.outputColorSpace ?? 'unavailable',
			toneMapOwner: session.finalRuntime?.pipeline?.finalToneMapOwner ?? null,
			outputTransformOwner: session.finalRuntime?.pipeline?.finalOutputTransformOwner ?? null
		} ),
		limitationsDigest: canonicalSha256( limitations ),
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		startedAt: session.startedAt,
		finishedAt: session.finishedAt,
		routePath: route.path,
		routeDigest: canonicalSha256( route ),
		stateDigest: route.stateDigest,
		document: structuredClone( document ),
		writeLedger: structuredClone( writeLedger ),
		rendererInitialized: true,
		isWebGPUBackend: true,
		timestampQuerySupported: metrics.timestampQueriesActive === true
			|| ( Array.isArray( timestampFeatures ) && timestampFeatures.includes( 'timestamp-query' ) )
	} );

}

function validateClaims( claims ) {

	for ( const claim of [ 'visualCorrectness', 'mechanismCorrectness', 'performanceCompliance', 'gpuAttribution', 'lifecycleStability' ] ) {

		if ( VERDICTS.has( claims?.[ claim ] ) === false ) throw new Error( `Raw evidence claim ${ claim } is missing or invalid.` );

	}
	if ( claims.visualError !== undefined && VERDICTS.has( claims.visualError ) === false ) throw new Error( 'Raw evidence claim visualError is invalid.' );
	return structuredClone( claims );

}

export function createRawEvidenceManifest( input ) {

	requireRecord( input, 'raw evidence manifest input' );
	const route = structuredClone( requireRecord( input.route, 'raw evidence route' ) );
	route.stateDigest = routeStateDigest( route );
	const sourceClosureHash = requireSha256( input.sourceClosureHash, 'raw evidence source closure hash' );
	const buildRevision = requireSha256( input.buildRevision, 'raw evidence build revision' );
	const captureSession = requireRecord( input.captureSession, 'raw evidence capture-session reference' );
	if ( captureSession.sourceClosureHash !== sourceClosureHash || captureSession.buildRevision !== buildRevision ) {

		throw new Error( 'Raw evidence capture-session identity differs from the manifest source closure.' );

	}
	const suffix = sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 );
	const manifest = {
		schemaVersion: 2,
		labId: requireString( input.labId, 'raw evidence labId' ),
		bundleId: input.bundleId ?? `${ input.labId }:raw-${ captureSession.profile }:${ suffix }:v2`,
		bundleKind: 'raw-capture-session',
		publishable: false,
		skill: requireString( input.skill, 'raw evidence skill' ),
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		route,
		limitations: structuredClone( input.limitations ?? [] ),
		claimVerdicts: validateClaims( input.claimVerdicts ),
		captureSessions: [ structuredClone( captureSession ) ],
		files: [ ...( input.files ?? [] ).map( ( entry ) => structuredClone( entry ) ) ],
		images: [ ...( input.images ?? [] ).map( ( entry ) => structuredClone( entry ) ) ],
		promotion: notEligiblePromotion()
	};
	const schemas = loadCheckedSchemas();
	const schemaResult = validateCheckedJsonSchema( schemas.evidenceManifest, manifest );
	if ( schemaResult.valid === false ) throw new AggregateError( schemaResult.errors.map( ( message ) => new Error( message ) ), 'Raw evidence manifest JSON schema validation failed.' );
	assertEvidenceManifestContract( manifest );
	return Object.freeze( manifest );

}
