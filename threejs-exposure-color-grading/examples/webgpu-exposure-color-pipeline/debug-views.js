export const EXPOSURE_DEBUG_VIEWS = Object.freeze( [
	'meter source HDR',
	'meter mask',
	'partial logSum weightSum',
	'aggregate average',
	'adapted exposure',
	'post exposure before tone map',
	'post-tone-map linear',
	'LUT output',
	'final output'
] );

export function createDebugViewRegistry( nodes = {} ) {

	return EXPOSURE_DEBUG_VIEWS.reduce( ( registry, name ) => {

		registry[ name ] = nodes[ name ] ?? null;
		return registry;

	}, {} );

}

export function createCheckpointList() {

	return [
		{ id: 1, name: 'HDR source', expected: 'scene-linear HDR before tone map or LUT' },
		{ id: 2, name: 'meter mask', expected: 'UI excluded, sky/window policy visible' },
		{ id: 3, name: 'partial sums', expected: 'finite logSum and weightSum per workgroup' },
		{ id: 4, name: 'aggregate average', expected: '18% gray resolves to exposure 1.0' },
		{ id: 5, name: 'adapted exposure', expected: 'asymmetric monotonic response toward target' },
		{ id: 6, name: 'post-tone-map linear', expected: 'bounded linear color before LUT' },
		{ id: 7, name: 'LUT output', expected: 'identity LUT is neutral within tolerance' },
		{ id: 8, name: 'final output', expected: 'one output conversion owner' }
	];

}
