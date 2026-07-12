import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoRegistry } from '../../scripts/lib/lab-registry.mjs';
import { validateLabManifest } from '../../scripts/lib/lab-validation.mjs';
import {
	INTEGRATION_REASON,
	LOCKED_TIERS,
	REQUIRED_EXCLUSIVE_OWNERS,
	createDuplicateOwnerMutation,
	describeRuntimeGraph,
	getLockedTier,
	validateIntegrationContract
} from '../shared/integration-contract-core.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const integrationRoot = dirname( here );
const repoRoot = dirname( integrationRoot );
const integrationIds = [
	'final-image-flight',
	'weathered-world',
	'procedural-district',
	'creature-habitat',
	'relativistic-space-shot'
];

const requestedIndex = process.argv.indexOf( '--lab' );
const requested = requestedIndex >= 0 ? process.argv[ requestedIndex + 1 ] : null;
if ( requested && ! integrationIds.includes( requested ) ) throw new RangeError( `Unknown integration lab: ${ requested }` );
const selectedIds = requested ? [ requested ] : integrationIds;
const mutationsOnly = process.argv.includes( '--mutations-only' );
const registeredDemos = new Map( buildDemoRegistry().demos.map( ( demo ) => [ demo.id, demo ] ) );

function exportPattern( name ) {

	return new RegExp( `export\\s+(?:async\\s+)?(?:function|class|const)\\s+${ name }\\b` );

}

const summary = [];
for ( const id of selectedIds ) {

	const labRoot = join( integrationRoot, id );
	const contract = JSON.parse( await readFile( join( labRoot, 'contract.json' ), 'utf8' ) );
	const manifest = JSON.parse( await readFile( join( labRoot, 'lab.manifest.json' ), 'utf8' ) );
	const validation = validateIntegrationContract( contract );

	if ( ! mutationsOnly ) {

		assert.equal( contract.id, id );
		assert.equal( contract.status, 'incomplete', `${ id } cannot claim acceptance without WebGPU evidence` );
		assert.equal( validation.verdict, 'PASS', `${ id }: ${ validation.message }` );
		assert.equal( validation.code, INTEGRATION_REASON.INCOMPLETE, `${ id } must expose missing adapters/evidence` );
		assert.ok(
			validation.details.missingAdapters.length > 0 || Object.values( contract.runtimeEvidence ).includes( 'INSUFFICIENT_EVIDENCE' ),
			`${ id } must name either missing adapters or insufficient runtime evidence`
		);
		assert.deepEqual( contract.tiers.map( ( tier ) => tier.id ), LOCKED_TIERS );
		assert.deepEqual( manifest.tiers.map( ( tier ) => tier.id ), LOCKED_TIERS );
		assert.equal( manifest.kind, 'integration-demo' );
		assert.equal( manifest.status, 'incomplete' );
		assert.equal( manifest.evidenceContract, 'v2' );
		const registryManifest = registeredDemos.get( id );
		assert.ok( registryManifest, `registry contains ${ id }` );
		assert.deepEqual( validateLabManifest( registryManifest, { validateEvidence: false } ).errors, [], `${ id } strict lab manifest` );

		const ownerSemantics = new Set( contract.owners.map( ( owner ) => owner.semantic ) );
		for ( const semantic of REQUIRED_EXCLUSIVE_OWNERS ) assert.ok( ownerSemantics.has( semantic ), `${ id } missing ${ semantic } owner` );
		assert.equal( new Set( contract.signals.map( ( signal ) => signal.id ) ).size, contract.signals.length );
		assert.ok( contract.signals.every( ( signal ) => typeof signal.producer === 'string' && signal.consumers.length > 0 ) );

		for ( const tierSummary of validation.details.tiers ) {

			assert.ok( tierSummary.stageBudgetMs <= tierSummary.targetFrameMs, `${ id}/${ tierSummary.id } exceeds frame target` );
			assert.ok( tierSummary.headroomMs >= 0 );
			const tier = getLockedTier( contract, tierSummary.id );
			assert.equal( tier.targetFrameMs.value, 16.67 );
			const routePath = join( labRoot, 'tier', tier.id, 'index.html' );
			const routeSource = await readFile( routePath, 'utf8' );
			assert.match( routeSource, new RegExp( `name="locked-tier" content="${ tier.id }"` ) );

		}
		await access( join( labRoot, 'index.html' ) );
		const graph = describeRuntimeGraph( contract, 'balanced' );
		assert.equal( graph.finalToneMapOwner, 'threejs-image-pipeline' );
		assert.equal( graph.finalOutputTransformOwner, 'threejs-image-pipeline' );
		assert.equal( graph.owners.renderer, 'threejs-image-pipeline' );

		for ( const adapter of contract.adapterRequirements.filter( ( entry ) => entry.sourceStatus === 'available' ) ) {

			const source = await readFile( join( repoRoot, adapter.module ), 'utf8' );
			assert.match( source, exportPattern( adapter.requiredExport ), `${ id}/${ adapter.id } available export is absent` );

		}

	}

	const duplicateOutput = validateIntegrationContract( createDuplicateOwnerMutation( contract, 'output-transform', 'private-output-owner' ) );
	assert.equal( duplicateOutput.code, INTEGRATION_REASON.DUPLICATE_OWNER, `${ id } duplicate output owner mutation escaped` );
	const duplicateRenderer = validateIntegrationContract( createDuplicateOwnerMutation( contract, 'renderer', 'private-renderer-owner' ) );
	assert.equal( duplicateRenderer.code, INTEGRATION_REASON.DUPLICATE_OWNER, `${ id } duplicate renderer mutation escaped` );

	const overBudget = structuredClone( contract );
	overBudget.tiers[ 0 ].stageBudgets[ 0 ].budgetMs.value = 99;
	assert.equal( validateIntegrationContract( overBudget ).code, INTEGRATION_REASON.BUDGET, `${ id } over-budget mutation escaped` );

	const duplicateProducer = structuredClone( contract );
	duplicateProducer.signals[ 0 ].producer = [ duplicateProducer.signals[ 0 ].producer, 'private-producer' ];
	assert.equal( validateIntegrationContract( duplicateProducer ).code, INTEGRATION_REASON.SIGNAL, `${ id } duplicate signal producer escaped` );

	summary.push( {
		id,
		status: contract.status,
		availableAdapters: validation.details.availableAdapters.length,
		missingAdapters: validation.details.missingAdapters.length,
		mutationCount: 4
	} );

}

