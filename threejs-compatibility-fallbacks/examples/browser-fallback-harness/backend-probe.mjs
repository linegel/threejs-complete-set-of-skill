export async function probeCanonicalBackend() {

	let renderer = null;
	try {

		const { WebGPURenderer, REVISION } = await import( 'three/webgpu' );
		renderer = new WebGPURenderer( { antialias: false } );
		await renderer.init();
		return {
			tested: true,
			webgpu: renderer.backend.isWebGPUBackend === true,
			compatibilityMode: renderer.backend.compatibilityMode === true,
			threeRevision: REVISION,
			backendName: renderer.backend.constructor.name
		};

	} catch ( error ) {

		return {
			tested: false,
			webgpu: null,
			compatibilityMode: null,
			threeRevision: null,
			backendName: null,
			error: error instanceof Error ? error.message : String( error )
		};

	} finally {

		renderer?.dispose();

	}

}
