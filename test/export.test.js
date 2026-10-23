import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationsToCsv, stationsToGeoJson, stationsToKml, tracesToKml } from '../js/geo/export.js';

const stations = [
  {
    stationId: 'S001', createdAt: '2026-10-23T08:35:00.000Z', tzOffsetMinutes: 330,
    latitude: 46.5444, longitude: -8.0833, accuracy: 6, elevation: 1899.96, elevationNote: null,
    featureType: 'bedding', strike: 45, dip: 30, dipDirection: 135, younging: 'yes',
    lithology: 'sandstone, "red"', notes: 'line one\nline two',
    utm: { zone: 29, hemisphere: 'N', easting: 570000.4, northing: 5154950.6 },
  },
  {
    stationId: 'S<2>', createdAt: '2026-10-23T09:00:00.000Z', tzOffsetMinutes: 330,
    latitude: 46.55, longitude: 8.09, accuracy: null, elevation: null, elevationNote: 'No DEM loaded',
    featureType: 'other', strike: null, dip: null, dipDirection: null, younging: 'unknown',
    lithology: '', notes: '', utm: null,
  },
];

test('CSV has a header, explicit dip direction, and quotes awkward text', () => {
  const csv = stationsToCsv(stations);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0].split(',').length, 18);
  assert.match(lines[0], /strike_rhr,dip,dip_direction/);
  assert.match(lines[1], /^S001,2026-10-23T08:35:00.000Z,2026-10-23 14:05 \(UTC\+05:30\),46.5444,-8.0833,6,1900,,29N,570000,5154951,bedding,45,30,135,yes,/);
  assert.match(csv, /"sandstone, ""red"""/);
  assert.match(csv, /"line one\nline two"/);
  // Empty values stay empty, never "null".
  assert.ok(!csv.includes('null'));
});

test('GeoJSON is longitude-first WGS84 points with all properties', () => {
  const gj = JSON.parse(stationsToGeoJson(stations));
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, 2);
  assert.deepEqual(gj.features[0].geometry, { type: 'Point', coordinates: [-8.0833, 46.5444] });
  assert.equal(gj.features[0].properties.dip_direction, 135);
  assert.equal(gj.features[1].properties.strike_rhr, null);
  assert.equal(gj.features[1].properties.elevation_note, 'No DEM loaded');
});

test('KML has one placemark per station, escaped text, lon,lat coordinates', () => {
  const kml = stationsToKml(stations);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.match(kml, /<coordinates>-8.0833,46.5444<\/coordinates>/);
  assert.match(kml, /<name>S&lt;2&gt;<\/name>/);
  assert.match(kml, /bedding: 45\/30, dip direction 135/);
  assert.match(kml, /other: no attitude/);
  assert.match(kml, /<Data name="dip_direction"><value>135<\/value><\/Data>/);
});

test('trace KML: one placemark per trace, labelled as a prediction', () => {
  const kml = stationsToKmlTraces();
  assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
  assert.match(kml, /PREDICTION assuming a perfectly planar surface/);
  assert.match(kml, /S001 predicted trace, measured \(045\/30, dip direction 135\)/);
  assert.match(kml, /<coordinates>8.1,46.5 8.2,46.6<\/coordinates>/);
  assert.equal((kml.match(/<LineString>/g) || []).length, 3, 'two lines in the measured trace, one dashed');
  assert.ok(!kml.includes('dip −3°, strike'), 'empty trace skipped');
});

function stationsToKmlTraces() {
  const line = [{ lat: 46.5, lon: 8.1 }, { lat: 46.6, lon: 8.2 }];
  return tracesToKml([{
    stationId: 'S001', strike: 45, dip: 30, delta: 3,
    traces: [
      { key: 'measured', label: 'measured', strike: 45, dip: 30, lines: [line, line] },
      { key: 'dip+', label: 'dip +3°', strike: 45, dip: 33, lines: [line] },
      { key: 'dip-', label: 'dip −3°', strike: 45, dip: 27, lines: [] },
    ],
  }]);
}
