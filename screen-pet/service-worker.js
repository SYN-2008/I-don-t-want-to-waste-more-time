import { getSettings, pushHistory, stampOf } from './lib/settings.js';
import { askDeepSeek, askDeepSeekStream } from './lib/ai.js';

const SETTLED = 'PAGE_SETTLED';

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {}
  if (details && details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {}
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

function extractFromPage(opts) {
  const cfg = opts || {};
  const mode = cfg.mode || 'smart';

  const NOISE = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'template', 'video', 'audio',
    'header', 'footer', 'nav', 'aside', 'button', 'select', 'option',
    '[aria-hidden="true"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="menu"]',
    '.ad', '.ads', '.advert', '.advertisement', '.adsbygoogle', '.sidebar', '.side-bar',
    '.comment', '.comments', '.comment-list', '.recommend', '.related', '.breadcrumb', '.crumbs',
    '.pagination', '.pager', '.toolbar', '.menu', '.menubar', '.nav', '.navbar',
    '.footer', '.header', '.login', '.share', '.social', '.copyright', '.banner',
    '.popup', '.modal', '.mask', '.float', '.fixed-bar', '.top-bar', '.site-header', '.site-footer',
    '.toc', '.catalog', '.catalogue', '.directory', '.outline', '.chapter-list', '.lesson-list',
    '.course-list', '.left-menu', '.left-nav', '.left-side', '.right-menu', '.exam-nav',
    '.answer-card', '.answerCard', '.exam-tab', '.question-nav', '.ans-nav', '.prevNext',
    '[class*="catalog"]', '[class*="toc"]', '[class*="directory"]', '[class*="outline"]',
    '[class*="chapter-list"]', '[class*="lesson-list"]', '[class*="treeview"]', '[class*="-menu"]',
    '[class*="menu-list"]', '[class*="nav-list"]', '[class*="sidebar"]', '[id*="catalog"]', '[id*="menu"]',
    '[class*="answer-card"]', '[class*="answercard"]', '[class*="question-nav"]', '[class*="questionnav"]',
    '[class*="tabbar"]', '[class*="tab-bar"]', '[id*="cardList"]', '[class*="card-list"]'
  ].join(',');

  const Q_START = /^\s*(?:第\s*[0-9一二三四五六七八九十百]{1,3}\s*[题问、.．)）]|[（(]\s*[0-9]{1,3}\s*[）)]|[0-9]{1,3}\s*[、.．)）]|[一二三四五六七八九十]{1,3}\s*[、.．)）])/;
  const OPTION = /^\s*[（(]?\s*[A-HＡ-Ｈa-h]\s*[、.．)）]\s*\S/;
  const SIG = /(下列|正确的是|错误的是|不正确|填空|选择|判断|简述|论述|名词解释|计算|证明|求解|已知|试述|辨析|为什么|如何|怎样|怎么|什么|哪些|哪一?个|多少|是否|属于|定义|概念|意义|特点|区别|联系|原因|步骤|方法|原则|性质|特征|作用|影响|公式|指的是|含义|（\s*）|\(\s*\)|_{3,}|＿{2,}|\[\s*\]|[？?])/;
  const ASK = new RegExp(
    SIG.source.replace(/\)$/, '') +
      '|以下|下面|上述|正确|错误|说明|解释|分析|比较|论述|求|设|若|叙述|举例|谈谈|概述|列举|回答)'
  );

  function isTocLine(line) {
    const s = String(line || '').trim();
    if (!s || s.length > 120) return false;
    if (/(\.{3,}|…{2,}|·{3,}|—{3,}|-{4,})/.test(s)) return true;
    if (/\s{2,}\d{1,4}$/.test(s)) return true;
    return false;
  }

  function markStats(text) {
    const ls = String(text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    let marks = 0;
    let sig = 0;
    let opts = 0;
    let qWithOpt = 0;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (isTocLine(l)) continue;
      if (OPTION.test(l)) {
        opts++;
        continue;
      }
      if (SIG.test(l)) sig++;
      if (Q_START.test(l)) {
        marks++;
        for (let j = i + 1; j < Math.min(i + 9, ls.length); j++) {
          if (OPTION.test(ls[j])) {
            qWithOpt++;
            break;
          }
          if (Q_START.test(ls[j])) break;
        }
      }
    }
    return { marks, sig, opts, qWithOpt };
  }

  function pickRoot() {
    const sels = [
      '#question', '.question', '.questions', '.question-list', '.exam', '.exam-question',
      '.paper', '.quiz', '.test-paper', '.problem', '.subject', '.content', '.main',
      '#content', '.container', 'main', 'article', '[role="main"]', 'body',
      '.questionLi', '.TiMu', '.mark_item', '.question-item', '.qtContent',
      '.exam-content', '#exam-ans', '.ans-cc', '.paper-content', '.subject-content',
      '#examContent', '#questions', '.examQuestion', '.queDetail', '.subject-detail'
    ];
    const cands = [];
    for (const s of sels) {
      let list = [];
      try {
        list = Array.from(document.querySelectorAll(s));
      } catch (e) {
        list = [];
      }
      for (const n of list) {
        if (cands.indexOf(n) >= 0) continue;
        const t = (n.innerText || '').trim();
        if (t.length >= 40) cands.push(n);
        if (cands.length > 400) break;
      }
      if (cands.length > 400) break;
    }
    if (!cands.length) return document.body;

    let best = null;
    let bestScore = -Infinity;
    for (const n of cands) {
      const t = (n.innerText || '').trim();
      const st = markStats(t);
      const score = st.qWithOpt * 30 + st.opts * 12 + st.sig * 6 + st.marks * 1 - t.length / 300;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (!best || bestScore <= 0) return document.body;
    return best;
  }

  function collectBlocks(root) {
    const out = [];
    let visited = 0;
    const walk = (node) => {
      if (!node || node.nodeType !== 1 || visited > 4000) return;
      visited++;
      try {
        if (node.matches && node.matches(NOISE)) return;
      } catch (e) {}
      try {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
      } catch (e) {}
      const kids = Array.from(node.children || []);
      const hasBlockKid = kids.some((c) => {
        try {
          return !/^inline/.test(getComputedStyle(c).display || 'block');
        } catch (e) {
          return true;
        }
      });
      if (kids.length === 0 || !hasBlockKid) {
        const t = (node.innerText || '').trim();
        if (t) out.push(t);
        return;
      }
      kids.forEach(walk);
    };
    walk(root);
    return out;
  }

  function splitLines(blocks) {
    let lines = [];
    for (const b of blocks) {
      for (const raw of String(b).split('\n')) {
        const s = raw.replace(/[\t\u00a0]+/g, ' ').replace(/\s+$/, '').trim();
        if (s) lines.push(s);
      }
    }
    if (lines.length <= 2 && lines.join('').length > 200) {
      lines = lines
        .join('\n')
        .split(/(?=(?:第\s*[0-9一二三四五六七八九十]{1,3}\s*[题问]|[（(]\s*[0-9]{1,3}\s*[）)]|[0-9]{1,3}\s*[、.．)）]\s*\S))/g)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return lines.filter((l) => !isTocLine(l));
  }

  const SECTION = /^\s*[（(]?\s*[一二三四五六七八九十0-9]{1,3}\s*[、.．)）]\s*[^，。？！,?!]{0,10}题\s*(?:[（(].*)?$/;

  function isSectionTitle(line) {
    const s = String(line).trim();
    if (s.length > 30 || OPTION.test(s)) return false;
    return SECTION.test(s);
  }

  function groupQuestions(lines) {
    const groups = [];
    let cur = null;
    for (const line of lines) {
      if (line.length > 1500) continue;
      if (isSectionTitle(line)) continue;
      if (Q_START.test(line)) {
        if (cur) groups.push(cur);
        cur = [line];
      } else if (cur && cur.length < 60) {
        cur.push(line);
      }
    }
    if (cur) groups.push(cur);
    return groups;
  }

  function score(group) {
    const text = group.join('\n');
    let s = 0;
    if (Q_START.test(group[0] || '')) s += 2;
    if (ASK.test(text)) s += 2;
    const opts = group.filter((l) => OPTION.test(l)).length;
    if (opts >= 1) s += 2;
    if (opts >= 4) s += 1;
    if (text.length >= 12) s += 1;
    if (text.length > 1200) s -= 1;
    if (isTocLine(group[0] || '') && opts === 0) s -= 5;
    return s;
  }

  function looksLikeQuestion(group) {
    const text = group.join('\n');
    const hasOpt = group.some((l) => OPTION.test(l));
    if (isTocLine(group[0] || '') && !hasOpt) return false;
    if (hasOpt) return true;
    return SIG.test(text);
  }

  function looksLikeBareTitle(group) {
    let t = group.join('\n').trim();
    t = t.replace(Q_START, '').replace(/[．.、)）\s]+$/, '').trim();
    if (!t || t.length > 24) return false;
    if (/[。，、？！：；：“”"'（）()_？?]/.test(t)) return false;
    if (/\s/.test(t)) return false;
    return true;
  }

  const selection = String(window.getSelection ? window.getSelection().toString() : '').trim();
  if (cfg.preferSelection !== false && mode !== 'page' && selection.length >= 15) {
    const lines = selection.split('\n').map((s) => s.trim()).filter(Boolean);
    const groups = groupQuestions(lines);
    return {
      mode: 'selection',
      title: document.title || '',
      url: location.href,
      selection: selection,
      questionCount: groups.length,
      text: lines.join('\n'),
      groups: groups.map((g) => g.join('\n'))
    };
  }

  const lines = splitLines(collectBlocks(pickRoot()));

  if (mode === 'page') {
    return {
      mode: 'page',
      title: document.title || '',
      url: location.href,
      selection: selection,
      questionCount: 0,
      text: lines.join('\n'),
      groups: []
    };
  }

  const groups = groupQuestions(lines);
  const strict = groups.filter((g) => looksLikeQuestion(g) && score(g) >= 3);
  const relaxed = strict.length ? [] : groups.filter((g) => score(g) >= 3 && !looksLikeBareTitle(g));
  const kept = strict.length ? strict : relaxed;

  if (kept.length >= 1) {
    return {
      mode: 'smart',
      strict: strict.length > 0,
      title: document.title || '',
      url: location.href,
      selection: selection,
      questionCount: kept.length,
      dropped: groups.length - kept.length,
      text: kept.map((g) => g.join('\n')).join('\n\n'),
      groups: kept.map((g) => g.join('\n'))
    };
  }

  return {
    mode: 'fallback',
    strict: false,
    title: document.title || '',
    url: location.href,
    selection: selection,
    questionCount: 0,
    text: lines.join('\n'),
    groups: []
  };
}

function pickBestPage(list, mode) {
  const withSel = list.filter((r) => r.mode === 'selection' && r.text);
  if (withSel.length) {
    withSel.sort((a, b) => b.text.length - a.text.length);
    return withSel[0];
  }
  let best = null;
  let bestScore = -Infinity;
  for (const r of list) {
    let s;
    if (mode === 'page') {
      s = r.text.length;
    } else {
      s =
        (r.strict ? 1 : 0) * 1e9 +
        (r.questionCount || 0) * 100000 +
        Math.min(r.text.length, 6000) -
        (r.mode === 'fallback' ? 800 : 0);
    }
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}

async function extractCurrent(mode) {
  const settings = await getSettings();
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error('没有找到当前标签页。');

  const want = mode || settings.extractMode;
  let out;
  try {
    out = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractFromPage,
      args: [{ mode: want, preferSelection: settings.preferSelection }]
    });
  } catch (e) {
    throw new Error('这个页面读不了：浏览器内置页、扩展商店页、PDF 阅读器都不允许扩展读取内容。');
  }

  const list = [];
  for (const r of out || []) {
    if (!r || !r.result) continue;
    r.result.frameId = r.frameId; // 记住文字来自哪个框架，字体还原要靠它
    list.push(r.result);
  }
  if (!list.length) throw new Error('没能从这个页面读到文字。');

  const page = pickBestPage(list, want);
  if (!page) throw new Error('没能从这个页面读到文字。');
  page.frames = list.length;

  const max = Number(settings.maxTextChars) || 20000;
  const text = String(page.text || '').trim();
  const truncated = text.length > max;
  page.text = truncated ? text.slice(0, max) + '\n…（内容过长，已截断）' : text;

  return { page, tab, settings, truncated };
}

async function runExtract(mode, auto) {
  const { page, settings } = await extractCurrent(mode);

  const entry = {
    at: Date.now(),
    stamp: stampOf(),
    kind: 'extract',
    title: page.title || '',
    url: page.url || '',
    mode: page.mode,
    strict: !!page.strict,
    frames: page.frames || 1,
    questionCount: page.questionCount || 0,
    text: page.text || '',
    chars: (page.text || '').length,
    auto: !!auto
  };

  if (!auto) await pushHistory(entry, Number(settings.historyLimit) || 20);

  return {
    ok: true,
    entry,
    settings: {
      autoSaveDocx: settings.autoSaveDocx,
      docxName: settings.docxName,
      docxMode: settings.docxMode
    }
  };
}

async function runAsk(question, overrideText) {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, code: 'NO_KEY', error: '还没有填 DeepSeek API Key。' };

  let page;
  if (overrideText && String(overrideText).trim().length > 1) {
    const tab = await getActiveTab();
    page = {
      title: (tab && tab.title) || '',
      url: (tab && tab.url) || '',
      text: String(overrideText).trim(),
      mode: 'provided',
      questionCount: 0
    };
  } else {
    const r = await extractCurrent(settings.extractMode);
    page = r.page;
  }
  if (!page.text || page.text.length < 2) return { ok: false, error: '这个页面没提取到可以问的文字。' };

  const { answer, model, usage } = await askDeepSeek({ settings, page, question: question || '', text: page.text });

  const entry = {
    at: Date.now(),
    stamp: stampOf(),
    kind: 'answer',
    title: page.title || '',
    url: page.url || '',
    mode: page.mode,
    question: question || '',
    answer: answer,
    text: page.text,
    model: model,
    tokens: usage ? usage.total_tokens || null : null
  };

  await pushHistory(entry, Number(settings.historyLimit) || 20);
  return { ok: true, entry };
}

