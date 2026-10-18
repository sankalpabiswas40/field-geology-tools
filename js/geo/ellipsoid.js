// WGS84 ellipsoid constants and degree-to-metre conversions.
// Pure functions only: no browser code, so they can be tested in Node.

export const WGS84_A = 6378137; // semi-major axis, metres
export const WGS84_F = 1 / 298.257223563; // flattening
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared

const DEG = Math.PI / 180;

/**
 * Length in metres of one degree of latitude and one degree of longitude
 * at a given latitude, on the WGS84 ellipsoid.
 * One degree of longitude shrinks with cos(latitude); it is zero at the poles.
 */
export function metresPerDegree(latDeg) {
  if (!Number.isFinite(latDeg) || latDeg < -90 || latDeg > 90) {
    throw new RangeError(`Latitude must be between -90 and 90, got ${latDeg}`);
  }
  const phi = latDeg * DEG;
  const s = Math.sin(phi);
  const w = 1 - WGS84_E2 * s * s;
  const meridianRadius = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5); // north-south curvature
  const primeVerticalRadius = WGS84_A / Math.sqrt(w); // east-west curvature
  return {
    lat: meridianRadius * DEG,
    lon: primeVerticalRadius * Math.cos(phi) * DEG,
  };
}
