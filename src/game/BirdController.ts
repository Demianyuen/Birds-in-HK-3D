import {
  Euler,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { BirdRig, type BirdMotion } from './BirdRig';
import { getBirdProfile, type BirdProfile, type BirdProfileId } from './birdProfiles';
import type { WorldPlayer } from '../multiplayer/protocol';

const FORWARD = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);
const BIRD_CLEARANCE = 1.15;
/** Equilibrium sink rate while gliding (m/s); flaps push above it. */
const GLIDE_SINK = -1.4;
/** Fraction of gravity converted between height and speed when climbing or diving. */
const ENERGY_EXCHANGE = 0.55;
/** Surfaces flatter than this (normal.y) are landing spots; steeper ones are walls. */
const LANDING_NORMAL_Y = 0.62;
/** Seconds of look-ahead used to start a landing flare before touchdown. */
const FLARE_LOOKAHEAD_SECONDS = 1.0;

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
  public readonly rig = new BirdRig();
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
  /** Seconds left in the current landing flare (refreshed while a landing spot is ahead). */
  private flareTimer = 0;
  /** Seconds of strong flapping after leaving a perch. */
  private takeoffTimer = 0;
  /** Drives the pigeon-style flap-glide rhythm in level flight. */
  private rhythmClock = 0;
  private frameIndex = 0;
  private cameraPerch = 0;
  /** Fraction (0–1) of the full camera boom currently free of buildings. */
  private cameraReach = 1;
  private cameraRoots: Object3D[] = [];
  private readonly cameraRay = new Raycaster();
  private clockSeconds = 0;
  private lastMouseSteer = -10;
  /** Seconds since the last wall bump; drives camera shake. */
  public bumpAge = 10;
  private flightRadiusMetres = Number.POSITIVE_INFINITY;
  private flightProfile: BirdProfile = getBirdProfile('pigeon');
  private readonly controls: Record<FlightControl, boolean> = {
    yawLeft: false,
    yawRight: false,
    pitchUp: false,
    pitchDown: false,
    accelerate: false,
    decelerate: false,
  };

  public constructor() {
    this.object.add(this.rig.root);
    this.reset();
  }

  public reset(): void {
    this.object.position.set(0, 220, 320);
    this.yaw = 0;
    this.pitch = -0.03;
    this.roll = 0;
    this.speed = this.flightProfile.cruiseSpeed;
    this.verticalVelocity = 0;
    this.perched = false;
    this.flapQueued = false;
    this.flareTimer = 0;
    this.takeoffTimer = 0;
    for (const control of Object.keys(this.controls) as FlightControl[]) {
      this.controls[control] = false;
    }
    this.applyOrientation();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public restoreSessionPose(player: WorldPlayer): void {
    this.reset();
    this.object.position.fromArray(player.position);
    this.orientation.fromArray(player.quaternion).normalize();
    this.euler.setFromQuaternion(this.orientation, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
    this.roll = this.euler.z;
    this.perched = player.perched;
    if (this.perched) this.standUpright();
    this.applyOrientation();
  }

  public setFlightRadius(radiusMetres: number): void {
    this.flightRadiusMetres = radiusMetres > 0 ? radiusMetres : Number.POSITIVE_INFINITY;
  }

  public setBirdProfile(profileId: BirdProfileId): void {
    this.flightProfile = getBirdProfile(profileId);
    this.rig.setProfile(this.flightProfile.id);
    this.speed = this.flightProfile.cruiseSpeed;
  }

  public get profileId(): BirdProfileId {
    return this.flightProfile.id;
  }

  public steer(deltaX: number, deltaY: number): void {
    if (!this.enabled) return;
    this.yaw -= deltaX * 0.0022;
    this.pitch = MathUtils.clamp(this.pitch - deltaY * 0.0018, -0.65, 0.58);
    this.lastMouseSteer = this.clockSeconds;
    this.targetRoll = MathUtils.clamp(-deltaX * 0.012, -0.62, 0.62);
  }

  public adjustSpeed(direction: number): void {
    if (!this.enabled) return;
    this.speed = MathUtils.clamp(this.speed + direction * 3.5, this.flightProfile.minimumSpeed, this.flightProfile.maximumSpeed);
  }

  public flap(): void {
    if (!this.enabled) return;
    this.flapQueued = true;
    this.rig.triggerFlap();
  }

  /** The bird is procedural (BirdRig), so it is always ready; kept async for the loading flow. */
  public loadVisual(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** True while the bird is flaring to land. */
  public get landing(): boolean {
    return this.flareTimer > 0 && !this.perched;
  }

  public setControl(control: FlightControl, pressed: boolean): void {
    this.controls[control] = pressed;
  }

  public update(deltaSeconds: number, collisionRoot: Object3D | readonly Object3D[] | null): void {
    this.clockSeconds += deltaSeconds;
    this.bumpAge += deltaSeconds;
    this.frameIndex += 1;
    this.cameraRoots = !collisionRoot ? [] : Array.isArray(collisionRoot) ? [...collisionRoot] : [collisionRoot as Object3D];
    if (this.enabled) {
      const yawDirection = Number(this.controls.yawLeft) - Number(this.controls.yawRight);
      const pitchDirection = Number(this.controls.pitchUp) - Number(this.controls.pitchDown);
      const speedDirection = Number(this.controls.accelerate) - Number(this.controls.decelerate);
      // Perched birds shuffle round on the spot more slowly than they bank in the air.
      this.yaw += yawDirection * this.flightProfile.turnRate * (this.perched ? 0.8 : 1) * deltaSeconds;
      if (!this.perched) {
        this.pitch = MathUtils.clamp(this.pitch + pitchDirection * 0.72 * deltaSeconds, -0.65, 0.58);
        this.targetRoll = MathUtils.clamp(this.targetRoll + yawDirection * 0.85, -0.62, 0.62);
        this.speed += speedDirection * 24 * deltaSeconds;
        if (speedDirection === 0 && this.flareTimer <= 0) {
          // Ease back towards cruise speed when the player is not throttling.
          this.speed += (this.flightProfile.cruiseSpeed - this.speed) * (1 - Math.exp(-0.3 * deltaSeconds));
        }
        if (pitchDirection === 0 && this.clockSeconds - this.lastMouseSteer > 0.8) {
          // Gentle auto-level so keyboard flight is forgiving.
          this.pitch *= Math.exp(-0.9 * deltaSeconds);
        }
        // Throttling up aborts a landing.
        if (this.controls.accelerate) this.flareTimer = 0;
      }
    }
    if (this.perched) this.standUpright();
    this.roll += (this.targetRoll - this.roll) * (1 - Math.exp(-5 * deltaSeconds));
    this.targetRoll *= Math.exp(-4 * deltaSeconds);
    this.applyOrientation();

    if (this.perched && this.flapQueued) {
      // Take-off: spring up and away with strong strokes, starting slow.
      this.perched = false;
      this.object.position.addScaledVector(this.perchNormal, BIRD_CLEARANCE * 0.9);
      this.verticalVelocity = Math.max(7.5, this.perchNormal.y * 7.5);
      this.speed = this.flightProfile.minimumSpeed + 3;
      this.takeoffTimer = 1.1;
      this.flareTimer = 0;
    }

    if (this.perched) {
      this.flapQueued = false;
      this.velocity.set(0, 0, 0);
      this.rig.update(deltaSeconds, { mode: 'perched', flapDemand: 0 });
      return;
    }

    this.takeoffTimer = Math.max(0, this.takeoffTimer - deltaSeconds);
    const forward = FORWARD.clone().applyQuaternion(this.orientation).normalize();
    // Arcade glide: climbing trades speed for height, diving trades height for speed.
    this.speed -= forward.y * 9.8 * ENERGY_EXCHANGE * deltaSeconds;
    const flaring = this.flareTimer > 0;
    if (flaring) {
      // Air-brake towards a slow, controlled touchdown.
      this.flareTimer = Math.max(0, this.flareTimer - deltaSeconds);
      this.speed += (this.flightProfile.minimumSpeed * 0.65 - this.speed) * (1 - Math.exp(-2.6 * deltaSeconds));
    }
    const minimumSpeed = flaring ? this.flightProfile.minimumSpeed * 0.6 : this.flightProfile.minimumSpeed;
    this.speed = MathUtils.clamp(this.speed, minimumSpeed, this.flightProfile.maximumSpeed);
    const sink = flaring ? GLIDE_SINK * 0.8 : GLIDE_SINK;
    this.verticalVelocity += (sink - this.verticalVelocity) * (1 - Math.exp(-1.6 * deltaSeconds));
    if (this.flapQueued) {
      this.verticalVelocity += this.flightProfile.flapLift;
      this.speed = Math.min(this.flightProfile.maximumSpeed, this.speed + 2.2);
      this.flareTimer = 0;
    }
    this.flapQueued = false;
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.velocity.y += this.verticalVelocity;
    const displacement = this.velocity.clone().multiplyScalar(deltaSeconds);
    const collision = this.findCollision(displacement, collisionRoot);

    if (collision && collision.normal.y >= LANDING_NORMAL_Y) {
      // Roofs and ground: settle upright on the perch.
      this.object.position.copy(collision.point).addScaledVector(collision.normal, BIRD_CLEARANCE);
      this.perch(collision.normal);
    } else if (collision) {
      // Walls: glance off and lose speed instead of stopping dead.
      const wall = new Vector3(collision.normal.x, 0, collision.normal.z);
      if (wall.lengthSq() < 1e-6) wall.copy(forward).setY(0).negate();
      wall.normalize();
      this.object.position.copy(collision.point).addScaledVector(wall, BIRD_CLEARANCE + 0.6);
      const heading = new Vector3(forward.x, 0, forward.z).normalize();
      const along = heading.dot(wall);
      if (along < 0) heading.addScaledVector(wall, -2 * along).normalize();
      this.yaw = Math.atan2(-heading.x, -heading.z);
      this.speed = Math.max(this.flightProfile.minimumSpeed, this.speed * 0.55);
      this.verticalVelocity = Math.max(this.verticalVelocity, 1.5);
      this.targetRoll = MathUtils.clamp(-along * 0.8, -0.62, 0.62);
      this.bumpAge = 0;
      this.flareTimer = 0;
      this.applyOrientation();
    } else {
      this.object.position.add(displacement);
      this.keepInsideFlightRegion();
      if (this.object.position.y <= BIRD_CLEARANCE) {
        this.object.position.y = BIRD_CLEARANCE;
        this.perch(UP);
      } else if (this.frameIndex % 2 === 0) {
        this.lookForLandingSpot(collisionRoot);
      }
    }

    this.rig.update(deltaSeconds, this.motion(forward, deltaSeconds));
  }

  /** Animation intent: pigeons alternate bursts of flapping with glides; climbing, slow flight and take-off flap hard. */
  private motion(forward: Vector3, deltaSeconds: number): BirdMotion {
    if (this.perched) return { mode: 'perched', flapDemand: 0 };
    if (this.flareTimer > 0) return { mode: 'flare', flapDemand: 0 };
    const soaring = this.flightProfile.id === 'eagle';
    this.rhythmClock += deltaSeconds;
    let demand = 0;
    if (this.takeoffTimer > 0) demand = 1;
    else if (forward.y < -0.12 || this.controls.decelerate) demand = 0;
    else {
      if (forward.y > 0.08) demand = Math.max(demand, 0.45 + forward.y);
      if (this.speed < this.flightProfile.cruiseSpeed * 0.85) demand = Math.max(demand, 0.6);
      if (this.controls.accelerate) demand = Math.max(demand, 0.8);
      // Intermittent flight: a short burst of strokes every few seconds, then a glide.
      const period = soaring ? 7.5 : 3.8;
      const burst = soaring ? 0.9 : 1.4;
      if (this.rhythmClock % period < burst) demand = Math.max(demand, 0.45);
    }
    return { mode: 'flight', flapDemand: soaring ? demand * 0.7 : demand };
  }

  private perch(normal: Vector3): void {
    this.perchNormal.copy(normal);
    this.verticalVelocity = 0;
    this.velocity.set(0, 0, 0);
    this.perched = true;
    this.flareTimer = 0;
    this.takeoffTimer = 0;
    this.standUpright();
    this.applyOrientation();
  }

  /** Perched birds stand level whatever attitude they landed in. */
  private standUpright(): void {
    this.pitch = 0;
    this.roll = 0;
    this.targetRoll = 0;
  }

  /** Starts a landing flare when the flight path will meet a roof or the ground within about a second. */
  private lookForLandingSpot(collisionRoot: Object3D | readonly Object3D[] | null): void {
    if (!collisionRoot || this.velocity.y > 0.5 || this.speed < 1) return;
    const roots = Array.isArray(collisionRoot) ? collisionRoot : [collisionRoot];
    const direction = this.velocity.clone().normalize();
    this.raycaster.set(this.object.position, direction);
    this.raycaster.near = 0;
    this.raycaster.far = Math.max(10, this.velocity.length() * FLARE_LOOKAHEAD_SECONDS) + BIRD_CLEARANCE;
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    if (!hit?.face) return;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.y >= LANDING_NORMAL_Y) this.flareTimer = 0.6;
  }

  public updateCamera(camera: PerspectiveCamera, deltaSeconds: number): void {
    this.cameraPerch += ((this.perched ? 1 : 0) - this.cameraPerch) * (1 - Math.exp(-2.5 * deltaSeconds));
    const offset = new Vector3(0, 5.2 - this.cameraPerch * 2.4, 15.5 - this.cameraPerch * 6).applyQuaternion(this.orientation);
    const pivot = this.object.position.clone();
    pivot.y += 1.2;
    const boom = this.object.position.clone().add(offset).sub(pivot);
    const boomLength = boom.length();
    // Keep the camera out of buildings: shorten the boom to just short of the first surface behind the bird.
    let reach = 1;
    if (this.cameraRoots.length > 0 && boomLength > 0.01) {
      this.cameraRay.set(pivot, boom.clone().divideScalar(boomLength));
      this.cameraRay.near = 0;
      this.cameraRay.far = boomLength + 1;
      const hit = this.cameraRay.intersectObjects(this.cameraRoots, true)[0];
      if (hit) reach = MathUtils.clamp((hit.distance - 1) / boomLength, 0.12, 1);
    }
    // Pull in at once when blocked, ease back out when clear.
    this.cameraReach = reach < this.cameraReach
      ? reach
      : this.cameraReach + (reach - this.cameraReach) * (1 - Math.exp(-2 * deltaSeconds));
    const desiredPosition = pivot.addScaledVector(boom, this.cameraReach);
    if (this.bumpAge < 0.35) {
      const shake = (0.35 - this.bumpAge) * 2.2;
      desiredPosition.x += Math.sin(this.clockSeconds * 71) * shake;
      desiredPosition.y += Math.cos(this.clockSeconds * 53) * shake;
    }
    // Never lerp through a wall: snap while the boom is shortened.
    if (this.cameraReach < 0.999) camera.position.copy(desiredPosition);
    else camera.position.lerp(desiredPosition, 1 - Math.exp(-7 * deltaSeconds));
    const lookTarget = this.object.position.clone().add(
      FORWARD.clone().applyQuaternion(this.orientation).multiplyScalar(18),
    );
    lookTarget.y += 1.1;
    camera.lookAt(lookTarget);
  }

  public getTelemetry(): FlightTelemetry {
    // Local +Y rotation turns -Z north towards -X west; compass bearings increase eastwards.
    const degrees = (-MathUtils.radToDeg(this.yaw) % 360 + 360) % 360;
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

  private keepInsideFlightRegion(): void {
    const horizontalDistance = Math.hypot(this.object.position.x, this.object.position.z);
    if (horizontalDistance <= this.flightRadiusMetres) return;

    const scale = this.flightRadiusMetres / horizontalDistance;
    this.object.position.x *= scale;
    this.object.position.z *= scale;
    const inwardYaw = Math.atan2(this.object.position.x, this.object.position.z);
    this.yaw += shortestAngleDelta(this.yaw, inwardYaw) * 0.35;
    this.targetRoll = MathUtils.clamp(shortestAngleDelta(this.yaw, inwardYaw), -0.45, 0.45);
    this.applyOrientation();
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

function shortestAngleDelta(from: number, to: number): number {
  return MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

function headingFromDegrees(degrees: number): string {
  const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return headings[Math.round(degrees / 45) % headings.length];
}
