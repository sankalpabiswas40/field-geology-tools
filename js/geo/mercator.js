// Web Mercator helpers, used to redraw the lat/long DEM grid so it lines up exactly
// with Leaflet's map (which uses Web Mercator). Pure functions only.

const DEG = Math.PI / 180;

/** Web Mercator y (unitless, sphere radius 1) for a latitude in degrees. */
export function latToMercatorY(latDeg) {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2));
}

/** Latitude in degrees for a Web Mercator y. */
export function mercatorYToLat(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
}

/**
 * For an image of `outRows` rows spaced evenly in Mercator y between `north` and `south`,
 * returns, for each output row, the matching fractional row in the source lat/long grid
 * (0 = centre of the source's top row).
 */
export function mercatorRowMap(north, south, resLat, outRows) {
  const yN = latToMercatorY(north);
  const yS = latToMercatorY(south);
  const map = new Float64Array(outRows);
  for (let k = 0; k < outRows; k++) {
    const y = yN - ((k + 0.5) / outRows) * (yN - yS);
    map[k] = (north - mercatorYToLat(y)) / resLat - 0.5;
  }
  return map;
}
