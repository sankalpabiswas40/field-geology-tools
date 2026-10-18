import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hornGradient, slopeDegrees, shadeFromGradient, computeHillshade } from '../js/geo/hillshade.js';
import { metresPerDegree } from '../js/geo/ellipsoid.js';

const close = (actual, expected, tol, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected}, got ${actual}`);

test('Horn gradient recovers a tilted plane exactly', () => {
  // z = 2·east + 3·north with 10 m cells. Top row is north, so north decreases going down.
  const dx = 10, dy = 10;
  const win = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) win.push(2 * c * dx + 3 * -r * dy);
  const g = hornGradient(win, dx, dy);
  close(g.dzdx, 2, 1e-12);
  close(g.dzdy, 3, 1e-12);
});

test('slope angle', () => {
  close(slopeDegrees(0, 0), 0, 1e-12);
  close(slopeDegrees(1, 0), 45, 1e-12);
  close(slopeDegrees(0.6, 0.8), 45, 1e-12);
});

test('flat ground is lit at sin(sun altitude)', () => {
  close(shadeFromGradient(0, 0, 315, 45), Math.SQRT1_2, 1e-12);
  close(shadeFromGradient(0, 0, 315, 90), 1, 1e-12);
});

test('45° slope facing the NW sun is fully lit; facing away is black', () => {
  // Facing NW means it rises towards the SE: up going east, down going north.
  const s = Math.SQRT1_2;
  close(shadeFromGradient(s, -s, 315, 45), 1, 1e-12, 'facing sun');
  close(shadeFromGradient(-s, s, 315, 45), 0, 1e-12, 'facing away');
  // A NE-facing slope is side-lit, so in between.
  const side = shadeFromGradient(-s, -s, 315, 45);
  assert.ok(side > 0 && side < 1);
});

function makeGrid({ width, height, north, west, resLon, resLat, zFn }) {
  const elevation = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const lat = north - (r + 0.5) * resLat;
      const lon = west + (c + 0.5) * resLon;
      elevation[r * width + c] = zFn(lat, lon);
    }
  }
  return { elevation, width, height, north, resLon, resLat };
}

test('flat DEM gives uniform shade and a NaN border', () => {
  const grid = makeGrid({ width: 5, height: 4, north: 46, west: 7, resLon: 1 / 3600, resLat: 1 / 3600, zFn: () => 1200 });
  const hs = computeHillshade(grid);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      const v = hs[r * 5 + c];
      if (r === 0 || r === 3 || c === 0 || c === 4) assert.ok(Number.isNaN(v), `border ${r},${c}`);
      else close(v, Math.SQRT1_2, 1e-6);
    }
  }
});

test('degree cell size is converted to metres using cos(latitude)', () => {
  // Elevation rises 1 m per cell going east. With 1" cells, the cell is ~15.4 m wide
  // at 60°N but ~30.9 m at the equator, so the slope at 60°N must be about twice as steep.
  const res = 1 / 3600;
  for (const lat0 of [0, 60]) {
    const grid = makeGrid({
      width: 3, height: 3, north: lat0 + 1.5 * res, west: 10, resLon: res, resLat: res,
      zFn: (lat, lon) => (lon - 10) / res,
    });
    const hs = computeHillshade(grid);
    const dxMetres = res * metresPerDegree(lat0).lon;
    close(hs[4], shadeFromGradient(1 / dxMetres, 0), 1e-6, `lat ${lat0}`);
  }
});

test('a real-world tilted plane on a lat/long grid gives the expected shade', () => {
  // Plane rising 0.3 m per metre east and 0.1 m per metre north, near 45°N with 1" cells.
  const res = 1 / 3600, north = 45.01, west = 6.0;
  const m = metresPerDegree(45);
  const grid = makeGrid({
    width: 20, height: 20, north, west, resLon: res, resLat: res,
    zFn: (lat, lon) => 0.3 * (lon - west) * metresPerDegree(lat).lon + 0.1 * (lat - 45) * m.lat,
  });
  const hs = computeHillshade(grid);
  close(hs[10 * 20 + 10], shadeFromGradient(0.3, 0.1), 1e-3);
});

test('missing data makes neighbouring cells NaN', () => {
  const grid = makeGrid({ width: 5, height: 5, north: 1, west: 1, resLon: 0.001, resLat: 0.001, zFn: () => 10 });
  grid.elevation[2 * 5 + 2] = NaN;
  const hs = computeHillshade(grid);
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) assert.ok(Number.isNaN(hs[r * 5 + c]));
});

test('rejects bad input', () => {
  assert.throws(() => computeHillshade({ elevation: new Float32Array(3), width: 2, height: 2, north: 0, resLon: 1, resLat: 1 }), RangeError);
  assert.throws(() => computeHillshade({ elevation: new Float32Array(4), width: 2, height: 2, north: 0, resLon: 0, resLat: 1 }), RangeError);
});
