import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';

import { readV2BundleArtifacts, validatePublishableProvenance, validateV2ArtifactBundle } from './schema/v2.js';
import { writeV2ContractFixture } from './v2-fixture.js';

test( 'a relabelled contract fixture cannot become publishable browser evidence', async () => {

	const dir = await mkdtemp( join( tmpdir(), 'threejs-v2-publishability-negative-' ) );
	await writeV2ContractFixture( dir );
	const path = join( dir, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( path, 'utf8' ) );
	manifest.bundleKind = 'browser-capture';
	manifest.publishable = true;
	manifest.captureProfile = 'performance';
	manifest.adapterClass = 'hardware';
	await writeFile( path, `${ JSON.stringify( manifest, null, 2 ) }\n` );
	await assert.rejects( () => validateV2ArtifactBundle( dir ), /finalized shared capture-session/ );

} );

test( 'authored fixture numbers cannot be relabelled as publishable measurements', async () => {

	const dir = await mkdtemp( join( tmpdir(), 'threejs-v2-provenance-negative-' ) );
	await writeV2ContractFixture( dir );
	const artifacts = await readV2BundleArtifacts( dir );
	const manifest = artifacts[ 'evidence-manifest.json' ];
	manifest.bundleKind = 'browser-capture';
	manifest.sceneId = 'webgpu-validation-harness-browser-capture';
	manifest.automationSurface = 'codex-in-app-browser';
	manifest.renderer = 'WebGPURenderer';
	manifest.gpuAdapter = { identitySource: 'runtime adapter query' };
	manifest.knownCompromises = [ 'physical display refresh remains unmeasured' ];
	const contract = artifacts[ 'visual-contract.json' ];
	contract.contractRevision = 'webgpu-validation-runtime-v2-1';
	contract.subject = 'native WebGPU validation subject';
	const rendererInfo = artifacts[ 'renderer-info.json' ];
	rendererInfo.renderer = 'WebGPURenderer';
	rendererInfo.backend = 'WebGPU';
	rendererInfo.initializationState = 'await renderer.init completed; backend.isWebGPUBackend true';
	rendererInfo.adapterInfo = { identitySource: 'runtime adapter query' };
	const mechanism = artifacts[ 'mechanism-metrics.json' ];
	mechanism.subjectAdapter = 'createNativeWebGPUValidationSubject';
	mechanism.proofKind = 'native-browser-runtime';
	assert.throws( () => validatePublishableProvenance( artifacts ), /numeric provenance/ );

} );
