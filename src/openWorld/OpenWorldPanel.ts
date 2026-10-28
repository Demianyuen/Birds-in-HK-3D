import { Vector3 } from 'three';
import type { BirdsInHkGame } from '../game/BirdsInHkGame';
import type { WorldPlayer } from '../multiplayer/protocol';
import { WORLD_PLAYER_LIMIT } from '../multiplayer/protocol';
import { openWorldConfig } from './config';
import { playLayingChime } from './chime';
import { Danmaku } from './Danmaku';
import { checkChat, checkMessage, CHAT_MAX, insideMemorialGround, MEMORIAL_CENTRE, MESSAGE_MAX, rejectReasonText } from './contentRules';
import { fetchFlowers, placeFlower, sendChat, type MemorialFlower } from './flowerApi';
import type { ChatLine, LiveStatus, LiveWorld } from './LiveWorld';
import { FLOWER_LABELS, type Visitor } from './visitor';
import { WorldLabels, type WorldLabel } from './WorldLabels';

const FLOWER_REFRESH_MS = 30_000;
/** Flowers laid in this browser while the shared service is not available yet. */
const LOCAL_FLOWERS_KEY = 'birds-in-hk:my-flowers';
const LOCAL_FLOWER_CAP = 300;
/** Last flower total seen, so the count is there at once on the next visit. */
const FLOWER_TOTAL_KEY = 'birds-in-hk:flower-total';
/** Words left with flowers show when the walking bird is this close (m). */
const FLOWER_LABEL_RADIUS = 6;
/** Names over other birds show within this distance (m). */
const NAME_LABEL_RADIUS = 160;

/**
 * The open-world memorial layer in the game: the visitor's flower, everyone's
 * flowers, other birds with their names, and the shared chat.
 */
export class OpenWorldPanel {
  public readonly element = document.createElement('section');
  public readonly labels = new WorldLabels();
  /** Words left at the memorial, drifting across the view. */
  public readonly danmaku = new Danmaku();
  private danmakuTimer = 0;
  private readonly prompt = document.createElement('div');
  private readonly placeButton = document.createElement('button');
  /** Card to write (or edit) the words left with the flower before laying it. */
  private readonly card = document.createElement('form');
  private readonly cardMessage = document.createElement('textarea');
  private readonly cardError = document.createElement('p');
  private readonly cardTitle = document.createElement('h2');
  private readonly cardNote = document.createElement('p');
  private readonly status = document.createElement('p');
  private readonly log = document.createElement('ol');
  private readonly chatForm = document.createElement('form');
  private readonly chatInput = document.createElement('input');
  private readonly chatNote = document.createElement('p');
  private visitor: Visitor | null = null;
  private placing = false;
  private flowerTimer = 0;
  private notice = '';
  private noticeUntil = 0;
  private active = false;

  public constructor(private readonly game: BirdsInHkGame) {
    this.element.className = 'open-world-panel';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '一起在大埔上空');

    this.prompt.className = 'flower-prompt';
    this.prompt.setAttribute('role', 'status');
    this.prompt.hidden = true;
    this.placeButton.type = 'button';
    this.placeButton.className = 'primary-button flower-place-button';
    this.placeButton.hidden = true;
    this.placeButton.addEventListener('click', () => this.openCard());
    this.buildCard();

