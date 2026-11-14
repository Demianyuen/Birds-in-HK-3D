import { CHAT_MAX } from './contentRules';

/** A line stays over the bird for 15 seconds at most; a newer line replaces it at once. */
export const BUBBLE_SECONDS = 15;

export function bubbleSeconds(_text: string): number {
  return BUBBLE_SECONDS;
}

/** Words said in the world, shown over the bird that said them for a few seconds. */
export class SpeechBubbles {
  private readonly lines = new Map<string, { text: string; until: number }>();

  public say(birdId: string, text: string, now: number): void {
    this.lines.set(birdId, { text, until: now + bubbleSeconds(text) * 1_000 });
  }

  public forget(birdId: string): void {
    this.lines.delete(birdId);
  }

  public textFor(birdId: string, now: number): string | null {
    const line = this.lines.get(birdId);
    if (!line) return null;
    if (now > line.until) {
      this.lines.delete(birdId);
      return null;
    }
    return line.text;
  }
}

export interface Speaker {
  id: string;
  name: string;
  position: { x: number; z: number };
}

/** Furthest a speaker can have moved between saying a line and it arriving (m). */
const MATCH_RADIUS = 120;

/**
 * Which bird said a chat line. Lines carry the speaker's id; older rows (before
 * the id was stored) fall back to the nearest bird with the same name close to
 * where the line was said.
 */
export function findSpeaker(
  line: { speaker?: string; name: string; x: number; z: number },
  birds: readonly Speaker[],
): string | null {
  if (line.speaker) {
    const exact = birds.find(bird => bird.id === line.speaker);
    if (exact) return exact.id;
  }
  let best: string | null = null;
  let bestDistance = MATCH_RADIUS;
  for (const bird of birds) {
    if (bird.name !== line.name) continue;
    const distance = Math.hypot(bird.position.x - line.x, bird.position.z - line.z);
    if (distance <= bestDistance) {
      best = bird.id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Typing straight over your own bird: Enter opens a small bubble above its head
 * and the words appear there as you type (Chinese input methods included).
 * Enter says it, Esc or clicking elsewhere lets it go. Typing never steers the bird.
 */
export class SpeechInput {
  public readonly element = document.createElement('form');
  private readonly input = document.createElement('input');

  public constructor(
    private readonly onSay: (text: string) => void,
    private readonly onFocus: () => void,
  ) {
    this.element.className = 'speech-compose';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '說一句話');
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX;
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'send';
    this.input.placeholder = '說一句話… Enter 說出 · Esc 取消';
    this.input.setAttribute('aria-label', '說一句話，按 Enter 說出，Esc 取消');
    this.element.append(this.input);
    this.element.addEventListener('submit', event => {
      event.preventDefault();
      const text = this.input.value.trim();
      this.close();
      if (text) this.onSay(text);
    });
    this.input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', event => event.stopPropagation());
    // Clicking back into the world (or anywhere else) lets the line go.
    this.input.addEventListener('blur', () => this.close());
    this.input.addEventListener('focus', () => this.onFocus());
  }

  public get open(): boolean {
    return !this.element.hidden;
  }

  public show(): void {
    this.element.hidden = false;
    this.input.value = '';
    this.input.focus();
  }

  public close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.input.value = '';
    this.input.blur();
  }

  /** Keep the bubble over the bird's head (screen pixels), or at the bottom centre when the head is off screen. */
  public place(point: { x: number; y: number } | null): void {
    if (this.element.hidden) return;
    this.element.classList.toggle('speech-compose-docked', !point);
    this.element.style.transform = point
      ? `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%)`
      : '';
  }
}
