import { Raycaster, Vector3, type Object3D } from 'three';
import { Grove, scatterTrees } from './grove';
import {
  BLOCK_RADIUS, fitBlock, planToWorld, probeDirections, STOREYS, STOREY_HEIGHT, type BlockFit, type ProfileSample,
} from './plan';
import { ROOF_CAP_HEIGHT, type WangFukCourt } from './WangFukCourt';
import { MEMORIAL_OPEN_RADIUS, MEMORIAL_PLAZA } from '../openWorld/contentRules';

export interface CourtMarker {
  block: string;
  x: number;
  z: number;
}

export interface CourtWorld {
  /** Surfaces to measure against (the aerial photo mesh). */
  roots: () => Object3D[];
  /** Height of the smooth terrain model at x, z. */
  terrain: (x: number, z: number) => number;
  /** False where a tree cannot stand (water). */
  canGrowTree?: (x: number, z: number) => boolean;
  /** Level ground laid out here (the estate grounds), if any: trees stand on it. */
  surface?: (x: number, z: number) => number | null;
}

export interface CourtMetrics {
  placed: number;
  total: number;
  attempts: number;
  trees: number;
  fits: Array<{ block: string; error: number; rays: number; yawDegrees: number; height: number }>;
}

/** Fits worse than this (mean metres of error per ray) are not trusted and nothing is drawn. */
const MAX_FIT_ERROR = 1.4;
const MIN_HITS = 40;
/** Quick tries per tower while the photo mesh is still sharpening; after these a tower is retried slowly, never given up. */
const QUICK_ATTEMPTS = 8;
const SLOW_RETRY_SECONDS = 3;
/** After this many tries a tower measured on the live map (16 Nov 2026) is stood where it was measured then. */
const KNOWN_AFTER_ATTEMPTS = 14;
const KNOWN_POSES: Readonly<Record<string, { x: number; z: number; yaw: number; baseY: number; height: number }>> = {
  H: { x: 81, z: -16, yaw: (134.1 * Math.PI) / 180, baseY: 6.8, height: 87.3 },
  G: { x: 82, z: 24, yaw: (47.3 * Math.PI) / 180, baseY: 6.8, height: 88 },
  F: { x: 86, z: 64, yaw: (125.6 * Math.PI) / 180, baseY: 6.3, height: 87.2 },
  E: { x: 43, z: 68, yaw: (48.9 * Math.PI) / 180, baseY: 7.3, height: 86.2 },
};
/** Only measure towers the bird is near enough for the photo mesh to be detailed there (m). */
const MEASURE_RANGE = 700;
const MEASURE_INTERVAL = 0.35;
const DEFAULT_BODY_HEIGHT = STOREYS * STOREY_HEIGHT;

/**
 * Measures each tower in the aerial photo mesh (where its walls are, how it is
 * turned, how tall) and, only when the measurement is convincing, stands a
 * hand-built Wang Fuk Court block there and cuts the photo tower away. Nothing
 * is drawn for a block that cannot be measured, so nothing is ever misplaced.
 */
export class CourtPlacer {
  private readonly raycaster = new Raycaster();
  private readonly attempts = new Map<string, number>();
  private readonly fits = new Map<string, BlockFit & { height: number }>();
  private clock = 0;
  private lastAttempt = -10;
  private treesStarted = false;
  private groundOffset = 0;
  private totalAttempts = 0;
  private readonly retryAt = new Map<string, number>();

  public constructor(
    private readonly court: WangFukCourt,
    private readonly grove: Grove,
    private readonly markers: readonly CourtMarker[],
    private readonly world: CourtWorld,
    private readonly onPlaced: () => void = () => undefined,
  ) {}

  public get metrics(): CourtMetrics {
    return {
      placed: this.court.count,
      total: this.markers.length,
      attempts: this.totalAttempts,
      trees: this.grove.size,
      fits: [...this.fits.entries()].map(([block, fit]) => ({
        block, error: Number(fit.error.toFixed(2)), rays: fit.rays, yawDegrees: Number(((fit.yaw * 180) / Math.PI).toFixed(1)), height: Number(fit.height.toFixed(1)),
      })),
    };
  }

  public update(deltaSeconds: number, bird: Vector3, ready: boolean): void {
    this.clock += deltaSeconds;
    if (this.treesStarted) {
      this.grove.update((x, z) => this.world.surface?.(x, z) ?? this.world.terrain(x, z) + this.groundOffset);
    }
    if (!ready || this.markers.length === 0 || this.court.count >= this.markers.length) return;
    if (this.clock - this.lastAttempt < MEASURE_INTERVAL) return;
    const next = this.markers
      .filter(marker => !this.court.has(marker.block) && (this.retryAt.get(marker.block) ?? 0) <= this.clock)
      .map(marker => ({ marker, tries: this.attempts.get(marker.block) ?? 0, distance: Math.hypot(marker.x - bird.x, marker.z - bird.z) }))
      .filter(item => item.distance < MEASURE_RANGE)
      // Fewest tries first, so one tower that is hard to measure never holds the others back.
      .sort((a, b) => a.tries - b.tries || a.distance - b.distance)[0];
    if (!next) return;
    this.lastAttempt = this.clock;
    const tries = next.tries + 1;
    this.attempts.set(next.marker.block, tries);
    if (tries >= QUICK_ATTEMPTS) this.retryAt.set(next.marker.block, this.clock + SLOW_RETRY_SECONDS);
    this.totalAttempts += 1;
    this.tryBlock(next.marker, tries);
  }

