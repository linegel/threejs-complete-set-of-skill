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

	const fallbackTeachingOcean = new WebGPUFftOcean( fakeReducedRenderer, {
		quality: 'ultra',
		explicitFallbackWhenWebGPUUnavailable: true
	} );
	assert( fallbackTeachingOcean.cascades.length === 0, `Explicit fallback teaching branch should not allocate native cascades, got ${ fallbackTeachingOcean.cascades.length }.` );
	fallbackTeachingOcean.dispose();

	return {
		...results,
		implicitNonWebGPUError: implicitError,
		fallbackTeachingCascades: fallbackTeachingOcean.cascades.length
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
	const explicitFallbackTier = chooseOceanTier( fakeReducedRenderer, 'high', {
		explicitFallbackWhenWebGPUUnavailable: true
	} );

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
	assert( explicitFallbackTier.dynamicFft === false && explicitFallbackTier.source === 'fallback-teaching-static', 'Explicit fallback teaching branch should disable dynamic FFT.' );

	return { full, missingWebGPU, explicitFallbackTier };

}

function validateGpuReadbackContract() {

	const fakeRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		computeAsync: async () => {}
	};
	const ocean = new WebGPUFftOcean( fakeRenderer, { quality: 'low' } );
	const validation = ocean.validate( { resolution: 8 } );
	ocean.dispose();

	assert( validation.pass === true, 'CPU validation gate should pass before browser GPU readback.' );
	assert( validation.gpuReadback.pass === null, 'Node contract must not claim browser GPU readback passed.' );
	assert( validation.gpuReadback.requiredForBrowserAcceptance === true, 'GPU readback must remain required for browser acceptance.' );
	assert( validation.gpuReadback.nodes.includes( 'createFftStageNode' ), 'GPU readback contract must name FFT stage nodes.' );

	return validation.gpuReadback;

}

const selfTests = validateFftOceanSelfTests( { resolution: 16 } );
assert( selfTests.pass, 'FFT ocean self-tests failed.' );

const result = {
	selfTests,
	configCounterexample: validateConfigCounterexample(),
	storageAccounting: validateStorageAccounting(),
	capabilityGate: validateCapabilityGate(),
	gpuReadbackContract: validateGpuReadbackContract()
};

console.log( JSON.stringify( result, null, 2 ) );
