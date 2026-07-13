import { readFileSync } from 'node:fs';
import { FloatType } from 'three/webgpu';
import {
	DEFAULT_OCEAN_CONFIG,
	OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE,
	OCEAN_COMBINED_STORAGE_TEXTURES,
	OCEAN_COMPUTE_BINDING_REQUIREMENTS,
	OCEAN_EXAMPLE_CLAIM_BOUNDARY,
	OCEAN_MECHANISM_ROUTES,
	OCEAN_QUALITY_TIERS,
	chooseOceanTier,
	countOceanStorageTextures,
	createCascadeDescriptors,
	estimateOceanStorageMiB,
	mergeOceanConfig,
	validateOceanCapabilities,
	validateOceanComputeLayouts,
	validateOceanConfig
} from './constants.js';
import { createCpuWaterHeightSampler, createFullSpectrumWaterHeightMirror } from './cpu-water-height.js';
import { advanceLagrangianOceanFoam, combineOceanSurfaceSamples } from './combined-surface-oracle.js';
import { OCEAN_LAB_MANIFEST } from './lab-manifest.js';
import { WebGPUFftOcean } from './ocean-system.js';
import { createOceanMesh, createOceanSurfaceMaterial } from './ocean-nodes.js';
import { validateFftOceanSelfTests } from './validation.js';

function assert( condition, message ) {
	if ( ! condition ) throw new Error( message );
}

const sources = Object.fromEntries( [
	'compute-kernels.js',
	'constants.js',
	'ocean-system.js',
	'ocean-nodes.js',
	'cpu-water-height.js',
	'validation.js',
	'validate-generated-wave-seeds.mjs',
	'README.md',
	'integration-stage.js',
	'lab-app.js',
	'capture.mjs',
	'capture-hook.mjs',
	'validate-artifacts.mjs'
].map( ( file ) => [ file, readFileSync( new URL( `./${ file }`, import.meta.url ), 'utf8' ) ] ) );
const labManifest = JSON.parse( readFileSync( new URL( './lab.manifest.json', import.meta.url ), 'utf8' ) );

assert( labManifest.schemaVersion === 2 && labManifest.id === 'webgpu-fft-ocean', 'Static ocean lab manifest must use schema v2 and the canonical id.' );
assert( labManifest.status === 'incomplete' && labManifest.notes.length > 0, 'Ocean manifest must not claim acceptance before browser GPU evidence.' );
assert( labManifest.mechanisms.length === OCEAN_MECHANISM_ROUTES.length, 'Ocean manifest mechanism routes drifted from runtime constants.' );
assert( labManifest.canonicalSource.length === 1 && labManifest.canonicalSource[ 0 ].endsWith( '/webgpu-fft-ocean' ), 'Ocean source hashing must cover the complete canonical lab directory.' );
assert( new Set( labManifest.mechanisms.map( ( mechanism ) => mechanism.startup?.mode ) ).size === OCEAN_MECHANISM_ROUTES.length, 'Each ocean mechanism must have a distinct fixed startup mode.' );
assert( labManifest.mechanisms.find( ( mechanism ) => mechanism.id === 'above-and-below-surface' )?.startup?.camera === 'underwater', 'Below-surface optics route must start below the interface.' );
assert( JSON.stringify( labManifest.mechanisms ) === JSON.stringify( OCEAN_LAB_MANIFEST.mechanisms ), 'Raw and importable mechanism manifests must remain identical.' );
assert( JSON.stringify( labManifest.modes ) === JSON.stringify( OCEAN_LAB_MANIFEST.modes ) && JSON.stringify( labManifest.cameras ) === JSON.stringify( OCEAN_LAB_MANIFEST.cameras ), 'Raw and importable controller state manifests drifted.' );
assert( labManifest.tiers.every( ( tier, index ) => tier.resourceLimits.derivedStorageBytes === OCEAN_LAB_MANIFEST.tiers[ index ].resourceLimits.derivedStorageBytes ), 'Raw and derived tier byte ledgers drifted.' );
assert( sources[ 'integration-stage.js' ].includes( 'ownsRenderPipeline: false' ) && sources[ 'integration-stage.js' ].includes( 'ownsOutputColorTransform: false' ), 'Reusable ocean stage must not create a competing output owner.' );

