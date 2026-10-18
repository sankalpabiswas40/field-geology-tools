// Slope and hillshade for a DEM stored on a geographic (lat/long) grid.
// Cell sizes are converted from degrees to metres row by row BEFORE any slope maths,
// so the gradient is always metres-per-metre.

import { metresPerDegree } from './ellipsoid.js';

const DEG = Math.PI / 180;

/**
 * Horn (1981) gradient from a 3x3 window of elevations (metres).
 *   a b c      (top row is north)
 *   d e f
 *   g h i
 * dx, dy: cell width (east-west) and height (north-south) in metres.
 * Returns dzdx (rise per metre going east) and dzdy (rise per metre going north).
 */
export function hornGradient(win, dx, dy) {
  const [a, b, c, d, , f, g, h, i] = win;
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx);
  const dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * dy);
  return { dzdx, dzdy };
}

/** Slope angle in degrees from a gradient. */
export function slopeDegrees(dzdx, dzdy) {
  return Math.atan(Math.hypot(dzdx, dzdy)) / DEG;
}

/**
 * Brightness (0 = dark, 1 = fully lit) of a surface with the given gradient,
 * lit by a sun at `azimuthDeg` (clockwise from north) and `altitudeDeg` above the horizon.
 * Uses the dot product of the surface normal and the direction to the sun.
 */
export function shadeFromGradient(dzdx, dzdy, azimuthDeg = 315, altitudeDeg = 45) {
  const az = azimuthDeg * DEG;
  const alt = altitudeDeg * DEG;
  const sunEast = Math.sin(az) * Math.cos(alt);
  const sunNorth = Math.cos(az) * Math.cos(alt);
  const sunUp = Math.sin(alt);
  // Surface normal is (-dzdx, -dzdy, 1), normalised.
  const lit = (-dzdx * sunEast - dzdy * sunNorth + sunUp) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
  return lit > 0 ? lit : 0;
}

/**
 * Hillshade for a whole DEM on a regular lat/long grid.
 *
 * grid: {
 *   elevation: Float32Array (row-major, row 0 = north), NaN where there is no data
 *   width, height: number of columns and rows
 *   north: latitude of the north EDGE of the top row (degrees)
 *   resLon, resLat: cell size in degrees (both positive)
 * }
 * Returns Float32Array of brightness 0..1. Cells on the outer border, and cells next to
 * missing data, are NaN because a full 3x3 window is needed.
 */
export function computeHillshade(grid, { azimuthDeg = 315, altitudeDeg = 45 } = {}) {
  const { elevation: z, width: w, height: h, north, resLon, resLat } = grid;
  if (!(resLon > 0 && resLat > 0)) throw new RangeError('Cell size must be positive');
  if (z.length !== w * h) throw new RangeError('Elevation array does not match width × height');

  const out = new Float32Array(w * h).fill(NaN);
  const win = new Array(9);

  for (let r = 1; r < h - 1; r++) {
    // Convert this row's cell size from degrees to metres at the row's centre latitude.
    const lat = north - (r + 0.5) * resLat;
    const m = metresPerDegree(lat);
    const dx = resLon * m.lon; // longitude spacing × cos(latitude), in metres
    const dy = resLat * m.lat;

    for (let col = 1; col < w - 1; col++) {
      let ok = true;
      let k = 0;
      for (let rr = r - 1; rr <= r + 1 && ok; rr++) {
        for (let cc = col - 1; cc <= col + 1; cc++) {
          const v = z[rr * w + cc];
          if (Number.isNaN(v)) { ok = false; break; }
          win[k++] = v;
        }
      }
      if (!ok) continue;
      const { dzdx, dzdy } = hornGradient(win, dx, dy);
      out[r * w + col] = shadeFromGradient(dzdx, dzdy, azimuthDeg, altitudeDeg);
    }
  }
  return out;
}
