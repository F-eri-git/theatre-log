// IndexedDB persistence for records and the theatre master list.
// No framework, no build step — thin promise wrapper around the native API.
const DB_NAME = 'theatre-log';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('theatres')) db.createObjectStore('theatres', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore(storeName, mode) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function getAll(storeName) {
  return withStore(storeName, 'readonly').then(store => new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function put(storeName, value) {
  return withStore(storeName, 'readwrite').then(store => new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  }));
}

function remove(storeName, id) {
  return withStore(storeName, 'readwrite').then(store => new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

async function loadAll() {
  try {
    const [records, theatres] = await Promise.all([getAll('records'), getAll('theatres')]);
    return { records, theatres };
  } catch (e) {
    console.error('Failed to load saved data, starting fresh.', e);
    return { records: [], theatres: [] };
  }
}

// ---- change tracking (drives the "back up" reminder) ----
function markChanged() {
  try { localStorage.setItem('tl-last-change', new Date().toISOString()); } catch (e) { /* ignore */ }
}
function reportSaveError(e) {
  console.error('Failed to save.', e);
  document.dispatchEvent(new CustomEvent('tl-save-error'));
}
function tracked(promise) {
  return promise.then(v => { markChanged(); return v; }, reportSaveError);
}

function saveRecord(record) { return tracked(put('records', record)); }
function deleteRecordDb(id) { return tracked(remove('records', id)); }
function saveTheatre(theatre) { return tracked(put('theatres', theatre)); }
function deleteTheatreDb(id) { return tracked(remove('theatres', id)); }

// Replace everything in one transaction (used by backup restore): all-or-nothing.
function replaceAll(records, theatres) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['records', 'theatres'], 'readwrite');
    const rs = tx.objectStore('records');
    const ts = tx.objectStore('theatres');
    rs.clear(); ts.clear();
    records.forEach(r => rs.put(r));
    theatres.forEach(t => ts.put(t));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// Ask the browser not to evict our data under storage pressure.
// Returns true if storage is (now) persistent.
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return false; }
}
