// Tests for the outcrop trace predictor, using synthetic DEMs whose shape we know exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictTraces, uncertaintyAttitudes, gridToLatLon } from '../js/geo/trace.js';
import { contourSegments, joinSegments } from '../js/geo/contour.js';
import { planeNormal } from '../js/geo/plane.js';
import { sampleBilinear } from '../js/geo/raster.js';
import { toUtm, utmZone } from '../js/geo/utm.js';

const RES = 1 / 3600; // 1 arc-second, like Copernicus GLO-30

/**
 * Builds a lat/long DEM centred near (46.5°N, 9.0°E). zFn(x, y) gives the height from the
 * east/north offset in UTM metres from the centre cell, so the terrain shape is exact in metres.
 */
function makeDem(size, zFn) {
  const north = 46.5 + (size / 2) * RES;
  const west = 9.0 - (size / 2) * RES;
  const grid = { west, north, east: west + size * RES, south: north - size * RES, resLon: RES, resLat: RES, width: size, height: size };
  const mid = Math.floor(size / 2);
  const centre = gridToLatLon(grid, mid, mid);
  const zone = utmZone(centre.lat, centre.lon);
  const c = toUtm(centre.lat, centre.lon, zone);
  const elevation = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let col = 0; col < size; col++) {
      const p = gridToLatLon(grid, col, r);
      const u = toUtm(p.lat, p.lon, zone);
      elevation[r * size + col] = zFn(u.easting - c.easting, u.northing - c.northing);
    }
  }
  return { grid, elevation, centre, zone, origin: c };
}

/** All trace vertices with UTM offsets (x, y) from the DEM centre and DEM height z (bilinear). */
function vertices(dem, lines) {
  const out = [];
  for (const line of lines) {
    for (const p of line) {
      const u = toUtm(p.lat, p.lon, dem.zone);
      out.push({
        ...p,
        x: u.easting - dem.origin.easting,
        y: u.northing - dem.origin.northing,
        z: sampleBilinear(dem.elevation, dem.grid.width, dem.grid.height, p.col, p.row),
      });
    }
  }
  return out;
}

const hill = (x, y) => 1500 + 400 * Math.exp(-(x * x + y * y) / (900 * 900)) + 25 * Math.sin(x / 170) * Math.cos(y / 230);

test('horizontal bed (dip 0) follows the DEM contour at the station elevation exactly', () => {
  const dem = makeDem(121, hill);
  // Station on the hill side, between cell centres.
  const station = { latitude: dem.centre.lat + 7.3 * RES, longitude: dem.centre.lon + 11.6 * RES };
  const r = predictTraces(dem.grid, dem.elevation, station, [{ strike: 0, dip: 0 }]);
  assert.equal(r.ok, true);
  const z0 = r.stationElevation;
  const verts = vertices(dem, r.traces[0].lines);
  assert.ok(verts.length > 50, `trace has ${verts.length} points`);
  for (const v of verts) assert.ok(Math.abs(v.z - z0) < 1e-6, `point height ${v.z} vs station ${z0}`);

  // And it is the same line an ordinary contouring of (height − station height) gives.
  const shifted = Float64Array.from(dem.elevation, (z) => z - z0);
  const contour = joinSegments(contourSegments(shifted, 121, 121));
  const key = (lines) => lines.flat().map((p) => (Array.isArray(p) ? `${p[0]},${p[1]}` : `${p.col},${p.row}`)).sort().join(';');
  assert.equal(key(r.traces[0].lines), key(contour));
});

test('vertical bed (dip 90) is a straight line along strike, whatever the topography', () => {
  const rough = (x, y) => hill(x, y) + 60 * Math.sin(x / 90) * Math.sin(y / 70);
  const dem = makeDem(121, rough);
  const station = { latitude: dem.centre.lat - 4.2 * RES, longitude: dem.centre.lon + 3.7 * RES };
  const strike = 30;
  const r = predictTraces(dem.grid, dem.elevation, station, [{ strike, dip: 90 }]);
  assert.equal(r.ok, true);
  const s = toUtm(station.latitude, station.longitude, dem.zone);
  const sx = s.easting - dem.origin.easting;
  const sy = s.northing - dem.origin.northing;
  const along = [Math.sin(strike * Math.PI / 180), Math.cos(strike * Math.PI / 180)];
  const verts = vertices(dem, r.traces[0].lines);
  assert.equal(r.traces[0].lines.length, 1, 'one unbroken line');
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  for (const v of verts) {
    const dx = v.x - sx;
    const dy = v.y - sy;
    const off = Math.abs(dx * along[1] - dy * along[0]); // distance from the strike line
    assert.ok(off < 0.01, `point is ${off} m off the strike line`);
    const a = dx * along[0] + dy * along[1];
    minAlong = Math.min(minAlong, a);
    maxAlong = Math.max(maxAlong, a);
  }
  assert.ok(maxAlong - minAlong > 2500, 'line crosses the whole DEM');
});

