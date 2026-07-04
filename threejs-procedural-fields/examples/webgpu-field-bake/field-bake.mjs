import {
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  RGFormat,
  StorageTexture,
  UnsignedByteType,
} from "three/webgpu";
import { Fn, storageTexture, textureStore, vec4 } from "three/tsl";

export const STORAGE_FORMATS = Object.freeze({
  smoothRgba: {
    format: RGBAFormat,
    type: HalfFloatType,
    colorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  },
  compactRg: {
    format: RGFormat,
    type: HalfFloatType,
    colorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  },
  categorical: {
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  },
});

export function decideBakeStrategy({ readCount, staticField = false }) {
  if (staticField) return "bake-once";
  if (readCount <= 1) return "direct-evaluate";
  if (readCount <= 4) return "local-bundle";
  if (readCount <= 12) return "StorageTexture";
  return "StorageTexture-plus-storage-buffers";
}

export function createFieldStorageTexture(width, height, format = STORAGE_FORMATS.smoothRgba) {
  const texture = new StorageTexture(width, height);
  texture.format = format.format;
  texture.type = format.type;
  texture.colorSpace = format.colorSpace;
  texture.minFilter = format.minFilter;
  texture.magFilter = format.magFilter;
  texture.mipmapsAutoUpdate = false;
  texture.name = "field-packed-atlas";
  return texture;
}

export function createDirtyTileTracker({ tilesX, tilesY }) {
  const dirty = new Set();
  return {
    dirtyTile: dirty,
    invalidate(x, y) {
      dirty.add(`${x}:${y}`);
    },
    clear() {
      dirty.clear();
    },
    allTiles() {
      return Array.from(dirty);
    },
    tilesX,
    tilesY,
  };
}

export function createFieldBakePlan({
  width = 512,
  height = 512,
  readCount = 8,
  dirtyTile = null,
} = {}) {
  const strategy = decideBakeStrategy({ readCount });
  const texture = createFieldStorageTexture(width, height);
  return {
    strategy,
    texture,
    readCount,
    dirtyTile,
    dispatch: [Math.ceil(width / 8), Math.ceil(height / 8), 1],
    api: "renderer.computeAsync",
    write: "textureStore(StorageTexture, uv, packedChannels)",
  };
}

export const FIELD_BAKE_COMPUTE = Fn(({ outputTexture }) => {
  textureStore(storageTexture(outputTexture), [0, 0], vec4(0, 0, 0, 1));
});

export const FIELD_BAKE_SOURCE = `
const fieldBake = Fn(() => {
  const fields = sampleField(coordinate, seed);
  textureStore(fieldAtlas, pixelCoord, fields.packedChannels);
}).compute(width * height);
await renderer.computeAsync(fieldBake);
`;
