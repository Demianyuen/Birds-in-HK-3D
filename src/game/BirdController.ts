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
/**
 * On the ground the bird shrinks to life size: the flight rig is drawn about
 * 4.5× larger than a real pigeon (≈0.33 m long) so it reads from the chase camera.
 */
export const WALK_SCALE = 0.22;
/** Walking and running speeds on the ground (m/s). */
const WALK_SPEED = 1.4;
const RUN_SPEED = 3.2;
/** Highest kerb or step the bird hops up while walking (m). */
const STEP_UP = 0.45;
/** Walking off a drop deeper than this starts flight (m). */
const WALK_OFF_DROP = 0.9;
/** Ground steeper than this (normal.y) blocks walking like a wall. */
const WALKABLE_NORMAL_Y = 0.55;
/** Body radius kept clear of walls while walking (m). */
const WALK_RADIUS = 0.16;

interface Collision {
  point: Vector3;
  normal: Vector3;
  distance: number;
}

export interface FlightTelemetry {
  altitude: number;
  speedKmh: number;
  heading: string;
  state: 'FLYING' | 'PERCHED' | 'WALKING';
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
  /** Current size relative to the flight rig (1 in the air, WALK_SCALE on the ground). */
  private sizeScale = 1;
  /** Height of the surface under the feet while on the ground. */
  private groundY = 0;
  /** Signed walking speed (m/s); negative walks backwards. */
  private walkSpeed = 0;
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
    this.walkSpeed = 0;
    this.setSize(1);
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
    if (this.perched) {
      this.standUpright();
      this.groundY = this.object.position.y - BIRD_CLEARANCE;
    }
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

  /** Where the feet are while on the ground (null in the air). */
  public get groundPoint(): Vector3 | null {
    return this.perched ? new Vector3(this.object.position.x, this.groundY, this.object.position.z) : null;
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
      this.walkSpeed = 0;
      this.object.position.addScaledVector(this.perchNormal, BIRD_CLEARANCE * this.sizeScale * 0.9);
      this.verticalVelocity = Math.max(7.5, this.perchNormal.y * 7.5);
      this.speed = this.flightProfile.minimumSpeed + 3;
      this.takeoffTimer = 1.1;
      this.flareTimer = 0;
    }

    if (this.perched) {
      this.flapQueued = false;
      this.updateGround(deltaSeconds, collisionRoot);
      if (this.perched) return;
    }

