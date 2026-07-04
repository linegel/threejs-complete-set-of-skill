export const AO_FIXTURE_IDS = Object.freeze( [
	'wall-receiver',
	'thin-silhouette',
	'sky-edge',
	'emissive-object',
	'hard-sun',
	'non-square-viewport',
	'asymmetric-projection',
	'camera-rotation',
	'moving-occluder',
	'resize-dpr',
	'disabled-ao'
] );

export const AO_FIXTURES = Object.freeze( [
	{
		id: 'wall-receiver',
		purpose: 'Bent-normal one-wall direction and scalar grounding.',
		expected: 'Bent direction turns away from the blocked hemisphere; directional tint remains disabled until this passes.'
	},
	{
		id: 'thin-silhouette',
		purpose: 'Foreground/background edge leakage.',
		expected: 'Normal-aware reconstruction keeps the far background from inheriting foreground contact.'
	},
	{
		id: 'sky-edge',
		purpose: 'Sky/background classification at depth discontinuities.',
		expected: 'Sky pixels remain visibility 1 and do not pull extreme view-Z into neighbours.'
	},
	{
		id: 'emissive-object',
		purpose: 'Emission exclusion.',
		expected: 'Emission stays bright beside occluders; AO affects only ambient visibility.'
	},
	{
		id: 'hard-sun',
		purpose: 'Direct light exclusion.',
		expected: 'Hard direct sunlight does not gray out when contact AO increases.'
	},
	{
		id: 'non-square-viewport',
		purpose: 'Independent projection and texel axes.',
		expected: 'World-radius footprint stays circular after projection on wide and tall targets.'
	},
	{
		id: 'asymmetric-projection',
		purpose: 'Off-center projection radius invariance.',
		expected: 'AO reach uses both projection axes and does not shear across the frame.'
	},
	{
		id: 'camera-rotation',
		purpose: 'View/world bent-normal transform semantics.',
		expected: 'Static geometry keeps the same world-space tint direction while the camera rotates.'
	},
	{
		id: 'moving-occluder',
		purpose: 'Temporal rejection and velocity validity.',
		expected: 'Moving occluders do not leave stale AO history.'
	},
	{
		id: 'resize-dpr',
		purpose: 'Target recreation and texel-size refresh.',
		expected: 'AO targets resize with viewport and DPR without stale offsets.'
	},
	{
		id: 'disabled-ao',
		purpose: 'Disabled-pass bypass cost.',
		expected: 'Disabled mode removes the AO node from the active render pipeline.'
	}
] );

export function listFixtureIds() {
	return AO_FIXTURES.map( ( fixture ) => fixture.id );
}

export function assertFixtureManifestMatchesReference( referenceIds = AO_FIXTURE_IDS ) {
	const ids = listFixtureIds();
	const missing = referenceIds.filter( ( id ) => ! ids.includes( id ) );
	const extra = ids.filter( ( id ) => ! referenceIds.includes( id ) );

	if ( missing.length > 0 || extra.length > 0 ) {
		throw new Error( `AO fixture manifest mismatch. Missing: ${ missing.join( ', ' ) || 'none' }. Extra: ${ extra.join( ', ' ) || 'none' }.` );
	}

	return ids;
}
