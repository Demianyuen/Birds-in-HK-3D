import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const copySets = [
  {
    source: join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'),
    destination: join(projectRoot, 'public', 'basis'),
    files: ['basis_transcoder.js', 'basis_transcoder.wasm'],
  },
  {
    source: join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf'),
    destination: join(projectRoot, 'public', 'draco', 'gltf'),
    files: ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'],
  },
];

for (const copySet of copySets) {
  mkdirSync(copySet.destination, { recursive: true });
  for (const filename of copySet.files) {
    copyFileSync(join(copySet.source, filename), join(copySet.destination, filename));
  }
}