  /** A tower that could not be measured after many tries, stood where it was measured on the live map. */
  private placeKnown(marker: CourtMarker): boolean {
    const known = KNOWN_POSES[marker.block];
    if (!known || Math.hypot(known.x - marker.x, known.z - marker.z) > 12) return false;
    this.fits.set(marker.block, { x: known.x, z: known.z, yaw: known.yaw, error: 0, rays: 0, height: known.height });
    this.court.place(marker.block, known, known.baseY, known.height);
    if (!this.treesStarted) this.startTrees(known.baseY - this.world.terrain(marker.x, marker.z));
    this.onPlaced();
    return true;
  }

  private tryBlock(marker: CourtMarker, tries = 1): void {
    if (this.measureBlock(marker, tries)) return;
    if (tries >= KNOWN_AFTER_ATTEMPTS) this.placeKnown(marker);
  }

  private measureBlock(marker: CourtMarker, tries: number): boolean {
    const roots = this.world.roots();
    if (roots.length === 0) return false;
    const terrain = this.world.terrain(marker.x, marker.z);
    const midY = terrain + 45;
    const samples: ProfileSample[] = probeDirections(72).map(({ dx, dz }) => {
      this.raycaster.set(new Vector3(marker.x, midY, marker.z), new Vector3(dx, 0, dz));
      this.raycaster.near = 0.5;
      this.raycaster.far = 24;
      const hit = this.raycaster.intersectObjects(roots, true)[0];
      return { dx, dz, distance: hit ? hit.distance : null };
    });
    if (samples.filter(sample => sample.distance !== null).length < MIN_HITS) return false;
    const fit = fitBlock(marker.x, marker.z, samples);
    // The longer a tower resists, the looser the fit that is accepted (the photo mesh may never sharpen on a slow line).
    const allowed = MAX_FIT_ERROR + Math.min(0.6, Math.max(0, tries - QUICK_ATTEMPTS) * 0.05);
    if (!fit || fit.error > allowed) return false;

    // Ground beside the tower: the lowest of several downward rays (canopy and cars sit higher).
    const reach = BLOCK_RADIUS + 7;
    let ground = Infinity;
    for (const [ox, oz] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach], [reach * 0.7, reach * 0.7], [-reach * 0.7, -reach * 0.7]] as const) {
      const [wx, wz] = planToWorld(fit, [ox, oz]);
      const hit = this.castDown(wx, wz, terrain + 160, roots);
      if (hit !== null) ground = Math.min(ground, hit);
    }
    const baseY = Number.isFinite(ground) && Math.abs(ground - terrain) < 14 ? ground : terrain;
    const roof = this.castDown(fit.x, fit.z, baseY + 220, roots);
    let body = DEFAULT_BODY_HEIGHT;
    if (roof !== null) {
      const measured = roof - baseY - ROOF_CAP_HEIGHT;
      if (measured > 60 && measured < 110) body = measured;
    }
    this.fits.set(marker.block, { ...fit, height: body });
    this.court.place(marker.block, fit, baseY, body);
    if (!this.treesStarted) this.startTrees(baseY - terrain);
    this.onPlaced();
    return true;
  }

  private castDown(x: number, z: number, fromY: number, roots: Object3D[]): number | null {
    this.raycaster.set(new Vector3(x, fromY, z), new Vector3(0, -1, 0));
    this.raycaster.near = 0;
    this.raycaster.far = 400;
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    return hit ? hit.point.y : null;
  }

  private startTrees(offset: number): void {
    this.treesStarted = true;
    this.groundOffset = offset;
    const circle = BLOCK_RADIUS + 4;
    const spots = scatterTrees(this.markers.map(marker => ({ x: marker.x, z: marker.z, yaw: 0 })), {
      radius: 120,
      count: 170,
      wallClearance: 0,
      allowed: (x, z) => Math.hypot(x - MEMORIAL_PLAZA.x, z - MEMORIAL_PLAZA.z) > MEMORIAL_OPEN_RADIUS
        && this.markers.every(marker => Math.hypot(x - marker.x, z - marker.z) > circle)
        && (this.world.canGrowTree ? this.world.canGrowTree(x, z) : true),
    });
    this.grove.add(spots);
  }
}
