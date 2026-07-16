import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );
const repoRoot = dirname( dirname( here ) );

const readText = ( relativePath ) => readFile( join( repoRoot, relativePath ), 'utf8' );

const [ skill, upstreamResearch, router, fixturesText ] = await Promise.all( [
	readText( 'skills/threejs-debugging/SKILL.md' ),
	readText( 'skills/threejs-debugging/references/upstream-research.md' ),
	readText( 'skills/threejs-choose-skills/SKILL.md' ),
	readText( 'threejs-debugging/examples/triage-cases.json' )
] );

const frontmatter = skill.match( /^---\n([\s\S]*?)\n---\n/ );
assert.ok( frontmatter, 'missing SKILL.md frontmatter' );
assert.match( frontmatter[ 1 ], /^name: threejs-debugging$/m );
assert.match( frontmatter[ 1 ], /^description: Diagnose unexpected Three\.js runtime, rendering, API, asset, or version behavior\./m );

const workflow = [
	[ 'reproduce', /reproduction fails repeatedly/ ],
	[ 'first failure', /last known-good state from the first bad state/ ],
	[ 'mechanism-preserving reduction', /suspected mechanism is still the one under test/ ],
	[ 'conditional upstream research', /Research upstream only when local evidence does not settle the cause/ ],
	[ 'containment and action', /narrowest containment that protects the violated invariant.*Choose one action:/ ]
];
const normalizedSkill = skill.replace( /\s+/g, ' ' );
let previousIndex = - 1;
for ( const [ label, pattern ] of workflow ) {

	const index = normalizedSkill.search( pattern );
	assert.ok( index > previousIndex, `${ label } is missing or out of order` );
	previousIndex = index;

}

assert.match( skill, /first published fixed release/ );
assert.match( upstreamResearch, /repo:mrdoob\/three\.js is:issue/ );
assert.match( upstreamResearch, /git tag --contains <fixing-commit>/ );
assert.match( upstreamResearch, /npm view three@<version> dist\.tarball gitHead/ );

assert.match( router, /\| Reproducible runtime\/API failure,[^\n]+\| `\$threejs-debugging` \|/ );

assert.doesNotMatch( `${ skill }\n${ upstreamResearch }`, /engineVersionTriage|Version-Lag Escalation|version-lag/i );

const staticIssueId = /(?:issues\/|pull\/|#)\d{3,}/;
assert.doesNotMatch( `${ skill }\n${ upstreamResearch }`, staticIssueId, 'skill carries a static upstream issue ID' );

const fixtures = JSON.parse( fixturesText ).cases;
assert.equal( fixtures.length, 7 );
assert.deepEqual(
	fixtures.filter( ( entry ) => entry.activateDebugging === false ).map( ( entry ) => entry.id ),
	[ 'ordinary-scene-design' ]
);

const requiredOutcomes = new Set( fixtures.map( ( entry ) => entry.requiredOutcome ) );
for ( const outcome of [
	'research-fix-history',
	'fixed-unreleased',
	'unrelated',
	'upstream-report',
	'application-fix'
] ) {

	assert.ok( requiredOutcomes.has( outcome ), `missing fixture outcome ${ outcome }` );

}

console.log( JSON.stringify( {
	pass: true,
	caseCount: fixtures.length,
	ordinaryDesignCases: fixtures.filter( ( entry ) => entry.activateDebugging === false ).length,
	debuggingCases: fixtures.filter( ( entry ) => entry.activateDebugging === true ).length
}, null, 2 ) );
