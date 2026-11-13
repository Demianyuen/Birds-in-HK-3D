/**
 * Steps the costly parts of the picture down when a computer cannot keep up,
 * judged on the real time between frames (not the game's capped step), so even
 * a machine drawing two frames a second is noticed within a few seconds.
 *
 * 0 everything · 1 no glow · 2 no off-screen post-processing · 3 no sun shadows,
 * fewer people and cars, coarser map tiles.
 */
export const QUALITY_LEVELS = 3;

export class QualityLadder {
  public level = 0;
  private windowStart = -1;
  private frames = 0;
  private slowWindows = 0;
  private fastWindows = 0;

  public constructor(
    private readonly windowMs = 2_000,
    private readonly lowFps = 24,
    private readonly highFps = 55,
  ) {}

  /** Feed the real time of one frame; returns the new level when it changes. */
  public update(nowMs: number): number | null {
    if (this.windowStart < 0) {
      this.windowStart = nowMs;
      return null;
    }
    this.frames += 1;
    const elapsed = nowMs - this.windowStart;
    if (elapsed < this.windowMs) return null;
    // A window with a long stall (tab hidden, shader compile) says nothing about steady cost.
    const fps = (this.frames * 1_000) / elapsed;
    this.windowStart = nowMs;
    this.frames = 0;
    if (elapsed > this.windowMs * 4) return null;
    if (fps < this.lowFps) {
      this.fastWindows = 0;
      this.slowWindows += 1;
      if (this.slowWindows >= 2 && this.level < QUALITY_LEVELS) {
        this.slowWindows = 0;
        this.level += 1;
        return this.level;
      }
    } else if (fps >= this.highFps) {
      this.slowWindows = 0;
      this.fastWindows += 1;
      if (this.fastWindows >= 6 && this.level > 0) {
        this.fastWindows = 0;
        this.level -= 1;
        return this.level;
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
    return null;
  }
}
