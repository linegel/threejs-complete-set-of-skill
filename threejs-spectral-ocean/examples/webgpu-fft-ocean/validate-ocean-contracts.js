import {
	chooseOceanTier,
	countOceanStorageTextures,
	mergeOceanConfig,
	estimateOceanStorageMiB,
	validateOceanCapabilities,
	validateOceanConfig
} from './constants.js';
import { WebGPUFftOcean } from './ocean-system.js';
import { validateFftOceanSelfTests } from './validation.js';
import { readFileSync } from 'node:fs';

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

function validateConfigCounterexample() {

	try {

		validateOceanConfig( mergeOceanConfig( {
			patchLengthsMeters: [ 5, 17, 250 ],
			cascadeCount: 3
		} ) );

		throw new Error( 'patchLengthsMeters [5,17,250] unexpectedly passed.' );

	} catch ( error ) {

		if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
		return error.message.split( '\n' )[ 0 ];

	}

}

function validateStorageAccounting() {

	const fakeRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		computeAsync: async () => {}
	};
	const fakeReducedRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: false }
	};
	const tiers = [ 'ultra', 'high', 'medium', 'low' ];
	const results = {};

	for ( const quality of tiers ) {

		const config = mergeOceanConfig( { quality } );
		validateOceanConfig( config );

		const textureCount = countOceanStorageTextures( config );
		const estimatedStorageMiB = estimateOceanStorageMiB( config );
		const ocean = new WebGPUFftOcean( fakeRenderer, { quality } );
		const actualAllocatedTextures = ocean.cascades.reduce( ( total, cascade ) => {

			const textures = cascade.resources.textures;
			return total
				+ 1
				+ 1
				+ 1
				+ 1
				+ textures.frequencyA.length
				+ textures.frequencyB.length
				+ 1
				+ 1
				+ 1
				+ textures.foamHistory.length;

		}, 0 );
		ocean.dispose();

		assert( textureCount === actualAllocatedTextures, `${ quality } estimate uses ${ textureCount } textures but actual allocation has ${ actualAllocatedTextures }.` );
		assert( estimatedStorageMiB <= config.storageBudgetMiB, `${ quality } storage estimate ${ estimatedStorageMiB } exceeds ${ config.storageBudgetMiB }.` );

		results[ quality ] = {
			textureCount,
			actualAllocatedTextures,
			estimatedStorageMiB,
			storageBudgetMiB: config.storageBudgetMiB
		};

	}

	assert( results.ultra.textureCount === 51, `Expected 51 storage textures for ultra tier, got ${ results.ultra.textureCount }.` );

	let implicitError = '';
	try {
		new WebGPUFftOcean( fakeReducedRenderer, { quality: 'ultra' } );
		throw new Error( 'Implicit non-WebGPU ocean construction unexpectedly passed.' );
	} catch ( error ) {
		if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
		implicitError = error.message;
	}
	assert( implicitError.includes( 'threejs-compatibility-fallbacks' ), 'Implicit non-WebGPU error must route explicit fallback teaching to threejs-compatibility-fallbacks.' );

	return {
		...results,
		implicitNonWebGPUError: implicitError
	};

}

function validateCapabilityGate() {

	const config = mergeOceanConfig( { quality: 'high' } );
	const fakeFullRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		hasFeature: ( name ) => name === 'timestamp-query',
		computeAsync: async () => {}
	};
	const fakeReducedRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: false }
	};
	const full = validateOceanCapabilities( fakeFullRenderer, config );
	const missingWebGPU = validateOceanCapabilities( fakeReducedRenderer, config );
	const selectedTier = chooseOceanTier( fakeFullRenderer, 'high' );

	try {
		chooseOceanTier( fakeReducedRenderer, 'high' );
		throw new Error( 'Implicit chooseOceanTier non-WebGPU case unexpectedly passed.' );
	} catch ( error ) {
		if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
	}

	assert( full.nativeStorage === true, 'Full fake renderer should pass native storage gate.' );
	assert( full.timestampQuery === true, 'Full fake renderer should report timestamp-query support.' );
	assert( missingWebGPU.nativeStorage === false, 'Fake missing-WebGPU renderer should fail native storage gate.' );
	assert( missingWebGPU.missingRequirementReason.length > 0, 'Fake missing-WebGPU renderer needs missing-requirement reasons.' );
	assert( selectedTier.dynamicFft === true && selectedTier.source === 'webgpu-tsl-compute', 'Selected tier must stay on WebGPU TSL compute.' );

	return { full, missingWebGPU, selectedTier };

}

