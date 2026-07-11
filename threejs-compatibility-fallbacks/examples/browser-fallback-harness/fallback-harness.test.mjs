import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BRANCH_ORDER,
	FALLBACK_REASON,
	INVARIANT_DOMAINS,
	getFallbackScenario,
	measureBoundedWaterBranch,
	planFallback
} from './fallback-core.mjs';
import { validateLabManifest } from '../../../scripts/lib/lab-validation.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const catalog = JSON.parse( await readFile( join( here, 'fallback-fixtures.json' ), 'utf8' ) );
const manifest = JSON.parse( await readFile( join( here, 'lab.manifest.json' ), 'utf8' ) );
const appSource = await readFile( join( here, 'app.mjs' ), 'utf8' );
const runtimeSource = await readFile( join( here, 'compatibility-renderer.mjs' ), 'utf8' );

const scenarioIds = [
	'blocked-default',
	'native-budget-reduction',
	'precomputed-static',
	'cpu-offline',
	'feature-removed',
	'maintained-legacy',
	'invariant-loss-comparison'
];
const mechanismScenarios = new Map( [
	[ 'explicit-activation-gate', 'blocked-default' ],
	[ 'ordered-degradation-trace', 'maintained-legacy' ],
	[ 'bounded-water-loss-oracle', 'invariant-loss-comparison' ],
	[ 'invariant-ledger', 'invariant-loss-comparison' ],
	[ 'force-webgl-branch-isolation', 'maintained-legacy' ],
	[ 'maintenance-acceptance', 'maintained-legacy' ]
] );

assert.equal( catalog.schemaVersion, 2 );
assert.deepEqual( catalog.invariantDomains, INVARIANT_DOMAINS );
assert.deepEqual( catalog.branchOrder, BRANCH_ORDER );
assert.deepEqual( catalog.scenarios.map( ( scenario ) => scenario.id ), scenarioIds );
assert.deepEqual( manifest.scenarios.map( ( scenario ) => scenario.id ), scenarioIds );
assert.deepEqual( manifest.tiers, [], 'fallback branches must not masquerade as canonical GPU tiers' );
assert.equal( manifest.status, 'incomplete', 'browser acceptance must remain incomplete until a live no-WebGPU capture is recorded' );
assert.equal( manifest.evidenceContract, 'v2' );
assert.deepEqual( validateLabManifest( manifest, { validateEvidence: false } ).errors, [] );

assert.deepEqual( manifest.mechanisms.map( ( mechanism ) => mechanism.id ), [ ...mechanismScenarios.keys() ] );
for ( const mechanism of manifest.mechanisms ) {

	const expectedScenario = mechanismScenarios.get( mechanism.id );
	assert.equal( mechanism.startup.scenario, expectedScenario );
	assert.equal( mechanism.startup.mechanism, undefined, 'Pages startup uses only public LabController setters; the mechanism id remains in the route query' );
	assert.equal( mechanism.route, `/demos/browser-fallback-harness/mechanism/${ mechanism.id }/` );
	const source = await readFile( join( here, 'mechanism', mechanism.id, 'index.html' ), 'utf8' );
	assert.match( source, new RegExp( `name="lab-mechanism" content="${ mechanism.id }"` ) );
	assert.match( source, new RegExp( `name="lab-scenario" content="${ expectedScenario }"` ) );
	assert.match( source, /src="\.\.\/\.\.\/app\.mjs"/ );

}

for ( const id of scenarioIds ) {

	const scenario = getFallbackScenario( catalog, id );
	const withoutRequest = planFallback( scenario );
	assert.equal( withoutRequest.status, scenario.expectedWithoutRequest.status, `${ id } default status drift` );
	assert.equal( withoutRequest.code, scenario.expectedWithoutRequest.code, `${ id } default code drift` );
	assert.notEqual( withoutRequest.details?.activated, true, `${ id } activated without explicit request` );
	await access( join( here, 'scenario', id, 'index.html' ) );

}

const native = planFallback( getFallbackScenario( catalog, 'native-budget-reduction' ) );
assert.equal( native.code, FALLBACK_REASON.CANONICAL );
assert.equal( native.details.activated, false );
assert.equal( native.details.owner, 'threejs-water-optics' );

