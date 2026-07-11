import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { validateLabManifest } from '../../../scripts/lib/lab-validation.mjs';
import { AO_TIERS, createGTAOStage } from '../webgpu-node-gtao/main.js';
import {
	IMAGE_PIPELINE_AO_OWNERS,
	createImagePipelineAOHostAdapter,
	validateImagePipelineAOOwnership
} from './host-adapter.js';
import { INTEGRATION_MODES, INTEGRATION_SCENARIOS } from './main.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const manifest = JSON.parse( await readFile( join( here, 'lab.manifest.json' ), 'utf8' ) );
const integrationSource = await readFile( join( here, 'main.js' ), 'utf8' );
const manifestVerdict = validateLabManifest( manifest, { validateEvidence: false } );
assert.deepEqual( manifestVerdict.errors, [] );
assert.equal( manifest.kind, 'integration-demo' );
assert.equal( manifest.status, 'incomplete' );
assert.equal( manifest.evidenceContract, 'v2' );
assert.equal( manifest.evidenceBundle, null );
assert.deepEqual( manifest.scenarios.map( ( entry ) => entry.id ), INTEGRATION_SCENARIOS );
assert.deepEqual( manifest.modes, INTEGRATION_MODES );
assert.doesNotMatch( integrationSource, /stage\.baselineOutput/, 'integration diagnostics must not make the baseline scene pass reachable as a third submission' );

await access( join( here, 'index.html' ) );
for ( const mechanism of manifest.mechanisms ) await access( join( here, mechanism.route, 'index.html' ) );
for ( const tier of manifest.tiers ) await access( join( here, 'tier', tier.id, 'index.html' ) );

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const renderPipeline = {};
const stage = createGTAOStage( { scene, camera, tier: AO_TIERS.ultra } );
const host = createImagePipelineAOHostAdapter( { renderPipeline, scene, camera } );
host.attachAOStage( stage );
const graph = host.describeRuntimeGraph( { physicalWidth: 1200, physicalHeight: 800, aoScale: 0.5 } );
const ownership = validateImagePipelineAOOwnership( graph );
assert.equal( ownership.valid, true );
assert.equal( graph.schemaVersion, 2 );
assert.equal( graph.sceneSubmissions.length, 2 );
assert.equal( graph.sceneSubmissions.filter( ( pass ) => pass.kind === 'prepass' ).length, 1 );
assert.equal( graph.sceneSubmissions.filter( ( pass ) => pass.kind === 'lit-scene' ).length, 1 );
assert.equal( graph.owners.primaryScenePass, IMAGE_PIPELINE_AO_OWNERS.primaryScenePass );
assert.equal( graph.owners.litScenePass, IMAGE_PIPELINE_AO_OWNERS.litScenePass );
assert.equal( graph.finalToneMapOwner, IMAGE_PIPELINE_AO_OWNERS.toneMap );
assert.equal( graph.finalOutputTransformOwner, IMAGE_PIPELINE_AO_OWNERS.outputTransform );
assert.equal( renderPipeline.outputColorTransform, false );
assert.equal( renderPipeline.needsUpdate, true );
assert.equal( graph.resources.find( ( resource ) => resource.id === 'gtao-visibility' ).residentBytes.value, 240000 );
assert.equal( graph.resources.every( ( resource ) => [ 'Derived', 'Measured' ].includes( resource.residentBytes.label ) ), true );
stage.dispose();

console.log( 'integration-image-pipeline-ao unit contracts: passed' );
