import assert from 'node:assert/strict';
import { scorePhysicsDecision } from './decision-record.js';
import { validateExternalSolverAdapterBoundary } from './external-adapter-contract.js';
import { decisionFixtures, externalAdapterCostFixture, externalAdapterFixture } from './fixtures.js';

assert.equal( decisionFixtures.length, 5, 'fixture set must cover five distinct decision problems' );
const winners = decisionFixtures.map( ( fixture ) => scorePhysicsDecision( structuredClone( fixture ) ).winner );
assert.deepEqual( winners, [
	'analytic-query-provider',
	'authored-kinematic',
	'gpu-specialist',
	'external-engine',
	'offline-recorded'
] );
validateExternalSolverAdapterBoundary( structuredClone( externalAdapterFixture ), structuredClone( externalAdapterCostFixture ) );

console.log( `physics integration conformance passed: ${ decisionFixtures.length } decisions, ${ decisionFixtures.reduce( ( sum, fixture ) => sum + fixture.candidates.length, 0 ) } scored candidates, 1 external adapter boundary` );
