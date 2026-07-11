import { mix, renderOutput, uniform } from 'three/tsl';

export const IMAGE_PIPELINE_AO_OWNERS = Object.freeze( {
	renderer: 'threejs-image-pipeline-host',
	pipeline: 'threejs-image-pipeline-host',
	primaryScenePass: 'threejs-image-pipeline-host',
	depth: 'threejs-image-pipeline-host',
	normal: 'threejs-image-pipeline-host',
	velocity: 'threejs-image-pipeline-host',
	gtao: 'threejs-ambient-contact-shading',
	reconstruction: 'threejs-ambient-contact-shading',
	litScenePass: 'threejs-ambient-contact-shading',
	toneMap: 'threejs-image-pipeline-host/renderOutput',
	outputTransform: 'threejs-image-pipeline-host/renderOutput'
} );

function assertObject( value, message ) {

	if ( value === null || typeof value !== 'object' ) throw new TypeError( message );

}

function duplicateIds( records ) {

	const seen = new Set();
	const duplicates = [];
	for ( const record of records ) {

		if ( seen.has( record.id ) ) duplicates.push( record.id );
		seen.add( record.id );

	}
	return duplicates;

}

export function validateImagePipelineAOOwnership( graph ) {

	const errors = [];
	if ( graph?.schemaVersion !== 2 ) errors.push( 'runtime graph must use schemaVersion 2' );
	for ( const [ key, expected ] of Object.entries( IMAGE_PIPELINE_AO_OWNERS ) ) {

		if ( graph?.owners?.[ key ] !== expected ) errors.push( `owner ${ key } must be ${ expected }` );

	}
	const submissions = graph?.sceneSubmissions ?? [];
	if ( submissions.length !== 2 ) errors.push( 'integrated AO must have exactly two scene submissions' );
	if ( submissions.filter( ( pass ) => pass.kind === 'prepass' ).length !== 1 ) errors.push( 'integrated AO must have exactly one gbuffer prepass' );
	if ( submissions.filter( ( pass ) => pass.kind === 'lit-scene' ).length !== 1 ) errors.push( 'integrated AO must have exactly one lit scene pass' );
	if ( submissions.find( ( pass ) => pass.kind === 'prepass' )?.owner !== IMAGE_PIPELINE_AO_OWNERS.primaryScenePass ) errors.push( 'the image-pipeline host must own the shared gbuffer prepass' );
	if ( submissions.find( ( pass ) => pass.kind === 'lit-scene' )?.owner !== IMAGE_PIPELINE_AO_OWNERS.litScenePass ) errors.push( 'the AO stage must own the context-lit scene pass' );
	const signalDuplicates = duplicateIds( graph?.signals ?? [] );
	if ( signalDuplicates.length > 0 ) errors.push( `semantic signals must have one producer: ${ signalDuplicates.join( ', ' ) }` );
	const resourceDuplicates = duplicateIds( graph?.resources ?? [] );
	if ( resourceDuplicates.length > 0 ) errors.push( `runtime resources must have one owner: ${ resourceDuplicates.join( ', ' ) }` );
	if ( graph?.finalToneMapOwner !== IMAGE_PIPELINE_AO_OWNERS.toneMap ) errors.push( 'integration must have one tone-map owner' );
	if ( graph?.finalOutputTransformOwner !== IMAGE_PIPELINE_AO_OWNERS.outputTransform ) errors.push( 'integration must have one output-transform owner' );
	if ( ( graph?.computeDispatches ?? [] ).length !== 0 ) errors.push( 'stock GTAONode integration declares render work, not application-owned compute dispatches' );

	return { valid: errors.length === 0, errors };

}

function derivedBytes( value, source ) {

	return { value, unit: 'bytes', label: 'Derived', source };

}

