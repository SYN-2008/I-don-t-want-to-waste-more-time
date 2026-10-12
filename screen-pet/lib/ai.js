function trimText(s, n) {
  const t = String(s || '');
  if (t.length <= n) return t;
  return t.slice(0, n) + '\n…（正文过长，已截断）';
}

function buildUserContent({ settings, page, question, text }) {
  const body = text || trimText(page && page.text, settings.maxTextChars);

  const head = [];
  if (page && page.title) head.push('[页面标题] ' + page.title);
  if (page && page.url) head.push('[页面地址] ' + page.url);
  if (question) head.push('[我的问题] ' + question);
  head.push('[任务] 下面是页面里提取出来的题目，回答我。');

  return head.join('\n') + '\n\n' + body;
}

function endpointOf(settings) {
  return String(settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions';
}

function payloadOf({ settings, page, question, text, stream }) {
  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: settings.systemPrompt },
      { role: 'user', content: buildUserContent({ settings, page, question, text }) }
    ],
    temperature: Number(settings.temperature),
    max_tokens: Number(settings.maxTokens),
    stream: !!stream
  };
  // DeepSeek V4.1 默认开启思考模式：思考内容也计入 output，既慢又贵，
  // 还可能在 max_tokens 用尽时把正文挤成空。答题场景默认关掉。
  if (/deepseek\.com/i.test(String(settings.baseUrl || ''))) {
    body.thinking = { type: settings.thinkingEnabled ? 'enabled' : 'disabled' };
  }
  return body;
}

const STATUS_HINT = {
  400: '请求格式有问题，一般是模型名写错了。',
  401: 'API Key 无效或已过期 —— 去设置页重新粘一个。',
  402: '【DeepSeek 账户余额不足】去 platform.deepseek.com 充值，或者先用「复制到 DeepSeek 网页」的免费方式。',
  422: '参数不被接受，检查模型名和设置。',
  429: '请求太频繁或账户欠费被限流，等一会儿再试。',
  500: 'DeepSeek 服务器内部错误，等一会儿再试。',
  503: 'DeepSeek 服务器繁忙或维护中，等一会儿再试。'
};

function errText(status, raw) {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = null;
  }
  const msg =
    (data && data.error && data.error.message) || (data && data.message) || String(raw || '').slice(0, 300) || 'HTTP ' + status;
  const hint = STATUS_HINT[status];
  return hint ? msg + '\n\n→ ' + hint : status + ' · ' + msg;
}

/** 带原始信息的错误：卡片上显示 e.message，诊断里带 e.detail */
function apiError(status, raw) {
  const e = new Error(errText(status, raw));
  e.detail = 'HTTP ' + status + '\n' + String(raw || '').slice(0, 800);
  return e;
}

function emptyError(choice, reasoning, usage) {
  const fr = (choice && choice.finish_reason) || '未知';
  let why = '接口返回了响应，但正文是空的。';
  if (reasoning) why = '模型只输出了思考内容，没输出正文（思考模式吃完了额度）。';
  else if (fr === 'length') why = '回答被 max_tokens 截断了（额度太小）。';
  else if (fr === 'content_filter') why = '内容被接口的安全策略拦下了。';
  const e = new Error(why + '\nfinish_reason=' + fr + ' | usage=' + JSON.stringify(usage || {}));
  e.detail = 'finish_reason=' + fr + '\nreasoning 长度=' + (reasoning ? reasoning.length : 0) + '\nusage=' + JSON.stringify(usage || {});
  return e;
}

export async function askDeepSeek({ settings, page, question, text }) {
  const res = await fetch(endpointOf(settings), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify(payloadOf({ settings, page, question, text, stream: false }))
  });

  const raw = await res.text();
  if (!res.ok) throw apiError(res.status, raw);

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = null;
  }

  const choice = data && data.choices && data.choices[0];
  const msgNode = choice && choice.message;
  const answer = msgNode ? String(msgNode.content || '').trim() : '';
  const reasoning = msgNode ? String(msgNode.reasoning_content || '') : '';
  if (!answer) throw emptyError(choice, reasoning, data && data.usage);

  return { answer, model: settings.model, usage: (data && data.usage) || null };
}

/** 流式回答：每收到一段就回调 onDelta(片段) */
export async function askDeepSeekStream({ settings, page, question, text, onDelta }) {
  const res = await fetch(endpointOf(settings), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify(payloadOf({ settings, page, question, text, stream: true }))
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw apiError(res.status, raw);
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // 浏览器不支持流式读取时退回一次性
    const fallback = await askDeepSeek({ settings, page, question, text });
    if (onDelta) onDelta(fallback.answer);
    return fallback;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  let think = '';
  let usage = null;
  let finish = '';
  let errPayload = null;

  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      const s = line.trim();
      if (!s || s.charAt(0) === ':') continue;
      if (s.indexOf('data:') !== 0) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let j = null;
      try {
        j = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      if (j.error) errPayload = j.error;
      if (j.usage) usage = j.usage;
      const choice = j.choices && j.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const node = choice.delta || choice.message;
      if (!node) continue;
      if (typeof node.reasoning_content === 'string') think += node.reasoning_content;
      const piece = typeof node.content === 'string' ? node.content : '';
      if (piece) {
        full += piece;
        if (onDelta) onDelta(piece);
      }
    }
  }

  if (errPayload) {
    const e = new Error(String(errPayload.message || '接口在流式过程中报错。'));
    e.detail = JSON.stringify(errPayload).slice(0, 800);
    throw e;
  }
  if (!full.trim()) {
    const e = emptyError({ finish_reason: finish }, think, usage);
    throw e;
  }
  return { answer: full.trim(), model: settings.model, usage: usage };
}
