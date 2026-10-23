import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStationInput, nextStationId, localTimeText, normalizeStation, nameSuggestions } from '../js/geo/station.js';

const good = {
  stationId: 'S001', latitude: '46.5444', longitude: '8.0833', accuracy: '6',
  featureType: 'bedding', strike: '045', dip: '30', younging: 'unknown',
  lithology: ' sandstone ', notes: 'cross-bedded',
};

const fieldsWithErrors = (r) => r.errors.map((e) => e.field);

test('a complete, valid station is accepted and dip direction is stored', () => {
  const r = checkStationInput(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, {
    stationId: 'S001', latitude: 46.5444, longitude: 8.0833, accuracy: 6,
    featureType: 'bedding', strike: 45, dip: 30, dipDirection: 135, younging: 'unknown',
    lithology: 'sandstone', notes: 'cross-bedded', unitUpper: null, unitLower: null,
  });
});

test('impossible strike and dip are rejected with clear messages', () => {
  const r = checkStationInput({ ...good, strike: '400', dip: '95' });
  assert.equal(r.ok, false);
  assert.deepEqual(fieldsWithErrors(r), ['strike', 'dip']);
  assert.match(r.errors[0].message, /400°/);
  assert.match(r.errors[1].message, /95°/);
});

test('missing location is rejected', () => {
  const r = checkStationInput({ ...good, latitude: '', longitude: ' ' });
  assert.equal(r.ok, false);
  assert.deepEqual(fieldsWithErrors(r), ['latitude']);
  assert.match(r.errors[0].message, /Location is missing/);
});

test('half a location or out-of-range coordinates are rejected', () => {
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, longitude: '' })), ['longitude']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, latitude: '91' })), ['latitude']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, longitude: '-181' })), ['longitude']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, latitude: 'N46' })), ['latitude']);
});

test('accuracy may be empty (typed location) but not negative', () => {
  const r = checkStationInput({ ...good, accuracy: '' });
  assert.equal(r.ok, true);
  assert.equal(r.values.accuracy, null);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, accuracy: '-2' })), ['accuracy']);
});

test('feature type, younging and station ID are required; IDs must be unique', () => {
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, featureType: '' })), ['featureType']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, younging: undefined })), ['younging']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, stationId: '  ' })), ['stationId']);
  const dup = checkStationInput(good, ['S001', 'S002']);
  assert.match(dup.errors[0].message, /already used/);
});

test('strike and dip are required, except both may be empty for "other"', () => {
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, strike: '', dip: '' })), ['strike', 'dip']);
  const other = checkStationInput({ ...good, featureType: 'other', strike: '', dip: '' });
  assert.equal(other.ok, true);
  assert.equal(other.values.strike, null);
  assert.equal(other.values.dipDirection, null);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, featureType: 'other', strike: '10', dip: '' })), ['dip']);
});

test('strike 360 is stored as 000 with dip direction 090', () => {
  const r = checkStationInput({ ...good, strike: '360' });
  assert.equal(r.values.strike, 0);
  assert.equal(r.values.dipDirection, 90);
});

test('next station ID keeps prefix and padding and skips used IDs', () => {
  assert.equal(nextStationId(null), 'S001');
  assert.equal(nextStationId('S009'), 'S010');
  assert.equal(nextStationId('KD-7'), 'KD-8');
  assert.equal(nextStationId('S099', ['S100', 'S101']), 'S102');
  assert.equal(nextStationId('quarry', ['S001']), 'S002');
});

test('local time text', () => {
  assert.equal(localTimeText('2026-10-23T08:35:00.000Z', 330), '2026-10-23 14:05 (UTC+05:30)');
  assert.equal(localTimeText('2026-10-23T00:10:00.000Z', -60), '2026-10-22 23:10 (UTC−01:00)');
});

test('contacts: strike/dip optional (both or neither), unit names kept and trimmed', () => {
  const c = checkStationInput({ ...good, featureType: 'contact', strike: '', dip: '', unitUpper: ' Red sandstone ', unitLower: 'Grey shale' });
  assert.equal(c.ok, true);
  assert.equal(c.values.strike, null);
  assert.equal(c.values.unitUpper, 'Red sandstone');
  assert.equal(c.values.unitLower, 'Grey shale');
  const withAttitude = checkStationInput({ ...good, featureType: 'contact', unitUpper: '', unitLower: '' });
  assert.equal(withAttitude.values.dipDirection, 135);
  assert.equal(withAttitude.values.unitUpper, null, 'empty unit stored as null');
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, featureType: 'contact', strike: '10', dip: '' })), ['dip']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...good, featureType: 'contact', strike: '10', dip: '95' })), ['dip']);
});

test('unit names are only stored for contacts', () => {
  const r = checkStationInput({ ...good, unitUpper: 'left over from a contact', unitLower: 'x' });
  assert.equal(r.values.unitUpper, null);
  assert.equal(r.values.unitLower, null);
});

test('old-format stations survive: missing new fields are added, nothing is changed or lost', () => {
  // A station exactly as the app saved it before contacts, lineations and test data existed.
  const old = {
    uuid: 'a1b2', stationId: 'S001', createdAt: '2026-10-23T08:35:00.000Z', tzOffsetMinutes: 330, updatedAt: null,
    latitude: 46.5444, longitude: 8.0833, accuracy: 6, featureType: 'bedding', strike: 45, dip: 30, dipDirection: 135,
    younging: 'unknown', lithology: 'sandstone', notes: 'x', elevation: 1900, elevationNote: null,
    elevationDem: 'dem.tif', utm: { zone: 32, hemisphere: 'N', easting: 429720, northing: 5154950 },
  };
  const frozen = structuredClone(old);
  const n = normalizeStation(old);
  for (const [k, v] of Object.entries(frozen)) assert.deepEqual(n[k], v, `field ${k} kept`);
  assert.equal(n.unitUpper, null);
  assert.equal(n.isTest, false);
  assert.deepEqual(old, frozen, 'the original record object is not modified');
  // Values that are already there win over defaults.
  assert.equal(normalizeStation({ ...old, isTest: true }).isTest, true);
  // Running it twice changes nothing.
  assert.deepEqual(normalizeStation(n), n);
});

test('name suggestions: unique, consistent spelling, no test data, sorted', () => {
  const list = nameSuggestions([
    { lithology: 'Sandstone' }, { lithology: 'sandstone' }, { lithology: 'Sandstone ' },
    { lithology: 'Granite', unitUpper: 'Upper Shale', unitLower: 'basalt' },
    { lithology: 'test', isTest: true }, { lithology: '' }, { lithology: null },
  ]);
  assert.deepEqual(list, ['basalt', 'Granite', 'Sandstone', 'Upper Shale']);
});
