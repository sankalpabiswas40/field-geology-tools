import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStationInput, nextStationId, localTimeText } from '../js/geo/station.js';

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
    lithology: 'sandstone', notes: 'cross-bedded',
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
