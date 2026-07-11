import {
  DataTexture,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
} from "three/webgpu";
import { color, float, normalMap, texture as textureNode } from "three/tsl";

export const ASSET_MANIFEST = {
  limestoneAlbedo: "../../assets/authored-financial-tower/limestone-albedo.png",
  limestoneNormal: "../../assets/authored-financial-tower/limestone-normal.png",
  ornamentsAlbedo: "../../assets/authored-financial-tower/ornaments-albedo.png",
  ornamentsNormal: "../../assets/authored-financial-tower/ornaments-normal.png",
};

function configureTexture(texture, name, colorSpace, { decoded }) {
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.userData.source = ASSET_MANIFEST[name];
  texture.userData.decodedAsset = decoded;
  texture.needsUpdate = true;
  return texture;
}

export function createBuildingTextures() {
  const albedo = new Uint8Array([
    186, 174, 151, 255, 205, 193, 169, 255,
    164, 153, 133, 255, 220, 207, 180, 255,
  ]);
  const ornament = new Uint8Array([
    201, 171, 128, 255, 173, 129, 87, 255,
    221, 195, 151, 255, 148, 104, 72, 255,
  ]);
  const normal = new Uint8Array([
    128, 128, 255, 255, 132, 126, 255, 255,
    124, 130, 255, 255, 128, 128, 255, 255,
  ]);
  return {
    limestoneAlbedo: configureTexture(new DataTexture(albedo, 2, 2, RGBAFormat, UnsignedByteType), "limestoneAlbedo", SRGBColorSpace, { decoded: false }),
    ornamentsAlbedo: configureTexture(new DataTexture(ornament, 2, 2, RGBAFormat, UnsignedByteType), "ornamentsAlbedo", SRGBColorSpace, { decoded: false }),
    limestoneNormal: configureTexture(new DataTexture(normal.slice(), 2, 2, RGBAFormat, UnsignedByteType), "limestoneNormal", NoColorSpace, { decoded: false }),
    ornamentsNormal: configureTexture(new DataTexture(normal.slice(), 2, 2, RGBAFormat, UnsignedByteType), "ornamentsNormal", NoColorSpace, { decoded: false }),
  };
}

export async function loadBuildingTextures({ loader = new TextureLoader() } = {}) {
  const entries = await Promise.all(Object.entries(ASSET_MANIFEST).map(async ([name, source]) => {
    const decoded = await loader.loadAsync(new URL(source, import.meta.url).href);
    return [name, configureTexture(
      decoded,
      name,
      name.endsWith("Albedo") ? SRGBColorSpace : NoColorSpace,
      { decoded: true },
    )];
  }));
  return Object.fromEntries(entries);
}

export function createBuildingNodeMaterials({ textures = createBuildingTextures() } = {}) {
  const standard = (name, hex, roughness, metalness = 0, maps = null) => {
    const material = new MeshStandardNodeMaterial();
    material.name = name;
    material.colorNode = maps?.albedo
      ? textureNode(maps.albedo).mul(color(hex))
      : color(hex);
    if (maps?.normal) material.normalNode = normalMap(textureNode(maps.normal));
    material.roughnessNode = float(roughness);
    material.metalnessNode = float(metalness);
    material.userData.materialSlot = name;
    material.userData.boundTextures = maps
      ? { albedo: maps.albedo, normal: maps.normal }
      : null;
    return material;
  };
  const glass = new MeshPhysicalNodeMaterial();
  glass.name = "glass";
  glass.colorNode = color(0x6f9eb0);
  glass.roughnessNode = float(0.16);
  glass.metalnessNode = float(0.05);
  glass.transparent = true;
  glass.opacity = 0.72;
  glass.depthWrite = false;
  glass.userData.materialSlot = "glass";
  const limestoneMaps = { albedo: textures.limestoneAlbedo, normal: textures.limestoneNormal };
  const ornamentMaps = { albedo: textures.ornamentsAlbedo, normal: textures.ornamentsNormal };
  return {
    limestone: standard("limestone", 0xc7b89a, 0.78, 0, limestoneMaps),
    granite: standard("granite", 0x56575b, 0.48, 0, limestoneMaps),
    "terra-cotta": standard("terra-cotta", 0xa85d42, 0.66, 0, ornamentMaps),
    glass,
    bronze: standard("bronze", 0x8f6336, 0.34, 0.78),
    "black-metal": standard("black-metal", 0x20272c, 0.28, 0.86),
    ornament: standard("ornament", 0xd0b98f, 0.62, 0, ornamentMaps),
    roof: standard("roof", 0x50646c, 0.42, 0.58),
    textures,
  };
}

export function disposeBuildingNodeMaterials(materials) {
  for (const [name, material] of Object.entries(materials)) {
    if (name === "textures") continue;
    material.dispose();
  }
  for (const texture of Object.values(materials.textures ?? {})) texture.dispose();
}

export function validateMaterialColorSpaces(textures = createBuildingTextures()) {
  return {
    ok:
      textures.limestoneAlbedo.colorSpace === SRGBColorSpace &&
      textures.ornamentsAlbedo.colorSpace === SRGBColorSpace &&
      textures.limestoneNormal.colorSpace === NoColorSpace &&
      textures.ornamentsNormal.colorSpace === NoColorSpace,
    color: [textures.limestoneAlbedo.colorSpace, textures.ornamentsAlbedo.colorSpace],
    data: [textures.limestoneNormal.colorSpace, textures.ornamentsNormal.colorSpace],
  };
}

export function validateMaterialBindings(materials, { requireDecodedAssets = false } = {}) {
  const errors = [];
  for (const slot of ["limestone", "granite", "terra-cotta", "ornament"]) {
    const material = materials?.[slot];
    const bound = material?.userData?.boundTextures;
    if (!material?.colorNode || !material?.normalNode) errors.push(`${slot} missing live color/normal nodes`);
    if (!bound?.albedo?.isTexture || !bound?.normal?.isTexture) errors.push(`${slot} missing bound texture objects`);
    for (const [role, texture] of Object.entries(bound ?? {})) {
      const image = texture?.image;
      const hasPixels = Number(image?.width) > 0 && Number(image?.height) > 0 &&
        (image?.data === undefined || image.data?.byteLength > 0);
      if (!hasPixels) errors.push(`${slot} ${role} has no decoded/procedural pixels`);
      if (requireDecodedAssets && texture?.userData?.decodedAsset !== true) {
        errors.push(`${slot} ${role} is not a decoded canonical asset`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
