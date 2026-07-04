export const ATLAS_TILE_METERS = 1.45;

export function subdivideSpan(length, tileMeters = ATLAS_TILE_METERS) {
  const count = Math.max(1, Math.ceil(length / tileMeters));
  const span = length / count;
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * span,
    end: (index + 1) * span,
    worldMeters: span,
    uvSpan: Math.min(1, span / tileMeters),
  }));
}

export function validateUvDensity(placements, tileMeters = ATLAS_TILE_METERS) {
  const errors = [];
  const samples = [];
  for (const placement of placements) {
    const u = subdivideSpan(placement.dimensions.width, tileMeters);
    const v = subdivideSpan(placement.dimensions.height, tileMeters);
    for (const segment of [...u, ...v]) {
      samples.push({ placementId: placement.id, worldMeters: segment.worldMeters, uvSpan: segment.uvSpan });
      if (segment.worldMeters > tileMeters + 1e-6) errors.push(placement.id);
    }
  }
  return { ok: errors.length === 0, errors, samples };
}
