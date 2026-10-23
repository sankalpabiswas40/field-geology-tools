// Outcrop trace prediction: where a planar surface through a station meets the ground.
//
// 1. Station and every DEM cell centre are converted to UTM metres (the station's zone),
//    with height from the DEM, giving East-North-Up points.
// 2. The plane's unit normal comes from strike and dip (right-hand rule).
// 3. For each cell: signed distance = normal · (cell point − station point).
// 4. Marching squares traces where that distance is zero: the predicted trace.
//
// This ASSUMES THE SURFACE IS A PERFECT PLANE. Pure functions only: no browser code.

import { toUtm, utmZone } from './utm.js';
import { planeNormal } from './plane.js';
import { contourBand, joinSegments } from './contour.js';
import { elevationAt } from './raster.js';
import { normalizeAzimuth } from './attitude.js';

/** Grid position (col, row) → { lat, lon }; (0, 0) is the centre of the top-left cell. */
export function gridToLatLon(grid, col, row) {
  return {
    lat: grid.north - (row + 0.5) * grid.resLat,
    lon: grid.west + (col + 0.5) * grid.resLon,
  };
}

/**
 * The attitudes to trace: the measured one, plus dip ± delta and strike ± delta.
 * Dip is kept within 0–90°; `clamped` says when that happened.
 */
export function uncertaintyAttitudes(strike, dip, delta) {
  const clampDip = (d) => Math.min(90, Math.max(0, d));
  return [
    { key: 'measured', label: 'measured', strike, dip },
    { key: 'dip-', label: `dip −${delta}°`, strike, dip: clampDip(dip - delta), clamped: dip - delta < 0 },
    { key: 'dip+', label: `dip +${delta}°`, strike, dip: clampDip(dip + delta), clamped: dip + delta > 90 },
    { key: 'strike-', label: `strike −${delta}°`, strike: normalizeAzimuth(strike - delta), dip },
    { key: 'strike+', label: `strike +${delta}°`, strike: normalizeAzimuth(strike + delta), dip },
  ];
}

/**
 * Predicts outcrop traces.
 *   grid, elevation: the DEM (see raster.js), elevation is a Float32Array with NaN for no data
 *   station: { latitude, longitude }
 *   attitudes: [{ strike, dip, ... }, ...] — all traced in one pass over the DEM
 * Returns { ok: true, stationElevation, zone, traces: [{ ...attitude, lines }] }, where each
 * line is an array of { col, row, lat, lon } points; or { ok: false, message }.
 */
export function predictTraces(grid, elevation, station, attitudes) {
  const { latitude: lat0, longitude: lon0 } = station;
  const here = elevationAt(grid, elevation, lat0, lon0);
  if (!here.ok) return { ok: false, message: `No DEM elevation at the station: ${here.message}` };

  let zone;
  try {
    zone = utmZone(lat0, lon0);
  } catch (e) {
    return { ok: false, message: e.message };
  }
  const s = toUtm(lat0, lon0, zone);
  const p0 = [s.easting, s.northing, here.elevation];
  const normals = attitudes.map((a) => planeNormal(a.strike, a.dip));

  const { width: w, height: h } = grid;
  const k = normals.length;
  // Only two rows of distances are kept at a time, so memory stays small even for big DEMs.
  let prev = normals.map(() => new Float64Array(w));
  let curr = normals.map(() => new Float64Array(w));
  const segments = normals.map(() => []);
  const emitters = segments.map((list) => (x1, y1, x2, y2) => list.push([x1, y1, x2, y2]));

  for (let r = 0; r < h; r++) {
    const lat = grid.north - (r + 0.5) * grid.resLat;
    for (let c = 0; c < w; c++) {
      const z = elevation[r * w + c];
      if (Number.isNaN(z)) {
        for (let i = 0; i < k; i++) curr[i][c] = NaN;
        continue;
      }
      const u = toUtm(lat, grid.west + (c + 0.5) * grid.resLon, zone);
      const dx = u.easting - p0[0];
      const dy = u.northing - p0[1];
      const dz = z - p0[2];
      for (let i = 0; i < k; i++) {
        const n = normals[i];
        curr[i][c] = n[0] * dx + n[1] * dy + n[2] * dz;
      }
    }
    if (r > 0) for (let i = 0; i < k; i++) contourBand(prev[i], curr[i], r - 1, w, emitters[i]);
    [prev, curr] = [curr, prev];
  }

  const traces = attitudes.map((a, i) => ({
    ...a,
    lines: joinSegments(segments[i]).map((line) =>
      line.map(([col, row]) => ({ col, row, ...gridToLatLon(grid, col, row) }))),
  }));
  return { ok: true, stationElevation: here.elevation, zone, traces };
}