test('every vertex of an inclined trace lies on the plane', () => {
  const dem = makeDem(121, hill);
  const station = { latitude: dem.centre.lat + 2.5 * RES, longitude: dem.centre.lon - 9.1 * RES };
  for (const [strike, dip] of [[120, 35], [0, 10], [355, 60], [210, 5]]) {
    const r = predictTraces(dem.grid, dem.elevation, station, [{ strike, dip }]);
    assert.equal(r.ok, true);
    const s = toUtm(station.latitude, station.longitude, dem.zone);
    const p0 = [s.easting - dem.origin.easting, s.northing - dem.origin.northing, r.stationElevation];
    const n = planeNormal(strike, dip);
    const verts = vertices(dem, r.traces[0].lines);
    assert.ok(verts.length > 20, `${strike}/${dip}: ${verts.length} points`);
    for (const v of verts) {
      const d = n[0] * (v.x - p0[0]) + n[1] * (v.y - p0[1]) + n[2] * (v.z - p0[2]);
      assert.ok(Math.abs(d) < 0.05, `${strike}/${dip}: point is ${d} m from the plane`);
    }
  }
});

// V-shaped valley running north–south; the stream flows SOUTH (downstream = south).
// Floor rises 5 m per 100 m going north; walls rise 30 m per 100 m away from the axis.
const valley = (x, y) => 1000 + 0.05 * y + 0.3 * Math.abs(x);

/** Compares where the trace crosses the valley axis with where it sits up on the valley sides. */
function vShape(dem, station, strike, dip) {
  const r = predictTraces(dem.grid, dem.elevation, station, [{ strike, dip }]);
  assert.equal(r.ok, true);
  const verts = vertices(dem, r.traces[0].lines);
  const axis = verts.reduce((best, v) => (Math.abs(v.x) < Math.abs(best.x) ? v : best));
  const sides = verts.filter((v) => Math.abs(v.x) > 600);
  assert.ok(sides.length > 10, 'trace reaches both valley sides');
  const sideY = sides.reduce((sum, v) => sum + v.y, 0) / sides.length;
  return { axisY: axis.y, sideY };
}

test('rule of Vs: bed dipping downstream, steeper than the valley floor, Vs downstream', () => {
  const dem = makeDem(161, valley);
  const station = { latitude: dem.centre.lat, longitude: dem.centre.lon }; // on the valley floor
  // Strike 090 with the right-hand rule dips SOUTH (downstream), at 30° ≫ floor gradient (≈ 3°).
  const { axisY, sideY } = vShape(dem, station, 90, 30);
  assert.ok(axisY < sideY - 100, `V should point south: axis at y=${axisY.toFixed(0)}, sides at y=${sideY.toFixed(0)}`);
});

test('rule of Vs: bed dipping upstream Vs upstream', () => {
  const dem = makeDem(161, valley);
  const station = { latitude: dem.centre.lat, longitude: dem.centre.lon };
  // Strike 270 dips NORTH (upstream).
  const { axisY, sideY } = vShape(dem, station, 270, 30);
  assert.ok(axisY > sideY + 100, `V should point north: axis at y=${axisY.toFixed(0)}, sides at y=${sideY.toFixed(0)}`);
});

test('uncertainty attitudes and clear errors', () => {
  const a = uncertaintyAttitudes(358, 2, 3);
  assert.deepEqual(a.map((x) => [x.key, x.strike, x.dip]), [
    ['measured', 358, 2], ['dip-', 358, 0], ['dip+', 358, 5], ['strike-', 355, 2], ['strike+', 1, 2],
  ]);
  assert.equal(a[1].clamped, true);
  assert.equal(uncertaintyAttitudes(10, 89, 3)[2].dip, 90);

  const dem = makeDem(21, hill);
  const outside = predictTraces(dem.grid, dem.elevation, { latitude: 50, longitude: 9 }, [{ strike: 0, dip: 10 }]);
  assert.equal(outside.ok, false);
  assert.match(outside.message, /outside/);
});
