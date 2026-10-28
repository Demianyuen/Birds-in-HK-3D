/**
 * Words left at the memorial drifting slowly across the view, quietly, one at
 * a time — like danmaku, but soft: small, translucent, never over the centre,
 * never faster than a calm walk. Text is always set as plain text.
 */
export interface DanmakuLine {
  /** Stable id so the same words are not queued twice in a row. */
  id: string;
  name: string;
  body: string;
}

const STORAGE_KEY = 'birds-in-hk:danmaku';
/** Seconds between new lines while anything is waiting. */
const SPAWN_EVERY = 4.2;
/** Seconds a line takes to cross the screen. */
const CROSS_SECONDS = 26;
/** Lines on screen at once. */
const MAX_ON_SCREEN = 4;
/** Recently shown ids are skipped for this many seconds. */
const REPEAT_COOLDOWN = 240;

export class Danmaku {
  public readonly element = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private pool: DanmakuLine[] = [];
  private readonly urgent: DanmakuLine[] = [];
  private readonly shownAt = new Map<string, number>();
  private clock = 0;
  private sinceSpawn = SPAWN_EVERY - 1.2;
  private lane = 0;
  private enabled = readEnabled();
  private visible = false;

  public constructor() {
    this.element.className = 'danmaku';
    this.element.setAttribute('aria-hidden', 'true');
    this.toggle.type = 'button';
    this.toggle.className = 'danmaku-toggle';
    this.toggle.addEventListener('click', () => {
      this.enabled = !this.enabled;
      writeEnabled(this.enabled);
      if (!this.enabled) this.clearScreen();
      this.syncToggle();
    });
    this.syncToggle();
  }

  public get toggleButton(): HTMLButtonElement {
    return this.toggle;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    this.toggle.hidden = !visible;
    if (!visible) this.clearScreen();
  }

  /** Replace the rotation pool (flower words, recent chat). */
  public setPool(lines: readonly DanmakuLine[]): void {
    this.pool = lines.filter(line => line.body.trim().length > 0);
  }

  /** A line that just arrived goes out next, ahead of the rotation. */
  public push(line: DanmakuLine): void {
    if (!line.body.trim() || this.urgent.some(item => item.id === line.id)) return;
    this.urgent.push(line);
    if (this.urgent.length > 6) this.urgent.shift();
  }

  public update(deltaSeconds: number): void {
    this.clock += deltaSeconds;
    if (!this.visible || !this.enabled) return;
    this.sinceSpawn += deltaSeconds;
    if (this.sinceSpawn < SPAWN_EVERY || this.element.childElementCount >= MAX_ON_SCREEN) return;
    const line = this.urgent.shift() ?? this.pick();
    if (!line) return;
    this.sinceSpawn = 0;
    this.spawn(line);
  }

  private pick(): DanmakuLine | null {
    const fresh = this.pool.filter(line => this.clock - (this.shownAt.get(line.id) ?? -Infinity) > REPEAT_COOLDOWN);
    if (fresh.length === 0) return null;
    return fresh[Math.floor(Math.random() * fresh.length)];
  }

  private spawn(line: DanmakuLine): void {
    this.shownAt.set(line.id, this.clock);
    const node = document.createElement('div');
    node.className = 'danmaku-line';
    const body = document.createElement('span');
    body.textContent = line.body;
    node.append(body);
    if (line.name) {
      const name = document.createElement('small');
      name.textContent = `— ${line.name}`;
      node.append(name);
    }
    // Upper band only (8%–38%), cycling lanes so lines do not stack.
    this.lane = (this.lane + 1) % 4;
    node.style.top = `${8 + this.lane * 7.5}%`;
    node.style.animationDuration = `${CROSS_SECONDS + Math.min(10, line.body.length * 0.12)}s`;
    node.addEventListener('animationend', () => node.remove());
    this.element.append(node);
  }

  private clearScreen(): void {
    this.element.replaceChildren();
  }

  private syncToggle(): void {
    this.toggle.textContent = this.enabled ? '留言飄過：開' : '留言飄過：關';
    this.toggle.setAttribute('aria-pressed', String(this.enabled));
  }
}

function readEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

function writeEnabled(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* per-viewer convenience */ }
}
