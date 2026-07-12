import { float } from 'three/tsl';
import { createWebGPUBoundedWaterSystem } from './webgpu-bounded-water.js';

export const WATER_PHYSICS_INTEGRATION_BOUNDARY = Object.freeze( {
	id: 'bounded-water-render-integration-only-v1',
	canonicalPhysicsAbi: false,
	acceptedInputs: Object.freeze( [
		'presentation-authored-weather-state',
		'presentation-authored-drop-event',
		'presentation-authored-moving-boundary-object-impulse'
	] ),
	forbiddenClaims: Object.freeze( [
		'PhysicsContext publication',
		'WaterSurfaceSample publication',
		'SurfaceExchange consumption',
		'InteractionRecord consumption',
		'InteractionBatchLedger exact-once delivery',
		'conservation or two-way coupling'
	] ),
	requiredCanonicalPath: 'physics-domain-and-interaction-contract.md plus a route-owned provider/interaction adapter'
} );

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
		physicsIntegrationBoundary: WATER_PHYSICS_INTEGRATION_BOUNDARY,
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
				classification: WATER_PHYSICS_INTEGRATION_BOUNDARY.id,
				produces: [
					'presentation-authored-bounded-water-height',
					'presentation-authored-bounded-water-derivatives',
					'presentation-authored-bounded-water-touch-history'
				],
				consumes: weatherState ? [
					'presentation-authored-weather-time',
					'presentation-authored-weather-precipitation',
					'presentation-authored-weather-wind'
				] : [],
				forbiddenClaims: WATER_PHYSICS_INTEGRATION_BOUNDARY.forbiddenClaims
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
