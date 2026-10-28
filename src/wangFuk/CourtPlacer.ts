import { Raycaster, Vector3, type Object3D } from 'three';
import { Grove, scatterTrees } from './grove';
import {
  BLOCK_RADIUS, fitBlock, planToWorld, probeDirections, STOREYS, STOREY_HEIGHT, type BlockFit, type ProfileSample,
} from './plan';
import { ROOF_CAP_HEIGHT, type WangFukCourt } from './WangFukCourt';

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
const MAX_ATTEMPTS = 8;
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
      this.grove.update((x, z) => this.world.terrain(x, z) + this.groundOffset);
    }
    if (!ready || this.markers.length === 0 || this.court.count >= this.markers.length) return;
    if (this.clock - this.lastAttempt < MEASURE_INTERVAL) return;
    const next = this.markers
      .filter(marker => !this.court.has(marker.block) && (this.attempts.get(marker.block) ?? 0) < MAX_ATTEMPTS)
      .map(marker => ({ marker, distance: Math.hypot(marker.x - bird.x, marker.z - bird.z) }))
      .filter(item => item.distance < MEASURE_RANGE)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!next) return;
    this.lastAttempt = this.clock;
    this.attempts.set(next.marker.block, (this.attempts.get(next.marker.block) ?? 0) + 1);
    this.totalAttempts += 1;
    this.tryBlock(next.marker);
  }

  private tryBlock(marker: CourtMarker): void {
    const roots = this.world.roots();
    if (roots.length === 0) return;
    const terrain = this.world.terrain(marker.x, marker.z);
    const midY = terrain + 45;
    const samples: ProfileSample[] = probeDirections(72).map(({ dx, dz }) => {
      this.raycaster.set(new Vector3(marker.x, midY, marker.z), new Vector3(dx, 0, dz));
      this.raycaster.near = 0.5;
      this.raycaster.far = 24;
      const hit = this.raycaster.intersectObjects(roots, true)[0];
      return { dx, dz, distance: hit ? hit.distance : null };
    });
    if (samples.filter(sample => sample.distance !== null).length < MIN_HITS) return;
    const fit = fitBlock(marker.x, marker.z, samples);
    if (!fit || fit.error > MAX_FIT_ERROR) return;

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
      count: 360,
      wallClearance: 0,
      allowed: (x, z) => this.markers.every(marker => Math.hypot(x - marker.x, z - marker.z) > circle)
        && (this.world.canGrowTree ? this.world.canGrowTree(x, z) : true),
    });
    this.grove.add(spots);
  }
}