assert( OCEAN_EXAMPLE_CLAIM_BOUNDARY.classification === 'numerical-integration-scaffold', 'FFT example must be machine-labelled as a scaffold.' );
assert( OCEAN_MECHANISM_ROUTES.length === 6 && new Set( OCEAN_MECHANISM_ROUTES ).size === 6, 'Ocean mechanism route matrix must be unique and complete.' );
assert( Math.max( ...Object.entries( OCEAN_COMPUTE_BINDING_REQUIREMENTS )
	.filter( ( [ name ] ) => name !== 'fusedAssembly' )
	.map( ( [ , count ] ) => count ) ) <= 4, 'Every portable ocean compute stage must fit a four-storage-texture adapter.' );
for ( const nonClaim of OCEAN_EXAMPLE_CLAIM_BOUNDARY.doesNotProve ) {
	assert( sources[ 'README.md' ].includes( nonClaim ), `README missing non-claim: ${ nonClaim }.` );
}

const configResults = {};
for ( const quality of Object.keys( OCEAN_QUALITY_TIERS ) ) {
	const config = mergeOceanConfig( { quality } );
	validateOceanConfig( config );
	const descriptors = createCascadeDescriptors( config );
	for ( const descriptor of descriptors ) {
		assert( descriptor.cutoffHigh <= Math.PI * descriptor.resolution / descriptor.patchLength, `${ quality } cascade ${ descriptor.index } exceeds isotropic Nyquist support.` );
	}
	configResults[ quality ] = {
		textureCount: countOceanStorageTextures( config ),
		estimatedStorageMiB: estimateOceanStorageMiB( config ),
		isotropicCutoffs: descriptors.map( ( descriptor ) => descriptor.cutoffHigh )
	};
	assert( config.enablePerCascadeFoamHistory === true, `${ quality } must preserve temporal foam at native cascade resolution.` );
	assert( countOceanStorageTextures( config ) === ( OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE + 2 ) * config.cascadeCount + OCEAN_COMBINED_STORAGE_TEXTURES, `${ quality } resource count drifted from the per-cascade layout.` );
}

let rejectedReversedPatches = false;
try {
	validateOceanConfig( mergeOceanConfig( { patchLengthsMeters: [ 5, 17, 250 ], cascadeCount: 3 } ) );
} catch {
	rejectedReversedPatches = true;
}
assert( rejectedReversedPatches, 'Reversed cascade patch lengths must fail.' );

let rejectedUnknownQuality = false;
try {
	validateOceanConfig( mergeOceanConfig( { quality: 'unknown' } ) );
} catch {
	rejectedUnknownQuality = true;
}
assert( rejectedUnknownQuality, 'Unknown quality tiers must fail instead of silently inheriting high-tier values.' );

function fakeRenderer( { webgpu = true, storageLimit = 16 } = {} ) {
	return {
		initialized: true,
		_initialized: true,
		backend: {
			isWebGPUBackend: webgpu,
			device: {
				limits: { maxStorageTexturesPerShaderStage: storageLimit },
				features: new Set( [ 'timestamp-query' ] )
			}
		},
		hasFeature: ( name ) => name === 'timestamp-query',
		compute() {},
		async computeAsync() {},
		getRenderTarget: () => null,
		setRenderTarget() {},
	};
}

const capableRenderer = fakeRenderer();
const portableRenderer = fakeRenderer( { storageLimit: 4 } );
const limitedRenderer = fakeRenderer( { storageLimit: 3 } );
const nonWebGpuRenderer = fakeRenderer( { webgpu: false } );
const capable = validateOceanCapabilities( capableRenderer, mergeOceanConfig( { quality: 'low' } ) );
const portable = validateOceanCapabilities( portableRenderer, mergeOceanConfig( { quality: 'low' } ) );
const limited = validateOceanCapabilities( limitedRenderer, mergeOceanConfig( { quality: 'low' } ) );
const missingWebGpu = validateOceanCapabilities( nonWebGpuRenderer, mergeOceanConfig( { quality: 'low' } ) );
const unfilterableFloat = validateOceanCapabilities( capableRenderer, mergeOceanConfig( { quality: 'low', textureType: FloatType } ) );
assert( capable.nativeStorage === true, 'Capable fake renderer must pass the scaffold construction gate.' );
assert( capable.assemblyMode === 'fused-7-storage-textures', 'Higher-binding devices must select fused physical assembly.' );
assert( portable.nativeStorage === true && portable.assemblyMode === 'portable-split-3-storage-textures', 'Portable-minimum devices must select split physical assembly.' );
assert( limited.nativeStorage === false && limited.missingRequirementReason.some( ( reason ) => reason.includes( 'storage textures' ) ), 'Assembly storage-binding limit must be gated.' );
assert( validateOceanComputeLayouts( portable ).maximumSelectedBindings === 4, 'Portable layout gate must retain the four-binding spectrum initialization stage.' );
assert( validateOceanComputeLayouts( capable ).maximumSelectedBindings === 7, 'Fused layout gate must record its seven-binding assembly stage.' );
assert( missingWebGpu.nativeStorage === false, 'Non-WebGPU renderer must fail.' );
assert( unfilterableFloat.nativeStorage === false && unfilterableFloat.missingRequirementReason.some( ( reason ) => reason.includes( 'float32-filterable' ) ), 'Sampled FloatType outputs must require float32-filterable.' );
assert( chooseOceanTier( capableRenderer, 'low' ).dynamicFft === true, 'Capable renderer must select the compute scaffold.' );

