// Fold analysis (the maths behind the stereonet), checked against the shared fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyseFold, foldAxis, lineVector, trendPlunge, symmetricEigen3, fleutyClass, woodcockK,
  interlimbAngles, meanLine, angleBetweenLines, MIN_POLES_FOR_AXIS,
} from '../js/geo/fold.js';
import { planeNormal } from '../js/geo/plane.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fold-test-stations.json', import.meta.url), 'utf8'));
const limbs = fixture.stations.filter((s) => s.featureType === 'bedding'); // S01–S08
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const lineAngle = (a, b) => angleBetweenLines(a, b);

test('fixture S01–S08: fold axis 040/15 within 1°, smallest eigenvalue near zero', () => {
  const r = analyseFold(limbs);
  const want = fixture.expected.foldAxisFromS01toS08;
  assert.equal(r.n, 8);
  assert.equal(r.shape, 'girdle');
  assert.deepEqual(r.warnings, []);
  assert.ok(angleDiff(r.axis.trend, want.trend) <= want.toleranceDeg, `trend ${r.axis.trend}`);
  assert.ok(Math.abs(r.axis.plunge - want.plunge) <= want.toleranceDeg, `plunge ${r.axis.plunge}`);
  assert.ok(r.eigen[2].value < 1e-4, `λ3 = ${r.eigen[2].value}`);
  const sum = r.eigen.reduce((s, e) => s + e.value, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'eigenvalues add up to 1');
  assert.match(r.fitNote, /Very good fit/);
});

test('fixture S01–S08: interlimb angles (a) outermost 79° ± 1°, (b) mean limbs 110° ± 1°, both open', () => {
  const r = analyseFold(limbs);
  assert.ok(r.limbs, 'two limb groups found');
  const ids = (g) => g.map((i) => limbs[i].stationId).sort();
  const groups = [ids(r.limbs.groupA), ids(r.limbs.groupB)].sort();
  assert.deepEqual(groups, [['S01', 'S02', 'S03', 'S04'], ['S05', 'S06', 'S07', 'S08']]);
  const a = fixture.expected.interlimbOutermostFromS01toS08;
  const b = fixture.expected.interlimbMeanLimbsFromS01toS08;
  assert.ok(Math.abs(r.limbs.outermost - a.degrees) <= a.toleranceDeg, `outermost ${r.limbs.outermost}`);
  assert.ok(Math.abs(r.limbs.mean - b.degrees) <= b.toleranceDeg, `mean ${r.limbs.mean}`);
  assert.equal(r.limbs.fleutyOutermost, a.fleuty);
  assert.equal(r.limbs.fleutyMean, b.fleuty);
});

test('interlimb uses the plain dot product of UPWARD normals (no absolute value)', () => {
  // Two limbs dipping 60° away from each other: normals 120° apart → interlimb 60°.
  // Taking |dot| would give 180° − 60° = 120°, which is wrong.
  const normals = [planeNormal(0, 60), planeNormal(180, 60)];
  const { outermost, mean } = interlimbAngles(normals, [0], [1]);
  assert.ok(Math.abs(outermost - 60) < 1e-9 && Math.abs(mean - 60) < 1e-9, `${outermost}, ${mean}`);
});

