import assert from 'node:assert/strict';
import { SWE_SOLVER_DECISION, advanceSwe, cellIndex, computeStableSweDt, createSweState, maximumFreeSurfaceResidual, setFreeSurface, totalWaterVolume } from './swe-core.js';

assert.ok( SWE_SOLVER_DECISION.candidates.length >= 5 );
assert.equal( new Set( SWE_SOLVER_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SWE_SOLVER_DECISION.candidates.length );
assert.equal( SWE_SOLVER_DECISION.selectedCandidateId, 'hll-hydrostatic-reconstruction' );
assert.equal( SWE_SOLVER_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_SOLVER_DECISION.selectedCandidateId ).hardGate, 'pass' );

const nx = 24;
const nz = 12;
const bed = new Float64Array( nx * nz );
for ( let z = 0; z < nz; z += 1 ) for ( let x = 0; x < nx; x += 1 ) bed[ z * nx + x ] = 0.04 * Math.sin( x * 0.31 ) + 0.025 * Math.cos( z * 0.47 );
const lake = createSweState( { nx, nz, dx: 0.25, dz: 0.25, bed } );
setFreeSurface( lake, 0.5 );
const lakeVolume = totalWaterVolume( lake );
for ( let step = 0; step < 10000; step += 1 ) advanceSwe( lake, Math.min( 0.002, computeStableSweDt( lake ) ) );
assert.ok( maximumFreeSurfaceResidual( lake, 0.5 ) <= 2e-12, `lake-at-rest surface drifted ${ maximumFreeSurfaceResidual( lake, 0.5 ) } m` );
assert.ok( Math.max( ...lake.mx.map( Math.abs ), ...lake.mz.map( Math.abs ) ) <= 2e-12, 'lake-at-rest generated momentum' );
assert.ok( Math.abs( totalWaterVolume( lake ) - lakeVolume ) / lakeVolume <= 1e-12, 'lake-at-rest lost mass' );

const dam = createSweState( { nx: 48, nz: 8, dx: 0.1, dz: 0.1 } );
for ( let z = 0; z < dam.nz; z += 1 ) for ( let x = 0; x < dam.nx; x += 1 ) dam.h[ cellIndex( dam, x, z ) ] = x < 18 ? 0.35 : 0;
const damVolume = totalWaterVolume( dam );
for ( let step = 0; step < 240; step += 1 ) advanceSwe( dam, Math.min( 0.001, computeStableSweDt( dam ) ) );
assert.ok( Math.min( ...dam.h ) >= 0, 'wet/dry dam break produced negative depth' );
assert.ok( dam.h[ cellIndex( dam, 24, 4 ) ] > 0, 'wet/dry front did not advance' );
assert.ok( Math.abs( totalWaterVolume( dam ) - damVolume ) / damVolume <= 2e-10, 'closed dam-break domain lost mass' );

for ( const mutation of [
	() => createSweState( { nx: 2, nz: 4, dx: 1, dz: 1 } ),
	() => createSweState( { nx: 4, nz: 4, dx: 0, dz: 1 } ),
	() => advanceSwe( lake, Number.NaN ),
	() => advanceSwe( lake, computeStableSweDt( lake ) * 1.1 )
] ) assert.throws( mutation );

console.log( `sparse Saint-Venant core passed: 6 solver families, 10000-step lake, 240-step wet/dry dam break, volume ${ damVolume.toFixed( 6 ) } m3, 4 rejection controls` );
