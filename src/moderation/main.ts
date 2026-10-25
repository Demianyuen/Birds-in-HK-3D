import './moderation.css';

/**
 * Moderator page (/moderate.html). The token is kept for this browser tab only
 * (sessionStorage) and sent as a Bearer token to /api/moderate.
 */
type View = 'pending' | 'chat';

interface PendingItem { id: string; created_at: string; name: string; message: string; kind: string }
interface ChatItem { id: number; created_at: string; name: string; body: string; hidden: boolean }

const TOKEN_KEY = 'birds-in-hk:moderator-token';
const KIND_LABELS: Record<string, string> = {
  'white-chrysanthemum': '白菊', 'yellow-chrysanthemum': '黃菊', lily: '白百合', lantern: '紙燈',
};

const form = document.getElementById('token-form') as HTMLFormElement;
const tokenInput = document.getElementById('token') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const tabs = document.getElementById('tabs') as HTMLElement;
const items = document.getElementById('items') as HTMLOListElement;
let view: View = 'pending';

function token(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  try { sessionStorage.setItem(TOKEN_KEY, tokenInput.value); } catch { /* storage blocked */ }
  tokenInput.value = '';
  void load();
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
    items.replaceChildren();
    if (view === 'pending') renderPending((data.pending as PendingItem[]) ?? []);
    else renderChat((data.chat as ChatItem[]) ?? []);
  } catch (error) {
    status.textContent = error instanceof Error && error.message === 'Not authorised.' ? '密碼不正確。' : `未能載入：${(error as Error).message}`;
    form.hidden = false;
  }
}

function renderPending(list: PendingItem[]): void {
  status.textContent = list.length ? `有 ${list.length} 則留言等待審核。` : '目前沒有待審核的留言。';
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
      actionButton('批准', 'approve', item.id, row),
      actionButton('拒絕留言', 'reject', item.id, row),
      actionButton('隱藏整朵花', 'hide-flower', item.id, row),
    );
    row.append(meta, text, actions);
    items.append(row);
  }
}

function renderChat(list: ChatItem[]): void {
  status.textContent = list.length ? `最近一天有 ${list.length} 句對話。` : '最近一天沒有對話。';
  for (const item of list) {
    const row = document.createElement('li');
    if (item.hidden) row.classList.add('hidden-item');
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${item.name} · ${new Date(item.created_at).toLocaleString('zh-HK')}${item.hidden ? ' · 已隱藏' : ''}`;
    const text = document.createElement('p');
    text.className = 'message';
    text.textContent = item.body;
    row.append(meta, text);
    if (!item.hidden) row.append(actionButton('隱藏', 'hide-chat', item.id, row));
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
