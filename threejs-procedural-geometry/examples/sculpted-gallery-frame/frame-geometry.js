import * as THREE from "three";

// LEGACY geometry-only frame emitter. New semantic writer teaching and
// validation live in ../semantic-mesh-writer/.

export const FRAME_RAIL_Z_OFFSET = 0.055;
export const FRAME_INNER_RIM_T = 0;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, amount) => start + (end - start) * amount;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function profileZAt(t, railWidth) {
  const scale = railWidth / 0.75;
  const crown =
    0.355 * scale * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.56);
  const innerBead =
    0.105 * scale * Math.exp(-Math.pow((t - 0.085) / 0.033, 2));
  const outerBead =
    0.092 * scale * Math.exp(-Math.pow((t - 0.905) / 0.038, 2));
  const innerGroove =
    -0.115 * scale * Math.exp(-Math.pow((t - 0.205) / 0.043, 2));
  const outerGroove =
    -0.102 * scale * Math.exp(-Math.pow((t - 0.735) / 0.052, 2));
  const shoulder =
    0.045 * scale * Math.exp(-Math.pow((t - 0.42) / 0.15, 2));
  const cove =
    -0.035 * scale * Math.exp(-Math.pow((t - 0.61) / 0.095, 2));

  let z =
    0.07 * scale +
    crown +
    innerBead +
    outerBead +
    innerGroove +
    outerGroove +
    shoulder +
    cove;

  z = lerp(0.105 * scale, z, smoothstep(0, 0.052, t));
  z = lerp(z, 0.095 * scale, smoothstep(0.952, 1, t));
  return z;
}

export function buildFrameProfile(railWidth, samples = 92) {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return { t, z: profileZAt(t, railWidth) };
  });
}

function getRailPoint(orientation, dimensions, t, s, z) {
  const outerHalfWidth = dimensions.outerWidth / 2;
  const outerHalfHeight = dimensions.outerHeight / 2;
  const innerHalfWidth = dimensions.innerWidth / 2;
  const innerHalfHeight = dimensions.innerHeight / 2;
  const railWidth =
    orientation === "top" || orientation === "bottom"
      ? dimensions.railWidthY
      : dimensions.railWidthX;
  const a = t * railWidth;
  let x = 0;
  let y = 0;

  if (orientation === "top") {
    y = innerHalfHeight + a;
    x = lerp(
      -outerHalfWidth + dimensions.railWidthX - t * dimensions.railWidthX,
      outerHalfWidth - dimensions.railWidthX + t * dimensions.railWidthX,
      s,
    );
  } else if (orientation === "bottom") {
    y = -innerHalfHeight - a;
    x = lerp(
      -outerHalfWidth + dimensions.railWidthX - t * dimensions.railWidthX,
      outerHalfWidth - dimensions.railWidthX + t * dimensions.railWidthX,
      s,
    );
  } else if (orientation === "right") {
    x = innerHalfWidth + a;
    y = lerp(
      -outerHalfHeight + dimensions.railWidthY - t * dimensions.railWidthY,
      outerHalfHeight - dimensions.railWidthY + t * dimensions.railWidthY,
      s,
    );
  } else {
    x = -innerHalfWidth - a;
    y = lerp(
      -outerHalfHeight + dimensions.railWidthY - t * dimensions.railWidthY,
      outerHalfHeight - dimensions.railWidthY + t * dimensions.railWidthY,
      s,
    );
  }

  return new THREE.Vector3(x, y, z);
}

function addQuadFace(indices, a, b, c, d) {
  indices.push(a, b, c, b, d, c);
}

export function createSculptedRailGeometry(orientation, dimensions) {
  const profile = buildFrameProfile(dimensions.profileRailWidth);
  const lengthSegments =
    orientation === "top" || orientation === "bottom" ? 132 : 156;
  const bottomZ = -0.18 * (dimensions.profileRailWidth / 0.75);
  const positions = [];
  const uvs = [];
  const indices = [];
  const topIndices = [];
  const bottomIndices = [];

  const pushVertex = (vertex, u, v) => {
    const id = positions.length / 3;
    positions.push(vertex.x, vertex.y, vertex.z);
    uvs.push(u, v);
    return id;
  };

  profile.forEach(({ t, z }, profileIndex) => {
    topIndices[profileIndex] = [];
    bottomIndices[profileIndex] = [];

    for (let segment = 0; segment <= lengthSegments; segment += 1) {
      const s = segment / lengthSegments;
      const top = getRailPoint(orientation, dimensions, t, s, z);
      const bottom = getRailPoint(orientation, dimensions, t, s, bottomZ);
      topIndices[profileIndex][segment] = pushVertex(top, s, t);
      bottomIndices[profileIndex][segment] = pushVertex(bottom, s, t + 0.08);
    }
  });

  for (let profileIndex = 0; profileIndex < profile.length - 1; profileIndex += 1) {
    for (let segment = 0; segment < lengthSegments; segment += 1) {
      addQuadFace(
        indices,
        topIndices[profileIndex][segment],
        topIndices[profileIndex][segment + 1],
        topIndices[profileIndex + 1][segment],
        topIndices[profileIndex + 1][segment + 1],
      );
      addQuadFace(
        indices,
        bottomIndices[profileIndex + 1][segment],
        bottomIndices[profileIndex + 1][segment + 1],
        bottomIndices[profileIndex][segment],
        bottomIndices[profileIndex][segment + 1],
      );
    }
  }

  for (let segment = 0; segment < lengthSegments; segment += 1) {
    addQuadFace(
      indices,
      bottomIndices[0][segment],
      bottomIndices[0][segment + 1],
      topIndices[0][segment],
      topIndices[0][segment + 1],
    );
    addQuadFace(
      indices,
      topIndices[profile.length - 1][segment],
      topIndices[profile.length - 1][segment + 1],
      bottomIndices[profile.length - 1][segment],
      bottomIndices[profile.length - 1][segment + 1],
    );
  }

  for (let profileIndex = 0; profileIndex < profile.length - 1; profileIndex += 1) {
    addQuadFace(
      indices,
      bottomIndices[profileIndex][0],
      topIndices[profileIndex][0],
      bottomIndices[profileIndex + 1][0],
      topIndices[profileIndex + 1][0],
    );
    addQuadFace(
      indices,
      topIndices[profileIndex][lengthSegments],
      bottomIndices[profileIndex][lengthSegments],
      topIndices[profileIndex + 1][lengthSegments],
      bottomIndices[profileIndex + 1][lengthSegments],
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.orientation = orientation;
  return geometry;
}

export function getFrameMetrics(layout) {
  const aspect = 326 / 492;
  const innerWidth = layout.postWidth;
  const innerHeight = innerWidth / aspect;
  const railWidthX = (layout.frameOuterWidth - innerWidth) / 2;
  const railWidthY = (layout.frameOuterHeight - innerHeight) / 2;
  const profileRailWidth = Math.min(railWidthX, railWidthY);

  return {
    innerWidth,
    innerHeight,
    railWidthX,
    railWidthY,
    profileRailWidth,
    cardWidth: innerWidth,
    cardHeight: innerHeight,
    cardZ:
      FRAME_RAIL_Z_OFFSET + profileZAt(FRAME_INNER_RIM_T, profileRailWidth),
  };
}
