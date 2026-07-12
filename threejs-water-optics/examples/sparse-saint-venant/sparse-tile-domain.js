export const SPARSE_DOMAIN_DECISION = Object.freeze( {
	problemId: 'persistent-coastal-wet-dry-residency',
	axes: Object.freeze( [ 'boundedMemory', 'gpuLookupCost', 'determinism', 'frontGrowth', 'mobileBindings' ] ),
	selectedCandidateId: 'fixed-atlas-compact-descriptors',
	candidates: Object.freeze( [
		Object.freeze( { id: 'dense-global-textures', family: 'dense global ping-pong textures', scores: [ 1, 5, 5, 5, 4 ], hardGate: 'fail:archipelago-empty-area-cost' } ),
		Object.freeze( { id: 'cpu-sparse-map', family: 'CPU sparse map with dirty GPU uploads', scores: [ 4, 2, 4, 3, 3 ], hardGate: 'fail:frame-critical-upload-tail' } ),
		Object.freeze( { id: 'gpu-hash-table', family: 'GPU hash table of state tiles', scores: [ 5, 2, 3, 5, 3 ], hardGate: 'fail:probe-and-rehash-tail' } ),
		Object.freeze( { id: 'fixed-atlas-compact-descriptors', family: 'fixed atlas with sorted compact active descriptors', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'quadtree-pages', family: 'adaptive quadtree state pages', scores: [ 5, 3, 3, 4, 3 ], hardGate: 'fail:conservative-flux-interface-complexity' } ),
		Object.freeze( { id: 'clipmap-rings', family: 'camera-centered clipmap state rings', scores: [ 4, 5, 4, 2, 4 ], hardGate: 'fail:camera-dependent-physics-ownership' } )
	] )
} );

function tileId( tileX, tileZ ) { return `${ tileZ }:${ tileX }`; }
function compareTiles( a, b ) { return a.tileZ - b.tileZ || a.tileX - b.tileX; }

export function createSparseTileDomain( { tilesX, tilesZ, tileSize = 16, capacityTiles, deactivationTicks = 8 } ) {

	if ( ! Number.isInteger( tilesX ) || tilesX < 1 || ! Number.isInteger( tilesZ ) || tilesZ < 1 ) throw new Error( 'sparse domain tile dimensions must be positive integers' );
	if ( ! Number.isInteger( tileSize ) || tileSize < 4 ) throw new Error( 'sparse domain tileSize must be an integer >= 4' );
	if ( ! Number.isInteger( capacityTiles ) || capacityTiles < 1 ) throw new Error( 'sparse domain capacityTiles must be positive' );
	if ( ! Number.isInteger( deactivationTicks ) || deactivationTicks < 1 ) throw new Error( 'sparse domain deactivationTicks must be positive' );
	return {
		tilesX, tilesZ, tileSize, capacityTiles, deactivationTicks,
		generation: 0,
		records: new Map(),
		slotByTileId: new Map(),
		lastCommit: null
	};

}

function normalizeReasons( domain, reasons ) {

	const map = new Map();
	for ( const reason of reasons ) {

		if ( ! Number.isInteger( reason.tileX ) || ! Number.isInteger( reason.tileZ ) || reason.tileX < 0 || reason.tileX >= domain.tilesX || reason.tileZ < 0 || reason.tileZ >= domain.tilesZ ) throw new Error( 'sparse activation reason references an out-of-domain tile' );
		const id = tileId( reason.tileX, reason.tileZ );
		if ( map.has( id ) ) throw new Error( `duplicate sparse activation reason for tile ${ id }` );
		const wetCellCount = reason.wetCellCount ?? 0;
		if ( ! Number.isInteger( wetCellCount ) || wetCellCount < 0 || wetCellCount > domain.tileSize * domain.tileSize ) throw new Error( `invalid wetCellCount for tile ${ id }` );
		map.set( id, { tileX: reason.tileX, tileZ: reason.tileZ, wetCellCount, source: reason.source === true, obstacleBoundary: reason.obstacleBoundary === true } );

	}
	return map;

}

