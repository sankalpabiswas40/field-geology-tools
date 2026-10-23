// Phase 7 safety check: bad input on every form is refused with a clear message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStationInput } from '../js/geo/station.js';
import { checkUncertainty, predictTraces } from '../js/geo/trace.js';
import { elevationAt, gridFromGeoTiff } from '../js/geo/raster.js';
import { placeTestStations } from '../js/geo/test-stations.js';

const plane = {
  stationId: 'D1-01', latitude: '46.5', longitude: '8.1', accuracy: '5', featureType: 'bedding',
  strike: '045', dip: '30', younging: 'unknown', lithology: '', notes: '',
};
const line = { ...plane, featureType: 'lineation', strike: '', dip: '', lineationType: 'hinge line', trend: '040', plunge: '15' };
const errs = (input) => {
  const r = checkStationInput(input);
  return r.ok ? [] : r.errors.map((e) => e.field);
};

test('station form: every required field left empty is reported', () => {
  const empty = { stationId: '', latitude: '', longitude: '', accuracy: '', featureType: '', strike: '', dip: '', younging: '', lithology: '', notes: '' };
  // With no feature type chosen, strike and dip count as required too.
  assert.deepEqual(errs(empty), ['stationId', 'latitude', 'featureType', 'strike', 'dip', 'younging']);
  assert.deepEqual(errs({ ...plane, strike: '', dip: '' }), ['strike', 'dip']);
  assert.deepEqual(errs({ ...line, trend: '', plunge: '' }), ['trend', 'plunge']);
  assert.deepEqual(errs({ ...line, lineationType: '' }), ['lineationType']);
  assert.deepEqual(errs({ ...plane, lithology: '', notes: '' }), [], 'lithology and notes are optional');
});

test('station form: letters in number fields are refused', () => {
  for (const [fieldName, form] of [['latitude', plane], ['longitude', plane], ['accuracy', plane], ['strike', plane], ['dip', plane], ['trend', line], ['plunge', line]]) {
    const r = checkStationInput({ ...form, [fieldName]: 'abc' });
    assert.equal(r.ok, false, fieldName);
    assert.equal(r.errors[0].field, fieldName);
    assert.match(r.errors[0].message, /not a number/, fieldName);
  }
  assert.equal(checkStationInput({ ...plane, strike: '45°' }).ok, false, 'degree sign');
  assert.equal(checkStationInput({ ...plane, dip: '3O' }).ok, false, 'letter O instead of zero');
});

test('strike 0 and strike 360 are the same plane', () => {
  const a = checkStationInput({ ...plane, strike: '0' }).values;
  const b = checkStationInput({ ...plane, strike: '360' }).values;
  assert.equal(a.strike, 0);
  assert.equal(b.strike, 0);
  assert.equal(a.dipDirection, 90);
  assert.equal(b.dipDirection, 90);
  assert.equal(checkStationInput({ ...plane, strike: '360.5' }).ok, false);
});

test('dip 0 and 90, plunge 0 and 90 are accepted; just outside is refused', () => {
  assert.equal(checkStationInput({ ...plane, dip: '0' }).values.dip, 0);
  assert.equal(checkStationInput({ ...plane, dip: '90' }).values.dip, 90);
  assert.equal(checkStationInput({ ...plane, dip: '90.1' }).ok, false);
  assert.equal(checkStationInput({ ...plane, dip: '-0.1' }).ok, false);
  assert.equal(checkStationInput({ ...line, plunge: '0' }).values.plunge, 0);
  assert.equal(checkStationInput({ ...line, plunge: '90' }).values.plunge, 90);
  assert.equal(checkStationInput({ ...line, plunge: '90.1' }).ok, false);
  assert.equal(checkStationInput({ ...line, trend: '360' }).values.trend, 0);
});

test('impossible coordinates are refused', () => {
  assert.deepEqual(errs({ ...plane, latitude: '91' }), ['latitude']);
  assert.deepEqual(errs({ ...plane, longitude: '181' }), ['longitude']);
  assert.deepEqual(errs({ ...plane, accuracy: '-1' }), ['accuracy']);
});

test('trace uncertainty setting', () => {
  assert.deepEqual(checkUncertainty('3'), { ok: true, value: 3 });
  assert.deepEqual(checkUncertainty('2,5'), { ok: true, value: 2.5 });
  for (const bad of ['', '0', '-3', '21', 'three']) assert.equal(checkUncertainty(bad).ok, false, bad);
});

test('stations outside the DEM: no elevation, no trace, test stations named', () => {
  const res = 1 / 3600;
  const grid = gridFromGeoTiff({ originX: 8, originY: 46.6, resX: res, resY: -res, width: 60, height: 60, rasterType: 1 });
  const elevation = new Float32Array(3600).fill(1000);
  const outside = elevationAt(grid, elevation, 47, 8.01);
  assert.equal(outside.ok, false);
  assert.match(outside.message, /outside the loaded DEM/);
  const trace = predictTraces(grid, elevation, { latitude: 47, longitude: 8.01 }, [{ strike: 0, dip: 30 }]);
  assert.equal(trace.ok, false);
  assert.match(trace.message, /No DEM elevation at the station/);
  // A DEM only ~850 m × 930 m: S01 (460 m west of the centre) and others fall outside.
  const small = gridFromGeoTiff({ originX: 8, originY: 46.6, resX: res, resY: -res, width: 40, height: 30, rasterType: 1 });
  const placed = placeTestStations(small, new Float32Array(1200).fill(1000));
  assert.ok(placed.problems.some((p) => p.stationId === 'S01'));
  assert.ok(placed.problems.length > 0);
  for (const p of placed.problems) assert.match(p.message, new RegExp(`^${p.stationId} not added`));
});
