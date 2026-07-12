import { StorageBufferAttribute } from 'three/webgpu';
import {
	Fn,
	If,
	abs,
	atomicAdd,
	atomicLoad,
	atomicSub,
	float,
	globalId,
	int,
	max,
	min,
	select,
	sqrt,
	storage,
	uint,
	vec2,
	vec3,
	vec4
} from 'three/tsl';
import { deriveSweGpuContract, validateSweGpuContract } from './gpu-swe-contract.js';

const MASS_QUANTA_PER_METER = 100000;
const DRY_TOLERANCE_METERS = 1e-5;
const NEGATIVE_DEPTH_GATE_METERS = -1e-6;
const FINITE_MAGNITUDE_GATE = 1e4;

function paddedStateIndexNumber( contract, slot, localX, localZ ) {

	return slot * contract.paddedSize * contract.paddedSize + localZ * contract.paddedSize + localX;

}

export function buildGpuSweInitialData( preparedCommit, contract, initialCondition ) {

	validateSweGpuContract( contract );
	if ( ! preparedCommit || ! Array.isArray( preparedCommit.descriptors ) ) throw new Error( 'GPU SWE initialization requires a prepared sparse tile commit' );
	if ( preparedCommit.descriptors.length > contract.tier.capacityTiles ) throw new Error( 'GPU SWE sparse descriptors exceed tier capacity' );
	if ( typeof initialCondition !== 'function' ) throw new Error( 'GPU SWE initialization requires an explicit initial-condition function' );
	const descriptorArray = new Int32Array( contract.tier.capacityTiles * 4 );
	for ( let slot = 0; slot < contract.tier.capacityTiles; slot += 1 ) descriptorArray[ slot * 4 + 3 ] = -1;
	const lookupArray = new Int32Array( contract.tier.logicalTilesX * contract.tier.logicalTilesZ ).fill( -1 );
	const stateArray = new Float32Array( contract.stateRecords * 4 );
	const displayIndexArray = new Uint32Array( contract.tier.capacityTiles * contract.tier.tileSize * contract.tier.tileSize );
	const displayCells = [];
	let maximumDepthMeters = 0;
	let maximumVelocityMps = 0;
	for ( const descriptor of preparedCommit.descriptors ) {

		const slot = descriptor.atlasSlot;
		if ( ! Number.isInteger( slot ) || slot < 0 || slot >= contract.tier.capacityTiles ) throw new Error( 'GPU SWE descriptor has an invalid atlas slot' );
		if ( descriptor.tileX < 0 || descriptor.tileX >= contract.tier.logicalTilesX || descriptor.tileZ < 0 || descriptor.tileZ >= contract.tier.logicalTilesZ ) throw new Error( 'GPU SWE descriptor lies outside the logical lookup domain' );
		descriptorArray.set( [ descriptor.tileX, descriptor.tileZ, descriptor.role === 'core' ? 1 : 0, 1 ], slot * 4 );
		lookupArray[ descriptor.tileZ * contract.tier.logicalTilesX + descriptor.tileX ] = slot;
		for ( let localZ = 1; localZ <= contract.tier.tileSize; localZ += 1 ) for ( let localX = 1; localX <= contract.tier.tileSize; localX += 1 ) {

			const globalCellX = descriptor.tileX * contract.tier.tileSize + localX - 1;
			const globalCellZ = descriptor.tileZ * contract.tier.tileSize + localZ - 1;
			const sample = initialCondition( { descriptor, slot, localX, localZ, globalCellX, globalCellZ, contract } );
			const values = [ sample?.depthMeters, sample?.xDischargeM2ps ?? 0, sample?.zDischargeM2ps ?? 0, sample?.bedElevationMeters ];
			if ( ! values.every( Number.isFinite ) || values[ 0 ] < 0 ) throw new Error( 'GPU SWE initial condition returned invalid conservative state' );
			const velocity = values[ 0 ] > DRY_TOLERANCE_METERS ? Math.hypot( values[ 1 ], values[ 2 ] ) / values[ 0 ] : 0;
			maximumDepthMeters = Math.max( maximumDepthMeters, values[ 0 ] );
			maximumVelocityMps = Math.max( maximumVelocityMps, velocity );
			const stateIndex = paddedStateIndexNumber( contract, slot, localX, localZ );
			stateArray.set( values, stateIndex * 4 );
			displayIndexArray[ displayCells.length ] = stateIndex;
			displayCells.push( Object.freeze( { stateIndex, slot, globalCellX, globalCellZ, tileX: descriptor.tileX, tileZ: descriptor.tileZ, role: descriptor.role } ) );

		}

	}
	if ( maximumDepthMeters > contract.tier.maximumDepthMeters ) throw new Error( `GPU SWE initial depth ${ maximumDepthMeters } m exceeds tier envelope ${ contract.tier.maximumDepthMeters } m` );
	if ( maximumVelocityMps > contract.tier.maximumVelocityMps ) throw new Error( `GPU SWE initial velocity ${ maximumVelocityMps } m/s exceeds tier envelope ${ contract.tier.maximumVelocityMps } m/s` );
	return Object.freeze( {
		descriptorArray,
		lookupArray,
		stateArray,
		displayIndexArray,
		displayCells: Object.freeze( displayCells ),
		residentTileCount: preparedCommit.descriptors.length,
		residentCellCount: displayCells.length,
		maximumDepthMeters,
		maximumVelocityMps
	} );

}

