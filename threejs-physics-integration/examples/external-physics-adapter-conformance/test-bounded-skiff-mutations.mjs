import assert from 'node:assert/strict';
import {
	BOUNDED_SKIFF_ASSET,
	BOUNDED_SKIFF_CONFIG,
	advanceBoundedSkiffCoupling,
	initialCoupledSkiffState,
	validateBoundedSkiffAsset
} from './bounded-skiff-coupling.js';

const clone = ( value ) => structuredClone( value );
const rejects = ( label, callback, pattern ) => assert.throws( callback, pattern, `${ label } mutation survived` );

for ( const [ label, mutate, pattern ] of [
	[ 'open hull', ( asset ) => { asset.boundaryEdgeCount = 2; }, /boundary edges/ ],
	[ 'render mesh proxy', ( asset ) => { asset.geometry = 'render-mesh'; }, /closed volume/ ],
	[ 'negative mass', ( asset ) => { asset.massKg = -1; }, /positive/ ],
	[ 'indefinite inertia', ( asset ) => { asset.inertiaTensorBodyKgM2[ 1 ] = 0; }, /positive definite/ ],
	[ 'insufficient displacement', ( asset ) => { asset.closedVolumeM3 = 0.1; }, /cannot float/ ],
	[ 'surface-velocity drag', ( asset ) => { asset.dragModel = 'surface-point-velocity'; }, /material current/ ]
] ) {

	const asset = clone( BOUNDED_SKIFF_ASSET );
	mutate( asset );
	rejects( label, () => validateBoundedSkiffAsset( asset ), pattern );

}

rejects( 'half reaction', () => advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { reactionScale: -0.75 } ), /force reaction/ );
rejects( 'duplicate exact-once key', () => advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { forceDuplicateLedgerKey: true } ), /duplicate application-ledger/ );
rejects( 'stale water state', () => advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { waterStateVersionOverride: 'water-state-stale' } ), /stale or future/ );
rejects( 'unbounded correction drift', () => advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { config: { ...BOUNDED_SKIFF_CONFIG, boundedCorrectionIterations: 9 } } ), /bounded at two/ );
rejects( 'added-mass instability', () => advanceBoundedSkiffCoupling( initialCoupledSkiffState(), { config: { ...BOUNDED_SKIFF_CONFIG, maximumAddedMassRatio: 0.95 } } ), /added-mass ratio/ );

console.log( 'bounded skiff mutations passed: 11 rejection controls' );
