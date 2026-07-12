import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { buildDemoRegistry } from '../../../scripts/lib/lab-registry.mjs';
import { validateLabManifest } from '../../../scripts/lib/lab-validation.mjs';
import {
	AO_DEBUG_MODES,
	AO_MECHANISMS,
	AO_SCENARIOS,
	AO_TIERS,
	calculateAOResourceInventory,
	computeAOAcceptanceMetrics,
	createGTAOStage,
	describeAOModeReachability,
	inferPaddedLayout
} from './main.js';
import { validateAOConfig, validateExampleSourceContracts } from './validate.js';
import { resolveAORoute } from './routes.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const manifest = JSON.parse( await readFile( join( here, 'lab.manifest.json' ), 'utf8' ) );
const registryManifest = buildDemoRegistry().demos.find( ( entry ) => entry.id === manifest.id );
const canonicalTargets = JSON.parse( await readFile( join( here, '../../../labs/canonical-targets.json' ), 'utf8' ) );
const canonicalTarget = canonicalTargets.targets.find( ( target ) => target.id === 'webgpu-node-gtao' );
const packageJson = JSON.parse( await readFile( join( here, 'package.json' ), 'utf8' ) );
const captureSource = await readFile( join( here, 'capture.mjs' ), 'utf8' );
const standardScripts = [ 'check', 'validate:unit', 'test:mutations', 'capture', 'validate:artifacts', 'validate:quick', 'validate:full' ];

assert.equal( manifest.schemaVersion, 2 );
assert.equal( manifest.kind, 'canonical-lab' );
assert.equal( manifest.status, 'incomplete', 'GPU acceptance must remain incomplete until real browser evidence exists.' );
assert.equal( manifest.threeRevision, '0.185.1' );
assert.equal( manifest.id, canonicalTarget.id );
assert.equal( manifest.skill, canonicalTarget.skill );
assert.deepEqual( manifest.mechanisms.map( ( item ) => item.id ), AO_MECHANISMS );
assert.deepEqual( manifest.tiers.map( ( item ) => item.id ), Object.keys( AO_TIERS ) );
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
assert.doesNotMatch( captureSource, /final-lit-hdr/ );
assert.ok( AO_SCENARIOS.includes( 'moving-occluder' ) );
assert.ok( Object.values( AO_DEBUG_MODES ).includes( 'bent-normal' ) );

for ( const route of manifest.mechanisms ) {

	await access( join( here, route.route, 'index.html' ) );
	assert.equal( resolveAORoute( `/demos/webgpu-node-gtao/${ route.route }` ).mechanism, route.id );
	assert.match( await readFile( join( here, route.route, 'index.html' ), 'utf8' ), /src="\.\.\/\.\.\/browser\.js"/ );

}
for ( const tier of manifest.tiers ) {

	await access( join( here, 'tier', tier.id, 'index.html' ) );
	assert.equal( resolveAORoute( `/demos/webgpu-node-gtao/tier/${ tier.id }/` ).tier, tier.id );
	assert.match( await readFile( join( here, 'tier', tier.id, 'index.html' ), 'utf8' ), /src="\.\.\/\.\.\/browser\.js"/ );

}
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/mechanism/not-real/' ), /Unknown AO mechanism route/ );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/tier/not-real/' ), /Unknown AO tier route/ );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/mechanism/' ), /missing an id/ );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/tier/' ), /missing an id/ );
assert.deepEqual(
	resolveAORoute( '/demos/webgpu-node-gtao/', '?tier=medium&scenario=sky-edge&mode=raw-depth&seed=2654435769&camera=far&time=1.25' ),
	{
		mechanism: null,
		tier: 'medium',
		scenario: 'sky-edge',
		mode: 'raw-depth',
		seed: 2654435769,
		camera: 'far',
		time: 1.25
	}
);
assert.equal( resolveAORoute( '/demos/webgpu-node-gtao/mechanism/scalar-gtao/', '?scenario=sky-edge&mode=disabled' ).scenario, 'wall-receiver' );
assert.equal( resolveAORoute( '/demos/webgpu-node-gtao/', '?mechanism=temporal-ao&scenario=sky-edge&mode=disabled' ).mode, 'temporal-ao' );
assert.equal( resolveAORoute( '/demos/webgpu-node-gtao/tier/high/', '?tier=medium' ).tier, 'high' );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/', '?mechanism=not-real' ), /Unknown AO mechanism query/ );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/', '?camera=side' ), /Unknown AO camera query/ );
assert.throws( () => resolveAORoute( '/demos/webgpu-node-gtao/', '?time=NaN' ), /AO time query must be finite/ );

