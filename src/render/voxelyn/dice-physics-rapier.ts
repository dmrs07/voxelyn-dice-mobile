export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface DicePhysicsPose {
  position: Vec3Like;
  rotation: QuatLike;
  sleeping: boolean;
}

interface BodyState {
  body: any;
  settleTarget: QuatLike | null;
  settleDeadlineMs: number;
  settled: boolean;
}

const TRAY_HALF_X = 1.92;
const TRAY_HALF_Z = 1.92;
const TRAY_WALL_CENTER = 2.12;
const TRAY_WALL_HALF = 2.12;
const SETTLE_BLEND_WINDOW_MS = 340;

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const normalizeQuat = (q: QuatLike): QuatLike => {
  const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (lenSq <= 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return {
    x: q.x * invLen,
    y: q.y * invLen,
    z: q.z * invLen,
    w: q.w * invLen,
  };
};

const slerpQuat = (from: QuatLike, to: QuatLike, t: number): QuatLike => {
  const clamped = Math.max(0, Math.min(1, t));
  let dot = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w;
  let end = to;
  if (dot < 0) {
    dot = -dot;
    end = { x: -to.x, y: -to.y, z: -to.z, w: -to.w };
  }

  if (dot > 0.9995) {
    return normalizeQuat({
      x: from.x + clamped * (end.x - from.x),
      y: from.y + clamped * (end.y - from.y),
      z: from.z + clamped * (end.z - from.z),
      w: from.w + clamped * (end.w - from.w),
    });
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const scaleA = Math.sin((1 - clamped) * theta) / sinTheta;
  const scaleB = Math.sin(clamped * theta) / sinTheta;
  return normalizeQuat({
    x: from.x * scaleA + end.x * scaleB,
    y: from.y * scaleA + end.y * scaleB,
    z: from.z * scaleA + end.z * scaleB,
    w: from.w * scaleA + end.w * scaleB,
  });
};

const spawnSlot = (ordinal: number, totalDice: number): { x: number; z: number } => {
  const count = Math.max(1, totalDice);
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const col = ordinal % cols;
  const row = Math.floor(ordinal / cols);

  const spacing = count >= 8 ? 0.58 : count >= 6 ? 0.64 : count >= 4 ? 0.72 : 0.82;
  const x = (col - (cols - 1) * 0.5) * spacing;
  const z = (row - (rows - 1) * 0.5) * spacing;
  return { x, z };
};

export class DicePhysicsRapier {
  private rapier: any = null;

  private world: any = null;

  private readonly bodies = new Map<string, BodyState>();

  private state: 'idle' | 'pending' | 'ready' | 'failed' = 'idle';

  private initPromise: Promise<boolean> | null = null;

  public async ensureReady(): Promise<boolean> {
    if (this.state === 'ready') {
      return true;
    }
    if (this.state === 'failed') {
      return false;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.state = 'pending';
    this.initPromise = import('@dimforge/rapier3d-compat')
      .then((mod) => {
        const rapierModule = (mod as Record<string, unknown>).default ?? mod;
        const rapierAny = rapierModule as any;
        if (typeof rapierAny.init === 'function') {
          return this.initializeRapier(rapierAny).then(() => rapierAny);
        }
        return rapierAny;
      })
      .then((rapierAny) => {
        this.rapier = rapierAny;
        this.createWorld();
        this.state = 'ready';
        return true;
      })
      .catch((error) => {
        console.warn('[dice-physics-rapier] Falha ao iniciar Rapier.', error);
        this.state = 'failed';
        return false;
      });

    return this.initPromise;
  }

  private async initializeRapier(rapierAny: { init: (options?: unknown) => Promise<unknown> | unknown }): Promise<void> {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]): void => {
      const first = args[0];
      if (
        typeof first === 'string' &&
        first.includes('deprecated parameters for the initialization function')
      ) {
        return;
      }
      originalWarn(...args);
    };
    try {
      if (typeof rapierAny.init === 'function') {
        try {
          await rapierAny.init({});
        } catch {
          await rapierAny.init();
        }
      }
    } finally {
      console.warn = originalWarn;
    }
  }

  public reset(): void {
    this.disposeWorld();
    if (this.state === 'ready') {
      this.createWorld();
    }
  }

  public syncRollIds(rollIds: string[]): void {
    const next = new Set(rollIds);
    for (const [rollId, state] of this.bodies) {
      if (!next.has(rollId)) {
        this.removeBody(state.body);
        this.bodies.delete(rollId);
      }
    }
  }

  public launch(rollId: string, seed: number, ordinal: number, totalDice: number): void {
    if (!this.world || !this.rapier) {
      return;
    }

    const rand = mulberry32(seed ^ (ordinal * 2654435761));
    const existing = this.bodies.get(rollId);
    if (existing) {
      this.removeBody(existing.body);
      this.bodies.delete(rollId);
    }

    const R = this.rapier;
    const slot = spawnSlot(ordinal, totalDice);
    const jitterX = (rand() * 2 - 1) * 0.18;
    const jitterZ = (rand() * 2 - 1) * 0.18;
    const bodyDesc = R.RigidBodyDesc.dynamic().setTranslation(
      slot.x + jitterX,
      1.22 + rand() * 0.28,
      slot.z + jitterZ,
    );

    const body = this.world.createRigidBody(bodyDesc);
    if (typeof body.setLinearDamping === 'function') {
      body.setLinearDamping(0.18);
    }
    if (typeof body.setAngularDamping === 'function') {
      body.setAngularDamping(0.2);
    }

    const colliderDesc = R.ColliderDesc.cuboid(0.48, 0.48, 0.48)
      .setRestitution(0.19)
      .setFriction(0.9);
    this.world.createCollider(colliderDesc, body);

    body.applyImpulse(
      {
        x: (rand() * 2 - 1) * 1.15,
        y: 2.9 + rand() * 0.8,
        z: (rand() * 2 - 1) * 1.15,
      },
      true,
    );
    body.applyTorqueImpulse(
      {
        x: (rand() * 2 - 1) * 6.1,
        y: (rand() * 2 - 1) * 6.1,
        z: (rand() * 2 - 1) * 6.1,
      },
      true,
    );

    this.bodies.set(rollId, {
      body,
      settleTarget: null,
      settleDeadlineMs: 0,
      settled: false,
    });
  }

  public requestSettle(
    rollId: string,
    targetRotation: QuatLike,
    deadlineMs: number,
    nowMs: number = performance.now(),
  ): void {
    const state = this.bodies.get(rollId);
    if (!state) {
      return;
    }
    state.settleTarget = normalizeQuat(targetRotation);
    state.settleDeadlineMs = deadlineMs;
    state.settled = false;
    if (typeof state.body.wakeUp === 'function') {
      state.body.wakeUp();
    }
  }

  public step(nowMs: number): void {
    if (!this.world) {
      return;
    }

    this.world.step();

    for (const state of this.bodies.values()) {
      this.constrainInsideTray(state.body);
    }

    for (const state of this.bodies.values()) {
      if (!state.settleTarget || state.settled) {
        continue;
      }

      const body = state.body;
      const remainingMs = state.settleDeadlineMs - nowMs;
      const sleeping = typeof body.isSleeping === 'function' ? body.isSleeping() : false;

      if (remainingMs > 0) {
        if (remainingMs <= SETTLE_BLEND_WINDOW_MS) {
          this.blendBodyToTarget(body, state.settleTarget, remainingMs);
        }
        const canFinalizeBySleep = sleeping && remainingMs <= 100;
        if (!canFinalizeBySleep) {
          continue;
        }
      }

      if (typeof body.setRotation === 'function') {
        body.setRotation(state.settleTarget, true);
      }
      if (typeof body.setLinvel === 'function') {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (typeof body.setAngvel === 'function') {
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (typeof body.sleep === 'function') {
        body.sleep();
      }

      state.settled = true;
    }
  }

  private blendBodyToTarget(body: any, target: QuatLike, remainingMs: number): void {
    if (!body || typeof body.rotation !== 'function' || typeof body.setRotation !== 'function') {
      return;
    }

    const current = body.rotation?.();
    if (!current) {
      return;
    }

    const from = normalizeQuat({
      x: Number(current.x ?? 0),
      y: Number(current.y ?? 0),
      z: Number(current.z ?? 0),
      w: Number(current.w ?? 1),
    });

    const closeness = 1 - Math.max(0, Math.min(1, remainingMs / SETTLE_BLEND_WINDOW_MS));
    const blend = 0.1 + closeness * 0.26;
    const next = slerpQuat(from, target, blend);
    body.setRotation(next, true);

    if (typeof body.setAngvel === 'function') {
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (typeof body.setLinvel === 'function') {
      const lv = body.linvel?.();
      body.setLinvel(
        {
          x: Number(lv?.x ?? 0) * 0.92,
          y: Number(lv?.y ?? 0) * 0.92,
          z: Number(lv?.z ?? 0) * 0.92,
        },
        true,
      );
    }
  }

  public isSettled(rollId: string): boolean {
    const state = this.bodies.get(rollId);
    return !!state?.settled;
  }

  public getPose(rollId: string): DicePhysicsPose | null {
    const state = this.bodies.get(rollId);
    if (!state) {
      return null;
    }

    const body = state.body;
    const translation = body.translation?.();
    const rotation = body.rotation?.();

    if (!translation || !rotation) {
      return null;
    }

    const sleeping = typeof body.isSleeping === 'function' ? body.isSleeping() : false;
    return {
      position: {
        x: Number(translation.x ?? 0),
        y: Number(translation.y ?? 0),
        z: Number(translation.z ?? 0),
      },
      rotation: {
        x: Number(rotation.x ?? 0),
        y: Number(rotation.y ?? 0),
        z: Number(rotation.z ?? 0),
        w: Number(rotation.w ?? 1),
      },
      sleeping,
    };
  }

  public dispose(): void {
    this.disposeWorld();
    this.bodies.clear();
    this.rapier = null;
    this.state = this.state === 'failed' ? 'failed' : 'idle';
    this.initPromise = null;
  }

  private createWorld(): void {
    if (!this.rapier) {
      return;
    }

    this.disposeWorld();

    const R = this.rapier;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });

    const floor = R.ColliderDesc.cuboid(3.4, 0.25, 3.4)
      .setTranslation(0, -1.4, 0)
      .setRestitution(0.18)
      .setFriction(0.9);
    this.world.createCollider(floor);

    const wall = (x: number, z: number, hx: number, hz: number): void => {
      const desc = R.ColliderDesc.cuboid(hx, 2.2, hz)
        .setTranslation(x, -0.1, z)
        .setRestitution(0.16)
        .setFriction(0.86);
      this.world.createCollider(desc);
    };

    wall(0, -TRAY_WALL_CENTER, TRAY_WALL_HALF, 0.22);
    wall(0, TRAY_WALL_CENTER, TRAY_WALL_HALF, 0.22);
    wall(-TRAY_WALL_CENTER, 0, 0.22, TRAY_WALL_HALF);
    wall(TRAY_WALL_CENTER, 0, 0.22, TRAY_WALL_HALF);
  }

  private constrainInsideTray(body: any): void {
    if (!body || typeof body.translation !== 'function') {
      return;
    }
    const current = body.translation();
    if (!current) {
      return;
    }

    const clampedX = Math.max(-TRAY_HALF_X, Math.min(TRAY_HALF_X, Number(current.x ?? 0)));
    const clampedY = Math.max(-1.2, Number(current.y ?? 0));
    const clampedZ = Math.max(-TRAY_HALF_Z, Math.min(TRAY_HALF_Z, Number(current.z ?? 0)));

    const moved = clampedX !== current.x || clampedY !== current.y || clampedZ !== current.z;
    if (!moved) {
      return;
    }

    if (typeof body.setTranslation === 'function') {
      body.setTranslation({ x: clampedX, y: clampedY, z: clampedZ }, true);
    }

    if (typeof body.linvel === 'function' && typeof body.setLinvel === 'function') {
      const lv = body.linvel();
      body.setLinvel(
        {
          x: Math.abs(clampedX) >= TRAY_HALF_X ? -Number(lv?.x ?? 0) * 0.25 : Number(lv?.x ?? 0) * 0.6,
          y: Number(lv?.y ?? 0),
          z: Math.abs(clampedZ) >= TRAY_HALF_Z ? -Number(lv?.z ?? 0) * 0.25 : Number(lv?.z ?? 0) * 0.6,
        },
        true,
      );
    }
  }

  private removeBody(body: any): void {
    if (!this.world || !body) {
      return;
    }
    if (typeof this.world.removeRigidBody === 'function') {
      this.world.removeRigidBody(body);
    }
  }

  private disposeWorld(): void {
    if (this.world && typeof this.world.free === 'function') {
      this.world.free();
    }
    this.world = null;
    this.bodies.clear();
  }
}
