import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE,
	OCEAN_COMBINED_STORAGE_TEXTURES,
	OCEAN_COMPUTE_BINDING_REQUIREMENTS,
	OCEAN_MECHANISM_ROUTES,
	OCEAN_QUALITY_TIERS,
	countOceanStorageTextures,
	mergeOceanConfig,
	validateOceanCapabilities,
	validateOceanConfig
} from './constants.js';
import { advanceLagrangianOceanFoam, combineOceanSurfaceSamples } from './combined-surface-oracle.js';
import { createOceanSurfaceMaterial } from './ocean-nodes.js';
import { WebGPUFftOcean } from './ocean-system.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const assert = ( condition, message ) => { if ( ! condition ) throw new Error( message ); };
const source = ( name ) => readFileSync( join( here, name ), 'utf8' );
const killed = [];
const kill = ( name, condition, message ) => {
	assert( condition, `Mutation survived (${ name }): ${ message }` );
	killed.push( name );
};

const samples = [
	{ displacementX: 0, height: 0, displacementZ: 0, slopeX: 0.2, slopeZ: 0.1, displacementXX: - 0.2, displacementZZ: 0.1, displacementXZ: 0.12 },
	{ displacementX: 0, height: 0, displacementZ: 0, slopeX: - 0.1, slopeZ: 0.05, displacementXX: 0.08, displacementZZ: - 0.04, displacementXZ: - 0.03 }
];
const combined = combineOceanSurfaceSamples( samples );
const perCascadeJacobianSum = samples.reduce( ( total, sample ) => total + ( 1 + sample.displacementXX ) * ( 1 + sample.displacementZZ ) - sample.displacementXZ ** 2, 0 );
kill( 'additive-jacobians', Math.abs( combined.jacobian - perCascadeJacobianSum ) > 0.1, 'per-cascade determinants were treated as additive' );

const history = advanceLagrangianOceanFoam( 0.65, 0, 0.25, 0.22 );
kill( 'stateless-foam', history > 0 && history < 0.65, 'foam history was replaced by a stateless threshold' );

let rejectedUnknownTier = false;
try { validateOceanConfig( mergeOceanConfig( { quality: 'invented-cheaper-tier' } ) ); } catch { rejectedUnknownTier = true; }
kill( 'unknown-tier-fallback', rejectedUnknownTier, 'unknown tier silently inherited another configuration' );

const fakeRenderer = ( storageLimit ) => ( {
	initialized: true,
	backend: { isWebGPUBackend: true, device: { limits: { maxStorageTexturesPerShaderStage: storageLimit } } },
	hasFeature: () => false,
	compute() {},
	getRenderTarget: () => null,
	setRenderTarget() {}
} );
const threeBindingCapabilities = validateOceanCapabilities( fakeRenderer( 3 ), mergeOceanConfig( { quality: 'low' } ) );
kill( 'three-binding-minimum', threeBindingCapabilities.nativeStorage === false, 'adapter limit 3 was accepted although spectrum initialization binds 4 storage textures' );
kill(
	'portable-layout-overflow',
	Math.max( ...Object.entries( OCEAN_COMPUTE_BINDING_REQUIREMENTS ).filter( ( [ name ] ) => name !== 'fusedAssembly' ).map( ( [ , count ] ) => count ) ) === 4,
	'portable layout no longer matches the four-binding gate'
);

const manifest = JSON.parse( source( 'lab.manifest.json' ) );
const startupModes = manifest.mechanisms.map( ( mechanism ) => mechanism.startup?.mode );
kill( 'aliased-mechanism-routes', startupModes.length === 6 && new Set( startupModes ).size === 6, 'mechanism routes share a startup mode' );
kill(
	'fake-below-surface-route',
	manifest.mechanisms.find( ( mechanism ) => mechanism.id === 'above-and-below-surface' )?.startup?.camera === 'underwater',
	'optics route does not start below the interface'
);
kill(
	'partial-source-hash',
	manifest.canonicalSource.length === 1 && manifest.canonicalSource[ 0 ] === 'threejs-spectral-ocean/examples/webgpu-fft-ocean',
	'source hash covers only a hand-picked file list'
);

