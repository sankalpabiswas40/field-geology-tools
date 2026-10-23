// "Is this station inside the area I drew on the map?"
// Worked out in UTM metres (zone of the area's first corner). Pure functions only.

import { toUtm, utmZone } from './utm.js';

/** Even-odd ray test on flat x/y coordinates. polygon: [{ x, y }], at least 3 corners. */
export function pointInPolygonXY(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Makes a test function for an area drawn on the map.
 * area: [{ lat, lon }, ...] with at least 3 corners. Returns (lat, lon) => true/false.
 */
export function makeAreaTest(area) {
  if (!area || area.length < 3) throw new RangeError('An area needs at least 3 corners.');
  const zone = utmZone(area[0].lat, area[0].lon);
  const toXY = (lat, lon) => { const u = toUtm(lat, lon, zone); return { x: u.easting, y: u.northing }; };
  const polygon = area.map((p) => toXY(p.lat, p.lon));
  return (lat, lon) => { const p = toXY(lat, lon); return pointInPolygonXY(p.x, p.y, polygon); };
}
