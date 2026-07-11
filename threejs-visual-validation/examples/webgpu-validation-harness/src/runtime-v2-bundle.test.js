import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTraceSegment, bytesPerTexel, classifyPerformanceTrace, summarizeLifecycleEvidence } from './runtime-v2-bundle.js';

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

test( 'runtime bundle format widths include the canonical depth allocation', () => {

	assert.equal( bytesPerTexel( 'rgba16float' ), 8 );
	assert.equal( bytesPerTexel( 'rgba8unorm' ), 4 );
	assert.equal( bytesPerTexel( 'depth32float' ), 4 );
	assert.throws( () => bytesPerTexel( 'depth24plus' ), /does not know the byte width/ );

} );

test( 'trace segments distinguish measured cadence from an authored target', () => {

	const authored = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16 );
	assert.equal( authored.presentationSamples.label, 'Authored' );
	assert.equal( authored.presentationP95.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.label, 'Authored' );
	assert.equal( authored.deadlineMissRatio.value, 1 );

	const measured = buildTraceSegment( [ 2, 4, 6 ], 'unit trace', 16, [ 15, 16, 17, 18 ] );
	assert.equal( measured.presentationSamples.label, 'Measured' );
	assert.deepEqual( measured.presentationSamples.values, [ 15, 16, 17, 18 ] );
	assert.equal( measured.presentationP95.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.label, 'Measured' );
	assert.equal( measured.deadlineMissRatio.value, 0.5 );

} );

test( 'performance classification exposes measured overruns without promoting incomplete passes', () => {

	const gates = { cpuP95: 14, gpuP95: 14, deadlineMissRatio: 0.01 };
	assert.equal( classifyPerformanceTrace( null, gates ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyPerformanceTrace( { cpuP95: 2, gpuP95: 12, deadlineMissRatio: 0 }, gates ), 'INSUFFICIENT_EVIDENCE' );
	assert.equal( classifyPerformanceTrace( { cpuP95: 2, gpuP95: 15, deadlineMissRatio: 0 }, gates ), 'FAIL' );
	assert.equal( classifyPerformanceTrace( { cpuP95: 2, gpuP95: 12, deadlineMissRatio: 0.02 }, gates ), 'FAIL' );
	assert.throws( () => classifyPerformanceTrace( { cpuP95: 2, gpuP95: Number.NaN, deadlineMissRatio: 0 }, gates ), /GPU p95/ );

} );
