import { createHash } from 'node:crypto';

import { assertPerformanceClaimEvidence } from '../../../../scripts/lib/evidence-runtime-claims.mjs';
import { createRuntimeGovernorTrace, createRuntimePerformanceTrace } from './physical-performance-trace.js';
import { createPerformanceEvidenceArtifacts } from './runtime-v2-bundle.js';

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function fail( message ) {

	throw new Error( message );

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

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

function parseTierVisualEvidence( bytes, ledgerEntry ) {

	if ( bytes instanceof Uint8Array === false || bytes.byteLength < 1 ) fail( 'Tier visual evidence bytes are missing.' );
	const ledger = requireObject( ledgerEntry, 'Tier visual evidence ledger entry' );
	if ( ledger.path !== 'tier-visual-evidence.json' || ledger.status !== 'captured' || ledger.kind !== 'supplementary-json' ) fail( 'Tier visual evidence ledger identity is invalid.' );
	if ( ledger.byteLength !== bytes.byteLength || SHA256.test( ledger.sha256 ?? '' ) === false || ledger.sha256 !== sha256( bytes ) ) fail( 'Tier visual evidence bytes differ from the correctness ledger.' );
	let document;
	try {

		document = JSON.parse( Buffer.from( bytes ).toString( 'utf8' ) );

	} catch ( error ) {

		fail( `Tier visual evidence is invalid JSON: ${ error.message }` );

	}
	const canonicalBytes = Buffer.from( `${ JSON.stringify( document, null, 2 ) }\n` );
	if ( canonicalBytes.equals( Buffer.from( bytes ) ) === false ) fail( 'Tier visual evidence is not canonical two-space JSON.' );
	return { document, sha256: ledger.sha256, byteLength: ledger.byteLength };

}

export function projectValidationHarnessPerformanceEvidence( input ) {

	const verifiedPerformance = requireObject( input?.verifiedPerformance, 'Verified performance input' );
	const correctnessIdentity = requireObject( input?.correctnessIdentity, 'Correctness identity' );
	const tier = parseTierVisualEvidence( input.tierVisualEvidenceBytes, input.tierVisualEvidenceLedgerEntry );
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
