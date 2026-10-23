import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contourSegments, joinSegments } from '../js/geo/contour.js';

test('one square with a single corner inside', () => {
  // tl = 1 (inside), others −1: line cuts the top and left edges halfway.
  const segs = contourSegments(new Float64Array([1, -1, -1, -1]), 2, 2);
  assert.equal(segs.length, 1);
  const pts = [[segs[0][0], segs[0][1]], [segs[0][2], segs[0][3]]].map(String).sort();
  assert.deepEqual(pts, ['0,0.5', '0.5,0']);
});

test('crossing point is interpolated linearly', () => {
  // Left column 3, right column −1: zero is 3/4 of the way across.
  const segs = contourSegments(new Float64Array([3, -1, 3, -1]), 2, 2);
  assert.deepEqual(segs, [[0.75, 0, 0.75, 1]]);
});

test('squares touching missing data are skipped', () => {
  assert.equal(contourSegments(new Float64Array([1, -1, NaN, -1]), 2, 2).length, 0);
});

test('saddle squares give two separate segments', () => {
  assert.equal(contourSegments(new Float64Array([1, -1, -1, 1]), 2, 2).length, 2);
  assert.equal(contourSegments(new Float64Array([-1, 1, 1, -1]), 2, 2).length, 2);
});

test('a hill gives one closed loop', () => {
  const n = 21;
  const v = new Float64Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) v[r * n + c] = 50 - Math.hypot(c - 10, r - 10) ** 2;
  const lines = joinSegments(contourSegments(v, n, n));
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.deepEqual(line[0], line[line.length - 1], 'closed');
  for (const [x, y] of line) {
    const d = Math.hypot(x - 10, y - 10);
    assert.ok(Math.abs(d - Math.sqrt(50)) < 0.1, `radius ${d}`);
  }
});

test('a straight crossing joins into one open line', () => {
  const v = new Float64Array(5 * 4);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) v[r * 5 + c] = c - 2.5;
  const lines = joinSegments(contourSegments(v, 5, 4));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 4);
  for (const [x] of lines[0]) assert.equal(x, 2.5);
});
