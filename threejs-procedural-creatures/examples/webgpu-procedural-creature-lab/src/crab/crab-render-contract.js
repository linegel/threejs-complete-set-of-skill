export const CRAB_RENDER_DECISION = Object.freeze( {
	selectedCandidateId: 'instanced-closed-rigid-links',
	axes: Object.freeze( [ 'closedTopology', 'supportMotion', 'submissionCost', 'mobileFit', 'evidenceClarity' ] ),
	candidates: Object.freeze( [
		Object.freeze( { id: 'separate-mesh-scene-graph', scores: [ 5, 5, 1, 2, 5 ], result: 'reject:40-subject-draws' } ),
		Object.freeze( { id: 'instanced-closed-rigid-links', scores: [ 5, 5, 4, 5, 5 ], result: 'select' } ),
		Object.freeze( { id: 'storage-vertex-transforms', scores: [ 5, 5, 5, 4, 3 ], result: 'reject:single-hero-complexity' } ),
		Object.freeze( { id: 'merged-skinned-mesh', scores: [ 4, 5, 4, 4, 3 ], result: 'reject:hard-joint-indirection' } ),
		Object.freeze( { id: 'baked-vat', scores: [ 5, 1, 5, 5, 3 ], result: 'reject:support-relative-feet' } )
	] )
} );

export const CRAB_RENDER_TIERS = Object.freeze( {
	full: Object.freeze( { sphereWidth: 24, sphereHeight: 12, radialSegments: 10, triangleLimit: 3200, vertexLimit: 5600, dprCap: 2 } ),
	budgeted: Object.freeze( { sphereWidth: 16, sphereHeight: 8, radialSegments: 7, triangleLimit: 1700, vertexLimit: 2900, dprCap: 1.5 } ),
	minimum: Object.freeze( { sphereWidth: 8, sphereHeight: 4, radialSegments: 4, triangleLimit: 780, vertexLimit: 1250, dprCap: 1 } )
} );

export function resolveCrabRenderTier( tierId ) {

	const tier = CRAB_RENDER_TIERS[ tierId ];
	if ( ! tier ) throw new Error( `unknown coastal crab render tier '${ tierId }'` );
	return tier;

}

export function validateCrabGeometryStats( tierId, stats ) {

	const tier = resolveCrabRenderTier( tierId );
	if ( stats.semanticSlots !== 40 ) throw new Error( `crab render compiled ${ stats.semanticSlots } semantic slots instead of 40` );
	if ( stats.drawFamilies !== 5 ) throw new Error( `crab render compiled ${ stats.drawFamilies } draw families instead of 5` );
	if ( stats.triangles > tier.triangleLimit ) throw new Error( `crab ${ tierId } triangle budget exceeded: ${ stats.triangles } > ${ tier.triangleLimit }` );
	if ( stats.vertices > tier.vertexLimit ) throw new Error( `crab ${ tierId } vertex budget exceeded: ${ stats.vertices } > ${ tier.vertexLimit }` );
	return true;

}
