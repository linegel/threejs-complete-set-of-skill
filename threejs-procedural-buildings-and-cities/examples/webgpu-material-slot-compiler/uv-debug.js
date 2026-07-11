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

export function validateGeometryUvJacobians(geometry, {
  minimumUvPerMeter = 1 / 16,
  maximumUvPerMeter = 16,
  epsilon = 1e-10,
} = {}) {
  const position = geometry?.attributes?.position;
  const uv = geometry?.attributes?.uv;
  const index = geometry?.index;
  const errors = [];
  const densities = [];
  if (!position || !uv || !index) return { ok: false, errors: ["missing indexed position/uv geometry"], densities };
  for (let component = 0; component < index.count; component += 3) {
    const ids = [index.getX(component), index.getX(component + 1), index.getX(component + 2)];
    const a = [position.getX(ids[0]), position.getY(ids[0]), position.getZ(ids[0])];
    const ab = [position.getX(ids[1]) - a[0], position.getY(ids[1]) - a[1], position.getZ(ids[1]) - a[2]];
    const ac = [position.getX(ids[2]) - a[0], position.getY(ids[2]) - a[1], position.getZ(ids[2]) - a[2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const worldJacobian = Math.hypot(...cross);
    const du1 = uv.getX(ids[1]) - uv.getX(ids[0]);
    const dv1 = uv.getY(ids[1]) - uv.getY(ids[0]);
    const du2 = uv.getX(ids[2]) - uv.getX(ids[0]);
    const dv2 = uv.getY(ids[2]) - uv.getY(ids[0]);
    const uvJacobian = Math.abs(du1 * dv2 - dv1 * du2);
    if (!(worldJacobian > epsilon)) {
      errors.push(`triangle ${component / 3} has degenerate world Jacobian`);
      continue;
    }
    if (!(uvJacobian > epsilon)) {
      errors.push(`triangle ${component / 3} has degenerate UV Jacobian`);
      continue;
    }
    const uvPerMeter = Math.sqrt(uvJacobian / worldJacobian);
    densities.push(uvPerMeter);
    if (!Number.isFinite(uvPerMeter) || uvPerMeter < minimumUvPerMeter || uvPerMeter > maximumUvPerMeter) {
      errors.push(`triangle ${component / 3} UV density ${uvPerMeter} outside [${minimumUvPerMeter}, ${maximumUvPerMeter}]`);
    }
  }
  return {
    ok: errors.length === 0 && densities.length === index.count / 3,
    errors,
    densities,
    range: densities.length ? { min: Math.min(...densities), max: Math.max(...densities) } : null,
  };
}

export function validateGeometryTangentFrames(geometry, { minimumAlignment = 0.999, epsilon = 1e-10 } = {}) {
  const position = geometry?.attributes?.position;
  const normal = geometry?.attributes?.normal;
  const tangent = geometry?.attributes?.tangent;
  const uv = geometry?.attributes?.uv;
  const index = geometry?.index;
  const errors = [];
  if (!position || !normal || !tangent || !uv || !index) {
    return { ok: false, errors: ["missing indexed position/normal/tangent/uv geometry"] };
  }
  for (let component = 0; component < index.count; component += 3) {
    const [ia, ib, ic] = [index.getX(component), index.getX(component + 1), index.getX(component + 2)];
    const edge1 = [position.getX(ib) - position.getX(ia), position.getY(ib) - position.getY(ia), position.getZ(ib) - position.getZ(ia)];
    const edge2 = [position.getX(ic) - position.getX(ia), position.getY(ic) - position.getY(ia), position.getZ(ic) - position.getZ(ia)];
    const du1 = uv.getX(ib) - uv.getX(ia);
    const dv1 = uv.getY(ib) - uv.getY(ia);
    const du2 = uv.getX(ic) - uv.getX(ia);
    const dv2 = uv.getY(ic) - uv.getY(ia);
    const determinant = du1 * dv2 - dv1 * du2;
    if (Math.abs(determinant) <= epsilon) {
      errors.push(`triangle ${component / 3} has degenerate tangent UV Jacobian`);
      continue;
    }
    const dPdu = [0, 1, 2].map((axis) => (edge1[axis] * dv2 - edge2[axis] * dv1) / determinant);
    const dPdv = [0, 1, 2].map((axis) => (-edge1[axis] * du2 + edge2[axis] * du1) / determinant);
    for (const vertex of [ia, ib, ic]) {
      const n = [normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)];
      const t = [tangent.getX(vertex), tangent.getY(vertex), tangent.getZ(vertex)];
      const bitangent = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      const expectedW = Math.sign(bitangent[0] * dPdv[0] + bitangent[1] * dPdv[1] + bitangent[2] * dPdv[2]);
      if (expectedW === 0 || Math.sign(tangent.getW(vertex)) !== expectedW) {
        errors.push(`triangle ${component / 3} vertex ${vertex} tangent handedness mismatch`);
      }
      const denominator = Math.hypot(...t) * Math.hypot(...dPdu);
      const alignment = denominator > epsilon
        ? Math.abs((t[0] * dPdu[0] + t[1] * dPdu[1] + t[2] * dPdu[2]) / denominator)
        : 0;
      if (!(alignment >= minimumAlignment)) {
        errors.push(`triangle ${component / 3} vertex ${vertex} tangent alignment ${alignment}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
