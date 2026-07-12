import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCheckedEvidenceSchemas, validateCheckedJsonSchema } from './checked-json-schema.js';
import { createCorrectnessCaptureSessionFixture } from './correctness-capture-session.fixture.js';
import { readPngDimensions } from './png-image-contract.js';

function pngHeader( width, height ) {

	const bytes = Buffer.alloc( 24 );
	Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ).copy( bytes );
	bytes.writeUInt32BE( 13, 8 );
	bytes.write( 'IHDR', 12, 'ascii' );
	bytes.writeUInt32BE( width, 16 );
	bytes.writeUInt32BE( height, 20 );
	return bytes;

}

test( 'tier visual evidence satisfies its checked closed schema', async () => {

	const schemas = await loadCheckedEvidenceSchemas();
	const document = createCorrectnessCaptureSessionFixture().hookResult.tierVisualEvidence;
	assert.deepEqual( validateCheckedJsonSchema( schemas.tierVisualEvidence, document ).errors, [] );

} );

test( 'tier visual schema rejects structural, provenance, and extent mutations', async () => {

	const schemas = await loadCheckedEvidenceSchemas();
	const baseline = createCorrectnessCaptureSessionFixture().hookResult.tierVisualEvidence;
	for ( const [ label, mutate ] of [
		[ 'unknown field', ( value ) => { value.decorativeScore = 1; } ],
		[ 'wrong metric provenance', ( value ) => { value.metrics.meanRgbByteDifference.label = 'Authored'; } ],
		[ 'wrong reference extent', ( value ) => { value.binding.reference.normalized.width = 1200; } ],
		[ 'wrong candidate MRT extent', ( value ) => { value.binding.candidate.resources.sceneMrt[ 0 ].width = 1920; } ],
		[ 'wrong pass scale', ( value ) => { value.binding.candidate.passScale = 1; } ],
		[ 'missing transaction field', ( value ) => { delete value.binding.reference.transaction.restorationVerdict; } ]
	] ) {

		const value = structuredClone( baseline );
		mutate( value );
		assert.ok( validateCheckedJsonSchema( schemas.tierVisualEvidence, value ).errors.length > 0, `${ label } mutation survived` );

	}

} );

test( 'PNG header dimensions are decoded rather than inferred from byte length', () => {

	assert.deepEqual( readPngDimensions( pngHeader( 1920, 1080 ), 'tier image' ), { width: 1920, height: 1080 } );
	assert.deepEqual( readPngDimensions( pngHeader( 1200, 800 ), 'tier image' ), { width: 1200, height: 800 } );
	assert.throws( () => readPngDimensions( Buffer.alloc( 24 ), 'tier image' ), /invalid PNG signature/ );

} );
