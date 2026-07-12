export const SWE_INTERACTION_SCATTER_DECISION = Object.freeze( {
	problemId: 'moving-body-momentum-to-cell-centred-swe',
	axes: Object.freeze( [ 'impulseClosure', 'firstMomentClosure', 'boundedWeights', 'sparseMobileCost', 'resolvedBoundaryTruth', 'gpuPortability' ] ),
	selectedCandidateId: 'cic-discrete-adjoint',
	candidates: Object.freeze( [
		Object.freeze( { id: 'visual-wake-ribbon', family: 'render-only trail or foam ribbon', scores: [ 0, 0, 5, 5, 0, 5 ], pros: 'minimal render cost', cons: 'no water momentum or reaction', hardGate: 'fail:no-physical-source' } ),
		Object.freeze( { id: 'nearest-cell-impulse', family: 'nearest-cell conservative impulse injection', scores: [ 5, 1, 5, 5, 1, 5 ], pros: 'one write and exact total impulse', cons: 'grid-snapped torque and visible directional jitter', hardGate: 'fail:first-moment-closure' } ),
		Object.freeze( { id: 'renormalized-radial-kernel', family: 'truncated radial kernel with local renormalization', scores: [ 5, 2, 4, 3, 2, 4 ], pros: 'smooth wide footprint', cons: 'boundary truncation moves the application centroid', hardGate: 'fail:first-moment-after-truncation' } ),
		Object.freeze( { id: 'brinkman-penalization', family: 'immersed-boundary Brinkman velocity penalization', scores: [ 4, 4, 4, 3, 4, 4 ], pros: 'handles moving sub-cell solids and porous drag', cons: 'stiff source integration and calibration are unnecessary for point quadrature', hardGate: 'pass:resolved-obstacle-candidate' } ),
		Object.freeze( { id: 'moving-cut-cell', family: 'moving cut-cell geometric conservation law', scores: [ 5, 5, 5, 1, 5, 2 ], pros: 'strongest resolved boundary and displaced-volume truth', cons: 'topology, small-cell stability, and rebuild cost exceed this bounded scatter problem', hardGate: 'pass:resolved-obstacle-candidate' } ),
		Object.freeze( { id: 'cic-discrete-adjoint', family: 'cell-in-cloud gather/scatter adjoint per hull quadrature point', scores: [ 5, 5, 5, 5, 3, 5 ], pros: 'four cells, nonnegative weights, exact zeroth and first moments', cons: 'requires a complete active stencil and does not replace a resolved solid boundary', hardGate: 'pass' } )
	] )
} );

const MOMENT_TOLERANCE = 1e-10;

function requireFinite( value, label ) {

	if ( ! Number.isFinite( value ) ) throw new Error( `${ label } must be finite` );
	return value;

}

function requireVector3( value, label ) {

	if ( ! Array.isArray( value ) || value.length !== 3 || value.some( ( component ) => ! Number.isFinite( component ) ) ) throw new Error( `${ label } must be a finite Vec3` );
	return value;

}

function requireStateArray( value, count, label ) {

	if ( ! ( value instanceof Float64Array ) || value.length !== count ) throw new Error( `${ label } must be a Float64Array(${ count })` );
	for ( let index = 0; index < count; index += 1 ) if ( ! Number.isFinite( value[ index ] ) ) throw new Error( `${ label } contains a non-finite value` );
	return value;

}

function createCicStencil( point, grid ) {

	const cellX = ( point[ 0 ] - grid.originXMeters ) / grid.cellSizeMeters - 0.5;
	const cellZ = ( point[ 2 ] - grid.originZMeters ) / grid.cellSizeMeters - 0.5;
	const west = Math.floor( cellX );
	const south = Math.floor( cellZ );
	const fractionX = cellX - west;
	const fractionZ = cellZ - south;
	if ( west < 0 || west + 1 >= grid.width || south < 0 || south + 1 >= grid.height ) throw new Error( 'interaction footprint lacks a complete CIC receiver stencil; activate halo cells or select a boundary-aware obstacle route' );
	const entries = [
		{ x: west, z: south, weight: ( 1 - fractionX ) * ( 1 - fractionZ ) },
		{ x: west + 1, z: south, weight: fractionX * ( 1 - fractionZ ) },
		{ x: west, z: south + 1, weight: ( 1 - fractionX ) * fractionZ },
		{ x: west + 1, z: south + 1, weight: fractionX * fractionZ }
	];
	for ( const entry of entries ) {

		entry.index = entry.z * grid.width + entry.x;
		entry.centerXMeters = grid.originXMeters + ( entry.x + 0.5 ) * grid.cellSizeMeters;
		entry.centerZMeters = grid.originZMeters + ( entry.z + 0.5 ) * grid.cellSizeMeters;
		if ( entry.weight > 0 && grid.receiverMask[ entry.index ] !== 1 ) throw new Error( 'interaction CIC stencil contains an inactive or non-receiving cell; silent renormalization would move force and torque' );

	}
	return entries;

}