function addCardinalHalo( domain, tiles ) {

	const result = new Map( tiles.map( ( tile ) => [ tileId( tile.tileX, tile.tileZ ), { ...tile, role: 'core' } ] ) );
	for ( const tile of tiles ) for ( const [ dx, dz ] of [ [ -1, 0 ], [ 1, 0 ], [ 0, -1 ], [ 0, 1 ] ] ) {

		const tileX = tile.tileX + dx;
		const tileZ = tile.tileZ + dz;
		if ( tileX < 0 || tileX >= domain.tilesX || tileZ < 0 || tileZ >= domain.tilesZ ) continue;
		const id = tileId( tileX, tileZ );
		if ( ! result.has( id ) ) result.set( id, { tileX, tileZ, role: 'halo', wetCellCount: 0, source: false, obstacleBoundary: false } );

	}
	return [ ...result.values() ].sort( compareTiles );

}

function assignStableSlots( domain, residentTiles ) {

	if ( residentTiles.length > domain.capacityTiles ) throw new Error( `sparse tile capacity exceeded: ${ residentTiles.length } > ${ domain.capacityTiles }` );
	const retained = new Map();
	const used = new Set();
	for ( const tile of residentTiles ) {

		const id = tileId( tile.tileX, tile.tileZ );
		const prior = domain.slotByTileId.get( id );
		if ( prior === undefined ) continue;
		retained.set( id, prior );
		used.add( prior );

	}
	const free = [];
	for ( let slot = 0; slot < domain.capacityTiles; slot += 1 ) if ( ! used.has( slot ) ) free.push( slot );
	for ( const tile of residentTiles ) {

		const id = tileId( tile.tileX, tile.tileZ );
		if ( ! retained.has( id ) ) retained.set( id, free.shift() );

	}
	return retained;

}

export function prepareSparseTileCommit( domain, reasons ) {

	const reasonMap = normalizeReasons( domain, reasons );
	const nextRecords = new Map();
	for ( let tileZ = 0; tileZ < domain.tilesZ; tileZ += 1 ) for ( let tileX = 0; tileX < domain.tilesX; tileX += 1 ) {

		const id = tileId( tileX, tileZ );
		const reason = reasonMap.get( id ) ?? { tileX, tileZ, wetCellCount: 0, source: false, obstacleBoundary: false };
		const prior = domain.records.get( id );
		const immediatelyRequired = reason.wetCellCount > 0 || reason.source || reason.obstacleBoundary;
		const dryTicks = immediatelyRequired ? 0 : ( prior?.dryTicks ?? domain.deactivationTicks ) + 1;
		const coreActive = immediatelyRequired || ( prior?.coreActive === true && dryTicks < domain.deactivationTicks );
		nextRecords.set( id, { ...reason, dryTicks, coreActive } );

	}
	const coreTiles = [ ...nextRecords.values() ].filter( ( record ) => record.coreActive ).sort( compareTiles );
	const residentTiles = addCardinalHalo( domain, coreTiles );
	const slotByTileId = assignStableSlots( domain, residentTiles );
	const descriptors = residentTiles.map( ( tile ) => Object.freeze( { ...tile, id: tileId( tile.tileX, tile.tileZ ), atlasSlot: slotByTileId.get( tileId( tile.tileX, tile.tileZ ) ) } ) );
	return Object.freeze( {
		baseGeneration: domain.generation,
		generation: domain.generation + 1,
		nextRecords,
		slotByTileId,
		descriptors: Object.freeze( descriptors ),
		coreTileCount: coreTiles.length,
		haloTileCount: residentTiles.length - coreTiles.length,
		logicalCellCount: coreTiles.length * domain.tileSize * domain.tileSize,
		residentCellCount: residentTiles.length * domain.tileSize * domain.tileSize,
		stateBytesPerPingPongPair: residentTiles.length * domain.tileSize * domain.tileSize * 3 * 4 * 2
	} );

}

export function commitSparseTiles( domain, prepared ) {

	if ( prepared.baseGeneration !== domain.generation || prepared.generation !== domain.generation + 1 ) throw new Error( 'stale sparse tile prepare cannot commit' );
	domain.records = new Map( prepared.nextRecords );
	domain.slotByTileId = new Map( prepared.slotByTileId );
	domain.generation = prepared.generation;
	domain.lastCommit = prepared;
	return prepared;

}

export function sparseDomainDigest( commit ) {

	return commit.descriptors.map( ( descriptor ) => `${ descriptor.id }@${ descriptor.atlasSlot }:${ descriptor.role }` ).join( '|' );

}