async function validateGpuReadbackContract() {

	const fakeRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		computeAsync: async () => {}
	};
	const ocean = new WebGPUFftOcean( fakeRenderer, { quality: 'low' } );
	await ocean.allocateStorageTextures();
	const validation = ocean.validate( { resolution: 8 } );
	ocean.dispose();

	assert( validation.pass === true, 'CPU validation gate should pass before browser GPU readback.' );
	assert( validation.gpuReadback.pass === null, 'Node contract must not claim browser GPU readback passed.' );
	assert( validation.gpuReadback.requiredForBrowserAcceptance === true, 'GPU readback must remain required for browser acceptance.' );
	assert( validation.gpuReadback.nodes.includes( 'createFftStageNode' ), 'GPU readback contract must name FFT stage nodes.' );

	return validation.gpuReadback;

}

function validateSourceContracts() {

	const constantsSource = readFileSync( new URL( './constants.js', import.meta.url ), 'utf8' );
	const systemSource = readFileSync( new URL( './ocean-system.js', import.meta.url ), 'utf8' );
	const nodesSource = readFileSync( new URL( './ocean-nodes.js', import.meta.url ), 'utf8' );
	const validationSource = readFileSync( new URL( './validation.js', import.meta.url ), 'utf8' );
	const readmeSource = readFileSync( new URL( './README.md', import.meta.url ), 'utf8' );

	assert( ! constantsSource.includes( 'fallback-teaching-static' ), 'constants.js must not construct fallback-teaching tiers.' );
	assert( ! systemSource.includes( 'fallbackTeaching' ), 'ocean-system.js must not contain fallback-teaching runtime branches.' );
	assert( ! readmeSource.includes( 'static fallback-teaching branch' ), 'README must not document the removed fallback-teaching branch.' );
	assert( ! systemSource.includes( 'subGridNormalContribution: null' ), 'Debug texture contract must not expose null sub-grid normal placeholders.' );
	assert( ! systemSource.includes( 'finalWithoutFoam: null' ), 'Debug texture contract must not expose null final-without-foam placeholders.' );
	assert( ! systemSource.includes( 'finalWithoutDetail: null' ), 'Debug texture contract must not expose null final-without-detail placeholders.' );
	assert( ! nodesSource.includes( 'const xz = positionLocal.xz' ), 'Surface sampling must not use local XZ with world-space reflection.' );
	assert( nodesSource.includes( 'const xz = positionWorld.xz' ), 'Surface sampling must document world-XZ sampling in code.' );
	assert( nodesSource.includes( 'transformNormal( resolvedNormalLocal, modelWorldMatrix )' ), 'Reflection must use a world-space transformed normal.' );
	assert( ! validationSource.includes( 'const amplitudesA = cells.map' ), 'Energy-invariance test must not compare duplicate amplitude arrays.' );
	assert( validationSource.includes( 'partitionA' ) && validationSource.includes( 'partitionB' ), 'Energy-invariance test must move cutoff partitions.' );
	assert( systemSource.includes( 'runBrowserGpuReadbackFixtures' ), 'Runtime must expose browser WebGPU readback fixtures.' );
	assert(
		systemSource.indexOf( 'this.gpuReadback = await this.runBrowserGpuReadbackFixtures()' ) > - 1 &&
		systemSource.indexOf( 'this.gpuReadback = await this.runBrowserGpuReadbackFixtures()' ) < systemSource.indexOf( 'this.initialized = true' ),
		'GPU readback fixtures must run before initialized = true.'
	);

	return {
		noFallbackTeachingRuntime: true,
		noNullDiagnosticPlaceholders: true,
		worldSpaceSampling: true,
		nonTautologicalEnergyTest: true,
		gpuReadbackBeforeInitialized: true
	};

}

const selfTests = validateFftOceanSelfTests( { resolution: 16 } );
assert( selfTests.pass, 'FFT ocean self-tests failed.' );

const result = {
	selfTests,
	configCounterexample: validateConfigCounterexample(),
	storageAccounting: validateStorageAccounting(),
	capabilityGate: validateCapabilityGate(),
	gpuReadbackContract: await validateGpuReadbackContract(),
	sourceContracts: validateSourceContracts()
};

console.log( JSON.stringify( result, null, 2 ) );
