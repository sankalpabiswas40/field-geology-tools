import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latToMercatorY, mercatorYToLat, mercatorRowMap } from '../js/geo/mercator.js';

test('Mercator y round-trips latitude', () => {
  assert.ok(Math.abs(latToMercatorY(0)) < 1e-15);
  for (const lat of [-80, -45.5, 0.001, 30, 66.6, 84]) {
    assert.ok(Math.abs(mercatorYToLat(latToMercatorY(lat)) - lat) < 1e-10);
  }
});

test('row map is almost the identity for a small DEM at the equator', () => {
  const res = 1 / 3600;
  const map = mercatorRowMap(res * 50, -res * 50, res, 100);
  for (let k = 0; k < 100; k++) assert.ok(Math.abs(map[k] - k) < 1e-3, `row ${k}: ${map[k]}`);
});

test('row map at high latitude is increasing and stretches the north more', () => {
  // A 1° tile from 70°N to 69°N, 3600 rows.
  const map = mercatorRowMap(70, 69, 1 / 3600, 3600);
  for (let k = 1; k < map.length; k++) assert.ok(map[k] > map[k - 1]);
  // Mercator stretches the north, so the first output rows cover fewer source rows than the last ones.
  assert.ok(map[1] - map[0] < map[3599] - map[3598]);
  // Output covers the same area as the source: ends stay within a pixel of the source ends.
  assert.ok(map[0] > -0.5 && map[0] < 0.5);
  assert.ok(map[3599] > 3598.5 && map[3599] < 3599.5);
});
