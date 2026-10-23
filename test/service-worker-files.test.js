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

test('every file that index.html loads is cached', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/'), `${ref} must be a relative path (GitHub Pages serves from a sub-folder)`);
    assert.ok(listed.includes(ref), `${ref} is used by index.html but not cached in sw.js`);
  }
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')), 'no internet addresses in index.html');
});

test('every module the code imports (and the worker) is cached', () => {
  for (const file of listed.filter((f) => f.endsWith('.js') && f.startsWith('js/'))) {
    const code = readFileSync(join(root, file), 'utf8');
    const dir = file.slice(0, file.lastIndexOf('/'));
    const imports = [
      ...[...code.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]),
      ...[...code.matchAll(/new URL\('(\.[^']+)'/g)].map((m) => m[1]),
    ];
    for (const imp of imports) {
      const target = join(dir, imp).replaceAll('\\', '/');
      assert.ok(listed.includes(target), `${file} imports ${imp} (${target}), which is not cached`);
    }
    assert.ok(!/https?:\/\/(?!www\.w3\.org|www\.opengis\.net)/.test(code), `${file} must not load anything from the internet`);
  }
});

test('the service worker only deletes its own old caches', () => {
  assert.match(sw, /startsWith\('field-geology-tools-v'\)/);
});
