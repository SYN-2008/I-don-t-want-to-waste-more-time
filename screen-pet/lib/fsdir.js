const DB_NAME = 'xiaoYanFS';
const STORE = 'handles';
const KEY = 'outDir';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setDirHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDirHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
  } catch (e) {
    return null;
  }
}

export async function clearDirHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
}

export function supportsFolderPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirHandle() {
  if (!supportsFolderPicker()) throw new Error('这个浏览器版本不支持直接选文件夹。');
  try {
    return await window.showDirectoryPicker({ id: 'xiaoYanOutDir', mode: 'readwrite', startIn: 'desktop' });
  } catch (e) {
    if (e && e.name === 'TypeError') {
      return window.showDirectoryPicker({ id: 'xiaoYanOutDir', mode: 'readwrite' });
    }
    throw e;
  }
}

export async function ensurePermission(handle, needsPrompt) {
  if (!handle || !handle.queryPermission) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!needsPrompt) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function writeFile(handle, filename, data, mime) {
  const fh = await handle.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  if (data instanceof Uint8Array) {
    await w.write(new Blob([data], { type: mime || 'application/octet-stream' }));
  } else {
    await w.write(new Blob([String(data)], { type: mime || 'text/plain;charset=utf-8' }));
  }
  await w.close();
}

export async function downloadBytes(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  try {
    return await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function downloadText(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([String(text)], { type: mime || 'text/plain;charset=utf-8' }));
  try {
    return await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/^\.+/, '').slice(0, 60) || '题目提取';
}

export async function saveDocx({ filename, bytes, subfolder }) {
  const dir = await getDirHandle();
  const granted = await ensurePermission(dir, true).catch(() => false);
  if (dir && granted) {
    await writeFile(dir, filename, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return { where: 'folder', path: (dir.name || '') + '\\' + filename, filename };
  }
  const folder = safeName(subfolder || '题目提取');
  await downloadBytes(bytes, folder + '/' + filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return { where: 'downloads', path: folder + '/' + filename, filename, folder };
}

export async function saveText({ filename, text, subfolder }) {
  const dir = await getDirHandle();
  const granted = await ensurePermission(dir, true).catch(() => false);
  if (dir && granted) {
    await writeFile(dir, filename, text, 'text/plain;charset=utf-8');
    return { where: 'folder', path: (dir.name || '') + '\\' + filename, filename };
  }
  const folder = safeName(subfolder || '题目提取');
  await downloadText(text, folder + '/' + filename, 'text/plain;charset=utf-8');
  return { where: 'downloads', path: folder + '/' + filename, filename, folder };
}

export async function purgeFolder(subfolder) {
  let removed = 0;
  let scanned = 0;

  const dir = await getDirHandle();
  const granted = await ensurePermission(dir, true).catch(() => false);
  if (dir && granted) {
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      scanned++;
      if (/\.(docx|txt|md|png)$/i.test(entry.name)) {
        try {
          await dir.removeEntry(entry.name);
          removed++;
        } catch (e) {}
      }
    }
    return { where: 'folder', scanned, removed, path: dir.name || '' };
  }

  const folder = safeName(subfolder || '题目提取');
  const items = await chrome.downloads.search({ query: [folder] });
  for (const it of items) {
    scanned++;
    try {
      await chrome.downloads.removeFile(it.id);
      removed++;
    } catch (e) {}
    try {
      await chrome.downloads.erase({ id: it.id });
    } catch (e) {}
  }
  return { where: 'downloads', scanned, removed, path: folder };
}
