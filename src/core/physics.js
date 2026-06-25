import RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../utils/constants.js';

/**
 * Builds a Rapier collision-group bitmask.
 * High 16 bits = which groups this collider belongs to.
 * Low 16 bits  = which groups it is allowed to collide with.
 */
export const makeGroups = (membership, filter) => ((membership << 16) | filter) >>> 0;

/**
 * Thin wrapper around the Rapier physics world. Owns the world, a kinematic
 * character controller for the player, and a handle→entity registry so that
 * raycast/collision results can be mapped back to game objects.
 */
export class Physics {
  /** Must be awaited once before any Physics instance is created (loads WASM). */
  static async load() {
    await RAPIER.init();
  }

  constructor(gravityY) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.world.timestep = 1 / 60;

    /** @type {Map<number, object>} rigidBody.handle -> entity */
    this.bodies = new Map();

    this.controller = null;
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** Advance the simulation by `dt` seconds. */
  step(dt) {
    this.world.timestep = dt;
    this.world.step();
  }

  // --- Registry --------------------------------------------------------------

  register(body, entity) {
    this.bodies.set(body.handle, entity);
    return body;
  }

  getEntity(handle) {
    return this.bodies.get(handle);
  }

  removeBody(body) {
    if (!body) return;
    this.bodies.delete(body.handle);
    this.world.removeRigidBody(body);
  }

  // --- Static world geometry -------------------------------------------------

  /** Fixed cuboid (walls, crates, obstacles). `half` is half-extents. */
  createFixedBox(pos, half, membership = GROUPS.WORLD, filter = 0xffff) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    );
    const collider = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    collider.setCollisionGroups(makeGroups(membership, filter));
    this.world.createCollider(collider, body);
    return body;
  }

  /** Large flat ground plane built from a thin cuboid. */
  createGround(size, y = 0) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, y - 0.5, 0)
    );
    const collider = RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2);
    collider.setCollisionGroups(makeGroups(GROUPS.WORLD, 0xffff));
    this.world.createCollider(collider, body);
    return body;
  }

  // --- Characters ------------------------------------------------------------

  /**
   * Kinematic capsule body used for the player and zombies. Movement is driven
   * manually through the character controller (player) or velocity (zombies).
   */
  createCapsule(pos, radius, halfHeight, membership, filter = 0xffff, kinematic = true) {
    const desc = kinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic();
    const body = this.world.createRigidBody(desc.setTranslation(pos.x, pos.y, pos.z));

    const collider = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    collider.setCollisionGroups(makeGroups(membership, filter));
    this.world.createCollider(collider, body);
    return body;
  }

  /** Lazily create the shared kinematic character controller. */
  getCharacterController() {
    if (!this.controller) {
      const offset = 0.08;
      this.controller = this.world.createCharacterController(offset);
      this.controller.enableAutostep(0.4, 0.2, true);
      this.controller.enableSnapToGround(0.4);
      this.controller.setApplyImpulsesToDynamicBodies(true);
      this.controller.setSlideEnabled(true);
      this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
      this.controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    }
    return this.controller;
  }

  /**
   * Move a kinematic capsule, resolving collisions against the world.
   * @returns {{movement: {x,y,z}, grounded: boolean}}
   */
  moveCharacter(body, collider, desired, filterGroups) {
    const controller = this.getCharacterController();
    controller.computeColliderMovement(collider, desired, undefined, filterGroups);
    const movement = controller.computedMovement();
    const grounded = controller.computedGrounded();

    const t = body.translation();
    body.setNextKinematicTranslation({
      x: t.x + movement.x,
      y: t.y + movement.y,
      z: t.z + movement.z,
    });
    return { movement, grounded };
  }

  // --- Queries ---------------------------------------------------------------

  /**
   * Cast a ray and return the first hit (used by hitscan weapons).
   * @returns {null | {point, normal, distance, collider, body, entity}}
   */
  raycast(origin, dir, maxDist, excludeCollider = null, filterGroups = undefined) {
    this._ray.origin = origin;
    this._ray.dir = dir;

    const hit = this.world.castRayAndGetNormal(
      this._ray,
      maxDist,
      true, // treat colliders as solid
      undefined,
      filterGroups,
      excludeCollider || undefined
    );
    if (!hit) return null;

    const collider = hit.collider;
    const body = collider.parent();
    const distance = hit.timeOfImpact;
    return {
      distance,
      collider,
      body,
      entity: body ? this.getEntity(body.handle) : undefined,
      point: {
        x: origin.x + dir.x * distance,
        y: origin.y + dir.y * distance,
        z: origin.z + dir.z * distance,
      },
      normal: hit.normal,
    };
  }

  dispose() {
    this.bodies.clear();
    this.world.free();
  }
}
