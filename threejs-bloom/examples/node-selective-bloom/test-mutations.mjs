import assert from 'node:assert/strict';
import {
	BLOOM_STAGE_KINDS,
	DEBUG_MODES,
	QUALITY_TIERS,
	calculateBloomDrawingBufferSize,
	calculateBloomPyramidInventory,
	calculateBloomStageResourceInventory,
	computeBloomAcceptanceMetrics,
	createNodeSelectiveBloomExample,
	inferBloomPaddedLayout,
	selectBloomPipelineMode,
	selectBloomStageKind,
	validateBloomConfig
} from './index.js';

assert.throws( () => selectBloomPipelineMode( { isWebGPUBackend: false, requestedTier: 'full' } ), /WebGPU backend required/ );
assert.throws( () => selectBloomPipelineMode( { isWebGPUBackend: true, requestedTier: 'fabricated' } ), /Unknown bloom tier/ );
assert.throws( () => validateBloomConfig( { outputTransformOwners: 2 } ), /exactly one output transform owner/ );
assert.throws( () => validateBloomConfig( { budgets: { sceneRenderCount: 2 } } ), /sceneRenderCount must stay 1/ );
assert.throws( () => inferBloomPaddedLayout( 123, 641, 359 ), /Cannot infer an integer WebGPU row stride/ );
assert.equal( calculateBloomPyramidInventory( 31, 31, 0.5 ).deepestLevelValid, false );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.NO_POST_BASELINE } ), BLOOM_STAGE_KINDS.BASE );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS[ 'reduced-readable-base' ], mode: DEBUG_MODES.COMBINED } ), BLOOM_STAGE_KINDS.BASE );
assert.throws( () => selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: 'fake-free-bloom' } ), /Unknown bloom mode/ );
assert.equal( computeBloomAcceptanceMetrics( { brightMetalBloomEnergy: 2, projectileEmitterBloomEnergy: 100 } ).claims.nonEmissiveIsolation.verdict, 'FAIL' );
assert.equal( computeBloomAcceptanceMetrics( { psfRingEnergies: [ 10, 5, 6, 2 ] } ).claims.pointSpreadFalloff.verdict, 'FAIL' );
assert.equal( computeBloomAcceptanceMetrics( { occludedTransparentEnergy: 2, visibleTransparentControlEnergy: 10 } ).claims.transparentOcclusion.verdict, 'FAIL' );
assert.throws( () => calculateBloomStageResourceInventory( 1200, 800, 0.5, { stageKind: 'hidden-bloom-allocation' } ), /Unknown bloom stage kind/ );
assert.equal( calculateBloomStageResourceInventory( 641, 359, 0.25, { stageKind: BLOOM_STAGE_KINDS.BASE } ).bloomInternal.length, 0 );
assert.throws( () => calculateBloomDrawingBufferSize( 641, 359, 0, 1 ), /pixel ratios must be positive/ );
await assert.rejects( createNodeSelectiveBloomExample( { seed: 0x100000000 } ), /unsigned 32-bit integer/ );

console.log( 'node-selective-bloom mutation contracts: passed' );
