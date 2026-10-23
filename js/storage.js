// On-device storage in IndexedDB (the browser's database). Works offline.
// - "files":    the last loaded DEM, so it is still there next time the app opens
// - "stations": your field stations, one record each, keyed by a unique `uuid`
// - "meta":     small settings, such as the time of the last export

const DB_NAME = 'field-geology-tools';
const DB_VERSION = 2;
const FILES = 'files';
const STATIONS = 'stations';
const META = 'meta';
const LAST_DEM_KEY = 'last-dem';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Version 1 had only "files". Adding stores never touches existing data.
      if (event.oldVersion < 1) db.createObjectStore(FILES);
      if (event.oldVersion < 2) {
        db.createObjectStore(STATIONS, { keyPath: 'uuid' });
        db.createObjectStore(META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other tabs of this app and try again.'));
  });
}

function run(storeName, mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = action(tx.objectStore(storeName));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Saving was cancelled')); };
  }));
}

// ---------- DEM ----------

/** Saves the DEM file contents. `buffer` is an ArrayBuffer. */
export function saveLastDem(name, buffer) {
  return run(FILES, 'readwrite', (store) => store.put({ name, buffer, savedAt: Date.now() }, LAST_DEM_KEY));
}

/** Returns { name, buffer, savedAt } or undefined if nothing is saved. */
export function loadLastDem() {
  return run(FILES, 'readonly', (store) => store.get(LAST_DEM_KEY));
}

// ---------- Stations ----------

/** All saved stations, oldest first. */
export async function loadStations() {
  const all = await run(STATIONS, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Adds or replaces one station (matched by its `uuid`). */
export function saveStation(station) {
  return run(STATIONS, 'readwrite', (store) => store.put(station));
}

export function deleteStation(uuid) {
  return run(STATIONS, 'readwrite', (store) => store.delete(uuid));
}

// ---------- Small settings ----------

export function getMeta(key) {
  return run(META, 'readonly', (store) => store.get(key));
}

export function setMeta(key, value) {
  return run(META, 'readwrite', (store) => store.put(value, key));
}

// ---------- Keeping data safe ----------

/**
 * Asks the browser not to clear our storage when the device is short of space.
 * Returns true if granted, false if refused, null if this browser cannot say.
 */
export async function askForPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // Not supported everywhere; the app still works without it.
  }
  return null;
}
