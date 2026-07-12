import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { buildDemoRegistry } from '../../../scripts/lib/lab-registry.mjs';
import { validateLabManifest } from '../../../scripts/lib/lab-validation.mjs';
import {
	BLOOM_MECHANISMS,
	BLOOM_STAGE_KINDS,
	DEBUG_MODES,
	QUALITY_TIERS,
	calculateBloomDrawingBufferSize,
	calculateBloomPyramidInventory,
	calculateBloomStageResourceInventory,
	computeBloomAcceptanceMetrics,
	createSelectiveBloomStage,
	selectBloomStageKind
} from './index.js';
import { resolveBloomRoute } from './routes.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const manifest = JSON.parse( await readFile( join( here, 'lab.manifest.json' ), 'utf8' ) );
const registryManifest = buildDemoRegistry().demos.find( ( entry ) => entry.id === manifest.id );
const canonicalTargets = JSON.parse( await readFile( join( here, '../../../labs/canonical-targets.json' ), 'utf8' ) );
const canonicalTarget = canonicalTargets.targets.find( ( target ) => target.id === 'node-selective-bloom' );
const packageJson = JSON.parse( await readFile( join( here, 'package.json' ), 'utf8' ) );
const captureSource = await readFile( join( here, 'capture.mjs' ), 'utf8' );
const implementationSource = await readFile( join( here, 'index.js' ), 'utf8' );
const standardScripts = [ 'check', 'validate:unit', 'test:mutations', 'capture', 'validate:artifacts', 'validate:quick', 'validate:full' ];

assert.equal( manifest.schemaVersion, 2 );
assert.equal( manifest.kind, 'canonical-lab' );
assert.equal( manifest.status, 'incomplete', 'GPU acceptance stays incomplete until real adapter capture and timing exist.' );
assert.equal( manifest.threeRevision, '0.185.1' );
assert.equal( manifest.id, canonicalTarget.id );
assert.equal( manifest.skill, canonicalTarget.skill );
assert.deepEqual( manifest.mechanisms.map( ( item ) => item.id ), BLOOM_MECHANISMS );
assert.deepEqual( manifest.tiers.map( ( item ) => item.id ), Object.keys( QUALITY_TIERS ) );
assert.deepEqual( manifest.mechanisms.map( ( item ) => item.id ), canonicalTarget.mechanisms );
assert.deepEqual( manifest.tiers.map( ( item ) => item.id ), canonicalTarget.tiers );
assert.deepEqual( manifest.canonicalSource, [ canonicalTarget.canonicalDir ] );
assert.equal( manifest.browserEntry, `${ canonicalTarget.canonicalDir }/index.html` );
assert.equal( manifest.publishPath, `/demos/${ canonicalTarget.id }/` );
assert.equal( manifest.evidenceContract, 'v2' );
assert.ok( registryManifest, `registry contains ${ manifest.id }` );
assert.deepEqual( validateLabManifest( registryManifest, { validateEvidence: false } ).errors, [] );
assert.deepEqual( standardScripts.filter( ( script ) => typeof packageJson.scripts[ script ] !== 'string' ), [] );
assert.match( captureSource, /__LAB_CONTROLLER__\.capturePixels/ );
assert.match( captureSource, /odd-641x359/ );
assert.match( captureSource, /INSUFFICIENT_EVIDENCE/ );
assert.match( captureSource, /mechanism-metrics\.json/ );
assert.match( captureSource, /resident-resources\.json/ );
assert.doesNotMatch( captureSource, /page\.screenshot/ );

