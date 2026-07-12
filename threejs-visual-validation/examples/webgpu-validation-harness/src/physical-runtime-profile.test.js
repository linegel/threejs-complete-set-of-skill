import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolvePhysicalRuntimeProfile } from './physical-runtime-profile.js';
import { getRouteLock } from './route-locks.js';

const SESSION_TOKEN = '0123456789abcdef0123456789abcdef';

function environment( overrides = {} ) {

	return {
		webdriver: false,
		parentIsSelf: false,
		parentHost: {
			automationSurface: 'codex-in-app-browser',
			immutableBuild: true,
			sessionToken: SESSION_TOKEN
		},
		...overrides
	};

}

function parameters( profile = 'performance' ) {

	return new URLSearchParams( {
		profile,
		automationSurface: 'codex-in-app-browser',
		physicalSession: SESSION_TOKEN
	} );

}

test( 'performance route enables timestamps only in immutable in-app host', () => {

	const routeLock = getRouteLock( 'tier', 'target-performance' );
	const result = resolvePhysicalRuntimeProfile( { parameters: parameters(), routeLock, environment: environment() } );
	assert.equal( result.runtimeProfile, 'performance' );
	assert.equal( result.requiresPerformance, true );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock,
		environment: environment( { parentHost: null } )
	} ), /immutable Codex in-app/ );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams(),
		routeLock,
		environment: environment( { parentHost: null, parentIsSelf: true } )
	} ), /performance routes require the immutable Codex in-app Browser/ );

} );

test( 'all evidence lanes reject WebDriver and non-Codex browser surfaces', () => {

	const routeLock = getRouteLock( 'tier', 'target-performance' );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock,
		environment: environment( { webdriver: true } )
	} ), /rejects WebDriver\/headless/ );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams(),
		routeLock: null,
		injectedProfile: { id: 'correctness', automationSurface: 'playwright-headless-chromium' },
		environment: environment( { webdriver: true, parentIsSelf: true, parentHost: null } )
	} ), /rejects WebDriver\/headless/ );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness', automationSurface: 'chrome' } ),
		routeLock: null,
		environment: environment( { parentHost: null } )
	} ), /requires the immutable Codex in-app Browser/ );

} );

test( 'correctness route rejects a forged performance profile', () => {

	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock: getRouteLock( 'scenario', 'browser-capture' ),
		environment: environment()
	} ), /reserved for declared performance routes/ );

} );