let clock = 0;
const now = () => { clock += 0.125; return clock; };
for ( const id of [ 'precomputed-static', 'cpu-offline', 'feature-removed', 'maintained-legacy' ] ) {

	const scenario = getFallbackScenario( catalog, id );
	const result = planFallback( scenario, { explicitRequest: true, now } );
	assert.equal( result.status, scenario.expectedWithRequest.status, `${ id } explicit status drift` );
	assert.equal( result.code, scenario.expectedWithRequest.code, `${ id } explicit code drift` );
	assert.equal( result.details.activated, true );
	assert.equal( result.details.branch, scenario.desiredBranch );
	assert.equal( result.details.invariantProofs.length, INVARIANT_DOMAINS.length );
	assert.ok( Number.isFinite( result.details.visibleLoss.value ) );
	assert.ok( Number.isFinite( result.details.timing.value ) );
	assert.notEqual( result.details.visibleLoss.source, result.details.timing.source, 'visible loss and timing require independent evidence records' );
	assert.match( result.details.timing.source, /CPU fixture only, not GPU timing/ );

	for ( let index = 0; index < scenario.decisionTrace.length; index ++ ) {

		assert.equal( scenario.decisionTrace[ index ].branch, BRANCH_ORDER[ index ] );
		assert.equal( scenario.decisionTrace[ index ].changedAxes.length, 1 );

	}
	const domains = scenario.invariants.map( ( invariant ) => invariant.domain );
	assert.deepEqual( [ ...domains ].sort(), [ ...INVARIANT_DOMAINS ].sort() );

}

const comparisonScenario = getFallbackScenario( catalog, 'invariant-loss-comparison' );
const comparison = planFallback( comparisonScenario, { explicitRequest: true } );
assert.equal( comparison.code, FALLBACK_REASON.COMPARISON );
assert.equal( comparison.details.activated, false );
assert.deepEqual( comparison.details.branches.map( ( branch ) => branch.branch ), BRANCH_ORDER.slice( 1 ) );

const webgpuAvailable = getFallbackScenario( catalog, 'precomputed-static' );
webgpuAvailable.actualCapabilities.webgpu = true;
const refusedOnWebGPU = planFallback( webgpuAvailable, { explicitRequest: true } );
assert.equal( refusedOnWebGPU.code, FALLBACK_REASON.CANONICAL );
assert.equal( refusedOnWebGPU.details.activated, false );

const badOrder = getFallbackScenario( catalog, 'cpu-offline' );
badOrder.decisionTrace[ 1 ].changedAxes.push( 'second-axis' );
assert.equal( planFallback( badOrder, { explicitRequest: true } ).code, FALLBACK_REASON.ORDER );

const missingMaintenance = getFallbackScenario( catalog, 'maintained-legacy' );
missingMaintenance.maintenance.accepted = false;
assert.equal( planFallback( missingMaintenance, { explicitRequest: true } ).code, FALLBACK_REASON.LEGACY );

const failedInvariant = getFallbackScenario( catalog, 'precomputed-static' );
failedInvariant.invariants.find( ( invariant ) => invariant.domain === 'physical' ).gate.value = 0;
assert.equal( planFallback( failedInvariant, { explicitRequest: true } ).code, FALLBACK_REASON.INVARIANT );

const oracle = measureBoundedWaterBranch( 'cpu-offline', now );
assert.equal( Object.keys( oracle.metrics ).length, INVARIANT_DOMAINS.length );
assert.equal( oracle.visibleLoss.label, 'Measured' );
assert.equal( oracle.timing.label, 'Measured' );
assert.ok( oracle.sampleCount > 0 && oracle.runs > 1 );

assert.match( appSource, /authorizeExplicitRequest/ );
assert.match( appSource, /probeCanonicalBackend/ );
assert.match( appSource, /INSUFFICIENT_EVIDENCE_GPU_TIMING/ );
assert.match( appSource, /await import\( '\.\/compatibility-renderer\.mjs' \)/, 'compatibility renderer must be lazily imported after activation' );
assert.match( runtimeSource, /authorization\?\.explicitRequest !== true/ );
assert.match( runtimeSource, /authorization\?\.testedUnavailable !== true/ );
assert.match( runtimeSource, /forceWebGL:\s*true/ );
assert.match( runtimeSource, /isWebGPUBackend === true/ );

assert.throws( () => getFallbackScenario( catalog, 'unknown' ), ( error ) => error.code === FALLBACK_REASON.UNKNOWN );

console.log( JSON.stringify( {
	pass: true,
	schemaVersion: catalog.schemaVersion,
	scenarioCount: scenarioIds.length,
	invariantDomains: INVARIANT_DOMAINS,
	branchOrder: BRANCH_ORDER,
	mutationCount: 4,
	browserAcceptance: manifest.status
}, null, 2 ) );
