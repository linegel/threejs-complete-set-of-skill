import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas, validateCheckedJsonSchema } from './checked-json-schema.js';

test( 'checked-in runtime graph schema is applied rather than token-checked', async () => {

	const { runtimeGraph } = await loadCheckedEvidenceSchemas();
	const graph = {
		schemaVersion: 2,
		owners: { renderer: 'subject' },
		signals: [ { id: 'output', producer: 'scene-pass', consumers: [ 'present' ], reachable: true } ],
		sceneSubmissions: [ { id: 'scene-pass', owner: 'subject', kind: 'lit-scene' } ],
		computeDispatches: [],
		resources: [ {
			id: 'output',
			owner: 'scene-pass',
			kind: 'render-target',
			residentBytes: { value: 32, unit: 'bytes', label: 'Derived', source: '2 * 2 * 8' }
		} ],
		finalToneMapOwner: 'render-output',
		finalOutputTransformOwner: 'render-output'
	};
	assert.doesNotThrow( () => assertCheckedJsonSchema( runtimeGraph, graph, 'runtime graph' ) );
	assert.equal( validateCheckedJsonSchema( runtimeGraph, { ...graph, invented: true } ).valid, false );
	assert.equal( validateCheckedJsonSchema( runtimeGraph, { ...graph, signals: [ { ...graph.signals[ 0 ], reachable: 'yes' } ] } ).valid, false );

} );

test( 'checked schema evaluator enforces contains cardinality and ref siblings', () => {

	const schema = {
		type: 'array',
		items: { $ref: '#/$defs/entry' },
		contains: {
			$ref: '#/$defs/entry',
			properties: { id: { const: 'manifest' } }
		},
		minContains: 1,
		maxContains: 1,
		$defs: {
			entry: {
				type: 'object',
				additionalProperties: false,
				required: [ 'id' ],
				properties: { id: { type: 'string' } }
			}
		}
	};
	assert.equal( validateCheckedJsonSchema( schema, [ { id: 'manifest' }, { id: 'other' } ] ).valid, true );
	assert.equal( validateCheckedJsonSchema( schema, [ { id: 'other' } ] ).valid, false );
	assert.equal( validateCheckedJsonSchema( schema, [ { id: 'manifest' }, { id: 'manifest' } ] ).valid, false );

} );

test( 'checked schema evaluator applies draft 2020 prefixItems before trailing items', () => {

	const schema = {
		type: 'array',
		prefixItems: [ { const: 'first' }, { const: 'second' } ],
		items: { type: 'number' }
	};
	assert.equal( validateCheckedJsonSchema( schema, [ 'first', 'second', 3 ] ).valid, true );
	assert.equal( validateCheckedJsonSchema( schema, [ 'second', 'first', 3 ] ).valid, false );
	assert.equal( validateCheckedJsonSchema( schema, [ 'first', 'second', 'three' ] ).valid, false );

} );
