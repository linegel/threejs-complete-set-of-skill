import assert from 'node:assert/strict';

const RECORD_KEYS = Object.freeze( [
	'problemId', 'decisionRevision', 'observable', 'frozenWeights', 'tieBreakOrder',
	'hardGates', 'candidates', 'selectedCandidateId', 'status'
] );

const CANDIDATE_KEYS = Object.freeze( [
	'candidateId', 'algorithmFamily', 'scores', 'hardGateResults', 'pros', 'cons',
	'assumptions', 'evidence'
] );

const QUANTITY_KEYS = Object.freeze( [ 'value', 'unit', 'label', 'source' ] );
const LABELS = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );

function exactKeys( value, keys, label ) {

	assert.ok( value && typeof value === 'object' && ! Array.isArray( value ), `${ label } must be an object` );
	assert.deepEqual( Object.keys( value ).sort(), [ ...keys ].sort(), `${ label } has missing or unknown fields` );

}

function nonemptyUniqueStrings( values, label ) {

	assert.ok( Array.isArray( values ) && values.length > 0, `${ label } must be nonempty` );
	assert.ok( values.every( ( value ) => typeof value === 'string' && value.length > 0 ), `${ label } contains an invalid string` );
	assert.equal( values.length, new Set( values ).size, `${ label } contains duplicates` );

}

function validateQuantity( value, label ) {

	exactKeys( value, QUANTITY_KEYS, label );
	assert.ok( Number.isFinite( value.value ), `${ label }.value must be finite` );
	assert.ok( typeof value.unit === 'string' && value.unit.length > 0, `${ label }.unit must be nonempty` );
	assert.ok( LABELS.has( value.label ), `${ label}.label is not an evidence label` );
	assert.ok( typeof value.source === 'string' && value.source.length > 0, `${ label }.source must be nonempty` );

}

function validateCandidate( candidate, axes, hardGateIds, index ) {

	const label = `candidates[${ index }]`;
	exactKeys( candidate, CANDIDATE_KEYS, label );
	assert.ok( /^[a-z0-9][a-z0-9-]*$/.test( candidate.candidateId ), `${ label }.candidateId is invalid` );
	assert.ok( typeof candidate.algorithmFamily === 'string' && candidate.algorithmFamily.length > 0, `${ label }.algorithmFamily is empty` );
	assert.deepEqual( Object.keys( candidate.scores ).sort(), [ ...axes ].sort(), `${ label }.scores do not close over the frozen axes` );
	for ( const [ axis, score ] of Object.entries( candidate.scores ) ) {

		assert.ok( Number.isInteger( score ) && score >= 0 && score <= 5, `${ label }.scores.${ axis } must be an integer from 0 to 5` );

	}
	assert.deepEqual( Object.keys( candidate.hardGateResults ).sort(), [ ...hardGateIds ].sort(), `${ label }.hardGateResults do not close over the frozen gates` );
	assert.ok( Object.values( candidate.hardGateResults ).every( ( result ) => result === 'pass' || result === 'fail' ), `${ label }.hardGateResults contains an invalid result` );
	for ( const field of [ 'pros', 'cons', 'assumptions', 'evidence' ] ) nonemptyUniqueStrings( candidate[ field ], `${ label }.${ field }` );

}

export function scorePhysicsDecision( record ) {

	exactKeys( record, RECORD_KEYS, 'decision' );
	assert.ok( /^[a-z0-9][a-z0-9-]*$/.test( record.problemId ), 'decision.problemId is invalid' );
	assert.ok( typeof record.decisionRevision === 'string' && record.decisionRevision.length > 0, 'decision.decisionRevision is empty' );
	assert.ok( typeof record.observable === 'string' && record.observable.length > 0, 'decision.observable is empty' );
	assert.ok( record.frozenWeights && typeof record.frozenWeights === 'object' && ! Array.isArray( record.frozenWeights ), 'decision.frozenWeights must be an object' );
	const axes = Object.keys( record.frozenWeights );
	assert.ok( axes.length >= 5, 'decision must score at least five independent axes' );
	for ( const axis of axes ) validateQuantity( record.frozenWeights[ axis ], `decision.frozenWeights.${ axis }` );
	assert.ok( Object.values( record.frozenWeights ).every( ( weight ) => weight.value > 0 ), 'decision weights must be positive' );
	nonemptyUniqueStrings( record.tieBreakOrder, 'decision.tieBreakOrder' );
	assert.deepEqual( [ ...record.tieBreakOrder ].sort(), [ ...axes ].sort(), 'decision.tieBreakOrder must close over the frozen axes' );
	assert.ok( record.hardGates && typeof record.hardGates === 'object' && ! Array.isArray( record.hardGates ), 'decision.hardGates must be an object' );
	const hardGateIds = Object.keys( record.hardGates );
	assert.ok( hardGateIds.length > 0, 'decision must freeze at least one hard gate' );
	for ( const [ gateId, gate ] of Object.entries( record.hardGates ) ) validateQuantity( gate, `decision.hardGates.${ gateId }` );
	assert.ok( Array.isArray( record.candidates ) && record.candidates.length >= 5, 'decision must compare at least five materially different candidates' );
	record.candidates.forEach( ( candidate, index ) => validateCandidate( candidate, axes, hardGateIds, index ) );
	assert.equal( record.candidates.length, new Set( record.candidates.map( ( candidate ) => candidate.candidateId ) ).size, 'decision candidate IDs are not unique' );
	assert.equal( record.candidates.length, new Set( record.candidates.map( ( candidate ) => candidate.algorithmFamily ) ).size, 'decision candidates are parameter variants rather than distinct algorithm families' );
	const weightSum = Object.values( record.frozenWeights ).reduce( ( sum, weight ) => sum + weight.value, 0 );
	const ranked = record.candidates.map( ( candidate ) => {

		const eligible = Object.values( candidate.hardGateResults ).every( ( result ) => result === 'pass' );
		const weightedScore = axes.reduce( ( sum, axis ) => sum + candidate.scores[ axis ] * record.frozenWeights[ axis ].value, 0 ) / weightSum;
		return { candidateId: candidate.candidateId, eligible, weightedScore, scores: structuredClone( candidate.scores ) };

	} ).sort( ( left, right ) => {

		if ( left.eligible !== right.eligible ) return left.eligible ? -1 : 1;
		if ( left.weightedScore !== right.weightedScore ) return right.weightedScore - left.weightedScore;
		for ( const axis of record.tieBreakOrder ) {

			if ( left.scores[ axis ] !== right.scores[ axis ] ) return right.scores[ axis ] - left.scores[ axis ];

		}
		return left.candidateId.localeCompare( right.candidateId );

	} );
	const winner = ranked.find( ( candidate ) => candidate.eligible );
	assert.ok( winner, 'decision has no hard-gate-eligible candidate' );
	assert.equal( record.selectedCandidateId, winner.candidateId, 'decision selected candidate is not the frozen top-ranked eligible solution' );
	assert.ok( record.status === 'provisional' || record.status === 'evidence-backed', 'decision.status is invalid' );
	if ( record.status === 'evidence-backed' ) {

		const selected = record.candidates.find( ( candidate ) => candidate.candidateId === record.selectedCandidateId );
		assert.ok( selected.evidence.some( ( entry ) => /measured|oracle|browser/i.test( entry ) ), 'evidence-backed decision lacks measured/oracle/Browser evidence' );

	}
	return Object.freeze( { problemId: record.problemId, winner: winner.candidateId, ranked: Object.freeze( ranked ) } );

}

export function numericEvidence( value, unit, label, source ) {

	return Object.freeze( { value, unit, label, source } );

}
