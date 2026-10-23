// Map screen: load a DEM, show its hillshade, show where you are, and record field stations.

import { computeHillshade } from './geo/hillshade.js';
import { elevationAt } from './geo/raster.js';
import { metresPerDegree } from './geo/ellipsoid.js';
import { toUtm } from './geo/utm.js';
import { readDem, hillshadeToCanvas, DemError } from './dem.js';
import { createHillshadeLayer } from './hillshade-layer.js';
import { saveLastDem, loadLastDem, askForPersistentStorage } from './storage.js';
import { initStations } from './stations-ui.js';
import { initTraces } from './trace-ui.js';

const SUN_AZIMUTH = 315;
const SUN_ALTITUDE = 45;

const el = {
  loadBtn: document.getElementById('load-dem'),
  fileInput: document.getElementById('dem-file'),
  locateBtn: document.getElementById('locate'),
  message: document.getElementById('message'),
  locationInfo: document.getElementById('location-info'),
  demDetails: document.getElementById('dem-details'),
  demInfo: document.getElementById('dem-info'),
};

let dem = null; // { name, grid, elevation, ... }
let hillshadeLayer = null;
let lastPosition = null;
let watchId = null;
let locationMarkers = null;

// ---------- Messages ----------

function showMessage(text, kind = '') {
  el.message.textContent = text;
  el.message.className = `message ${kind}`;
}

