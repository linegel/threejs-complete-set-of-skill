export const SIDES = ["front", "back", "left", "right"];

function overlap(a, b, tolerance) {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end) - tolerance;
}

function subtractInterval(segments, blocker, tolerance) {
  const result = [];
  for (const segment of segments) {
    if (!overlap(segment, blocker, tolerance)) {
      result.push(segment);
      continue;
    }
    if (blocker.start > segment.start + tolerance) {
      result.push({
        ...segment,
        end: Math.min(blocker.start, segment.end),
        clippedEnd: true,
        blockers: [...(segment.blockers ?? []), blocker],
      });
    }
    if (blocker.end < segment.end - tolerance) {
      result.push({
        ...segment,
        start: Math.max(blocker.end, segment.start),
        clippedStart: true,
        blockers: [...(segment.blockers ?? []), blocker],
      });
    }
  }
  return result;
}

function sideInterval(rect, side) {
  if (side === "front" || side === "back") {
    return {
      start: rect.x0,
      end: rect.x1,
      x: 0,
      z: side === "front" ? rect.z1 : rect.z0,
      centerAxis: "x",
    };
  }
  return {
    start: rect.z0,
    end: rect.z1,
    x: side === "right" ? rect.x1 : rect.x0,
    z: 0,
    centerAxis: "z",
  };
}

function touches(rect, other, side, tolerance) {
  if (side === "front") return Math.abs(other.z0 - rect.z1) <= tolerance;
  if (side === "back") return Math.abs(other.z1 - rect.z0) <= tolerance;
  if (side === "right") return Math.abs(other.x0 - rect.x1) <= tolerance;
  return Math.abs(other.x1 - rect.x0) <= tolerance;
}

function blockerInterval(other, side) {
  if (side === "front" || side === "back") return { start: other.x0, end: other.x1 };
  return { start: other.z0, end: other.z1 };
}

export function computeExposedEdges(footprintPieces, {
  tierId = "unassigned-tier",
  tolerance = 0.001,
  minimumLength = 0.25,
} = {}) {
  if (!(tolerance > 0) || !(minimumLength > 0)) throw new RangeError("edge tolerances must be positive");
  const exposedEdges = [];
  for (const rect of footprintPieces) {
    for (const side of SIDES) {
      const base = sideInterval(rect, side);
      let segments = [{ start: base.start, end: base.end, clippedStart: false, clippedEnd: false, blockers: [] }];
      for (const other of footprintPieces) {
        if (other.id === rect.id || !touches(rect, other, side, tolerance)) continue;
        const blocker = blockerInterval(other, side);
        segments = subtractInterval(segments, { ...blocker, pieceId: other.id }, tolerance);
      }
      segments
        .filter((segment) => segment.end - segment.start >= minimumLength)
        .forEach((segment, index) => {
          const center = (segment.start + segment.end) / 2;
          const length = segment.end - segment.start;
          exposedEdges.push({
            id: `${tierId}:${rect.id}:${side}:${index}`,
            tierId,
            pieceId: rect.id,
            side,
            center,
            length,
            x: base.centerAxis === "x" ? center : base.x,
            z: base.centerAxis === "z" ? center : base.z,
            start: segment.start,
            end: segment.end,
            isOuterCornerStart: !segment.clippedStart,
            isOuterCornerEnd: !segment.clippedEnd,
            isInnerCornerStart: segment.clippedStart,
            isInnerCornerEnd: segment.clippedEnd,
            blockerIntervals: segment.blockers,
            tolerance,
          });
        });
    }
  }
  return exposedEdges;
}

export function edgeContainsPlacement(edge, placement, tolerance = 0.001) {
  if (placement.edgeId !== edge.id) return false;
  return placement.interval.start >= edge.start - tolerance && placement.interval.end <= edge.end + tolerance;
}
