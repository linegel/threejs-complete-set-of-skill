import { PERFORMANCE_TIER_IDS, routeRequiresPerformanceProfile } from './route-locks.js';

export const CODEX_IN_APP_SURFACE = 'codex-in-app-browser';
export const PLAYWRIGHT_CORRECTNESS_SURFACE = 'playwright-headless-chromium';

function readRequestedProfile( parameters, injectedProfile ) {

	const injected = injectedProfile?.id ?? null;
	const query = parameters.get( 'profile' );
	if ( injected !== null && query !== null && injected !== query ) throw new Error( 'Injected capture profile disagrees with the route profile.' );
	const profile = injected ?? query;
	if ( profile !== null && profile !== 'correctness' && profile !== 'performance' ) throw new Error( `Unknown runtime profile "${ profile }".` );
	return profile;

}

export function resolvePhysicalRuntimeProfile( {
	parameters,
	routeLock,
	injectedProfile = null,
	environment
} ) {

	if ( parameters === null || typeof parameters?.get !== 'function' ) throw new Error( 'Runtime profile resolution requires URLSearchParams-compatible parameters.' );
	if ( environment === null || typeof environment !== 'object' ) throw new Error( 'Runtime profile resolution requires a browser environment description.' );
	const requestedProfile = readRequestedProfile( parameters, injectedProfile );
	const requestedTier = routeLock?.startup.tier ?? parameters.get( 'tier' );
	const requiresPerformance = routeRequiresPerformanceProfile( routeLock ) || PERFORMANCE_TIER_IDS.includes( requestedTier );
	const injectedAutomationSurface = injectedProfile?.automationSurface
		?? ( injectedProfile?.id === 'correctness' && typeof injectedProfile?.labId === 'string'
			? PLAYWRIGHT_CORRECTNESS_SURFACE
			: null );
	const automationSurface = parameters.get( 'automationSurface' ) ?? injectedAutomationSurface ?? 'interactive-browser';
	const sessionToken = parameters.get( 'physicalSession' );
	const host = environment.parentHost ?? null;
	const validInAppHost = automationSurface === CODEX_IN_APP_SURFACE
		&& environment.webdriver !== true
		&& environment.parentIsSelf !== true
		&& host?.automationSurface === CODEX_IN_APP_SURFACE
		&& host?.immutableBuild === true
		&& typeof sessionToken === 'string'
		&& sessionToken.length >= 16
		&& host.sessionToken === sessionToken;
	const validPlaywrightCorrectness = requestedProfile === 'correctness'
		&& automationSurface === PLAYWRIGHT_CORRECTNESS_SURFACE
		&& environment.webdriver === true
		&& environment.parentIsSelf === true
		&& host === null
		&& sessionToken === null
		&& injectedProfile?.id === 'correctness'
		&& typeof injectedProfile?.labId === 'string';

	const evidenceRequested = requestedProfile !== null || automationSurface === CODEX_IN_APP_SURFACE || sessionToken !== null;
	if ( automationSurface === CODEX_IN_APP_SURFACE && environment.webdriver === true ) {

		throw new Error( 'Physical and performance evidence rejects WebDriver/headless execution; use the Codex in-app Browser.' );

	}
	if ( requiresPerformance ) {

		if ( validInAppHost === false ) throw new Error( 'Timestamp-enabled performance routes require the immutable Codex in-app Browser surface.' );
		if ( requestedProfile !== null && requestedProfile !== 'performance' ) throw new Error( 'Performance routes require the timestamp-enabled performance runtime profile.' );
		return Object.freeze( { runtimeProfile: 'performance', automationSurface, requiresPerformance, physicalSession: sessionToken } );

	}

	if ( requestedProfile === 'performance' ) throw new Error( 'The timestamp-enabled performance runtime profile is reserved for declared performance routes.' );
	if ( evidenceRequested && validInAppHost === false && validPlaywrightCorrectness === false ) {

		throw new Error( 'Correctness evidence requires the injected Playwright capture runner; physical and performance evidence require the immutable Codex in-app Browser surface.' );

	}
	return Object.freeze( {
		runtimeProfile: 'correctness',
		automationSurface,
		requiresPerformance: false,
		physicalSession: evidenceRequested ? sessionToken : null
	} );

}
