// Planes in 3-D, in East-North-Up (ENU) metres.
// x = east, y = north, z = up. Pure functions only: no browser code.

import { normalizeAzimuth, dipDirectionFromStrike } from './attitude.js';

const DEG = Math.PI / 180;

/**
 * Upward unit normal of a plane from its RHR strike and dip (degrees).
 * The normal leans towards the dip direction:
 *   n = (sin(dip)·sin(dipDir), sin(dip)·cos(dipDir), cos(dip))
 * Check: a horizontal plane gives (0, 0, 1); a plane dipping 45° east gives (0.707, 0, 0.707).
 */
export function planeNormal(strike, dip) {
  const dd = dipDirectionFromStrike(strike) * DEG;
  const d = dip * DEG;
  return [Math.sin(d) * Math.sin(dd), Math.sin(d) * Math.cos(dd), Math.cos(d)];
}

/**
 * Strike (RHR), dip and dip direction from a plane normal (any length, either sense).
 * A horizontal plane has no strike or dip direction: those come back as null.
 */
export function attitudeFromNormal(n) {
  let [x, y, z] = n;
  const len = Math.hypot(x, y, z);
  if (!(len > 0)) throw new RangeError('A plane normal cannot be zero length.');
  x /= len; y /= len; z /= len;
  if (z < 0) { x = -x; y = -y; z = -z; } // use the upward normal
  const horizontal = Math.hypot(x, y);
  const dip = Math.atan2(horizontal, z) / DEG;
  if (horizontal < 1e-12) return { strike: null, dip: 0, dipDirection: null };
  const dipDirection = normalizeAzimuth(Math.atan2(x, y) / DEG);
  return { strike: normalizeAzimuth(dipDirection - 90), dip, dipDirection };
}

/** Signed distance (metres) of point p from the plane through p0 with unit normal n. Positive = above. */
export function signedDistance(n, p0, p) {
  return n[0] * (p[0] - p0[0]) + n[1] * (p[1] - p0[1]) + n[2] * (p[2] - p0[2]);
}
