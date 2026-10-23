// Fold geometry from attitudes (the maths behind the stereonet).
// Vectors are East-North-Up unit vectors. Pure functions only: no browser code.

import { planeNormal } from './plane.js';
import { normalizeAzimuth } from './attitude.js';

const DEG = Math.PI / 180;

/** Fewer poles than this: no fold axis is reported. */
export const MIN_POLES_FOR_AXIS = 6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angleDeg = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) / DEG;

/** Downward-pointing unit vector for a line with trend and plunge (degrees). */
export function lineVector(trend, plunge) {
  const t = trend * DEG;
  const p = plunge * DEG;
  return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)];
}

/** Trend and plunge (degrees) of a line; the direction is flipped to point downwards if needed. */
export function trendPlunge(v) {
  let [x, y, z] = unit(v);
  if (z > 0 || (z === 0 && (x < 0 || (x === 0 && y < 0)))) { x = -x; y = -y; z = -z; }
  return { trend: normalizeAzimuth(Math.atan2(x, y) / DEG), plunge: Math.asin(Math.min(1, -z)) / DEG };
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
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
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
 * Orientation tensor of unit vectors (axial data: v and −v count the same), divided by the
 * number of vectors so the three eigenvalues add up to 1.
 */
export function orientationEigen(vectors) {
  const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of vectors) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i][j] += (v[i] * v[j]) / vectors.length;
  return symmetricEigen3(t).map((e) => ({ value: Math.max(0, e.value), vector: e.vector }));
}

/**
 * Woodcock (1977) shape: K = ln(λ1/λ2) / ln(λ2/λ3).
 * K < 1: the vectors spread along a great circle (girdle). K > 1: they bunch together (cluster).
 */
export function woodcockK(l1, l2, l3) {
  if (!(l2 > 0)) return Infinity; // everything in one direction: a cluster
  if (!(l3 > 0)) return 0; // perfectly on a great circle
  const below = Math.log(l2 / l3);
  if (below === 0) return Infinity;
  return Math.log(l1 / l2) / below;
}

/** Fleuty (1964) class of an interlimb angle in degrees. */
export function fleutyClass(angle) {
  if (angle < 1) return 'isoclinal';
  if (angle < 30) return 'tight';
  if (angle < 70) return 'close';
  if (angle < 120) return 'open';
  return 'gentle';
}

/** Plain-language note on how well a cylindrical fold fits, from the smallest eigenvalue λ3. */
export function cylindricalFitNote(l3) {
  if (l3 < 0.01) return 'Very good fit: the poles lie almost exactly on one great circle, as for a cylindrical fold.';
  if (l3 < 0.03) return 'Good fit: the poles lie close to one great circle, with some scatter.';
  if (l3 < 0.06) return 'Fair fit: noticeable scatter about the great circle. Check readings, or the fold may not be cylindrical.';
  return 'Poor fit: the poles do not follow one great circle. The fold may not be cylindrical, or the data mix several structures.';
}

/** Gap (degrees) between pole groups along the girdle needed to call it two separate limbs. */
const MIN_LIMB_GAP = 20;

/**
 * Splits poles into two limb groups along the girdle, if they clearly separate.
 * normals: UPWARD unit normals. axis: fold-axis unit vector.
 * Poles are placed at angles around the axis; the biggest gap between neighbours separates
 * the limbs. It counts as a clear split only if that gap is at least 20° and at least twice
 * every gap inside the groups, and each group has 2 or more poles.
 * Returns { groupA, groupB, gap } (indexes into normals) or null.
 */
export function splitLimbs(normals, axis) {
  if (normals.length < 4) return null;
  // Reference direction: mean pole projected into the profile plane (perpendicular to the axis).
  const project = (n) => { const d = dot(n, axis); return [n[0] - d * axis[0], n[1] - d * axis[1], n[2] - d * axis[2]]; };
  const sum = normals.reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]], [0, 0, 0]);
  const ref = unit(project(sum));
  const side = cross(axis, ref);
  const angles = normals.map((n, i) => {
    const p = project(n);
    return { i, a: Math.atan2(dot(p, side), dot(p, ref)) / DEG };
  }).sort((x, y) => x.a - y.a);

  let cut = -1;
  let gap = -Infinity;
  for (let k = 0; k < angles.length - 1; k++) {
    const g = angles[k + 1].a - angles[k].a;
    if (g > gap) { gap = g; cut = k; }
  }
  const groupA = angles.slice(0, cut + 1).map((x) => x.i);
  const groupB = angles.slice(cut + 1).map((x) => x.i);
  if (groupA.length < 2 || groupB.length < 2 || gap < MIN_LIMB_GAP) return null;
  let inner = 0;
  for (let k = 0; k < angles.length - 1; k++) if (k !== cut) inner = Math.max(inner, angles[k + 1].a - angles[k].a);
  if (gap < 2 * inner) return null;
  return { groupA, groupB, gap };
}