function validateInteraction( interaction, knownKeys, batchKeys, grid ) {

	if ( interaction?.role !== 'source' ) throw new Error( 'SWE interaction scatter accepts source records only' );
	if ( interaction.targetStateEquation !== 'saint-venant-horizontal-momentum' ) throw new Error( 'interaction targets the wrong SWE state equation' );
	if ( typeof interaction.interactionId !== 'string' || interaction.interactionId.length === 0 ) throw new Error( 'interactionId must be non-empty' );
	if ( typeof interaction.applicationLedgerKey !== 'string' || interaction.applicationLedgerKey.length === 0 ) throw new Error( 'applicationLedgerKey must be non-empty' );
	if ( knownKeys.has( interaction.applicationLedgerKey ) || batchKeys.has( interaction.applicationLedgerKey ) ) throw new Error( `duplicate exact-once interaction '${ interaction.applicationLedgerKey }'` );
	batchKeys.add( interaction.applicationLedgerKey );
	if ( typeof interaction.applicationIntervalKey !== 'string' || interaction.applicationIntervalKey.length === 0 ) throw new Error( 'interaction requires one canonical application interval identity' );
	const payload = interaction.payload;
	if ( payload?.tag !== 'pointImpulse' || payload.timeSemantics !== 'interval-integrated' ) throw new Error( 'SWE CIC scatter requires an interval-integrated pointImpulse payload' );
	const impulse = requireVector3( payload.linearImpulseNs, 'linearImpulseNs' );
	const point = requireVector3( payload.applicationPointMeters, 'applicationPointMeters' );
	if ( Math.abs( impulse[ 1 ] ) > MOMENT_TOLERANCE ) throw new Error( 'depth-averaged horizontal SWE cannot consume vertical point impulse' );
	return Object.freeze( { interaction, impulse, point, stencil: Object.freeze( createCicStencil( point, grid ).map( Object.freeze ) ) } );

}

function yMoment( pointX, pointZ, impulseX, impulseZ, referencePoint ) {

	return ( pointZ - referencePoint[ 2 ] ) * impulseX - ( pointX - referencePoint[ 0 ] ) * impulseZ;

}

