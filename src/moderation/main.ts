import './moderation.css';
import QRCode from 'qrcode';
import { FLOWER_LABELS } from '../openWorld/visitor';

/**
 * Moderator page (/moderate.html). Signing in gives a token kept for this browser tab only
 * (sessionStorage), sent as a Bearer token to /api/moderate: the password itself, or, with
 * two-step sign-in, a session issued after the password and an authenticator code.
 */
type View = 'pending' | 'shared' | 'chat';

interface PendingItem { id: string; created_at: string; name: string; message: string; kind: string }
interface ChatItem { id: number; created_at: string; name: string; body: string; hidden: boolean; state?: 'waiting' | 'shown' | 'hidden' }

const TOKEN_KEY = 'birds-in-hk:moderator-token';
const KIND_LABELS = FLOWER_LABELS as Readonly<Record<string, string>>;

const form = document.getElementById('token-form') as HTMLFormElement;
const tokenInput = document.getElementById('token') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const tabs = document.getElementById('tabs') as HTMLElement;
const items = document.getElementById('items') as HTMLOListElement;
const quietPanel = document.getElementById('quiet-panel') as HTMLElement;
const quietState = document.getElementById('quiet-state') as HTMLElement;
const quietToggle = document.getElementById('quiet-toggle') as HTMLButtonElement;
let quiet = false;

function showQuiet(value: boolean): void {
  quiet = value;
  quietPanel.hidden = false;
  quietPanel.classList.toggle('on', value);
  quietState.textContent = value
    ? '已開啟：所有留言暫不公開，鳥頭上不能說話。花朵照常顯示。'
    : '已關閉：分享了的留言和預設句子照常顯示。有需要時，一按就可以全部收起。';
  quietToggle.textContent = value ? '關閉安靜模式' : '開啟安靜模式';
}

quietToggle.addEventListener('click', async () => {
  quietToggle.disabled = true;
  try {
    const data = await call('POST', '', { action: 'quiet', on: !quiet });
    showQuiet(data.quiet === true);
    status.textContent = data.quiet === true ? '已開啟安靜模式（約 15 秒內生效）。' : '已關閉安靜模式（約 15 秒內生效）。';
  } catch (error) {
    status.textContent = `未能切換：${(error as Error).message}`;
  } finally {
    quietToggle.disabled = false;
  }
});
const speechPanel = document.getElementById('speech-panel') as HTMLElement;
const speechState = document.getElementById('speech-state') as HTMLElement;
const speechToggle = document.getElementById('speech-toggle') as HTMLButtonElement;
let speechLive = false;

function showSpeech(live: boolean): void {
  speechLive = live;
  speechPanel.hidden = false;
  speechState.textContent = live
    ? '即時顯示中：訪客打的字會立刻出現在小鳥頭上，其他人馬上看到。你只能事後隱藏。'
    : '先看過才公開：訪客打的字只有自己看到，在「最近對話」按「分享」後，才會飄過其他人的畫面。';
  speechToggle.textContent = live ? '改為先看過才公開' : '改為即時顯示';
}

speechToggle.addEventListener('click', async () => {
  speechToggle.disabled = true;
  try {
    const data = await call('POST', '', { action: 'speech', live: !speechLive });
    showSpeech(data.speechLive === true);
    status.textContent = '已更新（約 15 秒內生效）。';
  } catch (error) {
    status.textContent = `未能更新：${(error as Error).message}`;
  } finally {
    speechToggle.disabled = false;
  }
});

const gatherPanel = document.getElementById('gather-panel') as HTMLElement;
const gatherState = document.getElementById('gather-state') as HTMLElement;
const gatherMove = document.getElementById('gather-move') as HTMLButtonElement;
let gatherChecked = false;

/** Flowers still lying where the square used to be: offered once, after signing in. */
async function checkGather(): Promise<void> {
  if (gatherChecked) return;
  gatherChecked = true;
  try {
    const data = await call('POST', '', { action: 'gather-flowers', move: false });
    const count = Number(data.count) || 0;
    gatherPanel.hidden = count === 0;
    gatherState.textContent = `有 ${count} 朵花留在廣場以前的位置。可以把它們搬到現在的廣場；留言和其他地方的花不變。`;
  } catch {
    gatherChecked = false;
  }
}