/**
 * Interlimb angles from two limb groups, using UPWARD unit normals and the plain dot product
 * (no absolute value, which would fold angles above 90° and give wrong answers).
 * Interlimb angle = 180° − angle between poles.
 *  outermost: the most divergent pole in each group (largest angle between the groups)
 *  mean:      the mean pole of each group
 */
export function interlimbAngles(normals, groupA, groupB) {
  let widest = -Infinity;
  for (const i of groupA) for (const j of groupB) widest = Math.max(widest, angleDeg(normals[i], normals[j]));
  const mean = (g) => unit(g.reduce((s, i) => [s[0] + normals[i][0], s[1] + normals[i][1], s[2] + normals[i][2]], [0, 0, 0]));
  return { outermost: 180 - widest, mean: 180 - angleDeg(mean(groupA), mean(groupB)) };
}

/**
 * Full fold analysis of bedding attitudes [{ strike, dip }] (RHR).
 * Returns {
 *   n, eigen: [{ value, vector, trend, plunge }] (λ1 ≥ λ2 ≥ λ3, sum 1), K, shape: 'girdle'|'cluster',
 *   axis: { trend, plunge } | null, warnings: [text], fitNote,
 *   limbs: { groupA, groupB, outermost, mean, fleutyOutermost, fleutyMean } | null
 * }
 */
export function analyseFold(attitudes) {
  const n = attitudes.length;
  const warnings = [];
  if (n < 2) {
    return { n, eigen: null, K: null, shape: null, axis: null, limbs: null, fitNote: null,
      warnings: [`Only ${n} pole${n === 1 ? '' : 's'}: at least ${MIN_POLES_FOR_AXIS} are needed for a fold axis.`] };
  }
  const normals = attitudes.map((a) => planeNormal(a.strike, a.dip)); // upward unit normals
  const eigen = orientationEigen(normals).map((e) => ({ ...e, ...trendPlunge(e.vector) }));
  const [l1, l2, l3] = eigen.map((e) => e.value);
  const K = woodcockK(l1, l2, l3);
  const shape = K < 1 ? 'girdle' : 'cluster';

  if (n < MIN_POLES_FOR_AXIS) {
    warnings.push(`Only ${n} poles: at least ${MIN_POLES_FOR_AXIS} are needed before a fold axis is reported.`);
  }
  if (shape === 'cluster') {
    warnings.push('The poles form one cluster, not a girdle (great circle). This looks like one limb only, ' +
      'so the fold axis cannot be found. Measure the other limb too.');
  }
  const axisOk = n >= MIN_POLES_FOR_AXIS && shape === 'girdle';
  const axis = axisOk ? { trend: eigen[2].trend, plunge: eigen[2].plunge } : null;

  let limbs = null;
  if (axis) {
    const split = splitLimbs(normals, lineVector(axis.trend, axis.plunge));
    if (split) {
      const ia = interlimbAngles(normals, split.groupA, split.groupB);
      limbs = { ...split, ...ia, fleutyOutermost: fleutyClass(ia.outermost), fleutyMean: fleutyClass(ia.mean) };
    } else {
      warnings.push('The poles do not split clearly into two limb groups along the girdle, so no interlimb angle is given.');
    }
  }
  return { n, eigen, K, shape, axis, limbs, warnings, fitNote: axis ? cylindricalFitNote(l3) : null };
}

/** Best-fit fold axis only (smallest eigenvector of the poles), without checks. */
export function foldAxis(attitudes) {
  if (attitudes.length < 3) throw new RangeError('At least 3 bedding attitudes are needed to find a fold axis.');
  const eig = orientationEigen(attitudes.map((a) => planeNormal(a.strike, a.dip)));
  return { ...trendPlunge(eig[2].vector), cylindricity: eig[2].value };
}

/** Mean of lines [{ trend, plunge }] (axial: a line and its reverse count the same). */
export function meanLine(lines) {
  if (!lines.length) throw new RangeError('No lines to average.');
  const eig = orientationEigen(lines.map((l) => lineVector(l.trend, l.plunge)));
  return { ...trendPlunge(eig[0].vector), spread: 1 - eig[0].value };
}

/** Acute angle (0–90°) between two lines. For LINES the absolute value is correct. */
export function angleBetweenLines(a, b) {
  const d = Math.abs(dot(lineVector(a.trend, a.plunge), lineVector(b.trend, b.plunge)));
  return Math.acos(Math.min(1, d)) / DEG;
}