async function runSettled(payload) {
  const settings = await getSettings();
  if (!settings.followMode) return;

  const store = await chrome.storage.session
    .get({ petLastUrl: '', petLastAuto: 0 })
    .catch(() => ({ petLastUrl: '', petLastAuto: 0 }));

  const now = Date.now();
  if (now - (store.petLastAuto || 0) < (Number(settings.followMinGap) || 15000)) return;

  const url = (payload && payload.url) || '';
  if (url === store.petLastUrl) return;

  await chrome.storage.session.set({ petLastUrl: url, petLastAuto: now }).catch(() => {});

  try {
    const result = await runExtract('smart', true);
    notifyPanel({ type: 'PET_AUTO_RESULT', ok: true, result: result });
  } catch (e) {
    notifyPanel({ type: 'PET_AUTO_RESULT', ok: false, error: String((e && e.message) || e) });
  }
}

function notifyPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * 浮动答案卡片：后台流式推给顶层框架
 * ------------------------------------------------------------------ */
function sendFrame(tabId, msg) {
  return chrome.tabs
    .sendMessage(tabId, msg, { frameId: 0 })
    .then(() => true)
    .catch(() => false);
}

async function openPanelBestEffort(tabId) {
  try {
    await chrome.sidePanel.open(tabId ? { tabId: tabId } : {});
  } catch (e) {}
}

