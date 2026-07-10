import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );
const skillRoot = dirname( here );
const repoRoot = dirname( skillRoot );

const readText = ( relativePath ) => readFile( join( repoRoot, relativePath ), 'utf8' );

const [ skill, upstreamResearch, router, visualValidation, artifactSchema, fixturesText ] = await Promise.all( [
	readText( 'threejs-debugging/SKILL.md' ),
	readText( 'threejs-debugging/references/upstream-research.md' ),
	readText( 'threejs-choose-skills/SKILL.md' ),
	readText( 'threejs-visual-validation/SKILL.md' ),
	readText( 'threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js' ),
	readText( 'threejs-debugging/examples/triage-cases.json' )
] );

const frontmatter = skill.match( /^---\n([\s\S]*?)\n---\n/ );
assert.ok( frontmatter, 'missing SKILL.md frontmatter' );
assert.match( frontmatter[ 1 ], /^name: threejs-debugging$/m );
assert.match( frontmatter[ 1 ], /unexpected Three\.js runtime, rendering, API, asset, and version-dependent behavior/ );
assert.match( frontmatter[ 1 ], /project is behind and a later fix may justify upgrading/ );
assert.match( frontmatter[ 1 ], /Do not use for ordinary scene design/ );

for ( const heading of [
	'Investigation Contract',
	'Diagnostic Workflow',
	'Candidate Classification',
	'Decision Evidence',
	'Report'
] ) {

	assert.match( skill, new RegExp( `^## ${ heading }$`, 'm' ), `missing section ${ heading }` );

}

assert.match( skill, /A recognizable regression\n\s+signature is not a prerequisite/ );
assert.match( skill, /first published fixed release/ );
assert.match( skill, /A merged PR proves only that code entered its\n\s+target branch/ );
assert.match( upstreamResearch, /repo:mrdoob\/three\.js is:issue/ );
assert.match( upstreamResearch, /git tag --contains <fixing-commit>/ );
assert.match( upstreamResearch, /npm view three@<version> dist\.tarball gitHead/ );

assert.doesNotMatch( router, /^### Known-Issue Investigation$/m );
assert.match( router, /^- `threejs-debugging`$/m );
assert.match( router, /\| Unexpected Three\.js runtime\/API behavior, documentation\/source disagreement, suspected regression, known-issue research, or upgrade triage \| `\$threejs-debugging` \|/ );

const forbiddenArtifactTerms = /engineVersionTriage|Version-Lag Escalation|version-lag/i;
for ( const [ label, text ] of [
	[ 'debugging skill', skill ],
	[ 'upstream reference', upstreamResearch ],
	[ 'visual validation skill', visualValidation ],
	[ 'visual validation artifact schema', artifactSchema ]
] ) {

	assert.doesNotMatch( text, forbiddenArtifactTerms, `${ label } contains obsolete triage artifact terminology` );

}

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