gatherMove.addEventListener('click', async () => {
  gatherMove.disabled = true;
  try {
    const data = await call('POST', '', { action: 'gather-flowers', move: true });
    gatherState.textContent = `已把 ${Number(data.count) || 0} 朵花搬到現在的廣場。`;
    gatherMove.hidden = true;
  } catch (error) {
    status.textContent = `未能搬花：${(error as Error).message}`;
    gatherMove.disabled = false;
  }
});
let view: View = 'pending';

function token(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

const codeRow = document.getElementById('code-row') as HTMLElement;
const codeInput = document.getElementById('code') as HTMLInputElement;

function keep(value: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, value); } catch { /* storage blocked */ }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = tokenInput.value.trim();
  const code = codeInput.value.replace(/\s/g, '');
  status.textContent = '登入中…';
  try {
    const response = await fetch('/api/moderate?login=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(code ? { code } : {}),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    if (data.needCode) {
      codeRow.hidden = false;
      codeInput.required = true;
      codeInput.focus();
      status.textContent = '請輸入驗證程式顯示的 6 位數字。';
      return;
    }
    keep(typeof data.session === 'string' ? data.session : password);
    tokenInput.value = '';
    codeInput.value = '';
    codeRow.hidden = true;
    (document.getElementById('two-step-setup') as HTMLElement).hidden = true;
    void load();
  } catch (error) {
    status.textContent = `未能登入：${(error as Error).message}`;
  }
});

// Setting up two-step sign-in: the secret is made here, in this browser, and only shown.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let setupSecret: Uint8Array | null = null;

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

async function codeAt(secret: Uint8Array, unixSeconds: number): Promise<string> {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(Math.floor(unixSeconds / 30)));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter.buffer));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const number = (new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

document.getElementById('two-step-make')?.addEventListener('click', async () => {
  setupSecret = crypto.getRandomValues(new Uint8Array(20));
  const key = toBase32(setupSecret);
  const label = encodeURIComponent('Birds in HK:管理');
  await QRCode.toCanvas(document.getElementById('two-step-qr') as HTMLCanvasElement,
    `otpauth://totp/${label}?secret=${key}&issuer=${encodeURIComponent('Birds in HK')}&digits=6&period=30`, { width: 220, margin: 1 });
  (document.getElementById('two-step-key') as HTMLElement).textContent = key.replace(/(.{4})/g, '$1 ').trim();
  (document.getElementById('two-step-result') as HTMLElement).textContent = '';
  (document.getElementById('two-step-out') as HTMLElement).hidden = false;
});

document.getElementById('two-step-check')?.addEventListener('input', async event => {
  const input = event.target as HTMLInputElement;
  const code = input.value.replace(/\s/g, '');
  const result = document.getElementById('two-step-result') as HTMLElement;
  if (!setupSecret || code.length !== 6) { result.textContent = ''; return; }
  const now = Date.now() / 1_000;
  const codes = await Promise.all([-1, 0, 1].map(step => codeAt(setupSecret!, now + step * 30)));
  const key = toBase32(setupSecret);
  result.textContent = codes.includes(code)
    ? `正確。把這串密鑰（不含空格）加到 Vercel 的 MODERATOR_TOTP_SECRET，重新部署後生效：${key}`
    : '不正確，請再看一次程式顯示的數字（每 30 秒會換一次）。';
});

tabs.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (!button?.dataset.view) return;
  view = button.dataset.view as View;
  for (const tab of tabs.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
  void load();
});

async function call(method: 'GET' | 'POST', query: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/moderate${query}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  return data;
}

