import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { numericDatum, NumericLabel } from './numeric-evidence.js';
import { validateV2ArtifactBundle } from './schema/v2.js';
import { writeV2ContractFixture } from './v2-fixture.js';

async function readJson( dir, name ) {

	return JSON.parse( await readFile( join( dir, name ), 'utf8' ) );

}

async function writeJson( dir, name, value ) {

	await writeFile( join( dir, name ), `${ JSON.stringify( value, null, 2 ) }\n` );

}

async function mutateJson( dir, name, mutator ) {

	const artifact = await readJson( dir, name );
	await mutator( artifact );
	await writeJson( dir, name, artifact );

}

async function expectMutationRejects( id, expected, mutate ) {

	const dir = await mkdtemp( join( tmpdir(), `threejs-v2-${ id }-` ) );

	try {

		await writeV2ContractFixture( dir );
		await mutate( dir );

		try {

			await validateV2ArtifactBundle( dir );

		} catch ( error ) {

			if ( expected.test( error.message ) === false ) {

				throw new Error( `${ id } rejected for the wrong reason: ${ error.message }` );

			}

			return { id, verdict: 'PASS', detected: error.message };

		}

		throw new Error( `${ id } mutation unexpectedly passed.` );

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

function authored( value, unit = 'fixture unit' ) {

	return numericDatum( value, unit, NumericLabel.AUTHORED, 'v2 mutation fixture' );

}

export async function runV2MutationSuite() {

	const mutations = [
		expectMutationRejects( 'missing-label', /unlabelled numeric/, async ( dir ) => {

			await mutateJson( dir, 'evidence-manifest.json', ( manifest ) => {

				manifest.viewport.width = 96;

			} );

		} ),
		expectMutationRejects( 'final-only-evidence', /missing required image|final-only/, async ( dir ) => {

			await mutateJson( dir, 'visual-contract.json', ( contract ) => {

				contract.requiredImages = [ 'images/final.design.png' ];

			} );

		} ),
		expectMutationRejects( 'false-diagnostic-route', /false-diagnostic-route/, async ( dir ) => {

			await mutateJson( dir, 'pipeline-graph.json', ( graph ) => {

				graph.captureRoutes.diagnostics.outputNodeId = graph.captureRoutes.final.outputNodeId;

			} );

		} ),
		expectMutationRejects( 'stale-pipeline-graph', /stale-pipeline-graph/, async ( dir ) => {

			await mutateJson( dir, 'evidence-manifest.json', ( manifest ) => {

				manifest.pipelineGraphDigest = 'stale-digest';

			} );

		} ),
		expectMutationRejects( 'missing-timestamp', /missing-timestamp/, async ( dir ) => {

			await mutateJson( dir, 'visual-contract.json', ( contract ) => {

				contract.performanceClaims.gpuTimingRequirement = 'required';

			} );
			await mutateJson( dir, 'performance-envelope.json', ( envelope ) => {

				envelope.gpuTimingRequirement = 'required';

			} );
			await mutateJson( dir, 'evidence-manifest.json', ( manifest ) => {

				manifest.bundleKind = 'browser-capture';
				manifest.publishable = true;
				manifest.backend.isWebGPUBackend = true;
				manifest.backend.initialized = true;
				manifest.claimVerdicts.gpuAttribution = 'PASS';

			} );
			await mutateJson( dir, 'renderer-info.json', ( rendererInfo ) => {

				rendererInfo.backend = 'WebGPU';

			} );

		} ),
		expectMutationRejects( 'p95-overrun', /p95-overrun/, async ( dir ) => {

			await mutateJson( dir, 'frame-trace.json', ( trace ) => {

				trace.sustained.cpuP95 = authored( 20, 'ms' );

			} );

		} ),
		expectMutationRejects( 'governor-oscillation', /governor-oscillation/, async ( dir ) => {

			await mutateJson( dir, 'quality-governor.json', ( governor ) => {

				governor.oscillationDetected = true;

			} );

		} ),
		expectMutationRejects( 'visual-error-overrun', /visual-error-overrun/, async ( dir ) => {

			await mutateJson( dir, 'visual-errors.json', ( errors ) => {

				errors.metrics[ 0 ].measured = authored( 0.1, 'ratio' );

			} );

		} ),
		expectMutationRejects( 'target-leak', /target-leak/, async ( dir ) => {

			await mutateJson( dir, 'leak-loop.json', ( leak ) => {

				leak.after.targetBytes.value += 4;

			} );

		} ),
		expectMutationRejects( 'storage-leak', /storage-leak/, async ( dir ) => {

			await mutateJson( dir, 'leak-loop.json', ( leak ) => {

				leak.after.storageBytes.value += 4;

			} );

		} ),
		expectMutationRejects( 'unconfined-path', /unconfined path|parent traversal|outside/, async ( dir ) => {

			await mutateJson( dir, 'visual-contract.json', ( contract ) => {

				contract.imageComparisons[ 0 ].baseline = '../escape.png';

			} );

		} ),
		expectMutationRejects( 'bad-padded-stride', /bad-padded-stride/, async ( dir ) => {

			await mutateJson( dir, 'render-targets.json', ( targets ) => {

				targets.targets[ 0 ].readback.bytesPerRow.value += 1;

			} );

		} ),
		expectMutationRejects( 'duplicate-output-owner', /duplicate-output-owner/, async ( dir ) => {

			await mutateJson( dir, 'pipeline-graph.json', ( graph ) => {

				graph.ownerClaims.find( ( claim ) => claim.semantic === 'output-transform' ).producerCount.value = 2;

			} );

		} ),
		expectMutationRejects( 'baseline-equals-candidate', /baseline-equals-candidate|same file/, async ( dir ) => {

			await mutateJson( dir, 'visual-contract.json', ( contract ) => {

				contract.imageComparisons[ 0 ].candidate = contract.imageComparisons[ 0 ].baseline;

			} );

		} )
	];

	const results = await Promise.all( mutations );
	return { schemaVersion: 2, mutationCount: results.length, results };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	console.log( JSON.stringify( await runV2MutationSuite(), null, 2 ) );

}