for ( const route of manifest.mechanisms ) {

	await access( join( here, route.route, 'index.html' ) );
	assert.equal( resolveBloomRoute( `/demos/node-selective-bloom/${ route.route }` ).mechanism, route.id );
	assert.match( await readFile( join( here, route.route, 'index.html' ), 'utf8' ), /src="\.\.\/\.\.\/browser\.js"/ );

}
for ( const tier of manifest.tiers ) {

	await access( join( here, 'tier', tier.id, 'index.html' ) );
	assert.equal( resolveBloomRoute( `/demos/node-selective-bloom/tier/${ tier.id }/` ).tier, tier.id );
	assert.match( await readFile( join( here, 'tier', tier.id, 'index.html' ), 'utf8' ), /src="\.\.\/\.\.\/browser\.js"/ );

}
assert.equal( resolveBloomRoute( '/demos/node-selective-bloom/mechanism/transparent-emitters/' ).validationDiagnostics, true );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/mechanism/not-real/' ), /Unknown bloom mechanism route/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/tier/not-real/' ), /Unknown bloom tier route/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/mechanism/' ), /missing an id/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/tier/' ), /missing an id/ );
assert.deepEqual(
	resolveBloomRoute( '/demos/node-selective-bloom/', '?mechanism=point-spread-function&tier=balanced&seed=2654435769&camera=far&time=1.5&validation=1' ),
	{
		mechanism: 'point-spread-function',
		tier: 'balanced',
		scenario: 'point-spread-function',
		mode: 'point-spread-function',
		seed: 2654435769,
		camera: 'far',
		time: 1.5,
		validationDiagnostics: true
	}
);
assert.equal( resolveBloomRoute( '/demos/node-selective-bloom/mechanism/threshold-and-knee/', '?mechanism=point-spread-function&scenario=depth-and-occlusion&mode=no-post-baseline' ).mechanism, 'threshold-and-knee' );
assert.equal( resolveBloomRoute( '/demos/node-selective-bloom/tier/mobile/', '?tier=full' ).tier, 'mobile' );
assert.equal( resolveBloomRoute( '/demos/node-selective-bloom/', '?scenario=depth-and-occlusion&mode=no-post-baseline' ).mode, 'no-post-baseline' );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/', '?mechanism=not-real' ), /Unknown bloom mechanism query/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/', '?tier=cheap' ), /Unknown bloom tier query/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/', '?camera=side' ), /Unknown bloom camera query/ );
assert.throws( () => resolveBloomRoute( '/demos/node-selective-bloom/', '?validation=yes' ), /must be 0 or 1/ );
assert.match( implementationSource, /mechanism:\s*mechanismId/ );

const fullInventory = calculateBloomPyramidInventory( 1920, 1080, 0.5 );
assert.equal( fullInventory.internalBytes, 15193920 );
assert.equal( fullInventory.deepestLevelValid, true );
assert.equal( calculateBloomPyramidInventory( 30, 30, 0.5 ).deepestLevelValid, false );
assert.deepEqual( calculateBloomDrawingBufferSize( 641, 359, 1.5, 2 ), { effectiveDpr: 1.5, width: 961, height: 538 } );
assert.deepEqual( calculateBloomDrawingBufferSize( 641, 359, 2, 1 ), { effectiveDpr: 1, width: 641, height: 359 } );

const baseResources = calculateBloomStageResourceInventory( 1200, 800, 0.5, { stageKind: BLOOM_STAGE_KINDS.BASE, validationDiagnostics: true } );
assert.deepEqual( baseResources.productionAttachments.map( ( resource ) => resource.id ), [ 'output', 'scene-depth' ] );
assert.deepEqual( baseResources.validationOnlyAttachments, [] );
assert.deepEqual( baseResources.bloomInternal, [] );
assert.equal( baseResources.derivedPyramid, null );
assert.equal( baseResources.productionAttachments[ 1 ].format, 'depth24plus' );
assert.equal( baseResources.productionAttachments[ 1 ].logicalBytes, null );

