import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_SHARED_RESOURCES = [
	'gbuffer',
	'velocity',
	'weatherEnvelope',
	'toneMap',
	'outputTransform'
];

const REQUIRED_WEATHER_FIELDS = [
	'time',
	'deltaTime',
	'wind',
	'progress',
	'precipitationRate',
	'cloudCoverage',
	'seaState',
	'qualityTier',
	'debugMode'
];

function fail(message) {

	throw new Error(message);

}

export async function readIntegrationManifest(path = join(__dirname, 'integration-manifest.json')) {

	return JSON.parse(await readFile(path, 'utf8'));

}

function requireSingleOwner(resourceName, resource) {

	if (!resource || typeof resource !== 'object') {

		fail(`Missing shared resource "${resourceName}".`);

	}

	if (typeof resource.owner !== 'string' || resource.owner.length === 0) {

		fail(`Shared resource "${resourceName}" needs exactly one owner.`);

	}

	assert(Array.isArray(resource.writers), `${resourceName}.writers must be an array`);

	if (resource.writers.length !== 1) {

		fail(`Shared resource "${resourceName}" must have one writer, got ${resource.writers.length}.`);

	}

	return resource.owner;

}

export function validateIntegrationManifest(manifest) {

	assert.equal(manifest.sceneId, 'wave-d-shared-framegraph');
	assert.equal(manifest.evidenceStatus, 'static-contract-only');
	assert.equal(manifest.rendering.renderer, 'WebGPURenderer');
	assert.equal(manifest.rendering.renderPipelineOwner, 'threejs-image-pipeline');
	assert.equal(manifest.rendering.sceneRenderCount, 1);
	assert.equal(manifest.rendering.renderPipelineCount, 1);

	const owners = {};

	for (const resourceName of REQUIRED_SHARED_RESOURCES) {

		owners[resourceName] = requireSingleOwner(resourceName, manifest.sharedResources[resourceName]);

	}

	assert.deepEqual(owners, {
		gbuffer: 'threejs-image-pipeline',
		velocity: 'threejs-image-pipeline',
		weatherEnvelope: 'threejs-rain-snow-and-wet-surfaces',
		toneMap: 'threejs-exposure-color-grading',
		outputTransform: 'renderOutput'
	});

	assert.equal(manifest.sharedResources.gbuffer.resource, 'scenePass.setMRT(mrt(...))');
	assert(manifest.sharedResources.gbuffer.outputs.includes('output'));
	assert(manifest.sharedResources.gbuffer.outputs.includes('normal'));
	assert(manifest.sharedResources.gbuffer.outputs.includes('velocity'));
	assert.equal(manifest.sharedResources.toneMap.graphOwner, 'threejs-image-pipeline');
	assert.equal(manifest.sharedResources.outputTransform.graphOwner, 'threejs-image-pipeline');
	assert.notEqual(manifest.sharedResources.toneMap.owner, manifest.sharedResources.outputTransform.owner);

	for (const field of REQUIRED_WEATHER_FIELDS) {

		assert(
			manifest.sharedResources.weatherEnvelope.schema.includes(field),
			`weatherEnvelope.schema missing ${field}`
		);

	}

	for (const [systemName, system] of Object.entries(manifest.systems)) {

		assert.equal(system.privatePostOwner, false, `${systemName} must not own a private post/output pipeline`);
		assert(Array.isArray(system.consumes), `${systemName}.consumes must be an array`);
		assert(Array.isArray(system.publishes), `${systemName}.publishes must be an array`);

	}

	assert.equal(manifest.browserProof.required, true);
	assert.equal(manifest.browserProof.availableInThisSession, false);
	assert(manifest.browserProof.blockedBy.includes('wave-c-status.md'));
	assert(manifest.browserProof.requiredArtifacts.includes('renderer-info.json'));
	assert(manifest.browserProof.requiredArtifacts.includes('images/no-post.design.png'));

	return {
		pass: true,
		sceneId: manifest.sceneId,
		owners,
		sceneRenderCount: manifest.rendering.sceneRenderCount,
		renderPipelineCount: manifest.rendering.renderPipelineCount,
		browserProof: manifest.browserProof.availableInThisSession ? 'available' : 'blocked'
	};

}

export function createInvalidDuplicateOwnerFixture(manifest) {

	return {
		...manifest,
		sharedResources: {
			...manifest.sharedResources,
			gbuffer: {
				...manifest.sharedResources.gbuffer,
				writers: ['threejs-image-pipeline', 'threejs-ambient-contact-shading']
			}
		}
	};

}

export function createInvalidPrivatePostFixture(manifest) {

	return {
		...manifest,
		systems: {
			...manifest.systems,
			clouds: {
				...manifest.systems.clouds,
				privatePostOwner: true
			}
		}
	};

}

export async function runSelfTest() {

	const manifest = await readIntegrationManifest();
	const valid = validateIntegrationManifest(manifest);

	for (const [label, fixture] of [
		['duplicate gbuffer writer', createInvalidDuplicateOwnerFixture(manifest)],
		['private post owner', createInvalidPrivatePostFixture(manifest)]
	]) {

		try {

			validateIntegrationManifest(fixture);
			fail(`Invalid fixture "${label}" unexpectedly passed.`);

		} catch (error) {

			if (error.message.includes('unexpectedly passed')) throw error;

		}

	}

	return {
		...valid,
		rejectedFixtures: ['duplicate gbuffer writer', 'private post owner']
	};

}

if (import.meta.url === `file://${process.argv[1]}`) {

	try {

		console.log(JSON.stringify(await runSelfTest(), null, 2));

	} catch (error) {

		console.error(error.message);
		process.exitCode = 1;

	}

}