/** 让文字所在的框架把加密字体还原一遍（框架里才有 canvas 和那份字体） */
async function maybeDecodeText(tabId, frameId, text) {
  const raw = String(text || '');
  if (!tabId || frameId == null || !raw) return { text: raw, note: '' };
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PET_DECODE_TEXT', text: raw }, { frameId: frameId });
    if (r && r.ok && r.text) return { text: r.text, note: r.note || '' };
  } catch (e) {}
  return { text: raw, note: '' };
}

async function streamAsk({ tabId, text, question, page, label, reqId, note }) {
  const settings = await getSettings();
  const id = reqId || 'sw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const body = String(text || (page && page.text) || '').trim();

  const shown = await sendFrame(tabId, {
    type: 'PET_STREAM_START',
    reqId: id,
    label: label || '小眼',
    note: note || ''
  });
  const push = (msg) => {
    if (shown) chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
  };

  if (!body || body.length < 2) {
    const error = '没读到可以问的文字。';
    push({ type: 'PET_STREAM_END', reqId: id, ok: false, error: error });
    if (!shown) await openPanelBestEffort(tabId);
    return { ok: false, error: error };
  }

  if (!settings.apiKey) {
    const error = '还没有填 DeepSeek API Key。设置页里填一个就能直接出答案；不填也可以用「复制题目」自己粘到网页版。';
    push({ type: 'PET_STREAM_END', reqId: id, ok: false, error: error });
    if (!shown) await openPanelBestEffort(tabId);
    return { ok: false, code: 'NO_KEY', error: error };
  }

  const pg = page || { title: '', url: '', text: body, mode: 'selection' };

  try {
    const { answer, model, usage } = await askDeepSeekStream({
      settings: settings,
      page: pg,
      question: question || '',
      text: body,
      onDelta: (d) => push({ type: 'PET_STREAM_DELTA', reqId: id, delta: d })
    });

    const entry = {
      at: Date.now(),
      stamp: stampOf(),
      kind: 'answer',
      title: pg.title || '',
      url: pg.url || '',
      mode: pg.mode || 'selection',
      question: question || '',
      answer: answer,
      text: body,
      model: model,
      tokens: usage ? usage.total_tokens || null : null
    };

    await pushHistory(entry, Number(settings.historyLimit) || 20);
    push({
      type: 'PET_STREAM_END',
      reqId: id,
      ok: true,
      answer: answer,
      entry: {
        at: entry.at,
        title: entry.title,
        url: entry.url,
        mode: entry.mode,
        question: entry.question
      }
    });
    notifyPanel({ type: 'PET_ANSWER_DONE' });
    return { ok: true, entry: entry };
  } catch (e) {
    const error = String((e && e.message) || e);
    const detail = String((e && e.detail) || '');
    await chrome.storage.local
      .set({
        lastError: {
          at: Date.now(),
          reqId: id,
          error: error,
          detail: detail,
          model: settings.model,
          endpoint: String(settings.baseUrl || '') + '/chat/completions',
          url: pg.url || '',
          textLength: body.length
        }
      })
      .catch(() => {});
    push({ type: 'PET_STREAM_END', reqId: id, ok: false, error: error, detail: detail });
    notifyPanel({ type: 'PET_ANSWER_DONE' });
    if (!shown) await openPanelBestEffort(tabId);
    return { ok: false, error: error, detail: detail };
  }
}

