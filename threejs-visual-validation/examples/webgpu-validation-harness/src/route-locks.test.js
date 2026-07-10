import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { canonicalUrlForRoute, createLockedController, MECHANISM_ROUTE_LOCKS, TIER_ROUTE_LOCKS } from './route-locks.js';

const LAB_ROOT = new URL( '../', import.meta.url );

for ( const [ kind, locks ] of [ [ 'mechanism', MECHANISM_ROUTE_LOCKS ], [ 'tier', TIER_ROUTE_LOCKS ] ] ) {

	for ( const id of Object.keys( locks ) ) {

		test( `${ kind }/${ id } has a physical locked wrapper`, async () => {

			const wrapper = new URL( `${ kind }/${ id }/index.html`, LAB_ROOT );
			const html = await readFile( wrapper, 'utf8' );
			assert.match( html, new RegExp( `kind:\\s*['"]${ kind }['"]` ) );
			assert.match( html, new RegExp( `id:\\s*['"]${ id }['"]` ) );
			assert.match( html, /mountLockedRoute/ );

		} );

	}

}

test( 'route URLs select and lock exact startup state', () => {

	const url = canonicalUrlForRoute( 'https://example.test/lab/index.html', 'tier', 'target-performance' );
	assert.equal( url.searchParams.get( 'tier' ), 'target-performance' );
	assert.equal( url.searchParams.get( 'scenario' ), 'timing-and-governor' );
	assert.equal( url.searchParams.get( 'lockKind' ), 'tier' );
	assert.equal( url.searchParams.get( 'lockId' ), 'target-performance' );

} );

test( 'manifest mechanism startup matches physical route locks', async () => {

	const manifest = JSON.parse( await readFile( new URL( 'lab.manifest.json', LAB_ROOT ), 'utf8' ) );
	for ( const mechanism of manifest.mechanisms ) {

		assert.deepEqual( mechanism.startup, MECHANISM_ROUTE_LOCKS[ mechanism.id ], mechanism.id );

	}
	assert.deepEqual( manifest.tiers.map( ( tier ) => tier.id ), Object.keys( TIER_ROUTE_LOCKS ) );

} );

test( 'locked controller rejects state drift', async () => {

	const calls = [];
	const source = {
		async setTier( id ) { calls.push( [ 'tier', id ] ); },
		async setScenario( id ) { calls.push( [ 'scenario', id ] ); },
		async setMode( id ) { calls.push( [ 'mode', id ] ); }
	};
	const controller = createLockedController( source, { kind: 'tier', id: 'webgpu-correctness' } );
	await controller.setTier( 'webgpu-correctness' );
	await controller.setScenario( 'browser-capture' );
	await controller.setMode( 'final' );
	await assert.rejects( controller.setTier( 'release' ), /locked/ );
	await assert.rejects( controller.setScenario( 'artifact-inspector' ), /locked/ );
	await assert.rejects( controller.setMode( 'normal' ), /locked/ );
	assert.deepEqual( calls, [ [ 'tier', 'webgpu-correctness' ], [ 'scenario', 'browser-capture' ], [ 'mode', 'final' ] ] );

} );

test( 'unknown route locks fail instead of falling back', () => {

	assert.throws( () => canonicalUrlForRoute( 'https://example.test/', 'mechanism', 'missing' ), /Unknown mechanism route/ );
	assert.throws( () => canonicalUrlForRoute( 'https://example.test/', 'scenario', 'browser-capture' ), /Unknown route-lock kind/ );

} );
