import { validateManifestArtifacts } from '../validate-lab-artifacts.mjs';

async function runCaptureArtifacts() {
	const result = await validateManifestArtifacts();
	if (result.status !== 'pass') {
		return {
			status: 'fail',
			details: {
				message: 'capture artifact bundle is missing or invalid',
				summary: result.summary,
				failures: result.gates.filter((gate) => gate.status === 'fail'),
			},
		};
	}
	return { status: 'pass', details: result.summary };
}

export const gates = [
	{ id: 'capture-artifacts', run: runCaptureArtifacts },
];
