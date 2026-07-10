import { join } from 'node:path';

export function labViteAliases(repoRoot) {
  return [
    { find: /^three\/addons\//, replacement: `${join(repoRoot, 'node_modules', 'three', 'examples', 'jsm')}/` },
    { find: /^three\/examples\/jsm\//, replacement: `${join(repoRoot, 'node_modules', 'three', 'examples', 'jsm')}/` },
    { find: 'three/webgpu', replacement: join(repoRoot, 'node_modules', 'three', 'build', 'three.webgpu.js') },
    { find: 'three/tsl', replacement: join(repoRoot, 'node_modules', 'three', 'build', 'three.tsl.js') },
    { find: 'three', replacement: join(repoRoot, 'node_modules', 'three', 'build', 'three.webgpu.js') },
  ];
}
