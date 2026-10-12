/** 已下线/改名的模型 → 当前可用名。旧配置自动迁移，避免用户充值后仍报「模型不存在」。 */
export const MODEL_ALIASES = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-chat-v3': 'deepseek-flash',
  'deepseek-chat-v3.1': 'deepseek-flash',
  'deepseek-chat-v3.2': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
  'deepseek-v3': 'deepseek-flash',
  'deepseek-v3.1': 'deepseek-flash',
  'deepseek-v3.2': 'deepseek-flash',
  'deepseek-coder': 'deepseek-flash',
  'deepseek-coder-v2': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-v4': 'deepseek-v4-pro'
};

export function normalizeModel(name) {
  const m = String(name || '').trim();
  if (!m) return DEFAULTS.model;
  return MODEL_ALIASES[m.toLowerCase()] || m;
}

/** 旧版本的默认提示词：只有还是这几句原话时才升级，用户自己改过的一律不动 */
export const LEGACY_PROMPTS = [
  '你是「小眼」，一个常驻在浏览器边上帮我看清当前网页的助手。' +
    '用最直接的话先给结论，再补一到两句理由。不要复述题目，不要说客套话。' +
    '如果内容不足以判断，就直接说不确定，并说明还缺什么。'
];

export const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  thinkingEnabled: false,
  temperature: 0.3,
  maxTokens: 2048,
  promptV: 2,
  systemPrompt:
    '你是「小眼」，唯一的任务就是直接给答案。不要分析、不要复述题干、不要客套、不要总结。\n' +
    '输出格式（一行一题，只看题号）：\n' +
    '选择题：第1题：B（多选直接连写，例如 ABD）\n' +
    '判断题：第1题：对 / 错\n' +
    '填空题：第1题：要填的内容\n' +
    '简答/论述：第1题：只写核心要点，最多两行\n' +
    '看不清或信息不足：第1题：不确定（说明缺什么）\n' +
    '如果内容只有一道题，就写「答案：B」。\n' +
    '如果选中/提取的内容根本不是题目，就别套题号格式，直接用一两句话把结论说清楚。',

  extractMode: 'smart',
  preferSelection: true,
  maxTextChars: 20000,

  selBubble: true,
  selAutoAsk: false,
  autoCopyAnswer: true,

  docxName: '题目提取',
  docxMode: 'daily',
  autoSaveDocx: true,

  followMode: false,
  followDebounce: 1500,
  followMinGap: 15000,

  historyLimit: 20
};

export async function getSettings() {
  const got = await chrome.storage.local.get(null);
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (got[k] !== undefined && got[k] !== null) out[k] = got[k];
  }
  const fixed = normalizeModel(out.model);
  if (fixed !== out.model) {
    out.model = fixed;
    // 把迁移结果写回去，设置页也会显示新名字
    await chrome.storage.local.set({ model: fixed }).catch(() => {});
  }
  // 提示词升级：只在用户没改过的情况下换成新的（新版是"直接给答案"）
  if (Number(got.promptV || 1) < DEFAULTS.promptV) {
    const cur = String(out.systemPrompt || '').trim();
    const patch = { promptV: DEFAULTS.promptV };
    if (!cur || LEGACY_PROMPTS.indexOf(cur) >= 0) {
      out.systemPrompt = DEFAULTS.systemPrompt;
      patch.systemPrompt = DEFAULTS.systemPrompt;
    }
    await chrome.storage.local.set(patch).catch(() => {});
  }
  return out;
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

const HISTORY_KEY = 'history';

export async function getHistory(limit = 20) {
  const got = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return (got[HISTORY_KEY] || []).slice(0, limit);
}

export async function pushHistory(entry, limit = 20) {
  const got = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const list = got[HISTORY_KEY] || [];
  list.unshift(entry);
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, limit) });
}

export async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

const DOCX_KEY = 'docxEntries';

export async function getDocxEntries() {
  const got = await chrome.storage.local.get({ [DOCX_KEY]: [] });
  return got[DOCX_KEY] || [];
}

export async function addDocxEntry(entry) {
  const list = await getDocxEntries();
  list.unshift(entry);
  await chrome.storage.local.set({ [DOCX_KEY]: list.slice(0, 500) });
}

export async function clearDocxEntries() {
  await chrome.storage.local.set({ [DOCX_KEY]: [] });
}

export function dayKey(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function stampOf(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return dayKey(ts) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
