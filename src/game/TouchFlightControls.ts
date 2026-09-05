import type { FlightControl } from './BirdController';

interface FlightInput {
  setControl(control: FlightControl, pressed: boolean): void;
  flap(): void;
}

export class TouchFlightControls {
  readonly element = document.createElement('div');
  private readonly held = new Map<string, FlightControl>();

  constructor(private readonly game: FlightInput) {
    this.element.className = 'touch-flight';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', '白鴿觸控飛行');
    this.element.hidden = true;
    const controls: Array<[FlightControl, string, string]> = [
      ['yawLeft', '←', '向左轉'], ['pitchUp', '↑', '抬頭上升'], ['yawRight', '→', '向右轉'],
      ['decelerate', '−', '減速'], ['pitchDown', '↓', '低頭下降'], ['accelerate', '＋', '加速'],
    ];
    for (const [control, symbol, label] of controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held.set(`pointer:${event.pointerId}`, control);
        this.game.setControl(control, true);
      });
      const release = (event: PointerEvent) => this.release(`pointer:${event.pointerId}`);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      button.addEventListener('keydown', event => {
        if (event.code !== 'Space' && event.code !== 'Enter') return;
        event.preventDefault();
        this.held.set(`key:${control}:${event.code}`, control);
        this.game.setControl(control, true);
      });
      button.addEventListener('keyup', event => this.release(`key:${control}:${event.code}`));
      button.addEventListener('blur', () => {
        this.release(`key:${control}:Space`);
        this.release(`key:${control}:Enter`);
      });
      this.element.append(button);
    }
    const flap = document.createElement('button');
    flap.type = 'button';
    flap.className = 'touch-flap';
    flap.textContent = '拍翼起飛';
    flap.addEventListener('click', () => this.game.flap());
    this.element.append(flap);
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  releaseAll(): void {
    for (const control of this.held.values()) this.game.setControl(control, false);
    this.held.clear();
  }

  private release(key: string): void {
    const control = this.held.get(key);
    if (!control) return;
    this.held.delete(key);
    this.game.setControl(control, [...this.held.values()].includes(control));
  }
}
