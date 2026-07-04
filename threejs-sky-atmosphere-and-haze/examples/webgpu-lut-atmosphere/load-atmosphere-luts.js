import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
} from "three/webgpu";

import { LUT_MANIFEST_RELATIVE_PATH } from "./atmosphere-config.js";

export { LUT_MANIFEST_RELATIVE_PATH };

export function expectedTextureByteLength(texture, storage) {
  return (
    texture.width *
    texture.height *
    (texture.depth ?? 1) *
    storage.channels *
    storage.bytesPerChannel
  );
}

function toArrayBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) return buffer;
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  throw new TypeError("LUT buffer must be an ArrayBuffer or typed-array view");
}

function toUint16Array(buffer) {
  const arrayBuffer = toArrayBuffer(buffer);
  if (arrayBuffer.byteLength % 2 !== 0) {
    throw new Error("Half-float LUT byte length must be divisible by two");
  }
  return new Uint16Array(arrayBuffer);
}

function configureDataTexture(texture, storage) {
  texture.format = RGBAFormat;
  texture.type = HalfFloatType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  if ("wrapR" in texture) texture.wrapR = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.unpackAlignment = storage.unpackAlignment;
  texture.needsUpdate = true;
  return texture;
}

export function validateAtmosphereLuts(manifest, buffers = {}) {
  const errors = [];
  if (!manifest?.textures || !manifest?.storage) {
    return { ok: false, errors: ["manifest must contain textures and storage"] };
  }

  for (const [name, texture] of Object.entries(manifest.textures)) {
    const expected = expectedTextureByteLength(texture, manifest.storage);
    if (expected !== texture.byteLength) {
      errors.push(`${name} byteLength must be ${expected}`);
    }
    if (texture.class === "Data3DTexture" && !(texture.depth > 1)) {
      errors.push(`${name} Data3DTexture must declare depth > 1`);
    }
    if (texture.class === "DataTexture" && texture.depth !== 1) {
      errors.push(`${name} DataTexture must declare depth 1`);
    }
    const buffer = buffers[name];
    if (buffer) {
      const arrayBuffer = toArrayBuffer(buffer);
      if (arrayBuffer.byteLength !== texture.byteLength) {
        errors.push(
          `${name} buffer has ${arrayBuffer.byteLength} bytes, expected ${texture.byteLength}`,
        );
      }
    }
  }

  for (const [key, value] of Object.entries({
    format: "RGBAFormat",
    type: "HalfFloatType",
    colorSpace: "NoColorSpace",
    minFilter: "LinearFilter",
    magFilter: "LinearFilter",
    wrapS: "ClampToEdgeWrapping",
    wrapT: "ClampToEdgeWrapping",
    wrapR: "ClampToEdgeWrapping",
  })) {
    if (manifest.storage[key] !== value) {
      errors.push(`storage.${key} must be ${value}`);
    }
  }

  if (manifest.storage.unpackAlignment !== 1) {
    errors.push("storage.unpackAlignment must be 1");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createAtmosphereLutTexture(name, buffer, manifest) {
  const textureMeta = manifest.textures[name];
  if (!textureMeta) {
    throw new Error(`Unknown atmosphere LUT "${name}"`);
  }
  const bytes = toArrayBuffer(buffer);
  if (bytes.byteLength !== textureMeta.byteLength) {
    throw new Error(
      `${name} LUT has ${bytes.byteLength} bytes, expected ${textureMeta.byteLength}`,
    );
  }

  const data = toUint16Array(bytes);
  const texture =
    textureMeta.class === "Data3DTexture"
      ? new Data3DTexture(
          data,
          textureMeta.width,
          textureMeta.height,
          textureMeta.depth,
        )
      : new DataTexture(data, textureMeta.width, textureMeta.height);

  texture.name = `atmosphere-${name}`;
  return configureDataTexture(texture, manifest.storage);
}

export function createAtmosphereLutTextures(buffers, manifest) {
  const validation = validateAtmosphereLuts(manifest, buffers);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  return Object.fromEntries(
    Object.keys(manifest.textures).map((name) => [
      name,
      createAtmosphereLutTexture(name, buffers[name], manifest),
    ]),
  );
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}

async function fetchArrayBuffer(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.arrayBuffer();
}

export async function loadAtmosphereLuts({
  baseUrl = new URL("../../assets/lut-aerial-perspective/", import.meta.url),
  manifestUrl = new URL("manifest.json", baseUrl),
  manifest,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("loadAtmosphereLuts requires fetch or injected fetchImpl");
  }

  const resolvedManifest = manifest ?? (await fetchJson(manifestUrl, fetchImpl));
  const buffers = {};
  for (const [name, texture] of Object.entries(resolvedManifest.textures)) {
    buffers[name] = await fetchArrayBuffer(new URL(texture.path, baseUrl), fetchImpl);
  }

  return {
    manifest: resolvedManifest,
    textures: createAtmosphereLutTextures(buffers, resolvedManifest),
  };
}
