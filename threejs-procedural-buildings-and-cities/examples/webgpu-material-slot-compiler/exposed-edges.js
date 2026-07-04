export const SIDES = ["front", "back", "left", "right"];
const EPSILON = 0.001;

function overlap(a, b) {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end) - EPSILON;
}

function subtractInterval(segments, blocker) {
  const result = [];
  for (const segment of segments) {
    if (!overlap(segment, blocker)) {
      result.push(segment);
      continue;
    }
    if (blocker.start > segment.start + EPSILON) {
      result.push({
        ...segment,
        end: Math.min(blocker.start, segment.end),
        clippedEnd: true,
      });
    }
    if (blocker.end < segment.end - EPSILON) {
      result.push({
        ...segment,
        start: Math.max(blocker.end, segment.start),
        clippedStart: true,
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

function touches(rect, other, side) {
  if (side === "front") return Math.abs(other.z0 - rect.z1) <= EPSILON;
  if (side === "back") return Math.abs(other.z1 - rect.z0) <= EPSILON;
  if (side === "right") return Math.abs(other.x0 - rect.x1) <= EPSILON;
  return Math.abs(other.x1 - rect.x0) <= EPSILON;
}

function blockerInterval(other, side) {
  if (side === "front" || side === "back") return { start: other.x0, end: other.x1 };
  return { start: other.z0, end: other.z1 };
}

export function computeExposedEdges(footprintPieces) {
  const exposedEdges = [];
  for (const rect of footprintPieces) {
    for (const side of SIDES) {
      const base = sideInterval(rect, side);
      let segments = [{ start: base.start, end: base.end, clippedStart: false, clippedEnd: false }];
      for (const other of footprintPieces) {
        if (other.id === rect.id || !touches(rect, other, side)) continue;
        segments = subtractInterval(segments, blockerInterval(other, side));
      }
      segments
        .filter((segment) => segment.end - segment.start >= 0.25)
        .forEach((segment, index) => {
          const center = (segment.start + segment.end) / 2;
          const length = segment.end - segment.start;
          exposedEdges.push({
            id: `${rect.id}:${side}:${index}`,
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
