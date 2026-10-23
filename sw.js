// Service worker: keeps a copy of every app file on the device so the app opens offline.
// IMPORTANT: whenever ANY file changes, increase CACHE_VERSION so devices download the update.

const CACHE_VERSION = 8;
const CACHE_NAME = `field-geology-tools-v${CACHE_VERSION}`;

// Every file the app needs, as paths relative to this file.
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/area-ui.js',
  './js/dem.js',
  './js/hillshade-layer.js',
  './js/share.js',
  './js/stations-ui.js',
  './js/stereonet-ui.js',
  './js/storage.js',
  './js/trace-ui.js',
  './js/trace-worker.js',
  './js/geo/area.js',
  './js/geo/attitude.js',
  './js/geo/contour.js',
  './js/geo/ellipsoid.js',
  './js/geo/export.js',
  './js/geo/fold.js',
  './js/geo/hillshade.js',
  './js/geo/mercator.js',
  './js/geo/plane.js',
  './js/geo/raster.js',
  './js/geo/station.js',
  './js/geo/stereonet.js',
  './js/geo/test-stations.js',
  './js/geo/trace.js',
  './js/geo/utm.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/geotiff/geotiff.js',
  './vendor/proj4/proj4.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so we always store the newest files.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      // Opening the app by its folder URL: serve the cached page.
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html').then((page) => page || fetch(event.request));
      }
      return fetch(event.request);
    }),
  );
});
