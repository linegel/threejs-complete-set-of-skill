export const EXPOSURE_DEBUG_VIEWS = Object.freeze( [
	'meter source HDR',
	'meter mask',
	'partial weightedLogSum weightSum',
	'histogram bins and underflow overflow',
	'histogram prefix and percentile interval',
	'key luminance and target EV',
	'adapted exposure EV',
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

// IDs are [Derived] structural ordering, not tunable parameters.
export function createCheckpointList() {

	return [
		{ id: 1, name: 'HDR source', expected: 'raw scene-pass HDR; temporal source is outside this example boundary' },
		{ id: 2, name: 'meter mask and samples', expected: 'UI excluded; stratified jitter positions remain inside authored cells' },
		{ id: 3, name: 'histogram and reduction', expected: 'clear/bin/prefix/percentile stages produce a valid interval before the weighted-log reduction' },
		{ id: 4, name: 'key and target', expected: 'authored key calibration resolves to targetEV 0' },
		{ id: 5, name: 'adapted exposure', expected: 'currentEV moves monotonically with asymmetric authored time constants' },
		{ id: 6, name: 'post-tone-map linear', expected: 'bounded working-primary linear color before LUT' },
		{ id: 7, name: 'LUT output', expected: 'identity LUT is neutral and creative LUT remains in the declared bounded domain' },
		{ id: 8, name: 'final output', expected: 'one tone-map owner and one output-conversion owner' }
	];

}
