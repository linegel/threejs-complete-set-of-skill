import { traa } from 'three/addons/tsl/display/TRAANode.js';

// composeOutput must return the complete final node, including renderOutput()
// when this helper disables RenderPipeline's internal output transform.
export function rebuildTraaNode( {
	previousNode = null,
	renderPipeline,
	beautyTexture,
	depthTexture,
	velocityTexture,
	camera,
	composeOutput
} ) {

	if ( ! renderPipeline ) throw new TypeError( 'renderPipeline is required.' );
	if ( typeof composeOutput !== 'function' ) throw new TypeError( 'composeOutput must be a function.' );

	const node = traa( beautyTexture, depthTexture, velocityTexture, camera );
	const resolvedTexture = node.getTextureNode();
	let outputNode;

	try {

		outputNode = composeOutput( resolvedTexture );

	} catch ( error ) {

		node.dispose();
		throw error;

	}

	renderPipeline.outputNode = outputNode;
	renderPipeline.outputColorTransform = false;
	renderPipeline.needsUpdate = true;

	// The host retires previousNode only after the replacement graph has
	// compiled/rendered successfully and the prior GPU generation has completed.
	return { node, resolvedTexture, previousNode };

}
