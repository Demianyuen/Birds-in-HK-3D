import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
const destination = join(projectRoot, 'public', 'basis');
mkdirSync(destination, { recursive: true });

for (const filename of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  copyFileSync(join(source, filename), join(destination, filename));
}
