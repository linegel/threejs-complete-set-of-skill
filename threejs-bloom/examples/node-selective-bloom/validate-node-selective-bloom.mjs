import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname( fileURLToPath( import.meta.url ) );
const examplePath = join( here, 'index.js' );
const exampleSource = await readFile( examplePath, 'utf8' );
const browserSource = await readFile( join( here, 'browser.js' ), 'utf8' );
const example = await import( pathToFileURL( examplePath ) );

const {
	BLOOM_MECHANISMS,
	BLOOM_STAGE_KINDS,
	DEBUG_MODES,
	QUALITY_TIERS,
	calculateBloomPyramidInventory,
	inferBloomPaddedLayout,
	selectBloomPipelineMode,
	selectBloomStageKind,
	validateBloomConfig
} = example;

const reduced = selectBloomPipelineMode( {
	isWebGPUBackend: true,
	requestedTier: 'reduced-readable-base'
} );

assert.equal( reduced.dynamicMrt, false );
assert.equal( reduced.liveBloom, false );
assert.equal( reduced.contributionPolicy, 'disabled-in-reduced-tier' );
assert.match( reduced.budgetReason.join( ' ' ), /dynamic MRT emissive bloom disabled/ );
assert.equal( selectBloomStageKind( { quality: reduced, mode: DEBUG_MODES.COMBINED } ), BLOOM_STAGE_KINDS.BASE );

for ( const tierName of [ 'full', 'balanced', 'mobile' ] ) {

	const tier = selectBloomPipelineMode( { isWebGPUBackend: true, requestedTier: tierName } );
	assert.equal( tier.dynamicMrt, true );
	assert.equal( tier.liveBloom, true );
	assert.equal( tier.contributionPolicy, 'mrt-emissive' );

}

assert.throws( () => selectBloomPipelineMode( { isWebGPUBackend: false } ), /WebGPU backend required/ );
assert.throws( () => selectBloomPipelineMode( { isWebGPUBackend: true, requestedTier: 'invented-cheaper-tier' } ), /Unknown bloom tier/ );
assert.throws( () => validateBloomConfig( { controls: { threshold: Number.POSITIVE_INFINITY } } ), /Invalid bloom config/ );

assert.deepEqual( Object.keys( QUALITY_TIERS ), [ 'full', 'balanced', 'mobile', 'reduced-readable-base' ] );
assert.equal( BLOOM_MECHANISMS.length, 6 );
assert.equal( DEBUG_MODES.TRANSPARENT_EMITTER, 'transparent-emitter' );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.NO_POST_BASELINE } ), BLOOM_STAGE_KINDS.BASE );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.EMISSIVE_ONLY } ), BLOOM_STAGE_KINDS.SELECTIVE );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.COMBINED } ), BLOOM_STAGE_KINDS.BLOOM );

assert.match( exampleSource, /mrtOutputs\s*=\s*\{\s*output\s*,\s*emissive\s*\}/ );
assert.match( exampleSource, /const LAB_ID = 'node-selective-bloom'/ );
assert.match( exampleSource, /get labId\(\) \{ return LAB_ID; \}/ );
assert.match( exampleSource, /labId:\s*LAB_ID/ );
assert.match( browserSource, /window\.labController = controller/ );
assert.match( exampleSource, /if\s*\(\s*validationDiagnostics\s*===\s*true\s*\)\s*\{[\s\S]*?mrtOutputs\.transparentEmitter/ );
assert.match( exampleSource, /materialReference\(\s*'userData\.transparentEmitterMask'\s*,\s*'float'\s*\)/ );
assert.match( exampleSource, /sceneMRT\.setBlendMode\(\s*'emissive'\s*,\s*materialBlend\s*\)/ );
assert.match( exampleSource, /sceneMRT\.setBlendMode\(\s*'transparentEmitter'\s*,\s*materialBlend\s*\)/ );
assert.match( exampleSource, /material\.premultipliedAlpha\s*=\s*true/ );
assert.match( exampleSource, /material\.emissiveNode\s*=\s*premultipliedEmission/ );
assert.doesNotMatch( exampleSource, /material\.mrtNode\s*=/ );
assert.match( exampleSource, /vec4\(\s*sceneColor\.rgb\.add\(\s*bloomOutput\.rgb\s*\)\s*,\s*sceneColor\.a\s*\)/ );
assert.doesNotMatch( exampleSource, /renderOutput\(\s*sceneColor\.add\(\s*bloomOutput\s*\)\s*\)/ );
assert.match( exampleSource, /renderPipeline\.outputColorTransform\s*=\s*false/ );
assert.match( exampleSource, /selectiveScenePass\s*=\s*pass\(\s*scene\s*,\s*camera\s*,\s*\{\s*samples\s*:\s*0\s*\}\s*\)/ );
assert.match( exampleSource, /baseScenePass\s*=\s*pass\(\s*scene\s*,\s*camera\s*,\s*\{\s*samples\s*:\s*0\s*\}\s*\)/ );
assert.match( exampleSource, /productionMRT\s*:\s*hasSelectiveMRT\s*\?\s*\[\s*'output'\s*,\s*'emissive'\s*\]/ );
assert.match( exampleSource, /stageKind:\s*selectBloomStageKind/ );
assert.match( exampleSource, /stage\.dispose\(\);[\s\S]*?stage\s*=\s*createSelectiveBloomStage/ );
assert.match( exampleSource, /calculateBloomStageResourceInventory\(\s*physical\.width\s*,\s*physical\.height/ );
assert.match( exampleSource, /id:\s*'scene-depth'/ );
assert.match( exampleSource, /gpuTiming\s*:\s*\{\s*verdict\s*:\s*'INSUFFICIENT_EVIDENCE'\s*,\s*samples\s*:\s*\[\s*\]/ );
assert.match( exampleSource, /inferBloomPaddedLayout/ );
assert.doesNotMatch( exampleSource, /pixels\.length\s*\/\s*height/ );

const inventory = calculateBloomPyramidInventory( 1920, 1080, 0.5 );
assert.equal( inventory.fullscreenDrawCount, 12 );
assert.equal( inventory.bright.width, 960 );
assert.equal( inventory.bright.height, 540 );
assert.equal( inventory.internalBytes, 15193920 );
assert.equal( inventory.mips.length, 5 );
assert.ok( inventory.mips.every( ( mip, index, list ) => index === 0 || mip.width <= list[ index - 1 ].width ) );

assert.deepEqual( inferBloomPaddedLayout( 4864 * 799 + 4800, 1200, 800 ), {
	bytesPerTexel: 4,
	rowBytes: 4800,
	bytesPerRow: 4864
} );

console.log( 'validate-node-selective-bloom: passed' );
