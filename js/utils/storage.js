const DB_NAME = 'ScreenStudioDB';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'blobs';

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) { resolve(dbInstance); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
    };
  });
}

export async function saveBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.put({ id, blob, createdAt: Date.now() });
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function getBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.put({ ...project, updatedAt: Date.now() });
    req.onsuccess = () => resolve(project.id);
    req.onerror = () => reject(req.error);
  });
}

export async function getProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    const idx = store.index('createdAt');
    const req = idx.openCursor(null, 'prev');
    const list = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { list.push(cursor.value); cursor.continue(); }
      else resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id) {
  const db = await openDB();
  const proj = await getProject(id);
  if (proj && proj.videoBlobId) {
    try { await deleteBlob(proj.videoBlobId); } catch (e) {}
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const LS_KEYS = {
  SETTINGS: 'ss_settings',
  RECENT_BOOKMARKS: 'ss_recent_bookmarks',
  VIEWER_NOTES: 'ss_viewer_notes_',
};

export function loadSettings(defaults = {}) {
  try {
    const raw = localStorage.getItem(LS_KEYS.SETTINGS);
    return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...defaults }; }
}

export function saveSettings(settings) {
  localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(settings));
}

export function saveViewerNotes(roomCode, notes) {
  localStorage.setItem(LS_KEYS.VIEWER_NOTES + roomCode, JSON.stringify(notes));
}

export function loadViewerNotes(roomCode) {
  try {
    const raw = localStorage.getItem(LS_KEYS.VIEWER_NOTES + roomCode);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
