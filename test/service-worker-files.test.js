// Not maths, but a safety net: the service worker must list every file the app needs,
// otherwise that file would be missing in Airplane Mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(rel));
    else out.push(rel);
  }
  return out;
}

test('every file listed in sw.js exists', () => {
  for (const f of listed) assert.ok(existsSync(join(root, f)), `sw.js lists missing file ${f}`);
});

test('every app file is listed in sw.js', () => {
  const needed = [
    'index.html', 'manifest.webmanifest',
    ...filesUnder('js'), ...filesUnder('css'), ...filesUnder('icons'),
    ...filesUnder('vendor').filter((f) => !/LICENSE/.test(f)),
  ].map((f) => relative(root, join(root, f)).replaceAll('\\', '/'));
  for (const f of needed) assert.ok(listed.includes(f), `${f} is not in APP_FILES in sw.js`);
});

test('cache version is a number', () => {
  assert.match(sw, /const CACHE_VERSION = \d+;/);
});
