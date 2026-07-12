import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateUnifiedV2ArtifactBundle } from '../evidence-bundle-v2.js';
import { validateArtifactBundle as validateV1ArtifactBundle } from './artifact-schemas.js';

export async function detectEvidenceSchemaVersion( artifactDir ) {

	const manifest = JSON.parse( await readFile( join( artifactDir, 'evidence-manifest.json' ), 'utf8' ) );
	return manifest.schemaVersion ?? 1;

}

export async function validateVersionedArtifactBundle( artifactDir, options = {} ) {

	const version = await detectEvidenceSchemaVersion( artifactDir );

	if ( version === 2 ) return validateUnifiedV2ArtifactBundle( artifactDir, options );

	if ( version === 1 ) {

		const result = await validateV1ArtifactBundle( artifactDir, options );
		return {
			...result,
			schemaVersion: 1,
			bundleKind: 'contract-fixture',
			publishable: false,
			migrationWarning: 'Schema v1 is readable only during migration and cannot satisfy canonical acceptance.'
		};

	}

	throw new Error( `Unsupported evidence schema version ${ version }.` );

}
