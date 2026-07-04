import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
} from "three/webgpu";

export const ASSET_MANIFEST = {
  limestoneAlbedo: "../../assets/authored-financial-tower/limestone-albedo.png",
  limestoneNormal: "../../assets/authored-financial-tower/limestone-normal.png",
  ornamentsAlbedo: "../../assets/authored-financial-tower/ornaments-albedo.png",
  ornamentsNormal: "../../assets/authored-financial-tower/ornaments-normal.png",
};

function namedTexture(name, colorSpace) {
  const texture = new Texture();
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.userData.source = ASSET_MANIFEST[name];
  return texture;
}

export function createBuildingTextures() {
  return {
    limestoneAlbedo: namedTexture("limestoneAlbedo", SRGBColorSpace),
    ornamentsAlbedo: namedTexture("ornamentsAlbedo", SRGBColorSpace),
    limestoneNormal: namedTexture("limestoneNormal", NoColorSpace),
    ornamentsNormal: namedTexture("ornamentsNormal", NoColorSpace),
  };
}

export function createBuildingNodeMaterials() {
  const textures = createBuildingTextures();
  return {
    limestone: new MeshStandardNodeMaterial({ name: "limestone" }),
    granite: new MeshStandardNodeMaterial({ name: "granite" }),
    "terra-cotta": new MeshStandardNodeMaterial({ name: "terra-cotta" }),
    glass: new MeshPhysicalNodeMaterial({ name: "glass", transparent: true }),
    bronze: new MeshStandardNodeMaterial({ name: "bronze" }),
    "black-metal": new MeshStandardNodeMaterial({ name: "black-metal" }),
    ornament: new MeshStandardNodeMaterial({ name: "ornament" }),
    roof: new MeshStandardNodeMaterial({ name: "roof" }),
    textures,
  };
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
