import {
	CANONICAL_WATER_TIER_IDS,
	WATER_MECHANISM_ROUTES,
	WATER_QUALITY_TIERS,
	boundedWaterPersistentBytes
} from './constants.js';

const degradation = Object.freeze( {
	ultra: [],
	high: [ 'simulation 512→256', 'receiver caustics 512→192', 'mesh 192→128', 'max substeps 4→3', 'analytic bands 5→4', 'micro bands 4→3' ],
	medium: [ 'simulation 256→192', 'receiver caustics 192→96', 'caustic cadence 1→2 simulation steps', 'mesh 128→96', 'analytic bands 4→3', 'micro bands 3→2' ],
	low: [ 'simulation 192→96', 'receiver caustics 96→48', 'caustic cadence 2→4 simulation steps', 'mesh 96→48', 'max substeps 3→2', 'analytic bands 3→2', 'micro bands 2→0' ]
} );

export const BOUNDED_WATER_LAB_MANIFEST = Object.freeze( {
	schemaVersion: 2,
	id: 'webgpu-bounded-water',
	skill: 'threejs-water-optics',
	threeRevision: '0.185.1',
	kind: 'canonical-lab',
	status: 'incomplete',
	canonicalSource: Object.freeze( [
		'threejs-water-optics/examples/webgpu-bounded-water',
		'scripts/capture-lab-browser.mjs',
		'scripts/lib/evidence-v2.mjs'
	] ),
	browserEntry: 'threejs-water-optics/examples/webgpu-bounded-water/index.html',
	publishPath: '/demos/webgpu-bounded-water/',
	scenarios: Object.freeze( [
		{ id: 'interactive-bounded-pool', route: '/demos/webgpu-bounded-water/', acceptanceStatus: 'incomplete' }
	] ),
	mechanisms: Object.freeze( WATER_MECHANISM_ROUTES.map( ( id ) => ( {
		id,
		route: `/demos/webgpu-bounded-water/mechanism/${ id }/`,
		acceptanceStatus: 'incomplete'
	} ) ) ),
	tiers: Object.freeze( CANONICAL_WATER_TIER_IDS.map( ( id ) => {
		const tier = WATER_QUALITY_TIERS[ id ];
		return {
			id,
			targetClass: 'unmeasured-current-adapter',
			frameTargetMs: null,
			resolutionPolicy: { simulationResolution: tier.resolution, causticResolution: tier.causticResolution, meshSegments: tier.meshSegments, dpr: 1 },
			mechanismLimits: { maxSubsteps: tier.maxSubsteps, analyticBands: tier.analyticBands, microBands: tier.microBands, causticUpdateEverySimulationSteps: tier.causticUpdateEverySimulationSteps },
			resourceLimits: { derivedPersistentGpuBytes: boundedWaterPersistentBytes( tier.resolution, tier.causticResolution ), eventSnapshotBytes: 64, gpuProbeBytes: 64 },
			degradationFromPrevious: degradation[ id ],
			preservedInvariants: [ 'anisotropic CFL ≤ 0.85', 'fixed-step event semantics', 'exact analytic+heightfield differential', 'side-aware exact Fresnel', 'source-driven receiver deposition' ],
			acceptanceStatus: 'incomplete'
		};
	} ) ),
	modes: Object.freeze( [ 'final', 'height', 'velocity', 'normals', 'caustics', 'fresnel-and-tir', 'absorption', 'optical-transport-unavailable' ] ),
	cameras: Object.freeze( [ 'near', 'design', 'far' ] ),
	seeds: Object.freeze( [ 0x00000001, 0x9e3779b9 ] ),
	capabilityRequirements: Object.freeze( [ { id: 'native-webgpu', required: true } ] ),
	runtimeProof: Object.freeze( [
		{ id: 'backend-is-webgpu', required: true },
		{ id: 'heightfield-readback', required: true },
		{ id: 'receiver-caustic-energy-readback', required: true },
		{ id: 'opaque-color-depth-without-water', required: true },
		{ id: 'gpu-mutation-probes', required: true },
		{ id: 'render-target-readback', required: true }
	] ),
	evidenceContract: 'v2',
	validationCommand: 'node validate-water-contracts.mjs',
	commands: {
		check: 'npm run check', test: 'npm run validate:unit', mutations: 'npm run test:mutations', capture: 'npm run capture',
		validateArtifacts: 'npm run validate:artifacts', validateQuick: 'npm run validate:quick', validateFull: 'npm run validate:full'
	},
	sourceHash: null,
	proxyStatus: null,
	notes: Object.freeze( [
		'browser WebGPU execution and state readback are not captured',
		'receiver-space atomic caustic energy closure is not captured',
		'depth-reconstructed refracted-ray GPU validation and manual visual inspection are not captured',
		'50-cycle lifecycle evidence is not captured',
		'current-adapter GPU timing is not measured'
	] )
} );
