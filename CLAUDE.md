# Field Geology Tools

Offline field app for iPad and iPhone. The owner is a geology student and a coding beginner:
keep code simple, and finish every session with a plain-language summary of what changed.

## Project rules
- Plain HTML, CSS and JavaScript with ES modules. NO build step, NO npm frameworks. The app must run directly from GitHub Pages.
- All libraries (Leaflet, geotiff.js, proj4js, and any others) must be downloaded into a /vendor folder. Never load anything from a CDN — the app must work with zero internet.
- Use relative paths everywhere, because GitHub Pages serves the site from /field-geology-tools/, not from the domain root.
- A service worker caches every file the app needs. Whenever any file changes, bump the cache version number in the service worker so devices pick up the update.
- All geometry and maths goes in /js/geo/ as pure functions with no browser code, so it can be tested in Node with `node --test`. Every maths change needs tests, and all tests must pass before a session ends.
- Coordinates: input is WGS84 lat/long. All distance, plane and geometry calculations are done in UTM metres (choose the zone from longitude). Never mix degrees and metres in one calculation.
- Attitudes: strike uses the right-hand rule (dip direction = strike + 90°). Always show and store dip direction explicitly.
- Elevation always comes from the DEM using BILINEAR interpolation, never from GPS altitude.
- Use correct structural geology terms: limb, hinge, axial trace, fold axis, closure. Use antiform/synform, not anticline/syncline, unless younging direction is recorded.
- The layout must work on an iPhone screen and an iPad screen, portrait and landscape. Buttons must be big enough to tap with cold fingers.
- Never silently guess. If data is missing or invalid, show a clear message.

## Practical notes
- Run tests from the repo root: `node --test` (finds files in /test).
- Vendored versions: Leaflet 1.9.4, geotiff.js 2.1.3 (dist-browser build), proj4js 2.12.1.
  They are classic scripts that create the globals `L`, `GeoTIFF` and `proj4`; load them with
  `<script>` tags before the app's module. Tests load proj4 from /vendor to cross-check our UTM maths.
- The cache version lives in `sw.js` (`CACHE_VERSION`). The file list there (`APP_FILES`) must
  include every file the app uses — add new files to it.
- Exception agreed for the hillshade: slope is computed on the DEM's own geographic grid, with
  cell size converted from degrees to metres per row (longitude spacing × cos(latitude)), as
  the owner asked. Everything is converted to metres before any slope maths.
