export const SCENE_ID = 'webgpu-image-pipeline';
export const THREE_REVISION_LABEL = 'r185';
export const QUALITY_TIER = 'native-budgeted';
export const FIXED_SEED = 'seed-image-pipeline-185';

export const ARTIFACT_RELATIVE_DIR =
	`artifacts/visual-validation/${ SCENE_ID }/${ THREE_REVISION_LABEL }/${ QUALITY_TIER }/${ FIXED_SEED }`;

export const REQUIRED_IMAGES = [
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/camera.near.png',
	'images/camera.design.png',
	'images/camera.far.png',
	'images/seed-0001.final.png',
	'images/seed-stress.final.png',
	'images/temporal.t000.png',
	'images/temporal.t001.png'
];
