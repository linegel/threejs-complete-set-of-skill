import { planetFields, normalize } from "./planet-fields.js";

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function altitudeDetailWeights({ altitude, radius }) {
  const near = Math.max(radius * 0.022, 6.5);
  const mid = Math.max(radius * 0.11, 24);
  const far = Math.max(radius * 0.5, 140);
  const nearWeight = 1 - smoothstep(near, mid, altitude);
  const farWeight = smoothstep(mid, far, altitude);
  const midWeight = clamp(1 - nearWeight - farWeight);
  return { near, mid, far, nearWeight, midWeight, farWeight };
}

export function heightGradient(direction, options = {}) {
  const radial = normalize(direction);
  const epsilon = options.epsilon ?? 0.0025;
  const xTangent = normalize([radial[2], 0, -radial[0]]);
  const yTangent = normalize([
    radial[1] * xTangent[2] - radial[2] * xTangent[1],
    radial[2] * xTangent[0] - radial[0] * xTangent[2],
    radial[0] * xTangent[1] - radial[1] * xTangent[0],
  ]);
  const sample = (offset) =>
    planetFields(
      normalize([
        radial[0] + offset[0],
        radial[1] + offset[1],
        radial[2] + offset[2],
      ]),
      options,
    ).height;
  const hx =
    (sample(xTangent.map((value) => value * epsilon)) -
      sample(xTangent.map((value) => -value * epsilon))) /
    (2 * epsilon);
  const hy =
    (sample(yTangent.map((value) => value * epsilon)) -
      sample(yTangent.map((value) => -value * epsilon))) /
    (2 * epsilon);
  return { analyticGradient: [hx, hy], heightGradient: [hx, hy] };
}
