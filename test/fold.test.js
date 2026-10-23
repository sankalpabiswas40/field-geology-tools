// Fold-axis maths (the core of the future stereonet), checked against the shared fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldAxis, interlimbAngle, lineVector, trendPlunge, symmetricEigen3 } from '../js/geo/fold.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fold-test-stations.json', import.meta.url), 'utf8'));
const limbs = fixture.stations.filter((s) => s.featureType === 'bedding'); // S01–S08
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('fixture: S01–S08 give a fold axis of 040/15 within 1°', () => {
  const want = fixture.expected.foldAxisFromS01toS08;
  assert.equal(limbs.length, 8);
  const axis = foldAxis(limbs);
  assert.ok(angleDiff(axis.trend, want.trend) <= want.toleranceDeg, `trend ${axis.trend}`);
  assert.ok(Math.abs(axis.plunge - want.plunge) <= want.toleranceDeg, `plunge ${axis.plunge}`);
  assert.ok(axis.cylindricity < 0.001, 'the test fold is cylindrical');
});

test('fixture: S01–S08 give an interlimb angle of about 80°', () => {
  const want = fixture.expected.interlimbAngleFromS01toS08;
  const angle = interlimbAngle(limbs, foldAxis(limbs));
  assert.ok(Math.abs(angle - want.degrees) <= want.toleranceDeg, `interlimb ${angle}`);
});

test('line vectors and trend/plunge round trip; upward lines are flipped down', () => {
  for (const [t, p] of [[0, 0], [40, 15], [359.5, 89], [200, 45]]) {
    const back = trendPlunge(lineVector(t, p));
    assert.ok(angleDiff(back.trend, t) < 1e-9 && Math.abs(back.plunge - p) < 1e-9, `${t}/${p}`);
  }
  const up = lineVector(40, 15).map((x) => -x);
  const back = trendPlunge(up);
  assert.ok(angleDiff(back.trend, 40) < 1e-9 && Math.abs(back.plunge - 15) < 1e-9);
});

test('eigen solver on a known symmetric matrix', () => {
  const eig = symmetricEigen3([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
  assert.deepEqual(eig.map((e) => Math.round(e.value * 1e9) / 1e9), [5, 3, 1]);
  const v = eig[2].vector; // for value 1: (1, −1, 0)/√2
  assert.ok(Math.abs(Math.abs(v[0]) - Math.SQRT1_2) < 1e-9 && Math.abs(v[0] + v[1]) < 1e-9 && Math.abs(v[2]) < 1e-9);
});

test('a fold axis needs at least 3 attitudes', () => {
  assert.throws(() => foldAxis(limbs.slice(0, 2)), RangeError);
});
