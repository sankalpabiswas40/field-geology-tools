// Field stations: the "New station" form, station symbols on the map, edit/delete, and export.

import { elevationAt } from './geo/raster.js';
import { toUtm } from './geo/utm.js';
import { checkStrike, dipDirectionFromStrike, formatAzimuth, strikeDipSymbol } from './geo/attitude.js';
import { checkStationInput, nextStationId, localTimeText, FEATURE_TYPES } from './geo/station.js';
import { stationsToCsv, stationsToGeoJson, stationsToKml } from './geo/export.js';
import { loadStations, saveStation, deleteStation, getMeta, setMeta } from './storage.js';
import { shareOrDownload, fileStamp } from './share.js';
import { placeTestStations } from './geo/test-stations.js';

const FEATURE_COLOURS = {
  bedding: '#c1121f',
  foliation: '#7b2cbf',
  joint: '#1d4ed8',
  fault: '#111111',
  vein: '#0f766e',
  other: '#5c5c5c',
};
const TEST_COLOUR = '#ff00d4'; // all TEST DATA stations, whatever their feature type

const $ = (id) => document.getElementById(id);

/**
 * map: the Leaflet map
 * showMessage(text, kind): shows a message in the main panel
 * getPosition(): latest GPS coords ({ latitude, longitude, accuracy }) or null
 * getDem(): the loaded DEM ({ name, grid, elevation }) or null
 * onPredictTrace(station): called by the "Predict trace" button in a station's popup
 */
