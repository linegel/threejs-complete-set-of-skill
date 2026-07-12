import assert from 'node:assert/strict';
import { SPARSE_DOMAIN_DECISION, commitSparseTiles, createSparseTileDomain, prepareSparseTileCommit, sparseDomainDigest } from './sparse-tile-domain.js';

assert.ok( SPARSE_DOMAIN_DECISION.candidates.length >= 5 );
assert.equal( new Set( SPARSE_DOMAIN_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, SPARSE_DOMAIN_DECISION.candidates.length );
assert.equal( SPARSE_DOMAIN_DECISION.selectedCandidateId, 'fixed-atlas-compact-descriptors' );

const domain = createSparseTileDomain( { tilesX: 8, tilesZ: 6, tileSize: 16, capacityTiles: 24, deactivationTicks: 3 } );
const reasons = [
	{ tileX: 1, tileZ: 1, wetCellCount: 20 },
	{ tileX: 5, tileZ: 3, wetCellCount: 3 },
	{ tileX: 6, tileZ: 3, source: true },
	{ tileX: 2, tileZ: 4, obstacleBoundary: true }
];
const prepared = prepareSparseTileCommit( domain, reasons );
assert.equal( domain.generation, 0, 'prepare mutated the committed sparse generation' );
assert.equal( prepared.coreTileCount, 4 );
assert.ok( prepared.haloTileCount > 0 );
assert.equal( prepared.stateBytesPerPingPongPair, prepared.descriptors.length * 16 * 16 * 3 * 4 * 2 );
commitSparseTiles( domain, prepared );
const firstDigest = sparseDomainDigest( prepared );

const permuted = prepareSparseTileCommit( createSparseTileDomain( { tilesX: 8, tilesZ: 6, tileSize: 16, capacityTiles: 24, deactivationTicks: 3 } ), [ ...reasons ].reverse() );
assert.equal( sparseDomainDigest( permuted ), firstDigest, 'sparse descriptor ordering depends on discovery order' );

const retained = commitSparseTiles( domain, prepareSparseTileCommit( domain, reasons.slice( 1 ) ) );
assert.equal( retained.coreTileCount, 4, 'dry hysteresis released a tile too early' );
const retainedSlot = retained.descriptors.find( ( descriptor ) => descriptor.id === '1:1' ).atlasSlot;
assert.equal( retainedSlot, prepared.descriptors.find( ( descriptor ) => descriptor.id === '1:1' ).atlasSlot, 'retained tile changed atlas slot' );
commitSparseTiles( domain, prepareSparseTileCommit( domain, reasons.slice( 1 ) ) );
const released = commitSparseTiles( domain, prepareSparseTileCommit( domain, reasons.slice( 1 ) ) );
assert.equal( released.coreTileCount, 3, 'dry hysteresis did not release a tile at the declared tick' );

const generationBeforeFailure = domain.generation;
assert.throws( () => prepareSparseTileCommit( createSparseTileDomain( { tilesX: 4, tilesZ: 4, tileSize: 16, capacityTiles: 2 } ), [ { tileX: 1, tileZ: 1, wetCellCount: 1 } ] ), /capacity/ );
assert.equal( domain.generation, generationBeforeFailure, 'foreign capacity failure changed the live sparse domain' );
assert.throws( () => prepareSparseTileCommit( domain, [ { tileX: -1, tileZ: 0, wetCellCount: 1 } ] ), /out-of-domain/ );
assert.throws( () => prepareSparseTileCommit( domain, [ reasons[ 0 ], reasons[ 0 ] ] ), /duplicate/ );
assert.throws( () => commitSparseTiles( domain, retained ), /stale/ );

console.log( `sparse tile domain passed: 6 representations, ${ prepared.coreTileCount } core + ${ prepared.haloTileCount } halo tiles, ${ prepared.stateBytesPerPingPongPair } state bytes, 4 rejection controls` );
