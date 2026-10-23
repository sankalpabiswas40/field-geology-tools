import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEST_STATIONS, frameToEastNorth, placeTestStations } from '../js/geo/test-stations.js';
import { dipDirectionFromStrike } from '../js/geo/attitude.js';
import { toUtm, utmZone } from '../js/geo/utm.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fold-test-stations.json', import.meta.url), 'utf8'));

const azimuthOf = ({ east, north }) => ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;

test('along = 100 m is 100 m away at azimuth 040°', () => {
  const p = frameToEastNorth(100, 0);
  assert.ok(Math.abs(Math.hypot(p.east, p.north) - 100) < 1e-9);
  assert.ok(Math.abs(azimuthOf(p) - 40) < 1e-9);
});

test('across = 100 m is 100 m away at azimuth 130°; negative values point the other way', () => {
  const p = frameToEastNorth(0, 100);
  assert.ok(Math.abs(Math.hypot(p.east, p.north) - 100) < 1e-9);
  assert.ok(Math.abs(azimuthOf(p) - 130) < 1e-9);
  assert.ok(Math.abs(azimuthOf(frameToEastNorth(-100, 0)) - 220) < 1e-9);
  assert.ok(Math.abs(azimuthOf(frameToEastNorth(0, -100)) - 310) < 1e-9);
  const both = frameToEastNorth(300, -450);
  assert.ok(Math.abs(Math.hypot(both.east, both.north) - Math.hypot(300, 450)) < 1e-9, 'axes are at right angles');
});

test('dip directions of the test stations', () => {
  const expected = { S01: 322, S02: 327, S03: 334, S04: 345, S05: 95, S06: 106, S07: 113, S08: 118, S09: 90, S10: 130 };
  for (const s of TEST_STATIONS) assert.equal(dipDirectionFromStrike(s.strike), expected[s.stationId], s.stationId);
});

test('the app\'s test stations and the shared fixture file agree', () => {
  assert.equal(fixture.stations.length, TEST_STATIONS.length);
  fixture.stations.forEach((f, i) => {
    const s = TEST_STATIONS[i];
    for (const k of ['stationId', 'featureType', 'strike', 'dip', 'along', 'across']) assert.equal(s[k], f[k], `${f.stationId} ${k}`);
    assert.equal(dipDirectionFromStrike(s.strike), f.dipDirection, f.stationId);
  });
});

/** A 0.05° × 0.05° DEM around 46.5°N 9.0°E, height = 1000 + row, with optional holes. */
function makeDem(holes = []) {
  const res = 1 / 3600;
  const size = 180;
  const grid = { west: 8.975, north: 46.525, east: 8.975 + size * res, south: 46.525 - size * res, resLon: res, resLat: res, width: size, height: size };
  const elevation = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) elevation[r * size + c] = 1000 + r;
  for (const [r, c] of holes) elevation[r * size + c] = NaN;
  return { grid, elevation };
}

test('test stations are placed at the right distance and direction from the DEM centre', () => {
  const { grid, elevation } = makeDem();
  const { centre, stations, problems } = placeTestStations(grid, elevation);
  assert.deepEqual(problems, []);
  assert.equal(stations.length, 10);
  const zone = utmZone(centre.lat, centre.lon);
  const c = toUtm(centre.lat, centre.lon, zone);
  for (const s of stations) {
    const t = TEST_STATIONS.find((x) => x.stationId === s.stationId);
    const u = toUtm(s.latitude, s.longitude, zone);
    const want = frameToEastNorth(t.along, t.across);
    assert.ok(Math.abs(u.easting - c.easting - want.east) < 0.001, `${s.stationId} east`);
    assert.ok(Math.abs(u.northing - c.northing - want.north) < 0.001, `${s.stationId} north`);
    assert.equal(s.isTest, true);
    assert.equal(s.notes, 'TEST DATA');
    assert.equal(s.lithology, 'test');
    assert.ok(Number.isFinite(s.elevation));
  }
  const s09 = stations.find((s) => s.stationId === 'S09');
  assert.ok(Math.abs(s09.latitude - centre.lat) < 1e-9 && Math.abs(s09.longitude - centre.lon) < 1e-9, 'S09 at the centre');
});

test('a station on missing data or outside the DEM is reported by name, not placed', () => {
  // Put a hole of missing data under S09 (the DEM centre).
  const { grid } = makeDem();
  const mid = grid.width / 2;
  const holes = [[mid - 1, mid - 1], [mid - 1, mid], [mid, mid - 1], [mid, mid]];
  const withHole = makeDem(holes);
  const r1 = placeTestStations(withHole.grid, withHole.elevation);
  assert.equal(r1.stations.length, 9);
  assert.equal(r1.problems.length, 1);
  assert.equal(r1.problems[0].stationId, 'S09');
  assert.match(r1.problems[0].message, /S09.*no data/);

  // A DEM only 1 km wide: the stations 600 m from the centre fall outside it.
  const res = 1 / 3600;
  const small = { west: 9, north: 46.5, east: 9 + 40 * res, south: 46.5 - 30 * res, resLon: res, resLat: res, width: 40, height: 30 };
  const r2 = placeTestStations(small, new Float32Array(40 * 30).fill(500));
  const named = r2.problems.map((p) => p.stationId);
  assert.ok(named.includes('S01') && named.includes('S08'), named.join(','));
  assert.ok(r2.problems.every((p) => p.message.startsWith(`${p.stationId} not added`)));
});
