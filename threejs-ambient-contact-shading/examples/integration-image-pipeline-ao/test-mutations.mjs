import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { AO_TIERS, createGTAOStage } from '../webgpu-node-gtao/main.js';
import {
	createImagePipelineAOHostAdapter,
	validateImagePipelineAOOwnership
} from './host-adapter.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const stage = createGTAOStage( { scene, camera, tier: AO_TIERS.ultra } );
const host = createImagePipelineAOHostAdapter( { renderPipeline: {}, scene, camera } );
host.attachAOStage( stage );
assert.throws( () => host.attachAOStage( stage ), /shared gbuffer owner is already attached/ );
const baseline = host.describeRuntimeGraph( { physicalWidth: 641, physicalHeight: 359, aoScale: 0.5 } );

function mutated( change ) {

	const graph = structuredClone( baseline );
	change( graph );
	return validateImagePipelineAOOwnership( graph );

}

assert.equal( mutated( ( graph ) => graph.sceneSubmissions.push( { id: 'duplicate-prepass', owner: 'threejs-image-pipeline-host', kind: 'prepass' } ) ).valid, false );
assert.equal( mutated( ( graph ) => graph.sceneSubmissions = graph.sceneSubmissions.filter( ( pass ) => pass.kind !== 'lit-scene' ) ).valid, false );
assert.equal( mutated( ( graph ) => graph.owners.primaryScenePass = 'private-ao-gbuffer' ).valid, false );
assert.equal( mutated( ( graph ) => graph.signals.push( { ...graph.signals[ 0 ] } ) ).valid, false );
assert.equal( mutated( ( graph ) => graph.resources.push( { ...graph.resources[ 0 ] } ) ).valid, false );
assert.equal( mutated( ( graph ) => graph.finalToneMapOwner = 'second-tone-map-owner' ).valid, false );
assert.equal( mutated( ( graph ) => graph.finalOutputTransformOwner = 'second-output-owner' ).valid, false );
assert.equal( mutated( ( graph ) => graph.computeDispatches.push( { id: 'fabricated-compute', owner: 'ao', workgroups: {} } ) ).valid, false );

stage.dispose();
console.log( 'integration-image-pipeline-ao mutation contracts: passed' );
