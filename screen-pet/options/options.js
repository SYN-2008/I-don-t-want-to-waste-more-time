import { DEFAULTS, getSettings, setSettings, normalizeModel } from '../lib/settings.js';
import {
  pickDirHandle,
  setDirHandle,
  getDirHandle,
  clearDirHandle,
  ensurePermission,
  supportsFolderPicker,
  purgeFolder
} from '../lib/fsdir.js';

const TEXT_FIELDS = ['apiKey', 'baseUrl', 'model', 'systemPrompt', 'docxName'];
const NUM_FIELDS = ['temperature', 'maxTokens', 'maxTextChars', 'followDebounce', 'followMinGap'];
const BOOL_FIELDS = [
  'preferSelection',
  'autoSaveDocx',
  'followMode',
  'selBubble',
  'selAutoAsk',
  'autoCopyAnswer',
  'thinkingEnabled'
];

const $ = (id) => document.getElementById(id);

function fill(settings) {
  for (const k of TEXT_FIELDS) if ($(k)) $(k).value = settings[k] == null ? '' : settings[k];
  for (const k of NUM_FIELDS) if ($(k)) $(k).value = settings[k];
  for (const k of BOOL_FIELDS) if ($(k)) $(k).checked = !!settings[k];
  if ($('extractMode')) $('extractMode').value = settings.extractMode || 'smart';
  if ($('docxMode')) $('docxMode').value = settings.docxMode || 'daily';
}

function collect() {
  const patch = {};
  for (const k of TEXT_FIELDS) if ($(k)) patch[k] = $(k).value.trim();
  for (const k of NUM_FIELDS) if ($(k)) patch[k] = Number($(k).value);
  for (const k of BOOL_FIELDS) if ($(k)) patch[k] = $(k).checked;
  if ($('extractMode')) patch.extractMode = $('extractMode').value;
  if ($('docxMode')) patch.docxMode = $('docxMode').value;
  if (!patch.baseUrl) patch.baseUrl = DEFAULTS.baseUrl;
  patch.model = normalizeModel(patch.model);
  if (!patch.docxName) patch.docxName = DEFAULTS.docxName;
  return patch;
}

async function refreshDirLabel() {
  const dir = await getDirHandle();
  const box = $('dirResult');
  if (!dir) {
    box.textContent = '当前：未选择，文档会落到下载目录下的同名子文件夹。';
    box.className = 'result';
    return;
  }
  const ok = await ensurePermission(dir, false).catch(() => false);
  box.textContent = ok
    ? '当前：' + (dir.name || '已选文件夹') + '（可直接写入）'
    : '当前：' + (dir.name || '已选文件夹') + '（需要重新授权，写入时会提示一次）';
  box.className = 'result' + (ok ? ' ok' : '');
}

async function saveNow() {
  await setSettings(collect());
  const now = await getSettings();
  await chrome.runtime
    .sendMessage({ type: 'PET_SYNC_FOLLOW', on: !!now.followMode, debounce: Number(now.followDebounce) || 1500 })
    .catch(() => {});
  return now;
}

function flash(text, bad) {
  const r = $('saveResult');
  r.textContent = text;
  r.className = 'result' + (bad ? ' bad' : ' ok');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (r.textContent = ''), 1600);
}

let autoTimer = null;
function autoSave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    await saveNow();
    flash('已保存');
  }, 350);
}

$('btnSave').onclick = async () => {
  await saveNow();
  flash('已保存');
};

$('btnReset').onclick = async () => {
  fill(DEFAULTS);
  await setSettings(DEFAULTS);
  const r = $('saveResult');
  r.textContent = '已恢复默认';
  r.className = 'result ok';
  setTimeout(() => (r.textContent = ''), 1800);
};

$('btnTest').onclick = async () => {
  const r = $('testResult');
  const btn = $('btnTest');
  const settings = { ...(await getSettings()), ...collect() };
  if (!settings.apiKey) {
    r.textContent = '先填 API Key';
    r.className = 'result bad';
    return;
  }
  btn.disabled = true;
  r.textContent = '正在测试…';
  r.className = 'result';
  try {
    const url = String(settings.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: '只回复两个字：通了' }],
        max_tokens: 16,
        stream: false
      })
    });
    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {}
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || raw.slice(0, 160);
      r.textContent = '失败：' + res.status + ' ' + msg;
      r.className = 'result bad';
    } else {
      const txt =
        data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
      r.textContent = '连接正常，模型回了：' + String(txt).trim();
      r.className = 'result ok';
    }
  } catch (e) {
    r.textContent = '失败：' + String((e && e.message) || e);
    r.className = 'result bad';
  } finally {
    btn.disabled = false;
  }
};

$('btnPickDir').onclick = async () => {
  const r = $('dirResult');
  if (!supportsFolderPicker()) {
    r.textContent = '这个浏览器不支持直接选文件夹，文档会落到下载目录。';
    r.className = 'result bad';
    return;
  }
  try {
    const handle = await pickDirHandle();
    const ok = await ensurePermission(handle, true);
    if (!ok) {
      r.textContent = '没有拿到写入权限，再点一次试试。';
      r.className = 'result bad';
      return;
    }
    await setDirHandle(handle);
    await refreshDirLabel();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    r.textContent = '选择失败：' + String((e && e.message) || e);
    r.className = 'result bad';
  }
};

$('btnClearDir').onclick = async () => {
  await clearDirHandle();
  await refreshDirLabel();
};

$('btnPurge').onclick = async () => {
  const r = $('purgeResult');
  const btn = $('btnPurge');
  btn.disabled = true;
  r.textContent = '正在清理…';
  r.className = 'result';
  try {
    const settings = await getSettings();
    const out = await purgeFolder(settings.docxName);
    r.textContent =
      out.where === 'folder'
        ? '在 ' + out.path + ' 里删掉了 ' + out.removed + ' 个文件（扫到 ' + out.scanned + ' 个）。'
        : '在下载目录/' + out.path + ' 里删掉了 ' + out.removed + ' 个文件（扫到 ' + out.scanned + ' 个）。';
    r.className = 'result ok';
  } catch (e) {
    r.textContent = '清理失败：' + String((e && e.message) || e);
    r.className = 'result bad';
  } finally {
    btn.disabled = false;
  }
};

(async function init() {
  await fill(await getSettings());
  await refreshDirLabel();

  // 改完即存，不用特地找保存按钮（按钮还留着，习惯点它也行）
  for (const k of [].concat(TEXT_FIELDS, NUM_FIELDS, BOOL_FIELDS, ['extractMode', 'docxMode'])) {
    const n = $(k);
    if (!n) continue;
    n.addEventListener('change', autoSave);
    if (n.tagName === 'INPUT' && (n.type === 'text' || n.type === 'password' || n.type === 'number')) {
      n.addEventListener('input', autoSave);
    }
  }
})();
