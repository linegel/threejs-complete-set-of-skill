import assert from 'node:assert/strict';
import { LAMP_ARCHITECTURE_DECISION, LAMP_TEXTURE_DECISION, validateLampDecision } from './architecture-decision.js';

assert.equal( validateLampDecision( LAMP_ARCHITECTURE_DECISION, 'analytic-semantic-hierarchy' ), true );
assert.equal( validateLampDecision( LAMP_TEXTURE_DECISION, 'analytic-procedural-response' ), true );
assert.equal( LAMP_ARCHITECTURE_DECISION.candidates.find( ( candidate ) => candidate.id === 'merged-static-mesh' ).hardGate, 'fail:articulation' );
assert.equal( LAMP_TEXTURE_DECISION.candidates.find( ( candidate ) => candidate.id === 'gpt-image-tile' ).hardGate, 'fail:baked-lighting-and-data-calibration-risk' );
assert.ok( LAMP_TEXTURE_DECISION.imageGenerationAcceptance.requiredPromptClauses.length >= 6 );
assert.ok( LAMP_TEXTURE_DECISION.imageGenerationAcceptance.requiredInspection.length >= 6 );
assert.ok( LAMP_TEXTURE_DECISION.imageGenerationAcceptance.rejectIf.length >= 6 );

for ( const mutate of [
	( decision ) => { decision.candidates.pop(); },
	( decision ) => { decision.candidates[ 1 ].family = decision.candidates[ 0 ].family; },
	( decision ) => { decision.selectedCandidateId = 'merged-static-mesh'; },
	( decision ) => { decision.candidates[ 0 ].scores[ 0 ] = 8; }
] ) {

	const decision = structuredClone( LAMP_ARCHITECTURE_DECISION );
	mutate( decision );
	assert.throws( () => validateLampDecision( decision, 'analytic-semantic-hierarchy' ) );

}

console.log( 'articulated desk lamp decisions: 5 architecture families, 5 texture families, 4 rejection controls' );
