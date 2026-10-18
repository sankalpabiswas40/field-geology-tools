import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metresPerDegree } from '../js/geo/ellipsoid.js';

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}, got ${actual}`);

test('metres per degree match published WGS84 values', () => {
  const eq = metresPerDegree(0);
  close(eq.lat, 110574.276, 0.01, 'lat at equator');
  close(eq.lon, 111319.491, 0.01, 'lon at equator');

  const mid = metresPerDegree(45);
  close(mid.lat, 111131.777, 0.01, 'lat at 45°'); // 111132.954 − 559.822·cos90° + 1.175·cos180°
  close(mid.lon, 78846.835, 0.01, 'lon at 45°');
});

test('longitude spacing shrinks with cos(latitude)', () => {
  const m60 = metresPerDegree(60);
  // On a sphere it would be exactly half; the ellipsoid makes it slightly more.
  assert.ok(m60.lon / metresPerDegree(0).lon > 0.5);
  assert.ok(m60.lon / metresPerDegree(0).lon < 0.502);
  assert.ok(metresPerDegree(90).lon < 1e-6);
  assert.equal(metresPerDegree(-30).lon, metresPerDegree(30).lon);
});

test('invalid latitude throws', () => {
  assert.throws(() => metresPerDegree(91), RangeError);
  assert.throws(() => metresPerDegree(NaN), RangeError);
});
