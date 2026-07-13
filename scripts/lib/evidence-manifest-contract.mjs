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

export function routeSetDigest( routes ) {

	return canonicalSha256( [ ...( routes ?? [] ) ].sort( ( left, right ) => {

		const leftKey = `${ left?.path ?? '' }\u0000${ left?.stateDigest ?? '' }`;
		const rightKey = `${ right?.path ?? '' }\u0000${ right?.stateDigest ?? '' }`;
		return leftKey.localeCompare( rightKey );

	} ) );

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
	if ( Object.hasOwn( manifest ?? {}, 'routeSet' ) ) core.routeSet = manifest.routeSet;
	return canonicalSha256( core );

}

export function visualReviewDigest( visualSignoff ) {

	const { reviewDigest: ignored, ...review } = visualSignoff ?? {};
	return canonicalSha256( review );

}

export function createReleasePromotionBinding( manifest ) {

	const binding = {
		manifestCoreDigest: manifestCoreDigest( manifest ),
		sourceClosureHash: manifest.sourceClosureHash,
		buildRevision: manifest.buildRevision,
		threeRevision: manifest.threeRevision,
		route: structuredClone( manifest.route ),
		routeDigest: canonicalSha256( manifest.route ),
		limitations: structuredClone( manifest.limitations ),
		limitationsDigest: canonicalSha256( manifest.limitations ),
		claimVerdicts: structuredClone( manifest.claimVerdicts ),
		claimVerdictsDigest: canonicalSha256( manifest.claimVerdicts ),
		captureSessions: structuredClone( manifest.captureSessions ),
		captureSessionSetDigest: captureSessionSetDigest( manifest.captureSessions ),
		artifactLedgerDigest: artifactLedgerDigest( manifest.files ),
		imageLedgerDigest: imageLedgerDigest( manifest.images )
	};
	if ( Object.hasOwn( manifest ?? {}, 'routeSet' ) ) {

		binding.routeSet = structuredClone( manifest.routeSet );
		binding.routeSetDigest = routeSetDigest( manifest.routeSet );

	}
	return binding;

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
	const routeSet = Array.isArray( manifest.routeSet ) ? manifest.routeSet : [ manifest.route ];
	const routeIndex = indexUnique( routeSet, 'path', 'routeSet', errors );
	for ( const [ index, route ] of routeSet.entries() ) {

		if ( route?.stateDigest !== routeStateDigest( route ) ) errors.push( `routeSet[${ index }] state digest is invalid.` );
		const scenarioQuery = typeof route?.path === 'string' ? route.path.match( /\?scenario=([a-z0-9][a-z0-9-]*)$/ )?.[ 1 ] : undefined;
		if ( scenarioQuery !== undefined && route?.scenario !== scenarioQuery ) errors.push( `routeSet[${ index }] scenario query differs from its locked scenario state.` );

	}
	if ( manifest.routeSet !== undefined ) {

		const canonicalRoute = routeIndex.get( manifest.route?.path );
		if ( canonicalRoute === undefined || sameValue( canonicalRoute, manifest.route ) === false ) errors.push( 'routeSet does not contain the canonical release route.' );

	}
	indexUnique( sessions, 'sessionId', 'captureSessions', errors );
	indexUnique( sessions, 'profile', 'captureSessions', errors );
	const documentPaths = new Set();
	const writeLedgerPaths = new Set();
	const coveredRoutePaths = new Set();
	for ( const [ index, session ] of sessions.entries() ) {

		const label = `captureSessions[${ index }]`;
		if ( typeof session?.automationSurface !== 'string' || session.automationSurface.length === 0 ) errors.push( `${ label } automationSurface must identify the capture implementation.` );
		if ( session?.sourceClosureHash !== manifest.sourceClosureHash ) errors.push( `${ label } source closure differs from the release manifest.` );
		if ( session?.buildRevision !== manifest.buildRevision ) errors.push( `${ label } build revision differs from the release manifest.` );
		if ( session?.threeRevision !== manifest.threeRevision ) errors.push( `${ label } Three.js revision differs from the release manifest.` );
		const startedAt = Date.parse( session?.startedAt );
		const finishedAt = Date.parse( session?.finishedAt );
		if ( Number.isFinite( startedAt ) === false || Number.isFinite( finishedAt ) === false || finishedAt < startedAt ) errors.push( `${ label } capture interval is invalid.` );
		const sessionRoute = routeIndex.get( session?.routePath );
		if ( sessionRoute === undefined ) errors.push( `${ label } route path is not a member of the release route set.` );
		else {

			if ( session?.routeDigest !== canonicalSha256( sessionRoute ) ) errors.push( `${ label } route digest differs from its bound release route.` );
			if ( session?.stateDigest !== sessionRoute.stateDigest ) errors.push( `${ label } state digest differs from its bound release route state.` );

		}
		if ( session?.routeSetPaths !== undefined || session?.routeSetDigest !== undefined ) {

			const routeSetPaths = Array.isArray( session?.routeSetPaths ) ? session.routeSetPaths : [];
			const uniquePaths = new Set( routeSetPaths );
			if ( routeSetPaths.length === 0 || uniquePaths.size !== routeSetPaths.length ) errors.push( `${ label } route-set path binding is empty or duplicated.` );
			if ( uniquePaths.has( session?.routePath ) === false ) errors.push( `${ label } route-set path binding omits its canonical routePath.` );
			const boundRoutes = routeSetPaths.map( ( path ) => routeIndex.get( path ) );
			for ( const [ routePosition, route ] of boundRoutes.entries() ) if ( route === undefined ) errors.push( `${ label } routeSetPaths[${ routePosition }] is not a member of the release route set.` );
			if ( boundRoutes.every( Boolean ) && session?.routeSetDigest !== routeSetDigest( boundRoutes ) ) errors.push( `${ label } route-set digest differs from its bound release routes.` );
			for ( const path of routeSetPaths ) if ( routeIndex.has( path ) ) coveredRoutePaths.add( path );

		} else if ( sessionRoute !== undefined ) coveredRoutePaths.add( session.routePath );
		if ( session?.rendererInitialized !== true || session?.isWebGPUBackend !== true ) errors.push( `${ label } does not prove initialized native WebGPU execution.` );
		if ( manifest.bundleKind === 'release-bundle' && session?.profile === 'performance' && session?.adapterClass !== 'hardware' ) errors.push( `${ label } claimed performance lane is not bound to a hardware adapter.` );
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

		if ( manifest.claimVerdicts?.performanceCompliance === 'PASS' || manifest.claimVerdicts?.gpuAttribution === 'PASS' ) {

			if ( profiles.has( 'performance' ) === false ) errors.push( 'Passing performance or GPU-attribution claims require a hardware performance capture lane.' );

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
		if ( Object.hasOwn( manifest, 'routeSet' ) ) {

			if ( sameValue( binding.routeSet, manifest.routeSet ) === false ) errors.push( 'Promotion binding route set differs from the release manifest.' );
			checkDigest( errors, binding.routeSetDigest, routeSetDigest( manifest.routeSet ), 'Promotion route set' );

		} else if ( Object.hasOwn( binding, 'routeSet' ) || Object.hasOwn( binding, 'routeSetDigest' ) ) errors.push( 'Promotion binding invents a route set absent from the release manifest.' );
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

		if ( signoff.status === 'APPROVED' || signoff.status === 'REJECTED' ) {

			const candidateBinding = signoff.candidateBinding;
			if ( candidateBinding === null || typeof candidateBinding !== 'object' || Array.isArray( candidateBinding ) ) errors.push( 'Visual signoff candidate binding is missing.' );
			else {

				checkDigest( errors, signoff.candidateBindingDigest, canonicalSha256( candidateBinding ), 'Visual signoff candidate binding' );
				const candidateProjection = structuredClone( manifest );
				candidateProjection.publishable = false;
				candidateProjection.limitations = structuredClone( candidateBinding.limitations );
				const expectedCandidateBinding = createReleasePromotionBinding( candidateProjection );
				if ( sameValue( candidateBinding, expectedCandidateBinding ) === false ) errors.push( 'Visual signoff candidate binding does not reconstruct from the immutable release inputs.' );
				if ( candidateBinding.artifactLedgerDigest !== binding?.artifactLedgerDigest ) errors.push( 'Visual signoff candidate artifact ledger differs from the promoted release.' );
				if ( candidateBinding.imageLedgerDigest !== binding?.imageLedgerDigest ) errors.push( 'Visual signoff candidate image ledger differs from the promoted release.' );

			}

		}

		for ( const reviewedPath of signoff.reviewedImages ?? [] ) {

			const image = imageIndex.get( reviewedPath );
			if ( image === undefined ) errors.push( `Visual signoff reviewedImages does not resolve "${ reviewedPath }".` );
			else if ( image.status !== 'captured' ) errors.push( `Visual signoff reviewedImages references N/A image "${ reviewedPath }".` );

		}
		if ( signoff.status === 'APPROVED' || signoff.status === 'REJECTED' ) checkDigest( errors, signoff.reviewDigest, visualReviewDigest( signoff ), 'Visual signoff review' );
	}

}

function validateLimitations( manifest, errors ) {

	void manifest;
	void errors;

}

function validatePublishableRelease( manifest, fileIndex, imageIndex, errors ) {

	if ( manifest.publishable !== true ) return;
	if ( manifest.promotion?.status !== 'APPROVED' ) errors.push( 'Publishable evidence requires APPROVED promotion.' );
	if ( [ ...fileIndex.values() ].some( ( file ) => file?.status === 'captured' ) === false
		&& [ ...imageIndex.values() ].some( ( image ) => image?.status === 'captured' ) === false ) {
		errors.push( 'Featured demo evidence requires at least one captured artifact or image.' );
	}

}

export function validateEvidenceManifestContract( manifest ) {

	const errors = [];
	if ( manifest === null || typeof manifest !== 'object' || Array.isArray( manifest ) ) return [ 'Evidence manifest must be an object.' ];
	const files = Array.isArray( manifest.files ) ? manifest.files : [];
	const images = Array.isArray( manifest.images ) ? manifest.images : [];
	const fileIndex = indexUnique( files, 'path', 'files', errors );
	const imageIndex = indexUnique( images, 'path', 'images', errors );
	indexUnique( images, 'role', 'images', errors );
	indexUnique( Array.isArray( manifest.limitations ) ? manifest.limitations : [], 'id', 'limitations', errors );
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
	validateLimitations( manifest, errors );
	validatePromotion( manifest, fileIndex, imageIndex, errors );
	validatePublishableRelease( manifest, fileIndex, imageIndex, errors );
	return errors;

}

export function assertEvidenceManifestContract( manifest ) {

	const errors = validateEvidenceManifestContract( manifest );
	if ( errors.length > 0 ) throw new AggregateError( errors.map( ( message ) => new Error( message ) ), `Evidence manifest semantic contract failed with ${ errors.length } error${ errors.length === 1 ? '' : 's' }.` );
	return manifest;

}
