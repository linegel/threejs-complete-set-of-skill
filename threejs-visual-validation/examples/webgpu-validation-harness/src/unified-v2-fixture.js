import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalSha256, routeStateDigest } from './evidence-manifest-contract.js';

export function createUnifiedV2ContractFixtureManifest() {

	const route = {
		path: '/demos/webgpu-validation-harness/tier/schema-fixture/',
		scenario: 'artifact-inspector',
		mechanism: null,
		mode: 'final',
		tier: 'schema-fixture',
		camera: 'design',
		seed: '0x00000001',
		timeSeconds: { value: 2, unit: 'seconds', label: 'Authored', source: 'unified v2 contract fixture' }
	};
	route.stateDigest = routeStateDigest( route );
	return {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		bundleId: 'webgpu-validation-harness:contract-fixture:v2',
		bundleKind: 'contract-fixture',
		publishable: false,
		skill: 'threejs-visual-validation',
		threeRevision: '0.185.1',
		sourceClosureHash: canonicalSha256( { fixture: 'source closure' } ),
		buildRevision: canonicalSha256( { fixture: 'build revision' } ),
		route,
		limitations: [ {
			id: 'contract-fixture-only',
			status: 'ACTIVE',
			statement: 'Synthetic fixture data cannot support a runtime or publishable claim.',
			affectedClaims: [ 'visualCorrectness', 'mechanismCorrectness', 'performanceCompliance', 'gpuAttribution', 'lifecycleStability' ]
		} ],
		claimVerdicts: {
			visualCorrectness: 'NOT_CLAIMED',
			mechanismCorrectness: 'NOT_CLAIMED',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'NOT_CLAIMED',
			visualError: 'NOT_CLAIMED'
		},
		captureSessions: [],
		files: [ {
			path: 'evidence-manifest.json',
			status: 'self-excluded',
			kind: 'evidence-manifest',
			reason: 'The manifest cannot bind its own final serialized bytes.'
		} ],
		images: [],
		promotion: {
			status: 'NOT_ELIGIBLE',
			binding: null,
			bindingDigest: null,
			visualSignoff: {
				status: 'NOT_REVIEWED',
				reviewer: null,
				reviewedAt: null,
				reviewDigest: null,
				reviewedImages: [],
				notes: []
			}
		}
	};

}

export async function writeUnifiedV2ContractFixture( artifactDir ) {

	await mkdir( artifactDir, { recursive: true } );
	const manifest = createUnifiedV2ContractFixtureManifest();
	await writeFile( join( artifactDir, 'evidence-manifest.json' ), `${ JSON.stringify( manifest, null, 2 ) }\n`, { flag: 'wx' } );
	return manifest;

}