function createStorageBuffer( array, itemSize, name ) {

	const buffer = new StorageBufferAttribute( array, itemSize );
	buffer.name = name;
	return buffer;

}

export function createGpuSparseSweOwner( renderer, {
	tierId = 'budgeted',
	preparedCommit,
	initialCondition,
	gravityMps2 = 9.80665
} ) {

	if ( renderer?.backend?.isWebGPUBackend !== true ) throw new Error( 'GPU sparse SWE requires an initialized native WebGPU renderer' );
	const contract = deriveSweGpuContract( tierId, gravityMps2 );
	validateSweGpuContract( contract );
	const initial = buildGpuSweInitialData( preparedCommit, contract, initialCondition );
	const stateCommittedBuffer = createStorageBuffer( initial.stateArray.slice(), 4, 'sparse-swe:committed-state' );
	const stateCandidateBuffer = createStorageBuffer( initial.stateArray.slice(), 4, 'sparse-swe:candidate-state' );
	const descriptorBuffer = createStorageBuffer( initial.descriptorArray, 4, 'sparse-swe:tile-descriptors' );
	const lookupBuffer = createStorageBuffer( initial.lookupArray, 1, 'sparse-swe:logical-tile-lookup' );
	const displayIndexBuffer = createStorageBuffer( initial.displayIndexArray, 1, 'sparse-swe:display-state-indices' );
	const xFluxBuffer = createStorageBuffer( new Float32Array( contract.xFaceRecords * 4 ), 4, 'sparse-swe:x-face-flux' );
	const zFluxBuffer = createStorageBuffer( new Float32Array( contract.zFaceRecords * 4 ), 4, 'sparse-swe:z-face-flux' );
	const xCorrectionBuffer = createStorageBuffer( new Float32Array( contract.xFaceRecords * 2 ), 2, 'sparse-swe:x-hydrostatic-correction' );
	const zCorrectionBuffer = createStorageBuffer( new Float32Array( contract.zFaceRecords * 2 ), 2, 'sparse-swe:z-hydrostatic-correction' );
	const diagnosticBuffer = new StorageBufferAttribute( 8, 1, Uint32Array );
	diagnosticBuffer.name = 'sparse-swe:transaction-diagnostics';

	const committed = storage( stateCommittedBuffer, 'vec4', contract.stateRecords );
	const candidate = storage( stateCandidateBuffer, 'vec4', contract.stateRecords );
	const descriptors = storage( descriptorBuffer, 'ivec4', contract.tier.capacityTiles ).toReadOnly();
	const lookup = storage( lookupBuffer, 'int', contract.tier.logicalTilesX * contract.tier.logicalTilesZ ).toReadOnly();
	const displayIndices = storage( displayIndexBuffer, 'uint', initial.displayIndexArray.length ).toReadOnly();
	const xFlux = storage( xFluxBuffer, 'vec4', contract.xFaceRecords );
	const zFlux = storage( zFluxBuffer, 'vec4', contract.zFaceRecords );
	const xCorrection = storage( xCorrectionBuffer, 'vec2', contract.xFaceRecords );
	const zCorrection = storage( zCorrectionBuffer, 'vec2', contract.zFaceRecords );
	const diagnostics = storage( diagnosticBuffer, 'uint', 8 ).toAtomic();

	const tileSize = contract.tier.tileSize;
	const paddedSize = contract.paddedSize;
	const paddedCells = paddedSize * paddedSize;
	const interiorCells = tileSize * tileSize;
	const xFacesPerTile = ( tileSize + 1 ) * tileSize;
	const zFacesPerTile = tileSize * ( tileSize + 1 );
	const dt = float( contract.tier.fixedTimeStepSeconds );
	const inverseDx = float( 1 / contract.tier.cellSizeMeters );
	const gravity = float( gravityMps2 );
	const dryTolerance = float( DRY_TOLERANCE_METERS );

	const paddedIndex = ( slot, localX, localZ ) => slot.mul( uint( paddedCells ) ).add( localZ.mul( uint( paddedSize ) ) ).add( localX );
	const localCoordinates = ( linear, width ) => {

		const row = linear.div( uint( width ) );
		return { x: linear.sub( row.mul( uint( width ) ) ), z: row };

	};

	const resetValidation = Fn( () => {

		const index = globalId.x;
		If( index.lessThan( uint( 5 ) ), () => {

			// Three r185 types atomicStore as uint although WGSL defines it as
			// void, producing a false TSL generation error. One invocation owns
			// each reset word, so subtracting its atomic snapshot is exact.
			const receipt = uint( 0 ).toVar();
			receipt.addAssign( atomicSub( diagnostics.element( index ), atomicLoad( diagnostics.element( index ) ) ) );

		} );

	} )().compute( 8, [ 8 ] ).setName( 'sparse-swe:reset-validation' );

	const haloAndBoundary = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( paddedCells ) );
		const local = linear.sub( slot.mul( uint( paddedCells ) ) );
		const coordinate = localCoordinates( local, paddedSize );
		const descriptor = descriptors.element( slot );
		const resident = descriptor.w.greaterThan( int( 0 ) );
		const xBoundary = coordinate.x.equal( uint( 0 ) ).or( coordinate.x.equal( uint( paddedSize - 1 ) ) );
		const zBoundary = coordinate.z.equal( uint( 0 ) ).or( coordinate.z.equal( uint( paddedSize - 1 ) ) );
		const corner = xBoundary.and( zBoundary );
		If( resident.and( xBoundary.or( zBoundary ) ).and( corner.not() ), () => {

			const sourceSlot = slot.toVar();
			const sourceX = coordinate.x.toVar();
			const sourceZ = coordinate.z.toVar();
			const reflectX = float( 1 ).toVar();
			const reflectZ = float( 1 ).toVar();
			const neighborTileX = descriptor.x.toVar();
			const neighborTileZ = descriptor.y.toVar();
			If( coordinate.x.equal( uint( 0 ) ), () => { sourceX.assign( uint( tileSize ) ); neighborTileX.subAssign( int( 1 ) ); reflectX.assign( -1 ); } );
			If( coordinate.x.equal( uint( paddedSize - 1 ) ), () => { sourceX.assign( uint( 1 ) ); neighborTileX.addAssign( int( 1 ) ); reflectX.assign( -1 ); } );
			If( coordinate.z.equal( uint( 0 ) ), () => { sourceZ.assign( uint( tileSize ) ); neighborTileZ.subAssign( int( 1 ) ); reflectZ.assign( -1 ); } );
			If( coordinate.z.equal( uint( paddedSize - 1 ) ), () => { sourceZ.assign( uint( 1 ) ); neighborTileZ.addAssign( int( 1 ) ); reflectZ.assign( -1 ); } );
			const neighborInDomain = neighborTileX.greaterThanEqual( int( 0 ) ).and( neighborTileX.lessThan( int( contract.tier.logicalTilesX ) ) )
				.and( neighborTileZ.greaterThanEqual( int( 0 ) ) ).and( neighborTileZ.lessThan( int( contract.tier.logicalTilesZ ) ) );
			If( neighborInDomain, () => {

				const lookupIndex = neighborTileZ.mul( int( contract.tier.logicalTilesX ) ).add( neighborTileX ).toUint();
				const neighborSlot = lookup.element( lookupIndex );
				If( neighborSlot.greaterThanEqual( int( 0 ) ), () => { sourceSlot.assign( neighborSlot.toUint() ); reflectX.assign( 1 ); reflectZ.assign( 1 ); } );

			} );
			const source = committed.element( paddedIndex( sourceSlot, sourceX, sourceZ ) );
			committed.element( linear ).assign( vec4( source.x, source.y.mul( reflectX ), source.z.mul( reflectZ ), source.w ) );

		} );

	} )().compute( contract.stateRecords, [ 64 ] ).setName( 'sparse-swe:halo-and-boundary' );

	function hydrostaticFace( left, right, axis ) {

		const hL = left.x;
		const hR = right.x;
		const bedFace = max( left.w, right.w );
		const reconstructedHL = max( float( 0 ), hL.add( left.w ).sub( bedFace ) );
		const reconstructedHR = max( float( 0 ), hR.add( right.w ).sub( bedFace ) );
		const scaleL = select( hL.greaterThan( dryTolerance ), reconstructedHL.div( max( hL, dryTolerance ) ), float( 0 ) );
		const scaleR = select( hR.greaterThan( dryTolerance ), reconstructedHR.div( max( hR, dryTolerance ) ), float( 0 ) );
		const normalL = ( axis === 'x' ? left.y : left.z ).mul( scaleL );
		const normalR = ( axis === 'x' ? right.y : right.z ).mul( scaleR );
		const tangentL = ( axis === 'x' ? left.z : left.y ).mul( scaleL );
		const tangentR = ( axis === 'x' ? right.z : right.y ).mul( scaleR );
		const velocityL = select( reconstructedHL.greaterThan( dryTolerance ), normalL.div( max( reconstructedHL, dryTolerance ) ), float( 0 ) );
		const velocityR = select( reconstructedHR.greaterThan( dryTolerance ), normalR.div( max( reconstructedHR, dryTolerance ) ), float( 0 ) );
		const waveL = sqrt( gravity.mul( reconstructedHL ) );
		const waveR = sqrt( gravity.mul( reconstructedHR ) );
		const sL = min( velocityL.sub( waveL ), velocityR.sub( waveR ) );
		const sR = max( velocityL.add( waveL ), velocityR.add( waveR ) );
		const fluxL = vec3( normalL, normalL.mul( velocityL ).add( gravity.mul( reconstructedHL.mul( reconstructedHL ) ).mul( 0.5 ) ), tangentL.mul( velocityL ) );
		const fluxR = vec3( normalR, normalR.mul( velocityR ).add( gravity.mul( reconstructedHR.mul( reconstructedHR ) ).mul( 0.5 ) ), tangentR.mul( velocityR ) );
		const stateL = vec3( reconstructedHL, normalL, tangentL );
		const stateR = vec3( reconstructedHR, normalR, tangentR );
		const hll = fluxL.mul( sR ).sub( fluxR.mul( sL ) ).add( stateR.sub( stateL ).mul( sL.mul( sR ) ) ).div( max( sR.sub( sL ), float( 1e-6 ) ) );
		const bothDry = reconstructedHL.lessThanEqual( dryTolerance ).and( reconstructedHR.lessThanEqual( dryTolerance ) );
		const selectedFlux = select( bothDry, vec3( 0 ), select( sL.greaterThanEqual( float( 0 ) ), fluxL, select( sR.lessThanEqual( float( 0 ) ), fluxR, hll ) ) );
		const correctionL = gravity.mul( hL.mul( hL ).sub( reconstructedHL.mul( reconstructedHL ) ) ).mul( 0.5 );
		const correctionR = gravity.mul( hR.mul( hR ).sub( reconstructedHR.mul( reconstructedHR ) ) ).mul( 0.5 );
		return { flux: selectedFlux, correction: vec2( correctionL, correctionR ) };

	}

	const xFaceFlux = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( xFacesPerTile ) );
		const local = linear.sub( slot.mul( uint( xFacesPerTile ) ) );
		const coordinate = localCoordinates( local, tileSize + 1 );
		const resident = descriptors.element( slot ).w.greaterThan( int( 0 ) );
		If( resident, () => {

			const localZ = coordinate.z.add( uint( 1 ) );
			const face = hydrostaticFace( committed.element( paddedIndex( slot, coordinate.x, localZ ) ), committed.element( paddedIndex( slot, coordinate.x.add( uint( 1 ) ), localZ ) ), 'x' );
			xFlux.element( linear ).assign( vec4( face.flux, 0 ) );
			xCorrection.element( linear ).assign( face.correction );

		} ).Else( () => { xFlux.element( linear ).assign( vec4( 0 ) ); xCorrection.element( linear ).assign( vec2( 0 ) ); } );

	} )().compute( contract.xFaceRecords, [ 64 ] ).setName( 'sparse-swe:x-face-flux' );

	const zFaceFlux = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( zFacesPerTile ) );
		const local = linear.sub( slot.mul( uint( zFacesPerTile ) ) );
		const coordinate = localCoordinates( local, tileSize );
		const resident = descriptors.element( slot ).w.greaterThan( int( 0 ) );
		If( resident, () => {

			const localX = coordinate.x.add( uint( 1 ) );
			const face = hydrostaticFace( committed.element( paddedIndex( slot, localX, coordinate.z ) ), committed.element( paddedIndex( slot, localX, coordinate.z.add( uint( 1 ) ) ) ), 'z' );
			zFlux.element( linear ).assign( vec4( face.flux, 0 ) );
			zCorrection.element( linear ).assign( face.correction );

		} ).Else( () => { zFlux.element( linear ).assign( vec4( 0 ) ); zCorrection.element( linear ).assign( vec2( 0 ) ); } );

	} )().compute( contract.zFaceRecords, [ 64 ] ).setName( 'sparse-swe:z-face-flux' );

	const cellUpdate = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( interiorCells ) );
		const local = linear.sub( slot.mul( uint( interiorCells ) ) );
		const coordinate = localCoordinates( local, tileSize );
		const resident = descriptors.element( slot ).w.greaterThan( int( 0 ) );
		If( resident, () => {

			const stateIndex = paddedIndex( slot, coordinate.x.add( uint( 1 ) ), coordinate.z.add( uint( 1 ) ) );
			const prior = committed.element( stateIndex );
			const westIndex = slot.mul( uint( xFacesPerTile ) ).add( coordinate.z.mul( uint( tileSize + 1 ) ) ).add( coordinate.x );
			const eastIndex = westIndex.add( uint( 1 ) );
			const southIndex = slot.mul( uint( zFacesPerTile ) ).add( coordinate.z.mul( uint( tileSize ) ) ).add( coordinate.x );
			const northIndex = southIndex.add( uint( tileSize ) );
			const west = xFlux.element( westIndex );
			const east = xFlux.element( eastIndex );
			const south = zFlux.element( southIndex );
			const north = zFlux.element( northIndex );
			const westCorrection = xCorrection.element( westIndex );
			const eastCorrection = xCorrection.element( eastIndex );
			const southCorrection = zCorrection.element( southIndex );
			const northCorrection = zCorrection.element( northIndex );
			const nextDepth = prior.x.sub( east.x.sub( west.x ).mul( dt.mul( inverseDx ) ) ).sub( north.x.sub( south.x ).mul( dt.mul( inverseDx ) ) );
			const nextMx = prior.y.sub( east.y.add( eastCorrection.x ).sub( west.y.add( westCorrection.y ) ).mul( dt.mul( inverseDx ) ) ).sub( north.z.sub( south.z ).mul( dt.mul( inverseDx ) ) );
			const nextMz = prior.z.sub( east.z.sub( west.z ).mul( dt.mul( inverseDx ) ) ).sub( north.y.add( northCorrection.x ).sub( south.y.add( southCorrection.y ) ).mul( dt.mul( inverseDx ) ) );
			const newlyDry = nextDepth.greaterThanEqual( float( 0 ) ).and( nextDepth.lessThanEqual( dryTolerance ) );
			candidate.element( stateIndex ).assign( vec4( select( newlyDry, max( nextDepth, float( 0 ) ), nextDepth ), select( newlyDry, float( 0 ), nextMx ), select( newlyDry, float( 0 ), nextMz ), prior.w ) );

		} );

	} )().compute( contract.tier.capacityTiles * interiorCells, [ 64 ] ).setName( 'sparse-swe:cell-update' );

	const candidateValidation = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( interiorCells ) );
		const local = linear.sub( slot.mul( uint( interiorCells ) ) );
		const coordinate = localCoordinates( local, tileSize );
		const resident = descriptors.element( slot ).w.greaterThan( int( 0 ) );
		If( resident, () => {

			const stateIndex = paddedIndex( slot, coordinate.x.add( uint( 1 ) ), coordinate.z.add( uint( 1 ) ) );
			const prior = committed.element( stateIndex );
			const next = candidate.element( stateIndex );
			const finite = next.x.equal( next.x ).and( next.y.equal( next.y ) ).and( next.z.equal( next.z ) )
				.and( abs( next.x ).lessThan( FINITE_MAGNITUDE_GATE ) ).and( abs( next.y ).lessThan( FINITE_MAGNITUDE_GATE ) ).and( abs( next.z ).lessThan( FINITE_MAGNITUDE_GATE ) );
			// Consume return-valued atomic results so TSL does not lower them as
			// void stack statements and emit a false "expected uint" diagnostic.
			const receipt = uint( 0 ).toVar();
			If( finite.not(), () => { receipt.addAssign( atomicAdd( diagnostics.element( uint( 0 ) ), uint( 1 ) ) ); } );
			If( next.x.lessThan( NEGATIVE_DEPTH_GATE_METERS ), () => { receipt.addAssign( atomicAdd( diagnostics.element( uint( 1 ) ), uint( 1 ) ) ); } );
			If( next.x.greaterThan( dryTolerance ), () => { receipt.addAssign( atomicAdd( diagnostics.element( uint( 2 ) ), uint( 1 ) ) ); } );
			receipt.addAssign( atomicAdd( diagnostics.element( uint( 3 ) ), max( prior.x, float( 0 ) ).mul( MASS_QUANTA_PER_METER ).add( 0.5 ).toUint() ) );
			receipt.addAssign( atomicAdd( diagnostics.element( uint( 4 ) ), max( next.x, float( 0 ) ).mul( MASS_QUANTA_PER_METER ).add( 0.5 ).toUint() ) );

		} );

	} )().compute( contract.tier.capacityTiles * interiorCells, [ 64 ] ).setName( 'sparse-swe:candidate-validation' );

	const atomicCommit = Fn( () => {

		const linear = globalId.x;
		const slot = linear.div( uint( interiorCells ) );
		const local = linear.sub( slot.mul( uint( interiorCells ) ) );
		const coordinate = localCoordinates( local, tileSize );
		const resident = descriptors.element( slot ).w.greaterThan( int( 0 ) );
		const priorMass = atomicLoad( diagnostics.element( uint( 3 ) ) );
		const candidateMass = atomicLoad( diagnostics.element( uint( 4 ) ) );
		const massDifference = max( priorMass, candidateMass ).sub( min( priorMass, candidateMass ) );
		const valid = atomicLoad( diagnostics.element( uint( 0 ) ) ).equal( uint( 0 ) )
			.and( atomicLoad( diagnostics.element( uint( 1 ) ) ).equal( uint( 0 ) ) )
			.and( massDifference.lessThanEqual( uint( initial.residentCellCount * 2 ) ) );
		If( resident.and( valid ), () => {

			const stateIndex = paddedIndex( slot, coordinate.x.add( uint( 1 ) ), coordinate.z.add( uint( 1 ) ) );
			committed.element( stateIndex ).assign( candidate.element( stateIndex ) );

		} );
		If( linear.equal( uint( 0 ) ), () => {

			const receipt = uint( 0 ).toVar();
			If( valid, () => {

				receipt.addAssign( atomicAdd( diagnostics.element( uint( 5 ) ), uint( 1 ) ) );
				receipt.addAssign( atomicAdd( diagnostics.element( uint( 6 ) ), uint( 1 ) ) );

			} ).Else( () => {

				receipt.addAssign( atomicAdd( diagnostics.element( uint( 7 ) ), uint( 1 ) ) );

			} );

		} );

	} )().compute( contract.tier.capacityTiles * interiorCells, [ 64 ] ).setName( 'sparse-swe:atomic-commit' );

	const stepGraph = Object.freeze( [ resetValidation, haloAndBoundary, xFaceFlux, zFaceFlux, cellUpdate, candidateValidation, atomicCommit ] );
	let accumulatorSeconds = 0;
	let submittedTicks = 0;
	let dispatchCount = 0;
	let droppedTimeSeconds = 0;
	let diagnosticReadbackCount = 0;
	let disposed = false;

	function requireLive() { if ( disposed ) throw new Error( 'GPU sparse SWE owner is disposed' ); }
	function dispatchFixedStep() {

		requireLive();
		// Separate submissions are deliberate: every whole-grid pass must complete
		// before a dependent pass reads its storage, and a validation failure must
		// name the exact pipeline instead of poisoning an opaque grouped dispatch.
		for ( const dispatch of stepGraph ) renderer.compute( dispatch );
		submittedTicks += 1;
		dispatchCount += stepGraph.length;

	}

	async function captureDiagnostics() {

		requireLive();
		if ( typeof renderer.getArrayBufferAsync !== 'function' ) throw new Error( 'Renderer storage readback is unavailable' );
		const bytes = await renderer.getArrayBufferAsync( diagnosticBuffer, null, 0, diagnosticBuffer.array.byteLength );
		diagnosticReadbackCount += 1;
		const values = Array.from( new Uint32Array( bytes ) );
		return Object.freeze( {
			invalidCells: values[ 0 ], negativeDepthCells: values[ 1 ], wetCells: values[ 2 ],
			priorDepthQuanta: values[ 3 ], candidateDepthQuanta: values[ 4 ], committedGeneration: values[ 5 ],
			acceptedCommits: values[ 6 ], rejectedCommits: values[ 7 ],
			massQuantumMeters: 1 / MASS_QUANTA_PER_METER,
			diagnosticReadbackOnly: true,
			frameCriticalReadbackCount: 0
		} );

	}

	return Object.freeze( {
		contract,
		initial,
		stateCommittedBuffer,
		stateCandidateBuffer,
		descriptorBuffer,
		lookupBuffer,
		displayIndexBuffer,
		diagnosticBuffer,
		committedStateNode: committed,
		displayIndexNode: displayIndices,
		dispatchFixedStep,
		advancePresentationDelta( deltaSeconds ) {

			requireLive();
			if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'GPU sparse SWE presentation delta must be finite and non-negative' );
			const maximumAdmitted = contract.tier.fixedTimeStepSeconds * contract.tier.maximumCatchUpSteps;
			const admitted = Math.min( deltaSeconds, maximumAdmitted );
			droppedTimeSeconds += deltaSeconds - admitted;
			accumulatorSeconds += admitted;
			const steps = Math.min( contract.tier.maximumCatchUpSteps, Math.floor( ( accumulatorSeconds + 1e-12 ) / contract.tier.fixedTimeStepSeconds ) );
			for ( let step = 0; step < steps; step += 1 ) dispatchFixedStep();
			accumulatorSeconds = Math.max( 0, accumulatorSeconds - steps * contract.tier.fixedTimeStepSeconds );
			return steps;

		},
		captureDiagnostics,
		describe() {

			return Object.freeze( {
				backend: 'native-webgpu', model: 'nonlinear-Saint-Venant-HLL-hydrostatic', authority: 'gpu-float32',
				tierId, submittedTicks, dispatchCount, droppedTimeSeconds, diagnosticReadbackCount, frameCriticalReadbackCount: 0,
				residentTileCount: initial.residentTileCount, residentCellCount: initial.residentCellCount,
				logicalResourceBytes: contract.totalLogicalBytes, dispatchOrder: contract.dispatchOrder
			} );

		},
		dispose() {

			if ( disposed ) return;
			disposed = true;
			for ( const buffer of [ stateCommittedBuffer, stateCandidateBuffer, descriptorBuffer, lookupBuffer, displayIndexBuffer, xFluxBuffer, zFluxBuffer, xCorrectionBuffer, zCorrectionBuffer, diagnosticBuffer ] ) buffer.dispose?.();

		}
	} );

}
