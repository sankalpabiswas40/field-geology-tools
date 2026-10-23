import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planeNormal, attitudeFromNormal, signedDistance } from '../js/geo/plane.js';

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('normals of simple planes', () => {
  const flat = planeNormal(123, 0);
  assert.ok(Math.abs(flat[0]) < 1e-12 && Math.abs(flat[1]) < 1e-12 && Math.abs(flat[2] - 1) < 1e-12);
  // Strike 000, RHR → dips east. Normal leans east.
  const east45 = planeNormal(0, 45);
  assert.ok(Math.abs(east45[0] - Math.SQRT1_2) < 1e-12 && Math.abs(east45[1]) < 1e-12 && Math.abs(east45[2] - Math.SQRT1_2) < 1e-12);
  // Strike 090 → dips south. Normal leans south (negative north).
  const south = planeNormal(90, 30);
  assert.ok(south[1] < 0 && Math.abs(south[0]) < 1e-12);
  for (const [s, d] of [[10, 20], [200, 80], [359, 5]]) {
    assert.ok(Math.abs(Math.hypot(...planeNormal(s, d)) - 1) < 1e-12, 'unit length');
  }
});

test('strike/dip → normal → strike/dip round trip, including near 0° and 360°', () => {
  const strikes = [0, 0.001, 0.5, 3, 45, 89.9, 90, 135, 180, 222.2, 270, 300, 356.5, 359.5, 359.999];
  const dips = [0.5, 1, 15, 30, 45, 60, 75, 89, 89.99, 90];
  for (const strike of strikes) {
    for (const dip of dips) {
      const back = attitudeFromNormal(planeNormal(strike, dip));
      assert.ok(Math.abs(back.dip - dip) < 1e-9, `dip ${strike}/${dip} → ${back.dip}`);
      assert.ok(angleDiff(back.strike, strike) < 1e-9, `strike ${strike}/${dip} → ${back.strike}`);
      assert.ok(back.strike >= 0 && back.strike < 360, `strike in 0–360: ${back.strike}`);
      assert.ok(angleDiff(back.dipDirection, strike + 90) < 1e-9);
    }
  }
});

test('strike 360 comes back as 000', () => {
  const back = attitudeFromNormal(planeNormal(360, 40));
  assert.ok(angleDiff(back.strike, 0) < 1e-9 && back.strike < 360);
});

test('downward or unnormalised normals give the same attitude', () => {
  const n = planeNormal(250, 35);
  const back = attitudeFromNormal([-3 * n[0], -3 * n[1], -3 * n[2]]);
  assert.ok(angleDiff(back.strike, 250) < 1e-9);
  assert.ok(Math.abs(back.dip - 35) < 1e-9);
});

test('horizontal plane has no strike', () => {
  assert.deepEqual(attitudeFromNormal([0, 0, 5]), { strike: null, dip: 0, dipDirection: null });
  assert.throws(() => attitudeFromNormal([0, 0, 0]), RangeError);
});

test('signed distance is positive above the plane', () => {
  const n = planeNormal(0, 0);
  assert.equal(signedDistance(n, [10, 20, 100], [50, -70, 104]), 4);
  assert.equal(signedDistance(n, [10, 20, 100], [0, 0, 97]), -3);
});
