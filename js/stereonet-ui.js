// Stereonet tab: choose stations, plot poles (and lineations), show the fold analysis, export.

import { analyseFold, meanLine, angleBetweenLines } from './geo/fold.js';
import { stereonetSvg, poleOfPlane, planePerpendicularTo } from './geo/stereonet.js';
import { makeAreaTest } from './geo/area.js';
import { formatAzimuth } from './geo/attitude.js';
import { FEATURE_TYPES } from './geo/station.js';
import { shareOrDownload, fileStamp } from './share.js';

const $ = (id) => document.getElementById(id);
const f0 = (v) => formatAzimuth(Math.round(v));
const r0 = (v) => Math.round(v);

/**
 * getStations(): list of saved stations; area: the map-area tool (area-ui.js);
 * showTab(name): switches tabs; showMessage(text, kind)
 */
export function initStereonet({ getStations, area, showTab, showMessage }) {
  const el = {
    feature: $('sn-feature'),
    sets: document.querySelectorAll('input[name="sn-set"]'),
    ticks: $('sn-ticks'),
    areaControls: $('sn-area-controls'),
    drawArea: $('sn-draw-area'),
    clearArea: $('sn-clear-area'),
    areaNote: $('sn-area-note'),
    tests: $('sn-tests'),
    planes: $('sn-planes'),
    lineations: $('sn-lineations'),
    figure: $('sn-figure'),
    results: $('sn-results'),
    exportPng: $('sn-export-png'),
    exportSvg: $('sn-export-svg'),
  };

  const ticked = new Set(); // uuids ticked by hand
  let lastSvg = '';
  let pngBlob = null;
  let pngFor = '';

  for (const t of FEATURE_TYPES) {
    if (t === 'lineation') continue; // lineations are shown with their own switch
    el.feature.append(new Option(t[0].toUpperCase() + t.slice(1), t));
  }
  el.feature.value = 'bedding';

  const chosenSet = () => [...el.sets].find((r) => r.checked).value;

  /** Stations chosen by the filters (any feature type), plus counts of what was left out. */
  function chosenStations() {
    const all = getStations();
    const hiddenTests = el.tests.checked ? 0 : all.filter((s) => s.isTest === true).length;
    let list = el.tests.checked ? all : all.filter((s) => s.isTest !== true);
    const set = chosenSet();
    let problem = null;
    if (set === 'ticked') {
      list = list.filter((s) => ticked.has(s.uuid));
    } else if (set === 'area') {
      const a = area.getArea();
      if (!a) {
        problem = 'No area drawn yet. Tap "Draw area on map".';
        list = [];
      } else {
        const inside = makeAreaTest(a);
        list = list.filter((s) => inside(s.latitude, s.longitude));
      }
    }
    return { list, hiddenTests, problem };
  }

  function renderTicks() {
    const feature = el.feature.value;
    const all = getStations().filter((s) => (el.tests.checked || s.isTest !== true) &&
      (s.featureType === feature || s.featureType === 'lineation'));
    el.ticks.replaceChildren();
    if (!all.length) {
      el.ticks.textContent = 'No stations of this type yet.';
      return;
    }
    for (const s of all) {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = ticked.has(s.uuid);
      box.addEventListener('change', () => { if (box.checked) ticked.add(s.uuid); else ticked.delete(s.uuid); render(false); });
      const att = s.featureType === 'lineation'
        ? (s.trend === null || s.trend === undefined ? 'lineation, not measured' : `${f0(s.trend)}/${s.plunge} ${s.lineationType}`)
        : s.strike === null ? 'no attitude' : `${f0(s.strike)}/${s.dip}`;
      label.append(box, ` ${s.isTest ? 'TEST ' : ''}${s.stationId} · ${att}`);
      el.ticks.append(label);
    }
  }

  function addRow(dl, label, value, cls) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }

  /** Redraws everything; rebuildTicks = false keeps the tick list as it is (and where it is scrolled). */
  function render(rebuildTicks = true) {
    const set = chosenSet();
    el.ticks.hidden = set !== 'ticked';
    el.areaControls.hidden = set !== 'area';
    const a = area.getArea();
    el.areaNote.textContent = a ? `Area with ${a.length} corners is saved.` : 'No area drawn yet.';
    if (set === 'ticked' && rebuildTicks) renderTicks();

    const feature = el.feature.value;
    const { list, hiddenTests, problem } = chosenStations();
    const planesData = list.filter((s) => s.featureType === feature && s.strike !== null && s.dip !== null);
    const noAttitude = list.filter((s) => s.featureType === feature && (s.strike === null || s.dip === null)).length;
    const lineations = el.lineations && el.lineations.checked
      ? list.filter((s) => s.featureType === 'lineation' && s.trend !== null && s.trend !== undefined)
      : [];

    const isBedding = feature === 'bedding';
    const analysis = planesData.length ? analyseFold(planesData) : analyseFold([]);
    const hingeLike = lineations.filter((s) => s.lineationType === 'hinge line' || s.lineationType === 'intersection lineation');
    const meanHinge = hingeLike.length ? meanLine(hingeLike) : null;

    const notes = [];
    notes.push(`${planesData.length} ${feature} pole${planesData.length === 1 ? '' : 's'}` +
      (lineations.length ? `, ${lineations.length} lineation${lineations.length === 1 ? '' : 's'}` : '') +
      (el.tests.checked && list.some((s) => s.isTest) ? ' (includes TEST DATA)' : ''));
    if (isBedding && analysis.axis) {
      notes.push(`Fold axis (from bedding poles): ${f0(analysis.axis.trend)}/${r0(analysis.axis.plunge)}`);
      if (analysis.limbs) {
        notes.push(`Interlimb, outermost limb readings: ${r0(analysis.limbs.outermost)}° (${analysis.limbs.fleutyOutermost})`);
        notes.push(`Interlimb, mean limb attitudes: ${r0(analysis.limbs.mean)}° (${analysis.limbs.fleutyMean})`);
      }
    }
    if (meanHinge) notes.push(`Mean hinge/intersection lineation: ${f0(meanHinge.trend)}/${r0(meanHinge.plunge)}`);
    if (isBedding) for (const w of analysis.warnings) notes.push(`WARNING: ${w.split('. ')[0]}.`);

    const svg = stereonetSvg({
      title: `${feature[0].toUpperCase() + feature.slice(1)} — lower hemisphere, equal area`,
      subtitle: `Field Geology Tools · ${new Date().toLocaleDateString()}`,
      poles: planesData.map((s) => ({ ...poleOfPlane(s.strike, s.dip), isTest: s.isTest === true })),
      planes: el.planes.checked ? planesData.map((s) => ({ strike: s.strike, dip: s.dip })) : [],
      lineations: lineations.map((s) => ({ trend: s.trend, plunge: s.plunge, isTest: s.isTest === true })),
      axis: isBedding ? analysis.axis : null,
      girdle: isBedding && analysis.axis ? planePerpendicularTo(analysis.axis.trend, analysis.axis.plunge) : null,
      meanLineation: meanHinge,
      notes,
    });
    lastSvg = svg;
    el.figure.innerHTML = svg;
    preparePng(svg);

    // ---- Results panel ----
    el.results.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'field-note';
    const parts = [`${planesData.length} ${feature} pole${planesData.length === 1 ? '' : 's'} plotted`];
    if (lineations.length) parts.push(`${lineations.length} lineation${lineations.length === 1 ? '' : 's'} (triangles)`);
    if (noAttitude) parts.push(`${noAttitude} without strike/dip left out`);
    if (hiddenTests) parts.push(`${hiddenTests} test station${hiddenTests === 1 ? '' : 's'} hidden`);
    intro.textContent = `${parts.join(', ')}.`;
    el.results.append(intro);
    if (problem) appendWarning(problem);

    if (planesData.length >= 2) {
      const dl = document.createElement('dl');
      dl.className = 'readout';
      const [e1, e2, e3] = analysis.eigen;
      addRow(dl, 'Eigenvalues', `λ1 ${e1.value.toFixed(3)}, λ2 ${e2.value.toFixed(3)}, λ3 ${e3.value.toFixed(3)}`);
      addRow(dl, 'Eigenvectors', `${f0(e1.trend)}/${r0(e1.plunge)}, ${f0(e2.trend)}/${r0(e2.plunge)}, ${f0(e3.trend)}/${r0(e3.plunge)}`);
      const ratio = (a, b) => (b > 0 ? (a / b).toFixed(1) : '∞');
      addRow(dl, 'Ratios', `λ1/λ2 = ${ratio(e1.value, e2.value)}, λ2/λ3 = ${ratio(e2.value, e3.value)}, ` +
        `K = ${Number.isFinite(analysis.K) ? analysis.K.toFixed(2) : '∞'} (${analysis.shape}: K < 1 girdle, K > 1 cluster)`);
      if (isBedding) {
        if (analysis.axis) {
          addRow(dl, 'Fold axis', `${f0(analysis.axis.trend)}/${r0(analysis.axis.plunge)} (trend/plunge)`, 'big');
          const g = planePerpendicularTo(analysis.axis.trend, analysis.axis.plunge);
          addRow(dl, 'π-girdle', `${f0(g.strike)}/${r0(g.dip)} (red dashed great circle)`);
          addRow(dl, 'Cylindrical fit', analysis.fitNote);
          if (analysis.limbs) {
            addRow(dl, 'Interlimb angle (a) from outermost limb readings',
              `${r0(analysis.limbs.outermost)}° — ${analysis.limbs.fleutyOutermost} (Fleuty 1964)`, 'big');
            addRow(dl, 'Interlimb angle (b) from mean limb attitudes',
              `${r0(analysis.limbs.mean)}° — ${analysis.limbs.fleutyMean} (Fleuty 1964)`, 'big');
            addRow(dl, 'Note', 'Dips are 0–90° (right-hand rule), so an overturned limb looks like an upright one. ' +
              'For tight or overturned folds, check younging before trusting these angles.', 'note');
          }
        }
        if (meanHinge && analysis.axis) {
          addRow(dl, 'Mean hinge/intersection lineation', `${f0(meanHinge.trend)}/${r0(meanHinge.plunge)} from ${hingeLike.length} reading${hingeLike.length === 1 ? '' : 's'}`);
          addRow(dl, 'Angle to fold axis', `${angleBetweenLines(meanHinge, analysis.axis).toFixed(1)}°`, 'big');
        }
      } else {
        addRow(dl, 'Fold axis', 'Only worked out for bedding.', 'note');
      }
      el.results.append(dl);
    }
    if (meanHinge && !(isBedding && analysis.axis && planesData.length >= 2)) {
      const p = document.createElement('p');
      p.textContent = `Mean hinge/intersection lineation: ${f0(meanHinge.trend)}/${r0(meanHinge.plunge)} (${hingeLike.length} readings). ` +
        'No fold axis from bedding to compare it with.';
      el.results.append(p);
    }
    if (isBedding) for (const w of analysis.warnings) appendWarning(w);
  }

  function appendWarning(text) {
    const w = document.createElement('div');
    w.className = 'message error';
    w.textContent = `Warning: ${text}`;
    el.results.append(w);
  }

  /** Makes the PNG in advance, so the share sheet can open straight after the tap (iOS rule). */
  function preparePng(svg) {
    pngBlob = null;
    pngFor = svg;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 3;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale || 1320;
      canvas.height = img.naturalHeight * scale || 1500;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => { if (pngFor === svg) pngBlob = blob; }, 'image/png');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  async function exportImage(kind) {
    const name = `stereonet_${el.feature.value}_${fileStamp()}.${kind}`;
    let file;
    if (kind === 'svg') {
      file = { name, text: lastSvg, type: 'image/svg+xml' };
    } else {
      if (!pngBlob) {
        showMessage('The PNG is still being prepared. Tap "Export PNG" again in a moment.', 'error');
        return;
      }
      file = { name, blob: pngBlob, type: 'image/png' };
    }
    const outcome = await shareOrDownload([file], 'Stereonet');
    if (outcome === 'cancelled') showMessage('Stereonet export cancelled.', 'error');
    else showMessage(outcome === 'shared' ? 'Stereonet exported.' : 'Stereonet downloaded.', 'ok');
  }

  el.feature.addEventListener('change', () => render());
  el.sets.forEach((r) => r.addEventListener('change', () => render()));
  for (const box of [el.tests, el.planes, el.lineations]) if (box) box.addEventListener('change', () => render());
  el.drawArea.addEventListener('click', () => {
    showTab('map');
    area.start(() => showTab('stereonet'));
  });
  el.clearArea.addEventListener('click', async () => { await area.clear(); render(); });
  el.exportPng.addEventListener('click', () => exportImage('png'));
  el.exportSvg.addEventListener('click', () => exportImage('svg'));

  return { render };
}