    const details = document.createElement('details');
    details.open = false; // words drift across the view as danmaku; the chat box stays tucked away until wanted
    const summary = document.createElement('summary');
    summary.textContent = '同在 · 對話';
    this.status.className = 'open-world-status';
    this.log.className = 'open-world-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-label', '對話');
    this.chatInput.maxLength = CHAT_MAX;
    this.chatInput.placeholder = '說一句話…';
    this.chatInput.setAttribute('aria-label', '對話內容');
    this.chatInput.autocomplete = 'off';
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = '傳送';
    this.chatForm.append(this.chatInput, send);
    this.chatNote.className = 'open-world-note';
    this.chatNote.textContent = '對話會自動過濾並保留一天以供管理。請保持尊重。';
    details.append(summary, this.status, this.log, this.chatForm, this.chatNote);
    this.element.append(details);
    this.chatForm.addEventListener('submit', event => {
      event.preventDefault();
      void this.sendChatLine();
    });
    // Typing must not steer the bird.
    this.element.addEventListener('focusin', () => {
      game.clearControls();
      if (document.pointerLockElement) document.exitPointerLock();
    });

    if (!openWorldConfig()) {
      this.status.textContent = '單人模式：尚未設定共享服務。';
      this.chatForm.hidden = true;
      this.chatNote.hidden = true;
    }
  }

  /** Called once when the visitor starts flying. */
  public begin(visitor: Visitor): void {
    this.visitor = visitor;
    this.active = true;
    // Without the shared service the flower is kept in this browser only.
    for (const flower of readLocalFlowers()) this.game.flowers.add(flower);
    this.game.holdFlower(visitor.placed ? null : visitor.kind);
    void this.refreshFlowers();
    void this.joinLiveWorld(visitor);
  }

  /** The realtime client is loaded only when someone actually joins the shared world. */
  private async joinLiveWorld(visitor: Visitor): Promise<void> {
    const config = openWorldConfig();
    if (!config || this.liveWorld) return;
    this.status.textContent = '正在連線…';
    try {
      const { LiveWorld: Live } = await import('./LiveWorld');
      if (this.liveWorld) return;
      const live = new Live(config, { id: visitor.id, name: visitor.name }, {
        onStatus: status => this.showStatus(status),
        onPeers: peers => this.showPeers(peers),
        onChat: line => this.appendChat(line),
      });
      this.liveWorld = live;
      live.connect();
      const lines = await live.recentChat();
      lines.forEach(line => this.appendChat(line));
    } catch {
      this.status.textContent = '暫時未能連上共享天空，你仍然可以飛行和放花。';
    }
  }

  private liveWorld: LiveWorld | null = null;

  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    this.labels.element.hidden = !visible;
    this.danmaku.setVisible(visible);
    if (!visible) {
      this.prompt.hidden = true;
      this.placeButton.hidden = true;
      this.card.hidden = true;
    }
  }

  /** Per-frame: prompts, network pose, labels. */
  public frame(deltaSeconds: number, width: number, height: number): void {
    if (!this.active) return;
    this.flowerTimer += deltaSeconds * 1_000;
    if (this.flowerTimer > FLOWER_REFRESH_MS) {
      this.flowerTimer = 0;
      void this.refreshFlowers();
    }
    const pose = this.game.getNetworkPose();
    this.liveWorld?.sendPose(pose.position, pose.quaternion, pose.perched);
    this.liveWorld?.prune();
    this.danmakuTimer += deltaSeconds;
    if (this.danmakuTimer > 5) {
      this.danmakuTimer = 0;
      this.danmaku.setPool(this.game.flowers.words.map(flower => ({ id: flower.id, name: flower.name, body: flower.message })));
    }
    this.danmaku.update(deltaSeconds);
    this.game.flowers.showGuide(Boolean(this.visitor && !this.visitor.placed));
    this.updatePrompt();
    this.labels.render(this.collectLabels(), this.game.viewCamera, width, height);
  }

  /** Flowers at the memorial: what is loaded now, or the last total seen while loading. */
  public get flowerTotal(): number {
    return Math.max(this.game.flowers.count, readFlowerTotal());
  }

  /** F key. */
  public tryLayFlower(): void {
    this.openCard();
  }

  public dispose(): void {
    this.liveWorld?.dispose();
    this.labels.clear();
    this.danmaku.element.remove();
    this.danmaku.toggleButton.remove();
    this.element.remove();
    this.prompt.remove();
    this.placeButton.remove();
  }

  /** Attach the floating prompt and button to the game container. */
  public mount(container: HTMLElement): void {
    container.append(this.labels.element, this.danmaku.element, this.danmaku.toggleButton, this.prompt, this.placeButton, this.card, this.element);
  }

  private buildCard(): void {
    this.card.className = 'flower-card';
    this.card.hidden = true;
    this.card.setAttribute('aria-labelledby', 'flower-card-title');
    this.cardTitle.id = 'flower-card-title';
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = '想留下的話（可以留空）';
    this.cardMessage.maxLength = MESSAGE_MAX;
    this.cardMessage.rows = 4;
    this.cardMessage.placeholder = '寫給宏福苑的一句話';
    label.append(caption, this.cardMessage);
    const note = this.cardNote;
    note.className = 'flower-card-note';
    this.cardError.className = 'flower-card-error';
    this.cardError.setAttribute('role', 'alert');
    this.cardError.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'flower-card-actions';
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.className = 'primary-button';
    confirm.textContent = '放下';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary-button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this.closeCard());
    actions.append(confirm, cancel);
    this.card.append(this.cardTitle, label, note, this.cardError, actions);
    this.card.addEventListener('submit', event => {
      event.preventDefault();
      const checked = checkMessage(this.cardMessage.value);
      if (!checked.ok) {
        this.cardError.textContent = rejectReasonText(checked.reason);
        this.cardError.hidden = false;
        return;
      }
      if (this.visitor) this.visitor.message = checked.text;
      this.closeCard();
      void this.layFlower();
    });
    this.card.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.closeCard();
    });
    this.card.addEventListener('focusin', () => {
      this.game.clearControls();
      if (document.pointerLockElement) document.exitPointerLock();
    });
  }

  /** Opens the flower card when the bird stands on the memorial ground. */
  private openCard(): void {
    const visitor = this.visitor;
    const ground = this.game.birdGroundPoint;
    if (!visitor || visitor.placed || this.placing || !ground || !insideMemorialGround(ground.x, ground.z)) return;
    this.cardTitle.textContent = `在這裡放下${FLOWER_LABELS[visitor.kind]}`;
    this.cardMessage.value = visitor.message;
    this.cardNote.textContent = openWorldConfig()
      ? '花和名字會即時讓所有人看到。留言經審核後，會顯示在花旁邊，所有人走近都能讀到。'
      : '共享服務尚未開放：這朵花和留言暫時只保留在你的畫面上。';
    this.cardError.hidden = true;
    this.card.hidden = false;
    this.game.clearControls();
    if (document.pointerLockElement) document.exitPointerLock();
    this.cardMessage.focus();
  }

  private closeCard(): void {
    this.card.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private async refreshFlowers(): Promise<void> {
    if (!openWorldConfig()) return;
    try {
      this.game.flowers.setFlowers(await fetchFlowers());
      rememberFlowerTotal(this.game.flowers.count);
    } catch {
      // Flowers are shown again on the next refresh; flying is never blocked.
    }
  }

  private updatePrompt(): void {
    const now = performance.now();
    let text = '';
    let canPlace = false;
    if (now < this.noticeUntil) {
      text = this.notice;
    } else if (this.visitor && !this.visitor.placed) {
      const flower = FLOWER_LABELS[this.visitor.kind];
      const ground = this.game.birdGroundPoint;
      const bird = this.game.birdPosition;
      const away = Math.round(Math.hypot(bird.x - MEMORIAL_CENTRE.x, bird.z - MEMORIAL_CENTRE.z));
      if (this.placing) text = `正在放下${flower}…`;
      else if (!ground && insideMemorialGround(bird.x, bird.z)) text = `已到宏福苑。降落在屋苑地面，就可以放下${flower}。`;
      else if (!ground) text = `帶著${flower}飛向遠處那道光柱——宏福苑在約 ${away} 米外。`;
      else if (insideMemorialGround(ground.x, ground.z)) {
        text = '';
        canPlace = true;
      } else {
        text = `宏福苑在約 ${away} 米外。飛過去，降落在屋苑地面就可以放下${flower}。`;
      }
      this.placeButton.textContent = `放下${flower}（F）`;
    }
    if (!this.card.hidden && !canPlace) this.card.hidden = true;
    this.prompt.textContent = text;
    this.prompt.hidden = !text || !this.card.hidden;
    this.placeButton.hidden = !canPlace || !this.card.hidden;
  }

  private async layFlower(): Promise<void> {
    const visitor = this.visitor;
    const ground = this.game.birdGroundPoint;
    if (!visitor || visitor.placed || this.placing || !ground || !insideMemorialGround(ground.x, ground.z)) return;
    this.placing = true;
    const localId = `local-${Date.now()}`;
    const flower = { id: localId, createdAt: new Date().toISOString(), name: visitor.name, message: '', kind: visitor.kind, x: ground.x, y: ground.y, z: ground.z };
    // Lay it at once with its small ceremony; the server confirms (or refuses) in the background.
    this.game.flowers.ceremony(flower);
    this.game.holdFlower(null);
    playLayingChime();
    const label = FLOWER_LABELS[visitor.kind];
    if (!openWorldConfig()) {
      saveLocalFlower({ ...flower, message: visitor.message });
      rememberFlowerTotal(this.game.flowers.count);
      visitor.placed = true;
      this.placing = false;
      this.showNotice(`你在宏福苑放下了${label}。共享服務開放後，其他人才會看到；現在只保留在你的畫面。`, 10_000);
      return;
    }
    try {
      const placed = await placeFlower({ name: visitor.name, message: visitor.message, kind: visitor.kind, x: ground.x, y: ground.y, z: ground.z });
      this.game.flowers.replace(localId, { ...placed.flower, y: ground.y });
      visitor.placed = true;
      this.showNotice(placed.messageStatus === 'pending'
        ? `你在宏福苑放下了${label}，所有人都看得到。留言會在審核後顯示在花旁。`
        : `你在宏福苑放下了${label}，所有人都看得到。`, 10_000);
    } catch (error) {
      this.game.flowers.remove(localId);
      this.game.holdFlower(visitor.kind);
      this.showNotice(error instanceof Error ? error.message : '未能放下花，請稍後再試。', 6_000);
    } finally {
      this.placing = false;
    }
  }

  private showNotice(text: string, milliseconds: number): void {
    this.notice = text;
    this.noticeUntil = performance.now() + milliseconds;
  }

  private collectLabels(): WorldLabel[] {
    const labels: WorldLabel[] = [];
    const ground = this.game.birdGroundPoint;
    if (ground) {
      for (const { flower } of this.game.flowers.nearest(ground, FLOWER_LABEL_RADIUS, 3)) {
        const title = flower.name ? `${flower.name} · ${FLOWER_LABELS[flower.kind]}` : `一朵${FLOWER_LABELS[flower.kind]}`;
        labels.push({
          id: `flower-${flower.id}`,
          title,
          body: flower.message || undefined,
          position: new Vector3(flower.x, flower.y + 0.45, flower.z),
          tone: 'flower',
        });
      }
    }
    const bird = this.game.birdPosition;
    for (const remote of this.game.remoteBirdLabels) {
      if (remote.position.distanceTo(bird) > NAME_LABEL_RADIUS) continue;
      const lift = remote.size * 2.2;
      labels.push({
        id: `player-${remote.id}`,
        title: remote.name || '訪客',
        position: remote.position.clone().setY(remote.position.y + lift),
        tone: 'player',
      });
    }
    return labels;
  }

  private showStatus(status: LiveStatus): void {
    this.status.textContent = status === 'online'
      ? `此刻有 ${this.liveWorld?.onlineCount ?? 1} 位在大埔上空。`
      : status === 'connecting' ? '正在連線…' : '連線中斷，正在重試。';
  }

  private showPeers(peers: readonly WorldPlayer[]): void {
    const bird = this.game.birdPosition;
    // Draw the nearest birds when more are online than the renderer holds.
    const nearest = [...peers]
      .sort((a, b) => distance(a.position, bird) - distance(b.position, bird))
      .slice(0, WORLD_PLAYER_LIMIT);
    this.game.syncPlayers(nearest);
    if (this.liveWorld) this.status.textContent = `此刻有 ${this.liveWorld.onlineCount} 位在大埔上空。`;
  }

  private appendChat(line: ChatLine): void {
    if (line.id && this.log.querySelector(`[data-id="${line.id}"]`)) return;
    this.danmaku.push({ id: `chat-${line.id}`, name: line.name, body: line.body });
    const item = document.createElement('li');
    item.dataset.id = String(line.id);
    const name = document.createElement('strong');
    name.textContent = line.name;
    const body = document.createElement('span');
    body.textContent = line.body;
    item.append(name, body);
    this.log.append(item);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async sendChatLine(): Promise<void> {
    const checked = checkChat(this.chatInput.value);
    if (!checked.ok) {
      this.chatNote.textContent = rejectReasonText(checked.reason);
      return;
    }
    const bird = this.game.birdPosition;
    try {
      await sendChat({ name: this.visitor?.name ?? '', body: checked.text, x: bird.x, z: bird.z });
      this.chatInput.value = '';
      this.chatNote.textContent = '對話會自動過濾並保留一天以供管理。請保持尊重。';
    } catch (error) {
      this.chatNote.textContent = error instanceof Error ? error.message : '訊息未能送出。';
    }
  }
}

function readLocalFlowers(): MemorialFlower[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(LOCAL_FLOWERS_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is MemorialFlower => typeof item === 'object' && item !== null
      && typeof (item as MemorialFlower).id === 'string' && (item as MemorialFlower).id.startsWith('local-')
      && [item.x, item.y, item.z].every(value => typeof value === 'number' && Number.isFinite(value))).slice(-LOCAL_FLOWER_CAP);
  } catch {
    return [];
  }
}

function readFlowerTotal(): number {
  try {
    const value = Number(localStorage.getItem(FLOWER_TOTAL_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function rememberFlowerTotal(total: number): void {
  try { localStorage.setItem(FLOWER_TOTAL_KEY, String(total)); } catch { /* per-browser convenience */ }
}

function saveLocalFlower(flower: MemorialFlower): void {
  try {
    localStorage.setItem(LOCAL_FLOWERS_KEY, JSON.stringify([...readLocalFlowers(), flower].slice(-LOCAL_FLOWER_CAP)));
  } catch {
    // private window: the flower stays for this visit only
  }
}

function distance(position: readonly number[], point: { x: number; y: number; z: number }): number {
  return Math.hypot(position[0] - point.x, position[1] - point.y, position[2] - point.z);
}