assert.deepEqual( inferPaddedLayout( 4864 * 799 + 4800, 1200, 800 ), {
	bytesPerTexel: 4,
	rowBytes: 4800,
	bytesPerRow: 4864
} );
assert.deepEqual( inferPaddedLayout( 768 * 358 + 641, 641, 359 ), {
	bytesPerTexel: 1,
	rowBytes: 641,
	bytesPerRow: 768
} );
assert.throws( () => inferPaddedLayout( 123, 641, 359 ), /Cannot infer an integer WebGPU row stride/ );

assert.equal( describeAOModeReachability( AO_DEBUG_MODES.final ).sceneSubmissionCount, 2 );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.rawAO ).sceneSubmissionCount, 1 );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.indirectDelta ).sceneSubmissionCount, 3 );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.disabled ).sceneSubmissionCount, 1 );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.disabled ).gbufferPrepassCount, 0 );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.final, { temporalEnabled: true } ).passes.temporalResolve, true );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.denoisedAO, { reconstruction: 'raw' } ).passes.reconstruction, true );

const resourceInventory = calculateAOResourceInventory( 1200, 800, 1, 'ultra', { mode: AO_DEBUG_MODES.final, temporalEnabled: false } );
assert.deepEqual( resourceInventory.physicalSize, [ 1200, 800 ] );
assert.deepEqual( resourceInventory.aoSize, [ 600, 400 ] );
assert.ok( resourceInventory.resources.some( ( resource ) => resource.id === 'gbuffer-depth' && resource.reachable === true ) );
assert.ok( resourceInventory.resources.some( ( resource ) => resource.id === 'baseline-depth' && resource.reachable === false ) );
assert.ok( resourceInventory.resources.some( ( resource ) => resource.id === 'bent-normal-diagnostic' && resource.logicalAllocation === 'graph-owned' ) );
assert.ok( resourceInventory.resources.some( ( resource ) => resource.id === 'traa-history-depth' && resource.format === 'depth24plus' && resource.logicalBytes === null && resource.reachable === false ) );
assert.ok( resourceInventory.knownLogicalBytesLowerBound > resourceInventory.reachableKnownLogicalBytesLowerBound );
assert.equal( resourceInventory.logicalAllocatedBytes.verdict, 'INSUFFICIENT_EVIDENCE' );
assert.deepEqual( calculateAOResourceInventory( 641, 359, 1.5, 'medium' ).physicalSize, [ 961, 538 ] );

const pendingMetrics = computeAOAcceptanceMetrics();
assert.ok( Object.values( pendingMetrics.claims ).every( ( claim ) => claim.verdict === 'INSUFFICIENT_EVIDENCE' ) );
const passingMetrics = computeAOAcceptanceMetrics( {
	skyVisibility: 0.99,
	openReceiverVisibility: 0.9,
	contactVisibility: 0.8,
	directLuminanceBefore: 10,
	directLuminanceAfter: 9.9,
	emissiveLuminanceBefore: 8,
	emissiveLuminanceAfter: 8.05,
	thinSilhouetteLeakage: 0.02,
	projectedFootprintLandscape: 100,
	projectedFootprintPortrait: 95,
	rawVariance: 0.04,
	denoisedVariance: 0.02,
	edgeLeakage: 0.02,
	bentNormalWallDot: 0.4,
	bentNormalRotationError: 0.01,
	temporalResetError: 0.002,
	disabledAOReachable: false
} );
assert.ok( Object.values( passingMetrics.claims ).every( ( claim ) => claim.verdict === 'PASS' ) );

assert.equal( validateAOConfig().pass, true );
assert.equal( validateExampleSourceContracts(), true );

const mainSource = await readFile( join( here, 'main.js' ), 'utf8' );
assert.match( mainSource, /diagnostic-readback-rgba8/ );
assert.match( mainSource, /readbackRoute:\s*'explicit-single-attachment-staging-target'/ );
assert.doesNotMatch( mainSource, /captureTarget\( renderer, stage\.[^)]+renderTarget/ );

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const stage = createGTAOStage( { scene, camera } );
assert.deepEqual( Object.keys( stage.gbufferPass.getMRT().outputNodes ), [ 'output', 'normal', 'velocity' ] );
assert.equal( stage.reconstruction, 'denoised' );
stage.dispose();

console.log( 'webgpu-node-gtao unit contracts: passed' );
