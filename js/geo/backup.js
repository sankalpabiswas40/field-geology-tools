// Backup and restore of ALL stations and settings as one JSON file, plus the storage check.
// Pure functions only: no browser code.

import { normalizeStation } from './station.js';

export const BACKUP_FORMAT = 'field-geology-tools-backup';
export const BACKUP_VERSION = 1;

/**
 * Builds the backup object. stations: every saved station (test data included, still marked).
 * settings: { traceUncertaintyDeg, stereonetArea, lastExport } (any may be missing).
 */
export function makeBackup({ stations, settings, createdAt }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    note: 'Field Geology Tools backup: every station and setting. The DEM GeoTIFF is NOT included.',
    stationCount: stations.length,
    stations,
    settings: settings || {},
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Reads a backup file's text. Returns { ok: true, backup } with stations brought up to date,
 * or { ok: false, message } explaining what is wrong. Nothing is changed on the device here.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This file is not a backup: it could not be read as JSON.' };
  }
  if (!data || data.format !== BACKUP_FORMAT) {
    return { ok: false, message: 'This file is not a Field Geology Tools backup.' };
  }
  if (!Number.isInteger(data.version) || data.version > BACKUP_VERSION) {
    return { ok: false, message: `This backup was made by a newer version of the app (format ${data.version}). Update the app first.` };
  }
  if (!Array.isArray(data.stations)) {
    return { ok: false, message: 'The backup has no list of stations.' };
  }
  const bad = [];
  data.stations.forEach((s, i) => {
    const ok = s && typeof s === 'object' && typeof s.uuid === 'string' && s.uuid &&
      typeof s.stationId === 'string' && isNum(s.latitude) && isNum(s.longitude) &&
      typeof s.featureType === 'string' && typeof s.createdAt === 'string';
    if (!ok) bad.push(s && s.stationId ? s.stationId : `number ${i + 1}`);
  });
  if (bad.length) {
    return {
      ok: false,
      message: `The backup is damaged: ${bad.length} station${bad.length === 1 ? ' is' : 's are'} incomplete ` +
        `(${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', …' : ''}). Nothing was restored.`,
    };
  }
  return {
    ok: true,
    backup: { ...data, stations: data.stations.map(normalizeStation), settings: data.settings || {} },
  };
}

/**
 * Decides what a restore will do, WITHOUT duplicating stations that already exist.
 * A station is "the same" when it has the same internal uuid (it never changes, even if the
 * station ID is edited). Returns:
 *   toAdd:      stations from the backup that are not on this device
 *   alreadyHere: how many backup stations are already on this device (skipped, device copy kept)
 *   idClashes:  station IDs in toAdd that a DIFFERENT station on this device already uses
 */
export function planRestore(existing, incoming) {
  const have = new Set(existing.map((s) => s.uuid));
  const seen = new Set();
  const toAdd = [];
  let alreadyHere = 0;
  for (const s of incoming) {
    if (have.has(s.uuid)) { alreadyHere++; continue; }
    if (seen.has(s.uuid)) continue; // the same station twice inside the backup
    seen.add(s.uuid);
    toAdd.push(s);
  }
  const ids = new Set(existing.map((s) => s.stationId));
  const idClashes = toAdd.filter((s) => ids.has(s.stationId)).map((s) => s.stationId);
  return { toAdd, alreadyHere, idClashes };
}

/** The later of two "last export" records ({ time }), or whichever exists. */
export function laterExport(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b.time) > Date.parse(a.time) ? b : a;
}

/**
 * Plain-language storage status from navigator.storage.estimate() numbers (bytes).
 * Warns when more than 80 % is used or less than 200 MB is left.
 */
export function storageStatus(usage, quota) {
  if (!isNum(usage) || !isNum(quota) || quota <= 0) {
    return { warn: false, text: 'This device does not say how much storage is free.' };
  }
  const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);
  const share = usage / quota;
  const left = quota - usage;
  const warn = share > 0.8 || left < 200e6;
  const text = `Storage: ${mb(usage)} used of about ${mb(quota)} available to this app (${Math.round(share * 100)} %).` +
    (warn ? ' WARNING: the device is getting full. Export and back up now, and free some space.' : '');
  return { warn, text };
}
