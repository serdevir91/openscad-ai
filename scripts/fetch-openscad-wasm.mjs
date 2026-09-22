import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = 'https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip';
const expectedSha256 = '0968af31b9c9b3bba68d9031de1695ccae51c32231a1aab4ef27b18c86379f3b';
const destination = resolve('public', 'openscad');
const jsFile = join(destination, 'openscad.js');
const wasmFile = join(destination, 'openscad.wasm');

if (existsSync(jsFile) && existsSync(wasmFile)) {
  console.log('OpenSCAD WebAssembly runtime is already available.');
  process.exit(0);
}

const response = await fetch(source);
if (!response.ok) throw new Error(`OpenSCAD WASM download failed: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actualSha256 = createHash('sha256').update(archive).digest('hex');
if (actualSha256 !== expectedSha256) {
  throw new Error(`OpenSCAD WASM checksum mismatch: ${actualSha256}`);
}

const archivePath = join(tmpdir(), `openscad-ai-wasm-${process.pid}.zip`);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await writeFile(archivePath, archive);

const extractor = process.platform === 'win32'
  ? spawnSync('tar.exe', ['-xf', archivePath, '-C', destination], { stdio: 'inherit' })
  : spawnSync('unzip', ['-q', archivePath, '-d', destination], { stdio: 'inherit' });
await rm(archivePath, { force: true });
if (extractor.status !== 0) throw new Error('Could not extract the OpenSCAD WASM runtime.');

for (const file of [jsFile, wasmFile]) {
  if (!existsSync(file) || (await readFile(file)).length === 0) {
    throw new Error(`OpenSCAD WASM archive did not contain ${file}.`);
  }
}
console.log('Verified OpenSCAD WebAssembly runtime installed in public/openscad.');
