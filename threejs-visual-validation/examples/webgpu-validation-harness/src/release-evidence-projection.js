import { validateEvidenceLaneJoin } from './physical-lane-join.js';
import { projectValidationHarnessPerformanceEvidence } from './performance-evidence-projection.js';
import { projectValidationHarnessPerformanceResources } from './performance-resource-projection.js';

const RESOURCE_ARTIFACT_PATHS = Object.freeze( [
	'renderer-info.json',
	'render-targets.json',
	'resident-resources.json',
	'bandwidth-model.json'
] );

function fail( message ) {

	throw new Error( message );

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) fail( `${ label } must be an object.` );
	return value;

}

function deepFreeze( value ) {

	if ( value && typeof value === 'object' && Object.isFrozen( value ) === false ) {

		for ( const entry of Object.values( value ) ) deepFreeze( entry );
		Object.freeze( value );

	}
	return value;

}

function correctnessArtifactInputs( artifacts, artifactBindings ) {

	const inputs = {};
	for ( const path of RESOURCE_ARTIFACT_PATHS ) {

		const artifact = requireObject( artifacts[ path ], `Correctness artifact ${ path }` );
		const binding = requireObject( artifactBindings[ path ], `Correctness artifact binding ${ path }` );
		if ( typeof binding.canonicalJson !== 'string' ) fail( `Correctness artifact binding ${ path } omits canonical JSON bytes.` );
		if ( `${ JSON.stringify( artifact, null, 2 ) }\n` !== binding.canonicalJson ) fail( `Correctness artifact ${ path } differs from its assembler-bound canonical bytes.` );
		inputs[ path ] = {
			bytes: Buffer.from( binding.canonicalJson, 'utf8' ),
			ledgerEntry: structuredClone( requireObject( binding.ledgerEntry, `Correctness artifact ledger ${ path }` ) )
		};

	}
	return inputs;

}

function assertProjectionJoin( { evidenceLaneJoin, verifiedPerformance, rawManifest, genericLaneJoin } ) {

	const validated = validateEvidenceLaneJoin( evidenceLaneJoin );
	if ( validated.performanceClaims !== true || validated.laneCount !== 3 ) fail( 'Release projection requires the finalized three-lane performance join.' );
	for ( const key of [ 'sourceClosureHash', 'buildRevision', 'threeRevision' ] ) {

		if ( rawManifest[ key ] !== evidenceLaneJoin.correctness[ key ] || rawManifest[ key ] !== validated[ key ] ) fail( `Release projection ${ key } differs across the raw bundle and strict lane join.` );

	}
	const correctnessSession = rawManifest.captureSessions?.find( ( session ) => session.profile === 'correctness' );
	if ( correctnessSession?.document?.sha256 !== evidenceLaneJoin.correctness.captureSessionDocumentHash ) fail( 'Release projection correctness session document differs from the strict lane join.' );
	const hardware = evidenceLaneJoin.hardwarePerformance;
	if ( hardware.sessionSha256 !== verifiedPerformance.sourceDocumentSha256
		|| hardware.captureSessionDocumentHash !== verifiedPerformance.sourceDocumentSha256
		|| hardware.captureSessionWriteLedgerHash !== verifiedPerformance.servedLedgerSha256 ) fail( 'Release projection hardware session differs from the verified performance wrapper.' );
	if ( genericLaneJoin.performanceClaims !== true
		|| genericLaneJoin.claimVerdicts?.performanceCompliance !== 'PASS'
		|| genericLaneJoin.claimVerdicts?.gpuAttribution !== 'PASS' ) fail( 'Release manifest lane join does not carry the strict hardware performance verdicts.' );
	return validated;

}

export function createValidationHarnessReleaseArtifactProjector( {
	evidenceLaneJoin,
	verifiedPerformance,
	tierVisualEvidenceBytes,
	tierVisualEvidenceLedgerEntry
} ) {

	requireObject( evidenceLaneJoin, 'Strict evidence lane join' );
	requireObject( verifiedPerformance, 'Verified performance input' );
	return ( { artifacts, artifactBindings, rawManifest, laneJoin } ) => {

		const sourceArtifacts = requireObject( artifacts, 'Correctness artifacts' );
		const sourceBindings = requireObject( artifactBindings, 'Correctness artifact bindings' );
		const raw = requireObject( rawManifest, 'Raw evidence manifest' );
		const genericJoin = requireObject( laneJoin, 'Release manifest lane join' );
		assertProjectionJoin( {
			evidenceLaneJoin,
			verifiedPerformance,
			rawManifest: raw,
			genericLaneJoin: genericJoin
		} );
		const correctnessIdentity = {
			sourceClosureHash: raw.sourceClosureHash,
			buildRevision: raw.buildRevision,
			threeRevision: raw.threeRevision
		};
		const shared = {
			verifiedPerformance,
			tierVisualEvidenceBytes,
			tierVisualEvidenceLedgerEntry,
			correctnessIdentity
		};
		const performance = projectValidationHarnessPerformanceEvidence( shared );
		const resources = projectValidationHarnessPerformanceResources( {
			...shared,
			correctnessArtifacts: correctnessArtifactInputs( sourceArtifacts, sourceBindings )
		} );
		for ( const key of [ 'performanceSessionDocumentSha256', 'performanceRecordSha256', 'performanceServedLedgerSha256', 'tierVisualEvidenceSha256', 'sourceClosureHash', 'buildRevision', 'threeRevision' ] ) {

			if ( performance.projectionBinding[ key ] !== resources.projectionBinding[ key ] ) fail( `Release evidence projectors disagree on ${ key }.` );

		}
		for ( const path of Object.keys( performance.artifacts ) ) if ( Object.hasOwn( resources.artifacts, path ) ) fail( `Release evidence projectors both replace ${ path }.` );
		return deepFreeze( {
			...structuredClone( performance.artifacts ),
			...structuredClone( resources.artifacts )
		} );

	};

}
