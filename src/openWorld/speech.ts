import { SPEECH_LINES } from './contentRules';

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
  private readonly choices: HTMLButtonElement[] = [];

  /**
   * Only the ready-made lines can be said over the bird: tap one (or press 1–6).
   * Nothing typed freely appears over anyone's head.
   */
  public constructor(
    private readonly onSay: (text: string) => void,
    private readonly onFocus: () => void,
    lines: readonly string[] = SPEECH_LINES,
  ) {
    this.element.className = 'speech-compose speech-choices';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '選一句話');
    lines.forEach((line, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'speech-choice';
      button.textContent = line;
      button.setAttribute('aria-keyshortcuts', String(index + 1));
      button.addEventListener('click', () => this.choose(line));
      button.addEventListener('focus', () => this.onFocus());
      this.choices.push(button);
      this.element.append(button);
    });
    this.element.addEventListener('submit', event => event.preventDefault());
    this.element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      const number = Number(event.key);
      if (Number.isInteger(number) && number >= 1 && number <= this.choices.length) {
        event.preventDefault();
        this.choose(this.choices[number - 1].textContent ?? '');
      }
    });
    this.element.addEventListener('keyup', event => event.stopPropagation());
    // Clicking back into the world (or anywhere else) closes the choices.
    this.element.addEventListener('focusout', event => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (!next || !this.element.contains(next)) this.close();
    });
  }

  public get open(): boolean {
    return !this.element.hidden;
  }

  public show(): void {
    this.element.hidden = false;
    this.choices[0]?.focus();
  }

  public close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private choose(line: string): void {
    this.close();
    if (line) this.onSay(line);
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