const selectiveResources = calculateBloomStageResourceInventory( 1200, 800, 0.33, { stageKind: BLOOM_STAGE_KINDS.SELECTIVE, validationDiagnostics: true } );
assert.deepEqual( selectiveResources.productionAttachments.map( ( resource ) => resource.id ), [ 'output', 'emissive', 'scene-depth' ] );
assert.deepEqual( selectiveResources.validationOnlyAttachments.map( ( resource ) => resource.id ), [ 'transparentEmitter' ] );
assert.deepEqual( selectiveResources.bloomInternal, [] );

const bloomResources = calculateBloomStageResourceInventory( 1200, 800, 0.25, { stageKind: BLOOM_STAGE_KINDS.BLOOM } );
assert.equal( bloomResources.bloomInternal.length, 11 );
assert.equal( bloomResources.derivedPyramid.mips.length, 5 );
assert.ok( bloomResources.knownLogicalBytesLowerBound > baseResources.knownLogicalBytesLowerBound );
assert.equal( bloomResources.logicalAllocatedBytes.verdict, 'INSUFFICIENT_EVIDENCE' );

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const stage = createSelectiveBloomStage( { scene, camera } );
assert.deepEqual( Object.keys( stage.selectiveScenePass.getMRT().outputNodes ), [ 'output', 'emissive' ] );
assert.equal( stage.validationDiagnostics, false );
assert.equal( stage.stageKind, BLOOM_STAGE_KINDS.BLOOM );
assert.ok( stage.bloomPass );
assert.equal( stage.baseScenePass, null );
stage.dispose();

const validationStage = createSelectiveBloomStage( { scene, camera, validationDiagnostics: true } );
assert.deepEqual( Object.keys( validationStage.selectiveScenePass.getMRT().outputNodes ), [ 'output', 'emissive', 'transparentEmitter' ] );
validationStage.dispose();

const baseStage = createSelectiveBloomStage( { scene, camera, stageKind: BLOOM_STAGE_KINDS.BASE } );
assert.ok( baseStage.baseScenePass );
assert.equal( baseStage.selectiveScenePass, null );
assert.equal( baseStage.bloomPass, null );
baseStage.dispose();

const selectiveStage = createSelectiveBloomStage( { scene, camera, stageKind: BLOOM_STAGE_KINDS.SELECTIVE } );
assert.deepEqual( Object.keys( selectiveStage.selectiveScenePass.getMRT().outputNodes ), [ 'output', 'emissive' ] );
assert.equal( selectiveStage.baseScenePass, null );
assert.equal( selectiveStage.bloomPass, null );
selectiveStage.dispose();

assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.NO_POST_BASELINE } ), BLOOM_STAGE_KINDS.BASE );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.EMISSIVE_ONLY } ), BLOOM_STAGE_KINDS.SELECTIVE );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS.full, mode: DEBUG_MODES.BLOOM_ONLY } ), BLOOM_STAGE_KINDS.BLOOM );
assert.equal( selectBloomStageKind( { quality: QUALITY_TIERS[ 'reduced-readable-base' ], mode: DEBUG_MODES.COMBINED } ), BLOOM_STAGE_KINDS.BASE );

const pendingMetrics = computeBloomAcceptanceMetrics();
assert.ok( Object.values( pendingMetrics.claims ).every( ( claim ) => claim.verdict === 'INSUFFICIENT_EVIDENCE' ) );
const passingMetrics = computeBloomAcceptanceMetrics( {
	brightMetalBloomEnergy: 0.5,
	projectileEmitterBloomEnergy: 100,
	hierarchyPreBloom: [ 4, 8, 16, 32 ],
	hierarchyPostBloom: [ 6, 12, 24, 48 ],
	psfRingEnergies: [ 10, 7, 4, 2, 1 ],
	occludedTransparentEnergy: 0.5,
	visibleTransparentControlEnergy: 50,
	noPostSilhouetteContrast: 0.2
} );
assert.ok( Object.values( passingMetrics.claims ).every( ( claim ) => claim.verdict === 'PASS' ) );

console.log( 'node-selective-bloom unit contracts: passed' );