export function applyPointImpulseBatchToSwe( {
	xDischargeM2ps,
	zDischargeM2ps,
	interactions,
	priorApplicationLedgerKeys = [],
	width,
	height,
	cellSizeMeters,
	originXMeters = 0,
	originZMeters = 0,
	waterDensityKgPerM3,
	receiverMask = new Uint8Array( width * height ).fill( 1 ),
	balanceReferencePointMeters = [ 0, 0, 0 ]
} ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 2 || height < 2 ) throw new Error( 'SWE interaction grid dimensions must be integers >= 2' );
	const count = width * height;
	requireStateArray( xDischargeM2ps, count, 'xDischargeM2ps' );
	requireStateArray( zDischargeM2ps, count, 'zDischargeM2ps' );
	if ( ! ( receiverMask instanceof Uint8Array ) || receiverMask.length !== count ) throw new Error( `receiverMask must be a Uint8Array(${ count })` );
	if ( ! Array.isArray( interactions ) ) throw new Error( 'interactions must be an array' );
	if ( ! Array.isArray( priorApplicationLedgerKeys ) || priorApplicationLedgerKeys.some( ( key ) => typeof key !== 'string' ) ) throw new Error( 'priorApplicationLedgerKeys must be a string array' );
	if ( new Set( priorApplicationLedgerKeys ).size !== priorApplicationLedgerKeys.length ) throw new Error( 'prior application ledger already contains duplicate keys' );
	const density = requireFinite( waterDensityKgPerM3, 'waterDensityKgPerM3' );
	const dx = requireFinite( cellSizeMeters, 'cellSizeMeters' );
	const originX = requireFinite( originXMeters, 'originXMeters' );
	const originZ = requireFinite( originZMeters, 'originZMeters' );
	if ( density <= 0 || dx <= 0 ) throw new Error( 'water density and cell size must be positive' );
	const referencePoint = requireVector3( balanceReferencePointMeters, 'balanceReferencePointMeters' );
	const grid = { width, height, cellSizeMeters: dx, originXMeters: originX, originZMeters: originZ, receiverMask };
	const knownKeys = new Set( priorApplicationLedgerKeys );
	const batchKeys = new Set();
	// Validate the closed batch before copying or mutating candidate state.
	const prepared = interactions.map( ( interaction ) => validateInteraction( interaction, knownKeys, batchKeys, grid ) );
	const nextX = xDischargeM2ps.slice();
	const nextZ = zDischargeM2ps.slice();
	const cellAreaM2 = dx * dx;
	let expectedImpulseX = 0;
	let expectedImpulseZ = 0;
	let expectedAngularImpulseY = 0;
	let appliedImpulseX = 0;
	let appliedImpulseZ = 0;
	let appliedAngularImpulseY = 0;
	let nonzeroScatterWrites = 0;
	for ( const { impulse, point, stencil } of prepared ) {

		expectedImpulseX += impulse[ 0 ];
		expectedImpulseZ += impulse[ 2 ];
		expectedAngularImpulseY += yMoment( point[ 0 ], point[ 2 ], impulse[ 0 ], impulse[ 2 ], referencePoint );
		for ( const entry of stencil ) {

			if ( entry.weight === 0 ) continue;
			const cellImpulseX = impulse[ 0 ] * entry.weight;
			const cellImpulseZ = impulse[ 2 ] * entry.weight;
			nextX[ entry.index ] += cellImpulseX / ( density * cellAreaM2 );
			nextZ[ entry.index ] += cellImpulseZ / ( density * cellAreaM2 );
			appliedImpulseX += cellImpulseX;
			appliedImpulseZ += cellImpulseZ;
			appliedAngularImpulseY += yMoment( entry.centerXMeters, entry.centerZMeters, cellImpulseX, cellImpulseZ, referencePoint );
			nonzeroScatterWrites += 1;

		}

	}
	const linearResidualNs = Math.hypot( appliedImpulseX - expectedImpulseX, appliedImpulseZ - expectedImpulseZ );
	const angularResidualNms = Math.abs( appliedAngularImpulseY - expectedAngularImpulseY );
	const scale = Math.max( 1, Math.hypot( expectedImpulseX, expectedImpulseZ ), Math.abs( expectedAngularImpulseY ) );
	if ( linearResidualNs > MOMENT_TOLERANCE * scale || angularResidualNms > MOMENT_TOLERANCE * scale ) throw new Error( 'CIC scatter failed its impulse or first-moment closure gate' );
	const acceptedKeys = [ ...priorApplicationLedgerKeys, ...prepared.map( ( item ) => item.interaction.applicationLedgerKey ) ];
	return Object.freeze( {
		xDischargeM2ps: nextX,
		zDischargeM2ps: nextZ,
		applicationLedgerKeys: Object.freeze( acceptedKeys ),
		reaction: Object.freeze( {
			linearImpulseNs: Object.freeze( [ -appliedImpulseX, 0, -appliedImpulseZ ] ),
			angularImpulseNms: Object.freeze( [ 0, -appliedAngularImpulseY, 0 ] ),
			timeSemantics: 'interval-integrated',
			acceptance: 'all-or-none-with-water-candidate'
		} ),
		diagnostics: Object.freeze( {
			interactionCount: prepared.length,
			nonzeroScatterWrites,
			cellAreaM2,
			appliedLinearImpulseNs: Object.freeze( [ appliedImpulseX, 0, appliedImpulseZ ] ),
			appliedAngularImpulseNms: Object.freeze( [ 0, appliedAngularImpulseY, 0 ] ),
			linearResidualNs,
			angularResidualNms,
			massTransferKg: 0,
			frameCriticalReadbackCount: 0
		} )
	} );

}
