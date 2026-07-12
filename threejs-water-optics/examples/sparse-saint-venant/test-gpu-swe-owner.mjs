import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGpuSweInitialData } from './gpu-swe-owner.js';
import { deriveSweGpuContract } from './gpu-swe-contract.js';
import { commitSparseTiles, createSparseTileDomain, prepareSparseTileCommit } from './sparse-tile-domain.js';

const contract = deriveSweGpuContract( 'budgeted' );
const domain = createSparseTileDomain( { tilesX: contract.tier.logicalTilesX, tilesZ: contract.tier.logicalTilesZ, tileSize: contract.tier.tileSize, capacityTiles: contract.tier.capacityTiles } );
const prepared = commitSparseTiles( domain, prepareSparseTileCommit( domain, [ { tileX: 2, tileZ: 2, wetCellCount: 20 }, { tileX: 3, tileZ: 2, wetCellCount: 10 } ] ) );
const initial = buildGpuSweInitialData( prepared, contract, ( { globalCellX, globalCellZ } ) => ( {
	depthMeters: globalCellX < 36 ? 0.18 : 0.02,
	xDischargeM2ps: 0,
	zDischargeM2ps: 0,
	bedElevationMeters: 0.01 * Math.sin( globalCellX * 0.1 ) * Math.cos( globalCellZ * 0.1 )
} ) );
assert.equal( initial.residentTileCount, prepared.descriptors.length );
assert.equal( initial.residentCellCount, prepared.descriptors.length * contract.tier.tileSize ** 2 );
assert.equal( initial.stateArray.length, contract.stateRecords * 4 );
assert.equal( initial.descriptorArray.length, contract.tier.capacityTiles * 4 );
assert.equal( initial.lookupArray.length, contract.tier.logicalTilesX * contract.tier.logicalTilesZ );
assert.equal( initial.displayIndexArray.length, contract.tier.capacityTiles * contract.tier.tileSize ** 2 );
assert.ok( initial.maximumDepthMeters <= contract.tier.maximumDepthMeters );

assert.throws( () => buildGpuSweInitialData( prepared, contract, () => ( { depthMeters: -1, bedElevationMeters: 0 } ) ), /invalid/ );
assert.throws( () => buildGpuSweInitialData( prepared, contract, () => ( { depthMeters: contract.tier.maximumDepthMeters + 0.01, bedElevationMeters: 0 } ) ), /depth/ );

const source = await readFile( new URL( './gpu-swe-owner.js', import.meta.url ), 'utf8' );
for ( const required of [
	'sparse-swe:halo-and-boundary', 'sparse-swe:x-face-flux', 'sparse-swe:z-face-flux',
	'sparse-swe:cell-update', 'sparse-swe:foam-transport-reaction', 'sparse-swe:inject-rollback-mutation', 'sparse-swe:candidate-validation', 'sparse-swe:atomic-commit',
	'for ( const dispatch of stepGraph ) renderer.compute( dispatch )', 'receipt.assign( atomicAdd',
	'dispatchRollbackMutationProbe', 'resourceInventory', 'backendAllocatedBytes: null',
	'getArrayBufferAsync( diagnosticBuffer', 'frameCriticalReadbackCount: 0', 'disposed,',
	'assessCharacteristicCompatibility', 'incoming = donorNormalDischarge.sub', 'outgoing = interiorNormalDischarge.add'
] ) assert.ok( source.includes( required ), `GPU SWE owner is missing '${ required }'` );
for ( const required of [ 'foamPingPong', 'foamCommittedBuffer', 'foamCandidateBuffer', 'foamCoveredCells', 'foamSourceRateQuanta', 'foamClampCells', 'foamCoverageQuanta' ] ) assert.ok( source.includes( required ), `GPU foam transaction is missing '${ required }'` );
for ( const required of [ 'netFluxInfluxDepthQuanta', 'netFluxOutfluxDepthQuanta', 'boundaryInfluxDepthQuanta', 'boundaryOutfluxDepthQuanta', 'internalFluxCancellationDepthQuanta', 'expectedPlusInflux', 'candidatePlusOutflux' ] ) assert.ok( source.includes( required ), `GPU SWE open-boundary ledger is missing '${ required }'` );
assert.ok( ! source.includes( 'atomicStore(' ), 'Three r185 atomicStore lowering must not reintroduce invalid void-as-uint WGSL' );
assert.ok( source.indexOf( 'getArrayBufferAsync( diagnosticBuffer' ) > source.indexOf( 'async function captureDiagnostics' ), 'GPU readback escaped the diagnostic-only method' );

console.log( `GPU SWE owner contract passed: ${ initial.residentTileCount } resident tiles, ${ initial.residentCellCount } cells, ${ contract.dispatchOrder.length } ordered dispatches, 2 rejection controls` );
