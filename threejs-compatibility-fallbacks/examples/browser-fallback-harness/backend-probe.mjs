export async function probeCanonicalBackend( {
	loadWebGPU = () => import( 'three/webgpu' ),
	forceWebGL = globalThis.__FALLBACK_FORCE_WEBGL_PROBE__ === true
} = {} ) {

	let renderer = null;
	try {

		const { WebGPURenderer, REVISION } = await loadWebGPU();
		renderer = new WebGPURenderer( { antialias: false, forceWebGL } );
		await renderer.init();
		const webgpu = renderer.backend.isWebGPUBackend === true;
		const capabilities = {
			tested: true,
			webgpu,
			compatibilityMode: renderer.backend.compatibilityMode === true,
			threeRevision: REVISION,
			backendName: renderer.backend.constructor.name,
			forceWebGL
		};
		if ( ! webgpu ) {

			renderer.dispose();
			renderer = null;

		}
		return {
			capabilities,
			renderer
		};

	} catch ( error ) {

		renderer?.dispose();
		return {
			capabilities: {
				tested: false,
				webgpu: null,
				compatibilityMode: null,
				threeRevision: null,
				backendName: null,
				error: error instanceof Error ? error.message : String( error )
			},
			renderer: null
		};

	}

}
