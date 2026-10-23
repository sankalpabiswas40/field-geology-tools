import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStationInput, nextStationId, localTimeText, normalizeStation, nameSuggestions, dayStationId, lastRealStation, localDayNumber,
} from '../js/geo/station.js';

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
    lineationType: null, trend: null, plunge: null,
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
  assert.equal(n.locationSource, null, 'unknown source is not guessed');
  assert.equal(n.trend, null);
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

test('lineations use trend/plunge and a kind, never strike/dip', () => {
  const lin = { ...good, featureType: 'lineation', strike: '', dip: '', lineationType: 'hinge line', trend: '040', plunge: '15' };
  const r = checkStationInput(lin);
  assert.equal(r.ok, true);
  assert.equal(r.values.trend, 40);
  assert.equal(r.values.plunge, 15);
  assert.equal(r.values.lineationType, 'hinge line');
  assert.equal(r.values.strike, null);
  assert.equal(r.values.dipDirection, null);
  // Strike/dip typed by mistake are ignored for lineations.
  assert.equal(checkStationInput({ ...lin, strike: '400', dip: '95' }).ok, true);
  assert.equal(checkStationInput({ ...lin, trend: '360' }).values.trend, 0);
  assert.equal(checkStationInput({ ...lin, plunge: '0' }).values.plunge, 0);
  assert.equal(checkStationInput({ ...lin, plunge: '90' }).values.plunge, 90);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...lin, trend: '400', plunge: '95' })), ['trend', 'plunge']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...lin, trend: '', plunge: 'abc' })), ['trend', 'plunge']);
  assert.deepEqual(fieldsWithErrors(checkStationInput({ ...lin, lineationType: '' })), ['lineationType']);
  // Planes never keep trend/plunge.
  const plane = checkStationInput({ ...good, trend: '10', plunge: '10', lineationType: 'slickenline' });
  assert.equal(plane.values.trend, null);
  assert.equal(plane.values.lineationType, null);
});

const IST = 330; // India, UTC+05:30
const st = (id, iso, extra = {}) => ({ stationId: id, createdAt: iso, tzOffsetMinutes: IST, ...extra });

test('day-based station IDs: D<day>-<count>', () => {
  // No real stations yet: today is day 1.
  assert.equal(dayStationId([], '2026-11-02T04:00:00Z', IST), 'D1-01');
  // Test stations do not count.
  assert.equal(dayStationId([st('S01', '2026-10-20T04:00:00Z', { isTest: true })], '2026-11-02T04:00:00Z', IST), 'D1-01');
  const field = [
    st('D1-01', '2026-11-02T03:00:00Z'), st('D1-02', '2026-11-02T05:00:00Z'),
    st('D2-01', '2026-11-03T04:00:00Z'),
  ];
  assert.equal(dayStationId(field, '2026-11-02T10:00:00Z', IST), 'D1-03', 'third station on day 1');
  assert.equal(dayStationId(field, '2026-11-03T08:00:00Z', IST), 'D2-02');
  assert.equal(dayStationId(field, '2026-11-05T08:00:00Z', IST), 'D4-01', 'a rest day still counts as a day');
});

test('day IDs use the LOCAL date, not UTC', () => {
  // 2026-11-02 20:00 UTC is already 3 November in India (01:30 local).
  const field = [st('D1-01', '2026-11-02T04:00:00Z')];
  assert.equal(dayStationId(field, '2026-11-02T20:00:00Z', IST), 'D2-01');
  assert.equal(localDayNumber('2026-11-02T20:00:00Z', IST) - localDayNumber('2026-11-02T04:00:00Z', IST), 1);
});

test('day IDs skip numbers already used (e.g. after editing an ID)', () => {
  const field = [st('D1-01', '2026-11-02T03:00:00Z'), st('D1-02', '2026-11-01T03:00:00Z', { isTest: true, stationId: 'D1-02' })];
  assert.equal(dayStationId(field, '2026-11-02T05:00:00Z', IST), 'D1-03');
});

test('"Repeat last" uses the newest real station, never test data', () => {
  const list = [
    st('D1-01', '2026-11-02T03:00:00Z', { featureType: 'bedding' }),
    st('D1-02', '2026-11-02T05:00:00Z', { featureType: 'joint' }),
    st('S01', '2026-11-02T09:00:00Z', { isTest: true, featureType: 'other' }),
  ];
  assert.equal(lastRealStation(list).stationId, 'D1-02');
  assert.equal(lastRealStation([]), null);
});
