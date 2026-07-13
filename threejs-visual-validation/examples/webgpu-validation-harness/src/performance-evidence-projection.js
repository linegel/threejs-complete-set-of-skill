import { assertPerformanceClaimEvidence } from '../../../../scripts/lib/evidence-runtime-claims.mjs';
import { parseLedgerBoundCanonicalJson } from './ledger-bound-json.js';
import { createRuntimeGovernorTrace, createRuntimePerformanceTrace } from './physical-performance-trace.js';
import { createPerformanceEvidenceArtifacts } from './runtime-v2-bundle.js';

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

export function projectValidationHarnessPerformanceEvidence( input ) {

	const verifiedPerformance = requireObject( input?.verifiedPerformance, 'Verified performance input' );
	const correctnessIdentity = requireObject( input?.correctnessIdentity, 'Correctness identity' );
	const tier = parseLedgerBoundCanonicalJson( {
		label: 'Tier visual evidence',
		bytes: input.tierVisualEvidenceBytes,
		ledgerEntry: input.tierVisualEvidenceLedgerEntry,
		expectedPath: 'tier-visual-evidence.json',
		expectedKind: 'supplementary-json'
	} );
	const performanceIdentity = verifiedPerformance.record?.immutableBuild;
	for ( const key of [ 'sourceClosureHash', 'buildRevision', 'threeRevision' ] ) {

		if ( typeof correctnessIdentity[ key ] !== 'string' || correctnessIdentity[ key ].length === 0 ) fail( `Correctness identity omits ${ key }.` );
		if ( performanceIdentity?.[ key ] !== correctnessIdentity[ key ] ) fail( `Performance and correctness ${ key } differ.` );

	}
	if ( correctnessIdentity.threeRevision !== '0.185.1' ) fail( 'Performance projection requires Three 0.185.1.' );

	const performanceTrace = createRuntimePerformanceTrace( verifiedPerformance );
	const governorTrace = createRuntimeGovernorTrace( verifiedPerformance, tier.document );
	const projection = createPerformanceEvidenceArtifacts( {
		captureProfile: 'performance',
		adapterClass: 'hardware',
		metrics: { tier: governorTrace.settledState, cpuFrameMs: { samples: performanceTrace.cpuSamples } },
		gpuTiming: { verdict: 'PASS', renderMs: null, computeMs: null },
		performanceTrace,
		governorTrace
	} );
	if ( projection.performanceComplianceVerdict !== 'PASS' || projection.gpuAttributionVerdict !== 'PASS' ) fail( 'Projected performance evidence does not satisfy its required claim classifiers.' );
	const claimVerdicts = {
		performanceCompliance: projection.performanceComplianceVerdict,
		gpuAttribution: projection.gpuAttributionVerdict
	};
	assertPerformanceClaimEvidence( projection.artifacts, { claimVerdicts } );

	return deepFreeze( {
		artifacts: structuredClone( projection.artifacts ),
		claimVerdicts,
		projectionBinding: {
			performanceSessionDocumentSha256: verifiedPerformance.sourceDocumentSha256,
			performanceRecordSha256: verifiedPerformance.recordSha256,
			performanceServedLedgerSha256: verifiedPerformance.servedLedgerSha256,
			tierVisualEvidenceSha256: tier.sha256,
			tierVisualEvidenceByteLength: tier.byteLength,
			sourceClosureHash: correctnessIdentity.sourceClosureHash,
			buildRevision: correctnessIdentity.buildRevision,
			threeRevision: correctnessIdentity.threeRevision
		}
	} );

}
