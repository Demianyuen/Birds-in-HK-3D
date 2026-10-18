import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { RaceCourse } from './course';

const NEXT = new Color('#ffcc33');
const LATER = new Color('#7fd6ff');
const DONE = new Color('#8a8f96');

/** Visual checkpoint rings plus a guide arrow that floats ahead of the bird. */
export class RaceRings {
  public readonly group = new Group();
  public readonly arrow = new Group();
  private readonly rings: Array<{ frame: Mesh; glow: Mesh; material: MeshStandardMaterial; glowMaterial: MeshBasicMaterial }> = [];
  private nextIndex = 0;
  private elapsed = 0;
  private readonly arrowMaterial = new MeshStandardMaterial({
    color: '#ffcc33', emissive: '#ffb300', emissiveIntensity: 0.9, roughness: 0.4,
  });

  public constructor() {
    this.group.name = 'Race rings';
    this.group.visible = false;
    const cone = new Mesh(new ConeGeometry(0.55, 1.6, 12), this.arrowMaterial);
    cone.rotation.x = -Math.PI / 2;
    this.arrow.add(cone);
    this.arrow.visible = false;
  }

  public setCourse(course: RaceCourse | null): void {
    for (const ring of this.rings) {
      ring.frame.geometry.dispose();
      ring.glow.geometry.dispose();
      ring.material.dispose();
      ring.glowMaterial.dispose();
    }
    this.rings.length = 0;
    this.group.clear();
    if (!course) { this.group.visible = false; this.arrow.visible = false; return; }
    course.rings.forEach((ring, index) => {
      const material = new MeshStandardMaterial({
        color: LATER, emissive: LATER, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.1,
      });
      const frame = new Mesh(new TorusGeometry(ring.radius, Math.max(0.9, ring.radius * 0.06), 12, 48), material);
      const glowMaterial = new MeshBasicMaterial({
        color: LATER, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false, blending: AdditiveBlending,
      });
      const glow = new Mesh(new RingGeometry(ring.radius * 0.15, ring.radius * 0.97, 48), glowMaterial);
      frame.position.fromArray(ring.position);
      glow.position.fromArray(ring.position);
      // Face each ring along the course direction.
      const from = new Vector3().fromArray(index === 0 ? course.start.position : course.rings[index - 1].position);
      const to = new Vector3().fromArray(course.rings[Math.min(course.rings.length - 1, index + 1)].position);
      const forward = to.sub(from).setY(0).normalize();
      if (forward.lengthSq() > 0) {
        const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), forward);
        frame.quaternion.copy(orientation);
        glow.quaternion.copy(orientation);
      }
      frame.name = `Race ring ${index + 1}`;
      this.group.add(frame, glow);
      this.rings.push({ frame, glow, material, glowMaterial });
    });
    this.group.visible = true;
    this.setProgress(0);
  }

  public setProgress(nextIndex: number): void {
    this.nextIndex = nextIndex;
    this.rings.forEach((ring, index) => {
      const colour = index < nextIndex ? DONE : index === nextIndex ? NEXT : LATER;
      ring.material.color.copy(colour);
      ring.material.emissive.copy(colour);
      ring.material.emissiveIntensity = index < nextIndex ? 0.05 : index === nextIndex ? 1.25 : 0.45;
      ring.glowMaterial.color.copy(colour);
      ring.glowMaterial.opacity = index < nextIndex ? 0 : index === nextIndex ? 0.28 : 0.1;
      ring.frame.visible = index >= nextIndex - 1;
      ring.glow.visible = index >= nextIndex;
    });
  }

  public update(deltaSeconds: number, birdPosition: Vector3, showArrow: boolean): void {
    this.elapsed += deltaSeconds;
    const next = this.rings[this.nextIndex];
    if (next) {
      const pulse = 1 + Math.sin(this.elapsed * 5) * 0.04;
      next.frame.scale.setScalar(pulse);
    }
    this.arrow.visible = showArrow && !!next;
    if (!next) return;
    const target = next.frame.position;
    const direction = new Vector3().subVectors(target, birdPosition);
    const distance = direction.length();
    direction.normalize();
    this.arrow.position.copy(birdPosition).addScaledVector(direction, 4.5).add(new Vector3(0, 1.6, 0));
    this.arrow.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), direction);
    this.arrowMaterial.emissiveIntensity = distance < 60 ? 1.4 : 0.9;
  }

  public distanceToNext(birdPosition: Vector3): number | null {
    const next = this.rings[this.nextIndex];
    return next ? next.frame.position.distanceTo(birdPosition) : null;
  }
}
