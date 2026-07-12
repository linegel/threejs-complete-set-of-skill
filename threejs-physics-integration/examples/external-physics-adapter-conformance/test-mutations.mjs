import assert from 'node:assert/strict';
import { scorePhysicsDecision } from './decision-record.js';
import { validateExternalSolverAdapterBoundary } from './external-adapter-contract.js';
import { decisionFixtures, externalAdapterCostFixture, externalAdapterFixture } from './fixtures.js';

const clone = ( value ) => structuredClone( value );

function rejects( fn, pattern, label ) {

	assert.throws( fn, pattern, label );

}

const decisionMutations = {
	fewerThanFiveCandidates: ( value ) => value.candidates.splice( 0, value.candidates.length - 4 ),
	missingScoreAxis: ( value ) => delete value.candidates[ 0 ].scores.recovery,
	postHocWinner: ( value ) => { value.selectedCandidateId = value.candidates.at( -1 ).candidateId; },
	unknownWeightLabel: ( value ) => { value.frozenWeights.truthFidelity.label = 'Estimated'; },
	parameterVariants: ( value ) => { value.candidates[ 1 ].algorithmFamily = value.candidates[ 0 ].algorithmFamily; },
	missingHardGate: ( value ) => delete value.candidates[ 0 ].hardGateResults.truthError
};

for ( const [ name, mutate ] of Object.entries( decisionMutations ) ) {

	const value = clone( decisionFixtures[ 0 ] );
	mutate( value );
	rejects( () => scorePhysicsDecision( value ), /candidate|axis|selected|label|algorithm|gate|fields|scores/i, `decision mutation ${ name } survived` );

}

const adapterMutations = {
	implicitOwnership: ( adapter ) => { adapter.ownership.stepping = 'implicit-engine-default'; },
	wrongUnitSystem: ( adapter ) => { adapter.unitConversion.destinationUnitSystemId = 'engine-units'; },
	missingForceMap: ( adapter ) => { delete adapter.unitConversion.perQuantityAffineOrLinearMaps.force; },
	improperFrame: ( adapter ) => { adapter.unitConversion.handednessAndAxialConvention.properRotation = false; },
	missingClockRevision: ( adapter ) => { delete adapter.clockMapping.mappingRevision; },
	missingSupportedFrame: ( adapter ) => { adapter.supportedFramesCharts = [ 'other-frame' ]; },
	ambiguousCapability: ( adapter ) => { adapter.interactionCapabilities.push( { ...clone( adapter.interactionCapabilities[ 0 ] ), capabilityId: 'duplicate-wrench-ingress' } ); },
	missingExactOnce: ( adapter ) => { adapter.interactionCapabilities[ 0 ].exactOnceSupport = 'unsupported'; },
	duplicateApplicationLedger: ( adapter ) => { adapter.stepReceipts[ 0 ].inputApplicationLedgerIds.push( adapter.stepReceipts[ 0 ].inputApplicationLedgerIds[ 0 ] ); },
	halfCommit: ( adapter ) => { adapter.stepReceipts[ 0 ].outputPreparedVersions = []; },
	missingDependencyCompletion: ( adapter ) => { adapter.stepReceipts[ 0 ].dependencyCompletionRefs = []; },
	conflictingAuthority: ( adapter ) => { adapter.residencySynchronization.authorityBySignalOrStateEquation[ 'rigid-body-state' ] = 'route-owner'; },
	falseHostVisibility: ( adapter ) => { adapter.residencySynchronization.hostVisibilityProof = 'submission-promise'; },
	incompleteCheckpoint: ( adapter ) => { delete adapter.checkpointRollback.includedStateVersionsInventoriesAndCursors; },
	degradedPublication: ( adapter ) => { adapter.failurePolicy.degradedPublication = 'best-effort'; }
};

for ( const [ name, mutate ] of Object.entries( adapterMutations ) ) {

	const adapter = clone( externalAdapterFixture );
	mutate( adapter );
	rejects( () => validateExternalSolverAdapterBoundary( adapter, clone( externalAdapterCostFixture ) ), /owner|unit|map|rotation|clock|frame|capabil|exact|ledger|prepare|dependency|authority|visibility|checkpoint|degraded|state equation/i, `adapter mutation ${ name } survived` );

}

const missingCost = clone( externalAdapterCostFixture );
delete missingCost.segments.atomicCommit;
rejects( () => validateExternalSolverAdapterBoundary( clone( externalAdapterFixture ), missingCost ), /cost omits atomicCommit/i, 'external-tail omission survived' );

const wrongCostOwner = clone( externalAdapterCostFixture );
wrongCostOwner.adapterId = 'another-adapter';
rejects( () => validateExternalSolverAdapterBoundary( clone( externalAdapterFixture ), wrongCostOwner ), /another adapter/i, 'external-cost ownership mutation survived' );

console.log( `physics integration mutations passed: ${ Object.keys( decisionMutations ).length + Object.keys( adapterMutations ).length + 2 } rejection controls` );
