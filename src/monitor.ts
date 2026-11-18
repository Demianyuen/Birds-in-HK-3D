/**
 * What the moderator sees in 運作狀況 and 意見: problems visitors' browsers run into, and words
 * visitors choose to send. A report carries the kind of device and browser only, never a name,
 * a position or anything typed; each kind is sent at most once a visit.
 */
export type ProblemKind = 'webgl-missing' | 'graphics-lost' | 'map-failed' | 'script-error' | 'slow';

const sent = new Set<ProblemKind>();

/** "手機 · iPhone · Safari": enough to tell where a problem happens, nothing more. Exported for tests. */
export function describeDevice(userAgent: string, touchFirst: boolean): string {
  const ua = userAgent;
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '其他';
  const browser = /FBAN|FBAV/.test(ua) ? 'Facebook 內置' : /Instagram/.test(ua) ? 'Instagram 內置' : /Line\//.test(ua) ? 'LINE 內置'
    : /WhatsApp/.test(ua) ? 'WhatsApp 內置' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '其他';
  return `${touchFirst ? '手機/平板' : '電腦'} · ${system} · ${browser}`;
}

export function reportProblem(kind: ProblemKind): void {
  if (sent.has(kind) || typeof window === 'undefined' || /localhost|127\.0\.0\.1/.test(location.hostname)) return;
  sent.add(kind);
  const touchFirst = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
  const body = JSON.stringify({ kind, detail: describeDevice(navigator.userAgent, touchFirst) });
  try {
    if (navigator.sendBeacon?.('/api/report', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through
  }
  void fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

/** Errors from this site's own code (not from browser add-ons or other sites). */
export function watchScriptErrors(): void {
  window.addEventListener('error', event => {
    const file = event.filename ?? '';
    if (file && !file.startsWith(location.origin)) return;
    reportProblem('script-error');
  });
}

export async function sendFeedback(name: string, body: string): Promise<void> {
  const response = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'feedback', name, body }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof data.error === 'string' ? data.error : '暫時未能送出，請稍後再試。');
  }
}

/** The 意見 box: a small dialog anyone can open from the landing page or while flying. */
export function setUpFeedback(currentName: () => string): void {
  const dialog = document.getElementById('feedback-dialog') as HTMLDialogElement | null;
  const form = document.getElementById('feedback-form') as HTMLFormElement | null;
  const text = document.getElementById('feedback-text') as HTMLTextAreaElement | null;
  const status = document.getElementById('feedback-status') as HTMLElement | null;
  if (!dialog || !form || !text || !status) return;
  for (const opener of document.querySelectorAll<HTMLElement>('[data-open-feedback]')) {
    opener.addEventListener('click', event => {
      event.preventDefault();
      status.textContent = '';
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      text.focus();
    });
  }
  dialog.querySelector('[data-close-feedback]')?.addEventListener('click', () => dialog.close());
  // Typing in the box must not fly the bird.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    if (!text.value.trim()) { status.textContent = '請先寫下你的意見。'; return; }
    submit.disabled = true;
    status.textContent = '送出中…';
    try {
      await sendFeedback(currentName(), text.value);
      text.value = '';
      status.textContent = '謝謝你，已經收到。';
      window.setTimeout(() => dialog.close(), 1_600);
    } catch (error) {
      status.textContent = (error as Error).message;
      submit.disabled = false;
    }
  });
}
