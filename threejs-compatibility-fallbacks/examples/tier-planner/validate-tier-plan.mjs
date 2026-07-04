import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTierPlan, validateTierPlan } from './tier-planner.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );

async function readJson( name ) {

	return JSON.parse( await readFile( join( here, name ), 'utf8' ) );

}

function expectRejects( label, fn, pattern ) {

	try {

		fn();

	} catch ( error ) {

		assert.match( error.message, pattern, label );
		return { label, rejected: true, message: error.message };

	}

	throw new Error( `${ label } unexpectedly passed.` );

}

const capabilities = await readJson( 'sample-capabilities.json' );
const ownerContract = await readJson( 'sample-owner-contract.json' );
const plan = buildTierPlan( capabilities, ownerContract );

assert.equal( validateTierPlan( plan ), true );
assert.equal( plan.rows.length, 2 );
assert.deepEqual( plan.rows.map( ( row ) => row.axis ), [ 'precomputed-static', 'labelled-proxy' ] );

const noExplicitRequest = structuredClone( capabilities );
noExplicitRequest.request.explicitFallbackWhenWebGPUUnavailable = false;
const badAxis = structuredClone( plan );
badAxis.rows[ 0 ].axis = 'legacy-and-precompute';
const missingLostText = structuredClone( plan );
missingLostText.rows[ 0 ].lost = '';
const missingScreenshot = structuredClone( plan );
missingScreenshot.rows[ 0 ].screenshots = [];

console.log( JSON.stringify( {
	pass: true,
	rejections: [
		expectRejects(
			'missing explicit fallback request',
		() => buildTierPlan( noExplicitRequest, ownerContract ),
			/explicit request to apply fallback when WebGPU is unavailable/
	),
		expectRejects(
			'unknown downgrade axis',
			() => validateTierPlan( badAxis ),
			/unknown downgrade axis/
		),
		expectRejects(
			'missing lost-feature text',
			() => validateTierPlan( missingLostText ),
			/missing lost text/
		),
		expectRejects(
			'missing screenshot names',
			() => validateTierPlan( missingScreenshot ),
			/needs screenshot names/
		)
	]
}, null, 2 ) );
