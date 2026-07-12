import {
	assertCheckedJsonSchema,
	loadCheckedSchemas,
	validateCheckedJsonSchema
} from '../../../../scripts/lib/checked-json-schema.mjs';

export { assertCheckedJsonSchema, validateCheckedJsonSchema };

let checkedEvidenceSchemas = null;

export async function loadCheckedEvidenceSchemas() {

	if ( checkedEvidenceSchemas === null ) {

		const schemas = loadCheckedSchemas();
		checkedEvidenceSchemas = Object.freeze( {
			evidenceManifest: schemas.evidenceManifest,
			runtimeGraph: schemas.runtimeGraph
		} );

	}
	return checkedEvidenceSchemas;

}
