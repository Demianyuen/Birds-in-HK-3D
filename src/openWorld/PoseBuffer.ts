import { Quaternion } from 'three';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

interface Sample {
  /** When it arrived (ms, performance.now). */
  t: number;
  p: Vec3;
  q: Quat;
  perched: boolean;
}

export interface SmoothedPose {
  position: Vec3;
  quaternion: Quat;
  perched: boolean;
}

const MAX_SAMPLES = 8;
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 700;
/** Beyond this many metres between two samples the bird has jumped (a new zone, a respawn): do not glide across. */
const TELEPORT_METRES = 400;
const MAX_EXTRAPOLATE_MS = 500;

/**
 * Smooths another bird's pose, which arrives only 2-4 times a second.
 * We draw it a little in the past (about one and a half message gaps), so there
 * are almost always two samples to glide between; if a message is late we
 * carry on along its last direction for half a second, then hold still.
 */
export class PoseBuffer {
  private readonly samples: Sample[] = [];
  private gap = 400;
  private readonly from = new Quaternion();
  private readonly to = new Quaternion();

  public push(position: readonly number[], quaternion: readonly number[], perched: boolean, now: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last) {
      if (now <= last.t) now = last.t + 1;
      // Gaps while standing still say nothing about the sending rate.
      const gap = Math.min(1_000, now - last.t);
      this.gap += (gap - this.gap) * 0.25;
    }
    this.samples.push({ t: now, p: [position[0], position[1], position[2]], q: [quaternion[0], quaternion[1], quaternion[2], quaternion[3]], perched });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  public get delay(): number {
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, this.gap * 1.5));
  }

  public get size(): number {
    return this.samples.length;
  }

  /** Where the bird should be drawn at time `now`, or null before anything arrived. */
  public sample(now: number): SmoothedPose | null {
    const count = this.samples.length;
    if (count === 0) return null;
    const first = this.samples[0];
    const last = this.samples[count - 1];
    const time = now - this.delay;
    if (count === 1 || time <= first.t) return { position: first.p, quaternion: first.q, perched: first.perched };

    if (time >= last.t) {
      const before = this.samples[count - 2];
      const span = last.t - before.t;
      const ahead = Math.min(time - last.t, MAX_EXTRAPOLATE_MS);
      if (span <= 0 || distance(before.p, last.p) > TELEPORT_METRES) return { position: last.p, quaternion: last.q, perched: last.perched };
      const k = ahead / span;
      return {
        position: [
          last.p[0] + (last.p[0] - before.p[0]) * k,
          last.p[1] + (last.p[1] - before.p[1]) * k,
          last.p[2] + (last.p[2] - before.p[2]) * k,
        ],
        quaternion: last.q,
        perched: last.perched,
      };
    }

    let index = 1;
    while (index < count - 1 && this.samples[index].t < time) index += 1;
    const a = this.samples[index - 1];
    const b = this.samples[index];
    if (distance(a.p, b.p) > TELEPORT_METRES) return { position: b.p, quaternion: b.q, perched: b.perched };
    const k = (time - a.t) / (b.t - a.t);
    this.from.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    this.to.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    this.from.slerp(this.to, k);
    return {
      position: [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k],
      quaternion: [this.from.x, this.from.y, this.from.z, this.from.w],
      perched: k < 0.5 ? a.perched : b.perched,
    };
  }

  public get lastSeen(): number {
    return this.samples[this.samples.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
