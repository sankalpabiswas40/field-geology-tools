// A Leaflet layer that shows the hillshade canvas as map tiles.
// Tiles stay sharp and work at every zoom level, which a single huge image would not on iPad.

/**
 * canvas: hillshade image whose rows are spaced evenly in Web Mercator (see dem.js)
 * bounds: { west, north, east, south } in degrees
 */
export function createHillshadeLayer(canvas, bounds) {
  const HillshadeLayer = L.GridLayer.extend({
    createTile(coords) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;

      // Corners of the DEM in map pixels at this zoom level.
      const nw = this._map.project([bounds.north, bounds.west], coords.z);
      const se = this._map.project([bounds.south, bounds.east], coords.z);
      const tileX = coords.x * size.x;
      const tileY = coords.y * size.y;

      // Part of this tile covered by the DEM.
      const x0 = Math.max(tileX, nw.x);
      const x1 = Math.min(tileX + size.x, se.x);
      const y0 = Math.max(tileY, nw.y);
      const y1 = Math.min(tileY + size.y, se.y);
      if (x1 <= x0 || y1 <= y0) return tile;

      const fx = canvas.width / (se.x - nw.x);
      const fy = canvas.height / (se.y - nw.y);
      tile.getContext('2d').drawImage(
        canvas,
        (x0 - nw.x) * fx, (y0 - nw.y) * fy, (x1 - x0) * fx, (y1 - y0) * fy,
        x0 - tileX, y0 - tileY, x1 - x0, y1 - y0);
      return tile;
    },
  });

  return new HillshadeLayer({
    bounds: L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]),
    noWrap: true,
    maxZoom: 22,
    attribution: 'Hillshade from your DEM',
  });
}