    // Grow back to flight size after leaving the ground.
    this.setSize(this.sizeScale + (1 - this.sizeScale) * (1 - Math.exp(-4 * deltaSeconds)));
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
      this.groundY = collision.point.y;
      this.perch(collision.normal);
    } else if (collision) {
      this.slideAlongWall(collision, forward, displacement);
    } else {
      this.object.position.add(displacement);
      this.keepInsideFlightRegion();
      if (this.object.position.y <= BIRD_CLEARANCE) {
        this.object.position.y = BIRD_CLEARANCE;
        this.groundY = 0;
        this.perch(UP);
      } else if (this.frameIndex % 2 === 0) {
        this.lookForLandingSpot(collisionRoot);
      }
    }

    this.rig.update(deltaSeconds, this.motion(forward, deltaSeconds));
  }

  /**
   * On the ground: shrink to life size, walk with forward/back (W/S), turn with
   * A/D or the mouse, run with Shift. Kerbs and steps are hopped up, walls are
   * slid along, and walking off a ledge glides away into flight.
   */
  private updateGround(deltaSeconds: number, collisionRoot: Object3D | readonly Object3D[] | null): void {
    this.setSize(this.sizeScale + (WALK_SCALE - this.sizeScale) * (1 - Math.exp(-5 * deltaSeconds)));
    const input = this.enabled ? Number(this.controls.pitchUp) - Number(this.controls.pitchDown) : 0;
    const top = this.controls.accelerate ? RUN_SPEED : WALK_SPEED;
    const target = input > 0 ? top : input < 0 ? -WALK_SPEED * 0.5 : 0;
    this.walkSpeed += (target - this.walkSpeed) * (1 - Math.exp(-9 * deltaSeconds));
    if (Math.abs(this.walkSpeed) < 0.02 && target === 0) this.walkSpeed = 0;

    if (this.walkSpeed !== 0) {
      const heading = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.walk(heading.multiplyScalar(this.walkSpeed * deltaSeconds), collisionRoot);
    }
    if (this.perched) {
      this.object.position.y = this.groundY + BIRD_CLEARANCE * this.sizeScale;
      this.velocity.set(0, 0, 0);
      const pace = Math.abs(this.walkSpeed) / RUN_SPEED;
      this.rig.update(deltaSeconds, pace > 0.015
        ? { mode: 'walk', flapDemand: 0, walkPace: pace }
        : { mode: 'perched', flapDemand: 0 });
    }
  }

  private walk(step: Vector3, collisionRoot: Object3D | readonly Object3D[] | null): void {
    const roots: Object3D[] = !collisionRoot ? [] : Array.isArray(collisionRoot) ? [...collisionRoot] : [collisionRoot as Object3D];
    const feet = new Vector3(this.object.position.x, this.groundY, this.object.position.z);
    // Walls: remove the part of the step that goes into them, keep the rest (slide).
    for (let pass = 0; pass < 2 && step.lengthSq() > 1e-10; pass += 1) {
      const wall = this.findWalkingWall(feet, step, roots);
      if (!wall) break;
      step.addScaledVector(wall, -step.dot(wall));
    }
    if (step.lengthSq() < 1e-10) return;
    const next = feet.clone().add(step);
    if (roots.length === 0) {
      this.object.position.x = next.x;
      this.object.position.z = next.z;
      return;
    }
    // Ground under the next foothold: step up kerbs, refuse cliffs, fall off ledges into flight.
    this.raycaster.set(new Vector3(next.x, this.groundY + STEP_UP + 0.05, next.z), new Vector3(0, -1, 0));
    this.raycaster.near = 0;
    this.raycaster.far = STEP_UP + 60;
    const ground = this.raycaster.intersectObjects(roots, true)[0];
    const groundNormal = ground?.face?.normal.clone().transformDirection(ground.object.matrixWorld);
    if (ground && groundNormal && groundNormal.y < WALKABLE_NORMAL_Y && ground.point.y > this.groundY - WALK_OFF_DROP) return;
    if (!ground || this.groundY - ground.point.y > WALK_OFF_DROP) {
      this.object.position.x = next.x;
      this.object.position.z = next.z;
      this.walkOffLedge();
      return;
    }
    this.groundY = ground.point.y;
    if (groundNormal) this.perchNormal.copy(groundNormal);
    this.object.position.set(next.x, this.groundY + BIRD_CLEARANCE * this.sizeScale, next.z);
  }

  /** Nearest steep surface in the walking direction, as a horizontal wall normal. */
  private findWalkingWall(feet: Vector3, step: Vector3, roots: Object3D[]): Vector3 | null {
    if (roots.length === 0) return null;
    const direction = step.clone().normalize();
    const reach = step.length() + WALK_RADIUS;
    let nearest: { distance: number; normal: Vector3 } | null = null;
    for (const height of [STEP_UP + 0.05, 0.3 + STEP_UP]) {
      this.raycaster.set(feet.clone().setY(feet.y + height), direction);
      this.raycaster.near = 0;
      this.raycaster.far = reach;
      const hit = this.raycaster.intersectObjects(roots, true)[0];
      if (!hit?.face) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.y >= WALKABLE_NORMAL_Y) continue;
      const horizontal = new Vector3(normal.x, 0, normal.z);
      if (horizontal.lengthSq() < 1e-6) horizontal.copy(direction).negate();
      if (!nearest || hit.distance < nearest.distance) nearest = { distance: hit.distance, normal: horizontal.normalize() };
    }
    return nearest?.normal ?? null;
  }

  private walkOffLedge(): void {
    this.perched = false;
    this.walkSpeed = 0;
    this.verticalVelocity = 0;
    this.speed = this.flightProfile.minimumSpeed;
    this.pitch = -0.12;
    this.takeoffTimer = 0.7;
    this.flareTimer = 0;
    this.applyOrientation();
    this.rig.triggerFlap();
  }

  /**
   * Walls in flight: keep only the motion along the wall and turn to follow it,
   * instead of bouncing back. A head-on hit stalls gently against the wall.
   */
  private slideAlongWall(collision: Collision, forward: Vector3, displacement: Vector3): void {
    const wall = new Vector3(collision.normal.x, 0, collision.normal.z);
    if (wall.lengthSq() < 1e-6) wall.copy(forward).setY(0).negate();
    wall.normalize();
    // Rest just off the surface at the point of contact.
    this.object.position.copy(collision.point).addScaledVector(wall, BIRD_CLEARANCE * this.sizeScale + 0.05);
    const heading = new Vector3(forward.x, 0, forward.z);
    if (heading.lengthSq() < 1e-6) heading.copy(wall).negate();
    heading.normalize();
    const into = heading.dot(wall);
    const tangent = heading.clone().addScaledVector(wall, -Math.min(0, into));
    const along = tangent.length();
    if (along > 1e-3) tangent.divideScalar(along);
    else tangent.set(-wall.z, 0, wall.x);
    // Head-on: pick the side the bird was already leaning towards.
    if (along < 0.25) {
      const side = Math.sign(this.roll || this.targetRoll || 1);
      tangent.set(-wall.z * side, 0, wall.x * side);
    }
    this.yaw += shortestAngleDelta(this.yaw, Math.atan2(-tangent.x, -tangent.z));
    // Lose only the into-wall share of the speed.
    this.speed = Math.max(this.flightProfile.minimumSpeed, this.speed * (0.35 + 0.65 * Math.min(1, along)));
    // Carry on along the wall with what is left of this frame's movement.
    const remaining = displacement.length() - collision.distance;
    if (remaining > 0) {
      const slide = tangent.clone().multiplyScalar(remaining * Math.min(1, along));
      slide.y = displacement.y * Math.max(0, 1 - collision.distance / Math.max(1e-6, displacement.length()));
      this.object.position.add(slide);
    }
    this.targetRoll = MathUtils.clamp(-into * 0.5 * Math.sign(this.roll || 1), -0.45, 0.45);
    this.bumpAge = along < 0.25 ? 0.2 : 10;
    this.flareTimer = 0;
    this.applyOrientation();
  }

  private setSize(scale: number): void {
    this.sizeScale = Math.abs(scale - 1) < 1e-3 ? 1 : scale;
    this.object.scale.setScalar(this.sizeScale);
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
    // On the ground the bird is life-size, so the camera comes down to a pigeon's-eye view.
    const ground = MathUtils.clamp((1 - this.sizeScale) / (1 - WALK_SCALE), 0, 1);
    const offset = new Vector3(
      0,
      MathUtils.lerp(5.2 - this.cameraPerch * 2.4, 0.62, ground),
      MathUtils.lerp(15.5 - this.cameraPerch * 6, 2.1, ground),
    ).applyQuaternion(this.orientation);
    const pivot = this.object.position.clone();
    pivot.y += MathUtils.lerp(1.2, 0.22, ground);
    const boom = this.object.position.clone().add(offset).sub(pivot);
    const boomLength = boom.length();
    // Keep the camera out of buildings: shorten the boom to just short of the first surface behind the bird.
    let reach = 1;
    if (this.cameraRoots.length > 0 && boomLength > 0.01) {
      this.cameraRay.set(pivot, boom.clone().divideScalar(boomLength));
      this.cameraRay.near = 0;
      this.cameraRay.far = boomLength + 1;
      const hit = this.cameraRay.intersectObjects(this.cameraRoots, true)[0];
      const margin = MathUtils.lerp(1, 0.15, ground);
      if (hit) reach = MathUtils.clamp((hit.distance - margin) / boomLength, 0.12, 1);
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
      FORWARD.clone().applyQuaternion(this.orientation).multiplyScalar(MathUtils.lerp(18, 3.5, ground)),
    );
    lookTarget.y += MathUtils.lerp(1.1, 0.18, ground);
    camera.lookAt(lookTarget);
  }

  public getTelemetry(): FlightTelemetry {
    // Local +Y rotation turns -Z north towards -X west; compass bearings increase eastwards.
    const degrees = (-MathUtils.radToDeg(this.yaw) % 360 + 360) % 360;
    return {
      altitude: this.object.position.y,
      speedKmh: this.perched ? Math.abs(this.walkSpeed) * 3.6 : this.speed * 3.6,
      heading: headingFromDegrees(degrees),
      state: !this.perched ? 'FLYING' : Math.abs(this.walkSpeed) > 0.05 ? 'WALKING' : 'PERCHED',
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
