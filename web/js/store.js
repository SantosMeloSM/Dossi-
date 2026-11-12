// Camada fina sobre IndexedDB.
//  meta  : registros de configuração (vault, settings)
//  docs  : metadados cifrados de cada documento   { id, iv, ct }
//  blobs : conteúdo cifrado de cada anexo          { id, docId, iv, ct }
const DB_NAME = 'dossie-vault';
const DB_VERSION = 1;
let db = null;

export function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' }).createIndex('docId', 'docId');
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Feche outras abas do Dossiê e tente novamente.'));
  });
}

function run(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    const objs = Array.isArray(stores) ? stores.map(s => tx.objectStore(s)) : [tx.objectStore(stores)];
    const r = fn(...objs);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
  });
}

export const get = (store, key) => run(store, 'readonly', s => s.get(key));
export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, value) => run(store, 'readwrite', s => s.put(value));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const count = store => run(store, 'readonly', s => s.count());

/** Grava um documento e seus anexos atomicamente e remove anexos órfãos. */
export function writeDocument(docRecord, newBlobs = [], removeBlobIds = []) {
  return run(['docs', 'blobs'], 'readwrite', (docs, blobs) => {
    docs.put(docRecord);
    newBlobs.forEach(b => blobs.put(b));
    removeBlobIds.forEach(id => blobs.delete(id));
  });
}

export function deleteDocument(id) {
  return run(['docs', 'blobs'], 'readwrite', (docs, blobs) => {
    docs.delete(id);
    const idx = blobs.index('docId').openKeyCursor(IDBKeyRange.only(id));
    idx.onsuccess = () => { const c = idx.result; if (c) { blobs.delete(c.primaryKey); c.continue(); } };
  });
}

export function clearAll() {
  return run(['meta', 'docs', 'blobs'], 'readwrite', (m, d, b) => { m.clear(); d.clear(); b.clear(); });
}

export function clearDocuments() {
  return run(['docs', 'blobs'], 'readwrite', (d, b) => { d.clear(); b.clear(); });
}

export const blobKeysForDoc = docId =>
  run('blobs', 'readonly', s => s.index('docId').getAllKeys(IDBKeyRange.only(docId)));