const selfTests = validateFftOceanSelfTests( { resolution: 8 } );
assert( selfTests.pass === true, `CPU numerical scaffold tests failed: ${ JSON.stringify( selfTests.errors ) }` );
assert( selfTests.acceptedAsProductionGpuOcean === false, 'CPU tests must never claim production GPU acceptance.' );

const combinedProbe = combineOceanSurfaceSamples( [
	{ displacementX: 0.2, height: 0.5, displacementZ: - 0.1, slopeX: 0.3, slopeZ: - 0.2, displacementXX: - 0.12, displacementZZ: 0.08, displacementXZ: 0.09 },
	{ displacementX: - 0.04, height: 0.1, displacementZ: 0.03, slopeX: - 0.07, slopeZ: 0.05, displacementXX: 0.03, displacementZZ: - 0.02, displacementXZ: - 0.04 }
] );
const expectedCombinedJacobian = ( 1 - 0.12 + 0.03 ) * ( 1 + 0.08 - 0.02 ) - ( 0.09 - 0.04 ) ** 2;
assert( Math.abs( combinedProbe.jacobian - expectedCombinedJacobian ) < 1e-14, 'Combined ocean determinant must be formed after summing linear derivatives.' );
assert( Math.abs( Math.hypot( ...combinedProbe.normal ) - 1 ) < 1e-14, 'Combined ocean normal must be unit length.' );
const foamWhole = advanceLagrangianOceanFoam( 0.17, 2.4, 1 / 30, 0.22 );
const foamHalf = advanceLagrangianOceanFoam( advanceLagrangianOceanFoam( 0.17, 2.4, 1 / 60, 0.22 ), 2.4, 1 / 60, 0.22 );
assert( Math.abs( foamWhole - foamHalf ) < 1e-14, 'Combined foam reaction must be timestep-partition invariant.' );
assert( advanceLagrangianOceanFoam( 0.8, 0, 0.5, 0.22 ) < 0.8, 'Unforced combined foam must decay monotonically.' );

