// Field station data: checking what was typed in the form, and station numbering.
// Pure functions only: no browser code.

import { parseNumber, checkStrike, checkDip, dipDirectionFromStrike } from './attitude.js';

export const FEATURE_TYPES = ['bedding', 'foliation', 'joint', 'fault', 'vein', 'other'];
export const YOUNGING_OPTIONS = ['yes', 'no', 'unknown'];

/**
 * Checks the station form. `input` holds the raw text from each box:
 *   { stationId, latitude, longitude, accuracy, featureType, strike, dip, younging, lithology, notes }
 * `otherIds` are the IDs of all OTHER stations (to stop duplicates).
 * Returns { ok: true, values } or { ok: false, errors: [{ field, message }] }.
 * Strike and dip are required, except for feature type "other" where both may be left empty.
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
  const strikeEmpty = parseNumber(input.strike) === null;
  const dipEmpty = parseNumber(input.dip) === null;
  if (featureType === 'other' && strikeEmpty && dipEmpty) {
    // No attitude measured: allowed for "other" only.
  } else if (featureType === 'other' && strikeEmpty !== dipEmpty) {
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
