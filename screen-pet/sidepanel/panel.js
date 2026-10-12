import { getSettings, getHistory, clearHistory, getDocxEntries, addDocxEntry, dayKey } from '../lib/settings.js';
import { buildQuestionDoc } from '../lib/docx.js';
import { saveDocx, getDirHandle, ensurePermission, safeName } from '../lib/fsdir.js';

const el = {
  avatar: document.getElementById('avatar'),
  state: document.getElementById('state'),
  question: document.getElementById('question'),
  btnExtract: document.getElementById('btnExtract'),
  btnPage: document.getElementById('btnPage'),
  follow: document.getElementById('follow'),
  pageInfo: document.getElementById('pageInfo'),
  stream: document.getElementById('stream'),
  hint: document.getElementById('hint'),
  notice: document.getElementById('notice'),
  noticeText: document.getElementById('noticeText'),
  noticeAction: document.getElementById('noticeAction'),
  btnOptions: document.getElementById('btnOptions'),
  btnClearHistory: document.getElementById('btnClearHistory'),
  btnDiag: document.getElementById('btnDiag'),
  footNote: document.getElementById('footNote')
};

const STATE_TEXT = {
  idle: '待机中',
  reading: '正在读这个页面',
  thinking: '正在想',
  answer: '好了',
  error: '出了点问题'
};

