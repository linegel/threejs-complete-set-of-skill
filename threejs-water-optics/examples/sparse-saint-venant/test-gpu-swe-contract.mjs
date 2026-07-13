import assert from 'node:assert/strict';
import { SWE_GPU_EXECUTION_DECISION, SWE_GPU_TIERS, SWE_INTERACTION_BINDING_DECISION, SWE_INTERACTION_GPU_DECISION, SWE_OBSTACLE_GPU_DECISION, SWE_RECEIVER_GPU_DECISION, deriveSweGpuContract, validateSweGpuContract } from './gpu-swe-contract.js';

assert.ok( SWE_GPU_EXECUTION_DECISION.candidates.length >= 5 );
assert.equal( new Set( SWE_GPU_EXECUTION_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SWE_GPU_EXECUTION_DECISION.candidates.length );
assert.ok( SWE_INTERACTION_GPU_DECISION.candidates.length >= 5 );
assert.equal( new Set( SWE_INTERACTION_GPU_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SWE_INTERACTION_GPU_DECISION.candidates.length );
assert.equal( SWE_INTERACTION_GPU_DECISION.selectedCandidateId, 'prepared-field-cell-gather' );
assert.equal( SWE_INTERACTION_BINDING_DECISION.candidates.length, 5 );
assert.equal( SWE_INTERACTION_BINDING_DECISION.selectedCandidateId, 'face-reserved-channel-pack' );
assert.equal( SWE_RECEIVER_GPU_DECISION.candidates.length, 6 );
assert.equal( SWE_RECEIVER_GPU_DECISION.selectedCandidateId, 'water-cell-aligned-buffer-owner' );
assert.equal( SWE_OBSTACLE_GPU_DECISION.candidates.length, 6 );
assert.equal( SWE_OBSTACLE_GPU_DECISION.selectedCandidateId, 'fused-local-source-pass' );

const summaries = [];
for ( const tierId of Object.keys( SWE_GPU_TIERS ) ) {

	const contract = deriveSweGpuContract( tierId );
	assert.equal( validateSweGpuContract( contract ), true );
	assert.ok( contract.tier.fixedTimeStepSeconds <= contract.stableTimeStepSeconds );
	assert.equal( contract.dispatchOrder.length, 9 );
	assert.equal( contract.resourceBytes.diagnostics, 168 );
	assert.equal( contract.resourceBytes.interactionSource, contract.stateRecords * 8 );
	assert.equal( contract.resourceBytes.receiverLiquidPingPong, contract.stateRecords * 8 );
	assert.equal( contract.resourceBytes.inundationTransfer, contract.stateRecords * 4 );
	assert.equal( contract.resourceBytes.obstacle, contract.stateRecords * 16 );
	assert.equal( Math.max( ...Object.values( contract.storageBindingsPerStage ) ), 8 );
	summaries.push( { tierId, bytes: contract.totalLogicalBytes, cflRatio: contract.cflRatio } );

}

const mutatedCfl = structuredClone( deriveSweGpuContract( 'budgeted' ) );
mutatedCfl.tier.fixedTimeStepSeconds = mutatedCfl.stableTimeStepSeconds * 1.01;
assert.throws( () => validateSweGpuContract( mutatedCfl ), /CFL/ );
const mutatedOrder = structuredClone( deriveSweGpuContract( 'budgeted' ) );
mutatedOrder.dispatchOrder.reverse();
assert.throws( () => validateSweGpuContract( mutatedOrder ), /order/ );
const mutatedBytes = structuredClone( deriveSweGpuContract( 'budgeted' ) );
mutatedBytes.resourceBytes.statePingPong += 16;
assert.throws( () => validateSweGpuContract( mutatedBytes ), /byte/ );
const mutatedFaces = structuredClone( deriveSweGpuContract( 'budgeted' ) );
mutatedFaces.xFaceRecords -= 1;
assert.throws( () => validateSweGpuContract( mutatedFaces ), /face/ );
const mutatedBindings = structuredClone( deriveSweGpuContract( 'budgeted' ) );
mutatedBindings.storageBindingsPerStage.cellUpdate = 9;
assert.throws( () => validateSweGpuContract( mutatedBindings ), /binding limit/ );

console.log( `GPU SWE contract passed: 6 solver + ${ SWE_INTERACTION_GPU_DECISION.candidates.length } interaction + ${ SWE_INTERACTION_BINDING_DECISION.candidates.length } binding + ${ SWE_RECEIVER_GPU_DECISION.candidates.length } receiver + ${ SWE_OBSTACLE_GPU_DECISION.candidates.length } obstacle architectures, ${ summaries.map( ( entry ) => `${ entry.tierId }=${ entry.bytes }B@CFL${ entry.cflRatio.toFixed( 3 ) }` ).join( ', ' ) }, 5 rejection controls` );
