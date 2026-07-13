import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	PLAYWRIGHT_CORRECTNESS_SURFACE,
	resolvePhysicalRuntimeProfile
} from './physical-runtime-profile.js';
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

test( 'physical and performance lanes reject WebDriver and non-Codex browser surfaces', () => {

	const routeLock = getRouteLock( 'tier', 'target-performance' );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock,
		environment: environment( { webdriver: true } )
	} ), /rejects WebDriver\/headless/ );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness', automationSurface: 'chrome' } ),
		routeLock: null,
		environment: environment( { parentHost: null } )
	} ), /requires the injected Playwright capture runner/ );

} );

test( 'deterministic correctness admits only the injected Playwright surface', () => {

	const result = resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness' } ),
		routeLock: getRouteLock( 'scenario', 'browser-capture' ),
		injectedProfile: { id: 'correctness', labId: 'webgpu-validation-harness' },
		environment: environment( { webdriver: true, parentIsSelf: true, parentHost: null } )
	} );
	assert.equal( result.runtimeProfile, 'correctness' );
	assert.equal( result.automationSurface, PLAYWRIGHT_CORRECTNESS_SURFACE );
	assert.equal( result.physicalSession, null );
	const wrapperResult = resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness' } ),
		routeLock: getRouteLock( 'tier', 'webgpu-correctness' ),
		injectedProfile: { id: 'correctness', labId: 'webgpu-validation-harness' },
		environment: environment( {
			webdriver: true,
			parentIsSelf: false,
			parentHost: {
				automationSurface: PLAYWRIGHT_CORRECTNESS_SURFACE,
				captureProfile: 'correctness',
				labId: 'webgpu-validation-harness',
				routeKind: 'tier',
				routeId: 'webgpu-correctness'
			}
		} )
	} );
	assert.equal( wrapperResult.runtimeProfile, 'correctness' );
	assert.equal( wrapperResult.automationSurface, PLAYWRIGHT_CORRECTNESS_SURFACE );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness' } ),
		routeLock: getRouteLock( 'scenario', 'browser-capture' ),
		injectedProfile: { id: 'correctness' },
		environment: environment( { webdriver: true, parentIsSelf: true, parentHost: null } )
	} ), /requires the injected Playwright capture runner/ );
	for ( const parentHost of [
		{ automationSurface: PLAYWRIGHT_CORRECTNESS_SURFACE, captureProfile: 'correctness', labId: 'another-lab', routeKind: 'tier', routeId: 'webgpu-correctness' },
		{ automationSurface: PLAYWRIGHT_CORRECTNESS_SURFACE, captureProfile: 'correctness', labId: 'webgpu-validation-harness', routeKind: 'tier', routeId: 'release' },
		{ automationSurface: 'codex-in-app-browser', captureProfile: 'correctness', labId: 'webgpu-validation-harness', routeKind: 'tier', routeId: 'webgpu-correctness' }
	] ) assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( { profile: 'correctness' } ),
		routeLock: getRouteLock( 'tier', 'webgpu-correctness' ),
		injectedProfile: { id: 'correctness', labId: 'webgpu-validation-harness' },
		environment: environment( { webdriver: true, parentIsSelf: false, parentHost } )
	} ), /requires the injected Playwright capture runner/ );

} );

test( 'correctness route rejects a forged performance profile', () => {

	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock: getRouteLock( 'scenario', 'browser-capture' ),
		environment: environment()
	} ), /reserved for declared performance routes/ );

} );

test( 'release aggregation route does not claim its own performance population', () => {

	const routeLock = getRouteLock( 'tier', 'release' );
	const result = resolvePhysicalRuntimeProfile( {
		parameters: new URLSearchParams( {
			automationSurface: 'codex-in-app-browser',
			physicalSession: SESSION_TOKEN
		} ),
		routeLock,
		environment: environment()
	} );
	assert.equal( result.runtimeProfile, 'correctness' );
	assert.equal( result.requiresPerformance, false );
	assert.throws( () => resolvePhysicalRuntimeProfile( {
		parameters: parameters(),
		routeLock,
		environment: environment()
	} ), /reserved for declared performance routes/ );

} );
