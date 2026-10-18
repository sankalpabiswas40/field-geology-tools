// Remembers the last loaded DEM file in IndexedDB (the browser's on-device database),
// so it is still there next time the app opens, even offline.

const DB_NAME = 'field-geology-tools';
const STORE = 'files';
const LAST_DEM_KEY = 'last-dem';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Saving was cancelled')); };
  }));
}

/** Saves the DEM file contents. `buffer` is an ArrayBuffer. */
export function saveLastDem(name, buffer) {
  return run('readwrite', (store) => store.put({ name, buffer, savedAt: Date.now() }, LAST_DEM_KEY));
}

/** Returns { name, buffer, savedAt } or undefined if nothing is saved. */
export function loadLastDem() {
  return run('readonly', (store) => store.get(LAST_DEM_KEY));
}

/** Asks the browser not to clear our storage when the device is short of space. */
export async function askForPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    // Not supported everywhere; the app still works without it.
  }
}
