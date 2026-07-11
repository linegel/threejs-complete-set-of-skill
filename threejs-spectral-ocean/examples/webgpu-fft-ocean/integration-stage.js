import { createWebGPUFftOcean } from './ocean-system.js';
import { createOceanMesh, createOceanSurfaceMaterial, updateOceanSurfaceMaterial } from './ocean-nodes.js';

/**
 * Reusable integration stage for Weathered World. The host retains renderer,
 * RenderPipeline, camera, scene-pass, tone-map, and output-transform ownership.
 */
export async function createSpectralOceanStage( {
	renderer,
	weatherState = null,
	quality = 'high',
	seed = 1,
	materialOptions = {},
	meshOptions = {}
} ) {
	if ( ! renderer ) throw new Error( 'Spectral-ocean integration requires the host renderer.' );
	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Spectral-ocean integration requires native WebGPU.' );

	const ocean = await createWebGPUFftOcean( renderer, { quality, seed } );
	const resolvedMeshOptions = { sizeMeters: 400, segments: 384, ...meshOptions };
	const material = createOceanSurfaceMaterial( ocean.materialCascades, {
		geometrySizeMeters: resolvedMeshOptions.sizeMeters,
		geometrySegments: resolvedMeshOptions.segments,
		...materialOptions,
		combinedSurface: ocean.combinedSurface
	} );
	const mesh = createOceanMesh( material, resolvedMeshOptions );
	let disposed = false;

	return {
		id: 'spectral-ocean-stage',
		renderer,
		weatherState,
		ocean,
		material,
		mesh,
		ownsRenderPipeline: false,
		ownsToneMap: false,
		ownsOutputColorTransform: false,
		async update( timeSeconds, deltaSeconds ) {
			if ( disposed ) throw new Error( 'Spectral-ocean integration stage is disposed.' );
			await ocean.update( timeSeconds, deltaSeconds );
			material.userData.syncCombinedSurface( ocean.combinedSurface );
			if ( weatherState?.sunDirection ) updateOceanSurfaceMaterial( material, { sunDirection: weatherState.sunDirection } );
		},
		describeSignals() {
			return {
				produces: [ 'ocean-displacement', 'ocean-derivatives', 'ocean-jacobian' ],
				consumes: weatherState ? [ 'weather-time', 'weather-wind', 'atmosphere-sun-direction' ] : []
			};
		},
		describeResources: () => ocean.describeResources(),
		describeDispatches: () => ocean.describeDispatches(),
		dispose() {
			if ( disposed ) return;
			disposed = true;
			mesh.geometry.dispose();
			material.dispose();
			ocean.dispose();
		}
	};
}
