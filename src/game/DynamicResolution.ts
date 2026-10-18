/**
 * Adaptive render resolution: lowers the pixel ratio when the frame rate drops
 * (fragment-heavy terrain on integrated GPUs) and restores it when there is
 * headroom. Hysteresis keeps it from oscillating between steps.
 */
export interface DynamicResolutionOptions {
  maximum: number;
  minimum: number;
  /** Below this smoothed FPS the resolution steps down. */
  lowFps: number;
  /** At or above this smoothed FPS (for several windows) it steps back up. */
  highFps: number;
  windowMs: number;
  step: number;
}

export class DynamicResolution {
  public current: number;
  private readonly options: DynamicResolutionOptions;
  private windowStart = -1;
  private frames = 0;
  private windowMs = 0;
  private goodWindows = 0;
  private holdUntil = 0;

  public constructor(options: Partial<DynamicResolutionOptions> & Pick<DynamicResolutionOptions, 'maximum'>) {
    this.options = {
      minimum: 0.6,
      lowFps: 45,
      highFps: 57,
      windowMs: 1_500,
      step: 0.1,
      ...options,
    };
    this.options.minimum = Math.min(this.options.minimum, this.options.maximum);
    this.current = this.options.maximum;
  }

  /** Feed one frame; returns the new pixel ratio when it changes, otherwise null. */
  public update(frameMs: number, nowMs: number): number | null {
    // Ignore hitches (tab switches, shader compiles, tile parsing); they are not steady-state cost.
    if (frameMs > 250) return null;
    if (this.windowStart < 0) this.windowStart = nowMs;
    this.frames += 1;
    this.windowMs += frameMs;
    if (nowMs - this.windowStart < this.options.windowMs) return null;

    const fps = (this.frames * 1_000) / Math.max(1, this.windowMs);
    this.windowStart = nowMs;
    this.frames = 0;
    this.windowMs = 0;
    const { minimum, maximum, lowFps, highFps, step } = this.options;

    if (fps < lowFps && this.current > minimum + 1e-3) {
      this.current = round(Math.max(minimum, this.current - step));
      this.goodWindows = 0;
      this.holdUntil = nowMs + this.options.windowMs * 3;
      return this.current;
    }
    if (fps >= highFps && this.current < maximum - 1e-3 && nowMs >= this.holdUntil) {
      this.goodWindows += 1;
      if (this.goodWindows >= 3) {
        this.goodWindows = 0;
        this.current = round(Math.min(maximum, this.current + step / 2));
        return this.current;
      }
    } else if (fps < highFps) {
      this.goodWindows = 0;
    }
    return null;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
