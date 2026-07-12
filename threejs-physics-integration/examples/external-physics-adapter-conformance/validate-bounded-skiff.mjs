import assert from 'node:assert/strict';
import {
	BOUNDED_SKIFF_ASSET,
	BOUNDED_SKIFF_CONFIG,
	BOUNDED_SKIFF_DECISION,
	advanceBoundedSkiffCoupling,
	boundedSkiffStateHash,
	createAnalyticWaterProvider,
	createNinePointHullQuadrature,
	initialCoupledSkiffState,
	replayBoundedSkiff,
	validateBoundedSkiffAsset
} from './bounded-skiff-coupling.js';

validateBoundedSkiffAsset();
assert.equal( BOUNDED_SKIFF_DECISION.candidates.length, 6, 'dynamic-skiff decision must retain at least five distinct algorithm families' );
assert.equal( new Set( BOUNDED_SKIFF_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, 6, 'dynamic-skiff candidates are not materially distinct' );
assert.equal( BOUNDED_SKIFF_DECISION.selectedCandidateId, 'gpu-bounded-rigid-water', 'dynamic-skiff top choice drifted' );
assert.ok( Math.abs( createNinePointHullQuadrature().reduce( ( sum, point ) => sum + point.volumeWeightM3, 0 ) - BOUNDED_SKIFF_ASSET.closedVolumeM3 ) <= 1e-12, 'quadrature volume does not close' );

const stillProvider = createAnalyticWaterProvider( { amplitudeMeters: 0, currentVelocityMps: [ 0, 0, 0 ] } );
const equilibrium = advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { provider: stillProvider } );
assert.ok( Math.abs( equilibrium.body.linearVelocityMps[ 1 ] ) < 1e-12, `hydrostatic equilibrium accelerated by ${ equilibrium.body.linearVelocityMps[ 1 ] } m/s` );
assert.ok( equilibrium.lastCommit.forceResidualNewtonSeconds <= BOUNDED_SKIFF_CONFIG.forceResidualGateNewtonSeconds, 'force/reaction residual gate failed' );
assert.ok( equilibrium.lastCommit.torqueResidualNewtonMetreSeconds <= BOUNDED_SKIFF_CONFIG.torqueResidualGateNewtonMetreSeconds, 'torque/reaction residual gate failed' );
assert.equal( equilibrium.lastCommit.frameCriticalReadbackCount, 0, 'bounded coupling introduced frame-critical readback' );

const animated = replayBoundedSkiff( 180 );
assert.ok( Math.abs( animated.body.positionMeters[ 1 ] - initialCoupledSkiffState().body.positionMeters[ 1 ] ) > 1e-4, 'dynamic skiff did not visibly animate' );
assert.ok( Math.abs( animated.body.rollRadians ) > 1e-5 || Math.abs( animated.body.pitchRadians ) > 1e-5, 'distributed buoyancy did not produce angular response' );
assert.notEqual( animated.water.feedbackHeightMeters, 0, 'body reaction did not affect water state' );
assert.equal( boundedSkiffStateHash( replayBoundedSkiff( 180 ) ), boundedSkiffStateHash( animated ), 'fixed-step skiff replay is nondeterministic' );
assert.equal( animated.applicationLedgerKeys.length, 360, 'source/reaction exact-once ledger does not close over every tick' );

console.log( `bounded skiff oracle passed: 6 architectures, 9 hull samples, ${ animated.tick } coupled ticks, hash ${ boundedSkiffStateHash( animated ) }` );
