// Fold geometry from bedding attitudes (the maths behind a stereonet).
// Vectors are East-North-Up unit vectors. Pure functions only: no browser code.

import { planeNormal } from './plane.js';
import { normalizeAzimuth } from './attitude.js';

const DEG = Math.PI / 180;

/** Downward-pointing unit vector for a line with trend and plunge (degrees). */
export function lineVector(trend, plunge) {
  const t = trend * DEG;
  const p = plunge * DEG;
  return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)];
}

/** Trend and plunge (degrees) of a line; the direction is flipped to point downwards if needed. */
export function trendPlunge(v) {
  let [x, y, z] = v;
  const len = Math.hypot(x, y, z);
  x /= len; y /= len; z /= len;
  if (z > 0) { x = -x; y = -y; z = -z; }
  return { trend: normalizeAzimuth(Math.atan2(x, y) / DEG), plunge: Math.asin(-z) / DEG };
}

/**
 * Eigenvalues and eigenvectors of a symmetric 3×3 matrix (Jacobi rotations).
 * Returns [{ value, vector }, ...] sorted from largest to smallest value.
 */
export function symmetricEigen3(m) {
  const a = m.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) { // rotate columns p, q
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) { // rotate rows p, q
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] }))
    .sort((x, y) => y.value - x.value);
}

/**
 * Best-fit fold axis from bedding attitudes [{ strike, dip }, ...] (RHR).
 * The poles to bedding of a cylindrical fold lie on a great circle; the fold axis is the pole
 * to that circle, i.e. the direction the poles are LEAST spread along (smallest eigenvector of
 * the orientation tensor). Returns { trend, plunge, cylindricity } where cylindricity is the
 * share of spread NOT explained by the girdle (0 = perfectly cylindrical).
 */
export function foldAxis(attitudes) {
  if (attitudes.length < 3) throw new RangeError('At least 3 bedding attitudes are needed to find a fold axis.');
  const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const { strike, dip } of attitudes) {
    const n = planeNormal(strike, dip);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i][j] += n[i] * n[j] / attitudes.length;
  }
  const eig = symmetricEigen3(t);
  return { ...trendPlunge(eig[2].vector), cylindricity: eig[2].value };
}

/**
 * Interlimb angle (degrees) of a fold with the given axis.
 * Poles are projected onto the profile plane (perpendicular to the axis); the two most widely
 * separated poles represent the limbs. Interlimb angle = 180° − angle between those poles.
 */
export function interlimbAngle(attitudes, axis) {
  const a = lineVector(axis.trend, axis.plunge);
  const projected = attitudes.map(({ strike, dip }) => {
    const n = planeNormal(strike, dip);
    const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    const p = [n[0] - d * a[0], n[1] - d * a[1], n[2] - d * a[2]];
    const len = Math.hypot(...p);
    return p.map((x) => x / len);
  });
  let widest = 0;
  for (let i = 0; i < projected.length; i++) {
    for (let j = i + 1; j < projected.length; j++) {
      const dot = projected[i].reduce((s, x, k) => s + x * projected[j][k], 0);
      widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot))) / DEG);
    }
  }
  return 180 - widest;
}
