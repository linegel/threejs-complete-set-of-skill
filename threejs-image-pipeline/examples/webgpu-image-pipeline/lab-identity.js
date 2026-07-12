export const IMAGE_PIPELINE_LAB_IDS = Object.freeze([
	'webgpu-image-pipeline',
	'webgpu-temporal-history'
]);

export function resolveImagePipelineLabId( requestedId = 'webgpu-image-pipeline' ) {

	if ( ! IMAGE_PIPELINE_LAB_IDS.includes( requestedId ) ) throw new RangeError( `Unknown image-pipeline lab identity "${ requestedId }".` );
	return requestedId;

}
