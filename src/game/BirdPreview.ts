import { AmbientLight, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { BirdRig } from './BirdRig';
import type { BirdProfileId, PlumageId } from './birdProfiles';

/**
 * A small turning view of the visitor's bird on the start screen, so choosing a
 * bird and its colours shows the result at once. Its renderer exists only while
 * the start screen is open.
 */
export class BirdPreview {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private readonly rig = new BirdRig();
  private frame = 0;
  private last = 0;
  private turn = 0;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.add(new HemisphereLight('#eef4f8', '#6b6a5c', 1.3), new AmbientLight('#ffffff', 0.25));
    const sun = new DirectionalLight('#fff0dc', 2.4);
    sun.position.set(-3, 6, 4);
    this.scene.add(sun, this.rig.root);
    this.camera.position.set(0, 1.4, 7.2);
    this.camera.lookAt(0, 0, 0);
  }

  public set(profile: BirdProfileId, plumage: PlumageId): void {
    this.rig.setProfile(profile);
    this.rig.setPlumage(plumage);
  }

  public start(): void {
    if (this.frame) return;
    try {
      this.renderer ??= new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch {
      this.canvas.hidden = true; // no WebGL here: the swatches alone still work
      return;
    }
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color('#000000'), 0);
    this.last = performance.now();
    const loop = (now: number): void => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1_000);
      this.last = now;
      this.turn += dt * 0.5;
      this.rig.root.rotation.y = -Math.PI / 2 + Math.sin(this.turn) * 0.9;
      this.rig.update(dt, { mode: 'flight', flapDemand: 0.35 });
      const width = this.canvas.clientWidth || 280;
      const height = this.canvas.clientHeight || 170;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (this.canvas.width !== Math.round(width * ratio)) {
        this.renderer!.setPixelRatio(ratio);
        this.renderer!.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
      this.renderer!.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Free the preview's WebGL context before the world starts. */
  public dispose(): void {
    this.stop();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
