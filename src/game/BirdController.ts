import {
  Euler,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { Pigeon } from './Pigeon';

const FORWARD = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);
const BIRD_CLEARANCE = 1.15;

interface Collision {
  point: Vector3;
  normal: Vector3;
  distance: number;
}

export interface FlightTelemetry {
  altitude: number;
  speedKmh: number;
  heading: string;
  state: 'FLYING' | 'PERCHED';
}

export type FlightControl = 'yawLeft' | 'yawRight' | 'pitchUp' | 'pitchDown' | 'accelerate' | 'decelerate';

export class BirdController {
  public readonly pigeon = new Pigeon();
  public readonly object = new Object3D();
  private readonly raycaster = new Raycaster();
  private readonly velocity = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly perchNormal = new Vector3(0, 1, 0);
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private targetRoll = 0;
  private speed = 26;
  private verticalVelocity = 0;
  private flapQueued = false;
  private perched = false;
  private enabled = false;
  private readonly controls: Record<FlightControl, boolean> = {
    yawLeft: false,
    yawRight: false,
    pitchUp: false,
    pitchDown: false,
    accelerate: false,
    decelerate: false,
  };

  public constructor() {
    this.object.add(this.pigeon.root);
    this.reset();
  }

  public reset(): void {
    this.object.position.set(0, 220, 320);
    this.yaw = 0;
    this.pitch = -0.03;
    this.roll = 0;
    this.speed = 26;
    this.verticalVelocity = 0;
    this.perched = false;
    this.flapQueued = false;
    this.applyOrientation();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public steer(deltaX: number, deltaY: number): void {
    if (!this.enabled) return;
    this.yaw -= deltaX * 0.0022;
    this.pitch = MathUtils.clamp(this.pitch - deltaY * 0.0018, -0.65, 0.58);
    this.targetRoll = MathUtils.clamp(-deltaX * 0.012, -0.62, 0.62);
  }

  public adjustSpeed(direction: number): void {
    if (!this.enabled) return;
    this.speed = MathUtils.clamp(this.speed + direction * 3.5, 9, 68);
  }

  public flap(): void {
    if (!this.enabled) return;
    this.flapQueued = true;
    this.pigeon.triggerFlap();
  }

  public loadVisual(): Promise<boolean> {
    return this.pigeon.loadModel();
  }

  public setControl(control: FlightControl, pressed: boolean): void {
    this.controls[control] = pressed;
  }

  public update(deltaSeconds: number, collisionRoot: Object3D | readonly Object3D[] | null): void {
    if (this.enabled) {
      const yawDirection = Number(this.controls.yawLeft) - Number(this.controls.yawRight);
      const pitchDirection = Number(this.controls.pitchUp) - Number(this.controls.pitchDown);
      const speedDirection = Number(this.controls.accelerate) - Number(this.controls.decelerate);
      this.yaw += yawDirection * 1.15 * deltaSeconds;
      this.pitch = MathUtils.clamp(this.pitch + pitchDirection * 0.72 * deltaSeconds, -0.65, 0.58);
      this.targetRoll = MathUtils.clamp(this.targetRoll + yawDirection * 0.85, -0.62, 0.62);
      this.speed = MathUtils.clamp(this.speed + speedDirection * 24 * deltaSeconds, 9, 68);
    }
    this.roll += (this.targetRoll - this.roll) * (1 - Math.exp(-5 * deltaSeconds));
    this.targetRoll *= Math.exp(-4 * deltaSeconds);
    this.applyOrientation();

    if (this.perched && this.flapQueued) {
      this.perched = false;
      this.object.position.addScaledVector(this.perchNormal, BIRD_CLEARANCE * 1.8);
      this.verticalVelocity = Math.max(10, this.perchNormal.y * 8);
    }

    if (this.perched) {
      this.flapQueued = false;
      this.velocity.set(0, 0, 0);
      this.pigeon.animate(deltaSeconds, 0, true);
      return;
    }

    const forward = FORWARD.clone().applyQuaternion(this.orientation).normalize();
    this.verticalVelocity -= 4.3 * deltaSeconds;
    if (this.flapQueued) this.verticalVelocity += 8.8;
    this.flapQueued = false;
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.velocity.y += this.verticalVelocity;
    const displacement = this.velocity.clone().multiplyScalar(deltaSeconds);
    const collision = this.findCollision(displacement, collisionRoot);

    if (collision) {
      this.object.position.copy(collision.point).addScaledVector(collision.normal, BIRD_CLEARANCE);
      this.perchNormal.copy(collision.normal);
      this.verticalVelocity = 0;
      this.velocity.set(0, 0, 0);
      this.perched = true;
    } else {
      this.object.position.add(displacement);
      if (this.object.position.y <= BIRD_CLEARANCE) {
        this.object.position.y = BIRD_CLEARANCE;
        this.perchNormal.copy(UP);
        this.verticalVelocity = 0;
        this.perched = true;
      }
    }

    this.pigeon.animate(deltaSeconds, this.speed, this.perched);
  }

  public updateCamera(camera: PerspectiveCamera, deltaSeconds: number): void {
    const offset = new Vector3(0, 5.2, 15.5).applyQuaternion(this.orientation);
    const desiredPosition = this.object.position.clone().add(offset);
    camera.position.lerp(desiredPosition, 1 - Math.exp(-7 * deltaSeconds));
    const lookTarget = this.object.position.clone().add(
      FORWARD.clone().applyQuaternion(this.orientation).multiplyScalar(18),
    );
    lookTarget.y += 1.1;
    camera.lookAt(lookTarget);
  }

  public getTelemetry(): FlightTelemetry {
    const degrees = (MathUtils.radToDeg(this.yaw) % 360 + 360) % 360;
    return {
      altitude: this.object.position.y,
      speedKmh: this.perched ? 0 : this.speed * 3.6,
      heading: headingFromDegrees(degrees),
      state: this.perched ? 'PERCHED' : 'FLYING',
    };
  }

  private applyOrientation(): void {
    this.euler.set(this.pitch, this.yaw, this.roll);
    this.orientation.setFromEuler(this.euler);
    this.object.quaternion.copy(this.orientation);
  }

  private findCollision(
    displacement: Vector3,
    collisionRoot: Object3D | readonly Object3D[] | null,
  ): Collision | null {
    if (!collisionRoot || displacement.lengthSq() < 0.000001) return null;
    const collisionRoots = Array.isArray(collisionRoot) ? collisionRoot : [collisionRoot];
    const direction = displacement.clone().normalize();
    const travelDistance = displacement.length() + BIRD_CLEARANCE;
    const offsets = [
      new Vector3(0, 0, 0),
      new Vector3(-0.8, 0, 0),
      new Vector3(0.8, 0, 0),
      new Vector3(0, 0.45, 0),
      new Vector3(0, -0.35, 0),
    ];
    let nearest: Collision | null = null;

    for (const localOffset of offsets) {
      const worldOffset = localOffset.applyQuaternion(this.orientation);
      const rayOrigin = this.object.position.clone().add(worldOffset);
      this.raycaster.set(rayOrigin, direction);
      this.raycaster.near = 0;
      this.raycaster.far = travelDistance;
      const hit = this.raycaster.intersectObjects(collisionRoots, true)[0];
      if (!hit?.face) continue;
      if (!nearest || hit.distance < nearest.distance) {
        nearest = {
          point: hit.point.clone().sub(worldOffset),
          normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize(),
          distance: hit.distance,
        };
      }
    }
    return nearest;
  }
}

function headingFromDegrees(degrees: number): string {
  const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return headings[Math.round(degrees / 45) % headings.length];
}
