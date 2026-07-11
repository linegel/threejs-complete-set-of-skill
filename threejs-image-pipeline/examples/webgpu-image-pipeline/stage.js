import { HalfFloatType } from 'three/webgpu';
import { bypass, float, length, rtt, texture, vec3, vec4 } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

import { createExposureColorStage } from '../../../threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/stage.js';

function requireNode( node, label ) {

	if ( ! node?.isNode ) throw new Error( `Image-pipeline stage requires ${ label } to be a TSL node.` );
	return node;

}

/**
 * Builds post composition for a host-owned renderer, camera, scene pass, and
 * RenderPipeline. The adapter never constructs or presents through a private
 * renderer/pipeline owner.
 */
export function createImagePipelineStage( {
	renderer,
	camera,
	sceneColorTextureNode,
	depthTextureNode,
	velocityTextureNode = null,
	emissiveTextureNode = null,
	bloomTextureNode = null,
	aoVisibilityTextureNode = null,
	meterMaskNode = null,
	exposureTier = 'full-histogram',
	temporal = true,
	toneMappingVariant = 'Neutral',
	lutVariant = null
} ) {

	if ( ! renderer?.initialized ) throw new Error( 'Image-pipeline stage requires an initialized host renderer.' );
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Image-pipeline stage requires native WebGPU.' );
	if ( ! camera?.isCamera ) throw new Error( 'Image-pipeline stage requires a host-owned camera.' );
	requireNode( sceneColorTextureNode, 'sceneColorTextureNode' );
	requireNode( depthTextureNode, 'depthTextureNode' );
	if ( temporal ) requireNode( velocityTextureNode, 'velocityTextureNode when temporal=true' );
	if ( emissiveTextureNode ) requireNode( emissiveTextureNode, 'emissiveTextureNode' );
	if ( bloomTextureNode ) requireNode( bloomTextureNode, 'bloomTextureNode' );
	if ( aoVisibilityTextureNode ) requireNode( aoVisibilityTextureNode, 'aoVisibilityTextureNode' );

	const stableCurrentTexture = rtt( sceneColorTextureNode, null, null, { type: HalfFloatType, depthBuffer: false } );
	let temporalNode = null;
	let temporalHistoryTexture = null;
	let temporalResolvedTexture = stableCurrentTexture;
	let temporalConfidenceNode = vec4( vec3( 1 ), 1 );
	let preGradeTexture = null;
	let exposureStage = null;
	let generation = 0;
	let resetLog = [];
	let disposed = false;

	function disposeDynamicGraph() {

		exposureStage?.dispose();
		preGradeTexture?.dispose?.();
		temporalNode?.dispose?.();
		exposureStage = null;
		preGradeTexture = null;
		temporalNode = null;
		temporalHistoryTexture = null;

	}

	function buildDynamicGraph( cause ) {

		if ( disposed ) throw new Error( 'Image-pipeline stage is disposed.' );
		disposeDynamicGraph();
		if ( temporal ) {

			temporalNode = traa( stableCurrentTexture, depthTextureNode, velocityTextureNode, camera );
			temporalResolvedTexture = temporalNode.getTextureNode();
			// Diagnostic-only, version-gated private access: r185 has no public
			// TRAANode history getter.
			temporalHistoryTexture = texture( temporalNode._historyRenderTarget.texture );
			const disagreement = length( stableCurrentTexture.rgb.sub( temporalHistoryTexture.rgb ) ).mul( 1 / Math.sqrt( 3 ) );
			temporalConfidenceNode = bypass( vec4( vec3( float( 1 ).sub( disagreement ).clamp( 0, 1 ) ), 1 ), temporalResolvedTexture );
			generation += 1;

		} else {

			temporalResolvedTexture = stableCurrentTexture;
			temporalConfidenceNode = vec4( vec3( 1 ), 1 );

		}
		const composedHdr = bloomTextureNode
			? vec4( temporalResolvedTexture.rgb.add( bloomTextureNode.rgb ), temporalResolvedTexture.a )
			: temporalResolvedTexture;
		// Exposure meters exactly the composed scene-linear pre-grade signal.
		preGradeTexture = rtt( composedHdr, null, null, { type: HalfFloatType, depthBuffer: false } );
		exposureStage = createExposureColorStage( {
			renderer,
			meterSourceTextureNode: preGradeTexture,
			hdrColorNode: preGradeTexture,
			tierId: exposureTier,
			meterMaskNode,
			toneMappingVariant,
			lutVariant
		} );
		resetLog.push( { cause, generation, freshHistoryRequired: temporal } );

	}

	buildDynamicGraph( 'initialization' );

	function beforeRender( deltaSeconds ) {

		return exposureStage.beforeRender( deltaSeconds );

	}

	function meterAfterRender() {

		return exposureStage.meterAfterRender();

	}

	function resetHistory( cause ) {

		if ( typeof cause !== 'string' || cause.length === 0 ) throw new Error( 'Image-pipeline history reset requires a nonempty cause.' );
		buildDynamicGraph( cause );
		return { ...resetLog.at( - 1 ), outputNodeChanged: true };

	}

	function nodes() {

		return {
			output: exposureStage.outputNode,
			preGrade: preGradeTexture,
			temporalCurrent: stableCurrentTexture,
			temporalHistory: temporalHistoryTexture,
			temporalResolved: temporalResolvedTexture,
			temporalConfidence: temporalConfidenceNode,
			emissive: emissiveTextureNode,
			bloom: bloomTextureNode,
			aoVisibility: aoVisibilityTextureNode
		};

	}

	function describe() {

		return {
			owner: 'host-image-pipeline-stage',
			hostOwned: [ 'renderer', 'camera', 'scenePass', 'RenderPipeline', 'bloomStage', 'outputNodeAssignment' ],
			stageOwned: [ 'stableCurrentTexture', 'preGradeTexture', ...( temporal ? [ 'TRAANode.history', 'TRAANode.resolve' ] : [] ), 'exposureState' ],
			inputSignals: {
				sceneColor: true,
				depth: true,
				velocity: temporal,
				emissive: emissiveTextureNode !== null,
				bloom: bloomTextureNode !== null,
				aoVisibility: aoVisibilityTextureNode !== null
			},
			aoApplication: 'diagnostic-only; host must supply an honest separated indirect-light context to apply AO',
			temporal: { enabled: temporal, node: temporalNode ? 'TRAANode' : null, history: temporalHistoryTexture ? 'TRAANode.history' : null, generation, resetLog: [ ...resetLog ] },
			exposure: exposureStage.describe(),
			compositionOrder: [ 'scene-linear HDR', ...( temporal ? [ 'TRAA' ] : [] ), ...( bloomTextureNode ? [ 'external bloom RGB' ] : [] ), 'materialize pre-grade HDR', 'exposure', 'tone map', 'LUT', 'output transform' ],
			outputContract: 'host assigns stage.outputNode and sets hostRenderPipeline.outputColorTransform = false',
			physicalResidencyVerdict: 'INSUFFICIENT_EVIDENCE'
		};

	}

	async function readbackExposureState() {

		return exposureStage.readback();

	}

	function dispose() {

		if ( disposed ) return false;
		disposed = true;
		disposeDynamicGraph();
		stableCurrentTexture.dispose?.();
		return true;

	}

	return {
		get outputNode() { return exposureStage.outputNode; },
		get temporalNode() { return temporalNode; },
		nodes,
		beforeRender,
		meterAfterRender,
		resetHistory,
		readbackExposureState,
		describe,
		dispose
	};

}
