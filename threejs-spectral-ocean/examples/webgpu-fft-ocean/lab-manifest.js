import { FloatType } from 'three/webgpu';
import {
	OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE,
	OCEAN_COMBINED_STORAGE_TEXTURES,
	OCEAN_DEBUG_MODES,
	OCEAN_MECHANISM_ROUTES,
	OCEAN_QUALITY_TIERS
} from './constants.js';

const derivedTextureBytes = ( tier ) => {
	const bytesPerChannel = tier.textureType === FloatType ? 4 : 2;
	const textureCount = ( OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE + 2 ) * tier.cascadeCount + OCEAN_COMBINED_STORAGE_TEXTURES;
	return tier.resolution * tier.resolution * 4 * bytesPerChannel * textureCount;
};

const mechanismStartup = Object.freeze( {
	'spectrum-and-fft': { mode: 'spectrum-fft', camera: 'design' },
	'dispersion-and-cascades': { mode: 'cascade-bands', camera: 'design' },
	'derivatives-and-jacobian': { mode: 'jacobian', camera: 'near' },
	'whitecaps-and-foam': { mode: 'foam', camera: 'near' },
	'above-and-below-surface': { mode: 'underwater-optics', camera: 'underwater' },
	'cpu-query-parity': { mode: 'cpu-query', camera: 'design' }
} );

const tierDegradation = Object.freeze( {
	ultra: [],
	high: [ 'FFT resolution 512 to 256' ],
	medium: [ 'cascade count 3 to 2' ],
	low: [ 'FFT resolution 256 to 128', 'cascade count 2 to 1' ]
} );

export const OCEAN_LAB_MANIFEST = Object.freeze( {
	schemaVersion: 2,
	id: 'webgpu-fft-ocean',
	skill: 'threejs-spectral-ocean',
	threeRevision: '0.185.1',
	kind: 'canonical-lab',
	status: 'incomplete',
	canonicalSource: Object.freeze( [ 'threejs-spectral-ocean/examples/webgpu-fft-ocean' ] ),
	browserEntry: 'threejs-spectral-ocean/examples/webgpu-fft-ocean/index.html',
	publishPath: '/demos/webgpu-fft-ocean/',
	scenarios: Object.freeze( [
		{ id: 'directional-sea', route: '/demos/webgpu-fft-ocean/', startup: { mode: 'final', camera: 'design' }, acceptanceStatus: 'incomplete' }
	] ),
	mechanisms: Object.freeze( OCEAN_MECHANISM_ROUTES.map( ( id ) => ( {
		id,
		route: `/demos/webgpu-fft-ocean/mechanism/${ id }/`,
		startup: mechanismStartup[ id ],
		acceptanceStatus: 'incomplete'
	} ) ) ),
	tiers: Object.freeze( Object.entries( OCEAN_QUALITY_TIERS ).map( ( [ id, tier ] ) => ( {
		id,
		targetClass: tier.target,
		frameTargetMs: null,
		resolutionPolicy: { fftResolution: tier.resolution, dpr: 1 },
		mechanismLimits: { cascadeCount: tier.cascadeCount, packedComplexTransformCount: tier.packedFieldCount },
		resourceLimits: { authoredStorageBudgetMiB: tier.storageBudgetMiB, derivedStorageBytes: derivedTextureBytes( tier ) },
		degradationFromPrevious: tierDegradation[ id ],
		preservedInvariants: [ 'dimensional spectrum', 'Hermitian evolution', 'explicit inverse-transform convention', 'resolved-band geometry/normal parity', 'native-resolution per-cascade foam history' ],
		acceptanceStatus: 'incomplete'
	} ) ) ),
	modes: Object.freeze( Object.keys( OCEAN_DEBUG_MODES ) ),
	cameras: Object.freeze( [ 'near', 'design', 'far', 'underwater' ] ),
	seeds: Object.freeze( [ 0x00000001, 0x9e3779b9 ] ),
	capabilityRequirements: Object.freeze( [
		{ id: 'native-webgpu', required: true },
		{ id: 'minimum-four-storage-textures', required: true, evidence: 'initialized adapter limit' }
	] ),
	runtimeProof: Object.freeze( [
		{ id: 'renderer-init', required: true },
		{ id: 'backend-is-webgpu', required: true },
		{ id: 'mechanism-reachable', required: true },
		{ id: 'render-or-compute-work', required: true },
		{ id: 'aligned-readback', required: true },
		{ id: 'complete-2d-fft-readback', required: true },
		{ id: 'per-cascade-surface-and-foam-readback', required: true },
		{ id: 'pages-source-hash', required: true }
	] ),
	evidenceContract: 'v2',
	validationCommand: 'node validate-ocean-contracts.js',
	commands: {
		check: 'npm run check', test: 'npm run validate:unit', mutations: 'npm run test:mutations', capture: 'npm run capture',
		validateArtifacts: 'npm run validate:artifacts', validateQuick: 'npm run validate:quick', validateFull: 'npm run validate:full'
	},
	sourceHash: null,
	proxyStatus: null,
	notes: Object.freeze( [
		'browser WebGPU execution and readback are not captured',
		'per-cascade surface and foam GPU readback are not captured',
		'below-surface diagnostic optics are implemented but full scene-depth transport is not claimed',
		'current-adapter GPU timing is not measured'
	] )
} );