async function load(): Promise<void> {
  if (!token()) return;
  status.textContent = '載入中…';
  try {
    const data = await call('GET', `?view=${view}`);
    form.hidden = true;
    tabs.hidden = false;
    if (typeof data.quiet === 'boolean') showQuiet(data.quiet);
    if (typeof data.speechLive === 'boolean') showSpeech(data.speechLive);
    void checkGather();
    items.replaceChildren();
    if (view === 'pending') renderPending((data.pending as PendingItem[]) ?? []);
    else if (view === 'shared') renderShared((data.shared as PendingItem[]) ?? []);
    else renderChat((data.chat as ChatItem[]) ?? []);
  } catch (error) {
    const message = (error as Error).message;
    // A wrong password or an expired two-step session: sign in again.
    if (/重新登入|密碼不正確|Not authorised/.test(message)) {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
      status.textContent = message.includes('重新登入') ? '登入已過期，請重新登入。' : '密碼不正確。';
    } else {
      status.textContent = `未能載入：${message}`;
    }
    form.hidden = false;
    tabs.hidden = true;
  }
}

function renderPending(list: PendingItem[]): void {
  status.textContent = list.length ? `有 ${list.length} 則留言等待分享。` : '目前沒有等待分享的留言。';
  for (const item of list) {
    const row = document.createElement('li');
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${item.name || '（沒有名字）'} · ${KIND_LABELS[item.kind] ?? item.kind} · ${new Date(item.created_at).toLocaleString('zh-HK')}`;
    const text = document.createElement('p');
    text.className = 'message';
    text.textContent = item.message;
    const actions = document.createElement('div');
    actions.append(
      actionButton('分享', 'approve', item.id, row),
      actionButton('不分享', 'reject', item.id, row),
      actionButton('隱藏整朵花', 'hide-flower', item.id, row),
    );
    row.append(meta, text, actions);
    items.append(row);
  }
}

function renderShared(list: PendingItem[]): void {
  status.textContent = list.length ? `已分享 ${list.length} 則留言（最近的在先）。` : '還沒有已分享的留言。';
  for (const item of list) {
    const row = document.createElement('li');
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${item.name || '（沒有名字）'} · ${KIND_LABELS[item.kind] ?? item.kind} · ${new Date(item.created_at).toLocaleString('zh-HK')}`;
    const text = document.createElement('p');
    text.className = 'message';
    text.textContent = item.message;
    const actions = document.createElement('div');
    actions.append(actionButton('收回', 'reject', item.id, row), actionButton('隱藏整朵花', 'hide-flower', item.id, row));
    row.append(meta, text, actions);
    items.append(row);
  }
}

function renderChat(list: ChatItem[]): void {
  const waiting = list.filter(item => item.state === 'waiting').length;
  status.textContent = !list.length ? '最近一天沒有對話。'
    : waiting ? `最近一天有 ${list.length} 句對話，其中 ${waiting} 句等待分享。` : `最近一天有 ${list.length} 句對話。`;
  // Lines waiting to be read come first.
  const ordered = [...list].sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting'));
  for (const item of ordered) {
    const state = item.state ?? (item.hidden ? 'hidden' : 'shown');
    const row = document.createElement('li');
    if (state === 'hidden') row.classList.add('hidden-item');
    const meta = document.createElement('p');
    meta.className = 'meta';
    const label = state === 'waiting' ? ' · 等待分享' : state === 'hidden' ? ' · 不分享' : ' · 已公開';
    meta.textContent = `${item.name} · ${new Date(item.created_at).toLocaleString('zh-HK')}${label}`;
    const text = document.createElement('p');
    text.className = 'message';
    text.textContent = item.body;
    row.append(meta, text);
    if (state === 'waiting') {
      const actions = document.createElement('div');
      actions.append(actionButton('分享', 'share-chat', item.id, row), actionButton('不分享', 'hide-chat', item.id, row));
      row.append(actions);
    } else if (state === 'shown') {
      row.append(actionButton('隱藏', 'hide-chat', item.id, row));
    }
    items.append(row);
  }
}

function actionButton(label: string, action: string, id: string | number, row: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await call('POST', '', { action, id });
      row.remove();
      status.textContent = '已更新。';
    } catch (error) {
      button.disabled = false;
      status.textContent = `未能更新：${(error as Error).message}`;
    }
  });
  return button;
}

void load();
