import type {
  CombatFxEvent,
  CombatState,
  DiceFaceDef,
  DieDef,
  RolledDie,
} from '../../domain/shared/types';
import { materializeAllDieFaces } from '../../domain/shared/dice-face-utils';
import { DicePhysicsRapier, type QuatLike as RapierQuat } from './dice-physics-rapier';
import {
  DiceThreeRenderer,
  type DiceQuaternion,
  type DiceVector3,
} from './dice-three-renderer';
import { renderDieFaceSprite } from './dice-renderer';

type DiceCubeMode = 'three_rapier' | 'three_kinematic' | 'sprite_2d';

type DiePhase = 'idle' | 'rolling' | 'settling' | 'aligning' | 'settled';

interface SettleRequest {
  faceId: string;
  durationMs: number;
}

interface DieVisualState {
  rollId: string;
  face: DiceFaceDef;
  faceIndex: number;
  phase: DiePhase;
  rotation: DiceQuaternion;
  position: DiceVector3;
  settleFromRotation: DiceQuaternion;
  targetRotation: DiceQuaternion;
  euler: { x: number; y: number; z: number };
  angularVel: { x: number; y: number; z: number };
  rollUntilMs: number;
  settleStartMs: number;
  settleDurationMs: number;
  settleDeadlineMs: number;
  alignFromRotation: DiceQuaternion;
  alignStartMs: number;
  alignDurationMs: number;
  queuedSettle: SettleRequest | null;
  inactive: boolean;
}

export interface DiceCubeDiagnostics {
  mode: DiceCubeMode;
  p95FrameMs: number;
  samples: number;
  hasWebgl: boolean;
  hasRapier: boolean;
  simMs: number;
  renderMs: number;
  diceCount: number;
  interactionReady: boolean;
  seed: number | null;
}

type DiceTrayInteraction = 'hover' | 'tap';

interface DiceTraySelectDetail {
  rollId: string;
}

interface DiceTrayTooltipDetail {
  rollId: string;
  x: number;
  y: number;
  interaction: DiceTrayInteraction;
}

interface PendingRollRequest {
  durationMs: number;
}

interface VisualRollMeta {
  ownerId: string;
  dieId: string;
  selectable: boolean;
  transient: boolean;
  expiresAtMs: number | null;
}

