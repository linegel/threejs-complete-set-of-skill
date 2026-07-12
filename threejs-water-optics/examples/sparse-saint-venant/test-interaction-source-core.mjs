import assert from 'node:assert/strict';
import { SWE_INTERACTION_SCATTER_DECISION, applyPointImpulseBatchToSwe } from './interaction-source-core.js';

assert.ok( SWE_INTERACTION_SCATTER_DECISION.candidates.length >= 5 );
assert.equal( new Set( SWE_INTERACTION_SCATTER_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SWE_INTERACTION_SCATTER_DECISION.candidates.length );
assert.equal( SWE_INTERACTION_SCATTER_DECISION.selectedCandidateId, 'cic-discrete-adjoint' );
assert.equal( SWE_INTERACTION_SCATTER_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_INTERACTION_SCATTER_DECISION.selectedCandidateId ).hardGate, 'pass' );

const width = 7;
const height = 6;
const count = width * height;
const zero = () => new Float64Array( count );
const interaction = ( id, point, impulse ) => ( {
	interactionId: id,
	applicationLedgerKey: `ledger:${ id }`,
	applicationIntervalKey: 'coastal-clock:40..41',
	role: 'source',
	targetStateEquation: 'saint-venant-horizontal-momentum',
	payload: { tag: 'pointImpulse', timeSemantics: 'interval-integrated', linearImpulseNs: impulse, applicationPointMeters: point }
} );

const originalX = zero();
const originalZ = zero();
const applied = applyPointImpulseBatchToSwe( {
	xDischargeM2ps: originalX,
	zDischargeM2ps: originalZ,
	interactions: [
		interaction( 'bow-port', [ 2.8, 0, 3.2 ], [ 120, 0, -45 ] ),
		interaction( 'stern-starboard', [ 4.1, 0, 2.6 ], [ -25, 0, 18 ] )
	],
	width,
	height,
	cellSizeMeters: 1,
	waterDensityKgPerM3: 1025,
	balanceReferencePointMeters: [ 1, 0, 1 ]
} );
assert.ok( originalX.every( ( value ) => value === 0 ) && originalZ.every( ( value ) => value === 0 ), 'transaction mutated prior committed state' );
assert.ok( Math.abs( applied.diagnostics.appliedLinearImpulseNs[ 0 ] - 95 ) < 1e-12 );
assert.ok( Math.abs( applied.diagnostics.appliedLinearImpulseNs[ 2 ] + 27 ) < 1e-12 );
assert.ok( applied.diagnostics.linearResidualNs < 1e-12 );
assert.ok( applied.diagnostics.angularResidualNms < 1e-12 );
assert.equal( applied.diagnostics.massTransferKg, 0 );
assert.equal( applied.diagnostics.frameCriticalReadbackCount, 0 );
assert.ok( Math.abs( applied.reaction.linearImpulseNs[ 0 ] + 95 ) < 1e-12 );
assert.ok( Math.abs( applied.reaction.linearImpulseNs[ 2 ] - 27 ) < 1e-12 );
assert.equal( applied.applicationLedgerKeys.length, 2 );
assert.equal( applied.diagnostics.nonzeroScatterWrites, 8 );

assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ interaction( 'repeat', [ 2, 0, 2 ], [ 1, 0, 0 ] ) ],
	priorApplicationLedgerKeys: [ 'ledger:repeat' ], width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /duplicate exact-once/ );
assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ interaction( 'duplicate', [ 2, 0, 2 ], [ 1, 0, 0 ] ), interaction( 'duplicate', [ 2, 0, 2 ], [ 1, 0, 0 ] ) ],
	width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /duplicate exact-once/ );
assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ interaction( 'edge', [ 0.1, 0, 2 ], [ 1, 0, 0 ] ) ],
	width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /complete CIC/ );
const inactiveMask = new Uint8Array( count ).fill( 1 );
inactiveMask[ 2 * width + 2 ] = 0;
assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ interaction( 'inactive', [ 2.2, 0, 2.2 ], [ 1, 0, 0 ] ) ], receiverMask: inactiveMask,
	width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /inactive or non-receiving/ );
assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ interaction( 'vertical', [ 2, 0, 2 ], [ 0, 1, 0 ] ) ],
	width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /vertical point impulse/ );
const wrongPayload = interaction( 'rate', [ 2, 0, 2 ], [ 1, 0, 0 ] );
wrongPayload.payload.timeSemantics = 'rate';
assert.throws( () => applyPointImpulseBatchToSwe( {
	xDischargeM2ps: zero(), zDischargeM2ps: zero(), interactions: [ wrongPayload ],
	width, height, cellSizeMeters: 1, waterDensityKgPerM3: 1025
} ), /interval-integrated/ );

console.log( `SWE interaction scatter passed: ${ SWE_INTERACTION_SCATTER_DECISION.candidates.length } architectures, 2 impulses, ${ applied.diagnostics.nonzeroScatterWrites } writes, exact linear/angular closure, 6 rejection controls` );