const ocean = new WebGPUFftOcean( capableRenderer, { quality: 'low' } );
const beforeGpu = ocean.validate( { resolution: 8 } );
assert( beforeGpu.pass === null && beforeGpu.accepted === false, 'Top-level validation must be unaccepted before complete GPU evidence.' );
await ocean.allocateStorageTextures();
await ocean.update( 0.25, 1 / 60 );
const afterPartialGpu = ocean.validate( { resolution: 8 } );
assert( afterPartialGpu.pass === null && afterPartialGpu.accepted === false, 'Partial kernel smoke/readback must not promote the scaffold to accepted.' );
assert( afterPartialGpu.gpuReadback.scope === 'complete-2d-fft-suite-defined-not-executed', 'Unexecuted GPU readback must name the complete pending suite.' );
const dispatchGraph = ocean.describeDispatches();
assert( dispatchGraph.frameNodes.some( ( name ) => name.includes( 'ocean_fft_stage_' ) ), 'Runtime graph must expose actual FFT stages.' );
assert( dispatchGraph.frameNodes.some( ( name ) => name.includes( 'ocean_foam_history_cascade_' ) ), 'Runtime graph must expose native per-cascade foam history.' );
assert( dispatchGraph.compiledLayoutGate.status === 'all-selected-runtime-layouts-submitted-to-webgpu-compiler', 'Every selected compute layout must reach an initialized WebGPU submission gate.' );
const resourceLedger = ocean.describeResources();
assert( resourceLedger.textures.length === countOceanStorageTextures( ocean.config ), 'Runtime storage ledger must reconcile with the configured texture count.' );
assert( resourceLedger.dataTextures.length === 2 && resourceLedger.totalBytes > 0, 'Runtime ledger must include FFT lookup DataTextures and nonzero bytes.' );
const foamState = ocean.combinedSurface;
assert( foamState.kind === 'native-per-cascade-foam-history' && foamState.cascades.length === ocean.config.cascadeCount, 'Foam history must preserve every cascade at native resolution.' );
assert( foamState.filterContract.omittedCascadeIndices.length === 0, 'Canonical foam composition cannot omit spectral bands.' );
const surfaceMaterial = createOceanSurfaceMaterial( ocean.materialCascades, { combinedSurface: foamState } );
const surfaceMesh = createOceanMesh( surfaceMaterial );
assert( surfaceMesh.frustumCulled === false && surfaceMesh.userData.geometryBytes > 0, 'Unbounded scaffold mesh must disable culling and report geometry bytes.' );
assert( surfaceMaterial.userData.geometryBandContract.resolvedCascadeIndices.length > 0, 'Material must record at least one fully resolved geometry band.' );
let rejectedMismatchedMesh = false;
try {
	createOceanMesh( surfaceMaterial, { sizeMeters: 400, segments: 64 } );
} catch ( error ) {
	rejectedMismatchedMesh = /geometry-band contract/.test( error.message );
}
assert( rejectedMismatchedMesh, 'Mesh construction must reject geometry that differs from the material band contract.' );
let rejectedAliasedMaterial = false;
try {
	createOceanSurfaceMaterial( ocean.materialCascades, { geometrySizeMeters: 400, geometrySegments: 64 } );
} catch ( error ) {
	rejectedAliasedMaterial = /resolves no complete cascade/.test( error.message );
}
assert( rejectedAliasedMaterial, 'Material construction must reject a mesh that resolves no complete cascade.' );
surfaceMesh.geometry.dispose();
surfaceMaterial.dispose();
ocean.dispose();
let rejectedDisposedUpdate = false;
try {
	await ocean.update( 0, 0 );
} catch ( error ) {
	rejectedDisposedUpdate = /disposed/.test( error.message );
}
assert( rejectedDisposedUpdate, 'Disposed oceans must reject later updates.' );

const queryOptions = { quality: 'low', resolution: 8, cascadeCount: 1, patchLengthsMeters: [ 64 ], choppiness: 0.02, dominantBinCount: 63 };
const sampler = createCpuWaterHeightSampler( queryOptions );
const fullMirror = createFullSpectrumWaterHeightMirror( queryOptions );
const parameterSample = fullMirror.sampleAtParameter( 0.4, - 0.7, 0.3 );
const worldSample = sampler.sampleAtWorldXZ( parameterSample.position[ 0 ], parameterSample.position[ 2 ], 0.3 );
assert( worldSample.status === 'converged' && worldSample.horizontalResidual <= 1e-6, 'CPU world query must invert the choppy horizontal map.' );
const truncation = sampler.estimateTruncationError();
assert( 'parameterHeightBound' in truncation && 'parameterSlopeBound' in truncation && 'worldHeightBound' in truncation, 'CPU query must separate parameter, slope, and Eulerian error contracts.' );

const heapOptions = { ...queryOptions, dominantBinCount: 7 };
const heapSampler = createCpuWaterHeightSampler( heapOptions );
const heapFull = createFullSpectrumWaterHeightMirror( heapOptions );
const rankedBounds = heapFull.bins.map( ( bin ) => bin.coefficientBound ).sort( ( a, b ) => b - a );
const selectedBounds = heapSampler.selectedBins.map( ( bin ) => bin.coefficientBound ).sort( ( a, b ) => b - a );
assert( selectedBounds.every( ( value, index ) => Math.abs( value - rankedBounds[ index ] ) <= 1e-14 ), 'Streaming heap must retain the same dominant coefficient magnitudes as a full sort.' );
const expectedOmittedBound = rankedBounds.slice( selectedBounds.length ).reduce( ( sum, value ) => sum + value, 0 );
assert( Math.abs( heapSampler.estimateTruncationError().parameterHeightBound - expectedOmittedBound ) <= 1e-12, 'Streaming omitted-height bound must equal the full-sort result.' );

