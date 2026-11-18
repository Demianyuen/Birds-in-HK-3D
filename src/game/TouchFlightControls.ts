import type { FlightControl } from './BirdController';

interface FlightInput {
  setControl(control: FlightControl, pressed: boolean): void;
  setSteerAxes(x: number, y: number): void;
  flap(): void;
}

/** Finger travel (px) for full deflection. */
const STICK_RADIUS = 72;
const DEAD_ZONE = 0.12;
/** A touch that moved less than this and ended sooner than this is a tap: one wingbeat. */
const TAP_TRAVEL = 12;
const TAP_MS = 280;
/** Past this share of the stick, up/down also walks the bird when it is on the ground. */
const WALK_THRESHOLD = 0.45;
const FLAP_REPEAT_MS = 420;

/** Dead zone, then a gentle curve: small drags make small turns. Exported for tests. */
export function stickAxis(offsetPx: number): number {
  const raw = Math.max(-1, Math.min(1, offsetPx / STICK_RADIUS));
  const size = Math.abs(raw);
  if (size < DEAD_ZONE) return 0;
  const shaped = (size - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(raw) * shaped * (0.55 + 0.45 * shaped);
}

/**
 * Phone and tablet flying, one thumb each:
 *  - drag anywhere on the view: the bird turns towards the drag (right/left) and
 *    climbs or dives (up/down); let go and it levels out. On the ground the same
 *    drag turns and walks.
 *  - tap the view, or hold the small wing button: beat the wings (take off, climb).
 * The bird keeps its own natural pace; there are no speed buttons in the way of the view.
 */
export class TouchFlightControls {
  readonly element = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly knob = document.createElement('div');
  private readonly hint = document.createElement('p');
  private readonly held = new Map<string, FlightControl>();
  private drag: { id: number; x: number; y: number; at: number; travel: number } | null = null;
  private walking: FlightControl | null = null;
  private flapTimer = 0;
  private visible = false;
  /** Time of the last touch: mouse events the browser makes up after a touch are ignored. */
  public lastTouchAt = -Infinity;

  constructor(private readonly game: FlightInput) {
    this.element.className = 'touch-flight';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', '觸控飛行');
    this.element.hidden = true;

    this.stick.className = 'touch-stick';
    this.stick.hidden = true;
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);

    this.hint.className = 'touch-hint';
    this.hint.textContent = '拖曳畫面轉向 · 點一下拍翼';

    const flap = document.createElement('button');
    flap.type = 'button';
    flap.className = 'touch-flap';
    flap.textContent = '拍翼';
    flap.setAttribute('aria-label', '拍翼（按住連續拍）');
    flap.addEventListener('pointerdown', event => {
      event.preventDefault();
      this.lastTouchAt = performance.now();
      flap.setPointerCapture(event.pointerId);
      this.game.flap();
      window.clearInterval(this.flapTimer);
      this.flapTimer = window.setInterval(() => this.game.flap(), FLAP_REPEAT_MS);
    });
    const stopFlap = () => window.clearInterval(this.flapTimer);
    flap.addEventListener('pointerup', stopFlap);
    flap.addEventListener('pointercancel', stopFlap);
    flap.addEventListener('lostpointercapture', stopFlap);
    flap.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); this.game.flap(); }
    });

    this.element.append(this.hint, flap);
  }

  /** The drag-to-steer surface is the 3D view itself, so taps on flowers still reach it. */
  attach(surface: HTMLElement): void {
    surface.style.touchAction = 'none';
    surface.parentElement?.append(this.stick);
    surface.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !this.visible || this.drag) return;
      this.lastTouchAt = performance.now();
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), travel: 0 };
      surface.setPointerCapture(event.pointerId);
      this.stick.style.left = `${event.clientX}px`;
      this.stick.style.top = `${event.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.stick.hidden = false;
    });
    surface.addEventListener('pointermove', event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      this.lastTouchAt = performance.now();
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.travel = Math.max(drag.travel, Math.hypot(dx, dy));
      const reach = Math.min(1, STICK_RADIUS / Math.max(1, Math.hypot(dx, dy)));
      this.knob.style.transform = `translate(calc(-50% + ${dx * reach}px), calc(-50% + ${dy * reach}px))`;
      const x = stickAxis(dx);
      const y = stickAxis(dy);
      this.game.setSteerAxes(x, y);
      this.setWalking(y < -WALK_THRESHOLD ? 'pitchUp' : y > WALK_THRESHOLD ? 'pitchDown' : null);
      if (drag.travel > TAP_TRAVEL) this.hint.hidden = true;
    });
    const end = (event: PointerEvent) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      this.lastTouchAt = performance.now();
      const tap = event.type === 'pointerup' && drag.travel < TAP_TRAVEL && performance.now() - drag.at < TAP_MS;
      this.endDrag();
      if (tap) this.game.flap();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  releaseAll(): void {
    for (const control of this.held.values()) this.game.setControl(control, false);
    this.held.clear();
    window.clearInterval(this.flapTimer);
    this.endDrag();
  }

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.stick.hidden = true;
    this.game.setSteerAxes(0, 0);
    this.setWalking(null);
  }

  private setWalking(control: FlightControl | null): void {
    if (control === this.walking) return;
    if (this.walking) this.game.setControl(this.walking, false);
    this.walking = control;
    if (control) this.game.setControl(control, true);
  }


}
