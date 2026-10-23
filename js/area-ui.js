// Drawing an area on the map (used to choose stations for the stereonet).
// Tap corners on the map, then "Done". The area is remembered on this device.

import { getMeta, setMeta } from './storage.js';

export function initArea({ map, showMessage }) {
  let area = null; // [{ lat, lon }] or null
  let drawing = null; // { points, onDone }
  const shape = L.layerGroup().addTo(map);

  const Banner = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'map-banner');
      div.innerHTML = '<p>Tap the map to add corners of the area.</p>' +
        '<div class="banner-actions"><button type="button" class="btn secondary" data-a="undo">Undo</button>' +
        '<button type="button" class="btn secondary" data-a="cancel">Cancel</button>' +
        '<button type="button" class="btn" data-a="done">Done</button></div>';
      L.DomEvent.disableClickPropagation(div);
      div.addEventListener('click', (e) => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === 'undo' && drawing) { drawing.points.pop(); redraw(drawing.points); }
        if (a === 'cancel') finish(false);
        if (a === 'done') finish(true);
      });
      return div;
    },
  });
  const banner = new Banner();

  function redraw(points) {
    shape.clearLayers();
    if (!points || !points.length) return;
    const latlngs = points.map((p) => [p.lat, p.lon]);
    if (points.length >= 3) {
      L.polygon(latlngs, { color: '#ffd166', weight: 3, dashArray: '8 6', fillOpacity: 0.08, interactive: false }).addTo(shape);
    } else {
      L.polyline(latlngs, { color: '#ffd166', weight: 3, dashArray: '8 6', interactive: false }).addTo(shape);
    }
    for (const ll of latlngs) L.circleMarker(ll, { radius: 6, color: '#000', fillColor: '#ffd166', fillOpacity: 1, interactive: false }).addTo(shape);
  }

  function onMapClick(e) {
    if (!drawing) return;
    drawing.points.push({ lat: e.latlng.lat, lon: e.latlng.lng });
    redraw(drawing.points);
  }

  async function finish(ok) {
    if (!drawing) return;
    const { points, onDone } = drawing;
    drawing = null;
    map.off('click', onMapClick);
    banner.remove();
    if (ok && points.length < 3) {
      showMessage('An area needs at least 3 corners. Nothing was changed.', 'error');
      redraw(area);
      onDone(false);
      return;
    }
    if (ok) {
      area = points;
      try { await setMeta('stereonetArea', area); } catch { /* still used for this session */ }
      showMessage(`Area saved with ${area.length} corners. Go back to the Stereonet tab to see the result.`, 'ok');
    } else {
      showMessage('Drawing cancelled.');
    }
    redraw(area);
    onDone(ok);
  }

  return {
    async load() {
      try { area = (await getMeta('stereonetArea')) || null; } catch { area = null; }
      redraw(area);
    },
    getArea: () => area,
    /** Starts drawing; calls onDone(true/false) when finished. */
    start(onDone) {
      if (drawing) return;
      drawing = { points: [], onDone };
      shape.clearLayers();
      banner.addTo(map);
      map.on('click', onMapClick);
    },
    async clear() {
      area = null;
      redraw(null);
      try { await setMeta('stereonetArea', null); } catch { /* ignore */ }
    },
  };
}