export function createImagePipelineAOHostAdapter( {
	renderPipeline,
	scene,
	camera,
	ownerId = 'threejs-image-pipeline-host'
} ) {

	assertObject( renderPipeline, 'image-pipeline AO adapter requires a RenderPipeline-like host' );
	if ( scene?.isScene !== true ) throw new TypeError( 'image-pipeline AO adapter requires a Scene' );
	if ( camera?.isCamera !== true ) throw new TypeError( 'image-pipeline AO adapter requires a Camera' );
	if ( ownerId !== IMAGE_PIPELINE_AO_OWNERS.renderer ) throw new Error( `unsupported image-pipeline owner ${ ownerId }` );

	let stage = null;
	let currentMode = 'unattached';
	const diagnosticKeepAlive = uniform( 0 );

	function attachAOStage( nextStage ) {

		if ( stage !== null ) throw new Error( 'shared gbuffer owner is already attached' );
		assertObject( nextStage, 'AO stage is required' );
		if ( nextStage.gbufferPass?.scene !== scene || nextStage.gbufferPass?.camera !== camera ) throw new Error( 'AO gbuffer pass must use the host scene and camera' );
		if ( nextStage.litScenePass?.scene !== scene || nextStage.litScenePass?.camera !== camera ) throw new Error( 'AO lit pass must use the host scene and camera' );
		if ( nextStage.gbufferPass === nextStage.litScenePass ) throw new Error( 'prepass and lit pass must be distinct scene submissions' );
		stage = nextStage;
		setOutput( 'final', stage.materialContextOutput, { diagnostic: false } );
		return stage;

	}

	function setOutput( mode, node, { diagnostic = true } = {} ) {

		if ( stage === null ) throw new Error( 'attach AO stage before selecting output' );
		if ( ! node?.isNode ) throw new TypeError( `output mode ${ mode } requires a TSL node` );
		// A dynamic-zero mix keeps the context-lit pass reachable in diagnostics;
		// the integration contract therefore remains one prepass plus one lit pass.
		const integratedNode = diagnostic === true
			? mix( node, stage.materialContextOutput, diagnosticKeepAlive )
			: node;
		renderPipeline.outputNode = renderOutput( integratedNode );
		renderPipeline.outputColorTransform = false;
		renderPipeline.needsUpdate = true;
		currentMode = mode;
		return mode;

	}

	function describeRuntimeGraph( {
		physicalWidth,
		physicalHeight,
		aoScale,
		temporalEnabled = false
	} ) {

		if ( stage === null ) throw new Error( 'cannot describe an unattached AO integration' );
		if ( ! Number.isInteger( physicalWidth ) || ! Number.isInteger( physicalHeight ) || physicalWidth < 1 || physicalHeight < 1 ) throw new Error( 'physical graph dimensions must be positive integers' );
		if ( ! Number.isFinite( aoScale ) || aoScale <= 0 || aoScale > 1 ) throw new Error( 'AO scale must be in (0, 1]' );
		const pixels = physicalWidth * physicalHeight;
		const aoWidth = Math.round( physicalWidth * aoScale );
		const aoHeight = Math.round( physicalHeight * aoScale );
		const graph = {
			schemaVersion: 2,
			owners: { ...IMAGE_PIPELINE_AO_OWNERS },
			signals: [
				{ id: 'depth', producer: ownerId, consumers: [ 'GTAONode', 'AO-reconstruction' ], reachable: true, encoding: 'standard device depth' },
				{ id: 'normal', producer: ownerId, consumers: [ 'GTAONode', 'AO-reconstruction' ], reachable: true, encoding: 'view-space normal' },
				{ id: 'velocity', producer: ownerId, consumers: temporalEnabled ? [ 'TRAANode' ] : [ 'diagnostics' ], reachable: true, encoding: 'current-minus-previous NDC' },
				{ id: 'ao-visibility', producer: IMAGE_PIPELINE_AO_OWNERS.gtao, consumers: [ 'builtinAOContext' ], reachable: true, encoding: 'scalar visibility [0,1]' },
				{ id: 'lit-hdr', producer: IMAGE_PIPELINE_AO_OWNERS.litScenePass, consumers: [ IMAGE_PIPELINE_AO_OWNERS.toneMap ], reachable: true, encoding: 'scene-linear HDR' }
			],
			sceneSubmissions: [
				{ id: 'shared-gbuffer-prepass', owner: ownerId, kind: 'prepass', count: 1 },
				{ id: 'ao-context-lit-scene', owner: IMAGE_PIPELINE_AO_OWNERS.litScenePass, kind: 'lit-scene', count: 1 }
			],
			computeDispatches: [],
			resources: [
				{ id: 'gbuffer-output', owner: ownerId, kind: 'rgba16float-render-target', residentBytes: derivedBytes( 8 * pixels, 'RGBA16F: 8 bytes per physical pixel' ) },
				{ id: 'gbuffer-normal', owner: ownerId, kind: 'rgba16float-render-target', residentBytes: derivedBytes( 8 * pixels, 'RGBA16F: 8 bytes per physical pixel' ) },
				{ id: 'gbuffer-velocity', owner: ownerId, kind: 'rgba16float-render-target', residentBytes: derivedBytes( 8 * pixels, 'r185 PassNode-cloned half-float attachment' ) },
				{ id: 'gbuffer-depth', owner: ownerId, kind: 'depth-texture', residentBytes: derivedBytes( 4 * pixels, '32-bit depth accounting lower bound' ) },
				{ id: 'gtao-visibility', owner: IMAGE_PIPELINE_AO_OWNERS.gtao, kind: 'r8unorm-render-target', residentBytes: derivedBytes( aoWidth * aoHeight, 'R8 visibility at rounded AO extent' ) },
				{ id: 'ao-reconstruction', owner: IMAGE_PIPELINE_AO_OWNERS.reconstruction, kind: 'r8unorm-render-target', residentBytes: derivedBytes( pixels, 'full-resolution R8 reconstructed visibility' ) },
				{ id: 'lit-hdr', owner: IMAGE_PIPELINE_AO_OWNERS.litScenePass, kind: 'rgba16float-render-target', residentBytes: derivedBytes( 8 * pixels, 'RGBA16F: 8 bytes per physical pixel' ) }
			],
			finalToneMapOwner: IMAGE_PIPELINE_AO_OWNERS.toneMap,
			finalOutputTransformOwner: IMAGE_PIPELINE_AO_OWNERS.outputTransform
		};
		const validation = validateImagePipelineAOOwnership( graph );
		if ( validation.valid !== true ) throw new Error( validation.errors.join( '; ' ) );
		return graph;

	}

	return {
		attachAOStage,
		setOutput,
		describeRuntimeGraph,
		get currentMode() {

			return currentMode;

		},
		get stage() {

			return stage;

		}
	};

}