if ( ! mutationsOnly ) {

	const finalFlight = JSON.parse( await readFile( join( integrationRoot, 'final-image-flight', 'contract.json' ), 'utf8' ) );
	assert.equal( finalFlight.submissionCounts.gbufferPrepassCount.value, 1 );
	assert.equal( finalFlight.submissionCounts.litScenePassCount.value, 1 );
	assert.equal( finalFlight.submissionCounts.sceneSubmissionCount.value, 2 );
	assert.equal( finalFlight.submissionCounts.fullLitOutputCount.value, 1 );

	const district = JSON.parse( await readFile( join( integrationRoot, 'procedural-district', 'contract.json' ), 'utf8' ) );
	assert.equal( district.submissionCounts.sceneSubmissionCount.value, 2 );

	const browserController = await readFile( join( integrationRoot, 'shared', 'browser-controller.mjs' ), 'utf8' );
	const browserBootstrap = await readFile( join( integrationRoot, 'shared', 'browser-bootstrap.mjs' ), 'utf8' );
	assert.doesNotMatch( browserController, /new\s+WebGPURenderer/ );
	assert.doesNotMatch( browserBootstrap, /new\s+WebGPURenderer/ );
	assert.match( browserController, /loadAvailableAdapterFactories/ );
	assert.match( browserController, /INCOMPLETE_INTEGRATION/ );

}

console.log( JSON.stringify( {
	pass: true,
	mode: mutationsOnly ? 'mutations' : 'contracts',
	integrations: summary
}, null, 2 ) );
