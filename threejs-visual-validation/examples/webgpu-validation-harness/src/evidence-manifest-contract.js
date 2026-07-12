import { createHash } from 'node:crypto';

export const NORMATIVE_JSON_PATHS = Object.freeze( [
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

export const STANDARD_IMAGE_PATHS = Object.freeze( [
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

const CLAIM_NAMES = Object.freeze( [
	'visualCorrectness',
	'mechanismCorrectness',
	'performanceCompliance',
	'gpuAttribution',
	'lifecycleStability',
	'visualError'
] );

const SESSION_PROFILE_SURFACES = Object.freeze( {
	correctness: 'codex-in-app-browser',
	'physical-route': 'codex-in-app-browser',
	performance: 'codex-in-app-browser'
} );

const SESSION_IDENTITY_KINDS = Object.freeze( {
	adapterIdentity: 'gpu-adapter',
	deviceIdentity: 'gpu-device',
	browserIdentity: 'browser',
	osIdentity: 'operating-system',
	refreshIdentity: 'display-refresh',
	colorIdentity: 'color-pipeline'
} );

function canonicalJson( value, active = new Set() ) {

	if ( value === null || typeof value === 'boolean' || typeof value === 'string' ) return JSON.stringify( value );
	if ( typeof value === 'number' ) {

		if ( Number.isFinite( value ) === false ) throw new TypeError( 'Canonical evidence JSON rejects non-finite numbers.' );
		return JSON.stringify( Object.is( value, - 0 ) ? 0 : value );

	}
	if ( typeof value !== 'object' ) throw new TypeError( `Canonical evidence JSON rejects ${ typeof value } values.` );
	if ( active.has( value ) ) throw new TypeError( 'Canonical evidence JSON rejects cyclic values.' );
	active.add( value );
	let result;
	if ( Array.isArray( value ) ) {

		result = `[${ value.map( ( entry ) => canonicalJson( entry, active ) ).join( ',' ) }]`;

	} else {

		const keys = Object.keys( value ).sort();
		result = `{${ keys.map( ( key ) => `${ JSON.stringify( key ) }:${ canonicalJson( value[ key ], active ) }` ).join( ',' ) }}`;

	}
	active.delete( value );
	return result;

}

export function canonicalSha256( value ) {

	return `sha256:${ createHash( 'sha256' ).update( canonicalJson( value ) ).digest( 'hex' ) }`;

}

function sortedBy( values, key ) {

	return [ ...( values ?? [] ) ].sort( ( left, right ) => String( left?.[ key ] ?? '' ).localeCompare( String( right?.[ key ] ?? '' ) ) );

}

export function routeStateDigest( route ) {

	const { stateDigest: ignored, ...state } = route ?? {};
	return canonicalSha256( state );

}

export function captureSessionSetDigest( sessions ) {

	return canonicalSha256( sortedBy( sessions, 'sessionId' ) );

}

export function artifactLedgerDigest( files ) {

	return canonicalSha256( sortedBy( files, 'path' ) );

}

export function imageLedgerDigest( images ) {

	return canonicalSha256( sortedBy( images, 'path' ) );

}

export function manifestCoreDigest( manifest ) {

	const core = {};
	for ( const key of [
		'schemaVersion',
		'labId',
		'bundleId',
		'bundleKind',
		'publishable',
		'skill',
		'threeRevision',
		'sourceClosureHash',
		'buildRevision',
		'route',
		'limitations',
		'claimVerdicts'
	] ) core[ key ] = manifest?.[ key ];
	return canonicalSha256( core );

}

export function visualReviewDigest( visualSignoff ) {

	const { reviewDigest: ignored, ...review } = visualSignoff ?? {};
	return canonicalSha256( review );

}

function sameValue( left, right ) {

	try {

		return canonicalJson( left ) === canonicalJson( right );

	} catch {

		return false;

	}

}

function checkDigest( errors, actual, expected, label ) {

	if ( actual !== expected ) errors.push( `${ label } does not match its canonical SHA-256 digest.` );

}

function indexUnique( values, key, label, errors ) {

	const index = new Map();
	for ( const [ position, value ] of ( values ?? [] ).entries() ) {

		const identity = value?.[ key ];
		if ( typeof identity !== 'string' || identity.length === 0 ) continue;
		if ( index.has( identity ) ) errors.push( `${ label } duplicates ${ key} "${ identity }" at entries ${ index.get( identity ).position } and ${ position }.` );
		else index.set( identity, { value, position } );

	}
	return new Map( [ ...index.entries() ].map( ( [ identity, entry ] ) => [ identity, entry.value ] ) );

}

function requireCapturedReference( errors, fileIndex, reference, expectedKind, label ) {

	const file = fileIndex.get( reference?.path );
	if ( file === undefined ) {

		errors.push( `${ label } does not resolve to a file-ledger entry.` );
		return;

	}
	if ( file.status !== 'captured' ) errors.push( `${ label } resolves to a non-captured file-ledger entry.` );
	if ( file.kind !== expectedKind || reference?.kind !== expectedKind ) errors.push( `${ label } has the wrong ledger kind.` );
	if ( file.sha256 !== reference?.sha256 ) errors.push( `${ label } SHA-256 does not match the captured file-ledger entry.` );
	if ( file.byteLength !== reference?.byteLength ) errors.push( `${ label } byte length does not match the captured file-ledger entry.` );

}

function validateCaptureSessions( manifest, fileIndex, errors ) {

	const sessions = Array.isArray( manifest.captureSessions ) ? manifest.captureSessions : [];
	indexUnique( sessions, 'sessionId', 'captureSessions', errors );
	indexUnique( sessions, 'profile', 'captureSessions', errors );
	const documentPaths = new Set();
	const writeLedgerPaths = new Set();
	for ( const [ index, session ] of sessions.entries() ) {

		const label = `captureSessions[${ index }]`;
		const expectedSurface = SESSION_PROFILE_SURFACES[ session?.profile ];
		if ( expectedSurface !== undefined && session.automationSurface !== expectedSurface ) errors.push( `${ label } crosses capture lanes: ${ session.profile } requires ${ expectedSurface }.` );
		if ( session?.sourceClosureHash !== manifest.sourceClosureHash ) errors.push( `${ label } source closure differs from the release manifest.` );
		if ( session?.buildRevision !== manifest.buildRevision ) errors.push( `${ label } build revision differs from the release manifest.` );
		if ( session?.threeRevision !== manifest.threeRevision ) errors.push( `${ label } Three.js revision differs from the release manifest.` );
		const startedAt = Date.parse( session?.startedAt );
		const finishedAt = Date.parse( session?.finishedAt );
		if ( Number.isFinite( startedAt ) === false || Number.isFinite( finishedAt ) === false || finishedAt < startedAt ) errors.push( `${ label } capture interval is invalid.` );
		if ( session?.routePath !== manifest.route?.path ) errors.push( `${ label } route path differs from the release manifest.` );
		if ( session?.routeDigest !== canonicalSha256( manifest.route ) ) errors.push( `${ label } route digest differs from the canonical release route.` );
		if ( session?.stateDigest !== manifest.route?.stateDigest ) errors.push( `${ label } state digest differs from the release route state.` );
		if ( session?.rendererInitialized !== true || session?.isWebGPUBackend !== true ) errors.push( `${ label } does not prove initialized native WebGPU execution.` );
		if ( manifest.bundleKind === 'release-bundle' && session?.adapterClass !== 'hardware' ) errors.push( `${ label } Codex Browser capture lane is not bound to a hardware adapter.` );
		if ( manifest.bundleKind === 'release-bundle' && session?.profile === 'performance' && session?.timestampQuerySupported !== true ) errors.push( `${ label } performance lane lacks timestamp-query support.` );
		for ( const [ field, kind ] of Object.entries( SESSION_IDENTITY_KINDS ) ) if ( session?.[ field ]?.kind !== kind || typeof session?.[ field ]?.digest !== 'string' ) errors.push( `${ label } ${ field } reference is invalid.` );
		if ( typeof session?.limitationsDigest !== 'string' ) errors.push( `${ label } limitations digest is invalid.` );
		requireCapturedReference( errors, fileIndex, session?.document, 'capture-session-document', `${ label }.document` );
		requireCapturedReference( errors, fileIndex, session?.writeLedger, 'capture-session-write-ledger', `${ label }.writeLedger` );
		if ( documentPaths.has( session?.document?.path ) ) errors.push( `${ label } reuses another session document path.` );
		if ( writeLedgerPaths.has( session?.writeLedger?.path ) ) errors.push( `${ label } reuses another session write-ledger path.` );
		documentPaths.add( session?.document?.path );
		writeLedgerPaths.add( session?.writeLedger?.path );

	}
	const profiles = new Map( sessions.map( ( session ) => [ session.profile, session ] ) );
	if ( manifest.bundleKind === 'release-bundle' ) {

		if ( profiles.has( 'correctness' ) === false ) errors.push( 'Release bundle is missing the correctness capture lane.' );
		if ( profiles.has( 'physical-route' ) === false ) errors.push( 'Release bundle is missing the physical-route capture lane.' );
		if ( manifest.claimVerdicts?.performanceCompliance === 'PASS' || manifest.claimVerdicts?.gpuAttribution === 'PASS' ) {

			if ( profiles.has( 'performance' ) === false ) errors.push( 'Passing performance or GPU-attribution claims require a hardware performance capture lane.' );

		}
		const physical = profiles.get( 'physical-route' );
		const performance = profiles.get( 'performance' );
		const correctness = profiles.get( 'correctness' );
		if ( correctness && physical ) {

			for ( const [ field, description ] of [
				[ 'adapterIdentity', 'hardware adapters' ],
				[ 'deviceIdentity', 'GPU devices' ],
				[ 'browserIdentity', 'physical browsers' ],
				[ 'osIdentity', 'operating systems' ],
				[ 'colorIdentity', 'color pipelines' ]
			] ) if ( correctness[ field ]?.digest !== physical[ field ]?.digest ) errors.push( `Correctness and physical-route lanes name different ${ description }.` );

		}
		if ( physical && performance ) {

			for ( const [ field, description ] of [
				[ 'adapterIdentity', 'hardware adapters' ],
				[ 'deviceIdentity', 'GPU devices' ],
				[ 'browserIdentity', 'physical browsers' ],
				[ 'osIdentity', 'operating systems' ],
				[ 'refreshIdentity', 'display refresh measurements' ],
				[ 'colorIdentity', 'color pipelines' ]
			] ) if ( physical[ field ]?.digest !== performance[ field ]?.digest ) errors.push( `Physical-route and performance lanes name different ${ description }.` );

		}

	}

}

function validateImageClosure( manifest, fileIndex, imageIndex, errors ) {

	for ( const [ index, image ] of ( manifest.images ?? [] ).entries() ) {

		const label = `images[${ index }]`;
		if ( image?.status === 'not-applicable' ) {

			const graph = fileIndex.get( image?.notApplicableProof?.pipelineGraphPath );
			if ( graph?.path !== 'pipeline-graph.json' || graph.status !== 'captured' ) errors.push( `${ label } N/A proof does not resolve to the captured pipeline graph.` );
			if ( graph?.sha256 !== image?.notApplicableProof?.pipelineGraphDigest ) errors.push( `${ label } N/A proof digest differs from the captured pipeline graph.` );

		}
		for ( const sourcePath of image?.sourceCaptures ?? [] ) {

			if ( sourcePath === image.path ) {

				errors.push( `${ label } sourceCaptures contains a self-reference.` );
				continue;

			}
			const sourceImage = imageIndex.get( sourcePath );
			const sourceFile = fileIndex.get( sourcePath );
			if ( sourceImage === undefined && sourceFile === undefined ) errors.push( `${ label } sourceCaptures does not resolve "${ sourcePath }".` );
			if ( sourceImage && sourceImage.status !== 'captured' ) errors.push( `${ label } sourceCaptures references N/A image "${ sourcePath }".` );
			if ( sourceFile && sourceFile.status !== 'captured' ) errors.push( `${ label } sourceCaptures references non-captured file "${ sourcePath }".` );
			if ( sourceImage === undefined && sourceFile && [ 'raw-readback', 'binary-artifact' ].includes( sourceFile.kind ) === false ) errors.push( `${ label } sourceCaptures references non-image evidence kind "${ sourceFile.kind }".` );
			if ( sourceImage && sourceFile && sourceImage.status === 'captured' && sourceFile.status === 'captured' ) {

				if ( sourceImage.sha256 !== sourceFile.sha256 || sourceImage.byteLength !== sourceFile.byteLength ) errors.push( `${ label } sourceCaptures resolves to contradictory image and file ledger entries for "${ sourcePath }".` );

			}

		}

	}

}

function validatePromotion( manifest, fileIndex, imageIndex, errors ) {

	const promotion = manifest.promotion;
	if ( promotion === null || typeof promotion !== 'object' ) return;
	const binding = promotion.binding;
	if ( binding !== null && typeof binding === 'object' ) {

		if ( binding.sourceClosureHash !== manifest.sourceClosureHash ) errors.push( 'Promotion binding source closure differs from the release manifest.' );
		if ( binding.buildRevision !== manifest.buildRevision ) errors.push( 'Promotion binding build revision differs from the release manifest.' );
		if ( binding.threeRevision !== manifest.threeRevision ) errors.push( 'Promotion binding Three.js revision differs from the release manifest.' );
		if ( sameValue( binding.route, manifest.route ) === false ) errors.push( 'Promotion binding route differs from the release manifest.' );
		if ( sameValue( binding.limitations, manifest.limitations ) === false ) errors.push( 'Promotion binding limitations differ from the release manifest.' );
		if ( sameValue( binding.claimVerdicts, manifest.claimVerdicts ) === false ) errors.push( 'Promotion binding claim verdicts differ from the release manifest.' );
		if ( sameValue( binding.captureSessions, manifest.captureSessions ) === false ) errors.push( 'Promotion binding capture-session set differs from the release manifest.' );
		checkDigest( errors, binding.manifestCoreDigest, manifestCoreDigest( manifest ), 'Promotion manifest core' );
		checkDigest( errors, binding.routeDigest, canonicalSha256( manifest.route ), 'Promotion route' );
		checkDigest( errors, binding.limitationsDigest, canonicalSha256( manifest.limitations ), 'Promotion limitations' );
		checkDigest( errors, binding.claimVerdictsDigest, canonicalSha256( manifest.claimVerdicts ), 'Promotion claim verdicts' );
		checkDigest( errors, binding.captureSessionSetDigest, captureSessionSetDigest( manifest.captureSessions ), 'Promotion capture-session set' );
		checkDigest( errors, binding.artifactLedgerDigest, artifactLedgerDigest( manifest.files ), 'Promotion artifact ledger' );
		checkDigest( errors, binding.imageLedgerDigest, imageLedgerDigest( manifest.images ), 'Promotion image ledger' );
		checkDigest( errors, promotion.bindingDigest, canonicalSha256( binding ), 'Promotion binding' );

	}
	const signoff = promotion.visualSignoff;
	if ( signoff !== null && typeof signoff === 'object' ) {

		for ( const reviewedPath of signoff.reviewedImages ?? [] ) {

			const image = imageIndex.get( reviewedPath );
			if ( image === undefined ) errors.push( `Visual signoff reviewedImages does not resolve "${ reviewedPath }".` );
			else if ( image.status !== 'captured' ) errors.push( `Visual signoff reviewedImages references N/A image "${ reviewedPath }".` );

		}
		if ( signoff.status === 'APPROVED' || signoff.status === 'REJECTED' ) checkDigest( errors, signoff.reviewDigest, visualReviewDigest( signoff ), 'Visual signoff review' );
		if ( signoff.status === 'APPROVED' && manifest.publishable === true ) {

			const reviewed = new Set( signoff.reviewedImages ?? [] );
			for ( const path of STANDARD_IMAGE_PATHS ) if ( imageIndex.get( path )?.status === 'captured' && reviewed.has( path ) === false ) errors.push( `Approved visual signoff omits captured standard image "${ path }".` );

		}

	}

}

function validatePublishableRelease( manifest, fileIndex, imageIndex, errors ) {

	if ( manifest.publishable !== true ) return;
	if ( manifest.bundleKind !== 'release-bundle' ) errors.push( 'Publishable evidence must be an offline joined release bundle.' );
	if ( manifest.promotion?.status !== 'APPROVED' ) errors.push( 'Publishable evidence requires APPROVED promotion.' );
	for ( const path of NORMATIVE_JSON_PATHS ) {

		const file = fileIndex.get( path );
		if ( path === 'evidence-manifest.json' ) {

			if ( file?.status !== 'self-excluded' || file?.kind !== 'evidence-manifest' ) errors.push( 'Publishable evidence requires a self-excluded evidence-manifest.json ledger record.' );

		} else if ( file?.status !== 'captured' || file?.kind !== 'normative-json' ) errors.push( `Publishable evidence is missing captured normative artifact "${ path }".` );

	}
	if ( ( manifest.captureSessions ?? [] ).length < 2 ) errors.push( 'Publishable evidence requires joined correctness and physical-route capture sessions.' );
	for ( const path of STANDARD_IMAGE_PATHS ) {

		const image = imageIndex.get( path );
		if ( image === undefined ) errors.push( `Publishable evidence is missing standard image record "${ path }".` );
		else if ( image.status !== 'captured' && image.status !== 'not-applicable' ) errors.push( `Publishable standard image "${ path }" has no captured or structurally N/A status.` );

	}
	const final = imageIndex.get( 'final.design.png' );
	const diagnostic = imageIndex.get( 'diagnostics.mosaic.png' );
	if ( final?.status !== 'captured' || diagnostic?.status !== 'captured' ) errors.push( 'Publishable evidence requires captured final and diagnostic images.' );
	else if ( final.sha256 === diagnostic.sha256 ) errors.push( 'Publishable final and diagnostic images have identical hashes.' );

}

export function validateEvidenceManifestContract( manifest ) {

	const errors = [];
	if ( manifest === null || typeof manifest !== 'object' || Array.isArray( manifest ) ) return [ 'Evidence manifest must be an object.' ];
	const files = Array.isArray( manifest.files ) ? manifest.files : [];
	const images = Array.isArray( manifest.images ) ? manifest.images : [];
	const fileIndex = indexUnique( files, 'path', 'files', errors );
	const imageIndex = indexUnique( images, 'path', 'images', errors );
	indexUnique( images, 'role', 'images', errors );
	if ( manifest.route && typeof manifest.route === 'object' ) checkDigest( errors, manifest.route.stateDigest, routeStateDigest( manifest.route ), 'Route state' );
	if ( manifest.bundleKind === 'contract-fixture' ) {

		if ( manifest.publishable !== false ) errors.push( 'Contract fixture cannot be publishable.' );
		if ( manifest.promotion?.status !== 'NOT_ELIGIBLE' ) errors.push( 'Contract fixture cannot claim promotion eligibility.' );
		if ( ( manifest.captureSessions ?? [] ).length !== 0 ) errors.push( 'Contract fixture cannot contain runtime capture sessions.' );
		for ( const claim of CLAIM_NAMES ) if ( manifest.claimVerdicts?.[ claim ] === 'PASS' ) errors.push( `Contract fixture cannot claim PASS for ${ claim }.` );

	}
	if ( manifest.bundleKind === 'raw-capture-session' ) {

		if ( manifest.publishable !== false ) errors.push( 'Raw capture session cannot be publishable.' );
		if ( manifest.promotion?.status !== 'NOT_ELIGIBLE' ) errors.push( 'Raw capture session cannot claim promotion eligibility.' );

	}
	validateCaptureSessions( manifest, fileIndex, errors );
	validateImageClosure( manifest, fileIndex, imageIndex, errors );
	validatePromotion( manifest, fileIndex, imageIndex, errors );
	validatePublishableRelease( manifest, fileIndex, imageIndex, errors );
	return errors;

}

export function assertEvidenceManifestContract( manifest ) {

	const errors = validateEvidenceManifestContract( manifest );
	if ( errors.length > 0 ) throw new AggregateError( errors.map( ( message ) => new Error( message ) ), `Evidence manifest semantic contract failed with ${ errors.length } error${ errors.length === 1 ? '' : 's' }.` );
	return manifest;

}