for ( const id of OCEAN_MECHANISM_ROUTES ) {
	const wrapper = join( here, 'canonical-targets', 'mechanism', id, 'index.html' );
	kill( `missing-mechanism-wrapper:${ id }`, existsSync( wrapper ) && source( `canonical-targets/mechanism/${ id }/index.html` ).includes( '../../../lab-app.js' ), `${ id } wrapper does not import the canonical app` );
}
for ( const id of Object.keys( OCEAN_QUALITY_TIERS ) ) {
	const wrapper = join( here, 'canonical-targets', 'tier', id, 'index.html' );
	kill( `missing-tier-wrapper:${ id }`, existsSync( wrapper ) && source( `canonical-targets/tier/${ id }/index.html` ).includes( '../../../lab-app.js' ), `${ id } wrapper does not import the canonical app` );
}

const systemSource = source( 'ocean-system.js' );
const nodeSource = source( 'ocean-nodes.js' );
const appSource = source( 'lab-app.js' );
const computeSource = source( 'compute-kernels.js' );
const captureSource = source( 'capture.mjs' );
const artifactSource = source( 'validate-artifacts.mjs' );

kill(
	'shared-atlas-resurrection',
	![ systemSource, nodeSource, computeSource ].some( ( text ) => /sharedFoamTextures|createFilteredFoamSourceNode|foamAtlasSizeMeters/.test( text ) ),
	'an undersampled shared surface/foam atlas re-entered the runtime'
);
kill(
	'geometry-normal-band-mismatch',
	/partitionGeometryBands/.test( nodeSource ) && /resolvedNormalLocal/.test( nodeSource ) && /footprint\.mul\( cascade\.cutoffHigh \)/.test( nodeSource ),
	'resolved geometry and shading detail no longer have explicit bandwidth filters'
);
kill(
	'zero-vector-tir-normalization',
	/max\( length\( rawRefracted \), 1e-6 \)/.test( nodeSource ),
	'TIR can normalize a zero refracted vector'
);
kill(
	'nondeterministic-fixed-time-foam',
	/while \( replayCursor \+ replayStep <= replayTime/.test( appSource ) && !/ocean\.update\( seconds, 0 \)/.test( appSource ),
	'setTime does not replay temporal foam with fixed nonzero steps'
);
kill(
	'cpu-query-label-only',
	/refreshCpuQueryProbes/.test( appSource ) && /sampleAtWorldXZ/.test( appSource ) && /ocean-cpu-query-probe-/.test( appSource ),
	'CPU-query route has labels but no runtime probes'
);
kill(
	'external-prestarted-capture',
	/captureLabBrowser/.test( captureSource ) && !/LAB_URL/.test( captureSource ) && !/from ['"]playwright['"]/.test( captureSource ),
	'capture bypasses the shared self-serving harness'
);
kill(
	'weak-artifact-validator',
	/validateEvidenceBundle/.test( artifactSource ) && /requireRequiredClaimsPass: true/.test( artifactSource ) && /buildDemoRegistry/.test( artifactSource ) && /lab\.sourceHash/.test( artifactSource ),
	'artifact validation does not enforce strict shared v2 plus registry source identity'
);

const localPackage = JSON.parse( source( 'package.json' ) );
kill( 'nested-dependency-drift', ! localPackage.dependencies && ! existsSync( join( here, 'package-lock.json' ) ), 'local browser dependencies or lockfile shadow the root toolchain' );

const ocean = new WebGPUFftOcean( fakeRenderer( 4 ), { quality: 'low' } );
const dispatches = ocean.describeDispatches();
kill( 'fft-omitted-from-runtime-graph', dispatches.frameNodes.some( ( name ) => name.includes( 'ocean:fft:stage-' ) ), 'runtime graph omits FFT stages' );
kill( 'foam-omitted-from-runtime-graph', dispatches.frameNodes.some( ( name ) => name.includes( 'ocean:foam-history:cascade-' ) ), 'runtime graph omits per-cascade foam history' );
const expectedTextures = ( OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE + 2 ) * ocean.config.cascadeCount + OCEAN_COMBINED_STORAGE_TEXTURES;
kill( 'resource-ledger-drift', ocean.describeResources().textures.length === expectedTextures && countOceanStorageTextures( ocean.config ) === expectedTextures, 'reported storage does not equal allocated storage' );
const foamState = ocean.combinedSurface;
kill( 'dropped-foam-band', foamState.cascades.length === ocean.config.cascadeCount && foamState.filterContract.omittedCascadeIndices.length === 0, 'foam composition drops a cascade band' );
const material = createOceanSurfaceMaterial( ocean.materialCascades, { combinedSurface: foamState } );
kill( 'missing-band-contract', material.userData.geometryBandContract.resolvedCascadeIndices.length > 0, 'material exposes no resolved geometry-band contract' );
material.dispose();
ocean.dispose();

console.log( JSON.stringify( { pass: true, mutationsKilled: killed }, null, 2 ) );
