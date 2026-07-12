import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
	canonicalUrlForRoute,
	createLockedController,
	MECHANISM_ROUTE_LOCKS,
	resolveRouteLockFromParameters,
	SCENARIO_ROUTE_LOCKS,
	TIER_ROUTE_LOCKS
} from './route-locks.js';

const LAB_ROOT = new URL( '../', import.meta.url );

test( 'browser subject exposes the fresh-controller lifecycle runner', async () => {

	const source = await readFile( new URL( './app.js', import.meta.url ), 'utf8' );
	assert.match( source, /window\.__THREEJS_LAB_LIFECYCLE__/ );
	assert.match( source, /createNativeWebGPUValidationSubject\( document\.createElement\( 'canvas' \), \{ runtimeProfile \} \)/ );

} );

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
	assert.equal( url.searchParams.get( 'camera' ), 'design' );
	assert.equal( url.searchParams.get( 'width' ), '1920' );
	assert.equal( url.searchParams.get( 'height' ), '1080' );
	assert.equal( url.searchParams.get( 'dpr' ), '1' );

} );

test( 'manifest mechanism startup matches physical route locks', async () => {

	const manifest = JSON.parse( await readFile( new URL( 'lab.manifest.json', LAB_ROOT ), 'utf8' ) );
	assert.deepEqual( manifest.scenarios.map( ( scenario ) => scenario.id ), Object.keys( SCENARIO_ROUTE_LOCKS ) );
	for ( const mechanism of manifest.mechanisms ) {

		for ( const [ key, value ] of Object.entries( mechanism.startup ) ) assert.equal( MECHANISM_ROUTE_LOCKS[ mechanism.id ][ key ], value, `${ mechanism.id }.${ key }` );

	}
	assert.deepEqual( manifest.tiers.map( ( tier ) => tier.id ), Object.keys( TIER_ROUTE_LOCKS ) );
	assert.equal( Object.keys( SCENARIO_ROUTE_LOCKS ).length + Object.keys( MECHANISM_ROUTE_LOCKS ).length + Object.keys( TIER_ROUTE_LOCKS ).length, 19 );

} );

test( 'public scenario query resolves to an immutable scenario lock', () => {

	const parameters = new URLSearchParams( 'scenario=resource-ledger' );
	const lock = resolveRouteLockFromParameters( parameters );
	assert.equal( lock.kind, 'scenario' );
	assert.equal( lock.id, 'resource-ledger' );
	assert.equal( lock.startup.mode, 'normal' );
	assert.throws( () => resolveRouteLockFromParameters( new URLSearchParams( 'scenario=resource-ledger&mode=final' ) ), /locked to mode/ );

} );

test( 'locked controller rejects state drift', async () => {

	const calls = [];
	const source = {
		async setTier( id ) { calls.push( [ 'tier', id ] ); },
		async setScenario( id ) { calls.push( [ 'scenario', id ] ); },
		async setMode( id ) { calls.push( [ 'mode', id ] ); },
		async setCamera( id ) { calls.push( [ 'camera', id ] ); },
		async setSeed( seed ) { calls.push( [ 'seed', seed ] ); },
		async setTime( seconds ) { calls.push( [ 'time', seconds ] ); },
		async step( seconds ) { calls.push( [ 'step', seconds ] ); },
		async resize( width, height, dpr ) { calls.push( [ 'resize', width, height, dpr ] ); }
	};
	const controller = createLockedController( source, { kind: 'tier', id: 'webgpu-correctness' } );
	await controller.setTier( 'webgpu-correctness' );
	await controller.setScenario( 'browser-capture' );
	await controller.setMode( 'final' );
	await controller.setCamera( 'design' );
	await controller.setSeed( 1 );
	await controller.setTime( 0 );
	await controller.step( 0 );
	await controller.resize( 1200, 800, 1 );
	await assert.rejects( controller.setTier( 'release' ), /locked/ );
	await assert.rejects( controller.setScenario( 'artifact-inspector' ), /locked/ );
	await assert.rejects( controller.setMode( 'normal' ), /locked/ );
	await assert.rejects( controller.setCamera( 'near' ), /locked/ );
	await assert.rejects( controller.setSeed( 0x9e3779b9 ), /locked/ );
	await assert.rejects( controller.setTime( 1 ), /locked/ );
	await assert.rejects( controller.step( 1 / 60 ), /locked/ );
	await assert.rejects( controller.resize( 641, 359, 1 ), /locked/ );
	assert.deepEqual( calls, [
		[ 'tier', 'webgpu-correctness' ],
		[ 'scenario', 'browser-capture' ],
		[ 'mode', 'final' ],
		[ 'camera', 'design' ],
		[ 'seed', 1 ],
		[ 'time', 0 ],
		[ 'step', 0 ],
		[ 'resize', 1200, 800, 1 ]
	] );

} );

test( 'unknown route locks fail instead of falling back', () => {

	assert.throws( () => canonicalUrlForRoute( 'https://example.test/', 'mechanism', 'missing' ), /Unknown mechanism route/ );
	assert.throws( () => canonicalUrlForRoute( 'https://example.test/', 'scenario', 'missing' ), /Unknown scenario route/ );
	assert.throws( () => canonicalUrlForRoute( 'https://example.test/', 'unknown', 'browser-capture' ), /Unknown route-lock kind/ );
	assert.throws( () => resolveRouteLockFromParameters( new URLSearchParams( 'lockKind=tier' ) ), /supplied together/ );

} );
