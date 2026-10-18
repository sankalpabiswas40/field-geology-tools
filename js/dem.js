// Reading a DEM GeoTIFF (with the vendored geotiff.js, global `GeoTIFF`)
// and turning a hillshade into an image that lines up with the Leaflet map.

import { checkGeographicWgs84, gridFromGeoTiff, toElevationGrid, sampleBilinear, MAX_DEM_PIXELS } from './geo/raster.js';
import { mercatorRowMap } from './geo/mercator.js';

/** An error whose message is meant to be shown to the user. */
export class DemError extends Error {}

/**
 * Reads a GeoTIFF from an ArrayBuffer and checks it is a usable WGS84 DEM.
 * Returns { grid, elevation, nodata, rasterType, min, max }.
 */
export async function readDem(buffer) {
  let image;
  try {
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    image = await tiff.getImage(); // first (full-resolution) image
  } catch (e) {
    throw new DemError(`Could not read this file as a GeoTIFF. (${e.message})`);
  }

  const width = image.getWidth();
  const height = image.getHeight();
  if (width < 3 || height < 3) {
    throw new DemError(`The DEM is only ${width} × ${height} pixels; at least 3 × 3 is needed.`);
  }
  if (width * height > MAX_DEM_PIXELS) {
    throw new DemError(
      `The DEM is ${width} × ${height} pixels, which is too big for a phone or iPad. ` +
      'Please download a smaller area (up to about a 1° × 1° tile).');
  }
  if (image.getSamplesPerPixel() !== 1) {
    throw new DemError(`Expected a single-band DEM, but this file has ${image.getSamplesPerPixel()} bands.`);
  }

  const geoKeys = image.getGeoKeys();
  const crs = checkGeographicWgs84(geoKeys);
  if (!crs.ok) throw new DemError(crs.message);

  let grid;
  try {
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    grid = gridFromGeoTiff({
      originX, originY, resX, resY, width, height, rasterType: geoKeys.GTRasterTypeGeoKey,
    });
  } catch (e) {
    throw new DemError(`The DEM's position on the Earth could not be worked out: ${e.message}`);
  }

  const [values] = await image.readRasters({ samples: [0] });
  const nodata = image.getGDALNoData();
  const elevation = toElevationGrid(values, nodata);

  let min = Infinity;
  let max = -Infinity;
  for (const v of elevation) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) throw new DemError('The DEM contains no elevation values (every pixel is "no data").');

  return { grid, elevation, nodata, rasterType: geoKeys.GTRasterTypeGeoKey, min, max };
}

// iPhone/iPad Safari refuses to draw canvases bigger than about 16.7 million pixels.
const MAX_CANVAS_SIDE = 4096;
const MAX_CANVAS_AREA = 16_000_000;

/**
 * Draws a hillshade (values 0..1, NaN = no data) into a canvas whose rows are spaced evenly
 * in Web Mercator, so it can be stretched straight onto the Leaflet map without distortion.
 */
export function hillshadeToCanvas(grid, shade) {
  const { width: w, height: h } = grid;
  const scale = Math.max(1, w / MAX_CANVAS_SIDE, h / MAX_CANVAS_SIDE, Math.sqrt((w * h) / MAX_CANVAS_AREA));
  const outW = Math.floor(w / scale);
  const outH = Math.floor(h / scale);

  const rowMap = mercatorRowMap(grid.north, grid.south, grid.resLat, outH);
  const colMap = new Float64Array(outW);
  for (let j = 0; j < outW; j++) colMap[j] = ((j + 0.5) / outW) * w - 0.5;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(outW, outH);
  const px = img.data;
  for (let k = 0; k < outH; k++) {
    for (let j = 0; j < outW; j++) {
      const v = sampleBilinear(shade, w, h, colMap[j], rowMap[k]);
      const p = (k * outW + j) * 4;
      if (Number.isNaN(v)) continue; // stays transparent
      const g = Math.round(v * 255);
      px[p] = g;
      px[p + 1] = g;
      px[p + 2] = g;
      px[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
