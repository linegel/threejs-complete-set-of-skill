export const SCENE_ID = 'webgpu-image-pipeline';
export const THREE_REVISION_LABEL = 'r185';

// `native-budgeted` is the nearest label accepted by the shared artifact
// schema. The bundle's own claim boundary narrows it to an authored feature
// fixture: its thresholds are capture-validation gates, not product budgets.
export const QUALITY_TIER = 'native-budgeted';
export const FIXED_SEED = 'seed-image-pipeline-185-v3';
export const ARTIFACT_CONTRACT_VERSION = 3;
export const CAPTURE_PROFILE = Object.freeze( {
	viewport: { width: 1200, height: 760 },
	dpr: 1,
	warmupFrames: 4,
	sampleFrames: 16,
	lifecycleIterations: 3,
	webgpuCopyRowAlignment: 256,
	readbackBytesPerTexel: 4
} );

export const ARTIFACT_RELATIVE_DIR =
	`artifacts/visual-validation/${ SCENE_ID }/${ THREE_REVISION_LABEL }/${ QUALITY_TIER }/${ FIXED_SEED }`;

export const REQUIRED_IMAGES = Object.freeze( [
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/camera.near.png',
	'images/camera.design.png',
	'images/camera.far.png',
	'images/seed-0001.final.png',
	'images/seed-stress.final.png'
] );

export const DIAGNOSTIC_IMAGES = Object.freeze( [
	'images/AO.static.png',
	'images/bloom.static.png',
	'images/normal.static.png',
	'images/emissive.static.png',
	'images/linear-depth.static.png',
	'images/pre-tone-map.static.png'
] );

export const ARTIFACT_NUMERIC_PROVENANCE = Object.freeze( {
	ARTIFACT_CONTRACT_VERSION: 'Derived version discriminator that rejects stale bundles.',
	CAMERA_BOOKMARKS: 'Authored fixed-view validation fixture.',
	CAPTURE_VIEWPORT: 'Authored deterministic artifact extent.',
	CAPTURE_DPR: 'Authored deterministic artifact scale.',
	LIFECYCLE_ITERATIONS: 'Authored bounded leak-loop sample count; not a statistical proof.',
	CACHE_ALLOWANCE_TEXTURES: 'Authored bounded-cache gate with an explicit owner and reason.',
	CPU_SAMPLE_COUNT: 'Authored artifact sample count; results are recorded, not generalized.',
	CPU_WARMUP_COUNT: 'Authored warm-up count; results are recorded, not generalized.',
	GPU_TIMESTAMP_SAMPLE_COUNT: 'Authored timestamp sample count when the target supports timestamp-query.',
	READBACK_BYTES_PER_TEXEL: 'Derived from RGBA8 capture storage.',
	WEBGPU_COPY_ROW_ALIGNMENT: 'Gated by the WebGPU copy layout used by r185 readback.',
	FRAME_BUDGETS: 'Authored capture-liveness ceilings required by the shared schema; not product performance targets.',
	MEMORY_BUDGET_MIB: 'Authored lower-bound-accounting gate required by the shared schema; not physical residency proof.',
	IMAGE_THRESHOLDS: 'Authored falsifiability gates for this fixed fixture; not transferable quality thresholds.'
} );
