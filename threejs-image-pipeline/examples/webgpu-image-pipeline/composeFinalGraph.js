import { float, renderOutput, vec4 } from 'three/tsl';

export function composeFinalGraph( {
	config,
	scenePass,
	gtao = null,
	bloomPass = null
} ) {

	const hdrColor = scenePass.getTextureNode( 'output' );
	const normalTex = config.requiredMRT.includes( 'normal' )
		? scenePass.getTextureNode( 'normal' )
		: null;
	const emissiveTex = config.requiredMRT.includes( 'emissive' )
		? scenePass.getTextureNode( 'emissive' )
		: null;
	const depthTex = scenePass.getTextureNode( 'depth' );
	const linearDepth = scenePass.getLinearDepthNode( 'depth' );
	const aoTextureNode = gtao?.getTextureNode() ?? null;
	const indirectVisibility = aoTextureNode?.r ?? float( 1 );
	const debugFinalColorMultiplyBaseline = vec4(
		hdrColor.rgb.mul( indirectVisibility ),
		hdrColor.a
	);

	// [Authored scaffold] This fixture has no physical direct/indirect buffers.
	// The split demonstrates graph ownership only and is never cited as AO
	// correctness evidence.
	const directLightingEstimate = hdrColor.rgb.mul( 1 - config.aoIndirectFraction );
	const indirectLightingEstimate = hdrColor.rgb
		.mul( config.aoIndirectFraction )
		.mul( indirectVisibility );
	const authoredAoSplitComposite = vec4(
		directLightingEstimate.add( indirectLightingEstimate ),
		hdrColor.a
	);

	if ( config.temporal.enabled === true || config.features.temporal === true ) {

		throw new Error( 'Temporal output is unsupported by this example because it has no executable reset/reseed owner.' );

	}

	const temporal = null;
	const stableSceneHdr = authoredAoSplitComposite;
	const bloomTextureNode = bloomPass?.getTextureNode() ?? null;
	const hdrComposite = bloomTextureNode
		? vec4( stableSceneHdr.rgb.add( bloomTextureNode.rgb ), stableSceneHdr.a )
		: stableSceneHdr;
	const noPostOutputNode = renderOutput( hdrColor );
	const finalOutputNode = renderOutput( hdrComposite );

	return {
		finalOutputNode,
		noPostOutputNode,
		finalNode: hdrComposite,
		aoTextureNode,
		indirectVisibility,
		hdrColor,
		normalTex,
		emissiveTex,
		depthTex,
		linearDepth,
		debugFinalColorMultiplyBaseline,
		directLightingEstimate,
		indirectLightingEstimate,
		authoredAoSplitComposite,
		stableSceneHdr,
		hdrComposite,
		temporal,
		bloomTextureNode,
		claimBoundary: config.contract
	};

}