const computeSource = sources[ 'compute-kernels.js' ];
assert( computeSource.includes( '0x9e3779b9' ) && computeSource.includes( 'state.shiftRight' ), 'GPU seeds must use the declared u32 hash.' );
assert( ! computeSource.includes( '43758.5453123' ), 'Catastrophic f32 sine hash must be absent.' );
assert( computeSource.includes( 'energy.mul( 0.25 )' ), 'Initial coefficient power must use the corrected Gaussian/unnormalized-IFFT factor.' );
assert( computeSource.includes( 'sin( omega.mul( time ) ).negate()' ), 'Evolution must use exp(-i omega t).' );
for ( const mask of [ 'xOddMask', 'zOddMask', 'crossMask' ] ) {
	assert( computeSource.includes( mask ), `Field-specific Nyquist parity missing ${ mask }.` );
}
assert( ! computeSource.includes( 'derivativeNyquistMask' ), 'Blanket derivative Nyquist mask must be absent.' );
assert( computeSource.includes( 'equilibrium.add' ) && computeSource.includes( 'reactionRate.mul( dt ).negate()' ), 'Foam reaction must be timestep-correct and bounded.' );
assert( computeSource.includes( 'createFftFixtureNode' ) && computeSource.includes( "'hermitian-cosines'" ), 'GPU readback fixtures must cover a complete 2D transform and both packed complex lanes.' );
assert( ! computeSource.includes( 'createCombinedSurfaceAssemblyNode' ) && ! computeSource.includes( 'createFilteredFoamSourceNode' ), 'An undersampled shared world atlas must not re-enter the canonical graph.' );
assert( computeSource.includes( 'createFoamHistoryNode' ) && computeSource.includes( 'ocean_foam_history_cascade_' ), 'Every cascade must retain an independently dispatchable Lagrangian foam history.' );

const nodeSource = sources[ 'ocean-nodes.js' ];
assert( nodeSource.includes( 'combinedJacobian = tangentA.mul( tangentC ).sub( tangentB.mul( tangentB ) )' ), 'Material must form the combined-cascade determinant after summing linear fields.' );
assert( nodeSource.includes( 'derivatives.y.mul( tangentB ).sub( tangentC.mul( derivatives.x ) )' ), 'Material must use the exact tangent cross-product normal.' );
assert( nodeSource.includes( 'enableMrt = false' ), 'Unused normal MRT must be opt-in.' );
assert( nodeSource.includes( 'new THREE.MeshBasicNodeMaterial' ), 'Authored ocean radiance must not be re-lit by a PBR material.' );
assert( nodeSource.includes( 'const xz = positionGeometry.xz' ), 'Vertex sampling must use the undeformed periodic parameter coordinate.' );
assert( nodeSource.includes( 'partitionGeometryBands' ) && nodeSource.includes( 'detailNormalCascades' ) && nodeSource.includes( 'footprint.mul( cascade.cutoffHigh )' ), 'Geometry and detail normals must use an explicit resolved-band/footprint filter.' );
assert( nodeSource.includes( 'native-resolution-per-cascade-union' ) || sources[ 'ocean-system.js' ].includes( 'native-resolution-per-cascade-union' ), 'Foam composition must preserve native per-cascade bandwidth.' );
assert( nodeSource.includes( 'max( length( rawRefracted ), 1e-6 )' ), 'Below-surface optics must not normalize a zero TIR refracted vector.' );
assert( nodeSource.includes( 'vertexMaxWavenumber > vertexNyquist' ), 'Mesh construction must reject aliased vertex displacement.' );
assert( nodeSource.includes( 'scenePass.dispose()' ), 'Render-pipeline disposal must release its owned pass target.' );
assert( nodeSource.includes( 'opticalComposer( opticalInputs )' ) && nodeSource.includes( 'syncCombinedSurface' ), 'Canonical ocean material must expose the combined surface to a host optical composer and follow foam ping-pong.' );

const cpuSource = sources[ 'cpu-water-height.js' ];
assert( cpuSource.includes( 'selectDominantCascadeBins' ) && cpuSource.includes( 'heapReplaceLowest' ), 'Reduced CPU coupling must stream top bins in O(K) memory instead of sorting every spectral bin.' );

