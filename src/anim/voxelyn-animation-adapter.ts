import * as VoxAnim from '@voxelyn/animation';
import type {
  AnimationFacing,
  AnimationIntent,
  AnimationPlayer,
  ProceduralCharacterDef,
} from '@voxelyn/animation';
import {
  loadCombatantAnimationSet,
  resolveCombatantFallbackStyle,
} from '../render/pixel/asset-loader';
import { COMBATANT_INTERNAL_PX } from '../render/pixel/constants';
import type { CombatantEmotionState } from '../render/pixel/types';

export interface CombatantRegistrationOptions {
  visualKey: string;
  isEnemy?: boolean;
  width?: number;
  height?: number;
  seedHint?: string;
  facing?: AnimationFacing;
  state?: CombatantEmotionState;
}

export interface AnimationDriver {
  update(dtMs: number): void;
  playDiceRoll(el: HTMLElement, durationMs: number): void;
  playDiceSettle(el: HTMLElement, faceId: string, durationMs: number): void;
  playHit(el: HTMLElement, amount: number): void;
  playHeal(el: HTMLElement, amount: number): void;
  playIdle(el: HTMLElement): void;
  stopIdle(el: HTMLElement): void;
  registerCombatant(entityId: string, canvas: HTMLCanvasElement, options: CombatantRegistrationOptions): void;
  unregisterCombatant(entityId: string): void;
  setCombatantIntent(entityId: string, intent: AnimationIntent, durationMs?: number): void;
}

type CompositeState = {
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
  roll: boolean;
  hit: boolean;
  heal: boolean;
  idle: boolean;
};

type RollMotion = {
  kind: 'roll' | 'settle';
  elapsedMs: number;
  durationMs: number;
  settleDeg: number;
  spinDeg: number;
  spinJitterDeg: number;
  rollScaleBoost: number;
  rollBouncePx: number;
  settleOvershootDeg: number;
  settleWobbleDeg: number;
  settleScaleBoost: number;
  player: AnimationPlayer;
};

type PulseMotion = {
  kind: 'hit' | 'heal';
  elapsedMs: number;
  durationMs: number;
  amount: number;
  amplitudePx: number;
  scaleBoost: number;
  rotationJitterDeg: number;
  flashAlpha: number;
  player: AnimationPlayer;
};

type IdleMotion = {
  phaseOffset: number;
  player: AnimationPlayer;
};

type CombatantMotion = {
  entityId: string;
  visualKey: string;
  isEnemy: boolean;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  player: AnimationPlayer;
  facing: AnimationFacing;
  width: number;
  height: number;
  state: CombatantEmotionState;
  desiredIntent: AnimationIntent;
  intentUntilMs: number;
  stickyIntent: AnimationIntent | null;
  generation: number;
  imageData: ImageData | null;
};

const requiredExports = ['createAnimationPlayer', 'createProceduralCharacter', 'stepAnimation'] as const;

const FX_TUNING = {
  idle: {
    bobPx: 1.7,
    bobPeriodMs: 240,
    scalePulse: 0.012,
  },
  roll: {
    minMs: 150,
    maxMs: 380,
    spinDeg: 1080,
    spinJitterDeg: 18,
    scaleBoost: 0.11,
    bouncePx: 2.2,
  },
  settle: {
    minMs: 150,
    maxMs: 430,
    overshootDeg: 210,
    wobbleDeg: 8,
    scaleBoost: 0.07,
  },
  hit: {
    baseMs: 180,
    perAmountMs: 24,
    maxExtraMs: 240,
    baseAmplitudePx: 4.4,
    perAmountAmplitudePx: 0.52,
    maxAmplitudePx: 8.2,
    baseScaleBoost: 0.045,
    perAmountScaleBoost: 0.005,
    maxScaleBoost: 0.09,
    baseRotationDeg: 2.4,
    perAmountRotationDeg: 0.3,
    maxRotationDeg: 6.8,
    maxFlashAlpha: 0.28,
  },
  heal: {
    baseMs: 220,
    perAmountMs: 22,
    maxExtraMs: 220,
    baseAmplitudePx: 3.8,
    perAmountAmplitudePx: 0.46,
    maxAmplitudePx: 7.6,
    baseScaleBoost: 0.038,
    perAmountScaleBoost: 0.004,
    maxScaleBoost: 0.075,
    baseRotationDeg: 1.4,
    perAmountRotationDeg: 0.2,
    maxRotationDeg: 4.2,
    maxFlashAlpha: 0.22,
  },
} as const;

