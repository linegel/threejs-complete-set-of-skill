import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateEvidenceBundle as validateSharedEvidenceBundle } from '../../../../../scripts/lib/evidence-v2.mjs';
import { validateUnifiedV2ArtifactBundle } from '../evidence-bundle-v2.js';
import { validateArtifactBundle as validateV1ArtifactBundle } from './artifact-schemas.js';

async function readEvidenceManifest( artifactDir ) {

	return JSON.parse( await readFile( join( artifactDir, 'evidence-manifest.json' ), 'utf8' ) );

}

export async function detectEvidenceSchemaVersion( artifactDir ) {

	const manifest = await readEvidenceManifest( artifactDir );
	return manifest.schemaVersion ?? 1;

}

export async function validateVersionedArtifactBundle( artifactDir, options = {} ) {

	const manifest = await readEvidenceManifest( artifactDir );
	const version = manifest.schemaVersion ?? 1;

	if ( version === 2 ) {

		const sharedResult = validateSharedEvidenceBundle( artifactDir, options );
		if ( sharedResult.protocol === 'legacy-v2' ) return Object.freeze( {
			schemaVersion: 2,
			protocol: 'legacy-v2',
			bundleKind: 'legacy-v2',
			publishable: false,
			canonicalAcceptanceEligible: false,
			captureProfiles: Object.freeze( [] ),
			automationSurfaces: Object.freeze( [] ),
			claimVerdicts: Object.freeze( { ...( manifest.claimVerdicts ?? {} ) } ),
			validationErrors: Object.freeze( [ ...sharedResult.errors ] ),
			migrationWarning: 'Pre-unified schema v2 evidence is readable for migration only and must be recaptured as a ledgered raw session before offline release promotion.'
		} );

		return validateUnifiedV2ArtifactBundle( artifactDir, options );

	}

	if ( version === 1 ) {

		const result = await validateV1ArtifactBundle( artifactDir, options );
		return {
			...result,
			schemaVersion: 1,
			protocol: 'legacy-v1',
			bundleKind: 'contract-fixture',
			publishable: false,
			canonicalAcceptanceEligible: false,
			captureProfiles: Object.freeze( [] ),
			automationSurfaces: Object.freeze( [] ),
			claimVerdicts: Object.freeze( { ...( manifest.claimVerdicts ?? {} ) } ),
			migrationWarning: 'Schema v1 is readable only during migration and cannot satisfy canonical acceptance.'
		};

	}

	throw new Error( `Unsupported evidence schema version ${ version }.` );

}
