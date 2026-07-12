import assert from 'node:assert/strict';
import { COASTAL_FOAM_DECISION, advanceFoamCoverage, exactFoamReaction } from './foam-core.js';

assert.ok( COASTAL_FOAM_DECISION.candidates.length >= 5 );
assert.equal( new Set( COASTAL_FOAM_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, COASTAL_FOAM_DECISION.candidates.length );
assert.equal( COASTAL_FOAM_DECISION.selectedCandidateId, 'conservative-eulerian-coverage' );
assert.equal( COASTAL_FOAM_DECISION.candidates.find( ( candidate ) => candidate.id === COASTAL_FOAM_DECISION.selectedCandidateId ).hardGate, 'pass' );

const source = 1.7;
const decay = 0.4;
const dt = 0.23;
const initial = 0.31;
const rate = source + decay;
const expected = source / rate + ( initial - source / rate ) * Math.exp( -rate * dt );
assert.ok( Math.abs( exactFoamReaction( initial, source, decay, dt ) - expected ) < 1e-14 );
assert.ok( Math.abs( exactFoamReaction( initial, 0, decay, dt ) - initial * Math.exp( -decay * dt ) ) < 1e-14 );
assert.equal( exactFoamReaction( initial, 0, 0, dt ), initial );

const width = 8;
const height = 6;
const count = width * height;
const coverage = new Float64Array( count );
coverage[ 2 * width + 3 ] = 0.75;
const zero = new Float64Array( count );
const velocityX = new Float64Array( count ).fill( 1 );
const translated = advanceFoamCoverage( {
	coverage, sourceRatePerSecond: zero, velocityXMps: velocityX, velocityZMps: zero,
	width, height, cellSizeMeters: 1, dtSeconds: 1, decayRatePerSecond: 0,
	boundary: 'periodic'
} );
assert.ok( Math.abs( translated.coverage[ 2 * width + 4 ] - 0.75 ) < 1e-14 );
assert.ok( Math.abs( translated.diagnostics.transportResidual ) < 1e-14 );
assert.equal( translated.diagnostics.maximumUnsplitCfl, 1 );
assert.equal( translated.diagnostics.clampCount, 0 );

const reacting = advanceFoamCoverage( {
	coverage: new Float64Array( count ).fill( 0.2 ),
	sourceRatePerSecond: new Float64Array( count ).fill( 0.8 ),
	velocityXMps: zero, velocityZMps: zero,
	width, height, cellSizeMeters: 0.5, dtSeconds: 0.1, decayRatePerSecond: 0.3,
	diffusionM2ps: 0.02, boundary: 'closed'
} );
assert.ok( reacting.coverage.every( ( value ) => value >= 0 && value <= 1 ) );
assert.ok( Math.abs( reacting.diagnostics.transportResidual ) < 1e-12 );
assert.ok( reacting.diagnostics.sourceGain > 0 );
assert.ok( reacting.diagnostics.decayLoss > 0 );

assert.throws( () => exactFoamReaction( -0.1, 0, 0, 1 ), /physical domain/ );
assert.throws( () => advanceFoamCoverage( { coverage, sourceRatePerSecond: zero, velocityXMps: new Float64Array( count ).fill( 2 ), velocityZMps: zero, width, height, cellSizeMeters: 1, dtSeconds: 1, decayRatePerSecond: 0 } ), /CFL/ );
assert.throws( () => advanceFoamCoverage( { coverage, sourceRatePerSecond: zero, velocityXMps: zero, velocityZMps: zero, width, height, cellSizeMeters: 1, dtSeconds: 1, decayRatePerSecond: 0, diffusionM2ps: 0.3 } ), /diffusion/ );
const negativeSource = new Float64Array( count );
negativeSource[ 0 ] = -1;
assert.throws( () => advanceFoamCoverage( { coverage, sourceRatePerSecond: negativeSource, velocityXMps: zero, velocityZMps: zero, width, height, cellSizeMeters: 1, dtSeconds: 0.1, decayRatePerSecond: 0 } ), /nonnegative/ );

console.log( `foam oracle passed: ${ COASTAL_FOAM_DECISION.candidates.length } representations, exact reaction, periodic one-cell transport, ${ reacting.diagnostics.sourceGain.toFixed( 6 ) } source gain, 4 rejection controls` );
