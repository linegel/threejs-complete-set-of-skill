import { traa } from 'three/addons/tsl/display/TRAANode.js';

const SETTINGS = [ 'depthThreshold', 'edgeDepthDiff', 'maxVelocityLength', 'useSubpixelCorrection' ];

// Synchronous graph transaction, not shader/GPU acceptance. The host owns both
// returned generations until it can retire one after final GPU use.
export function rebuildTraaNode( {
	previousNode = null, renderPipeline, beautyTexture, depthTexture,
	velocityTexture, camera, composeOutput
} = {} ) {

	if ( ! renderPipeline || renderPipeline.outputNode?.isNode !== true ||
		typeof renderPipeline.outputColorTransform !== 'boolean' ) {
		throw new TypeError( 'renderPipeline must own a valid output node and transform policy.' );
	}
	if ( typeof composeOutput !== 'function' ) throw new TypeError( 'composeOutput must be a function.' );
	if ( camera?.isCamera !== true || typeof camera.setViewOffset !== 'function' ) {
		throw new TypeError( 'camera must support the stock TRAA projection API.' );
	}
	if ( camera.view?.enabled === true ) throw new RangeError( 'Stock TRAA cannot preserve an active camera view offset.' );
	const beautyTarget = beautyTexture?.isRTTNode === true
		? beautyTexture.renderTarget : beautyTexture?.passNode?.renderTarget;
	if ( beautyTexture?.isTextureNode !== true || ! beautyTarget ) {
		throw new TypeError( 'beautyTexture needs an explicit render-target owner; materialize composites first.' );
	}
	if ( depthTexture?.isTextureNode !== true || velocityTexture?.isTextureNode !== true ) {
		throw new TypeError( 'Depth and velocity inputs must be texture nodes.' );
	}
	if ( previousNode !== null && previousNode.isTRAANode !== true ) {
		throw new TypeError( 'previousNode must be a TRAANode or null.' );
	}
	if ( previousNode ) {
		for ( const key of SETTINGS.slice( 0, 3 ) ) {
			if ( ! Number.isFinite( previousNode[ key ] ) || previousNode[ key ] < 0 ||
				( key === 'maxVelocityLength' && previousNode[ key ] === 0 ) ) {
				throw new RangeError( `Invalid TRAA setting: ${ key }` );
			}
		}
		if ( typeof previousNode.useSubpixelCorrection !== 'boolean' ) throw new TypeError( 'Invalid subpixel policy.' );
	}
	const previousOutputNode = renderPipeline.outputNode;
	const previousOutputColorTransform = renderPipeline.outputColorTransform;
	const node = traa( beautyTexture, depthTexture, velocityTexture, camera );
	if ( previousNode ) for ( const key of SETTINGS ) node[ key ] = previousNode[ key ];
	const resolvedTexture = node.getTextureNode();
	let outputNode;
	try {
		outputNode = composeOutput( resolvedTexture );
		if ( outputNode?.isNode !== true ) throw new TypeError( 'composeOutput must synchronously return a node.' );
	} catch ( error ) {
		node.dispose();
		throw error;
	}
	renderPipeline.outputNode = outputNode;
	renderPipeline.outputColorTransform = false;
	renderPipeline.needsUpdate = true;
	let restored = false;
	function rollback() {
		if ( restored ) return false;
		if ( renderPipeline.outputNode !== outputNode || renderPipeline.outputColorTransform !== false ) {
			throw new Error( 'Pipeline ownership changed after this replacement.' );
		}
		renderPipeline.outputNode = previousOutputNode;
		renderPipeline.outputColorTransform = previousOutputColorTransform;
		renderPipeline.needsUpdate = true;
		restored = true;
		return true;
	}

	// Rollback only rebinds output. It neither restores camera/renderer side
	// effects from failed rendering nor disposes potentially in-flight resources.
	// composeOutput must own explicit final output conversion and its allocations.
	return { node, resolvedTexture, previousNode, previousOutputNode,
		previousOutputColorTransform, rollback };

}
