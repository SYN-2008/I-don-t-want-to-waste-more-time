/* 小眼 · 页面助手 —— 内容脚本
 *
 * 1) 选中文字 → 旁边冒出一个小按钮 → 点一下，答案直接浮在网页上（流式输出）
 * 2) 跟随模式（仅顶层框架）：页面稳定后自动提取
 *
 * 答案卡片统一由顶层框架渲染，所以本脚本允许注入到所有 iframe。
 */
(() => {
  const IS_TOP = (() => {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  })();

  /* ------------------------------------------------------------------ *
   * 设置
   * ------------------------------------------------------------------ */
  const cfg = { selBubble: true, selAutoAsk: false, autoCopyAnswer: true };

  try {
    chrome.storage.local
      .get({ selBubble: true, selAutoAsk: false, autoCopyAnswer: true })
      .then((v) => Object.assign(cfg, v))
      .catch(() => {});
    chrome.storage.onChanged.addListener((changes) => {
      for (const k of Object.keys(cfg)) {
        if (changes[k]) cfg[k] = changes[k].newValue;
      }
    });
  } catch (e) {}

  /* ------------------------------------------------------------------ *
   * 跟随模式（只在顶层框架跑，避免每个 iframe 都重复监听）
   * ------------------------------------------------------------------ */
  let observer = null;
  let timer = null;
  let urlTimer = null;
  let follow = false;
  let debounce = 1500;
  let lastHash = '';
  let lastHref = location.href;

  function pageHash() {
    const t = document.body ? String(document.body.innerText || '').trim() : '';
    return location.href + '|' + t.length + '|' + t.slice(0, 400);
  }

  function settle() {
    const h = pageHash();
    if (h === lastHash) return;
    lastHash = h;
    try {
      chrome.runtime.sendMessage({ type: 'PAGE_SETTLED', url: location.href, title: document.title }).catch(() => {});
    } catch (e) {}
  }

  function schedule() {
    if (!follow || !IS_TOP) return;
    clearTimeout(timer);
    timer = setTimeout(settle, debounce);
  }

  function attach() {
    if (!IS_TOP || observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (!urlTimer) {
      urlTimer = setInterval(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          schedule();
        }
      }, 800);
    }
  }

  function detach() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(timer);
    if (urlTimer) {
      clearInterval(urlTimer);
      urlTimer = null;
    }
  }

  if (IS_TOP) {
    try {
      chrome.storage.local.get({ followMode: false, followDebounce: 1500 }).then((v) => {
        follow = !!v.followMode;
        debounce = Number(v.followDebounce) || debounce;
        if (follow) attach();
      });
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.followDebounce) debounce = Number(changes.followDebounce.newValue) || debounce;
      });
    } catch (e) {}

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule();
    });
  }

  /* ------------------------------------------------------------------ *
   * 悬浮层（Shadow DOM，隔离页面样式）
   * ------------------------------------------------------------------ */
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .pet-bubble, .pet-card, .pet-toast {
      position: fixed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      pointer-events: auto;
    }
    .pet-bubble {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 11px;
      border: 1px solid #cdd8d3; border-radius: 999px;
      background: #ffffff; color: #1f2328;
      font-size: 12.5px; line-height: 1; font-weight: 600;
      box-shadow: 0 4px 16px rgba(15, 40, 32, .16);
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .pet-bubble:hover { border-color: #2f8f6f; color: #0f6e56; }
    .pet-bubble .zap { color: #0f6e56; font-size: 13px; }

    .pet-card {
      width: 384px; max-width: min(384px, 46vw);
      max-height: 62vh; display: flex; flex-direction: column;
      border: 1px solid #d7e0dc; border-radius: 13px;
      background: #ffffff; color: #1f2328;
      box-shadow: 0 14px 44px rgba(15, 40, 32, .22);
      overflow: hidden;
    }
    .pet-head {
      display: flex; align-items: center; gap: 7px;
      padding: 9px 11px;
      border-bottom: 1px solid #eef2f0; background: #fbfcfc;
      cursor: move; user-select: none;
    }
    .pet-dot { width: 8px; height: 8px; border-radius: 50%; background: #0f6e56; flex: none; }
    .pet-dot.busy { animation: petpulse 1s ease-in-out infinite; }
    .pet-dot.bad { background: #a32d2d; }
    @keyframes petpulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
    .pet-label { font-size: 12.5px; font-weight: 600; color: #0f6e56; flex: 1; }
    .pet-hint { font-size: 11px; color: #8a9490; }
    .pet-x {
      border: 0; background: transparent; color: #8a9490;
      font-size: 15px; line-height: 1; cursor: pointer; padding: 2px 4px; border-radius: 6px;
    }
    .pet-x:hover { background: #f0f3f2; color: #1f2328; }

    .pet-body {
      padding: 11px 12px; overflow: auto; flex: 1;
      font-size: 13.5px; line-height: 1.68; color: #1f2328;
      word-break: break-word; white-space: pre-wrap;
    }
    .pet-body p { margin: 0 0 8px; }
    .pet-body p:last-child { margin-bottom: 0; }
    .pet-body b, .pet-body strong { color: #0b5b46; }
    .pet-body pre {
      margin: 6px 0; padding: 9px 10px; border-radius: 8px;
      background: #f4f7f5; border: 1px solid #e6ece9;
      font-family: ui-monospace, Consolas, monospace; font-size: 12px;
      white-space: pre-wrap; overflow: auto;
    }
    .pet-body code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #f4f7f5; padding: 1px 4px; border-radius: 4px; }
    .pet-body pre code { background: transparent; padding: 0; }
    .pet-body .err { color: #a32d2d; }
    .pet-body .dim { color: #8a9490; font-size: 12.5px; }
    .pet-caret { display: inline-block; width: 7px; height: 14px; background: #0f6e56; vertical-align: -2px; animation: petpulse .9s steps(2) infinite; }

    .pet-foot {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px 10px; border-top: 1px solid #eef2f0; background: #fbfcfc;
    }
    .pet-btn {
      border: 1px solid #cdd8d3; background: #fff; color: #1f2328;
      font-size: 12px; padding: 5px 10px; border-radius: 8px; cursor: pointer;
      font-family: inherit;
    }
    .pet-btn:hover { border-color: #2f8f6f; color: #0f6e56; }
    .pet-btn.primary { background: #0f6e56; border-color: #0f6e56; color: #fff; }
    .pet-btn.primary:hover { background: #0d5c48; color: #fff; }

    .pet-toast {
      padding: 9px 13px; border-radius: 10px;
      background: #1f2328; color: #fff; font-size: 12.5px;
      box-shadow: 0 8px 24px rgba(0,0,0,.28); max-width: 320px;
    }

    .pet-pick {
      position: fixed; display: none; pointer-events: none;
      border: 2px solid #0f6e56; background: rgba(15, 110, 86, .08);
      border-radius: 4px; z-index: 2147483646;
    }
  `;

  let host = null;
  let shadow = null;
  let bubble = null;
  let bubbleText = '';
  let toastEl = null;
  let toastTimer = null;
  let card = null; // { reqId, root, body, label, status, text, answer, busy }
  let cardPos = null;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    // 不设 id、不设可识别的 class，降低被页面脚本定位的概率。
    // closed 模式：页面脚本拿不到 shadowRoot 引用，改不了卡片里的内容。
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;contain:layout style;';
    shadow = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);
    (document.body || document.documentElement).appendChild(host);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ---------------- 小气泡 ---------------- */
  function hideBubble() {
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  function showBubble(rect, text) {
    if (!cfg.selBubble) return;
    ensureHost();
    hideBubble();
    bubbleText = text;
    bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    bubble.innerHTML = '<span class="zap">⚡</span><span>问小眼</span>';
    bubble.title = '把选中的 ' + text.length + ' 个字发给 DeepSeek（Alt+S 也可以）';
    const x = clamp(rect.right - 40, 8, window.innerWidth - 96);
    const y = clamp(rect.bottom + 8, 8, window.innerHeight - 44);
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
    bubble.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = bubbleText;
      hideBubble();
      startAsk(t);
    });
    shadow.appendChild(bubble);
  }

  /* ---------------- 提示条 ---------------- */
  function toast(text, ms) {
    ensureHost();
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = document.createElement('div');
    toastEl.className = 'pet-toast';
    toastEl.textContent = text;
    toastEl.style.right = '18px';
    toastEl.style.bottom = '18px';
    shadow.appendChild(toastEl);
    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
    }, ms || 2600);
  }

  /* ---------------- 简易 Markdown ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function mdLite(src) {
    const chunks = esc(src).split('```');
    return chunks
      .map((chunk, i) => {
        if (i % 2 === 1) {
          const body = chunk.replace(/^[a-zA-Z0-9+#.-]*\r?\n/, '').replace(/\s+$/, '');
          return '<pre><code>' + body + '</code></pre>';
        }
        return chunk
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
          .replace(/^#{1,4}[ \t]*(.+)$/gm, '<b>$1</b>')
          .split(/\n{2,}/)
          .map((b) => {
            const t = b.trim();
            if (!t) return '';
            return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
          })
          .join('');
      })
      .join('');
  }

  /* ---------------- 拷贝 ---------------- */
  async function copyText(text) {
    const s = String(text || '');
    if (!s) return false;
    // 首选异步剪贴板 API：不触发 copy 事件，页面的防复制钩子拦不到。
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch (e) {}
    // 回退：execCommand 会触发 copy 事件。学习通这类站点会挂 copy 钩子
    // 改写剪贴板内容（把答案换成它们的警告文字），所以在捕获阶段
    // 抢先把我们自己的数据写进去，并拦掉页面世界能收到的事件。
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      const onCopy = (e) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.clipboardData) e.clipboardData.setData('text/plain', s);
      };
      ta.addEventListener('copy', onCopy, true);
      ta.select();
      const ok = document.execCommand('copy');
      ta.removeEventListener('copy', onCopy, true);
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 答案卡片 ---------------- */
  function closeCard() {
    detachDrag();
    if (card && card.root) card.root.remove();
    card = null;
  }

  let dragListeners = null;

  function detachDrag() {
    if (!dragListeners) return;
    window.removeEventListener('mousemove', dragListeners.move, true);
    window.removeEventListener('mouseup', dragListeners.up, true);
    dragListeners = null;
  }

  function paintCard() {
    if (!card) return;
    const { body, answer, status, busy } = card;
    let html = '';
    if (answer) html += mdLite(answer);
    if (busy) html += '<span class="pet-caret"></span>';
    if (status) html += (html ? '<p class="dim">' : '<p class="dim">') + esc(status) + '</p>';
    body.innerHTML = html || '<p class="dim">思考中…</p>';
    body.scrollTop = body.scrollHeight;
  }

  function renderCard(reqId, label, text) {
    ensureHost();
    closeCard();
    const root = document.createElement('div');
    root.className = 'pet-card';

    const head = document.createElement('div');
    head.className = 'pet-head';
    head.innerHTML =
      '<span class="pet-dot busy"></span>' +
      '<span class="pet-label">' +
      esc(label || '小眼') +
      '</span>' +
      '<span class="pet-hint">Alt+S 再问</span>' +
      '<button class="pet-x" title="关闭">×</button>';

    const body = document.createElement('div');
    body.className = 'pet-body';
    body.innerHTML = '<p class="dim">思考中…</p>';

    const foot = document.createElement('div');
    foot.className = 'pet-foot';

    const bCopy = document.createElement('button');
    bCopy.className = 'pet-btn primary';
    bCopy.textContent = '复制答案';
    bCopy.onclick = async () => {
      const ok = await copyText(card && card.answer);
      toast(ok ? '答案已复制' : '复制失败，手动选中吧');
    };

    const bCopyQ = document.createElement('button');
    bCopyQ.className = 'pet-btn';
    bCopyQ.textContent = '复制题目';
    bCopyQ.onclick = async () => {
      const ok = await copyText(card && card.text);
      toast(ok ? '题目已复制' : '没有题目文字可复制');
    };

    const bAgain = document.createElement('button');
    bAgain.className = 'pet-btn';
    bAgain.textContent = '重新问';
    bAgain.onclick = () => {
      const t = card && (card.rawText || card.text);
      if (!t) return toast('这条没有原文，重新划选一次吧');
      startAsk(t);
    };

    const bRaw = document.createElement('button');
    bRaw.className = 'pet-btn';
    bRaw.textContent = '原文重问';
    bRaw.title = '跳过字体还原，直接把页面上的原文发给 DeepSeek';
    bRaw.onclick = () => {
      const t = card && (card.rawText || card.text);
      if (!t) return toast('这条没有原文，重新划选一次吧');
      startAsk(t, '', { skipDecode: true });
    };

    const bDiag = document.createElement('button');
    bDiag.className = 'pet-btn';
    bDiag.textContent = '复制诊断';
    bDiag.onclick = async () => {
      if (!card) return;
      const lines = [
        '【小眼诊断】' + new Date().toLocaleString(),
        '页面: ' + location.href,
        '标题: ' + (document.title || ''),
        '送出的字数: ' + String(card.text || '').length,
        '页面原文长度: ' + String(card.rawText || '').length,
        '文字还原: ' + (card.decodeNote || '未触发'),
        '结果: ' + (card.status ? '出错' : '正常') + ' | 已知错误: ' + (card.error || '无'),
        '回答长度: ' + String(card.answer || '').length
      ];
      if (card.detail) lines.push('—— 接口原始信息 ——', card.detail);
      const ok = await copyText(lines.join('\n'));
      toast(ok ? '诊断信息已复制，粘给我就行' : '复制失败，手动选中吧');
    };

    foot.appendChild(bCopy);
    foot.appendChild(bCopyQ);
    foot.appendChild(bAgain);
    foot.appendChild(bRaw);
    foot.appendChild(bDiag);

    root.appendChild(head);
    root.appendChild(body);
    root.appendChild(foot);
    root.querySelector('.pet-x').onclick = closeCard;

    // 位置：默认贴右侧中部，拖动后记住
    const p = cardPos || { x: window.innerWidth - 400, y: Math.max(16, window.innerHeight * 0.12) };
    const x = clamp(p.x, 8, Math.max(8, window.innerWidth - 400));
    const y = clamp(p.y, 8, Math.max(8, window.innerHeight - 120));
    root.style.left = x + 'px';
    root.style.top = y + 'px';

    // 拖动
    let dragging = null;
    head.addEventListener('mousedown', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('pet-x')) return;
      const r = root.getBoundingClientRect();
      dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    const onMove = (e) => {
      if (!dragging) return;
      const nx = clamp(e.clientX - dragging.dx, 4, window.innerWidth - 60);
      const ny = clamp(e.clientY - dragging.dy, 4, window.innerHeight - 40);
      root.style.left = nx + 'px';
      root.style.top = ny + 'px';
      cardPos = { x: nx, y: ny };
    };
    const onUp = () => {
      dragging = null;
    };
    detachDrag();
    dragListeners = { move: onMove, up: onUp };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);

    shadow.appendChild(root);
    card = {
      reqId: reqId,
      root: root,
      body: body,
      label: label || '',
      status: '',
      error: '',
      detail: '',
      text: text || '',
      rawText: text || '',
      decodeNote: '',
      answer: '',
      busy: true
    };
    return card;
  }

  /* ---------------- 学习通字体加密还原 ----------------
   * 学习通把部分汉字换成假字符，再用内联的 @font-face（font-cxsecret）
   * 把假字符"画"成正确的字。屏幕上正常、复制出来是乱码。
   * 还原原理：加密字体就在页面 CSS 里（base64），把它加载进来后，
   * 用 canvas 把"密文字形"和 6000 个常用字的"真字形"逐一比对，
   * 最像的就是原字。整个过程在本地完成，不花钱、不发请求。
   * ------------------------------------------------------------------ */
  const CX_GL = 36;  // 画布边长
  const CX_N = 24;   // 归一化位图边长：裁掉空白、缩放到同一尺寸再比，字的大小/位置差异不再干扰
  const CX_WORDS = (CX_N * CX_N + 31) >> 5;
  const CX_REF_FONTS = ['"Microsoft YaHei", sans-serif', 'SimSun, sans-serif'];
  const CX_MAX_SUSPECT = 900; // 一次最多核对多少字，防止卡死
  let cxCache = null; // { key, bits: Map<char, packed[]> }

  const CX_POP16 = (() => {
    const t = new Uint8Array(65536);
    for (let i = 1; i < 65536; i++) t[i] = (i & 1) + t[i >> 1];
    return t;
  })();

  function cxPop32(v) {
    return CX_POP16[v & 0xffff] + CX_POP16[(v >>> 16) & 0xffff];
  }

  function cxChars() {
    try {
      return String(typeof PET_CX_CHARS !== 'undefined' ? PET_CX_CHARS : '');
    } catch (e) {
      return '';
    }
  }

  /** 页面里那份加密字体（font-cxsecret）的 base64 */
  function findCxFont() {
    let styles = [];
    try {
      styles = Array.from(document.querySelectorAll('style'));
    } catch (e) {
      return null;
    }
    for (const st of styles) {
      const t = st.textContent || '';
      if (t.indexOf('font-cxsecret') < 0) continue;
      let m = t.match(/data:application\/font-[a-z0-9]+;[^'")]*base64,([A-Za-z0-9+/=]+)/);
      if (!m) m = t.match(/data:font\/[a-z0-9]+;[^'")]*base64,([A-Za-z0-9+/=]+)/);
      if (m && m[1]) return { b64: m[1] };
    }
    return null;
  }

  function b64Bytes(b64) {
    try {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    } catch (e) {
      return null;
    }
  }

  function cxTag(bytes, o) {
    return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  }

  /** 取出字体里的 cmap 表。TrueType/OpenType 直接切；WOFF 里那张表可能是压缩的，先解开。 */
  async function cxCmapTable(bytes) {
    if (!bytes || bytes.length < 64) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (cxTag(bytes, 0) === 'wOFF') {
      const num = dv.getUint16(12);
      for (let i = 0; i < num; i++) {
        const o = 44 + i * 20;
        if (o + 20 > bytes.length) break;
        if (cxTag(bytes, o) !== 'cmap') continue;
        const off = dv.getUint32(o + 4);
        const comp = dv.getUint32(o + 8);
        const orig = dv.getUint32(o + 12);
        if (off + comp > bytes.length) return null;
        const raw = bytes.subarray(off, off + comp);
        if (comp >= orig) return raw;
        try {
          const ds = new DecompressionStream('deflate');
          const buf = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
          return new Uint8Array(buf);
        } catch (e) {
          return null;
        }
      }
      return null;
    }

    if (bytes[0] !== 0 || bytes[1] !== 1) return null; // 只认 sfnt / woff
    const num = dv.getUint16(4);
    for (let i = 0; i < num; i++) {
      const o = 12 + i * 16;
      if (o + 16 > bytes.length) break;
      if (cxTag(bytes, o) !== 'cmap') continue;
      const off = dv.getUint32(o + 8);
      const len = dv.getUint32(o + 12);
      if (!off || off + len > bytes.length) return null;
      return bytes.subarray(off, off + len);
    }
    return null;
  }

  /* 只认字体里真正定义了的码位。
     学习通那份字体只覆盖它换过的字；没被覆盖的字根本没加密，
     一旦对它们做"字形比对"，就会把好好的题目改成别的字（之前就是这个毛病）。 */
  function cxCoveredFromCmap(cm) {
    if (!cm || cm.length < 8) return null;
    const dv = new DataView(cm.buffer, cm.byteOffset, cm.byteLength);
    const n = dv.getUint16(2);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      const rec = 4 + i * 8;
      if (rec + 8 > cm.length) break;
      const sub = dv.getUint32(rec + 4);
      if (sub + 2 > cm.length) continue;
      const fmt = dv.getUint16(sub);
      const plat = dv.getUint16(rec);
      let sc = 0;
      if (fmt === 4) sc = 2;
      else if (fmt === 12) sc = 3;
      else if (fmt === 6) sc = 1;
      if (!sc) continue;
      if (plat === 3) sc += 1;
      if (sc > bestScore) {
        bestScore = sc;
        best = sub;
      }
    }
    if (best < 0) return null;

    const set = new Set();
    const fmt = dv.getUint16(best);
    try {
      if (fmt === 4) {
        const seg = dv.getUint16(best + 6) / 2;
        const endPos = best + 14;
        const startPos = endPos + seg * 2 + 2;
        const deltaPos = startPos + seg * 2;
        const rangePos = deltaPos + seg * 2;
        for (let s = 0; s < seg; s++) {
          const end = dv.getUint16(endPos + s * 2);
          const start = dv.getUint16(startPos + s * 2);
          const delta = dv.getInt16(deltaPos + s * 2);
          const ro = dv.getUint16(rangePos + s * 2);
          if (start > end || end === 0xffff) continue;
          for (let cp = start; cp <= end; cp++) {
            let gid = 0;
            if (ro === 0) gid = (cp + delta) & 0xffff;
            else {
              const gp = rangePos + s * 2 + ro + (cp - start) * 2;
              if (gp + 2 > cm.length) continue;
              gid = dv.getUint16(gp);
              if (gid) gid = (gid + delta) & 0xffff;
            }
            if (gid) set.add(cp);
            if (set.size > 30000) break;
          }
        }
      } else if (fmt === 12) {
        const groups = dv.getUint32(best + 12);
        for (let g = 0; g < groups && g < 3000; g++) {
          const o = best + 16 + g * 12;
          if (o + 12 > cm.length) break;
          const c0 = dv.getUint32(o);
          const c1 = dv.getUint32(o + 4);
          const gid0 = dv.getUint32(o + 8);
          if (c1 - c0 > 60000) continue;
          for (let cp = c0; cp <= c1; cp++) {
            if (gid0 + (cp - c0)) set.add(cp);
            if (set.size > 30000) break;
          }
        }
      } else {
        const first = dv.getUint16(best + 6);
        const cnt = dv.getUint16(best + 8);
        for (let i = 0; i < cnt; i++) {
          if (dv.getUint16(best + 10 + i * 2)) set.add(first + i);
        }
      }
    } catch (e) {
      return null;
    }
    return set.size ? set : null;
  }

  function cxRenderer(fontSpec) {
    const c = document.createElement('canvas');
    c.width = CX_GL;
    c.height = CX_GL;
    const x = c.getContext('2d', { willReadFrequently: true });
    return (ch) => {
      x.clearRect(0, 0, CX_GL, CX_GL);
      x.fillStyle = '#000';
      x.font = Math.round(CX_GL * 0.78) + 'px ' + fontSpec;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(ch, CX_GL / 2, CX_GL / 2 + 1);
      const d = x.getImageData(0, 0, CX_GL, CX_GL).data;
      const a = new Uint8Array(CX_GL * CX_GL);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      return a;
    };
  }

  /** 灰度位图 → 裁掉空白 → 缩放到 CX_N×CX_N → 二值化打包（位运算比对，比逐像素快很多） */
  function cxPack(alpha) {
    let x0 = CX_GL, y0 = CX_GL, x1 = -1, y1 = -1;
    for (let y = 0; y < CX_GL; y++) {
      for (let x = 0; x < CX_GL; x++) {
        if (alpha[y * CX_GL + x] > 40) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const words = new Uint32Array(CX_WORDS);
    if (x1 < x0 || y1 < y0) return { words: words, pop: 0 };
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    let pop = 0;
    for (let ty = 0; ty < CX_N; ty++) {
      const iy0 = Math.floor(y0 + (ty * bh) / CX_N);
      const iy1 = Math.max(iy0 + 1, Math.ceil(y0 + ((ty + 1) * bh) / CX_N));
      for (let tx = 0; tx < CX_N; tx++) {
        const ix0 = Math.floor(x0 + (tx * bw) / CX_N);
        const ix1 = Math.max(ix0 + 1, Math.ceil(x0 + ((tx + 1) * bw) / CX_N));
        let sum = 0;
        let cnt = 0;
        for (let y = iy0; y < iy1 && y < CX_GL; y++) {
          for (let x = ix0; x < ix1 && x < CX_GL; x++) {
            sum += alpha[y * CX_GL + x];
            cnt++;
          }
        }
        if (!cnt || sum / cnt < 110) continue;
        const bit = ty * CX_N + tx;
        words[bit >> 5] |= 1 << (bit & 31);
        pop++;
      }
    }
    return { words: words, pop: pop };
  }

  function cxIoU(a, b) {
    let inter = 0;
    for (let i = 0; i < CX_WORDS; i++) inter += cxPop32(a.words[i] & b.words[i]);
    const uni = a.pop + b.pop - inter;
    return uni ? inter / uni : 0;
  }

  async function cxRefBits(key) {
    if (cxCache && cxCache.key === key) return cxCache.bits;
    const chars = cxChars().slice(0, 6000);
    if (!chars) return null;
    const bits = new Map();
    for (const fs of CX_REF_FONTS) {
      const draw = cxRenderer(fs);
      for (const ch of chars) {
        let arr = bits.get(ch);
        if (!arr) {
          arr = [];
          bits.set(ch, arr);
        }
        arr.push(cxPack(draw(ch)));
      }
    }
    cxCache = { key: key, bits: bits };
    return bits;
  }

  function cxIsSuspect(c) {
    return (
      (c >= 0x3400 && c <= 0x9fff) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xe000 && c <= 0xf8ff) ||
      c === 0xfffd
    );
  }

  /** 只有真的需要时才还原；还原不可靠的时候宁可原样发出去，绝不把好好的题目改成别的字 */
  async function decodeCxText(t) {
    const font = findCxFont();
    if (!font) return { text: t, changed: 0, suspect: 0, unresolved: 0, note: '' };
    const dataUrl = 'data:font/ttf;base64,' + font.b64;

    try {
      await Promise.race([
        (async () => {
          const ff = new FontFace('pet-cxsecret', 'url(' + dataUrl + ')');
          const loaded = await ff.load();
          document.fonts.add(loaded);
        })(),
        new Promise((r) => setTimeout(r, 8000))
      ]);
    } catch (e) {
      return { text: t, changed: 0, suspect: 0, unresolved: 0, note: '' };
    }

    // 字体表里定义过的码位 = 加密字；没定义的，一律原样保留
    let covered = null;
    try {
      const cm = await cxCmapTable(b64Bytes(font.b64));
      covered = cm ? cxCoveredFromCmap(cm) : null;
    } catch (e) {
      covered = null;
    }
    const trusted = !!covered;

    const secDraw = cxRenderer('pet-cxsecret, "Microsoft YaHei", sans-serif');
    const refDraws = CX_REF_FONTS.map((fs) => cxRenderer(fs));

    const out = String(t).split('');
    const items = [];
    let suspect = 0;
    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      const cp = ch.codePointAt(0);
      if (!cxIsSuspect(cp)) continue;
      if (covered && !covered.has(cp)) continue;
      const g = cxPack(secDraw(ch));
      if (!g.pop) continue;
      let same = 0;
      for (const rd of refDraws) {
        const s = cxIoU(g, cxPack(rd(ch)));
        if (s > same) same = s;
      }
      if (same >= 0.9) continue; // 加密字体把它画得和正常字形一样 → 它没被换掉
      suspect++;
      if (items.length < CX_MAX_SUSPECT) items.push({ i: i, g: g });
    }

    if (!suspect) return { text: t, changed: 0, suspect: 0, unresolved: 0, note: '' };

    let bits = null;
    try {
      bits = await cxRefBits(font.b64.length + ':' + font.b64.slice(-24));
    } catch (e) {
      bits = null;
    }
    if (!bits) {
      return { text: t, changed: 0, suspect: suspect, unresolved: suspect, note: '' };
    }

    const minScore = trusted ? 0.34 : 0.6;
    const minGap = trusted ? 0.02 : 0.05;
    let changed = 0;
    let sum = 0;
    for (const it of items) {
      const ap = it.g.pop;
      let best = '';
      let bestScore = 0;
      let second = 0;
      for (const entry of bits) {
        for (let k = 0; k < entry[1].length; k++) {
          const b = entry[1][k];
          if (!b.pop) continue;
          const lo = ap < b.pop ? ap : b.pop;
          const hi = ap < b.pop ? b.pop : ap;
          if (lo <= bestScore * hi) continue; // 相似度上限都超不过当前最好 → 直接跳过
          const s = cxIoU(it.g, b);
          if (s > bestScore) {
            second = bestScore;
            bestScore = s;
            best = entry[0];
          } else if (s > second) {
            second = s;
          }
        }
      }
      // 最像的那个要足够像，而且要比"第二像的"明显更像，否则宁可不改
      if (best && bestScore >= minScore && bestScore - second >= minGap) {
        out[it.i] = best;
        changed++;
        sum += bestScore;
      }
    }

    const avg = changed ? Math.round((sum / changed) * 100) / 100 : 0;

    if (!changed) {
      return {
        text: t,
        changed: 0,
        suspect: suspect,
        unresolved: suspect,
        note: '页面用了加密字体，但一个字都没能可靠还原，已按原文发问，答案大概率不准。'
      };
    }

    // 置信度不够：不冒险，按原文发
    const okTrusted = trusted && changed / suspect >= 0.6;
    const okUntrusted = !trusted && changed / suspect >= 0.85 && avg >= 0.68;
    if (!okTrusted && !okUntrusted) {
      return {
        text: t,
        changed: 0,
        suspect: suspect,
        unresolved: suspect,
        note: '页面字体疑似加密，但还原置信度不够（平均 ' + avg + '），已按原文发问，答案可能不准。'
      };
    }

    return {
      text: out.join(''),
      changed: changed,
      suspect: suspect,
      unresolved: suspect - changed,
      note:
        '已还原加密字体 ' + changed + '/' + suspect + ' 字（平均相似度 ' + avg + '，本地字形比对）' +
        (suspect - changed ? '，' + (suspect - changed) + ' 字没能还原' : '')
    };
  }

  /** 对外统一入口：返回 { text, note } */
  async function decodeText(t) {
    const raw = String(t || '');
    if (!findCxFont()) return { text: raw, note: '' };
    try {
      const r = await Promise.race([
        decodeCxText(raw),
        new Promise((res) => setTimeout(() => res(null), 20000))
      ]);
      if (!r) return { text: raw, note: '字体还原超时，已按原文发送。' };
      if (r.changed) return { text: r.text, note: r.note };
      return { text: raw, note: r.note || '' };
    } catch (e) {
      return { text: raw, note: '' };
    }
  }

  function startAsk(text, question, opts) {
    const t = String(text || '').trim();
    if (t.length < 2) {
      toast('先选中要问的文字');
      return;
    }
    const skipDecode = !!(opts && opts.skipDecode);
    const reqId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // 答案卡片统一显示在顶层框架（顶层才是你在看的那个视口）
    if (IS_TOP) {
      renderCard(reqId, '小眼 · ' + t.length + ' 字', t);
    } else {
      toast('已送出，答案会显示在页面右上角');
    }

    const mine = () => IS_TOP && card && card.reqId === reqId;

    if (skipDecode || !findCxFont()) {
      const note = skipDecode ? '按页面原文发送（未做字体还原）。' : '';
      if (mine()) card.decodeNote = note;
      sendAsk(reqId, t, question, note);
      return;
    }

    // 页面带自定义字体：先在卡片上说明，再本地核对文字
    if (mine()) {
      card.status = '页面带自定义字体，正在核对文字…';
      paintCard();
    }
    decodeText(t).then((r) => {
      if (mine()) {
        card.decodeNote = r.note || '';
        if (r.text) card.text = r.text;
      }
      sendAsk(reqId, r.text, question, r.note);
    });
  }

  function sendAsk(reqId, text, question, note) {
    try {
      chrome.runtime
        .sendMessage({
          type: 'PET_ASK_STREAM',
          reqId: reqId,
          text: text,
          question: question || '',
          note: note || '',
          title: (IS_TOP && document.title) || '',
          url: location.href
        })
        .catch(() => {
          onEnd({ reqId: reqId, ok: false, error: '扩展的后台没响应，刷新一下页面再试。' });
        });
    } catch (e) {
      onEnd({ reqId: reqId, ok: false, error: '扩展的后台没响应，刷新一下页面再试。' });
    }
  }

  function onStart(msg) {
    if (!msg.reqId) return;
    if (card && card.reqId === msg.reqId) {
      if (msg.label) {
        const l = card.root.querySelector('.pet-label');
        if (l) l.textContent = msg.label;
      }
      if (msg.note) card.decodeNote = msg.note;
      if (msg.note && !card.status) {
        card.status = msg.note;
        paintCard();
      }
      return;
    }
    const c = renderCard(msg.reqId, msg.label || '小眼', '');
    if (msg.note) {
      c.status = msg.note;
      paintCard();
    }
  }

  function onDelta(msg) {
    if (!card || card.reqId !== msg.reqId) return;
    card.answer += msg.delta || '';
    card.busy = true;
    card.status = '';
    paintCard();
  }

  async function onEnd(msg) {
    if (!card || card.reqId !== msg.reqId) {
      if (msg.ok && msg.answer) return;
      return;
    }
    card.busy = false;
    const dot = card.root.querySelector('.pet-dot');
    if (msg.ok && msg.answer) {
      card.answer = msg.answer;
      card.status = '';
      if (dot) dot.className = 'pet-dot';
      if (cfg.autoCopyAnswer) {
        const ok = await copyText(card.answer);
        card.status = ok ? '已复制到剪贴板' : '';
      }
    } else {
      card.status = '出错：' + (msg.error || '未知错误');
      card.error = msg.error || '';
      card.detail = msg.detail || '';
      card.answer = '';
      if (dot) dot.className = 'pet-dot bad';
    }
    paintCard();
  }

  /* ---------------- 选中 → 小气泡 ---------------- */
  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.target === host) return; // closed shadow 里的事件会重定向到 host
      setTimeout(() => {
        let text = '';
        let rect = null;
        try {
          const sel = window.getSelection();
          text = sel ? String(sel.toString()) : '';
          if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
        } catch (err) {}
        text = text.replace(/\s+$/g, '');
        if (text.trim().length < 8 || !rect || (!rect.width && !rect.height)) {
          hideBubble();
          return;
        }
        if (cfg.selAutoAsk) {
          hideBubble();
          startAsk(text);
          return;
        }
        showBubble(rect, text);
      }, 10);
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (e) => {
      if (bubble && e.target !== host) hideBubble(); // 点我们自己的浮层时不隐藏
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideBubble();
      closeCard();
    }
  });

  window.addEventListener('scroll', hideBubble, true);

  /* ---------------- 点选模式（Alt+A） ----------------
   * 智慧树这类站点禁止选中、禁止复制，"划选"这条路走不通。
   * 点选模式不依赖选中：鼠标指哪块就高亮哪块，点一下直接把那块文字抓来问。
   * 从点到面自动找边界：沿着父级往上爬，文字量涨到像"一整页"就停。
   * -------------------------------------------------- */
  /* PICK-TEST-BEGIN */
  const PICK_OPTION = /^\s*[（(]?\s*[A-HＡ-Ｈa-h]\s*[、.．)）]\s*\S/;
  const PICK_MAX_CHARS = 1000;

  /** start 出发，getParent/textOf 注入（方便离线测试），返回最像"一道题"的祖先块 */
  function pickContainer(start, getParent, textOf) {
    let node = start;
    let best = null;
    let bestText = 0;
    let opts = 0;
    for (let i = 0; i < 12 && node; i++) {
      const t = String(textOf(node) || '').trim();
      if (t.length >= 15 && t.length > bestText) {
        best = node;
        bestText = t.length;
      }
      let n = 0;
      for (const line of t.split('\n')) {
        if (PICK_OPTION.test(line)) n++;
      }
      if (n > opts) opts = n;

      const parent = getParent(node);
      if (!parent) break;
      const pt = String(textOf(parent) || '').trim();
      // 已经像一道题（有两行选项）：父级是纯套壳（文字一样）就继续爬；
      // 父级只是补了一点零头（题号/得分栏）且总量不大也合并；否则到此为止
      if (opts >= 2 && bestText >= 60) {
        if (pt.length === bestText) {
          node = parent;
          continue;
        }
        if (pt.length - bestText < 120 && pt.length <= 700) {
          node = parent;
          continue;
        }
        break;
      }
      if (pt.length > PICK_MAX_CHARS) break; // 再往外就是整页了
      node = parent;
    }
    return best || start;
  }
  /* PICK-TEST-END */

  let pick = null; // { outline, move, down, click, key }

  function pickVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === host) return false;
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') return false; // 子框架自己会高亮
    try {
      const r = el.getBoundingClientRect();
      if (!r || r.width < 6 || r.height < 6) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    } catch (e) {
      return false;
    }
    return true;
  }

  function setPickMode(on) {
    if (on) {
      if (pick) return;
      ensureHost();
      const outline = document.createElement('div');
      outline.className = 'pet-pick';
      shadow.appendChild(outline);

      const move = (e) => {
        if (e.target === host || !pickVisible(e.target)) {
          outline.style.display = 'none';
          return;
        }
        const r = e.target.getBoundingClientRect();
        outline.style.display = 'block';
        outline.style.left = r.left - 3 + 'px';
        outline.style.top = r.top - 3 + 'px';
        outline.style.width = r.width + 6 + 'px';
        outline.style.height = r.height + 6 + 'px';
      };
      const down = (e) => {
        if (e.target === host) return;
        if (e.button === 2) {
          setPickMode(false); // 右键退出，菜单照常弹出
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      };
      const click = (e) => {
        if (e.target === host) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        setPickMode(false);
        if (!pickVisible(e.target)) {
          toast('这里抓不到内容，往有字的地方点');
          return;
        }
        const el = pickContainer(
          e.target,
          (n) => n.parentElement || null,
          (n) => (n.innerText || '')
        );
        const t = String((el && el.innerText) || '').trim();
        if (t.length < 8) {
          toast('这里没抓到文字，往题干上点');
          return;
        }
        startAsk(t);
      };
      const key = (e) => {
        if (e.key === 'Escape') setPickMode(false);
      };

      document.addEventListener('mousemove', move, true);
      document.addEventListener('mousedown', down, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
      pick = { outline, move, down, click, key };
      toast('点选模式：点一下要问的题目（Esc 或右键退出）');
      return;
    }

    if (!pick) return;
    document.removeEventListener('mousemove', pick.move, true);
    document.removeEventListener('mousedown', pick.down, true);
    document.removeEventListener('click', pick.click, true);
    document.removeEventListener('keydown', pick.key, true);
    pick.outline.remove();
    pick = null;
  }

  /* ---------------- 与后台通信 ---------------- */
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'SET_FOLLOW') {
      follow = !!msg.on;
      if (msg.debounce) debounce = Number(msg.debounce) || debounce;
      if (follow) {
        attach();
        schedule();
      } else {
        detach();
      }
      respond({ ok: true, follow: follow });
      return true;
    }

    if (msg.type === 'PET_STREAM_START') {
      onStart(msg);
      respond({ ok: true });
      return true;
    }
    if (msg.type === 'PET_STREAM_DELTA') {
      onDelta(msg);
      respond({ ok: true });
      return true;
    }
    if (msg.type === 'PET_STREAM_END') {
      onEnd(msg);
      respond({ ok: true });
      return true;
    }
    if (msg.type === 'PET_TOAST') {
      toast(msg.text || '');
      respond({ ok: true });
      return true;
    }
    if (msg.type === 'PET_ASK_HERE') {
      startAsk(msg.text || '', msg.question || '', { skipDecode: !!msg.skipDecode });
      respond({ ok: true });
      return true;
    }
    // 后台抽出整页文字时，让文字所在的框架顺手把字体还原一下
    if (msg.type === 'PET_DECODE_TEXT') {
      decodeText(msg.text || '').then(
        (r) => respond({ ok: true, text: r.text, note: r.note || '' }),
        () => respond({ ok: false })
      );
      return true;
    }
    // Alt+A 点选模式：所有框架一起进入，谁被点到谁处理
    if (msg.type === 'PET_PICK_MODE') {
      setPickMode(!!msg.on);
      respond({ ok: true });
      return true;
    }
    return false;
  });
})();
