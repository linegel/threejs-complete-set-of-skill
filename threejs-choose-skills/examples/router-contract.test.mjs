import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );
const skillRoot = dirname( here );

async function readText( relativePath ) {

	return readFile( join( skillRoot, relativePath ), 'utf8' );

}

function extractSection( markdown, heading ) {

	const lines = markdown.split( '\n' );
	const start = lines.findIndex( ( line ) => line === `## ${ heading }` );

	if ( start === -1 ) {

		throw new Error( `Missing recipe section: ${ heading }` );

	}

	let end = lines.length;
	for ( let i = start + 1; i < lines.length; i ++ ) {

		if ( lines[ i ].startsWith( '## ' ) ) {

			end = i;
			break;

		}

	}

	return lines.slice( start + 1, end ).join( '\n' );

}

function assertContains( text, patterns, label ) {

	for ( const pattern of patterns ) {

		assert.match( text, pattern, `${ label } missing ${ pattern }` );

	}

}

const recipes = await readText( 'references/router-recipes.md' );
const template = await readText( 'examples/router-preflight-template.md' );

const recipeNames = [
	'ocean planet',
	'rainy city street',
	'forest flythrough',
	'black-hole shot',
	'product scene',
	'post-heavy dashboard'
];

for ( const recipeName of recipeNames ) {

	const section = extractSection( recipes, recipeName );
	assertContains( section, [
		/minimal skill set:/,
		/selectedSkills:/,
		/primaryOwner:/,
		/deferredSkills:/,
		/shared-resource owners:/,
		/omittedSkills:/,
		/acceptanceEvidence:/,
		/\$threejs-[a-z0-9-]+/
	], recipeName );

}

assertContains( recipes, [
	/ocean planet/,
	/rainy city street/,
	/forest flythrough/,
	/black-hole shot/,
	/product scene/,
	/post-heavy dashboard/,
	/minimal skill set/,
	/deferred skills|deferredSkills/,
	/omitted skills|omittedSkills/
], 'router recipes' );

assertContains( template, [
	/## input brief/,
	/## preflight/,
	/backendManifest:/,
	/physicalCause:/,
	/missingSignal:/,
	/noPostBaseline:/,
	/postProcessingRejectedBecause:/,
	/primaryVisualContract:/,
	/apiProof:/,
	/budgetTable:/,
	/## routeManifest/,
	/selectedSkills:/,
	/omittedSkills:/,
	/sharedResourceOwners:/,
	/ownershipMap:/,
	/source-space:/,
	/world-space:/,
	/view-space:/,
	/clip-space:/,
	/NDC:/,
	/texel:/,
	/depth convention:/,
	/color domain:/,
	/owner boundary:/,
	/## route blockers/,
	/capabilityBlocker:/,
	/rejectionReason:/,
	/asset pipeline:/,
	/WebXR:/,
	/UI overlays:/,
	/deployment:/,
	/editor tooling:/,
	/physics engines:/,
	/## acceptance evidence/,
	/acceptanceEvidence:/,
	/debugViewList:/,
	/requiredMetrics:/,
	/requiredCommands:/,
	/requiredArtifacts:/,
	/assert:/,
	/validationEvidence:/
], 'router preflight template' );

console.log( JSON.stringify( {
	pass: true,
	recipeCount: recipeNames.length,
	checkedTemplateFields: 39
}, null, 2 ) );
