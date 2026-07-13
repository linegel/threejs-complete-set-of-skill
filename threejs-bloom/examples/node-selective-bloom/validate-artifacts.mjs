import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceBundle } from '../../../scripts/lib/evidence-v2.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const root = resolve( here, '../../..' );
const defaultBundle = resolve( root, 'artifacts/visual-validation/node-selective-bloom' );
const bundleDir = resolve( process.env.LAB_ARTIFACT_DIR ?? defaultBundle );
const requireAllClaims = process.argv.includes( '--require-all-claims' );

function readJson( path ) {
	return JSON.parse( readFileSync( path, 'utf8' ) );
}

function validateCorrectnessSession( sessionDir ) {
	const sessionPath = resolve( sessionDir, 'capture-session.json' );
	if ( ! existsSync( sessionPath ) ) {
		return { ok: false, errors: [ 'missing capture-session.json' ] };
	}
	const session = readJson( sessionPath );
	const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
	const evidence = metrics.rendererBackendEvidence ?? {};
	const errors = [];
	if ( session.labId !== 'node-selective-bloom' ) errors.push( 'capture-session labId mismatch' );
	if ( metrics.nativeWebGPU !== true || evidence.isWebGPUBackend !== true ) {
		errors.push( 'capture-session does not prove native WebGPU backend identity' );
	}
	const required = [
		'final.design.png',
		'no-post.design.png',
		'diagnostics.mosaic.png',
		'camera.near.png',
		'camera.design.png',
		'camera.far.png',
		'seed-0001.final.png',
		'seed-9e3779b9.final.png',
		'temporal.t000.png',
		'temporal.t001.png',
	];
	for ( const file of required ) {
		if ( ! existsSync( resolve( sessionDir, file ) ) ) errors.push( `missing ${ file }` );
	}
	if ( requireAllClaims ) {
		errors.push( 'full acceptance requires an approved unified-v2 evidence-manifest release bundle' );
	}
	return {
		ok: errors.length === 0,
		errors,
		protocol: 'correctness-capture-session',
		sourceHash: session.sourceHash ?? session.sourceClosureHash ?? null,
		nativeWebGPU: metrics.nativeWebGPU === true && evidence.isWebGPUBackend === true,
	};
}

if ( ! existsSync( bundleDir ) ) {
	console.error( JSON.stringify( {
		schemaVersion: 2,
		labId: 'node-selective-bloom',
		verdict: 'INSUFFICIENT_EVIDENCE',
		bundleDir,
		reason: 'artifact bundle does not exist',
	}, null, 2 ) );
	process.exit( 1 );
}

const sessionDir = existsSync( resolve( bundleDir, 'correctness', 'capture-session.json' ) )
	? resolve( bundleDir, 'correctness' )
	: bundleDir;

if ( existsSync( resolve( sessionDir, 'evidence-manifest.json' ) ) ) {
	const result = validateEvidenceBundle( sessionDir );
	const errors = [ ...result.errors ];
	if ( requireAllClaims && result.json[ 'evidence-manifest.json' ] ) {
		for ( const [ claim, verdict ] of Object.entries( result.json[ 'evidence-manifest.json' ].claimVerdicts ?? {} ) ) {
			if ( verdict !== 'PASS' ) errors.push( `full acceptance requires ${ claim }=PASS; received ${ verdict }` );
		}
	}
	console.log( JSON.stringify( {
		schemaVersion: 2,
		labId: 'node-selective-bloom',
		bundleDir: sessionDir,
		structuralVerdict: errors.length === 0 ? 'PASS' : 'FAIL',
		requireAllClaims,
		protocol: result.protocol,
		errors,
	}, null, 2 ) );
	if ( errors.length > 0 ) process.exitCode = 1;
} else {
	const result = validateCorrectnessSession( sessionDir );
	console.log( JSON.stringify( {
		schemaVersion: 2,
		labId: 'node-selective-bloom',
		bundleDir: sessionDir,
		structuralVerdict: result.ok ? 'PASS' : 'FAIL',
		requireAllClaims,
		protocol: result.protocol,
		sourceHash: result.sourceHash,
		nativeWebGPU: result.nativeWebGPU,
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE',
		},
		errors: result.errors,
	}, null, 2 ) );
	if ( ! result.ok ) process.exitCode = 1;
}
