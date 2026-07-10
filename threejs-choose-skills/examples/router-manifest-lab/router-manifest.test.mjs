import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_SKILL_INVENTORY,
	ROUTE_REASON,
	evaluateRoute,
	evaluateScenario,
	getScenario
} from './router-core.mjs';
import { validateLabManifest } from '../../../scripts/lib/lab-validation.mjs';
import { listSkillDirs } from '../../../scripts/lib/lab-registry.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const catalog = JSON.parse( await readFile( join( here, 'router-fixtures.json' ), 'utf8' ) );
const manifest = JSON.parse( await readFile( join( here, 'lab.manifest.json' ), 'utf8' ) );
const appSource = await readFile( join( here, 'app.mjs' ), 'utf8' );

const expectedIds = [
	'ocean-planet',
	'rainy-city',
	'forest',
	'black-hole-shot',
	'post-pipeline-dashboard',
	'ocean-fauna',
	'route-away-unsupported',
	'over-budget-17.5-to-16.5',
	'missing-webgpu',
	'duplicate-output-owner',
	'duplicate-velocity-owner',
	'fabricated-tier',
	'post-before-physical-cause',
	'inventory-drift',
	'unsupported-route-away',
	'automatic-fallback'
];
const mechanismScenarios = new Map( [
	[ 'inventory-intersection', 'inventory-drift' ],
	[ 'capability-gate', 'missing-webgpu' ],
	[ 'causal-ordering', 'post-before-physical-cause' ],
	[ 'exclusive-ownership', 'duplicate-output-owner' ],
	[ 'tier-provenance', 'fabricated-tier' ],
	[ 'stage-budget-aggregation', 'over-budget-17.5-to-16.5' ],
	[ 'route-away', 'route-away-unsupported' ],
	[ 'fallback-quarantine', 'automatic-fallback' ]
] );

assert.equal( catalog.schemaVersion, 2 );
const liveSkillDirs = listSkillDirs();
assert.equal( liveSkillDirs.length, 26, 'the repository skill inventory changed without an explicit matrix migration' );
assert.deepEqual( catalog.skillInventory, liveSkillDirs, 'fixture inventory differs from the authoritative repository inventory' );
assert.deepEqual( catalog.skillInventory, CANONICAL_SKILL_INVENTORY );
assert.equal( catalog.skillInventory.length, 26 );
assert.equal( new Set( catalog.skillInventory ).size, 26 );
assert.deepEqual( catalog.routes.map( ( route ) => route.id ), expectedIds );
assert.deepEqual( manifest.scenarios.map( ( scenario ) => scenario.id ), expectedIds );
assert.deepEqual( manifest.tiers, [], 'planning skills must not invent GPU quality tiers' );
assert.equal( manifest.evidenceContract, 'v2' );
assert.equal( manifest.nonRenderingScenarioSuite, true );
assert.deepEqual( validateLabManifest( manifest, { validateEvidence: false } ).errors, [] );
assert.match( appSource, /fetch\( catalogUrl \)/, 'browser UI must consume the same fixture JSON as tests' );
assert.match( appSource, /evaluateScenario/, 'browser UI must execute the tested router core' );

assert.deepEqual( manifest.mechanisms.map( ( mechanism ) => mechanism.id ), [ ...mechanismScenarios.keys() ] );
for ( const mechanism of manifest.mechanisms ) {

	const expectedScenario = mechanismScenarios.get( mechanism.id );
	assert.equal( mechanism.startup.scenario, expectedScenario );
	assert.equal( mechanism.startup.mechanism, undefined, 'Pages startup uses only public LabController setters; the mechanism id remains in the route query' );
	assert.equal( mechanism.route, `/demos/router-manifest-lab/mechanism/${ mechanism.id }/` );
	const source = await readFile( join( here, 'mechanism', mechanism.id, 'index.html' ), 'utf8' );
	assert.match( source, new RegExp( `name="lab-mechanism" content="${ mechanism.id }"` ) );
	assert.match( source, new RegExp( `name="lab-scenario" content="${ expectedScenario }"` ) );
	assert.match( source, /src="\.\.\/\.\.\/app\.mjs"/ );

}

for ( const id of expectedIds ) {

	const fixture = getScenario( catalog, id );
	const result = evaluateScenario( catalog, id );
	assert.equal( result.verdict, fixture.expected.verdict, `${ id } verdict drift` );
	assert.equal( result.code, fixture.expected.code, `${ id } reason drift` );
	await access( join( here, 'scenario', id, 'index.html' ) );

}

const accepted = expectedIds.filter( ( id ) => evaluateScenario( catalog, id ).verdict === 'PASS' );
assert.deepEqual( accepted, [
	'ocean-planet',
	'rainy-city',
	'forest',
	'black-hole-shot',
	'post-pipeline-dashboard',
	'ocean-fauna',
	'route-away-unsupported'
] );

const overBudget = evaluateScenario( catalog, 'over-budget-17.5-to-16.5' );
assert.equal( overBudget.code, ROUTE_REASON.BUDGET );
assert.equal( overBudget.details.targetFrameMs, 16.5 );
assert.equal( overBudget.details.stageBudgetMs, 17.5 );
assert.equal( overBudget.details.overrunMs, 1 );

const acceptedBudget = evaluateScenario( catalog, 'ocean-planet' ).details;
assert.equal( acceptedBudget.stageBudgetMs, 14 );
assert.ok( acceptedBudget.headroomMs > 0 );

const fallback = getScenario( catalog, 'automatic-fallback' );
fallback.route.explicitFallbackRequest = true;
assert.equal( evaluateRoute( fallback, catalog ).verdict, 'PASS', 'an explicit request must be distinguishable from automatic routing' );

const routeAway = getScenario( catalog, 'route-away-unsupported' );
assert.equal( routeAway.route.routeAway.supported, false );
assert.ok( ! catalog.skillInventory.includes( routeAway.route.routeAway.externalOwner ) );

assert.throws( () => getScenario( catalog, 'unknown' ), ( error ) => error.code === ROUTE_REASON.UNKNOWN_SCENARIO );

for ( const route of catalog.routes ) {

	const fixture = getScenario( catalog, route.id );
	assert.ok( Object.hasOwn( fixture.performance, 'targetFrameMs' ), `${ route.id } lacks canonical targetFrameMs` );
	assert.ok( ! Object.hasOwn( fixture.performance, 'frameBudgetMs' ), `${ route.id } uses a drifting budget field` );

}

console.log( JSON.stringify( {
	pass: true,
	schemaVersion: catalog.schemaVersion,
	skillCount: catalog.skillInventory.length,
	scenarioCount: expectedIds.length,
	acceptedCount: accepted.length,
	rejectedCount: expectedIds.length - accepted.length,
	stableReasonCodes: [ ...new Set( expectedIds.map( ( id ) => evaluateScenario( catalog, id ).code ) ) ].sort()
}, null, 2 ) );