function collectSelection() {
  let text = '';
  try {
    const sel = window.getSelection();
    text = sel ? String(sel.toString()) : '';
  } catch (e) {}
  return {
    text: String(text || '').trim(),
    title: document.title || '',
    url: location.href
  };
}

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;

  if (!/^https?:/i.test(tab.url || '')) {
    notifyPanel({ type: 'PET_TOAST', text: '这个页面读不了，切到题目页面再按快捷键。' });
    return;
  }

  if (command === 'ask-selection') {
    let out = [];
    try {
      out = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: collectSelection
      });
    } catch (e) {
      out = [];
    }

    let best = null;
    for (const r of out || []) {
      const v = r && r.result;
      if (!v || !v.text) continue;
      if (!best || v.text.length > best.text.length) {
        best = { text: v.text, title: v.title, url: v.url, frameId: r.frameId };
      }
    }

    if (!best) {
      await sendFrame(tab.id, { type: 'PET_TOAST', text: '没有选中文字。先用鼠标划选题目，再按 Alt+S。' });
      return;
    }

    // 交给拿到选区的那个框架走完整流程（含字体还原），卡片仍然显示在顶层
    let handled = false;
    try {
      const r = await chrome.tabs.sendMessage(
        tab.id,
        { type: 'PET_ASK_HERE', text: best.text, question: '' },
        { frameId: best.frameId }
      );
      handled = !!(r && r.ok);
    } catch (e) {
      handled = false;
    }
    if (handled) return;

    await streamAsk({
      tabId: tab.id,
      text: best.text,
      page: { title: best.title, url: best.url, text: best.text, mode: 'selection' },
      label: '选中的 ' + best.text.length + ' 字'
    });
    return;
  }

  if (command === 'ask-whole-page' || command === 'ask-page') {
    // Alt+A = 点选模式：不依赖"选中文字"，页面禁止选中/复制（智慧树这类）也能问。
    // 发给所有框架，谁被点到谁处理，卡片照旧显示在顶层框架。
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PET_PICK_MODE', on: true });
    } catch (e) {
      await sendFrame(tab.id, { type: 'PET_TOAST', text: '点选模式启动失败，刷新页面再试。' });
    }
    return;
  }
});

