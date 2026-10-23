// WGS84 latitude/longitude → UTM easting/northing in metres.
// Uses Krüger's series (as in Karney 2011), accurate to well under a millimetre inside a zone.
// Pure functions only: no browser code.

import { WGS84_A, WGS84_F } from './ellipsoid.js';

const DEG = Math.PI / 180;
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const n = WGS84_F / (2 - WGS84_F);
const A = (WGS84_A / (1 + n)) * (1 + (n * n) / 4 + (n ** 4) / 64);
const ALPHA = [
  n / 2 - (2 / 3) * n * n + (5 / 16) * n ** 3 + (41 / 180) * n ** 4,
  (13 / 48) * n * n - (3 / 5) * n ** 3 + (557 / 1440) * n ** 4,
  (61 / 240) * n ** 3 - (103 / 140) * n ** 4,
  (49561 / 161280) * n ** 4,
];
const E = Math.sqrt(WGS84_F * (2 - WGS84_F)); // first eccentricity

/**
 * UTM zone number (1–60) for a point, chosen from longitude,
 * including the standard exceptions for south-west Norway and Svalbard.
 * Throws outside the UTM latitude range (80°S to 84°N).
 */
export function utmZone(lat, lon) {
  if (!(lat >= -80 && lat <= 84)) {
    throw new RangeError(`UTM is only defined from 80°S to 84°N (latitude ${lat}).`);
  }
  if (!(lon >= -180 && lon <= 180)) throw new RangeError(`Longitude must be between -180 and 180, got ${lon}`);
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60; // lon = 180 exactly
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32; // Norway
  if (lat >= 72) { // Svalbard
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

/** Central meridian (degrees) of a UTM zone. */
export function centralMeridian(zone) {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * Converts WGS84 lat/long (degrees) to UTM.
 * zone: optional; if left out it is chosen from the longitude.
 * Returns { zone, hemisphere: 'N' | 'S', easting, northing } in metres.
 */
export function toUtm(lat, lon, zone = utmZone(lat, lon)) {
  const phi = lat * DEG;
  const lambda = (lon - centralMeridian(zone)) * DEG;

  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - E * Math.atanh(E * sinPhi));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));

  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= ALPHA.length; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }

  const easting = FALSE_EASTING + K0 * A * eta;
  let northing = K0 * A * xi;
  const hemisphere = lat >= 0 ? 'N' : 'S';
  if (hemisphere === 'S') northing += FALSE_NORTHING_SOUTH;
  return { zone, hemisphere, easting, northing };
}

const BETA = [
  n / 2 - (2 / 3) * n * n + (37 / 96) * n ** 3 - (1 / 360) * n ** 4,
  (1 / 48) * n * n + (1 / 15) * n ** 3 - (437 / 1440) * n ** 4,
  (17 / 480) * n ** 3 - (37 / 840) * n ** 4,
  (4397 / 161280) * n ** 4,
];

/**
 * Converts UTM (metres) back to WGS84 latitude/longitude in degrees.
 * hemisphere: 'N' or 'S' (which false northing was used). Returns { lat, lon }.
 */
export function fromUtm(easting, northing, zone, hemisphere) {
  const xi = (northing - (hemisphere === 'S' ? FALSE_NORTHING_SOUTH : 0)) / (K0 * A);
  const eta = (easting - FALSE_EASTING) / (K0 * A);

  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= BETA.length; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const sinhEtaP = Math.sinh(etaP);
  const cosXiP = Math.cos(xiP);
  const tauP = Math.sin(xiP) / Math.sqrt(sinhEtaP * sinhEtaP + cosXiP * cosXiP);
  const lambda = Math.atan2(sinhEtaP, cosXiP);

  // Solve for tan(latitude) by Newton's method (Karney 2011); converges in 2–3 steps.
  const e2 = E * E;
  let tau = tauP;
  for (let i = 0; i < 10; i++) {
    const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
    const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    const step = ((tauP - tauI) / Math.sqrt(1 + tauI * tauI)) *
      ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau)));
    tau += step;
    if (Math.abs(step) < 1e-14) break;
  }
  return { lat: Math.atan(tau) / DEG, lon: centralMeridian(zone) + lambda / DEG };
}
