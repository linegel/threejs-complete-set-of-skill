import { float } from 'three/tsl';
import { createWebGPUBoundedWaterSystem } from './webgpu-bounded-water.js';

/**
 * Reusable bounded-water stage for Weathered World and Creature Habitat. The
 * host owns the RenderPipeline, opaque color/depth inputs, transparent order,
 * tone map, and output transform.
 */
export async function createBoundedWaterStage( {
	renderer,
	weatherState = null,
	tier = 'high',
	seed = 1,
	timeNode = float( 0 ),
	parameters = {},
	opticalInputs = null,
	causticsEnabled = true,
	opticalTransportEnabled = Boolean( opticalInputs?.sceneColorNode && opticalInputs?.sceneDepthNode )
} ) {
	if ( ! renderer ) throw new Error( 'Bounded-water integration requires the host renderer.' );
	const system = await createWebGPUBoundedWaterSystem( renderer, {
		tier, seed, timeNode, parameters, opticalInputs, causticsEnabled, opticalTransportEnabled
	} );
	let disposed = false;

	return {
		id: 'bounded-water-stage',
		renderer,
		weatherState,
		...system,
		ownsRenderPipeline: false,
		ownsToneMap: false,
		ownsOutputColorTransform: false,
		update( deltaSeconds ) {
			if ( disposed ) throw new Error( 'Bounded-water integration stage is disposed.' );
			if ( weatherState?.waterDrop ) system.heightfield.setDrop( weatherState.waterDrop );
			return system.update( deltaSeconds );
		},
		describeSignals() {
			return {
				produces: [ 'bounded-water-height', 'bounded-water-derivatives', 'bounded-water-touch-history' ],
				consumes: weatherState ? [ 'weather-time', 'weather-precipitation', 'weather-wind' ] : []
			};
		},
		describeResources: () => system.describeResources(),
		describeDispatches: () => system.describeDispatches(),
		dispose() {
			if ( disposed ) return;
			disposed = true;
			system.dispose();
		}
	};
}
