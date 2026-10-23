import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, planRestore, laterExport, storageStatus } from '../js/geo/backup.js';

const station = (uuid, stationId, extra = {}) => ({
  uuid, stationId, createdAt: '2026-11-02T04:00:00.000Z', tzOffsetMinutes: 330,
  latitude: 46.5, longitude: 8.1, featureType: 'bedding', strike: 45, dip: 30, dipDirection: 135, ...extra,
});

test('backup round trip keeps every station and setting', () => {
  const stations = [station('a', 'D1-01'), station('b', 'S01', { isTest: true })];
  const settings = { traceUncertaintyDeg: 4, stereonetArea: [{ lat: 1, lon: 2 }], lastExport: { time: '2026-11-02T15:00:00Z' } };
  const text = JSON.stringify(makeBackup({ stations, settings, createdAt: '2026-11-02T16:00:00Z' }));
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.equal(r.backup.stations.length, 2);
  assert.equal(r.backup.stations[0].strike, 45);
  assert.equal(r.backup.stations[1].isTest, true);
  assert.deepEqual(r.backup.settings, settings);
  assert.match(r.backup.note, /DEM GeoTIFF is NOT included/);
});

test('old-format stations in a backup are brought up to date without losing anything', () => {
  const old = { ...station('a', 'S001') }; // no isTest, unit or lineation fields
  const r = parseBackup(JSON.stringify(makeBackup({ stations: [old], createdAt: 'x' })));
  assert.equal(r.backup.stations[0].isTest, false);
  assert.equal(r.backup.stations[0].trend, null);
  assert.equal(r.backup.stations[0].dipDirection, 135);
});

test('restore never duplicates stations that already exist', () => {
  const here = [station('a', 'D1-01'), station('b', 'D1-02', { stationId: 'D1-02-edited' })];
  const backup = [station('a', 'D1-01'), station('b', 'D1-02'), station('c', 'D1-03'), station('c', 'D1-03'), station('d', 'D1-01')];
  const plan = planRestore(here, backup);
  assert.deepEqual(plan.toAdd.map((s) => s.uuid), ['c', 'd'], 'a and b are already here; c only once');
  assert.equal(plan.alreadyHere, 2);
  assert.deepEqual(plan.idClashes, ['D1-01'], 'd is a different station with an ID already in use');
  // Restoring the same backup twice adds nothing the second time.
  const after = [...here, ...plan.toAdd];
  assert.equal(planRestore(after, backup).toAdd.length, 0);
});

test('bad backup files are refused with a clear message', () => {
  assert.match(parseBackup('not json').message, /could not be read/);
  assert.match(parseBackup('{"format":"something-else"}').message, /not a Field Geology Tools backup/);
  assert.match(parseBackup(JSON.stringify({ format: 'field-geology-tools-backup', version: 99, stations: [] })).message, /newer version/);
  assert.match(parseBackup(JSON.stringify({ format: 'field-geology-tools-backup', version: 1 })).message, /no list of stations/);
  const broken = makeBackup({ stations: [station('a', 'D1-01'), { stationId: 'D1-02', latitude: 'x' }], createdAt: 'x' });
  const r = parseBackup(JSON.stringify(broken));
  assert.equal(r.ok, false);
  assert.match(r.message, /1 station is incomplete \(D1-02\)\. Nothing was restored/);
});

test('the later "last export" time is kept', () => {
  const a = { time: '2026-11-02T15:00:00Z' };
  const b = { time: '2026-11-03T15:00:00Z' };
  assert.equal(laterExport(a, b), b);
  assert.equal(laterExport(b, a), b);
  assert.equal(laterExport(null, a), a);
  assert.equal(laterExport(a, undefined), a);
  assert.equal(laterExport(null, null), null);
});

test('storage status and the "getting full" warning', () => {
  assert.equal(storageStatus(50e6, 2e9).warn, false);
  assert.match(storageStatus(50e6, 2e9).text, /50\.0 MB used of about 2\.0 GB/);
  assert.equal(storageStatus(1.7e9, 2e9).warn, true, 'over 80 % used');
  assert.equal(storageStatus(100e6, 250e6).warn, true, 'less than 200 MB left');
  assert.match(storageStatus(1.7e9, 2e9).text, /WARNING/);
  assert.equal(storageStatus(undefined, undefined).warn, false);
  assert.match(storageStatus(undefined, undefined).text, /does not say/);
});