function face(state) {
  const eyesOpen =
    '<circle cx="12.5" cy="17" r="2.6" fill="currentColor"/><circle cx="21.5" cy="17" r="2.6" fill="currentColor"/>';
  const eyesHappy =
    '<path d="M9.6 18.2 Q12.5 14.6 15.4 18.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M18.6 18.2 Q21.5 14.6 24.4 18.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  const eyesScan =
    '<path d="M9.9 17 H15.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M18.9 17 H24.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  const eyesUp =
    '<circle cx="12.5" cy="15.2" r="2.4" fill="currentColor"/><circle cx="21.5" cy="15.2" r="2.4" fill="currentColor"/>';
  const eyesCross =
    '<path d="M10.2 14.7 L14.8 19.3 M14.8 14.7 L10.2 19.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M19.2 14.7 L23.8 19.3 M23.8 14.7 L19.2 19.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';

  const mouth = {
    idle: '<path d="M13.6 23 Q17 25.4 20.4 23" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    reading: '<circle cx="17" cy="23.4" r="1.4" fill="currentColor"/>',
    thinking: '<path d="M13.6 24 Q17 22.6 20.4 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    answer: '<path d="M13 22.6 Q17 26.4 21 22.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    error: '<path d="M13.6 25 Q17 22.6 20.4 25" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  };

  const eyes = { idle: eyesOpen, reading: eyesScan, thinking: eyesUp, answer: eyesHappy, error: eyesCross };
  const skin = {
    idle: { fill: '#E1F5EE', ink: '#085041', line: '#0F6E56' },
    reading: { fill: '#E6F1FB', ink: '#0C447C', line: '#185FA5' },
    thinking: { fill: '#FAEEDA', ink: '#633806', line: '#854F0B' },
    answer: { fill: '#EAF3DE', ink: '#27500A', line: '#3B6D11' },
    error: { fill: '#FCEBEB', ink: '#791F1F', line: '#A32D2D' }
  };

  const c = skin[state] || skin.idle;
  const cls = state === 'thinking' || state === 'reading' ? ' class="spin"' : '';
  return (
    '<svg viewBox="0 0 34 34" aria-hidden="true"' + cls + '>' +
    '<rect x="3" y="6" width="28" height="24" rx="9" fill="' + c.fill + '" stroke="' + c.line + '" stroke-width="0.6"/>' +
    '<g color="' + c.ink + '">' + (eyes[state] || eyesOpen) + '</g>' +
    (mouth[state] || mouth.idle) +
    '</svg>'
  );
}

function setState(state, text) {
  el.state.textContent = text || STATE_TEXT[state] || STATE_TEXT.idle;
  el.state.dataset.s = state;
  el.avatar.innerHTML = face(state);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function md(src) {
  const chunks = esc(src).split('```');
  return chunks
    .map((chunk, i) => {
      if (i % 2 === 1) {
        const body = chunk.replace(/^[a-zA-Z0-9+#.-]*\r?\n/, '').replace(/\s+$/, '');
        return '<pre><code>' + body + '</code></pre>';
      }
      return chunk
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/^#{1,4}[ \t]*(.+)$/gm, '<h3>$1</h3>')
        .split(/\n{2,}/)
        .map((b) => {
          const t = b.trim();
          if (!t) return '';
          if (/^<h3>/.test(t)) return t;
          return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
        })
        .join('');
    })
    .join('');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function note(text, actionLabel, actionFn) {
  el.noticeText.textContent = text;
  if (actionLabel) {
    el.noticeAction.textContent = actionLabel;
    el.noticeAction.hidden = false;
    el.noticeAction.onclick = () => {
      hideNote();
      actionFn();
    };
  } else {
    el.noticeAction.hidden = true;
    el.noticeAction.onclick = null;
  }
  el.notice.hidden = false;
}

function hideNote() {
  el.notice.hidden = true;
}

function mkBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'mini' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function modeBadge(entry) {
  let label;
  if (entry.mode === 'selection') label = '选中的';
  else if (entry.mode === 'page') label = '整页';
  else if (entry.mode === 'fallback') label = '整页兜底';
  else label = entry.questionCount ? '题目 ' + entry.questionCount + ' 道' : '题目';
  if ((entry.frames || 1) > 1 && entry.mode !== 'page') label += ' · 内嵌页';
  return label;
}

async function archiveToDocx(entry, settings) {
  const name = safeName(settings.docxName);
  let entries;
  let filename;
  if (settings.docxMode === 'daily') {
    await addDocxEntry(entry);
    const all = await getDocxEntries();
    const day = dayKey(entry.at);
    entries = all.filter((e) => dayKey(e.at) === day).slice().reverse();
    filename = name + '_' + day + '.docx';
  } else {
    entries = [entry];
    filename = name + '_' + entry.stamp + '.docx';
  }
  const bytes = buildQuestionDoc({
    docTitle: name,
    entries: entries.map((e) => ({
      title: e.title,
      url: e.url,
      when: fmtTime(e.at),
      text: e.text,
      answer: e.answer || ''
    }))
  });
  return saveDocx({ filename, bytes, subfolder: name });
}

function extractCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = modeBadge(entry);
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = (entry.title || '未命名页面') + ' · ' + fmtTime(entry.at);
  title.title = entry.url || '';
  head.appendChild(badge);
  head.appendChild(title);

  const body = document.createElement('div');
  body.className = 'qtext';
  body.textContent = entry.text || '（没提取到内容）';

  const tools = document.createElement('div');
  tools.className = 'tools';

  const copyBtn = mkBtn('复制题目', 'primary', async () => {
    try {
      await navigator.clipboard.writeText(entry.text || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => (copyBtn.textContent = '复制题目'), 1200);
    } catch (e) {
      copyBtn.textContent = '复制失败';
    }
  });

  const docxBtn = mkBtn('存到 Word', '', async () => {
    docxBtn.disabled = true;
    docxBtn.textContent = '正在写…';
    try {
      const settings = await getSettings();
      const r = await archiveToDocx(entry, settings);
      docxBtn.textContent = '已写 ' + r.filename;
      el.footNote.textContent = r.where === 'folder' ? 'Word 已存入：' + r.path : 'Word 已存到下载目录/' + r.path;
    } catch (e) {
      docxBtn.textContent = '写入失败';
      note('写 Word 失败：' + String((e && e.message) || e), '去设置里选文件夹', () => chrome.runtime.openOptionsPage());
    }
    setTimeout(() => {
      docxBtn.disabled = false;
      docxBtn.textContent = '存到 Word';
    }, 2000);
  });

  const fillBtn = mkBtn('填到 DeepSeek', '', async () => {
    fillBtn.disabled = true;
    fillBtn.textContent = '正在填…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'PET_FILL_DEEPSEEK', text: entry.text || '' });
      fillBtn.textContent = r && r.filled ? '已填入' : '已打开页面';
      if (r && r.note) el.footNote.textContent = r.note;
    } catch (e) {
      fillBtn.textContent = '没填上';
    }
    setTimeout(() => {
      fillBtn.disabled = false;
      fillBtn.textContent = '填到 DeepSeek';
    }, 2000);
  });

  const askBtn = mkBtn('让它直接答', '', async () => {
    askBtn.disabled = true;
    askBtn.textContent = '正在问…';
    setState('thinking', '正在等 DeepSeek 回答');
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'PET_ASK',
        question: el.question.value.trim(),
        text: entry.text || ''
      });
      if (r && r.ok) {
        setState('answer');
        const card2 = answerCard(r.entry);
        el.stream.prepend(card2);
      } else {
        setState('error');
        if (r && r.code === 'NO_KEY') {
          note('要用这个按钮得先填 DeepSeek API Key。', '去填 Key', () => chrome.runtime.openOptionsPage());
        } else {
          el.stream.prepend(errorCard((r && r.error) || '问不出去。'));
        }
      }
    } catch (e) {
      setState('error');
      el.stream.prepend(errorCard(String((e && e.message) || e)));
    }
    askBtn.disabled = false;
    askBtn.textContent = '让它直接答';
  });

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = (entry.chars || 0) + ' 字';

  tools.appendChild(copyBtn);
  tools.appendChild(docxBtn);
  tools.appendChild(fillBtn);
  tools.appendChild(askBtn);
  tools.appendChild(meta);

  card.appendChild(head);
  card.appendChild(body);
  card.appendChild(tools);
  return card;
}

function answerCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = '答案';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = (entry.title || '未命名页面') + ' · ' + fmtTime(entry.at);
  head.appendChild(badge);
  head.appendChild(title);

  const body = document.createElement('div');
  body.className = 'answer';
  body.innerHTML = md(entry.answer || '');

  const tools = document.createElement('div');
  tools.className = 'tools';
  const copyBtn = mkBtn('复制答案', '', async () => {
    try {
      await navigator.clipboard.writeText(entry.answer || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => (copyBtn.textContent = '复制答案'), 1200);
    } catch (e) {
      copyBtn.textContent = '复制失败';
    }
  });
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = (entry.model || '') + (entry.tokens ? ' · ' + entry.tokens + 'tk' : '');
  tools.appendChild(copyBtn);
  tools.appendChild(meta);

  card.appendChild(head);
  card.appendChild(body);
  card.appendChild(tools);
  return card;
}

function errorCard(msg) {
  const div = document.createElement('div');
  div.className = 'card err';
  div.textContent = msg;
  return div;
}

function prepend(node) {
  if (el.hint) {
    el.hint.remove();
    el.hint = null;
  }
  el.stream.prepend(node);
}

async function refreshPageInfo() {
  el.pageInfo.textContent = '';
}

async function doExtract(mode) {
  hideNote();
  setState('thinking', mode === 'page' ? '正在整理整页正文' : '正在找题目');
  const box = document.createElement('div');
  box.className = 'card pending';
  box.textContent = mode === 'page' ? '正在提取整页正文…' : '正在识别页面里的题目…';
  prepend(box);

  el.btnExtract.disabled = true;
  el.btnPage.disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'PET_EXTRACT', mode });
    box.remove();
    if (!r || !r.ok) {
      setState('error');
      prepend(errorCard((r && r.error) || '提取失败。'));
      return;
    }
    setState('answer', r.entry.questionCount ? '找到 ' + r.entry.questionCount + ' 道题' : '提取完成');
    prepend(extractCard(r.entry));

    if (r.entry.mode === 'fallback') {
      note('没识别到题目，已退化成整页正文。在网页上用鼠标把题目划选出来，再点一次「提取题目」会准得多。', '', null);
    }

    if (r.settings && r.settings.autoSaveDocx) {
      try {
        const settings = await getSettings();
        const out = await archiveToDocx(r.entry, settings);
        el.footNote.textContent = out.where === 'folder' ? '已写入 ' + out.path : '已存到下载目录/' + out.path;
      } catch (e) {
        el.footNote.textContent = 'Word 没写成：' + String((e && e.message) || e);
      }
    }
  } catch (e) {
    box.remove();
    setState('error');
    prepend(errorCard(String((e && e.message) || e)));
  } finally {
    el.btnExtract.disabled = false;
    el.btnPage.disabled = false;
  }
}

async function renderHistory() {
  const list = await getHistory(20);
  if (!list.length) return;
  if (el.hint) {
    el.hint.remove();
    el.hint = null;
  }
  const wrap = document.createElement('div');
  wrap.style.display = 'contents';
  for (const entry of list) {
    wrap.appendChild(entry.kind === 'answer' ? answerCard(entry) : extractCard(entry));
  }
  el.stream.appendChild(wrap);
}

