// DEM grid helpers: checking the GeoTIFF's coordinate system, working out where
// each pixel sits, and bilinear interpolation of elevation.
// Pure functions only: no browser code.

/** Largest DEM we accept, in pixels (a 1°×1° GLO-30 tile is 3600 × 3600 ≈ 13 million). */
export const MAX_DEM_PIXELS = 40_000_000;

/**
 * Checks the GeoTIFF geo keys say WGS84 geographic (EPSG:4326).
 * Returns { ok: true } or { ok: false, message }.
 */
export function checkGeographicWgs84(geoKeys) {
  if (!geoKeys) {
    return { ok: false, message: 'This file has no georeferencing (no GeoTIFF keys). Is it really a GeoTIFF DEM?' };
  }
  if (geoKeys.ProjectedCSTypeGeoKey) {
    return {
      ok: false,
      message: `This DEM is in a projected system (EPSG:${geoKeys.ProjectedCSTypeGeoKey}). ` +
        'Please download it in geographic WGS84 (EPSG:4326).',
    };
  }
  if (geoKeys.GTModelTypeGeoKey !== undefined && geoKeys.GTModelTypeGeoKey !== 2) {
    return { ok: false, message: 'This DEM is not in geographic (lat/long) coordinates. EPSG:4326 is needed.' };
  }
  if (geoKeys.GeographicTypeGeoKey === undefined) {
    return { ok: false, message: 'The file does not say which coordinate system it uses. EPSG:4326 is needed.' };
  }
  if (geoKeys.GeographicTypeGeoKey !== 4326) {
    return {
      ok: false,
      message: `This DEM uses EPSG:${geoKeys.GeographicTypeGeoKey}, not WGS84 (EPSG:4326).`,
    };
  }
  return { ok: true };
}

/**
 * Works out the north-west EDGE of the DEM from the GeoTIFF tie point.
 * GeoTIFFs mark either the corner of the first pixel (PixelIsArea, rasterType 1)
 * or the centre of the first pixel (PixelIsPoint, rasterType 2).
 * resX is positive (degrees per column), resY is negative (rows go south).
 */
export function gridFromGeoTiff({ originX, originY, resX, resY, width, height, rasterType }) {
  if (!(resX > 0) || !(resY < 0)) {
    throw new RangeError('Unexpected pixel size: the DEM must be north-up with no rotation.');
  }
  const resLon = resX;
  const resLat = -resY;
  let west = originX;
  let north = originY;
  if (rasterType === 2) { // PixelIsPoint: tie point is the pixel centre
    west -= resLon / 2;
    north += resLat / 2;
  } else if (rasterType !== 1 && rasterType !== undefined) {
    throw new RangeError(`Unknown GeoTIFF raster type ${rasterType}.`);
  }
  const east = west + width * resLon;
  const south = north - height * resLat;
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    throw new RangeError(
      `DEM bounds (${south.toFixed(4)}, ${west.toFixed(4)}) to (${north.toFixed(4)}, ${east.toFixed(4)}) ` +
      'are outside valid latitude/longitude.');
  }
  return { west, north, east, south, resLon, resLat, width, height };
}

/**
 * Copies raw DEM values into a Float32Array, replacing the no-data value with NaN.
 */
export function toElevationGrid(values, nodata) {
  const out = new Float32Array(values.length);
  const hasNodata = nodata !== null && nodata !== undefined && !Number.isNaN(nodata);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = (hasNodata && v === nodata) || !Number.isFinite(v) ? NaN : v;
  }
  return out;
}

/**
 * Bilinear interpolation at fractional pixel position (x = column, y = row),
 * where (0, 0) is the CENTRE of the top-left pixel.
 * Returns NaN if the point is outside the pixel centres or touches missing data.
 */
export function sampleBilinear(values, width, height, x, y) {
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return NaN;
  // Left/top neighbour; on the last column/row step back one so x1/y1 stay inside the grid.
  const x0 = Math.min(Math.floor(x), Math.max(width - 2, 0));
  const y0 = Math.min(Math.floor(y), Math.max(height - 2, 0));
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = values[y0 * width + x0];
  const v10 = values[y0 * width + x1];
  const v01 = values[y1 * width + x0];
  const v11 = values[y1 * width + x1];
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy; // NaN propagates automatically
}

/**
 * DEM elevation at a WGS84 point, by bilinear interpolation of the four nearest pixel centres.
 * Returns { ok: true, elevation } or { ok: false, message }.
 */
export function elevationAt(grid, elevation, lat, lon) {
  const { west, north, east, south, resLon, resLat, width, height } = grid;
  if (lon < west || lon > east || lat < south || lat > north) {
    return { ok: false, message: 'You are outside the loaded DEM.' };
  }
  const x = (lon - west) / resLon - 0.5;
  const y = (north - lat) / resLat - 0.5;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
    return { ok: false, message: 'Too close to the DEM edge for bilinear interpolation.' };
  }
  const value = sampleBilinear(elevation, width, height, x, y);
  if (Number.isNaN(value)) {
    return { ok: false, message: 'The DEM has no data at this point.' };
  }
  return { ok: true, elevation: value };
}
