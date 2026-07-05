import { renderOutput } from 'three/tsl';

export function composeFinalGraph( {
	config,
	scenePass,
	gtao,
	bloomPass,
	traaFactory = null,
	velocityNode = null,
	camera = null
} ) {

	const hdrColor = scenePass.getTextureNode( 'output' );
	const normalTex = scenePass.getTextureNode( 'normal' );
	const emissiveTex = scenePass.getTextureNode( 'emissive' );
	const depthTex = scenePass.getTextureNode( 'depth' );
	const aoTextureNode = gtao.getTextureNode();
	const indirectVisibility = aoTextureNode.r;
	const debugFinalColorMultiplyBaseline = hdrColor.mul( indirectVisibility );
	const directLightingEstimate = hdrColor.mul( 1 - config.aoIndirectFraction );
	const indirectLightingEstimate = hdrColor.mul( config.aoIndirectFraction ).mul( indirectVisibility );
	const lightingAwareAoComposite = directLightingEstimate.add( indirectLightingEstimate );
	const hdrComposite = lightingAwareAoComposite.add( bloomPass.getTextureNode() );

	if ( config.temporal.enabled === true && typeof traaFactory !== 'function' ) {

		throw new Error( 'Temporal image-pipeline composition requires traaFactory.' );

	}

	const temporal = config.temporal.enabled === true
		? traaFactory( { hdrComposite, depthTex, velocityNode, camera } )
		: null;
	const finalNode = temporal ? temporal.getTextureNode() : hdrComposite;
	const finalOutputNode = renderOutput( finalNode );

	return {
		finalOutputNode,
		finalNode,
		aoTextureNode,
		indirectVisibility,
		hdrColor,
		normalTex,
		emissiveTex,
		depthTex,
		debugFinalColorMultiplyBaseline,
		directLightingEstimate,
		indirectLightingEstimate,
		lightingAwareAoComposite,
		hdrComposite,
		temporal,
		bloomTextureNode: bloomPass.getTextureNode()
	};

}
