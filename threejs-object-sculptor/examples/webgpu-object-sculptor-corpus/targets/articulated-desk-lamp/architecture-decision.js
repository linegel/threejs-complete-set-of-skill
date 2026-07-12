export const LAMP_ARCHITECTURE_DECISION = Object.freeze( {
	problemId: 'action-ready-articulated-desk-lamp',
	axes: Object.freeze( [ 'hingeTruth', 'closedGeometry', 'mobileCost', 'tierStability', 'inspectionEvidence' ] ),
	selectedCandidateId: 'analytic-semantic-hierarchy',
	candidates: Object.freeze( [
		Object.freeze( { id: 'analytic-semantic-hierarchy', family: 'closed analytic parts under semantic hinge pivots', scores: [ 5, 5, 4, 5, 5 ], hardGate: 'pass', rationale: 'real seams match the manufactured assembly; exact absolute-time pivots remain separately testable' } ),
		Object.freeze( { id: 'merged-static-mesh', family: 'one merged static hard-surface mesh', scores: [ 1, 5, 5, 3, 3 ], hardGate: 'fail:articulation', rationale: 'merging destroys the serial hinge and detachable-part boundaries' } ),
		Object.freeze( { id: 'merged-skinned-mesh', family: 'one skinned hard-surface mesh', scores: [ 4, 4, 4, 4, 3 ], hardGate: 'fail:unnecessary-deformation-indirection', rationale: 'bones add deformation and evidence complexity to rigid manufactured joints' } ),
		Object.freeze( { id: 'custom-unified-writer', family: 'custom unified semantic surface writer', scores: [ 3, 5, 3, 4, 3 ], hardGate: 'fail:false-continuity', rationale: 'a continuous writer erases intentional component seams and analytic collider inputs' } ),
		Object.freeze( { id: 'imported-or-baked-asset', family: 'imported glTF or baked/VAT object', scores: [ 4, 5, 4, 3, 4 ], hardGate: 'fail:procedural-source-contract', rationale: 'cannot be the canonical code-native reconstruction source' } )
	] )
} );

export const LAMP_TEXTURE_DECISION = Object.freeze( {
	problemId: 'lamp-powder-coat-and-metal-response',
	axes: Object.freeze( [ 'causalControl', 'seamRisk', 'memoryCost', 'footprintStability', 'provenance' ] ),
	selectedCandidateId: 'analytic-procedural-response',
	candidates: Object.freeze( [
		Object.freeze( { id: 'analytic-procedural-response', family: 'band-limited analytic coating and metal response', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'authored-tile', family: 'hand-authored tiling PBR texture set', scores: [ 4, 4, 3, 4, 5 ], hardGate: 'fail:no-reference-specific-detail' } ),
		Object.freeze( { id: 'gpt-image-tile', family: 'GPT Image generated powder-coat appearance tile', scores: [ 3, 2, 3, 3, 3 ], hardGate: 'fail:baked-lighting-and-data-calibration-risk' } ),
		Object.freeze( { id: 'scan-or-photo', family: 'scanned or photographed coating source', scores: [ 4, 3, 2, 4, 2 ], hardGate: 'fail:missing-provenance-and-scale-source' } ),
		Object.freeze( { id: 'geometry-microdetail', family: 'explicit geometry stipple and wear', scores: [ 5, 5, 1, 2, 5 ], hardGate: 'fail:subpixel-geometry-cost' } )
	] ),
	imageGenerationAcceptance: Object.freeze( {
		requiredPromptClauses: Object.freeze( [ 'orthographic flat material sample', 'physical scale', 'uniform illumination', 'no shadows or highlights', 'seamless edges', 'no object silhouette' ] ),
		requiredInspection: Object.freeze( [ 'one-to-one pixels', 'three-by-three tiling', 'mip distance sweep', 'independent channel semantics', 'sRGB color versus NoColorSpace data', 'mobile memory' ] ),
		rejectIf: Object.freeze( [ 'baked directional lighting', 'border seam', 'visible repeat', 'uncalibrated normal or roughness', 'unknown provenance', 'wrong physical feature scale' ] )
	} )
} );

export function validateLampDecision( decision, expectedSelectedId ) {

	if ( ! Array.isArray( decision.axes ) || decision.axes.length < 4 ) throw new Error( `${ decision.problemId } has too few scoring axes` );
	if ( ! Array.isArray( decision.candidates ) || decision.candidates.length < 5 ) throw new Error( `${ decision.problemId } compares fewer than five candidates` );
	if ( new Set( decision.candidates.map( ( candidate ) => candidate.family ) ).size !== decision.candidates.length ) throw new Error( `${ decision.problemId } candidate families are not distinct` );
	if ( decision.selectedCandidateId !== expectedSelectedId ) throw new Error( `${ decision.problemId } selected candidate drifted` );
	const selected = decision.candidates.find( ( candidate ) => candidate.id === expectedSelectedId );
	if ( ! selected || selected.hardGate !== 'pass' ) throw new Error( `${ decision.problemId } winner does not pass its hard gate` );
	for ( const candidate of decision.candidates ) {

		if ( candidate.scores.length !== decision.axes.length || candidate.scores.some( ( score ) => ! Number.isInteger( score ) || score < 1 || score > 5 ) ) throw new Error( `${ decision.problemId } has invalid candidate scores` );

	}
	return true;

}
