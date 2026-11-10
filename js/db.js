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

function saveRecord(record) { return put('records', record).catch(e => console.error('Failed to save record.', e)); }
function deleteRecordDb(id) { return remove('records', id).catch(e => console.error('Failed to delete record.', e)); }
function saveTheatre(theatre) { return put('theatres', theatre).catch(e => console.error('Failed to save theatre.', e)); }
function deleteTheatreDb(id) { return remove('theatres', id).catch(e => console.error('Failed to delete theatre.', e)); }
