import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas } from './checked-json-schema.js';
import {
	artifactLedgerDigest,
	assertEvidenceManifestContract,
	canonicalSha256,
	captureSessionSetDigest,
	imageLedgerDigest,
	manifestCoreDigest,
	STANDARD_IMAGE_PATHS,
	visualReviewDigest
} from './evidence-manifest-contract.js';
import { readUnifiedEvidenceManifest, validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';

export function createOfflinePromotionBinding( manifest ) {

	return {
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

}

function promotionReview( manifest, review ) {

	if ( review === null ) return {
		status: 'PENDING', reviewer: null, reviewedAt: null, reviewDigest: null, reviewedImages: [], notes: []
	};
	const status = review.status ?? review.decision;
	if ( status !== 'APPROVED' && status !== 'REJECTED' ) throw new Error( 'Offline visual review must decide APPROVED or REJECTED.' );
	const reviewedImages = review.reviewedImages ?? STANDARD_IMAGE_PATHS.filter( ( path ) => manifest.images.find( ( image ) => image.path === path )?.status === 'captured' );
	const record = {
		status,
		reviewer: review.reviewer,
		reviewedAt: review.reviewedAt,
		reviewDigest: null,
		reviewedImages,
		notes: review.notes ?? []
	};
	record.reviewDigest = visualReviewDigest( record );
	return record;

}

export async function resolveOfflinePromotionManifest( manifest, visualReview = null ) {

	if ( manifest.bundleKind !== 'release-bundle' || manifest.publishable !== false ) throw new Error( 'Offline promotion starts only from a nonpublishable joined release bundle.' );
	if ( manifest.promotion?.status !== 'PENDING_VISUAL_SIGNOFF' ) throw new Error( 'Joined release is not awaiting offline visual signoff.' );
	const review = promotionReview( manifest, visualReview );
	const approved = review.status === 'APPROVED';
	if ( approved ) for ( const claim of [ 'visualCorrectness', 'mechanismCorrectness', 'lifecycleStability' ] ) {

		if ( manifest.claimVerdicts[ claim ] !== 'PASS' ) throw new Error( `Offline promotion requires ${ claim}=PASS.` );

	}
	const targetManifest = {
		...manifest,
		publishable: approved
	};
	const binding = createOfflinePromotionBinding( targetManifest );
	const promotedManifest = {
		...targetManifest,
		promotion: {
			status: review.status === 'PENDING' ? 'PENDING_VISUAL_SIGNOFF' : review.status,
			binding,
			bindingDigest: canonicalSha256( binding ),
			visualSignoff: review
		}
	};
	const schemas = await loadCheckedEvidenceSchemas();
	assertCheckedJsonSchema( schemas.evidenceManifest, promotedManifest, 'promoted evidence-manifest.json' );
	assertEvidenceManifestContract( promotedManifest );
	return Object.freeze( {
		manifest: promotedManifest,
		binding,
		bindingDigest: promotedManifest.promotion.bindingDigest,
		status: promotedManifest.promotion.status,
		publishable: promotedManifest.publishable
	} );

}

export async function prepareOfflinePromotion( artifactDir, visualReview = null ) {

	const validation = await validateUnifiedV2ArtifactBundle( artifactDir );
	if ( validation.bundleKind !== 'release-bundle' || validation.publishable !== false ) throw new Error( 'Offline promotion starts only from a nonpublishable joined release bundle.' );
	const { manifest } = await readUnifiedEvidenceManifest( artifactDir );
	return resolveOfflinePromotionManifest( manifest, visualReview );

}
