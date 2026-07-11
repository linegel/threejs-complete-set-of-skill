import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeLifecycleEvidence } from './runtime-v2-bundle.js';

function lifecycleFixture( mutate = () => {} ) {

	const snapshots = Array.from( { length: 50 }, ( _, cycle ) => ( {
		cycle,
		beforeDispose: {
			backend: { isWebGPUBackend: true },
			rendererInfo: { memory: { total: 1024 + cycle, textures: 2, renderTargets: 1 } }
		},
		afterDispose: {
			backend: { isWebGPUBackend: true },
			rendererInfo: { memory: { total: 0, textures: 0, renderTargets: 0 } }
		},
		resources: {
			renderTargets: [ { bytes: 4096 + cycle } ],
			storageResources: []
		}
	} ) );
	const fixture = { cycles: snapshots.length, snapshots };
	mutate( fixture );
	return fixture;

}

test( 'lifecycle reducer accepts complete native-WebGPU zero-retention evidence', () => {

	const summary = summarizeLifecycleEvidence( lifecycleFixture() );
	assert.equal( summary.cycles, 50 );
	assert.equal( summary.afterRendererBytesMax, 0 );
	assert.equal( summary.targetBytesMin, 4096 );
	assert.equal( summary.targetBytesMax, 4145 );
	assert.equal( summary.storageBytesMax, 0 );

} );

test( 'lifecycle reducer rejects missing, non-WebGPU, and retained-resource cycles', () => {

	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => fixture.snapshots.pop() ) ), /snapshot count/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 7 ].beforeDispose.backend.isWebGPUBackend = false; } ) ), /did not initialize native WebGPU/ );
	assert.throws( () => summarizeLifecycleEvidence( lifecycleFixture( ( fixture ) => { fixture.snapshots[ 12 ].afterDispose.rendererInfo.memory.textures = 1; } ) ), /retained renderer memory/ );

} );
