import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { utmZone, centralMeridian, toUtm, fromUtm } from '../js/geo/utm.js';

// proj4js (vendored) is the reference we check our UTM maths against.
const proj4 = createRequire(import.meta.url)('../vendor/proj4/proj4.js');

test('zone is chosen from longitude', () => {
  assert.equal(utmZone(0, -180), 1);
  assert.equal(utmZone(0, -177.1), 1);
  assert.equal(utmZone(0, 0), 31);
  assert.equal(utmZone(0, 179.9), 60);
  assert.equal(utmZone(0, 180), 60);
  assert.equal(utmZone(51.5, -0.1), 30);
  assert.equal(centralMeridian(31), 3);
});

test('zone exceptions for Norway and Svalbard', () => {
  assert.equal(utmZone(60, 5), 32); // Bergen: would be 31 by longitude alone
  assert.equal(utmZone(78, 15), 33); // Svalbard
  assert.equal(utmZone(78, 8), 31);
});

test('outside UTM latitude range throws', () => {
  assert.throws(() => utmZone(85, 0), RangeError);
  assert.throws(() => utmZone(-81, 0), RangeError);
});

test('point on the central meridian at the equator', () => {
  const u = toUtm(0, 3);
  assert.equal(u.zone, 31);
  assert.ok(Math.abs(u.easting - 500000) < 1e-6);
  assert.ok(Math.abs(u.northing) < 1e-6);
});

test('southern hemisphere uses a 10 000 000 m false northing', () => {
  const u = toUtm(-0.000001, 3);
  assert.equal(u.hemisphere, 'S');
  assert.ok(Math.abs(u.northing - 10000000) < 1);
});

test('matches proj4js to within 1 mm across the globe', () => {
  for (let lat = -79; lat <= 83; lat += 7.3) {
    for (let lon = -179; lon <= 179; lon += 13.7) {
      const u = toUtm(lat, lon);
      const def = `+proj=utm +zone=${u.zone}${u.hemisphere === 'S' ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
      const [e, n] = proj4('EPSG:4326', def, [lon, lat]);
      assert.ok(Math.abs(u.easting - e) < 0.001, `easting at ${lat},${lon}: ${u.easting} vs ${e}`);
      assert.ok(Math.abs(u.northing - n) < 0.001, `northing at ${lat},${lon}: ${u.northing} vs ${n}`);
    }
  }
});

test('UTM → lat/long matches proj4js and round-trips to well under 1 mm', () => {
  for (let lat = -79; lat <= 83; lat += 7.3) {
    for (let lon = -179; lon <= 179; lon += 13.7) {
      const u = toUtm(lat, lon);
      const back = fromUtm(u.easting, u.northing, u.zone, u.hemisphere);
      assert.ok(Math.abs(back.lat - lat) < 1e-9, `lat ${lat},${lon} → ${back.lat}`);
      assert.ok(Math.abs(back.lon - lon) < 1e-9, `lon ${lat},${lon} → ${back.lon}`);
      const def = `+proj=utm +zone=${u.zone}${u.hemisphere === 'S' ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
      const [plon, plat] = proj4(def, 'EPSG:4326', [u.easting, u.northing]);
      assert.ok(Math.abs(plat - lat) < 1e-8 && Math.abs(plon - lon) < 1e-8, `proj4 at ${lat},${lon}`);
    }
  }
});
