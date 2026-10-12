(() => {
  let lastFilledAt = 0;

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 10) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function findInput() {
    const cands = [];
    for (const sel of ['textarea', 'div[contenteditable="true"]', '[contenteditable="true"]', '[role="textbox"]']) {
      for (const el of document.querySelectorAll(sel)) {
        if (visible(el)) cands.push(el);
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return cands[0];
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fill(text) {
    const el = findInput();
    if (!el) return false;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    try {
      el.scrollTop = el.scrollHeight;
    } catch (e) {}
    return true;
  }

  function tryFill(text, deadline) {
    if (fill(text)) return true;
    if (Date.now() > deadline) return false;
    setTimeout(() => tryFill(text, deadline), 700);
    return true;
  }

  async function consumePending(force) {
    let store;
    try {
      store = await chrome.storage.local.get({ pendingFill: null });
    } catch (e) {
      return;
    }
    const p = store.pendingFill;
    if (!p || !p.text) return;
    if (Date.now() - (p.at || 0) > 10 * 60 * 1000) return;
    if (!force && Date.now() - lastFilledAt < 3000) return;
    lastFilledAt = Date.now();
    tryFill(p.text, Date.now() + 20000);
    try {
      await chrome.storage.local.set({ pendingFill: null });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || msg.type !== 'FILL_DEEPSEEK') return false;
    consumePending(true).then(
      () => respond({ ok: true }),
      () => respond({ ok: false })
    );
    return true;
  });

  consumePending(false);
  setTimeout(() => consumePending(false), 2500);
})();
