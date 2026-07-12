import { RenderPipeline } from 'three/webgpu';

import { validateValidationResourceLedger } from './resource-ledger.js';

const DEFAULT_REQUIRED_SIGNALS = Object.freeze( [ 'output', 'normal', 'emissive', 'depth' ] );

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ label } must be an object.` );
	return value;

}

function requireIdentifier( value, label ) {

	if ( typeof value !== 'string' || /^[a-z][a-z0-9-]*$/.test( value ) === false ) throw new TypeError( `${ label } must be a stable kebab-case identifier.` );
	return value;

}

function requireNode( value, label ) {

	if ( value === null || typeof value !== 'object' || value.isNode !== true ) throw new TypeError( `${ label } must be a Three.js Node.` );
	if ( typeof value.getChildren !== 'function' ) throw new TypeError( `${ label } must expose the r185 Node.getChildren() traversal API.` );
	if ( typeof value.uuid !== 'string' || value.uuid.length === 0 ) throw new TypeError( `${ label } must expose a UUID.` );
	if ( typeof value.type !== 'string' || value.type.length === 0 ) throw new TypeError( `${ label } must expose a node type.` );
	return value;

}

function sortedUniqueIdentifiers( values, label ) {

	if ( Array.isArray( values ) === false ) throw new TypeError( `${ label } must be an array.` );
	const result = values.map( ( value, index ) => requireIdentifier( value, `${ label }[${ index }]` ) );
	if ( new Set( result ).size !== result.length ) throw new Error( `${ label } contains duplicate identifiers.` );
	return [ ...result ].sort();

}

/**
 * Inspect a TSL node graph without reading private Node properties. The edge
 * list deliberately records only the order exposed by the public r185
 * Node.getChildren() iterator; property names are not part of that API.
 */
export function inspectNodeIdentityGraph( root, label = 'node graph root' ) {

	requireNode( root, label );
	const queue = [ root ];
	const visited = new Set();
	const nodes = [];
	const edges = [];
	const identities = new Map();

	while ( queue.length > 0 ) {

		const node = queue.shift();
		if ( visited.has( node ) ) continue;
		visited.add( node );
		requireNode( node, `${ label } node` );
		const priorIdentity = identities.get( node.uuid );
		if ( priorIdentity !== undefined && priorIdentity !== node ) throw new Error( `${ label } contains distinct node objects with aliased UUID ${ node.uuid }.` );
		identities.set( node.uuid, node );
		nodes.push( {
			uuid: node.uuid,
			type: node.type,
			name: typeof node.name === 'string' ? node.name : '',
			isRenderOutputNode: node.isRenderOutputNode === true
		} );

		const children = [ ...node.getChildren() ];
		for ( let childIndex = 0; childIndex < children.length; childIndex ++ ) {

			const child = requireNode( children[ childIndex ], `${ label } child ${ childIndex } of ${ node.uuid }` );
			edges.push( {
				fromUuid: node.uuid,
				toUuid: child.uuid,
				childIndex
			} );
			if ( visited.has( child ) === false ) queue.push( child );

		}

	}

	return {
		traversalApi: 'Three.js r185 Node.getChildren()',
		rootUuid: root.uuid,
		rootType: root.type,
		nodes,
		edges,
		renderOutputNodeCount: nodes.filter( ( node ) => node.isRenderOutputNode ).length,
		identitySet: visited
	};

}

function publicGraphRecord( inspection ) {

	return {
		traversalApi: inspection.traversalApi,
		rootUuid: inspection.rootUuid,
		rootType: inspection.rootType,
		nodes: inspection.nodes,
		edges: inspection.edges,
		renderOutputNodeCount: inspection.renderOutputNodeCount
	};

}

function resourceNumericEvidence( value, label, source ) {

	if ( Number.isFinite( value ) === false || value < 0 ) throw new Error( `${ source } has invalid resident bytes.` );
	return { value, unit: 'bytes', label, source };

}

function graphResourcesFromLedger( ledger ) {

	validateValidationResourceLedger( ledger );
	if ( ledger.state !== 'live' ) throw new Error( 'Runtime graph requires a live resource ledger.' );
	if ( ledger.classSummaries.renderTargets.verdict !== 'PASS' || ledger.classSummaries.geometryAllocations.verdict !== 'PASS' ) throw new Error( 'Runtime graph requires complete target and geometry resource classes.' );
	if ( ledger.renderTargets.some( ( target ) => target.runtimeMemory.status !== 'MEASURED' ) || ledger.geometryAllocations.some( ( allocation ) => allocation.runtimeMemory.status !== 'MEASURED' ) ) throw new Error( 'Runtime graph requires identity-keyed renderer.info.memoryMap bytes for targets and geometry.' );
	const resources = [
		...ledger.renderTargets.map( ( target ) => ( {
			id: target.textureUuid,
			owner: target.owner,
			kind: `render-target-texture:${ target.semantic }`,
			residentBytes: resourceNumericEvidence( target.runtimeMemory.bytes, 'Measured', target.runtimeMemory.source ),
			semantic: target.semantic,
			format: target.format,
			liveness: target.liveness,
			ledgerIdentityClosureDigest: ledger.identityClosureDigest
		} ) ),
		...ledger.geometryAllocations.map( ( allocation ) => ( {
			id: allocation.id,
			owner: 'validation-scene',
			kind: 'geometry-buffer',
			residentBytes: resourceNumericEvidence( allocation.runtimeMemory.bytes, 'Measured', allocation.runtimeMemory.source ),
			bindings: allocation.bindings,
			liveness: allocation.liveness,
			ledgerIdentityClosureDigest: ledger.identityClosureDigest
		} ) ),
		...ledger.transientResources.timestampBuffers.map( ( buffer ) => ( {
			id: buffer.id,
			owner: `${ buffer.poolType }-timestamp-pool`,
			kind: `timestamp-${ buffer.component }`,
			residentBytes: resourceNumericEvidence( buffer.logicalBytes, 'Measured', 'actual GPUBuffer.size exposed by the live timestamp pool' ),
			liveness: buffer.liveness,
			ledgerIdentityClosureDigest: ledger.identityClosureDigest
		} ) ),
		...ledger.transientResources.readbackBuffers.map( ( buffer ) => ( {
			id: buffer.id,
			owner: 'validation-readback',
			kind: 'readback-buffer',
			residentBytes: resourceNumericEvidence( buffer.runtimeMemory.bytes, 'Measured', buffer.runtimeMemory.source ),
			liveness: buffer.liveness,
			ledgerIdentityClosureDigest: ledger.identityClosureDigest
		} ) )
	];
	const identities = new Set();
	for ( const resource of resources ) {

		if ( typeof resource.id !== 'string' || resource.id.length === 0 ) throw new Error( 'Runtime graph resource has no actual identity.' );
		if ( identities.has( resource.id ) ) throw new Error( `Runtime graph resource identity ${ resource.id } is aliased.` );
		identities.add( resource.id );

	}
	return resources;

}

function normalizeReadbackSinks( sinks, ledger, resources ) {

	if ( Array.isArray( sinks ) === false || sinks.length === 0 ) throw new TypeError( 'readbackSinks must contain actual capture evidence.' );
	const resourceIds = new Set( resources.map( ( resource ) => resource.id ) );
	const captureTarget = ledger.renderTargets.find( ( target ) => target.semantic === 'capture-target' );
	const sinkIds = new Set();
	const normalized = sinks.map( ( sink, index ) => {

		requireRecord( sink, `readbackSinks[${ index }]` );
		if ( typeof sink.id !== 'string' || sink.id.length === 0 || sinkIds.has( sink.id ) ) throw new Error( `readbackSinks[${ index }] has a missing or aliased identity.` );
		sinkIds.add( sink.id );
		if ( sink.resourceId !== captureTarget.textureUuid || resourceIds.has( sink.resourceId ) === false ) throw new Error( `readbackSinks[${ index }] must bind the validated capture-target texture identity.` );
		if ( sink.method !== 'renderer.readRenderTargetPixelsAsync' ) throw new Error( `readbackSinks[${ index }] must name the actual renderer readback method.` );
		if ( sink.resourceFormat !== captureTarget.format || sink.transportFormat !== 'rgba8unorm' ) throw new Error( `readbackSinks[${ index }] must distinguish the sRGB resource from raw RGBA8 transport bytes.` );
		if ( Number.isInteger( sink.observedByteLength ) === false || sink.observedByteLength <= 0 ) throw new Error( `readbackSinks[${ index }] must report an observed byte length.` );
		return { ...sink };

	} );
	return normalized;

}

/**
 * Build falsifiable runtime graph evidence from exact Node identities.
 *
 * `compiledFragmentRoot` is the fragment root installed on the compiled
 * fullscreen material after RenderPipeline has applied its context wrapper.
 * The selected route root therefore need not equal it, but it must be
 * identity-reachable from it and no other fixed route root may be reachable.
 */
export function inspectRuntimeGraph( {
	selectedRoute,
	renderPipeline,
	routeRoots,
	signalNodes,
	signalProducers,
	routeSignalContract,
	requiredSignals = DEFAULT_REQUIRED_SIGNALS,
	resourceLedger,
	readbackSinks,
	owners = {
		renderer: 'native-validation-subject',
		renderPipeline: 'native-validation-subject',
		sceneSignals: 'scene-pass',
		toneMap: 'renderOutput',
		outputTransform: 'renderOutput'
	},
	finalToneMapOwner = 'renderOutput',
	finalOutputTransformOwner = 'renderOutput'
} ) {

	const selectedRouteId = requireIdentifier( selectedRoute, 'selectedRoute' );
	if ( renderPipeline instanceof RenderPipeline === false ) throw new TypeError( 'renderPipeline must be the live r185 RenderPipeline instance.' );
	if ( renderPipeline.renderer?.isWebGPURenderer !== true ) throw new TypeError( 'renderPipeline must retain the live WebGPURenderer.' );
	if ( renderPipeline.needsUpdate !== false ) throw new Error( 'RenderPipeline graph must be compiled before inspection.' );
	if ( renderPipeline.outputColorTransform !== false ) throw new Error( 'RenderPipeline must delegate the sole output transform to RenderOutputNode.' );
	const compiledFragmentRoot = requireNode( renderPipeline._quadMesh?.material?.fragmentNode, 'installed RenderPipeline fragment root' );
	requireRecord( routeRoots, 'routeRoots' );
	requireRecord( signalNodes, 'signalNodes' );
	requireRecord( signalProducers, 'signalProducers' );
	requireRecord( routeSignalContract, 'routeSignalContract' );
	requireRecord( owners, 'owners' );
	for ( const ownerId of [ 'renderer', 'renderPipeline', 'sceneSignals', 'toneMap', 'outputTransform' ] ) {

		if ( typeof owners[ ownerId ] !== 'string' || owners[ ownerId ].length === 0 ) throw new Error( `owners.${ ownerId } must be non-empty.` );

	}
	if ( owners.toneMap !== finalToneMapOwner || owners.outputTransform !== finalOutputTransformOwner ) throw new Error( 'Final tone-map and output-transform owners must reconcile with the owner graph.' );
	const requiredSignalIds = sortedUniqueIdentifiers( requiredSignals, 'requiredSignals' );
	const routeIds = Object.keys( routeRoots ).sort();
	if ( routeIds.length === 0 ) throw new Error( 'routeRoots must declare at least one fixed route.' );
	if ( Object.hasOwn( routeRoots, selectedRouteId ) === false ) throw new Error( `Selected route ${ selectedRouteId } is not declared.` );
	if ( Object.keys( routeSignalContract ).sort().join( '\u0000' ) !== routeIds.join( '\u0000' ) ) throw new Error( 'routeSignalContract must cover exactly the declared route roots.' );

	const signalIds = Object.keys( signalNodes ).sort();
	for ( const signalId of requiredSignalIds ) {

		if ( Object.hasOwn( signalNodes, signalId ) === false ) throw new Error( `Required signal ${ signalId } is omitted from the runtime graph.` );

	}
	if ( Object.keys( signalProducers ).sort().join( '\u0000' ) !== signalIds.join( '\u0000' ) ) throw new Error( 'signalProducers must cover exactly the known signal-node identities.' );

	const signalObjects = new Set();
	const signalUuids = new Set();
	const signalPassNodes = new Set();
	const producedSignals = signalIds.map( ( signalId ) => {

		requireIdentifier( signalId, `signalNodes.${ signalId }` );
		const node = requireNode( signalNodes[ signalId ], `signalNodes.${ signalId }` );
		if ( signalObjects.has( node ) || signalUuids.has( node.uuid ) ) throw new Error( `Signal ${ signalId } aliases another produced signal node.` );
		signalObjects.add( node );
		signalUuids.add( node.uuid );
		if ( node.passNode?.isPassNode !== true ) throw new Error( `Signal ${ signalId } is not an actual PassNode texture signal.` );
		signalPassNodes.add( node.passNode );
		const producer = signalProducers[ signalId ];
		if ( typeof producer !== 'string' || producer.length === 0 ) throw new TypeError( `signalProducers.${ signalId } must be non-empty.` );
		return { id: signalId, producer, nodeUuid: node.uuid, nodeType: node.type };

	} );
	if ( signalPassNodes.size !== 1 ) throw new Error( 'Known signal nodes must share exactly one producing PassNode identity.' );
	const signalPassNode = [ ...signalPassNodes ][ 0 ];

	const routeRootObjects = new Set();
	const routeRootUuids = new Set();
	const routeRootNodes = new Map();
	for ( const routeId of routeIds ) {

		requireIdentifier( routeId, `routeRoots.${ routeId }` );
		const root = requireNode( routeRoots[ routeId ], `routeRoots.${ routeId }` );
		if ( routeRootObjects.has( root ) || routeRootUuids.has( root.uuid ) ) throw new Error( `Route ${ routeId } aliases another fixed route output root.` );
		routeRootObjects.add( root );
		routeRootUuids.add( root.uuid );
		routeRootNodes.set( routeId, root );

	}
	const routeInspections = new Map();
	const routes = routeIds.map( ( routeId ) => {

		const root = routeRootNodes.get( routeId );
		if ( root.isRenderOutputNode !== true ) throw new Error( `Route ${ routeId } must be rooted at RenderOutputNode.` );
		const inspection = inspectNodeIdentityGraph( root, `route ${ routeId }` );
		routeInspections.set( routeId, inspection );
		if ( inspection.renderOutputNodeCount !== 1 ) throw new Error( `Route ${ routeId } must contain exactly one RenderOutputNode.` );
		const reachablePassNodes = [ ...inspection.identitySet ].filter( ( node ) => node.isPassNode === true );
		if ( reachablePassNodes.some( ( node ) => node !== signalPassNode ) ) throw new Error( `Route ${ routeId } reaches an undeclared PassNode.` );
		const reachableSignals = producedSignals.filter( ( signal ) => inspection.identitySet.has( signalNodes[ signal.id ] ) ).map( ( signal ) => signal.id ).sort();
		const expectedSignals = sortedUniqueIdentifiers( routeSignalContract[ routeId ], `routeSignalContract.${ routeId }` );
		for ( const signalId of expectedSignals ) {

			if ( Object.hasOwn( signalNodes, signalId ) === false ) throw new Error( `Route ${ routeId } expects unknown signal ${ signalId }.` );

		}
		if ( reachableSignals.join( '\u0000' ) !== expectedSignals.join( '\u0000' ) ) throw new Error( `Route ${ routeId } reachable signals do not match its fixed contract.` );
		return {
			id: routeId,
			rootUuid: root.uuid,
			rootType: root.type,
			reachableSignals,
			expectedSignals,
			renderOutputNodeCount: inspection.renderOutputNodeCount,
			graph: publicGraphRecord( inspection )
		};

	} );
	for ( const signalId of requiredSignalIds ) {

		if ( routes.some( ( route ) => route.reachableSignals.includes( signalId ) ) === false ) throw new Error( `Required signal ${ signalId } is not reachable from any fixed route.` );

	}

	const compiledInspection = inspectNodeIdentityGraph( compiledFragmentRoot, 'compiled fragment root' );
	const selectedRoot = routeRoots[ selectedRouteId ];
	if ( renderPipeline.outputNode !== selectedRoot ) throw new Error( 'Live RenderPipeline outputNode does not equal the selected fixed route root.' );
	if ( compiledInspection.identitySet.has( selectedRoot ) === false ) throw new Error( `Compiled fragment root does not identity-reach selected route ${ selectedRouteId }.` );
	const foreignRouteRoots = routeIds.filter( ( routeId ) => routeId !== selectedRouteId && compiledInspection.identitySet.has( routeRoots[ routeId ] ) );
	if ( foreignRouteRoots.length > 0 ) throw new Error( `Compiled fragment root reaches non-selected route roots: ${ foreignRouteRoots.join( ', ' ) }.` );
	if ( compiledInspection.renderOutputNodeCount !== 1 ) throw new Error( 'Compiled fragment graph must contain exactly one RenderOutputNode owner.' );
	const compiledReachableSignals = producedSignals.filter( ( signal ) => compiledInspection.identitySet.has( signalNodes[ signal.id ] ) ).map( ( signal ) => signal.id ).sort();
	const selectedReachableSignals = routeInspections.get( selectedRouteId ).identitySet;
	const selectedSignalIds = producedSignals.filter( ( signal ) => selectedReachableSignals.has( signalNodes[ signal.id ] ) ).map( ( signal ) => signal.id ).sort();
	if ( compiledReachableSignals.join( '\u0000' ) !== selectedSignalIds.join( '\u0000' ) ) throw new Error( 'Compiled fragment root signal reachability differs from the selected route graph.' );
	const wrapperNodes = [ ...compiledInspection.identitySet ].filter( ( node ) => selectedReachableSignals.has( node ) === false );
	const installedChildren = [ ...compiledFragmentRoot.getChildren() ];
	if ( compiledFragmentRoot.type !== 'ContextNode' || wrapperNodes.length !== 1 || wrapperNodes[ 0 ] !== compiledFragmentRoot || installedChildren.length !== 1 || installedChildren[ 0 ] !== selectedRoot ) throw new Error( 'Installed fragment graph contains nodes outside the selected route plus the single r185 ContextNode wrapper.' );

	const normalizedResources = graphResourcesFromLedger( resourceLedger );
	if ( signalPassNode.getMRT?.()?.uuid !== resourceLedger.sceneMrt.uuid ) throw new Error( 'Signal-producing PassNode MRT identity does not match the validated resource ledger.' );
	const normalizedReadbackSinks = normalizeReadbackSinks( readbackSinks, resourceLedger, normalizedResources );
	const signalRows = producedSignals.map( ( signal ) => {

		const consumers = routes.filter( ( route ) => route.reachableSignals.includes( signal.id ) ).map( ( route ) => route.id );
		return {
			id: signal.id,
			producer: signal.producer,
			consumers,
			reachable: compiledReachableSignals.includes( signal.id ),
			encoding: `${ signal.nodeType } identity ${ signal.nodeUuid }`
		};

	} );
	const unclaimedResources = resourceLedger.transientResources.timestampQuerySets.map( ( querySet ) => ( {
		id: querySet.id,
		kind: 'timestamp-query-set',
		owner: `${ querySet.poolType }-timestamp-pool`,
		byteAccounting: 'NOT_CLAIMED',
		reason: querySet.reason
	} ) );
	return {
		schemaVersion: 2,
		owners,
		signals: signalRows,
		sceneSubmissions: [
			{
				id: 'scene-pass',
				owner: owners.sceneSignals,
				kind: 'lit-scene',
				mrtNodeUuid: resourceLedger.sceneMrt.uuid,
				producedSignals: producedSignals.map( ( signal ) => signal.id ),
				resourceIdentityClosureDigest: resourceLedger.identityClosureDigest
			},
			{
				id: 'final-output',
				owner: owners.renderPipeline,
				kind: 'present',
				selectedRoute: selectedRouteId,
				selectedRouteRootUuid: selectedRoot.uuid,
				compiledFragmentRoot: publicGraphRecord( compiledInspection ),
				routes,
				readbackSinks: normalizedReadbackSinks,
				unclaimedResources,
				classifications: {
					producedSignals: 'node-identity-producers',
					routeReachability: 'Node.getChildren()-identity-reachability',
					allocatedResources: 'validated-resource-ledger-identity-closure',
					readbackSinks: 'observed-capture-readbacks'
				}
			}
		],
		computeDispatches: [],
		resources: normalizedResources,
		finalToneMapOwner,
		finalOutputTransformOwner
	};

}