const systemSource = sources[ 'ocean-system.js' ];
assert( systemSource.includes( 'renderer.compute( nodes )' ), 'Initialized r185 runtime must use renderer.compute().' );
assert( systemSource.includes( 'renderer.initialized' ) && ! systemSource.includes( 'renderer._initialized' ), 'Compute submission must use the public r185 initialization state.' );
assert( ! systemSource.includes( 'computeAsync' ), 'The initialized scaffold must not use the deprecated asynchronous compute wrapper.' );
assert( systemSource.includes( 'fixtureNodes.forEach' ), 'Temporary fixture ComputeNodes must be disposed.' );
assert( systemSource.includes( 'expectedFftFixturePixel' ) && systemSource.includes( 'fullTextureError' ), 'GPU FFT fixtures must compare every texel against a CPU oracle.' );
assert( sources[ 'lab-app.js' ].includes( 'readRenderTargetPixelsAsync' ) && sources[ 'lab-app.js' ].includes( 'alignedBytesPerRow' ), 'Ocean browser controller must capture render-target pixels with an aligned stride contract.' );
assert( sources[ 'lab-app.js' ].includes( "format: 'rgba8'" ) && sources[ 'lab-app.js' ].includes( "outputColorSpace: 'srgb'" ), 'Shared capture must receive explicit color-managed RGBA8 metadata.' );
assert( sources[ 'lab-app.js' ].includes( 'while ( replayCursor + replayStep <= replayTime' ) && ! sources[ 'lab-app.js' ].includes( 'this.ocean.update( seconds, 0 )' ), 'Fixed-time replay must rebuild temporal foam with deterministic nonzero steps.' );
assert( systemSource.includes( "pass: selfTests.pass === false || this.gpuReadback.pass === false ? false : null" ), 'Top-level validation must not false-green pending evidence.' );
assert( computeSource.includes( 'createDisplacementAssemblyNode' ) && computeSource.includes( 'createFoamHistoryNode' ), 'Portable physical assembly and separate diagnostic foam reaction must both exist.' );
assert( DEFAULT_OCEAN_CONFIG.enablePerCascadeFoamHistory === true, 'Native-resolution per-cascade foam history must be canonical by default.' );
assert( sources[ 'capture.mjs' ].includes( 'captureLabBrowser' ) && ! sources[ 'capture.mjs' ].includes( 'LAB_URL' ) && ! sources[ 'capture.mjs' ].includes( "from 'playwright'" ), 'Ocean capture must use the shared self-serving browser harness.' );
assert( sources[ 'validate-artifacts.mjs' ].includes( 'validateEvidenceBundle' ) && sources[ 'validate-artifacts.mjs' ].includes( 'requireRequiredClaimsPass: true' ) && sources[ 'validate-artifacts.mjs' ].includes( 'lab.sourceHash' ), 'Artifact validation must use strict shared v2 acceptance validation and the registry source hash.' );
assert( !/fallback/i.test( sources[ 'README.md' ] ) && !/fallback/i.test( sources[ 'constants.js' ] ), 'Scaffold must not contain an alternate runtime branch or teaching route.' );
assert( sources[ 'validate-generated-wave-seeds.mjs' ].includes( 'asset-preview-only' ), 'Generated-wave validator must be classified as asset preview only.' );

console.log( JSON.stringify( {
	pass: true,
	accepted: false,
	status: 'scaffold-contracts-pass-production-acceptance-skipped',
	classification: OCEAN_EXAMPLE_CLAIM_BOUNDARY.classification,
	configResults,
	rejectedReversedPatches,
	rejectedUnknownQuality,
	capabilities: { capable, portable, limited, missingWebGpu, unfilterableFloat },
	selfTests,
	combinedSurface: { jacobian: combinedProbe.jacobian, normalLength: Math.hypot( ...combinedProbe.normal ), foamPartitionError: Math.abs( foamWhole - foamHalf ) },
	topLevelValidation: afterPartialGpu,
	cpuWorldQuery: {
		status: worldSample.status,
		horizontalResidual: worldSample.horizontalResidual,
		truncation
	},
	doesNotProve: OCEAN_EXAMPLE_CLAIM_BOUNDARY.doesNotProve
}, null, 2 ) );