el.btnExtract.onclick = () => doExtract('smart');
el.btnPage.onclick = () => doExtract('page');
el.btnOptions.onclick = () => chrome.runtime.openOptionsPage();
el.btnClearHistory.onclick = async () => {
  await clearHistory();
  el.stream.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = '记录清空了。桌面的 Word 文档不受影响。';
  el.stream.appendChild(h);
};

el.btnDiag.onclick = async () => {
  hideNote();
  setState('reading', '正在检查这个页面');
  const box = document.createElement('div');
  box.className = 'card pending';
  box.textContent = '正在检查页面结构…';
  prepend(box);
  try {
    const r = await chrome.runtime.sendMessage({ type: 'PET_DIAG' });
    box.remove();
    if (!r || !r.ok) {
      setState('error');
      prepend(errorCard((r && r.error) || '诊断失败。'));
      return;
    }
    setState('answer', '检查完成');
    prepend(diagCard(r.report));
  } catch (e) {
    box.remove();
    setState('error');
    prepend(errorCard(String((e && e.message) || e)));
  }
};

function diagCard(report) {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = '诊断';
  head.appendChild(badge);
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = '当前页面结构检查';
  head.appendChild(title);
  card.appendChild(head);

  const pre = document.createElement('pre');
  pre.className = 'diag-text';
  pre.textContent = report;
  card.appendChild(pre);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const copyBtn = mkBtn('复制诊断信息', 'primary', async () => {
    try {
      await navigator.clipboard.writeText(report);
      copyBtn.textContent = '已复制';
      setTimeout(() => (copyBtn.textContent = '复制诊断信息'), 1200);
    } catch (e) {
      copyBtn.textContent = '复制失败';
    }
  });
  tools.appendChild(copyBtn);
  card.appendChild(tools);
  return card;
}

el.follow.addEventListener('change', async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ followMode: el.follow.checked });
  await chrome.runtime
    .sendMessage({ type: 'PET_SYNC_FOLLOW', on: el.follow.checked, debounce: settings.followDebounce })
    .catch(() => {});
  el.footNote.textContent = el.follow.checked ? '跟随已打开：页面一变自动提取' : '跟随已关闭';
});

let lastSeenAnswerAt = 0;

async function pullLatestAnswer() {
  const list = await getHistory(10);
  const hit = list.filter((e) => e.kind === 'answer' && (e.at || 0) > lastSeenAnswerAt).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!hit.length) return;
  lastSeenAnswerAt = hit[hit.length - 1].at || Date.now();
  for (const e of hit) prepend(answerCard(e));
  setState('answer', '答完了');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'PET_ANSWER_DONE') {
    pullLatestAnswer().catch(() => {});
    return;
  }

  if (msg.type === 'PET_TOAST') {
    if (msg.text) el.footNote.textContent = msg.text;
    return;
  }

  if (msg.type !== 'PET_AUTO_RESULT') return;
  if (msg.ok) {
    setState('answer', '自己看了一眼');
    prepend(extractCard(msg.result.entry));
    if (msg.result.settings && msg.result.settings.autoSaveDocx) {
      getSettings()
        .then((settings) => archiveToDocx(msg.result.entry, settings))
        .then((out) => {
          el.footNote.textContent = out.where === 'folder' ? '已写入 ' + out.path : '已存到下载目录/' + out.path;
        })
        .catch(() => {});
    }
  } else {
    setState('error', '自动提取时出了点问题');
    prepend(errorCard(msg.error || '自动提取失败。'));
  }
});

(async function init() {
  setState('idle');
  const settings = await getSettings();
  el.follow.checked = !!settings.followMode;

  const dir = await getDirHandle();
  if (dir) {
    const ok = await ensurePermission(dir, false).catch(() => false);
    el.footNote.textContent = ok
      ? 'Word 会写到：' + (dir.name || '你选的文件夹')
      : '文件夹需要重新授权，下次写入时点一下就好';
  } else {
    el.footNote.textContent = '还没选文件夹，Word 会落到下载目录/' + safeName(settings.docxName);
  }

  if (!settings.apiKey) {
    note('不填 API Key 也能用：提取题目 → 复制 → 粘到 DeepSeek 网页。', '打开设置', () =>
      chrome.runtime.openOptionsPage()
    );
  }

  await renderHistory();
})();
