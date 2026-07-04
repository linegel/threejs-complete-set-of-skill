import { BufferGeometry, IndirectStorageBufferAttribute } from "three/webgpu";

export function createIndirectFixture(drawCount = 1) {
  const geometry = new BufferGeometry();
  const indirect = new IndirectStorageBufferAttribute(drawCount * 5, 5);
  geometry.setIndirect(indirect, 0);
  return {
    geometry,
    indirect,
    api: "BufferGeometry.setIndirect(indirect, indirectOffset)",
    attribute: "IndirectStorageBufferAttribute",
  };
}