async function applyFollowToTabs(on, debounce) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    chrome.tabs.sendMessage(t.id, { type: 'SET_FOLLOW', on, debounce }).catch(() => {});
  }
}

async function openInDeepSeek(text) {
  await chrome.storage.local.set({ pendingFill: { text: text, at: Date.now() } });
  const tabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' });
  if (tabs && tabs.length && tabs[0].id) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_DEEPSEEK' }).catch(() => null);
    if (r && r.ok) return { ok: true, reused: true, filled: true };
    return { ok: true, reused: true, filled: false, note: '已切到 DeepSeek 页面，但没找到输入框，请手动粘贴。' };
  }
  await chrome.tabs.create({ url: 'https://chat.deepseek.com/' });
  return { ok: true, reused: false, filled: false, note: '已打开 DeepSeek，页面加载后会自动填入。' };
}

function diagnoseFrame() {
  const info = {
    url: location.href,
    title: document.title || '',
    childFrames: 0,
    textLen: 0,
    puaRatio: 0,
    head: '',
    iframes: [],
    hiddenText: 0
  };
  try {
    info.childFrames = document.querySelectorAll('iframe, frame').length;
    info.iframes = Array.from(document.querySelectorAll('iframe'))
      .slice(0, 8)
      .map((f) => String(f.src || f.getAttribute('src') || '(无 src)').slice(0, 140));
  } catch (e) {}
  try {
    const t = String((document.body && document.body.innerText) || '');
    info.textLen = t.length;
    const probe = t.slice(0, 5000);
    let pua = 0;
    for (const ch of probe) {
      const c = ch.codePointAt(0);
      if ((c >= 0xe000 && c <= 0xf8ff) || c === 0xfffd) pua++;
    }
    info.puaRatio = Math.round((pua / Math.max(1, probe.length)) * 1000) / 1000;
    info.head = t.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch (e) {}
  return info;
}

async function runDiag() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return { ok: false, error: '没有找到当前标签页。' };
  if (!/^https?:/i.test(tab.url || '')) {
    return { ok: false, error: '这个页面读不了（浏览器内置页/扩展页/商店页）。请切到题目所在的网页再试。' };
  }

  let ex = [];
  try {
    ex = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractFromPage,
      args: [{ mode: 'smart', preferSelection: false }]
    });
  } catch (e) {
    return { ok: false, error: '注入失败：' + String((e && e.message) || e) };
  }

  let di = [];
  try {
    di = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: diagnoseFrame
    });
  } catch (e) {}

  const lines = [];
  lines.push('【小眼诊断报告】');
  lines.push('版本: ' + chrome.runtime.getManifest().version);
  lines.push('标签页: ' + (tab.title || ''));
  lines.push('地址: ' + (tab.url || ''));
  lines.push('框架数: ' + ex.length);
  lines.push('');

  const rows = [];
  for (let i = 0; i < ex.length; i++) {
    const p = ex[i] && ex[i].result;
    const d = (di[i] && di[i].result) || {};
    if (!p && !d.url) continue;
    rows.push({
      i,
      url: (d.url || (p && p.url) || '').slice(0, 150),
      textLen: d.textLen || (p && p.text ? p.text.length : 0),
      mode: (p && p.mode) || '-',
      strict: p && p.strict ? '是' : '否',
      count: (p && p.questionCount) || 0,
      pua: d.puaRatio,
      childFrames: d.childFrames,
      head: d.head || ((p && p.text) || '').replace(/\s+/g, ' ').slice(0, 160)
    });
  }

  rows.sort((a, b) => (b.count * 1e6 + Math.min(b.textLen, 99999)) - (a.count * 1e6 + Math.min(a.textLen, 99999)));

  for (const r of rows.slice(0, 8)) {
    lines.push('—— 框架 ' + r.i + ' ——');
    lines.push('地址: ' + r.url);
    lines.push('文字长度: ' + r.textLen + ' | 识别到题目: ' + r.count + ' 道 | 判定: ' + r.mode + ' | 严格命中: ' + r.strict);
    if (r.pua !== undefined) lines.push('字符加密迹象: ' + r.pua + (r.pua > 0.05 ? '（偏高，疑似自定义字体加密）' : ''));
    if (r.childFrames) lines.push('子框架数: ' + r.childFrames);
    lines.push('开头文字: ' + r.head);
    lines.push('');
  }

  const best = rows[0];
  if (!best || !best.textLen) {
    lines.push('结论: 所有框架都没读到文字。页面可能用了 canvas / 图片渲染，或内容还没加载完。');
  } else if (best.pua > 0.05) {
    lines.push('结论: 正文疑似被自定义字体加密，提取到的会是乱码 —— 这种情况纯文字方案拿不到正确答案。');
  } else if (best.count === 0) {
    lines.push('结论: 读到了文字但没识别出题目，开头文字见上，可按这个格式告诉我实际的题号样式。');
  }

  return { ok: true, report: lines.join('\n') };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.followMode || changes.followDebounce) {
    chrome.storage.local
      .get({ followMode: false, followDebounce: 1500 })
      .then((v) => applyFollowToTabs(!!v.followMode, Number(v.followDebounce)))
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'PET_EXTRACT') {
    runExtract(msg.mode || 'smart', false).then(
      (r) => sendResponse(r),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true;
  }

  if (msg.type === 'PET_ASK') {
    runAsk(msg.question || '', msg.text || '').then(
      (r) => sendResponse(r),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true;
  }

  if (msg.type === 'PET_ASK_STREAM') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const rawText = String(msg.text || '');
    if (!tabId || !rawText.trim()) {
      sendResponse({ ok: false, error: '没有拿到要问的文字。' });
      return false;
    }
    streamAsk({
      tabId: tabId,
      text: rawText,
      question: msg.question || '',
      page: {
        title: msg.title || (sender.tab && sender.tab.title) || '',
        url: msg.url || (sender.tab && sender.tab.url) || '',
        text: rawText,
        mode: 'selection'
      },
      label: '小眼 · 选中的 ' + rawText.trim().length + ' 字',
      reqId: msg.reqId,
      note: msg.note || ''
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'PET_FILL_DEEPSEEK') {
    openInDeepSeek(msg.text || '').then(
      (r) => sendResponse(r),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true;
  }

  if (msg.type === 'PET_DIAG') {
    runDiag().then(
      (r) => sendResponse(r),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
    return true;
  }

  if (msg.type === 'PET_SYNC_FOLLOW') {
    applyFollowToTabs(!!msg.on, Number(msg.debounce) || 1500).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (msg.type === SETTLED) {
    runSettled(msg);
    return false;
  }

  return false;
});
