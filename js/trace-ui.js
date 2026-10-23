// Outcrop trace predictor on the map: runs the prediction, draws the traces,
// and handles the "Clear traces" and "Export traces (KML)" buttons.

import { uncertaintyAttitudes, predictTraces, checkUncertainty, MAX_UNCERTAINTY } from './geo/trace.js';
import { formatAzimuth, dipDirectionFromStrike } from './geo/attitude.js';
import { tracesToKml } from './geo/export.js';
import { getMeta, setMeta } from './storage.js';
import { shareOrDownload, fileStamp } from './share.js';

const DEFAULT_DELTA = 3;
const MAX_DELTA = MAX_UNCERTAINTY;
const TRACE_COLOURS = ['#ff3b30', '#ff9500', '#d000ff', '#00a3ff', '#00c853'];

const $ = (id) => document.getElementById(id);

/**
 * map: the Leaflet map; showMessage(text, kind); getDem(): loaded DEM or null
 */
export function initTraces({ map, showMessage, getDem }) {
  const el = {
    box: $('trace-box'),
    list: $('trace-list'),
    clamped: $('trace-clamped'),
    clear: $('clear-traces'),
    exportBtn: $('export-traces'),
    delta: $('trace-delta'),
    deltaSave: $('trace-delta-save'),
    deltaNote: $('trace-delta-note'),
  };

  let delta = DEFAULT_DELTA;
  let busy = false;
  const sets = []; // { stationId, strike, dip, delta, colour, traces, layer }
  const renderer = L.canvas({ padding: 0.5 });
  const legend = makeLegend();

  // ---------- Background worker ----------

  let worker = null;
  let nextId = 1;
  const waiting = new Map();
  try {
    worker = new Worker(new URL('./trace-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (job) job.resolve(e.data.result);
    };
    worker.onerror = () => {
      // The worker could not start: run any waiting job (and later ones) on the main thread.
      worker = null;
      for (const [id, job] of waiting) {
        waiting.delete(id);
        job.resolve(predictTraces(...job.args));
      }
    };
  } catch {
    worker = null;
  }

  function runPrediction(dem, station, attitudes) {
    if (!worker) return Promise.resolve(predictTraces(dem.grid, dem.elevation, station, attitudes));
    return new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, { resolve, args: [dem.grid, dem.elevation, station, attitudes] });
      worker.postMessage({ id, grid: dem.grid, elevation: dem.elevation, station, attitudes });
    });
  }

  // ---------- Settings ----------

  async function loadSettings() {
    try {
      const saved = await getMeta('traceUncertaintyDeg');
      if (typeof saved === 'number') delta = saved;
    } catch {
      // keep the default
    }
    el.delta.value = String(delta);
  }

  async function saveDelta() {
    const check = checkUncertainty(el.delta.value);
    if (!check.ok) {
      el.deltaNote.textContent = check.message;
      el.deltaNote.classList.add('bad');
      return;
    }
    delta = check.value;
    el.deltaNote.textContent = `Saved: new predictions use ±${delta}°.`;
    el.deltaNote.classList.remove('bad');
    try {
      await setMeta('traceUncertaintyDeg', delta);
    } catch (e) {
      el.deltaNote.textContent = `Used for now, but not saved for next time (${e.message || e.name}).`;
    }
  }

  // ---------- Prediction ----------

  async function predict(station) {
    const dem = getDem();
    if (!dem) {
      showMessage('Load a DEM first: the trace is worked out from the DEM.', 'error');
      return;
    }
    if (station.strike === null || station.dip === null) {
      showMessage(`Station ${station.stationId} has no strike and dip, so no trace can be predicted.`, 'error');
      return;
    }
    if (busy) {
      showMessage('Still working on the previous trace. Please wait a moment.', 'error');
      return;
    }
    busy = true;
    showMessage(`Predicting the trace for ${station.stationId}… This can take several seconds on a large DEM.`);
    const attitudes = uncertaintyAttitudes(station.strike, station.dip, delta);
    let result;
    try {
      result = await runPrediction(dem, { latitude: station.latitude, longitude: station.longitude }, attitudes);
    } catch (e) {
      result = { ok: false, message: e.message };
    } finally {
      busy = false;
    }
    if (!result.ok) {
      showMessage(`No trace for ${station.stationId}: ${result.message}`, 'error');
      return;
    }

    // Replace any earlier traces for the same station.
    const old = sets.findIndex((s) => s.stationId === station.stationId);
    if (old >= 0) removeSet(old);

    const colour = TRACE_COLOURS[sets.length % TRACE_COLOURS.length];
    const layer = L.layerGroup().addTo(map);
    for (const t of result.traces) {
      const measured = t.key === 'measured';
      for (const line of t.lines) {
        L.polyline(line.map((p) => [p.lat, p.lon]), {
          renderer,
          color: colour,
          weight: measured ? 4 : 2,
          opacity: measured ? 1 : 0.85,
          dashArray: measured ? null : '8 7',
          interactive: false,
        }).addTo(layer);
      }
    }
    sets.push({
      stationId: station.stationId,
      strike: station.strike,
      dip: station.dip,
      delta,
      colour,
      traces: result.traces,
      layer,
      clamped: result.traces.some((t) => t.clamped),
    });
    renderBox();
    const points = result.traces[0].lines.reduce((n, l) => n + l.length, 0);
    showMessage(points
      ? `Predicted trace for ${station.stationId} drawn (solid = measured, dashed = ±${delta}°). It assumes a planar surface.`
      : `The plane through ${station.stationId} does not cross the ground anywhere else on this DEM.`, points ? 'ok' : 'error');
  }

  function removeSet(i) {
    map.removeLayer(sets[i].layer);
    sets.splice(i, 1);
  }

  function clearTraces() {
    while (sets.length) removeSet(0);
    renderBox();
    showMessage('Predicted traces cleared.');
  }

  // ---------- Panel box and map legend ----------

  function renderBox() {
    el.list.replaceChildren();
    for (const s of sets) {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = s.colour;
      li.append(swatch, `${s.stationId}: ${formatAzimuth(s.strike)}/${s.dip}, dip direction ` +
        `${formatAzimuth(dipDirectionFromStrike(s.strike))}; dashed = dip ±${s.delta}°, strike ±${s.delta}°`);
      el.list.append(li);
    }
    const clamped = sets.filter((s) => s.clamped).map((s) => s.stationId);
    el.clamped.hidden = clamped.length === 0;
    el.clamped.textContent = clamped.length
      ? `For ${clamped.join(', ')} the dip range was cut at 0° or 90°, so one dashed line is missing or matches another.`
      : '';
    el.box.hidden = sets.length === 0;
    if (sets.length) legend.addTo(map); else legend.remove();
  }

  function makeLegend() {
    const Legend = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'trace-legend');
        div.innerHTML = '<strong>PREDICTED traces</strong><br>Assume a planar surface';
        return div;
      },
    });
    return new Legend();
  }

  async function exportTraces() {
    if (!sets.length) {
      showMessage('There are no predicted traces to export.', 'error');
      return;
    }
    const files = [{
      name: `predicted_traces_${fileStamp()}.kml`,
      text: tracesToKml(sets),
      type: 'application/vnd.google-earth.kml+xml',
    }];
    const outcome = await shareOrDownload(files, 'Predicted outcrop traces');
    if (outcome === 'cancelled') showMessage('Trace export cancelled. Nothing was saved.', 'error');
    else if (outcome === 'shared') showMessage('Predicted traces exported as KML.', 'ok');
    else showMessage('Sharing is not available here, so the KML file was downloaded instead.', 'ok');
  }

  el.clear.addEventListener('click', clearTraces);
  el.exportBtn.addEventListener('click', exportTraces);
  el.deltaSave.addEventListener('click', saveDelta);
  loadSettings();

  return {
    predict,
    getDelta: () => delta,
    /** Uses and saves a new uncertainty (from a restored backup). Ignores impossible values. */
    async setDelta(v) {
      if (!(typeof v === 'number' && v > 0 && v <= MAX_DELTA)) return;
      delta = v;
      el.delta.value = String(v);
      try { await setMeta('traceUncertaintyDeg', v); } catch { /* used for this session */ }
    },
    /** A new DEM makes old traces meaningless, so remove them. */
    demChanged() {
      if (sets.length) {
        while (sets.length) removeSet(0);
        renderBox();
      }
    },
  };
}