/** Small seeded random number generator, so the "random" noise is the same every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('fixture with ±3° random noise still gives the axis within a few degrees', () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    const rand = rng(seed);
    const noisy = limbs.map((s) => ({ strike: s.strike + (rand() * 6 - 3), dip: s.dip + (rand() * 6 - 3) }));
    const r = analyseFold(noisy);
    assert.ok(r.axis, `seed ${seed}: axis reported`);
    const off = lineAngle(r.axis, { trend: 40, plunge: 15 });
    assert.ok(off < 4, `seed ${seed}: axis ${r.axis.trend.toFixed(1)}/${r.axis.plunge.toFixed(1)} is ${off.toFixed(1)}° off`);
  }
});

test('one-limb data (a cluster) gives a warning and no axis', () => {
  const oneLimb = [[228, 48], [231, 52], [234, 50], [236, 55], [229, 47], [233, 53], [235, 49], [230, 51]]
    .map(([strike, dip]) => ({ strike, dip }));
  const r = analyseFold(oneLimb);
  assert.equal(r.shape, 'cluster');
  assert.equal(r.axis, null);
  assert.equal(r.limbs, null);
  assert.ok(r.warnings.some((w) => /one cluster/.test(w)));
});

test('fewer than 6 poles gives a warning and no axis', () => {
  const r = analyseFold(limbs.slice(0, MIN_POLES_FOR_AXIS - 1));
  assert.equal(r.axis, null);
  assert.ok(r.warnings.some((w) => /at least 6/.test(w)));
  assert.equal(analyseFold([]).axis, null);
});

test('Fleuty classes and Woodcock K', () => {
  assert.equal(fleutyClass(150), 'gentle');
  assert.equal(fleutyClass(120), 'gentle');
  assert.equal(fleutyClass(110), 'open');
  assert.equal(fleutyClass(70), 'open');
  assert.equal(fleutyClass(50), 'close');
  assert.equal(fleutyClass(10), 'tight');
  assert.equal(fleutyClass(0), 'isoclinal');
  assert.equal(woodcockK(0.5, 0.5, 0), 0);
  assert.equal(woodcockK(1, 0, 0), Infinity);
  assert.ok(woodcockK(0.9, 0.08, 0.02) > 1, 'cluster');
  assert.ok(woodcockK(0.6, 0.39, 0.01) < 1, 'girdle');
});

test('line vectors and trend/plunge round trip; upward lines are flipped down', () => {
  for (const [t, p] of [[0, 0.5], [40, 15], [359.5, 89], [200, 45]]) {
    const back = trendPlunge(lineVector(t, p));
    assert.ok(angleDiff(back.trend, t) < 1e-9 && Math.abs(back.plunge - p) < 1e-9, `${t}/${p}`);
  }
  const back = trendPlunge(lineVector(40, 15).map((x) => -x));
  assert.ok(angleDiff(back.trend, 40) < 1e-9 && Math.abs(back.plunge - 15) < 1e-9);
});

test('eigen solver on a known symmetric matrix', () => {
  const eig = symmetricEigen3([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
  assert.deepEqual(eig.map((e) => Math.round(e.value * 1e9) / 1e9), [5, 3, 1]);
  const v = eig[2].vector;
  assert.ok(Math.abs(Math.abs(v[0]) - Math.SQRT1_2) < 1e-9 && Math.abs(v[0] + v[1]) < 1e-9 && Math.abs(v[2]) < 1e-9);
});

test('foldAxis helper agrees with the full analysis', () => {
  const a = foldAxis(limbs);
  assert.ok(lineAngle(a, analyseFold(limbs).axis) < 1e-6);
  assert.throws(() => foldAxis(limbs.slice(0, 2)), RangeError);
});

test('mean of lines and angle between lines', () => {
  // 005/02 and 185/03 are almost the same line (nearly horizontal, opposite trends).
  const m = meanLine([{ trend: 5, plunge: 2 }, { trend: 185, plunge: 3 }]);
  assert.ok(m.plunge < 1, `plunge ${m.plunge}`);
  assert.ok(lineAngle(m, { trend: 5, plunge: 0 }) < 1.5, `mean ${m.trend}/${m.plunge}`);
  assert.ok(lineAngle({ trend: 5, plunge: 2 }, { trend: 185, plunge: 3 }) < 5.1);
  const m2 = meanLine([{ trend: 30, plunge: 10 }, { trend: 50, plunge: 20 }]);
  assert.ok(lineAngle(m2, { trend: 40, plunge: 15 }) < 0.5);
  assert.ok(Math.abs(lineAngle({ trend: 0, plunge: 0 }, { trend: 90, plunge: 0 }) - 90) < 1e-9);
  assert.ok(Math.abs(lineAngle({ trend: 0, plunge: 0 }, { trend: 0, plunge: 90 }) - 90) < 1e-9);
  assert.ok(Math.abs(lineAngle({ trend: 10, plunge: 30 }, { trend: 10, plunge: 30 })) < 1e-6);
  assert.ok(Math.abs(lineAngle({ trend: 10, plunge: 30 }, { trend: 10, plunge: 50 }) - 20) < 1e-9);
  assert.throws(() => meanLine([]), RangeError);
});
