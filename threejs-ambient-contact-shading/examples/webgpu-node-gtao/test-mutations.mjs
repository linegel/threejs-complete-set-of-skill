import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	AO_DEBUG_MODES,
	calculateAOResourceInventory,
	computeAOAcceptanceMetrics,
	createWebGPUNodeGTAO,
	describeAOModeReachability
} from './main.js';
import { validateAOConfig, validateExampleSourceContracts } from './validate.js';

const source = await readFile( new URL( './main.js', import.meta.url ), 'utf8' );

assert.throws(
	() => validateExampleSourceContracts( source.replace( 'renderPipeline.outputColorTransform = false;', '' ) ),
	/sole tone-map\/output-transform owner/
);
assert.throws(
	() => validateExampleSourceContracts( source.replace( 'const layout = inferPaddedLayout( source.byteLength, width, height );', 'const layout = { bytesPerRow: pixels.length / height };' ) ),
	/256-byte-aligned row stride/
);
assert.throws(
	() => validateAOConfig( { depthMode: 'reversed', renderer: { reversedDepthBuffer: true } } ),
	/standard non-reversed depth only/
);
assert.throws(
	() => validateAOConfig( { enabled: false, disabledPassBypass: false } ),
	/bypass the AO graph/
);
assert.throws(
	() => validateAOConfig( { temporal: true, velocitySource: null, depthRejection: true } ),
	/velocity source/
);
assert.equal( computeAOAcceptanceMetrics( { skyVisibility: 0.5 } ).claims.skyVisibility.verdict, 'FAIL' );
assert.equal( computeAOAcceptanceMetrics( { disabledAOReachable: true } ).claims.disabledBypass.verdict, 'FAIL' );
assert.equal( describeAOModeReachability( AO_DEBUG_MODES.indirectDelta ).sceneSubmissionCount, 3 );
assert.throws( () => describeAOModeReachability( 'invented-cheap-mode' ), /Unknown AO mode/ );
assert.throws( () => calculateAOResourceInventory( 0, 359, 1 ), /positive integers/ );
const disabledInventory = calculateAOResourceInventory( 641, 359, 1, 'medium', { mode: AO_DEBUG_MODES.disabled } );
assert.equal( disabledInventory.resources.find( ( resource ) => resource.id === 'gbuffer-depth' ).reachable, false );
assert.equal( disabledInventory.resources.find( ( resource ) => resource.id === 'baseline-output' ).reachable, true );
await assert.rejects( createWebGPUNodeGTAO( { seed: -1 } ), /unsigned 32-bit integer/ );

console.log( 'webgpu-node-gtao mutation contracts: passed' );
