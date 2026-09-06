// SPDX-License-Identifier: MPL-2.0
// The only generated runtime file. No remote code or runtime dependencies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
await fs.mkdir('output', { recursive: true });
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    '--yes',
    'esbuild@0.25.10',
    'extension/ui/overlay-entry.js',
    '--bundle',
    '--format=iife',
    '--loader:.css=text',
    '--outfile=extension/overlay.js',
    '--metafile=output/overlay-meta.json',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.status) process.exit(result.status);
const meta = JSON.parse(await fs.readFile('output/overlay-meta.json', 'utf8'));
const hashes = {};
for (const file of [...Object.keys(meta.inputs), 'extension/overlay.js'])
  hashes[file.replace('extension/', '')] = createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
await fs.writeFile('extension/overlay-build.json', JSON.stringify(hashes, null, 2));
