import { Vector3 } from 'three';
import type { BirdsInHkGame } from '../game/BirdsInHkGame';
import type { WorldPlayer } from '../multiplayer/protocol';
import { WORLD_PLAYER_LIMIT } from '../multiplayer/protocol';
import { openWorldConfig } from './config';
import { playLayingChime } from './chime';
import { Danmaku } from './Danmaku';
import { checkChat, checkMessage, insideMemorialGround, MEMORIAL_CENTRE, MESSAGE_MAX, rejectReasonText } from './contentRules';
import { FlowerRefused, fetchFlowers, placeFlower, sendChat, type MemorialFlower } from './flowerApi';
import type { ChatLine, LiveStatus, LiveWorld } from './LiveWorld';
import { FLOWER_LABELS, type Visitor } from './visitor';
import { WorldLabels, type WorldLabel } from './WorldLabels';
import { findSpeaker, SpeechBubbles, SpeechInput } from './speech';

const FLOWER_REFRESH_MS = 30_000;
/** Flowers waiting to reach the shared service are offered again this often. */
const FLOWER_RETRY_MS = 45_000;
/** Flowers laid in this browser while the shared service is not available yet. */
const LOCAL_FLOWERS_KEY = 'birds-in-hk:my-flowers';
const LOCAL_FLOWER_CAP = 300;
/** Last flower total seen, so the count is there at once on the next visit. */
const FLOWER_TOTAL_KEY = 'birds-in-hk:flower-total';
/** Words left with flowers show when the bird is this close (m, across the ground). */
const FLOWER_LABEL_RADIUS = 12;
/** ...and no more than this far above or below them (m). */
const FLOWER_LABEL_HEIGHT = 10;
/** Words this visitor left with their own flowers, kept so they can read them before approval. */
const OWN_WORDS_KEY = 'birds-in-hk:my-words';
const OWN_WORDS_CAP = 60;
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
  /** Enter opens a line in the middle of the view; what is said shows over the bird. */
  private readonly speech: SpeechInput;
  private readonly speakButton = document.createElement('button');
  private readonly bubbles = new SpeechBubbles();
  private visitor: Visitor | null = null;
  private placing = false;
  private flowerTimer = 0;
  private retryTimer = 0;
  private syncingLocal = false;
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

    this.status.className = 'open-world-status';
    this.status.setAttribute('role', 'status');
    this.element.append(this.status);
    this.speech = new SpeechInput(text => void this.say(text), () => {
      game.clearControls();
      if (document.pointerLockElement) document.exitPointerLock();
    });
    this.speakButton.type = 'button';
    this.speakButton.className = 'speak-button';
    this.speakButton.textContent = '說話（Enter）';
    this.speakButton.addEventListener('click', () => this.openSpeech());

    if (!openWorldConfig()) this.status.textContent = '單人模式：尚未設定共享服務。';
  }

  /** Called once when the visitor starts flying. */
  public begin(visitor: Visitor): void {
    this.visitor = visitor;
    this.active = true;
    // Without the shared service the flower is kept in this browser only.
    for (const flower of readLocalFlowers()) this.game.flowers.add(flower);
    this.game.holdFlower(visitor.placed ? null : visitor.kind);
    void this.refreshFlowers().then(() => this.syncLocalFlowers());
    void this.joinLiveWorld(visitor);
  }

  /**
   * Flowers laid while the shared service was unreachable stay where they were laid
   * (and are kept in this browser). Whenever the service answers, they are sent on.
   */
  private async syncLocalFlowers(): Promise<void> {
    if (!openWorldConfig() || this.syncingLocal || this.placing) return;
    const pending = readLocalFlowers();
    if (pending.length === 0) return;
    this.syncingLocal = true;
    try {
      for (const flower of pending) {
        try {
          const placed = await placeFlower({ name: flower.name, message: flower.message, kind: flower.kind, x: flower.x, y: flower.y, z: flower.z });
          this.game.flowers.replace(flower.id, { ...placed.flower, y: flower.y });
          moveOwnWords(flower.id, placed.flower.id);
          forgetLocalFlower(flower.id);
        } catch (error) {
          if (error instanceof FlowerRefused) forgetLocalFlower(flower.id);
          else return; // still unreachable: try again later
        }
      }
      void this.refreshFlowers();
    } finally {
      this.syncingLocal = false;
    }
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
        onChat: line => this.appendChat(line),
      });
      this.liveWorld = live;
      live.connect();
    } catch {
      this.status.textContent = '暫時未能連上共享天空，你仍然可以飛行和放花。';
    }
  }

  private liveWorld: LiveWorld | null = null;

  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    this.labels.element.hidden = !visible;
    this.danmaku.setVisible(visible);
    this.speakButton.hidden = !visible;
    if (!visible) {
      this.speech.close();
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
    this.retryTimer += deltaSeconds * 1_000;
    if (this.retryTimer > FLOWER_RETRY_MS) {
      this.retryTimer = 0;
      void this.syncLocalFlowers();
    }
    const pose = this.game.getNetworkPose();
    if (this.liveWorld) {
      this.liveWorld.sendPose(pose.position, pose.quaternion, pose.perched);
      this.liveWorld.prune();
      this.showPeers(this.liveWorld.snapshot());
    }
    this.danmakuTimer += deltaSeconds;
    if (this.danmakuTimer > 5) {
      this.danmakuTimer = 0;
      const own = readOwnWords();
      const pool = this.game.flowers.all
        .map(flower => ({ id: flower.id, name: flower.name, body: flower.message || own[flower.id] || '' }))
        .filter(line => line.body);
      this.danmaku.setPool(pool);
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

  /** Enter key (or the 說話 button): open the line to say something. */
  public openSpeech(): void {
    if (!this.active || !this.card.hidden) return;
    this.speech.show();
  }

  public get speaking(): boolean {
    return this.speech.open;
  }

  /** Say a line: it shows over our own bird at once and reaches everyone nearby through the filter. */
  private async say(text: string): Promise<void> {
    const checked = checkChat(text);
    if (!checked.ok) {
      this.showNotice(rejectReasonText(checked.reason), 4_000);
      return;
    }
    this.bubbles.say('self', checked.text, performance.now());
    if (!openWorldConfig()) return;
    const bird = this.game.birdPosition;
    try {
      await sendChat({ name: this.visitor?.name ?? '', body: checked.text, x: bird.x, z: bird.z, speaker: this.visitor?.id ?? '' });
    } catch (error) {
      this.bubbles.forget('self');
      this.showNotice(error instanceof Error ? error.message : '訊息未能送出。', 5_000);
    }
  }

  public dispose(): void {
    this.liveWorld?.dispose();
    this.labels.clear();
    this.danmaku.element.remove();
    this.danmaku.toggleButton.remove();
    this.element.remove();
    this.speech.element.remove();
    this.speakButton.remove();
    this.prompt.remove();
    this.placeButton.remove();
  }

  /** Attach the floating prompt and button to the game container. */
  public mount(container: HTMLElement): void {
    container.append(this.labels.element, this.danmaku.element, this.danmaku.toggleButton, this.prompt, this.placeButton, this.card, this.element, this.speakButton, this.speech.element);
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
    if (this.speech.open) return;
    const visitor = this.visitor;
    const ground = this.game.birdGroundPoint;
    if (!visitor || visitor.placed || this.placing || !ground || !insideMemorialGround(ground.x, ground.z)) return;
    this.cardTitle.textContent = `在這裡放下${FLOWER_LABELS[visitor.kind]}`;
    this.cardMessage.value = visitor.message;
    this.cardNote.textContent = openWorldConfig()
      ? '花和名字會即時讓所有人看到，會一直留在這裡。留言你自己走近就能讀到；經審核後，所有人走近花旁都能讀到。'
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
    if (visitor.message) rememberOwnWords(localId, visitor.message);
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
      if (visitor.message) rememberOwnWords(placed.flower.id, visitor.message);
      visitor.placed = true;
      this.showNotice(placed.messageStatus === 'pending'
        ? `你在宏福苑放下了${label}，所有人都看得到。留言會在審核後顯示在花旁。`
        : `你在宏福苑放下了${label}，所有人都看得到。`, 10_000);
    } catch (error) {
      if (error instanceof FlowerRefused) {
        // Not allowed (too many at once, outside the grounds): take it back and keep carrying it.
        this.game.flowers.remove(localId);
        this.game.holdFlower(visitor.kind);
        this.showNotice(error.message, 6_000);
      } else {
        // The service is unreachable: the flower stays where it was laid, and is sent on later.
        saveLocalFlower({ ...flower, message: visitor.message });
        if (visitor.message) rememberOwnWords(localId, visitor.message);
        rememberFlowerTotal(this.game.flowers.count);
        visitor.placed = true;
        this.showNotice(`你在宏福苑放下了${label}。共享服務暫時未能連上，花會留在這裡，連上後其他人就會看到。`, 10_000);
      }
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
    const now = performance.now();
    const bird = this.game.birdPosition;
    const own = readOwnWords();
    for (const { flower } of this.game.flowers.nearest(bird, FLOWER_LABEL_RADIUS, 3, FLOWER_LABEL_HEIGHT)) {
      const title = flower.name ? `${flower.name} · ${FLOWER_LABELS[flower.kind]}` : `一朵${FLOWER_LABELS[flower.kind]}`;
      const mine = !flower.message && own[flower.id];
      labels.push({
        id: `flower-${flower.id}`,
        title,
        body: flower.message || (mine ? `${mine}\n（審核中・暫時只有你看得到）` : undefined),
        position: new Vector3(flower.x, this.game.flowers.displayY(flower) + 0.45, flower.z),
        tone: 'flower',
      });
    }
    const said = this.bubbles.textFor('self', now);
    if (said) {
      const ground = this.game.birdGroundPoint;
      labels.push({
        id: 'speech-self',
        title: this.visitor?.name || '你',
        body: said,
        position: ground ? new Vector3(ground.x, ground.y + 0.75, ground.z) : bird.clone().setY(bird.y + 2.6),
        tone: 'speech',
      });
    }
    for (const remote of this.game.remoteBirdLabels) {
      if (remote.position.distanceTo(bird) > NAME_LABEL_RADIUS) continue;
      const lift = remote.size * 2.2;
      const words = this.bubbles.textFor(remote.id, now);
      labels.push({
        id: `player-${remote.id}`,
        title: remote.name || '訪客',
        body: words ?? undefined,
        position: remote.position.clone().setY(remote.position.y + lift),
        tone: words ? 'speech' : 'player',
      });
    }
    return labels;
  }

  private showStatus(status: LiveStatus): void {
    this.status.textContent = status === 'online'
      ? this.nearbyText()
      : status === 'connecting' ? '正在連線…' : '連線中斷，正在重試。';
  }

  private showPeers(peers: readonly WorldPlayer[]): void {
    const bird = this.game.birdPosition;
    // Draw the nearest birds when more are online than the renderer holds.
    const nearest = [...peers]
      .sort((a, b) => distance(a.position, bird) - distance(b.position, bird))
      .slice(0, WORLD_PLAYER_LIMIT);
    this.game.syncPlayers(nearest, true);
    const text = this.nearbyText();
    if (text !== this.status.textContent) this.status.textContent = text;
  }

  private nearbyText(): string {
    const live = this.liveWorld;
    if (!live || !live.homeZone) return '正在連線…';
    return live.nearbyCount > 1
      ? `${live.homeLabel}此刻有 ${live.nearbyCount} 位同在。`
      : `${live.homeLabel}此刻只有你。其他人來到時，你會看見他們。`;
  }

  /** A line said somewhere in the world: shown over the bird that said it, if that bird is in sight. */
  private appendChat(line: ChatLine): void {
    if (this.visitor && line.speaker === this.visitor.id) return; // already showing over our own bird
    const birds = this.game.remoteBirdLabels.map(remote => ({ id: remote.id, name: remote.name, position: remote.position }));
    const speaker = findSpeaker(line, birds);
    if (speaker) this.bubbles.say(speaker, line.body, performance.now());
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

function readOwnWords(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OWN_WORDS_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberOwnWords(flowerId: string, words: string): void {
  try {
    const entries = Object.entries({ ...readOwnWords(), [flowerId]: words }).slice(-OWN_WORDS_CAP);
    localStorage.setItem(OWN_WORDS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* per-browser convenience */ }
}

function moveOwnWords(from: string, to: string): void {
  const words = readOwnWords()[from];
  if (words) rememberOwnWords(to, words);
}

function forgetLocalFlower(id: string): void {
  try {
    localStorage.setItem(LOCAL_FLOWERS_KEY, JSON.stringify(readLocalFlowers().filter(flower => flower.id !== id)));
  } catch { /* per-browser convenience */ }
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