export const assertVoxelynAnimationApi = (): void => {
  const moduleView = VoxAnim as Record<string, unknown>;
  const missing = requiredExports.filter((name) => typeof moduleView[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(
      `Falha no bootstrap de animacao: @voxelyn/animation sem exports obrigatorios (${missing.join(', ')}).`,
    );
  }
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const faceToRotationDeg = (faceId: string): number => {
  const numeric = Number(faceId.replace(/[^0-9]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    const table = [0, 90, 180, 270, 45, 135];
    return table[(Math.floor(numeric) - 1) % table.length] ?? 0;
  }
  return hashString(faceId) % 360;
};

const clampDuration = (value: number, minMs: number, maxMs: number): number =>
  Math.max(minMs, Math.min(maxMs, value));

const pulseDurationMs = (kind: 'hit' | 'heal', amount: number): number => {
  const abs = Math.max(1, amount);
  const profile = kind === 'hit' ? FX_TUNING.hit : FX_TUNING.heal;
  const extra = Math.min(profile.maxExtraMs, abs * profile.perAmountMs);
  return profile.baseMs + extra;
};

const pulseVisualProfile = (kind: 'hit' | 'heal', amount: number): Pick<
  PulseMotion,
  'amplitudePx' | 'scaleBoost' | 'rotationJitterDeg' | 'flashAlpha'
> => {
  const abs = Math.max(1, amount);
  const profile = kind === 'hit' ? FX_TUNING.hit : FX_TUNING.heal;
  return {
    amplitudePx: Math.min(
      profile.maxAmplitudePx,
      profile.baseAmplitudePx + abs * profile.perAmountAmplitudePx,
    ),
    scaleBoost: Math.min(profile.maxScaleBoost, profile.baseScaleBoost + abs * profile.perAmountScaleBoost),
    rotationJitterDeg: Math.min(
      profile.maxRotationDeg,
      profile.baseRotationDeg + abs * profile.perAmountRotationDeg,
    ),
    flashAlpha: Math.min(profile.maxFlashAlpha, 0.08 + abs * 0.02),
  };
};

const getComposite = (target: Map<HTMLElement, CompositeState>, el: HTMLElement): CompositeState => {
  const existing = target.get(el);
  if (existing) {
    return existing;
  }

  const created: CompositeState = {
    x: 0,
    y: 0,
    rot: 0,
    scale: 1,
    opacity: 1,
    roll: false,
    hit: false,
    heal: false,
    idle: false,
  };
  target.set(el, created);
  return created;
};

const clearElementFx = (el: HTMLElement): void => {
  el.style.setProperty('--fx-x', '0px');
  el.style.setProperty('--fx-y', '0px');
  el.style.setProperty('--fx-rot', '0deg');
  el.style.setProperty('--fx-scale', '1');
  el.style.setProperty('--fx-opacity', '1');
  el.classList.remove('fx-roll', 'fx-hit', 'fx-heal', 'fx-idle');
};

const pickIntent = (kind: 'hit' | 'heal'): AnimationIntent => (kind === 'hit' ? 'hit' : 'cast');

const styleFor = (kind: 'idle' | 'roll' | 'pulse'): NonNullable<ProceduralCharacterDef['style']> => {
  if (kind === 'idle') {
    return 'player';
  }
  if (kind === 'roll') {
    return 'stalker';
  }
  return 'guardian';
};

const isValidFacing = (value: string): value is AnimationFacing =>
  value === 'dr' || value === 'dl' || value === 'ur' || value === 'ul';

const defaultIntentDuration = (intent: AnimationIntent): number => {
  if (intent === 'hit') {
    return 220;
  }
  if (intent === 'attack' || intent === 'cast' || intent === 'move') {
    return 260;
  }
  return 0;
};

export const createVoxelynAnimationDriver = (): AnimationDriver => {
  assertVoxelynAnimationApi();

  let serial = 0;
  let clockMs = 0;

  const makePlayer = (kind: 'idle' | 'roll' | 'pulse', seedHint: string): AnimationPlayer => {
    const procedural = VoxAnim.createProceduralCharacter({
      id: `fx_${kind}_${seedHint}_${serial}`,
      seed: hashString(`${kind}:${seedHint}:${serial}`),
      style: styleFor(kind),
    });
    serial += 1;

    return VoxAnim.createAnimationPlayer({
      set: procedural.clips,
      width: procedural.width,
      height: procedural.height,
      seed: procedural.seed,
    });
  };

  const makeCombatantPlayer = (
    entityId: string,
    visualKey: string,
    isEnemy: boolean,
    width: number,
    height: number,
    seedHint: string,
    styleHint?: ProceduralCharacterDef['style'],
  ): AnimationPlayer => {
    const procedural = VoxAnim.createProceduralCharacter({
      id: `combat_${entityId}_${serial}`,
      seed: hashString(`${visualKey}:${seedHint}:${serial}`),
      width,
      height,
      style: styleHint ?? resolveCombatantFallbackStyle(visualKey, isEnemy),
    });
    serial += 1;

    return VoxAnim.createAnimationPlayer({
      set: procedural.clips,
      width: procedural.width,
      height: procedural.height,
      seed: procedural.seed,
    });
  };

  const knownElements = new Set<HTMLElement>();
  const rollStates = new Map<HTMLElement, RollMotion>();
  const pulseStates = new Map<HTMLElement, PulseMotion>();
  const idleStates = new Map<HTMLElement, IdleMotion>();
  const combatantStates = new Map<string, CombatantMotion>();

  const drawCombatant = (state: CombatantMotion, dtMs: number): void => {
    const intent =
      state.stickyIntent === 'die'
        ? 'die'
        : state.intentUntilMs > clockMs
          ? state.desiredIntent
          : 'idle';

    if (intent === 'idle' && state.desiredIntent !== 'idle' && state.stickyIntent !== 'die') {
      state.desiredIntent = 'idle';
    }

    const frame = VoxAnim.stepAnimation(state.player, dtMs, intent, state.facing);
    const sprite = frame.sprite;

    if (state.canvas.width !== sprite.width || state.canvas.height !== sprite.height) {
      state.canvas.width = sprite.width;
      state.canvas.height = sprite.height;
      state.imageData = null;
      state.ctx.imageSmoothingEnabled = false;
    }

    if (!state.imageData || state.imageData.width !== sprite.width || state.imageData.height !== sprite.height) {
      state.imageData = state.ctx.createImageData(sprite.width, sprite.height);
    }

    const spriteBytes = new Uint8ClampedArray(
      sprite.pixels.buffer,
      sprite.pixels.byteOffset,
      sprite.width * sprite.height * 4,
    );
    state.imageData.data.set(spriteBytes);
    state.ctx.putImageData(state.imageData, 0, 0);
  };

  const purgeDisconnected = (): void => {
    for (const el of Array.from(knownElements)) {
      if (el.isConnected) {
        continue;
      }
      knownElements.delete(el);
      rollStates.delete(el);
      pulseStates.delete(el);
      idleStates.delete(el);
    }

    for (const [entityId, state] of combatantStates) {
      if (!state.canvas.isConnected) {
        combatantStates.delete(entityId);
      }
    }
  };

  const updateIdle = (dtMs: number, composed: Map<HTMLElement, CompositeState>): void => {
    for (const [el, state] of idleStates) {
      if (!el.isConnected) {
        idleStates.delete(el);
        continue;
      }
      const frame = VoxAnim.stepAnimation(state.player, dtMs, 'idle', 'dr');
      const channel = getComposite(composed, el);

      const bob =
        Math.sin((state.player.totalMs + state.phaseOffset) / FX_TUNING.idle.bobPeriodMs) *
        FX_TUNING.idle.bobPx;
      channel.y += bob;
      channel.scale *= 1 + ((frame.frameIndex % 2) * FX_TUNING.idle.scalePulse);
      channel.idle = true;
    }
  };

  const updateRoll = (dtMs: number, composed: Map<HTMLElement, CompositeState>): void => {
    for (const [el, state] of rollStates) {
      if (!el.isConnected) {
        rollStates.delete(el);
        continue;
      }

      state.elapsedMs += dtMs;
      const progress = clamp01(state.elapsedMs / Math.max(1, state.durationMs));
      const intent: AnimationIntent = state.kind === 'roll' ? 'move' : 'attack';
      const frame = VoxAnim.stepAnimation(state.player, dtMs, intent, 'dr');
      const channel = getComposite(composed, el);

      if (state.kind === 'roll') {
        channel.rot +=
          (1 - progress) * state.spinDeg + ((frame.frameIndex % 4) * state.spinJitterDeg);
        channel.scale *= 1 + ((1 - progress) * state.rollScaleBoost);
        channel.y += -Math.sin(progress * Math.PI) * state.rollBouncePx;
      } else {
        channel.rot +=
          state.settleDeg +
          ((1 - progress) * state.settleOvershootDeg) +
          ((frame.frameIndex % 3) * state.settleWobbleDeg);
        channel.scale *= 1 + (Math.sin((1 - progress) * Math.PI) * state.settleScaleBoost);
      }
      channel.roll = true;

      if (progress >= 1) {
        rollStates.delete(el);
      }
    }
  };

  const updatePulse = (dtMs: number, composed: Map<HTMLElement, CompositeState>): void => {
    for (const [el, state] of pulseStates) {
      if (!el.isConnected) {
        pulseStates.delete(el);
        continue;
      }

      state.elapsedMs += dtMs;
      const progress = clamp01(state.elapsedMs / Math.max(1, state.durationMs));
      const frame = VoxAnim.stepAnimation(state.player, dtMs, pickIntent(state.kind), 'dr');
      const channel = getComposite(composed, el);

      if (state.kind === 'hit') {
        channel.x +=
          Math.sin((1 - progress) * 18 + frame.frameIndex) * (state.amplitudePx * (1 - progress));
        channel.rot +=
          Math.sin((1 - progress) * Math.PI * 2 + frame.frameIndex) *
          (state.rotationJitterDeg * (1 - progress));
        channel.scale *= 1 + ((1 - progress) * state.scaleBoost);
        channel.opacity *= 1 - (state.flashAlpha * (1 - progress));
        channel.hit = true;
      } else {
        channel.y += -Math.sin(progress * Math.PI) * state.amplitudePx;
        channel.rot +=
          Math.sin(progress * Math.PI * 2 + frame.frameIndex) * state.rotationJitterDeg;
        channel.scale *= 1 + (Math.sin(progress * Math.PI) * state.scaleBoost);
        channel.opacity *= 1 - (state.flashAlpha * Math.sin(progress * Math.PI) * 0.5);
        channel.heal = true;
      }

      if (progress >= 1) {
        pulseStates.delete(el);
      }
    }
  };

  const updateCombatants = (dtMs: number): void => {
    for (const [entityId, state] of combatantStates) {
      if (!state.canvas.isConnected) {
        combatantStates.delete(entityId);
        continue;
      }
      drawCombatant(state, dtMs);
    }
  };

  const applyComposed = (composed: Map<HTMLElement, CompositeState>): void => {
    for (const [el, state] of composed) {
      knownElements.add(el);
      const opacity = Math.max(0.55, Math.min(1, state.opacity));
      el.style.setProperty('--fx-x', `${state.x.toFixed(2)}px`);
      el.style.setProperty('--fx-y', `${state.y.toFixed(2)}px`);
      el.style.setProperty('--fx-rot', `${state.rot.toFixed(2)}deg`);
      el.style.setProperty('--fx-scale', `${state.scale.toFixed(4)}`);
      el.style.setProperty('--fx-opacity', `${opacity.toFixed(3)}`);
      el.classList.toggle('fx-roll', state.roll);
      el.classList.toggle('fx-hit', state.hit);
      el.classList.toggle('fx-heal', state.heal);
      el.classList.toggle('fx-idle', state.idle);
    }

    for (const el of knownElements) {
      if (!el.isConnected) {
        continue;
      }
      if (!composed.has(el)) {
        clearElementFx(el);
      }
    }
  };

  return {
    update(dtMs: number): void {
      const frameDt = Math.max(0, Math.min(80, dtMs));
      clockMs += frameDt;
      purgeDisconnected();

      const composed = new Map<HTMLElement, CompositeState>();
      updateIdle(frameDt, composed);
      updateRoll(frameDt, composed);
      updatePulse(frameDt, composed);
      updateCombatants(frameDt);
      applyComposed(composed);
    },

    playDiceRoll(el: HTMLElement, durationMs: number): void {
      knownElements.add(el);
      rollStates.set(el, {
        kind: 'roll',
        elapsedMs: 0,
        durationMs: clampDuration(durationMs, FX_TUNING.roll.minMs, FX_TUNING.roll.maxMs),
        settleDeg: 0,
        spinDeg: FX_TUNING.roll.spinDeg,
        spinJitterDeg: FX_TUNING.roll.spinJitterDeg,
        rollScaleBoost: FX_TUNING.roll.scaleBoost,
        rollBouncePx: FX_TUNING.roll.bouncePx,
        settleOvershootDeg: FX_TUNING.settle.overshootDeg,
        settleWobbleDeg: FX_TUNING.settle.wobbleDeg,
        settleScaleBoost: FX_TUNING.settle.scaleBoost,
        player: makePlayer('roll', el.dataset.rollId ?? 'roll'),
      });
    },

    playDiceSettle(el: HTMLElement, faceId: string, durationMs: number): void {
      knownElements.add(el);
      const current = rollStates.get(el);
      if (current) {
        current.kind = 'settle';
        current.elapsedMs = 0;
        current.durationMs = clampDuration(durationMs, FX_TUNING.settle.minMs, FX_TUNING.settle.maxMs);
        current.settleDeg = faceToRotationDeg(faceId);
        current.settleOvershootDeg = FX_TUNING.settle.overshootDeg;
        current.settleWobbleDeg = FX_TUNING.settle.wobbleDeg;
        current.settleScaleBoost = FX_TUNING.settle.scaleBoost;
        return;
      }

      rollStates.set(el, {
        kind: 'settle',
        elapsedMs: 0,
        durationMs: clampDuration(durationMs, FX_TUNING.settle.minMs, FX_TUNING.settle.maxMs),
        settleDeg: faceToRotationDeg(faceId),
        spinDeg: FX_TUNING.roll.spinDeg,
        spinJitterDeg: FX_TUNING.roll.spinJitterDeg,
        rollScaleBoost: FX_TUNING.roll.scaleBoost,
        rollBouncePx: FX_TUNING.roll.bouncePx,
        settleOvershootDeg: FX_TUNING.settle.overshootDeg,
        settleWobbleDeg: FX_TUNING.settle.wobbleDeg,
        settleScaleBoost: FX_TUNING.settle.scaleBoost,
        player: makePlayer('roll', el.dataset.rollId ?? faceId),
      });
    },

    playHit(el: HTMLElement, amount: number): void {
      knownElements.add(el);
      const profile = pulseVisualProfile('hit', amount);
      pulseStates.set(el, {
        kind: 'hit',
        elapsedMs: 0,
        durationMs: pulseDurationMs('hit', amount),
        amount,
        amplitudePx: profile.amplitudePx,
        scaleBoost: profile.scaleBoost,
        rotationJitterDeg: profile.rotationJitterDeg,
        flashAlpha: profile.flashAlpha,
        player: makePlayer('pulse', `${el.dataset.targetId ?? 'target'}_hit`),
      });
    },

    playHeal(el: HTMLElement, amount: number): void {
      knownElements.add(el);
      const profile = pulseVisualProfile('heal', amount);
      pulseStates.set(el, {
        kind: 'heal',
        elapsedMs: 0,
        durationMs: pulseDurationMs('heal', amount),
        amount,
        amplitudePx: profile.amplitudePx,
        scaleBoost: profile.scaleBoost,
        rotationJitterDeg: profile.rotationJitterDeg,
        flashAlpha: profile.flashAlpha,
        player: makePlayer('pulse', `${el.dataset.targetId ?? 'target'}_heal`),
      });
    },

    playIdle(el: HTMLElement): void {
      knownElements.add(el);
      if (idleStates.has(el)) {
        return;
      }
      idleStates.set(el, {
        phaseOffset: hashString(el.dataset.targetId ?? el.dataset.rollId ?? String(serial)) % 400,
        player: makePlayer('idle', el.dataset.targetId ?? 'idle'),
      });
    },

    stopIdle(el: HTMLElement): void {
      idleStates.delete(el);
      if (!rollStates.has(el) && !pulseStates.has(el)) {
        clearElementFx(el);
      }
    },

    registerCombatant(entityId: string, canvas: HTMLCanvasElement, options: CombatantRegistrationOptions): void {
      const width = Math.max(16, Math.floor(options.width ?? COMBATANT_INTERNAL_PX));
      const height = Math.max(16, Math.floor(options.height ?? COMBATANT_INTERNAL_PX));
      const isEnemy = options.isEnemy ?? false;
      const facing = options.facing ?? (isEnemy ? 'dl' : 'dr');
      const state = options.state ?? 'neutro';
      const seedHint = options.seedHint ?? `${options.visualKey}:${state}`;

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        return;
      }

      canvas.width = width;
      canvas.height = height;
      canvas.style.imageRendering = 'pixelated';
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);

      const nextGeneration = (combatantStates.get(entityId)?.generation ?? 0) + 1;
      const motion: CombatantMotion = {
        entityId,
        visualKey: options.visualKey,
        isEnemy,
        canvas,
        ctx,
        player: makeCombatantPlayer(
          entityId,
          options.visualKey,
          isEnemy,
          width,
          height,
          seedHint,
        ),
        facing: isValidFacing(facing) ? facing : 'dr',
        width,
        height,
        state,
        desiredIntent: 'idle',
        intentUntilMs: 0,
        stickyIntent: null,
        generation: nextGeneration,
        imageData: null,
      };

      combatantStates.set(entityId, motion);

      void loadCombatantAnimationSet(options.visualKey, {
        isEnemy,
        width,
        height,
        state,
      }).then((resolved) => {
        if (!resolved) {
          return;
        }

        const current = combatantStates.get(entityId);
        if (!current || current.generation !== nextGeneration) {
          return;
        }

        current.player = VoxAnim.createAnimationPlayer({
          set: resolved.set,
          width: resolved.width,
          height: resolved.height,
          seed: hashString(
            `${entityId}:${options.visualKey}:${state}:${resolved.styleHint ?? 'clip'}`,
          ),
        });
        current.facing = resolved.facing;
        current.canvas.width = resolved.width;
        current.canvas.height = resolved.height;
        current.imageData = null;
      });
    },

    unregisterCombatant(entityId: string): void {
      const state = combatantStates.get(entityId);
      if (!state) {
        return;
      }
      state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
      combatantStates.delete(entityId);
    },

    setCombatantIntent(entityId: string, intent: AnimationIntent, durationMs?: number): void {
      const state = combatantStates.get(entityId);
      if (!state) {
        return;
      }

      if (intent === 'die') {
        state.desiredIntent = 'die';
        state.stickyIntent = 'die';
        state.intentUntilMs = Number.POSITIVE_INFINITY;
        return;
      }

      state.stickyIntent = null;
      state.desiredIntent = intent;
      const defaultMs = defaultIntentDuration(intent);
      const finalDuration = clampDuration(durationMs ?? defaultMs, 0, 1200);
      state.intentUntilMs = finalDuration > 0 ? clockMs + finalDuration : 0;
    },
  };
};
