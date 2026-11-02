import type { StreetData } from '../game/streetData';

/** Metres per pixel of the pre-drawn map, and how far it reaches from the centre of the region. */
const BAKE_METRES_PER_PIXEL = 4;
const BAKE_HALF_METRES = 3_400;

export interface RadarState {
  /** The bird, in the local frame (metres, +x east, +z south). */
  x: number;
  z: number;
  /** Heading in radians: 0 faces north (-z), positive turns to the west (three.js yaw). */
  yaw: number;
  grounded: boolean;
  /** Other birds in sight. */
  peers: ReadonlyArray<{ x: number; z: number }>;
  /** Wang Fuk Court, and whether the visitor still carries a flower there. */
  court: { x: number; z: number };
  carrying: boolean;
}

/**
 * A round map in the corner that turns with the bird, like an open-world radar:
 * roads and water around you, other birds as small lights, and Wang Fuk Court
 * always marked (on the rim when it is out of range, so it can always be found).
 */
export class RadarMap {
  public readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private baked: HTMLCanvasElement | null = null;
  private bakedRoads = 0;
  private lastBake = -Infinity;
  private lastDraw = -Infinity;
  private size = 0;

  public constructor() {
    this.element.className = 'radar-map';
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', '附近地圖：中央是你，光點是其他小鳥，花是宏福苑');
    this.element.append(this.canvas);
    this.context = this.canvas.getContext('2d');
  }

  /** Draw roads and water once (again when many more have loaded). */
  public setStreets(streets: Readonly<StreetData>, now = performance.now()): void {
    const roads = streets.roads.length;
    if (roads === 0) return;
    const grew = roads > this.bakedRoads * 1.2 + 10;
    if (this.baked && (!grew || now - this.lastBake < 5_000)) return;
    this.lastBake = now;
    this.bakedRoads = roads;
    const pixels = Math.round((BAKE_HALF_METRES * 2) / BAKE_METRES_PER_PIXEL);
    const canvas = this.baked ?? document.createElement('canvas');
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, pixels, pixels);
    const toPixel = (value: number) => (value + BAKE_HALF_METRES) / BAKE_METRES_PER_PIXEL;
    context.fillStyle = 'rgba(70, 140, 175, 0.85)';
    for (const area of streets.water) {
      context.beginPath();
      for (const ring of area.rings) {
        ring.forEach((point, index) => (index === 0 ? context.moveTo(toPixel(point.x), toPixel(point.z)) : context.lineTo(toPixel(point.x), toPixel(point.z))));
        context.closePath();
      }
      context.fill('evenodd');
    }
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const road of streets.roads) {
      const major = road.laneClass === 'motorway' || road.laneClass === 'trunk' || road.laneClass === 'primary';
      context.strokeStyle = major ? 'rgba(246, 232, 205, 0.85)' : 'rgba(230, 226, 214, 0.5)';
      context.lineWidth = major ? 3 : road.laneClass === 'service' ? 1 : 1.6;
      context.beginPath();
      road.points.forEach((point, index) => (index === 0 ? context.moveTo(toPixel(point.x), toPixel(point.z)) : context.lineTo(toPixel(point.x), toPixel(point.z))));
      context.stroke();
    }
    this.baked = canvas;
  }

  /** Redraw (at most about 20 times a second). */
  public draw(state: RadarState, now = performance.now()): void {
    if (!this.context || now - this.lastDraw < 50) return;
    this.lastDraw = now;
    const css = this.element.clientWidth || 160;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(css * ratio);
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = this.canvas.height = size;
    }
    const c = this.context;
    const half = size / 2;
    // Closer in on the ground (walking), wider in the air.
    const rangeMetres = state.grounded ? 160 : 700;
    const scale = half / rangeMetres; // px per metre
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, size, size);
    c.save();
    c.beginPath();
    c.arc(half, half, half - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(14, 28, 30, 0.72)';
    c.fillRect(0, 0, size, size);

    // The world turns so that the way the bird faces is up.
    c.translate(half, half);
    c.rotate(state.yaw);
    if (this.baked) {
      const bakeScale = scale * BAKE_METRES_PER_PIXEL;
      c.save();
      c.scale(bakeScale, bakeScale);
      c.translate(-(state.x + BAKE_HALF_METRES) / BAKE_METRES_PER_PIXEL, -(state.z + BAKE_HALF_METRES) / BAKE_METRES_PER_PIXEL);
      c.drawImage(this.baked, 0, 0);
      c.restore();
    }
    // Other birds: small soft lights.
    c.fillStyle = 'rgba(255, 246, 225, 0.95)';
    for (const peer of state.peers) {
      const dx = (peer.x - state.x) * scale;
      const dz = (peer.z - state.z) * scale;
      if (Math.hypot(dx, dz) > half - 4) continue;
      c.beginPath();
      c.arc(dx, dz, Math.max(2, size * 0.014), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    // Wang Fuk Court: a white flower, held on the rim when out of range.
    const courtDx = (state.court.x - state.x) * scale;
    const courtDz = (state.court.z - state.z) * scale;
    const cos = Math.cos(state.yaw);
    const sin = Math.sin(state.yaw);
    let cx = courtDx * cos - courtDz * sin;
    let cy = courtDx * sin + courtDz * cos;
    const reach = half - size * 0.08;
    const distance = Math.hypot(cx, cy);
    if (distance > reach) {
      cx *= reach / distance;
      cy *= reach / distance;
    }
    drawFlower(c, half + cx, half + cy, size * (state.carrying ? 0.06 : 0.045), state.carrying);

    // North on the rim.
    const nx = half + Math.sin(-state.yaw) * (half - size * 0.07) * -1;
    const ny = half - Math.cos(state.yaw) * (half - size * 0.07);
    c.fillStyle = 'rgba(255, 255, 255, 0.8)';
    c.font = `600 ${Math.round(size * 0.075)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('北', nx, ny);

    // You, in the middle, facing up.
    c.fillStyle = '#ffd79a';
    c.strokeStyle = 'rgba(20, 20, 20, 0.6)';
    c.lineWidth = Math.max(1, size * 0.008);
    c.beginPath();
    const s = size * 0.05;
    c.moveTo(half, half - s * 1.2);
    c.lineTo(half + s * 0.75, half + s * 0.8);
    c.lineTo(half, half + s * 0.35);
    c.lineTo(half - s * 0.75, half + s * 0.8);
    c.closePath();
    c.fill();
    c.stroke();

    // Rim.
    c.beginPath();
    c.arc(half, half, half - size * 0.01, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255, 244, 222, 0.45)';
    c.lineWidth = Math.max(1, size * 0.012);
    c.stroke();
  }

  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }
}

function drawFlower(c: CanvasRenderingContext2D, x: number, y: number, radius: number, glowing: boolean): void {
  if (glowing) {
    const glow = c.createRadialGradient(x, y, 0, x, y, radius * 2.6);
    glow.addColorStop(0, 'rgba(255, 226, 168, 0.75)');
    glow.addColorStop(1, 'rgba(255, 226, 168, 0)');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, radius * 2.6, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#fbf8ef';
  for (let petal = 0; petal < 5; petal += 1) {
    const angle = (petal / 5) * Math.PI * 2;
    c.beginPath();
    c.arc(x + Math.cos(angle) * radius * 0.55, y + Math.sin(angle) * radius * 0.55, radius * 0.48, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#e9b949';
  c.beginPath();
  c.arc(x, y, radius * 0.3, 0, Math.PI * 2);
  c.fill();
}