export function initStations({ map, showMessage, getPosition, getDem, onPredictTrace }) {
  const el = {
    newBtn: $('new-station'),
    exportBtn: $('export'),
    counter: $('station-counter'),
    sheet: $('station-sheet'),
    form: $('station-form'),
    title: $('station-title'),
    errors: $('form-errors'),
    datetime: $('f-datetime'),
    useLocation: $('f-use-location'),
    locationNote: $('f-location-note'),
    elevation: $('f-elevation'),
    dipDir: $('f-dipdir'),
    cancel: $('f-cancel'),
  };
  const field = (name) => el.form.elements[name];

  let stations = [];
  let lastExport = null; // { time: ISO string, count }
  let storageProtected = null;
  const markers = new Map(); // uuid → Leaflet marker
  const layer = L.layerGroup().addTo(map);

  // What the open form is working on.
  let editing = null; // the station being edited, or null for a new one
  let draftTime = null; // { createdAt, tzOffsetMinutes } for a new station

  // ---------- Counter ----------

  function updateCounter() {
    const n = stations.length;
    const last = lastExport ? new Date(lastExport.time) : null;
    const lastText = last
      ? last.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'never';
    const notExported = stations.filter((s) => !last || new Date(s.updatedAt || s.createdAt) > last).length;
    const tests = stations.filter((s) => s.isTest === true).length;
    let text = `${n} station${n === 1 ? '' : 's'} saved${tests ? ` (${tests} of them TEST DATA)` : ''}, last export: ${lastText}`;
    if (notExported > 0) text += ` — ${notExported} not exported yet`;
    if (storageProtected === false) text += '. This device may clear app data when short of space, so export often.';
    el.counter.textContent = text;
    el.counter.classList.toggle('warn', notExported > 0);
  }

  // ---------- Map symbols ----------

  function symbolSvg(station) {
    const size = 44;
    const colour = station.isTest ? TEST_COLOUR : FEATURE_COLOURS[station.featureType] || FEATURE_COLOURS.other;
    const parts = [];
    if (station.strike !== null) {
      const sym = strikeDipSymbol(station.strike, station.dip, { size });
      const drawLines = (stroke, width) => sym.lines.map(([x1, y1, x2, y2]) =>
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`).join('');
      if (sym.circle) {
        const { cx, cy, r } = sym.circle;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="5"/>`);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="2.5"/>`);
      }
      parts.push(drawLines('#fff', 5), drawLines(colour, 2.5));
      if (sym.kind === 'inclined') {
        parts.push(`<text x="${sym.label.x}" y="${sym.label.y}" class="dip-label" fill="${colour}">${station.dip}</text>`);
      }
    }
    parts.push(`<circle cx="${size / 2}" cy="${size / 2}" r="5" fill="${colour}" stroke="#fff" stroke-width="2"/>`);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${parts.join('')}</svg>`;
  }

  function drawStation(station) {
    const icon = L.divIcon({
      className: 'station-icon',
      html: symbolSvg(station),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -16],
    });
    let marker = markers.get(station.uuid);
    if (marker) {
      marker.setLatLng([station.latitude, station.longitude]).setIcon(icon);
    } else {
      marker = L.marker([station.latitude, station.longitude], { icon, keyboard: true, title: station.stationId })
        .addTo(layer);
      markers.set(station.uuid, marker);
    }
    marker.bindPopup(() => popupContent(station.uuid), { minWidth: 240, maxWidth: 320 });
  }

  function attitudeText(s) {
    if (s.strike === null) return 'not measured';
    return `${formatAzimuth(s.strike)}/${s.dip} (RHR), dip direction ${formatAzimuth(s.dipDirection)}`;
  }

  function elevationText(s) {
    if (s.elevation === null) return s.elevationNote || 'not available';
    return `${s.elevation.toFixed(1)} m (DEM${s.elevationDem ? ` "${s.elevationDem}"` : ''}, bilinear)`;
  }

  function popupContent(uuid) {
    const s = stations.find((x) => x.uuid === uuid);
    const box = document.createElement('div');
    box.className = 'station-popup';
    const h = document.createElement('h3');
    h.textContent = `${s.isTest ? 'TEST DATA · ' : ''}${s.stationId} · ${s.featureType}`;
    const dl = document.createElement('dl');
    const rows = [
      ['Strike/dip', attitudeText(s)],
      ['Younging known', s.younging],
      ['Lithology', s.lithology || '—'],
      ['Notes', s.notes || '—'],
      ['Lat / Long', `${s.latitude.toFixed(6)}°, ${s.longitude.toFixed(6)}°`],
      ['GPS accuracy', s.accuracy === null ? 'not recorded' : `± ${s.accuracy} m`],
      ['Elevation', elevationText(s)],
      ['Recorded', localTimeText(s.createdAt, s.tzOffsetMinutes)],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const predict = document.createElement('button');
    predict.type = 'button';
    predict.className = 'btn wide';
    predict.textContent = 'Predict trace';
    predict.addEventListener('click', () => { map.closePopup(); onPredictTrace(s); });
    const actions = document.createElement('div');
    actions.className = 'popup-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => { map.closePopup(); openForm(s); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => removeStation(s));
    actions.append(predict, edit, del);
    box.append(h, dl, actions);
    return box;
  }

  async function removeStation(s) {
    if (!window.confirm(`Delete station ${s.stationId}? This cannot be undone.`)) return;
    try {
      await deleteStation(s.uuid);
    } catch (e) {
      showMessage(`Station ${s.stationId} could not be deleted: ${e.message || e.name}`, 'error');
      return;
    }
    map.closePopup();
    stations = stations.filter((x) => x.uuid !== s.uuid);
    layer.removeLayer(markers.get(s.uuid));
    markers.delete(s.uuid);
    updateCounter();
    showMessage(`Station ${s.stationId} deleted.`, 'ok');
  }

  // ---------- Form ----------

  /** Elevation for the location currently in the form: { value, note, demName }. */
  function formElevation() {
    const lat = Number(field('latitude').value.replace(',', '.'));
    const lon = Number(field('longitude').value.replace(',', '.'));
    const latText = field('latitude').value.trim();
    const lonText = field('longitude').value.trim();
    if (!latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { value: null, note: 'Needs a valid location.' };
    }
    const dem = getDem();
    if (!dem) {
      // Keep the elevation measured earlier if an edited station has not moved.
      if (editing && editing.latitude === lat && editing.longitude === lon && editing.elevation !== null) {
        return { value: editing.elevation, note: null, demName: editing.elevationDem };
      }
      return { value: null, note: 'No DEM loaded, so no elevation.' };
    }
    const r = elevationAt(dem.grid, dem.elevation, lat, lon);
    return r.ok ? { value: r.elevation, note: null, demName: dem.name } : { value: null, note: r.message };
  }

  function updateElevation() {
    const e = formElevation();
    el.elevation.textContent = e.value === null
      ? e.note
      : `${e.value.toFixed(1)} m (from DEM${e.demName ? ` "${e.demName}"` : ''}, bilinear)`;
    el.elevation.classList.toggle('note', e.value === null);
  }

  function updateDipDirection() {
    const text = field('strike').value;
    if (!text.trim()) {
      el.dipDir.textContent = 'Dip direction: type a strike';
      el.dipDir.classList.remove('bad');
      return;
    }
    const s = checkStrike(text);
    if (s.ok) {
      el.dipDir.textContent = `Dip direction: ${formatAzimuth(dipDirectionFromStrike(s.value))}°`;
      el.dipDir.classList.remove('bad');
    } else {
      el.dipDir.textContent = s.message;
      el.dipDir.classList.add('bad');
    }
  }

  function fillLocationFromGps() {
    const p = getPosition();
    if (!p) {
      el.locationNote.textContent = 'No GPS fix yet. Tap "My location" on the main screen first, or type the coordinates.';
      el.locationNote.classList.add('bad');
      return;
    }
    field('latitude').value = p.latitude.toFixed(6);
    field('longitude').value = p.longitude.toFixed(6);
    field('accuracy').value = String(Math.round(p.accuracy * 10) / 10);
    el.locationNote.textContent = 'Filled from your current GPS position.';
    el.locationNote.classList.remove('bad');
    updateElevation();
  }

  function clearErrors() {
    el.errors.hidden = true;
    el.errors.replaceChildren();
    for (const input of el.form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  }

  function openForm(station = null) {
    editing = station;
    el.form.reset();
    clearErrors();
    if (station) {
      el.title.textContent = `Edit station ${station.stationId}`;
      draftTime = null;
      el.datetime.textContent = `Recorded ${localTimeText(station.createdAt, station.tzOffsetMinutes)}`;
      for (const name of ['stationId', 'latitude', 'longitude', 'accuracy', 'strike', 'dip', 'lithology', 'notes']) {
        const v = station[name];
        field(name).value = v === null || v === undefined ? '' : String(v);
      }
      field('featureType').value = station.featureType;
      field('younging').value = station.younging;
      el.locationNote.textContent = 'Saved location. Tap "Use my location" to replace it.';
      el.locationNote.classList.remove('bad');
    } else {
      el.title.textContent = 'New station';
      const now = new Date();
      draftTime = { createdAt: now.toISOString(), tzOffsetMinutes: -now.getTimezoneOffset() };
      el.datetime.textContent = `Date and time: ${localTimeText(draftTime.createdAt, draftTime.tzOffsetMinutes)}`;
      const last = stations[stations.length - 1];
      field('stationId').value = nextStationId(last && last.stationId, stations.map((s) => s.stationId));
      field('younging').value = 'unknown';
      fillLocationFromGps();
    }
    updateElevation();
    updateDipDirection();
    el.sheet.hidden = false;
    el.sheet.scrollTop = 0;
  }

  function closeForm() {
    el.sheet.hidden = true;
    editing = null;
  }

  function showErrors(errors) {
    el.errors.replaceChildren();
    const p = document.createElement('p');
    p.textContent = errors.length === 1 ? 'Please fix this:' : 'Please fix these:';
    const ul = document.createElement('ul');
    for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = e.message;
      ul.append(li);
      const input = field(e.field);
      if (input && input.setAttribute) input.setAttribute('aria-invalid', 'true');
    }
    el.errors.append(p, ul);
    el.errors.hidden = false;
    el.errors.scrollIntoView({ block: 'start' });
  }

  async function submitForm(event) {
    event.preventDefault();
    clearErrors();
    const raw = {};
    for (const name of ['stationId', 'latitude', 'longitude', 'accuracy', 'featureType', 'strike', 'dip', 'younging', 'lithology', 'notes']) {
      raw[name] = field(name).value;
    }
    const otherIds = stations.filter((s) => !editing || s.uuid !== editing.uuid).map((s) => s.stationId);
    const result = checkStationInput(raw, otherIds);
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    const v = result.values;
    const elev = formElevation();
    let utm = null;
    try {
      utm = toUtm(v.latitude, v.longitude);
    } catch {
      utm = null; // outside the UTM range (polar); lat/long are still saved
    }
    const now = new Date().toISOString();
    const station = {
      ...(editing || {}),
      ...v,
      uuid: editing ? editing.uuid : newUuid(),
      createdAt: editing ? editing.createdAt : draftTime.createdAt,
      tzOffsetMinutes: editing ? editing.tzOffsetMinutes : draftTime.tzOffsetMinutes,
      updatedAt: editing ? now : null,
      elevation: elev.value,
      elevationNote: elev.note,
      elevationDem: elev.demName || null,
      utm,
      isTest: editing ? editing.isTest === true : false,
    };
    try {
      await saveStation(station);
    } catch (e) {
      showErrors([{ field: 'stationId', message: `Could not save on this device: ${e.message || e.name}` }]);
      return;
    }
    const i = stations.findIndex((s) => s.uuid === station.uuid);
    if (i >= 0) stations[i] = station; else stations.push(station);
    drawStation(station);
    updateCounter();
    closeForm();
    const warn = station.elevation === null ? ` No elevation: ${station.elevationNote}` : '';
    showMessage(`Station ${station.stationId} saved.${warn}`, warn ? 'error' : 'ok');
  }

  function newUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // ---------- Export ----------

  function exportFiles() {
    const stamp = fileStamp();
    return [
      { name: `stations_${stamp}.csv`, text: stationsToCsv(stations), type: 'text/csv' },
      { name: `stations_${stamp}.geojson`, text: stationsToGeoJson(stations), type: 'application/geo+json' },
      { name: `stations_${stamp}.kml`, text: stationsToKml(stations), type: 'application/vnd.google-earth.kml+xml' },
    ];
  }

  async function recordExport() {
    lastExport = { time: new Date().toISOString(), count: stations.length };
    try {
      await setMeta('lastExport', lastExport);
    } catch {
      // The counter still shows it for this session.
    }
    updateCounter();
  }

  async function exportStations() {
    if (!stations.length) {
      showMessage('There are no stations to export yet.', 'error');
      return;
    }
    const n = stations.length;
    const outcome = await shareOrDownload(exportFiles(), 'Field stations');
    if (outcome === 'cancelled') {
      showMessage('Export cancelled. Nothing was saved.', 'error');
      return;
    }
    await recordExport();
    if (outcome === 'shared') {
      showMessage(`Exported ${n} station${n === 1 ? '' : 's'} (CSV, GeoJSON, KML).`, 'ok');
    } else {
      showMessage('Sharing is not available here, so the 3 files (CSV, GeoJSON, KML) were downloaded instead. ' +
        'If only one appears, allow multiple downloads when the browser asks.', 'ok');
    }
  }

  // ---------- Test data ----------

  async function addTestStations() {
    const dem = getDem();
    if (!dem) {
      showMessage('Load a DEM first: the test stations are placed around its centre.', 'error');
      return;
    }
    if (stations.some((s) => s.isTest === true)) {
      showMessage('Test stations are already loaded. Use "Delete all test stations" first if you want fresh ones.', 'error');
      return;
    }
    const { stations: placed, problems } = placeTestStations(dem.grid, dem.elevation);
    const usedIds = new Set(stations.map((s) => s.stationId));
    const added = [];
    for (const p of placed) {
      if (usedIds.has(p.stationId)) {
        problems.push({ stationId: p.stationId, message: `${p.stationId} not added: you already have a station called ${p.stationId}.` });
        continue;
      }
      const now = new Date();
      let utm = null;
      try { utm = toUtm(p.latitude, p.longitude); } catch { utm = null; }
      const station = {
        ...p,
        uuid: newUuid(),
        createdAt: now.toISOString(),
        tzOffsetMinutes: -now.getTimezoneOffset(),
        updatedAt: null,
        elevationNote: null,
        elevationDem: dem.name,
        utm,
      };
      try {
        await saveStation(station);
      } catch (e) {
        problems.push({ stationId: p.stationId, message: `${p.stationId} not added: could not save (${e.message || e.name}).` });
        continue;
      }
      stations.push(station);
      drawStation(station);
      added.push(station);
    }
    updateCounter();
    if (added.length) {
      map.fitBounds(L.latLngBounds(added.map((s) => [s.latitude, s.longitude])).pad(0.3), { animate: false });
    }
    const problemText = problems.map((p) => p.message).join(' ');
    showMessage(`Added ${added.length} TEST DATA station${added.length === 1 ? '' : 's'} (pink) around the DEM centre.` +
      (problemText ? ` ${problemText}` : ''), problems.length ? 'error' : 'ok');
  }

  async function deleteTestStations() {
    const tests = stations.filter((s) => s.isTest === true);
    if (!tests.length) {
      showMessage('There are no test stations to delete.', 'error');
      return;
    }
    if (!window.confirm(`Delete all ${tests.length} test stations? Your real stations will not be touched.`)) return;
    map.closePopup();
    let failed = 0;
    for (const s of tests) {
      try {
        await deleteStation(s.uuid);
      } catch {
        failed++;
        continue;
      }
      stations = stations.filter((x) => x.uuid !== s.uuid);
      layer.removeLayer(markers.get(s.uuid));
      markers.delete(s.uuid);
    }
    updateCounter();
    showMessage(failed
      ? `Deleted ${tests.length - failed} test stations; ${failed} could not be deleted. Try again.`
      : `Deleted all ${tests.length} test stations. Real stations were not touched.`, failed ? 'error' : 'ok');
  }

  // ---------- Wiring ----------

  el.newBtn.addEventListener('click', () => openForm(null));
  el.exportBtn.addEventListener('click', exportStations);
  $('load-test-stations').addEventListener('click', addTestStations);
  $('delete-test-stations').addEventListener('click', deleteTestStations);
  el.cancel.addEventListener('click', closeForm);
  el.useLocation.addEventListener('click', fillLocationFromGps);
  el.form.addEventListener('submit', submitForm);
  field('strike').addEventListener('input', updateDipDirection);
  field('latitude').addEventListener('input', updateElevation);
  field('longitude').addEventListener('input', updateElevation);
  for (const name of ['latitude', 'longitude', 'accuracy']) {
    field(name).addEventListener('input', () => {
      el.locationNote.textContent = 'Typed by hand.';
      el.locationNote.classList.remove('bad');
    });
  }
  // Fill the feature-type list from the shared list of types.
  const select = field('featureType');
  for (const t of FEATURE_TYPES) select.append(new Option(t[0].toUpperCase() + t.slice(1), t));

  return {
    /** Loads saved stations and draws them. */
    async load(persistResult) {
      storageProtected = persistResult;
      try {
        stations = await loadStations();
        lastExport = (await getMeta('lastExport')) || null;
      } catch (e) {
        el.counter.textContent = `Saved stations could not be read: ${e.message || e.name}`;
        el.counter.classList.add('warn');
        return;
      }
      stations.forEach(drawStation);
      updateCounter();
    },
    /** Call when a DEM is loaded, so an open form can show the elevation. */
    demChanged() {
      if (!el.sheet.hidden) updateElevation();
    },
  };
}
