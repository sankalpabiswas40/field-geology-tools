// Turns saved stations into CSV, GeoJSON and KML text.
// Pure functions only: no browser code.
//
// A station looks like:
// { stationId, createdAt (UTC ISO), tzOffsetMinutes, latitude, longitude, accuracy,
//   elevation, elevationNote, featureType, strike, dipDirection, dip, younging,
//   lithology, notes, utm: { zone, hemisphere, easting, northing } | null }

import { localTimeText } from './station.js';
import { formatAzimuth, dipDirectionFromStrike } from './attitude.js';

const COLUMNS = [
  ['station_id', (s) => s.stationId],
  ['datetime_utc', (s) => s.createdAt],
  ['datetime_local', (s) => localTimeText(s.createdAt, s.tzOffsetMinutes)],
  ['latitude', (s) => s.latitude],
  ['longitude', (s) => s.longitude],
  ['gps_accuracy_m', (s) => s.accuracy],
  ['dem_elevation_m', (s) => (s.elevation === null ? null : Math.round(s.elevation * 10) / 10)],
  ['elevation_note', (s) => s.elevationNote],
  ['utm_zone', (s) => (s.utm ? `${s.utm.zone}${s.utm.hemisphere}` : null)],
  ['utm_easting', (s) => (s.utm ? Math.round(s.utm.easting) : null)],
  ['utm_northing', (s) => (s.utm ? Math.round(s.utm.northing) : null)],
  ['feature_type', (s) => s.featureType],
  ['strike_rhr', (s) => s.strike],
  ['dip', (s) => s.dip],
  ['dip_direction', (s) => s.dipDirection],
  ['younging_known', (s) => s.younging],
  ['lithology', (s) => s.lithology],
  ['unit_upper_younger', (s) => s.unitUpper],
  ['unit_lower_older', (s) => s.unitLower],
  ['notes', (s) => s.notes],
  // Marks built-in TEST DATA so it can never be confused with real field data.
  ['isTest', (s) => s.isTest === true],
];

/** Properties in the same order and with the same names as the CSV columns. */
function properties(station) {
  const out = {};
  for (const [name, get] of COLUMNS) {
    const v = get(station);
    out[name] = v === undefined ? null : v;
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a header row. Starts with a byte-order mark so Excel reads accents correctly. */
export function stationsToCsv(stations) {
  const rows = [COLUMNS.map(([name]) => name).join(',')];
  for (const s of stations) {
    const p = properties(s);
    rows.push(COLUMNS.map(([name]) => csvCell(p[name])).join(','));
  }
  return `﻿${rows.join('\r\n')}\r\n`;
}

/** GeoJSON FeatureCollection of points (coordinates are [longitude, latitude], WGS84). */
export function stationsToGeoJson(stations) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: stations.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
      properties: properties(s),
    })),
  }, null, 2);
}

function xml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** KML (Google Earth) with one placemark per station and all fields as ExtendedData. */
export function stationsToKml(stations, documentName = 'Field stations') {
  const placemarks = stations.map((s) => {
    const p = properties(s);
    const attitude = s.strike === null ? 'no attitude' : `${s.strike}/${s.dip}, dip direction ${s.dipDirection}`;
    const data = COLUMNS.map(([name]) =>
      `        <Data name="${name}"><value>${xml(p[name])}</value></Data>`).join('\n');
    return [
      '    <Placemark>',
      `      <name>${xml(s.stationId)}</name>`,
      `      <description>${xml(`${s.featureType}: ${attitude}`)}</description>`,
      '      <ExtendedData>',
      data,
      '      </ExtendedData>',
      `      <Point><coordinates>${s.longitude},${s.latitude}</coordinates></Point>`,
      '    </Placemark>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${xml(documentName)}</name>`,
    ...placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

/**
 * KML of predicted outcrop traces.
 * traceSets: [{ stationId, strike, dip, dipDirection, delta, traces: [{ key, label, strike, dip, lines }] }]
 * where each line is an array of { lat, lon } points.
 * KML cannot draw dashed lines, so the uncertainty traces are thinner and see-through instead.
 */
export function tracesToKml(traceSets, documentName = 'Predicted outcrop traces') {
  const warning = 'PREDICTION assuming a perfectly planar surface through the station. ' +
    'Where the real contact does not follow it, that is evidence of folding or faulting.';
  const placemarks = [];
  for (const set of traceSets) {
    for (const t of set.traces) {
      const lines = t.lines.filter((line) => line.length >= 2);
      if (!lines.length) continue;
      const geometry = lines.map((line) =>
        `          <LineString><tessellate>1</tessellate><coordinates>${
          line.map((p) => `${p.lon},${p.lat}`).join(' ')}</coordinates></LineString>`).join('\n');
      const name = `${set.stationId} predicted trace, ${t.label} ` +
        `(${formatAzimuth(t.strike)}/${t.dip}, dip direction ${formatAzimuth(dipDirectionFromStrike(t.strike))})`;
      placemarks.push([
        '    <Placemark>',
        `      <name>${xml(name)}</name>`,
        `      <description>${xml(`${warning} Station ${set.stationId}: measured ${formatAzimuth(set.strike)}/${set.dip} (RHR), uncertainty ±${set.delta}°.`)}</description>`,
        `      <styleUrl>#${t.key === 'measured' ? 'measured' : 'uncertainty'}</styleUrl>`,
        '      <MultiGeometry>',
        geometry,
        '      </MultiGeometry>',
        '    </Placemark>',
      ].join('\n'));
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${xml(documentName)}</name>`,
    `    <description>${xml(warning)}</description>`,
    '    <Style id="measured"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>',
    '    <Style id="uncertainty"><LineStyle><color>990000ff</color><width>1.5</width></LineStyle></Style>',
    ...placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}
