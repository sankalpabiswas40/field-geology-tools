// "Backup" and "Restore" buttons, and the storage-used display.

import { makeBackup, parseBackup, planRestore, laterExport, storageStatus } from './geo/backup.js';
import { getMeta, setMeta } from './storage.js';
import { shareOrDownload, fileStamp } from './share.js';

const $ = (id) => document.getElementById(id);

/** stationsUi, tracesUi, areaUi: the other parts of the app; showMessage(text, kind) */
export function initBackup({ stationsUi, tracesUi, areaUi, showMessage }) {
  const el = {
    backup: $('backup'),
    restore: $('restore'),
    file: $('restore-file'),
    lastBackup: $('last-backup'),
    storage: $('storage-status'),
  };
  let lastBackup = null;

  function showLastBackup() {
    el.lastBackup.textContent = lastBackup
      ? `Last backup: ${new Date(lastBackup).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
      : 'No backup made on this device yet.';
  }

  async function checkStorage() {
    let status;
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {};
      status = storageStatus(est.usage, est.quota);
    } catch {
      status = storageStatus();
    }
    el.storage.textContent = status.text;
    el.storage.classList.toggle('bad', status.warn);
    return status;
  }

  async function backup() {
    // Everything is already in memory, so the share sheet can open straight after the tap (iOS rule).
    const stations = stationsUi.getStations();
    const now = new Date();
    const data = makeBackup({
      stations,
      settings: {
        traceUncertaintyDeg: tracesUi.getDelta(),
        stereonetArea: areaUi.getArea(),
        lastExport: stationsUi.getLastExport(),
      },
      createdAt: now.toISOString(),
    });
    const outcome = await shareOrDownload(
      [{ name: `field-geology-backup_${fileStamp(now)}.json`, text: JSON.stringify(data, null, 1), type: 'application/json' }],
      'Field Geology Tools backup');
    if (outcome === 'cancelled') {
      showMessage('Backup cancelled. Nothing was saved.', 'error');
      return;
    }
    lastBackup = now.toISOString();
    try { await setMeta('lastBackup', lastBackup); } catch { /* shown for this session anyway */ }
    showLastBackup();
    showMessage(`Backup of ${stations.length} station${stations.length === 1 ? '' : 's'} and all settings ` +
      `${outcome === 'shared' ? 'ready: save it in Files' : 'downloaded'}. The DEM file is not included; keep your GeoTIFF too.`, 'ok');
  }

  async function restoreFromFile() {
    const file = el.file.files[0];
    el.file.value = '';
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch (e) {
      showMessage(`Could not open "${file.name}": ${e.message}`, 'error');
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      showMessage(`"${file.name}" was not restored. ${parsed.message}`, 'error');
      return;
    }
    const { backup: data } = parsed;
    const plan = planRestore(stationsUi.getStations(), data.stations);
    const made = data.createdAt ? new Date(data.createdAt).toLocaleString() : 'unknown date';
    const question = `Restore the backup made ${made}?\n\n` +
      `${plan.toAdd.length} station${plan.toAdd.length === 1 ? '' : 's'} will be added.\n` +
      `${plan.alreadyHere} already on this device will be skipped (your copy is kept).\n` +
      (plan.idClashes.length ? `Warning: ${plan.idClashes.join(', ')} ${plan.idClashes.length === 1 ? 'is' : 'are'} already used by a different station here; both will be kept.\n` : '') +
      'Trace and stereonet settings from the backup will also be used.';
    if (!window.confirm(question)) {
      showMessage('Restore cancelled. Nothing was changed.');
      return;
    }
    const { added, failed } = await stationsUi.addStations(plan.toAdd);
    const s = data.settings;
    if (typeof s.traceUncertaintyDeg === 'number') await tracesUi.setDelta(s.traceUncertaintyDeg);
    if (Array.isArray(s.stereonetArea)) await areaUi.setArea(s.stereonetArea);
    await stationsUi.setLastExport(laterExport(stationsUi.getLastExport(), s.lastExport));
    await checkStorage();
    showMessage(`Restored ${added} station${added === 1 ? '' : 's'}; ${plan.alreadyHere} already here were skipped.` +
      (failed ? ` ${failed} could not be saved: try again.` : '') +
      (plan.idClashes.length ? ` Check duplicate IDs: ${plan.idClashes.join(', ')}.` : ''), failed ? 'error' : 'ok');
  }

  el.backup.addEventListener('click', backup);
  el.restore.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', restoreFromFile);

  return {
    async load() {
      try { lastBackup = (await getMeta('lastBackup')) || null; } catch { lastBackup = null; }
      showLastBackup();
      return checkStorage();
    },
    checkStorage,
  };
}
