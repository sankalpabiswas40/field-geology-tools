// Field station data: checking what was typed in the form, and station numbering.
// Pure functions only: no browser code.

import { parseNumber, checkStrike, checkDip, checkTrend, checkPlunge, dipDirectionFromStrike } from './attitude.js';

export const FEATURE_TYPES = ['bedding', 'foliation', 'joint', 'fault', 'vein', 'contact', 'lineation', 'other'];
export const LINEATION_TYPES = ['hinge line', 'intersection lineation', 'mineral lineation', 'slickenline', 'other'];

/** Feature types where strike and dip may be left empty (both together). */
export const ATTITUDE_OPTIONAL = ['contact', 'other'];
export const YOUNGING_OPTIONS = ['yes', 'no', 'unknown'];

/**
 * Checks the station form. `input` holds the raw text from each box:
 *   { stationId, latitude, longitude, accuracy, featureType, strike, dip, younging, lithology, notes,
 *     unitUpper, unitLower,      (the two unit names are used for contacts only)
 *     lineationType, trend, plunge }   (used for lineations only, instead of strike and dip)
 * `otherIds` are the IDs of all OTHER stations (to stop duplicates).
 * Returns { ok: true, values } or { ok: false, errors: [{ field, message }] }.
 * Strike and dip are required, except for "contact" and "other" where both may be left empty.
 */
export function checkStationInput(input, otherIds = []) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const stationId = String(input.stationId ?? '').trim();
  if (!stationId) add('stationId', 'Station ID is missing.');
  else if (otherIds.includes(stationId)) add('stationId', `Station ID "${stationId}" is already used by another station.`);

  const lat = parseNumber(input.latitude);
  const lon = parseNumber(input.longitude);
  if (lat === null && lon === null) {
    add('latitude', 'Location is missing. Tap "Use my location" or type the latitude and longitude.');
  } else {
    if (lat === null) add('latitude', 'Latitude is missing.');
    else if (Number.isNaN(lat)) add('latitude', `Latitude "${input.latitude}" is not a number (use decimal degrees, e.g. 46.5432).`);
    else if (lat < -90 || lat > 90) add('latitude', `Latitude ${lat} is not possible: it must be between −90 and 90.`);
    if (lon === null) add('longitude', 'Longitude is missing.');
    else if (Number.isNaN(lon)) add('longitude', `Longitude "${input.longitude}" is not a number (use decimal degrees, e.g. 8.0833).`);
    else if (lon < -180 || lon > 180) add('longitude', `Longitude ${lon} is not possible: it must be between −180 and 180.`);
  }

  const accuracy = parseNumber(input.accuracy);
  if (Number.isNaN(accuracy)) add('accuracy', `GPS accuracy "${input.accuracy}" is not a number.`);
  else if (accuracy !== null && accuracy < 0) add('accuracy', 'GPS accuracy cannot be negative.');

  const featureType = input.featureType;
  if (!FEATURE_TYPES.includes(featureType)) add('featureType', 'Choose a feature type.');

  let strike = null;
  let dip = null;
  let trend = null;
  let plunge = null;
  let lineationType = null;
  if (featureType === 'lineation') {
    if (!LINEATION_TYPES.includes(input.lineationType)) add('lineationType', 'Choose the kind of lineation.');
    else lineationType = input.lineationType;
    const t = checkTrend(input.trend);
    if (t.ok) trend = t.value; else add('trend', t.message);
    const p = checkPlunge(input.plunge);
    if (p.ok) plunge = p.value; else add('plunge', p.message);
  }
  const strikeEmpty = parseNumber(input.strike) === null;
  const dipEmpty = parseNumber(input.dip) === null;
  const optional = ATTITUDE_OPTIONAL.includes(featureType);
  if (featureType === 'lineation') {
    // Lineations use trend and plunge (checked above), never strike and dip.
  } else if (optional && strikeEmpty && dipEmpty) {
    // No attitude measured: allowed for contacts and "other".
  } else if (optional && strikeEmpty !== dipEmpty) {
    add(strikeEmpty ? 'strike' : 'dip', 'Give both strike and dip, or leave both empty.');
  } else {
    const s = checkStrike(input.strike);
    if (s.ok) strike = s.value; else add('strike', s.message);
    const d = checkDip(input.dip);
    if (d.ok) dip = d.value; else add('dip', d.message);
  }

  const younging = input.younging;
  if (!YOUNGING_OPTIONS.includes(younging)) add('younging', 'Choose whether the younging direction is known.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    values: {
      stationId,
      latitude: lat,
      longitude: lon,
      accuracy,
      featureType,
      strike,
      dip,
      dipDirection: strike === null ? null : dipDirectionFromStrike(strike),
      younging,
      lithology: String(input.lithology ?? '').trim(),
      notes: String(input.notes ?? '').trim(),
      unitUpper: featureType === 'contact' ? String(input.unitUpper ?? '').trim() || null : null,
      unitLower: featureType === 'contact' ? String(input.unitLower ?? '').trim() || null : null,
      lineationType,
      trend,
      plunge,
    },
  };
}

/**
 * Suggests the next station ID by adding 1 to the number at the end of the last ID,
 * keeping its prefix and zero-padding (S009 → S010, KD-7 → KD-8). Skips IDs already used.
 * With no last ID (or one without a number) it starts at S001.
 */
export function nextStationId(lastId, existingIds = []) {
  const m = /^(.*?)(\d+)$/.exec(String(lastId ?? '').trim());
  let prefix = 'S';
  let n = 1;
  let width = 3;
  if (m) {
    prefix = m[1];
    n = Number(m[2]) + 1;
    width = m[2].length;
  }
  const used = new Set(existingIds);
  let id;
  do {
    id = prefix + String(n).padStart(width, '0');
    n++;
  } while (used.has(id));
  return id;
}

/** Local date-time text like "2026-10-23 14:05" from a UTC ISO time and the offset in minutes east of UTC. */
export function localTimeText(isoUtc, offsetMinutes) {
  const t = new Date(Date.parse(isoUtc) + offsetMinutes * 60000);
  const p = (v) => String(v).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '−';
  const abs = Math.abs(offsetMinutes);
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ` +
    `${p(t.getUTCHours())}:${p(t.getUTCMinutes())} (UTC${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)})`;
}

/**
 * Fields added to stations after the first version, with the value an older station gets
 * when it has no such field. Nothing that is already stored is ever changed or removed.
 */
export const NEW_FIELD_DEFAULTS = {
  unitUpper: null,
  unitLower: null,
  lineationType: null,
  trend: null,
  plunge: null,
  isTest: false,
};

/** Brings a saved station of any older format up to date by adding missing fields only. */
export function normalizeStation(record) {
  const out = { ...record };
  for (const [key, value] of Object.entries(NEW_FIELD_DEFAULTS)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Names already used for lithology and contact units, for the suggestion list, so spelling
 * stays consistent. Case-insensitive duplicates are merged (the most used spelling wins).
 * Test data is left out. Sorted alphabetically.
 */
export function nameSuggestions(stations) {
  const counts = new Map(); // lower-case → Map(spelling → count)
  for (const s of stations) {
    if (s.isTest === true) continue;
    for (const v of [s.lithology, s.unitUpper, s.unitLower]) {
      const name = String(v ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!counts.has(key)) counts.set(key, new Map());
      const spellings = counts.get(key);
      spellings.set(name, (spellings.get(name) || 0) + 1);
    }
  }
  const names = [...counts.values()].map((spellings) =>
    [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