/** Lets the browser draw a message before starting slow work. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

// ---------- Map ----------

const map = L.map('map', {
  minZoom: 2,
  maxZoom: 20,
  zoomSnap: 0.5,
  worldCopyJump: false,
}).setView([20, 0], 2);
L.control.scale({ imperial: false, maxWidth: 160 }).addTo(map);

// ---------- Field stations (see stations-ui.js) ----------

const tracesUi = initTraces({ map, showMessage, getDem: () => dem });

const stationsUi = initStations({
  map,
  showMessage,
  getPosition: () => lastPosition,
  getDem: () => dem,
  onPredictTrace: (station) => tracesUi.predict(station),
});

// ---------- DEM loading ----------

el.loadBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files[0];
  el.fileInput.value = ''; // lets the same file be picked again later
  if (!file) return;
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    showMessage(`Could not open "${file.name}": ${e.message}`, 'error');
    return;
  }
  await showDem(file.name, buffer, { save: true });
});

async function showDem(name, buffer, { save }) {
  el.loadBtn.disabled = true;
  try {
    showMessage(`Reading "${name}"…`);
    await nextFrame();
    const loaded = await readDem(buffer);

    showMessage(`Computing hillshade for "${name}"…`);
    await nextFrame();
    const shade = computeHillshade(
      { ...loaded.grid, elevation: loaded.elevation },
      { azimuthDeg: SUN_AZIMUTH, altitudeDeg: SUN_ALTITUDE });
    const canvas = hillshadeToCanvas(loaded.grid, shade);

    if (hillshadeLayer) map.removeLayer(hillshadeLayer);
    hillshadeLayer = createHillshadeLayer(canvas, loaded.grid).addTo(map);
    const { south, west, north, east } = loaded.grid;
    map.setMaxBounds(null);
    map.fitBounds([[south, west], [north, east]], { animate: false });

    dem = { name, ...loaded };
    showDemDetails();

    if (save) {
      try {
        await saveLastDem(name, buffer);
        showMessage(`Loaded "${name}". It is saved on this device for next time.`, 'ok');
      } catch (e) {
        showMessage(`Loaded "${name}", but it could not be saved for next time ` +
          `(${e.message || e.name}). You will need to load it again after closing the app.`, 'error');
      }
    } else {
      showMessage(`Showing your last DEM: "${name}".`, 'ok');
    }
    if (lastPosition) updateLocationReadout();
    stationsUi.demChanged();
    tracesUi.demChanged();
  } catch (e) {
    console.error(e);
    const text = e instanceof DemError ? e.message : `Something went wrong reading the DEM: ${e.message}`;
    showMessage(`"${name}" was not loaded. ${text}`, 'error');
  } finally {
    el.loadBtn.disabled = false;
  }
}

function fillReadout(dl, rows) {
  dl.replaceChildren();
  for (const [label, value, className] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (className) dd.className = className;
    dl.append(dt, dd);
  }
}

function showDemDetails() {
  const { grid } = dem;
  const centreLat = (grid.north + grid.south) / 2;
  const m = metresPerDegree(centreLat);
  const cellEW = grid.resLon * m.lon;
  const cellNS = grid.resLat * m.lat;
  fillReadout(el.demInfo, [
    ['File', dem.name],
    ['Size', `${grid.width} × ${grid.height} pixels`],
    ['North / South', `${grid.north.toFixed(5)}° / ${grid.south.toFixed(5)}°`],
    ['West / East', `${grid.west.toFixed(5)}° / ${grid.east.toFixed(5)}°`],
    ['Cell size', `${(grid.resLon * 3600).toFixed(2)}″ × ${(grid.resLat * 3600).toFixed(2)}″ ` +
      `(≈ ${cellEW.toFixed(1)} m E–W × ${cellNS.toFixed(1)} m N–S at the centre)`],
    ['Elevation range', `${dem.min.toFixed(1)} m to ${dem.max.toFixed(1)} m`],
    ['No-data value', dem.nodata === null ? 'none set in file' : String(dem.nodata)],
    ['Pixel type', dem.rasterType === 2 ? 'PixelIsPoint (values at pixel centres)' : 'PixelIsArea'],
    ['Hillshade', `sun azimuth ${SUN_AZIMUTH}°, altitude ${SUN_ALTITUDE}°`],
    ['Heights', 'As stored in the DEM. Copernicus GLO-30 heights are above the EGM2008 geoid.', 'note'],
  ]);
  el.demDetails.hidden = false;
}

// ---------- My location ----------

el.locateBtn.addEventListener('click', () => {
  if (watchId !== null) {
    stopLocation();
    return;
  }
  if (!('geolocation' in navigator)) {
    showMessage('This browser cannot give your location.', 'error');
    return;
  }
  if (!window.isSecureContext) {
    showMessage('Location only works over https (e.g. GitHub Pages) or on localhost.', 'error');
    return;
  }
  showMessage('Finding your location… (outdoors with a clear sky works best)');
  el.locateBtn.textContent = 'Stop location';
  el.locateBtn.setAttribute('aria-pressed', 'true');
  let firstFix = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos.coords;
      drawLocation();
      updateLocationReadout();
      if (firstFix) {
        firstFix = false;
        map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 15), { animate: false });
        showMessage('Location found. It keeps updating while this is switched on.', 'ok');
      }
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        stopLocation();
        showMessage('Location permission is off. On iPhone/iPad: Settings › Privacy & Security › ' +
          'Location Services › Safari Websites → "While Using the App", then try again.', 'error');
      } else if (err.code === err.TIMEOUT) {
        showMessage('Still waiting for a GPS fix. Move to open sky; it keeps trying.', 'error');
      } else {
        showMessage(`Your location is not available right now (${err.message}). It keeps trying.`, 'error');
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
});

function stopLocation() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  el.locateBtn.textContent = 'My location';
  el.locateBtn.removeAttribute('aria-pressed');
  showMessage('Location switched off.');
}

function drawLocation() {
  const latlng = [lastPosition.latitude, lastPosition.longitude];
  if (!locationMarkers) {
    locationMarkers = {
      circle: L.circle(latlng, {
        radius: lastPosition.accuracy, color: '#3a8dde', weight: 2, fillColor: '#3a8dde', fillOpacity: 0.15,
        interactive: false,
      }).addTo(map),
      dot: L.circleMarker(latlng, {
        radius: 9, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false,
      }).addTo(map),
    };
  } else {
    locationMarkers.circle.setLatLng(latlng).setRadius(lastPosition.accuracy);
    locationMarkers.dot.setLatLng(latlng);
  }
}

function updateLocationReadout() {
  const { latitude: lat, longitude: lon, accuracy } = lastPosition;

  let utmText;
  try {
    const u = toUtm(lat, lon);
    utmText = `Zone ${u.zone}${u.hemisphere}  ${Math.round(u.easting)} E  ${Math.round(u.northing)} N`;
  } catch (e) {
    utmText = e.message;
  }

  let elevText;
  let elevClass = 'big';
  if (!dem) {
    elevText = 'Load a DEM to see the elevation here.';
    elevClass = 'note';
  } else {
    const result = elevationAt(dem.grid, dem.elevation, lat, lon);
    if (result.ok) {
      elevText = `${result.elevation.toFixed(1)} m`;
    } else {
      elevText = result.message;
      elevClass = 'note';
    }
  }

  fillReadout(el.locationInfo, [
    ['DEM elevation', elevText, elevClass],
    ['Lat / Long', `${lat.toFixed(6)}°, ${lon.toFixed(6)}° (WGS84)`],
    ['UTM', utmText],
    ['GPS accuracy', `± ${Math.round(accuracy)} m`],
  ]);
  el.locationInfo.hidden = false;
}

// ---------- Start-up ----------

async function start() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      showMessage(`Offline mode could not be set up: ${e.message}`, 'error');
    });
  }
  // Ask iOS not to delete our saved stations and DEM when space runs low.
  const persisted = await askForPersistentStorage();
  await stationsUi.load(persisted);

  let saved;
  try {
    saved = await loadLastDem();
  } catch (e) {
    showMessage(`Could not open the saved DEM storage (${e.message || e.name}). Load a DEM GeoTIFF to begin.`, 'error');
    return;
  }
  if (saved && saved.buffer) {
    await showDem(saved.name, saved.buffer, { save: false });
  } else {
    showMessage('Load a DEM GeoTIFF (WGS84, EPSG:4326) to begin.');
  }
}

start();
