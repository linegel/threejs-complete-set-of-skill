import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname( fileURLToPath( import.meta.url ) );
const examplePath = join( here, 'index.js' );
const exampleSource = await readFile( examplePath, 'utf8' );
const example = await import( pathToFileURL( examplePath ) );

const {
	DEBUG_MODES,
	selectBloomPipelineMode,
	validateBloomConfig
} = example;

const reduced = selectBloomPipelineMode( {
	isWebGPUBackend: true,
	requestedTier: 'reduced'
} );

assert.equal( reduced.dynamicMrt, false );
assert.equal( reduced.liveBloom, false );
assert.equal( reduced.contributionPolicy, 'disabled-in-reduced-tier' );
assert.match( reduced.budgetReason.join( ' ' ), /dynamic MRT emissive bloom disabled/ );

const full = selectBloomPipelineMode( {
	isWebGPUBackend: true,
	requestedTier: 'full'
} );

assert.equal( full.dynamicMrt, true );
assert.equal( full.liveBloom, true );
assert.equal( full.contributionPolicy, 'mrt-emissive' );

assert.throws(
	() => selectBloomPipelineMode( { isWebGPUBackend: false } ),
	/Error.*WebGPU backend required.*fallback when WebGPU is unavailable.*threejs-compatibility-fallbacks/s
);

assert.throws(
	() => validateBloomConfig( { controls: { threshold: Number.POSITIVE_INFINITY } } ),
	/Invalid bloom config/
);

assert.equal( DEBUG_MODES.TRANSPARENT_EMITTER, 'transparent-emitter' );
assert.match( exampleSource, /transparentEmitter:\s*vec4\(/ );
assert.match( exampleSource, /getTextureNode\(\s*'transparentEmitter'\s*\)/ );
assert.doesNotMatch(
	exampleSource,
	/transparentEmitterContribution\s*=\s*quality\.dynamicMrt\s*===\s*true\s*\?\s*emissiveContribution/
);

const resizeSource = exampleSource.slice(
	exampleSource.indexOf( 'function resize' ),
	exampleSource.indexOf( 'function setBloomControls' )
);

assert.match(
	resizeSource,
	/if\s*\(\s*bloomPass\s*!==\s*null\s*\)\s*bloomPass\.setSize\(\s*width,\s*height\s*\);/
);
assert.doesNotMatch(
	resizeSource,
	/\n\s*bloomPass\.setSize\(\s*width,\s*height\s*\);/
);

console.log( 'validate-node-selective-bloom: passed' );
