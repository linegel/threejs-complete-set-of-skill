import assert from 'node:assert/strict';
import { SWE_GPU_EXECUTION_DECISION, SWE_GPU_TIERS, deriveSweGpuContract, validateSweGpuContract } from './gpu-swe-contract.js';

assert.ok( SWE_GPU_EXECUTION_DECISION.candidates.length >= 5 );
assert.equal( new Set( SWE_GPU_EXECUTION_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SWE_GPU_EXECUTION_DECISION.candidates.length );

const summaries = [];
for ( const tierId of Object.keys( SWE_GPU_TIERS ) ) {

	const contract = deriveSweGpuContract( tierId );
	assert.equal( validateSweGpuContract( contract ), true );
	assert.ok( contract.tier.fixedTimeStepSeconds <= contract.stableTimeStepSeconds );
	assert.equal( contract.dispatchOrder.length, 8 );
	assert.equal( contract.resourceBytes.diagnostics, 64 );
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

console.log( `GPU SWE contract passed: 6 architectures, ${ summaries.map( ( entry ) => `${ entry.tierId }=${ entry.bytes }B@CFL${ entry.cflRatio.toFixed( 3 ) }` ).join( ', ' ) }, 4 rejection controls` );