const FIXED_STEP_SECONDS = 1 / 60;
const PERF_WINDOW_MS = 2000;
const PERF_DEGRADE_THRESHOLD_MS = 24;
const RENDERER_INIT_TIMEOUT_MS = 1200;
const ROLL_STUCK_TIMEOUT_MS = 1800;
const SETTLE_STUCK_TIMEOUT_MS = 2200;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const normalizeQuat = (q: DiceQuaternion): DiceQuaternion => {
  const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (lenSq <= 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  const inv = 1 / Math.sqrt(lenSq);
  return {
    x: q.x * inv,
    y: q.y * inv,
    z: q.z * inv,
    w: q.w * inv,
  };
};

const quatMul = (a: DiceQuaternion, b: DiceQuaternion): DiceQuaternion => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

const quatFromEuler = (rx: number, ry: number, rz: number): DiceQuaternion => {
  const sx = Math.sin(rx * 0.5);
  const cx = Math.cos(rx * 0.5);
  const sy = Math.sin(ry * 0.5);
  const cy = Math.cos(ry * 0.5);
  const sz = Math.sin(rz * 0.5);
  const cz = Math.cos(rz * 0.5);
  return normalizeQuat({
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  });
};

const quatSlerp = (from: DiceQuaternion, to: DiceQuaternion, t: number): DiceQuaternion => {
  const clamped = clamp01(t);
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

const faceBaseRotation = (faceIndex: number): DiceQuaternion => {
  const normalized = ((faceIndex % 6) + 6) % 6;
  if (normalized === 0) return quatFromEuler(0, 0, 0); // +Y up
  if (normalized === 1) return quatFromEuler(0, 0, -Math.PI / 2); // +X up
  if (normalized === 2) return quatFromEuler(0, 0, Math.PI / 2); // -X up
  if (normalized === 3) return quatFromEuler(-Math.PI / 2, 0, 0); // +Z up
  if (normalized === 4) return quatFromEuler(Math.PI / 2, 0, 0); // -Z up
  return quatFromEuler(Math.PI, 0, 0); // -Y up
};

const faceTargetRotation = (faceIndex: number, seed: number): DiceQuaternion => {
  const rand = mulberry32(seed);
  const yaw = (rand() * 2 - 1) * Math.PI;
  const yawQuat = quatFromEuler(0, yaw, 0);
  return normalizeQuat(quatMul(yawQuat, faceBaseRotation(faceIndex)));
};

const nextPerfP95 = (samples: number[]): number => {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index] ?? 0;
};

const idlePositionForIndex = (index: number): DiceVector3 => ({
  x: (index - 3.5) * 1.1,
  y: -0.94,
  z: ((index % 2) - 0.5) * 0.42,
});

export class DiceCubeRuntime {
  private root: HTMLElement | null = null;

  private trayCanvas: HTMLCanvasElement | null = null;

  private combatId: string | null = null;

  private turn = 1;

  private mode: DiceCubeMode = 'three_rapier';

  private qualityPreset: 'performance' | 'quality' = 'performance';

  private perfSamples: number[] = [];

  private perfWindowMs = 0;

  private perfHotMs = 0;

  private physicsAccumulatorSec = 0;

  private clockMs = 0;

  private simMs = 0;

  private renderMs = 0;

  private selectedRollId: string | null = null;

  private hoverRollId: string | null = null;

  private interactionReady = false;

  private awaitingRoll = true;

  private lastVisualSeed: number | null = null;

  private readonly rollData = new Map<string, RolledDie>();

  private readonly rollMeta = new Map<string, VisualRollMeta>();

  private readonly states = new Map<string, DieVisualState>();

  private rollOrder: string[] = [];

  private readonly dieFacesByDieId = new Map<string, DiceFaceDef[]>();

  private readonly renderer = new DiceThreeRenderer();

  private rendererReady = false;

  private rendererInitPromise: Promise<boolean> | null = null;

  private rendererInitStartedAtMs = 0;

  private rendererInitToken = 0;

  private readonly rapier = new DicePhysicsRapier();

  private rapierReady = false;

  private rapierInitPromise: Promise<boolean> | null = null;

  private spriteImageCache = new Map<string, HTMLImageElement>();

  private pointerBoundCanvas: HTMLCanvasElement | null = null;

  private readonly pendingRollRequests = new Map<string, PendingRollRequest>();

  private readonly pendingSettleRequests = new Map<string, SettleRequest>();

  private interactionSuspended = false;

  public getMode(): DiceCubeMode {
    return this.mode;
  }

  public setDieDefinitions(diceById: Record<string, DieDef>): void {
    this.dieFacesByDieId.clear();
    for (const [dieId, die] of Object.entries(diceById)) {
      if (!die) {
        continue;
      }
      this.dieFacesByDieId.set(dieId, materializeAllDieFaces(die));
    }
  }

  public getDiagnostics(): DiceCubeDiagnostics {
    return {
      mode: this.mode,
      p95FrameMs: nextPerfP95(this.perfSamples),
      samples: this.perfSamples.length,
      hasWebgl: this.rendererReady,
      hasRapier: this.rapierReady,
      simMs: this.simMs,
      renderMs: this.renderMs,
      diceCount: this.rollOrder.length,
      interactionReady: this.interactionReady,
      seed: this.lastVisualSeed,
    };
  }

  public setQualityPreset(preset: 'performance' | 'quality'): void {
    this.qualityPreset = preset;
    this.renderer.setQualityPreset(preset);
  }

  public setInteractionSuspended(suspended: boolean): void {
    if (this.interactionSuspended === suspended) {
      return;
    }
    this.interactionSuspended = suspended;
    if (suspended) {
      this.hoverRollId = null;
      this.emitTrayEvent('dice-tray:clear', undefined);
    }
    this.refreshInteractionState();
  }

  public setSelectedRollId(rollId: string | null): void {
    this.selectedRollId = rollId;
    this.reconcileSelectedRoll();
    this.renderer.setSelectedRollId(this.selectedRollId);
  }

  public setCombatId(combatId: string | null): void {
    if (this.combatId === combatId) {
      return;
    }

    this.combatId = combatId;
    this.turn = 1;
    this.clockMs = 0;
    this.simMs = 0;
    this.renderMs = 0;
    this.physicsAccumulatorSec = 0;
    this.rollData.clear();
    this.rollMeta.clear();
    this.states.clear();
    this.rollOrder = [];
    this.mode = 'three_rapier';
    this.perfSamples = [];
    this.perfWindowMs = 0;
    this.perfHotMs = 0;
    this.selectedRollId = null;
    this.hoverRollId = null;
    this.interactionReady = false;
    this.awaitingRoll = true;
    this.lastVisualSeed = null;
    this.pendingRollRequests.clear();
    this.pendingSettleRequests.clear();
    this.interactionSuspended = false;
    this.rendererInitStartedAtMs = 0;
    this.rendererInitToken += 1;
    this.rendererInitPromise = null;
    this.renderer.setSelectedRollId(null);

    this.rapier.reset();
    this.rapierReady = false;
    this.rapierInitPromise = null;
  }

  public attach(root: HTMLElement): void {
    this.root = root;
    this.rebuildDomIndex();

    if (!this.trayCanvas) {
      this.degradeMode('webgl_init');
      return;
    }

    this.ensureRendererReady();
    this.renderer.setQualityPreset(this.qualityPreset);
    if (this.mode === 'three_rapier') {
      this.ensureRapierReady();
    }
  }

  public syncCombat(combat: CombatState): void {
    if (this.combatId !== combat.id) {
      this.setCombatId(combat.id);
    }

    this.turn = combat.turn;
    this.awaitingRoll = combat.awaitingRoll;
    this.rebuildDomIndex();

    const nextPlayerRollIds = new Set<string>();

    combat.diceRolls.forEach((roll, index) => {
      this.rollData.set(roll.rollId, roll);
      this.rollMeta.set(roll.rollId, {
        ownerId: roll.ownerId,
        dieId: roll.dieId,
        selectable: true,
        transient: false,
        expiresAtMs: null,
      });
      nextPlayerRollIds.add(roll.rollId);

      const existing = this.states.get(roll.rollId);
      if (!existing) {
        this.states.set(roll.rollId, this.makeIdleState(roll, index));
      } else {
        existing.face = roll.face;
        existing.faceIndex = roll.faceIndex;
      }
    });

    for (const rollId of Array.from(this.rollMeta.keys())) {
      const meta = this.rollMeta.get(rollId);
      if (!meta) {
        continue;
      }
      if (nextPlayerRollIds.has(rollId)) {
        continue;
      }
      if (!meta.transient) {
        this.removeRoll(rollId);
        continue;
      }
      if (meta.expiresAtMs !== null && this.clockMs >= meta.expiresAtMs) {
        this.removeRoll(rollId);
      }
    }

    this.recomputeRollOrder(combat.diceRolls.map((roll) => roll.rollId));
    this.rapier.syncRollIds(this.rollOrder);
    this.flushPendingDiceEvents();
    this.cleanupExpiredTransientRolls();
    this.reconcileSelectedRoll();
    this.refreshInteractionState();

    if (this.rendererReady) {
      const rolls = this.collectRenderableRolls();
      this.renderer.syncDice(rolls);
      this.renderer.setSelectedRollId(this.selectedRollId);
    }
  }

  public enqueue(events: CombatFxEvent[]): void {
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      if (event.type === 'die_roll') {
        if (event.transient) {
          this.ensureTransientRollFromEvent(event);
          this.startRoll(event.rollId, event.durationMs);
        } else if (this.rollData.has(event.rollId)) {
          this.startRoll(event.rollId, event.durationMs);
        } else {
          this.pendingRollRequests.set(event.rollId, { durationMs: event.durationMs });
        }
      } else if (event.type === 'die_settle') {
        if (event.transient) {
          this.ensureTransientRollFromEvent(event);
          const meta = this.rollMeta.get(event.rollId);
          if (meta) {
            const ttl = event.expiresAfterMs ?? 1100;
            meta.expiresAtMs = this.clockMs + Math.max(300, ttl);
          }
          this.requestSettle(event.rollId, event.faceId, event.durationMs);
        } else if (this.rollData.has(event.rollId)) {
          this.requestSettle(event.rollId, event.faceId, event.durationMs);
        } else {
          this.pendingSettleRequests.set(event.rollId, {
            faceId: event.faceId,
            durationMs: event.durationMs,
          });
        }
      }
    }
    this.cleanupExpiredTransientRolls();
  }

  public tick(dtMs: number): void {
    if (!this.combatId) {
      return;
    }

    const frameStart = performance.now();
    const frameMs = Math.max(0, Math.min(80, dtMs));
    this.clockMs += frameMs;
    this.observePerformance(frameMs);

    if (!this.rendererReady && this.mode !== 'sprite_2d') {
      this.ensureRendererReady();
    }

    if (
      this.rendererInitPromise &&
      this.mode !== 'sprite_2d' &&
      this.rendererInitStartedAtMs > 0 &&
      this.clockMs - this.rendererInitStartedAtMs > RENDERER_INIT_TIMEOUT_MS
    ) {
      this.rendererInitToken += 1;
      this.rendererInitPromise = null;
      this.degradeMode('webgl_init');
    }

    if (this.mode !== 'sprite_2d' && this.rendererReady && this.renderer.isContextLost()) {
      this.degradeMode('webgl_init');
      this.renderCurrentMode();
      return;
    }

    if (this.mode === 'three_rapier' && !this.rapierReady) {
      this.ensureRapierReady();
    }

    if (this.mode === 'three_rapier' && this.rapierReady) {
      this.physicsAccumulatorSec += frameMs / 1000;
      while (this.physicsAccumulatorSec >= FIXED_STEP_SECONDS) {
        this.rapier.step(this.clockMs);
        this.physicsAccumulatorSec -= FIXED_STEP_SECONDS;
      }
    }

    for (const state of this.states.values()) {
      this.updateState(state, frameMs);
    }
    this.cleanupExpiredTransientRolls();
    this.refreshInteractionState();
    this.reconcileSelectedRoll();
    this.simMs = Math.max(0, performance.now() - frameStart);

    const renderStart = performance.now();
    this.renderCurrentMode();
    this.renderMs = Math.max(0, performance.now() - renderStart);
  }

  private observePerformance(frameMs: number): void {
    this.perfSamples.push(frameMs);
    this.perfWindowMs += frameMs;

    while (this.perfWindowMs > PERF_WINDOW_MS && this.perfSamples.length > 1) {
      const removed = this.perfSamples.shift() ?? 0;
      this.perfWindowMs -= removed;
    }

    if (this.mode === 'sprite_2d' || this.perfWindowMs < PERF_WINDOW_MS * 0.9) {
      return;
    }

    const p95 = nextPerfP95(this.perfSamples);
    if (p95 > PERF_DEGRADE_THRESHOLD_MS) {
      this.perfHotMs += frameMs;
    } else {
      this.perfHotMs = Math.max(0, this.perfHotMs - frameMs * 0.45);
    }

    if (this.perfHotMs < PERF_WINDOW_MS) {
      return;
    }

    this.perfHotMs = 0;
    this.degradeMode('performance');
  }

  private degradeMode(reason: 'rapier_init' | 'performance' | 'webgl_init'): void {
    if (reason === 'webgl_init') {
      this.mode = 'sprite_2d';
      this.rendererReady = false;
      this.rendererInitPromise = null;
      this.rendererInitStartedAtMs = 0;
      this.rendererInitToken += 1;
      this.renderer.dispose();
      return;
    }

    if (this.mode === 'three_rapier') {
      this.mode = 'three_kinematic';
      return;
    }

    if (this.mode === 'three_kinematic') {
      // Keep WebGL active after a successful init to avoid switching context type
      // on the same canvas. `sprite_2d` is reserved for hard WebGL init failures.
      this.mode = 'three_kinematic';
      this.qualityPreset = 'performance';
      this.renderer.setQualityPreset('performance');
    }
  }

  private rebuildDomIndex(): void {
    const previousCanvas = this.trayCanvas;
    this.trayCanvas = null;

    if (!this.root) {
      this.unbindPointerHandlers(previousCanvas);
      return;
    }

    this.trayCanvas = this.root.querySelector<HTMLCanvasElement>('canvas[data-dice-tray-canvas]');
    if (this.trayCanvas) {
      if (previousCanvas && previousCanvas !== this.trayCanvas) {
        // Combat screen re-renders replace the canvas node; reattach renderer cleanly.
        this.renderer.dispose();
        this.rendererReady = false;
        this.rendererInitPromise = null;
        this.rendererInitStartedAtMs = 0;
        this.rendererInitToken += 1;
      }
      this.trayCanvas.style.imageRendering = 'pixelated';
      this.trayCanvas.style.touchAction = 'none';
      this.bindPointerHandlers(this.trayCanvas);
    } else {
      this.unbindPointerHandlers(previousCanvas);
    }
  }

  private makeIdleState(roll: RolledDie, ordinal: number): DieVisualState {
    const seed = hashString(`${this.combatId ?? 'combat'}:${this.turn}:${roll.rollId}:idle`);
    const target = faceTargetRotation(roll.faceIndex, seed);
    return {
      rollId: roll.rollId,
      face: roll.face,
      faceIndex: roll.faceIndex,
      phase: 'idle',
      rotation: target,
      position: idlePositionForIndex(ordinal),
      settleFromRotation: target,
      targetRotation: target,
      euler: { x: 0, y: 0, z: 0 },
      angularVel: { x: 0, y: 0, z: 0 },
      rollUntilMs: this.clockMs,
      settleStartMs: this.clockMs,
      settleDurationMs: 220,
      settleDeadlineMs: this.clockMs + 700,
      alignFromRotation: target,
      alignStartMs: this.clockMs,
      alignDurationMs: 180,
      queuedSettle: null,
      inactive: false,
    };
  }

  private removeRoll(rollId: string): void {
    this.rollData.delete(rollId);
    this.rollMeta.delete(rollId);
    this.states.delete(rollId);
    this.pendingRollRequests.delete(rollId);
    this.pendingSettleRequests.delete(rollId);
  }

  private recomputeRollOrder(playerRollIds: string[]): void {
    const transientIds = Array.from(this.rollMeta.entries())
      .filter(([, meta]) => meta.transient)
      .map(([rollId]) => rollId);
    this.rollOrder = [...playerRollIds, ...transientIds];
  }

  private collectRenderableRolls(): RolledDie[] {
    const rolls: RolledDie[] = [];
    for (const rollId of this.rollOrder) {
      const roll = this.rollData.get(rollId);
      if (roll) {
        rolls.push(roll);
      }
    }
    return rolls;
  }

  private buildEventFace(
    rollId: string,
    face: DiceFaceDef | undefined,
    faceId?: string,
  ): DiceFaceDef {
    if (face) {
      return face;
    }
    if (faceId) {
      const found = this.findFaceById(faceId);
      if (found) {
        return found.face;
      }
    }
    return {
      id: faceId ?? `${rollId}_transient_face`,
      label: 'Intento',
      kind: 'special',
      value: 1,
      tags: ['enemy_intent'],
      target: 'enemy',
      effects: [],
    };
  }

  private ensureTransientRollFromEvent(
    event: Extract<CombatFxEvent, { type: 'die_roll' | 'die_settle' }>,
  ): void {
    const existing = this.rollData.get(event.rollId);
    const face = this.buildEventFace(
      event.rollId,
      event.face,
      event.type === 'die_settle' ? event.faceId : undefined,
    );
    const faceIndex =
      typeof event.faceIndex === 'number'
        ? Math.max(0, Math.min(5, Math.floor(event.faceIndex)))
        : 0;

    if (!existing) {
      const roll: RolledDie = {
        rollId: event.rollId,
        ownerId: event.ownerId,
        dieId: event.dieId ?? `transient_${event.ownerId}`,
        faceIndex,
        face,
        used: true,
        locked: true,
      };
      this.rollData.set(event.rollId, roll);
      this.states.set(event.rollId, this.makeIdleState(roll, this.rollOrder.length));
    } else {
      existing.face = face;
      existing.faceIndex = faceIndex;
    }

    const previous = this.rollMeta.get(event.rollId);
    this.rollMeta.set(event.rollId, {
      ownerId: event.ownerId,
      dieId: event.dieId ?? previous?.dieId ?? `transient_${event.ownerId}`,
      selectable: event.selectable ?? false,
      transient: true,
      expiresAtMs:
        previous?.expiresAtMs ??
        (typeof event.expiresAfterMs === 'number'
          ? this.clockMs + Math.max(300, event.expiresAfterMs)
          : null),
    });
    const playerRollIds = Array.from(this.rollMeta.entries())
      .filter(([, meta]) => !meta.transient)
      .map(([rollId]) => rollId);
    this.recomputeRollOrder(playerRollIds);
  }

  private cleanupExpiredTransientRolls(): void {
    let removed = false;
    for (const [rollId, meta] of this.rollMeta) {
      if (!meta.transient || meta.expiresAtMs === null || this.clockMs < meta.expiresAtMs) {
        continue;
      }
      const state = this.states.get(rollId);
      if (state && state.phase !== 'idle' && state.phase !== 'settled') {
        continue;
      }
      this.removeRoll(rollId);
      removed = true;
    }
    if (removed) {
      this.rollOrder = this.rollOrder.filter((rollId) => this.rollData.has(rollId));
    }
  }

  private startRoll(rollId: string, durationMs: number): void {
    const roll = this.rollData.get(rollId);
    if (!roll) {
      return;
    }

    const ordinal = Math.max(0, this.rollOrder.indexOf(rollId));
    const state = this.states.get(rollId) ?? this.makeIdleState(roll, ordinal);
    const seed = hashString(`${this.combatId ?? 'combat'}:${this.turn}:${rollId}:roll`);
    const rand = mulberry32(seed);
    this.lastVisualSeed = seed;

    state.face = roll.face;
    state.faceIndex = roll.faceIndex;
    state.phase = 'rolling';
    state.inactive = false;
    state.rollUntilMs = this.clockMs + Math.max(120, durationMs);
    state.queuedSettle = null;
    state.euler = {
      x: rand() * Math.PI * 2,
      y: rand() * Math.PI * 2,
      z: rand() * Math.PI * 2,
    };
    state.angularVel = {
      x: (rand() * 2 - 1) * 8.6,
      y: (rand() * 2 - 1) * 8.6,
      z: (rand() * 2 - 1) * 8.6,
    };
    state.rotation = quatFromEuler(state.euler.x, state.euler.y, state.euler.z);
    state.settleFromRotation = state.rotation;
    state.targetRotation = faceTargetRotation(state.faceIndex, seed ^ 0x9e3779b9);

    if (this.mode === 'three_rapier' && this.rapierReady) {
      this.rapier.launch(rollId, seed, ordinal, this.rollOrder.length);
    }

    if (this.interactionReady) {
      this.interactionReady = false;
      this.hoverRollId = null;
      this.emitTrayEvent('dice-tray:clear', undefined);
    }

    if (this.selectedRollId === rollId || this.hoverRollId === rollId) {
      this.emitTrayEvent('dice-tray:clear', undefined);
      this.hoverRollId = null;
    }

    this.states.set(rollId, state);
  }

  private requestSettle(rollId: string, faceId: string, durationMs: number): void {
    const state = this.states.get(rollId);
    if (!state) {
      return;
    }

    state.queuedSettle = {
      faceId,
      durationMs: Math.max(140, durationMs),
    };

    if (this.clockMs >= state.rollUntilMs) {
      this.applyQueuedSettle(state);
    }
  }

  private applyQueuedSettle(state: DieVisualState): void {
    if (!state.queuedSettle) {
      return;
    }

    const queued = state.queuedSettle;
    state.queuedSettle = null;

    const roll = this.rollData.get(state.rollId);
    if (roll) {
      state.face = roll.face;
      state.faceIndex = roll.faceIndex;
    } else if (queued.faceId !== state.face.id) {
      const fallback = this.findFaceById(queued.faceId);
      if (fallback) {
        state.face = fallback.face;
        state.faceIndex = fallback.faceIndex;
      }
    }

    const settleSeed = hashString(`${this.combatId ?? 'combat'}:${this.turn}:${state.rollId}:settle`);
    state.phase = 'settling';
    state.inactive = false;
    state.settleFromRotation = state.rotation;
    state.targetRotation = faceTargetRotation(state.faceIndex, settleSeed);
    state.settleStartMs = Math.max(this.clockMs, state.rollUntilMs);
    state.settleDurationMs = queued.durationMs;
    state.settleDeadlineMs = state.settleStartMs + queued.durationMs + 320;
    state.alignFromRotation = state.rotation;
    state.alignStartMs = state.settleStartMs;
    state.alignDurationMs = Math.max(140, Math.floor(queued.durationMs * 0.36));

    if (this.mode === 'three_rapier' && this.rapierReady) {
      this.rapier.requestSettle(
        state.rollId,
        state.targetRotation as RapierQuat,
        state.settleDeadlineMs,
      );
    }
  }

  private findFaceById(faceId: string): { face: DiceFaceDef; faceIndex: number } | null {
    for (const roll of this.rollData.values()) {
      if (roll.face.id === faceId) {
        return { face: roll.face, faceIndex: roll.faceIndex };
      }
    }
    return null;
  }

  private updateState(state: DieVisualState, frameMs: number): void {
    const dtSeconds = frameMs / 1000;

    if (state.phase === 'rolling') {
      if (this.mode === 'three_rapier' && this.rapierReady) {
        this.applyPhysicsPose(state);
      } else {
        state.euler.x += state.angularVel.x * dtSeconds;
        state.euler.y += state.angularVel.y * dtSeconds;
        state.euler.z += state.angularVel.z * dtSeconds;
        state.angularVel.x *= 0.988;
        state.angularVel.y *= 0.988;
        state.angularVel.z *= 0.988;
        state.rotation = quatFromEuler(state.euler.x, state.euler.y, state.euler.z);
      }
      state.inactive = false;

      if (this.clockMs >= state.rollUntilMs) {
        this.applyQueuedSettle(state);
      } else if (this.clockMs >= state.rollUntilMs + ROLL_STUCK_TIMEOUT_MS) {
        state.rollUntilMs = this.clockMs;
        if (!state.queuedSettle) {
          state.queuedSettle = {
            faceId: state.face.id,
            durationMs: 180,
          };
        }
        this.applyQueuedSettle(state);
      }
      return;
    }

    if (state.phase === 'settling') {
      if (this.clockMs < state.settleStartMs) {
        return;
      }

      if (this.mode === 'three_rapier' && this.rapierReady) {
        this.applyPhysicsPose(state);
        state.inactive = false;
        if (this.rapier.isSettled(state.rollId)) {
          state.phase = 'aligning';
          state.alignFromRotation = state.rotation;
          state.alignStartMs = this.clockMs;
          state.alignDurationMs = Math.max(120, Math.min(280, state.alignDurationMs));
        } else if (this.clockMs >= state.settleDeadlineMs + SETTLE_STUCK_TIMEOUT_MS) {
          state.phase = 'aligning';
          state.alignFromRotation = state.rotation;
          state.alignStartMs = this.clockMs;
          state.alignDurationMs = 140;
        }
        return;
      }

      const progress = clamp01(
        (this.clockMs - state.settleStartMs) / Math.max(1, state.settleDurationMs),
      );
      state.rotation = quatSlerp(state.settleFromRotation, state.targetRotation, progress);
      state.inactive = false;
      if (progress >= 1) {
        state.phase = 'settled';
      }
      return;
    }

    if (state.phase === 'aligning') {
      const progress = clamp01(
        (this.clockMs - state.alignStartMs) / Math.max(1, state.alignDurationMs),
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      state.rotation = quatSlerp(state.alignFromRotation, state.targetRotation, eased);
      state.inactive = false;
      if (progress >= 1) {
        state.phase = 'settled';
        state.rotation = state.targetRotation;
      } else if (this.clockMs >= state.alignStartMs + state.alignDurationMs + 600) {
        state.phase = 'settled';
        state.rotation = state.targetRotation;
      }
      return;
    }

    if (state.phase === 'idle' && this.mode === 'three_rapier' && this.rapierReady) {
      this.applyPhysicsPose(state);
      state.inactive = false;
    }
  }

  private applyPhysicsPose(state: DieVisualState): void {
    const pose = this.rapier.getPose(state.rollId);
    if (!pose) {
      return;
    }

    state.position = {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
    };
    state.rotation = normalizeQuat({
      x: pose.rotation.x,
      y: pose.rotation.y,
      z: pose.rotation.z,
      w: pose.rotation.w,
    });
    state.inactive = Math.abs(state.position.x) > 2.18 || Math.abs(state.position.z) > 2.18;
  }

  private renderCurrentMode(): void {
    if (!this.trayCanvas) {
      return;
    }

    if (this.mode === 'sprite_2d') {
      this.renderSpriteTrayFallback();
      return;
    }

    if (!this.rendererReady) {
      if (!this.rendererInitPromise) {
        this.renderSpriteTrayFallback();
      }
      return;
    }

    if (this.renderer.isContextLost()) {
      this.degradeMode('webgl_init');
      this.renderSpriteTrayFallback();
      return;
    }

    const rolls = this.collectRenderableRolls();
    const dieFacesByRollId = new Map<string, DiceFaceDef[]>();
    for (const roll of rolls) {
      const faces = this.dieFacesByDieId.get(roll.dieId);
      if (faces && faces.length >= 6) {
        dieFacesByRollId.set(roll.rollId, faces);
      }
    }
    this.renderer.syncDice(rolls, dieFacesByRollId);

    for (const state of this.states.values()) {
      this.renderer.setDieTransform(state.rollId, state.position, state.rotation);
      this.renderer.setDieInactive(state.rollId, state.inactive);
    }

    this.renderer.setSelectedRollId(this.selectedRollId);
    this.renderer.render();

    if (this.renderer.isContextLost()) {
      this.degradeMode('webgl_init');
      this.renderSpriteTrayFallback();
    }
  }

  private renderSpriteTrayFallback(): void {
    const canvas = this.trayCanvas;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    const rolls = this.collectRenderableRolls();
    if (rolls.length === 0) {
      ctx.fillStyle = '#d7c6a5';
      ctx.font = '12px monospace';
      ctx.fillText('Toque ROLL para gerar os dados.', 10, Math.floor(height / 2));
      return;
    }

    const cols = Math.min(4, Math.max(1, rolls.length));
    const cellW = Math.floor(width / cols);
    const cellH = Math.floor(height / Math.ceil(rolls.length / cols));

    rolls.forEach((roll, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * cellW;
      const y = row * cellH;
      const src = renderDieFaceSprite(roll.face);
      let image = this.spriteImageCache.get(src);
      if (!image) {
        image = new Image();
        image.src = src;
        this.spriteImageCache.set(src, image);
      }
      if (!image.complete) {
        return;
      }
      const size = Math.max(32, Math.min(cellW - 12, cellH - 12));
      const state = this.states.get(roll.rollId);
      const inactive = !!state?.inactive;
      ctx.globalAlpha = inactive ? 0.35 : 1;
      ctx.drawImage(image, x + Math.floor((cellW - size) / 2), y + Math.floor((cellH - size) / 2), size, size);
      ctx.globalAlpha = 1;
      if (this.selectedRollId === roll.rollId && !inactive) {
        ctx.strokeStyle = '#f2b134';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, cellW - 8, cellH - 8);
      }
    });
  }

  private bindPointerHandlers(canvas: HTMLCanvasElement): void {
    if (this.pointerBoundCanvas === canvas) {
      return;
    }
    this.unbindPointerHandlers(this.pointerBoundCanvas);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('click', this.onPointerTap);
    this.pointerBoundCanvas = canvas;
  }

  private unbindPointerHandlers(canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.pointerBoundCanvas = null;
      return;
    }
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('click', this.onPointerTap);
    if (this.pointerBoundCanvas === canvas) {
      this.pointerBoundCanvas = null;
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    if (!this.interactionReady) {
      return;
    }

    const picked = this.pickInteractiveRollAtEvent(event);
    if (picked === this.hoverRollId) {
      return;
    }

    this.hoverRollId = picked;
    if (!picked) {
      return;
    }
    this.emitTooltipEvent(picked, event.clientX, event.clientY, 'hover');
  };

  private readonly onPointerTap = (event: MouseEvent): void => {
    if (!this.interactionReady) {
      this.emitTrayEvent('dice-tray:clear', undefined);
      return;
    }

    const picked = this.pickInteractiveRollAtEvent(event);
    if (!picked) {
      this.emitTrayEvent('dice-tray:clear', undefined);
      return;
    }

    this.emitTrayEvent<DiceTraySelectDetail>('dice-tray:select', { rollId: picked });
    this.emitTooltipEvent(picked, event.clientX, event.clientY, 'tap');
  };

  private emitTooltipEvent(
    rollId: string,
    clientX: number,
    clientY: number,
    interaction: DiceTrayInteraction,
  ): void {
    if (!this.trayCanvas) {
      return;
    }

    const pickedAnchor =
      this.mode !== 'sprite_2d' && this.rendererReady
        ? this.renderer.getRollScreenAnchor(rollId)
        : this.getFallbackRollAnchor(rollId);

    const rect = this.trayCanvas.getBoundingClientRect();
    const x = pickedAnchor?.x ?? clientX - rect.left;
    const y = pickedAnchor?.y ?? clientY - rect.top;
    this.emitTrayEvent<DiceTrayTooltipDetail>('dice-tray:tooltip', {
      rollId,
      x,
      y,
      interaction,
    });
  }

  private pickInteractiveRollAtEvent(event: MouseEvent | PointerEvent): string | null {
    const rollId =
      this.mode !== 'sprite_2d' && this.rendererReady
        ? this.renderer.pickRollIdAtClient(event.clientX, event.clientY)
        : this.pickFallbackRollAtPoint(event.clientX, event.clientY);

    if (!rollId) {
      return null;
    }
    return this.isRollInteractive(rollId) ? rollId : null;
  }

  private pickFallbackRollAtPoint(clientX: number, clientY: number): string | null {
    const canvas = this.trayCanvas;
    if (!canvas || this.rollOrder.length === 0) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }

    const rolls = this.collectRenderableRolls();
    const cols = Math.min(4, Math.max(1, rolls.length));
    const rows = Math.max(1, Math.ceil(rolls.length / cols));
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const col = Math.min(cols - 1, Math.max(0, Math.floor((localX / rect.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((localY / rect.height) * rows)));
    const index = row * cols + col;
    const roll = rolls[index];
    return roll?.rollId ?? null;
  }

  private getFallbackRollAnchor(rollId: string): { x: number; y: number } | null {
    const canvas = this.trayCanvas;
    if (!canvas) {
      return null;
    }

    const rolls = this.collectRenderableRolls();
    const index = rolls.findIndex((roll) => roll.rollId === rollId);
    if (index < 0) {
      return null;
    }
    const cols = Math.min(4, Math.max(1, rolls.length));
    const rows = Math.max(1, Math.ceil(rolls.length / cols));
    const cellW = canvas.clientWidth / cols;
    const cellH = canvas.clientHeight / rows;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: col * cellW + cellW * 0.5,
      y: row * cellH + 10,
    };
  }

  private emitTrayEvent<T>(name: string, detail: T | undefined): void {
    if (!this.trayCanvas) {
      return;
    }
    this.trayCanvas.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
      }),
    );
  }

  private flushPendingDiceEvents(): void {
    for (const rollId of this.rollOrder) {
      const pendingRoll = this.pendingRollRequests.get(rollId);
      if (pendingRoll) {
        this.startRoll(rollId, pendingRoll.durationMs);
        this.pendingRollRequests.delete(rollId);
      }

      const pendingSettle = this.pendingSettleRequests.get(rollId);
      if (pendingSettle) {
        this.requestSettle(rollId, pendingSettle.faceId, pendingSettle.durationMs);
        this.pendingSettleRequests.delete(rollId);
      }
    }

    const activeIds = new Set(this.rollOrder);
    for (const rollId of this.pendingRollRequests.keys()) {
      if (!activeIds.has(rollId)) {
        this.pendingRollRequests.delete(rollId);
      }
    }
    for (const rollId of this.pendingSettleRequests.keys()) {
      if (!activeIds.has(rollId)) {
        this.pendingSettleRequests.delete(rollId);
      }
    }
  }

  private refreshInteractionState(): void {
    const interactiveRollIds = this.rollOrder.filter((rollId) => {
      const meta = this.rollMeta.get(rollId);
      if (!meta) {
        return false;
      }
      return meta.selectable && !meta.transient;
    });

    const nextReady = !this.interactionSuspended &&
      !this.awaitingRoll &&
      interactiveRollIds.length > 0 &&
      interactiveRollIds.every((rollId) => {
        const state = this.states.get(rollId);
        if (!state) {
          return false;
        }
        return state.phase === 'idle' || state.phase === 'settled';
      });

    if (nextReady === this.interactionReady) {
      return;
    }

    this.interactionReady = nextReady;
    if (nextReady) {
      this.emitTrayEvent('dice-tray:all-settled', undefined);
      return;
    }

    this.hoverRollId = null;
    this.emitTrayEvent('dice-tray:clear', undefined);
  }

  private isRollInteractive(rollId: string): boolean {
    if (!this.interactionReady) {
      return false;
    }
    const meta = this.rollMeta.get(rollId);
    if (!meta || !meta.selectable || meta.transient) {
      return false;
    }
    const roll = this.rollData.get(rollId);
    if (!roll || roll.used || roll.locked) {
      return false;
    }
    const state = this.states.get(rollId);
    if (!state) {
      return false;
    }
    return !state.inactive;
  }

  private reconcileSelectedRoll(): void {
    if (!this.selectedRollId) {
      return;
    }
    if (this.isRollInteractive(this.selectedRollId)) {
      return;
    }
    this.selectedRollId = null;
    this.renderer.setSelectedRollId(null);
    this.emitTrayEvent('dice-tray:clear', undefined);
  }

  private ensureRendererReady(): void {
    if (this.mode === 'sprite_2d' || this.rendererReady || this.rendererInitPromise || !this.trayCanvas) {
      return;
    }

    const initToken = ++this.rendererInitToken;
    this.rendererInitStartedAtMs = this.clockMs;
    this.rendererInitPromise = this.renderer
      .attach(this.trayCanvas)
      .then((ok) => {
        if (initToken !== this.rendererInitToken) {
          return false;
        }
        this.rendererReady = ok;
        if (!ok) {
          this.degradeMode('webgl_init');
        } else {
          this.renderer.setQualityPreset(this.qualityPreset);
        }
        return ok;
      })
      .finally(() => {
        if (initToken === this.rendererInitToken) {
          this.rendererInitPromise = null;
        }
      });
  }

  private ensureRapierReady(): void {
    if (this.mode !== 'three_rapier' || this.rapierReady || this.rapierInitPromise) {
      return;
    }

    this.rapierInitPromise = this.rapier
      .ensureReady()
      .then((ok) => {
        this.rapierReady = ok;
        if (!ok) {
          this.degradeMode('rapier_init');
        } else {
          this.rapier.syncRollIds(this.rollOrder);
        }
        return ok;
      })
      .finally(() => {
        this.rapierInitPromise = null;
      });
  }
}
