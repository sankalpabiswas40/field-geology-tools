import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGeographicWgs84, gridFromGeoTiff, toElevationGrid, sampleBilinear, elevationAt,
} from '../js/geo/raster.js';

test('accepts EPSG:4326 and rejects anything else with a message', () => {
  assert.equal(checkGeographicWgs84({ GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 }).ok, true);
  const projected = checkGeographicWgs84({ GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32632 });
  assert.equal(projected.ok, false);
  assert.match(projected.message, /32632/);
  assert.equal(checkGeographicWgs84({ GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4258 }).ok, false);
  assert.equal(checkGeographicWgs84({ GTModelTypeGeoKey: 2 }).ok, false);
  assert.equal(checkGeographicWgs84(null).ok, false);
});

test('PixelIsArea: tie point is the corner of the first pixel', () => {
  const g = gridFromGeoTiff({ originX: 7, originY: 46, resX: 0.5, resY: -0.25, width: 4, height: 8, rasterType: 1 });
  assert.deepEqual(g, { west: 7, north: 46, east: 9, south: 44, resLon: 0.5, resLat: 0.25, width: 4, height: 8 });
});

test('PixelIsPoint: tie point is the centre of the first pixel', () => {
  const g = gridFromGeoTiff({ originX: 7, originY: 46, resX: 0.5, resY: -0.25, width: 4, height: 8, rasterType: 2 });
  assert.equal(g.west, 6.75);
  assert.equal(g.north, 46.125);
  assert.equal(g.east, 8.75);
  assert.equal(g.south, 44.125);
});

test('rejects rotated / south-up grids and impossible bounds', () => {
  assert.throws(() => gridFromGeoTiff({ originX: 0, originY: 0, resX: 1, resY: 1, width: 2, height: 2, rasterType: 1 }), RangeError);
  assert.throws(() => gridFromGeoTiff({ originX: 179, originY: 0, resX: 1, resY: -1, width: 3, height: 2, rasterType: 1 }), RangeError);
  assert.throws(() => gridFromGeoTiff({ originX: 0, originY: 0, resX: 1, resY: -1, width: 2, height: 2, rasterType: 7 }), RangeError);
});

test('no-data values become NaN', () => {
  const out = toElevationGrid(new Int16Array([5, -32767, 7]), -32767);
  assert.equal(out[0], 5);
  assert.ok(Number.isNaN(out[1]));
  assert.equal(out[2], 7);
  const noNodata = toElevationGrid(new Float32Array([1, NaN]), null);
  assert.equal(noNodata[0], 1);
  assert.ok(Number.isNaN(noNodata[1]));
});

test('bilinear interpolation reproduces a plane exactly', () => {
  const w = 4, h = 3;
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[y * w + x] = 10 + 2 * x + 3 * y;
  for (const [x, y] of [[0, 0], [0.25, 0.5], [1.5, 1.5], [3, 2], [2.9, 0.1]]) {
    assert.ok(Math.abs(sampleBilinear(v, w, h, x, y) - (10 + 2 * x + 3 * y)) < 1e-5, `${x},${y}`);
  }
});

test('bilinear mixes the four corners (not a plane)', () => {
  // corners 0, 10 (top) and 20, 0 (bottom): centre = average = 7.5
  const v = new Float32Array([0, 10, 20, 0]);
  assert.equal(sampleBilinear(v, 2, 2, 0.5, 0.5), 7.5);
  assert.equal(sampleBilinear(v, 2, 2, 0.5, 0), 5);
});

test('bilinear gives NaN outside the grid or next to missing data', () => {
  const v = new Float32Array([1, 2, 3, NaN]);
  assert.ok(Number.isNaN(sampleBilinear(v, 2, 2, -0.1, 0)));
  assert.ok(Number.isNaN(sampleBilinear(v, 2, 2, 0, 1.01)));
  assert.ok(Number.isNaN(sampleBilinear(v, 2, 2, 0.5, 0.5)));
});

test('elevationAt uses pixel centres and reports problems clearly', () => {
  // 3×3 grid of 0.1° pixels, NW edge at (10°N, 20°E). Value = column*100 + row.
  const grid = gridFromGeoTiff({ originX: 20, originY: 10, resX: 0.1, resY: -0.1, width: 3, height: 3, rasterType: 1 });
  const elev = new Float32Array([0, 100, 200, 1, 101, 201, 2, 102, 202]);

  const centre = elevationAt(grid, elev, 9.85, 20.15); // exactly the centre of pixel (1,1)
  assert.equal(centre.ok, true);
  assert.ok(Math.abs(centre.elevation - 101) < 1e-6);

  const between = elevationAt(grid, elev, 9.90, 20.10); // halfway between pixels (0,0),(1,0),(0,1),(1,1)
  assert.ok(Math.abs(between.elevation - 50.5) < 1e-6);

  const outside = elevationAt(grid, elev, 11, 20.1);
  assert.equal(outside.ok, false);
  assert.match(outside.message, /outside/);

  const edge = elevationAt(grid, elev, 9.99, 20.15); // inside the DEM but above the top row of centres
  assert.equal(edge.ok, false);
  assert.match(edge.message, /edge/);

  elev[4] = NaN;
  const hole = elevationAt(grid, elev, 9.85, 20.15);
  assert.equal(hole.ok, false);
  assert.match(hole.message, /no data/);
});
