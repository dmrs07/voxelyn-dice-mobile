import type { AnimationDriver } from '../../anim/voxelyn-animation-adapter';
import type { CombatFxEvent, CombatState, CombatantState } from '../../domain/shared/types';

type RollFxState = {
  rollId: string;
  ownerId: string;
  phase: 'roll' | 'settle';
  remainingMs: number;
  faceId: string;
  queuedSettle: { faceId: string; durationMs: number } | null;
  boundEl: HTMLElement | null;
};

type PulseKind = 'hit' | 'heal';
type PulseFlavor =
  | 'damage'
  | 'heal'
  | 'status_buff'
  | 'status_debuff'
  | 'focus_gain'
  | 'focus_spend'
  | 'swap';

type PulseFxState = {
  id: string;
  targetId: string;
  kind: PulseKind;
  flavor: PulseFlavor;
  amount: number;
  remainingMs: number;
  boundEl: HTMLElement | null;
};

type CombatantBinding = {
  canvas: HTMLCanvasElement;
  visualKey: string;
  isEnemy: boolean;
};

const positiveStatuses = new Set(['block', 'dodge', 'inspired', 'charged', 'turret']);
const heavyDebuffStatuses = new Set(['stun', 'poison', 'bleed', 'fear']);

const pulseDuration = (kind: PulseKind, flavor: PulseFlavor, amount: number): number => {
  const base = kind === 'hit' ? 250 : 290;
  const perAmount = kind === 'hit' ? 18 : 16;
  const extra = Math.min(kind === 'hit' ? 220 : 200, Math.max(1, amount) * perAmount);

  const flavorMultiplier = (() => {
    if (flavor === 'swap') {
      return 0.85;
    }
    if (flavor === 'focus_gain' || flavor === 'focus_spend') {
      return 0.82;
    }
    if (flavor === 'status_buff') {
      return 0.9;
    }
    if (flavor === 'status_debuff') {
      return 1.05;
    }
    return 1;
  })();

  return Math.round((base + extra) * flavorMultiplier);
};

const pulseAmount = (kind: PulseKind, flavor: PulseFlavor, amount: number): number => {
  const normalized = Math.max(1, amount);
  if (flavor === 'swap') {
    return 2;
  }
  if (flavor === 'focus_gain' || flavor === 'focus_spend') {
    return Math.min(2, normalized + 1);
  }
  if (kind === 'heal' && flavor === 'status_buff') {
    return Math.max(1, Math.floor(normalized * 0.8));
  }
  if (kind === 'hit' && flavor === 'status_debuff') {
    return Math.min(6, normalized + 1);
  }
  return normalized;
};

const deriveVisualKey = (combatant: CombatantState): string => {
  if (combatant.visualKey) {
    return combatant.visualKey;
  }

  if (!combatant.isEnemy) {
    return `party:${combatant.classId ?? 'default'}`;
  }

  if (combatant.tags.includes('machine')) {
    return 'enemy:machine';
  }
  if (combatant.tags.includes('cult')) {
    return 'enemy:cult';
  }
  if (combatant.tags.includes('beast')) {
    return 'enemy:beast';
  }
  return 'enemy:default';
};

export class CombatFxController {
  private readonly driver: AnimationDriver;

  private combatId: string | null = null;

  private root: HTMLElement | null = null;

  private rollElements = new Map<string, HTMLElement>();

  private targetElements = new Map<string, HTMLElement>();

  private targetCanvases = new Map<string, HTMLCanvasElement>();

  private rollStates = new Map<string, RollFxState>();

  private pulseStates: PulseFxState[] = [];

  private idleTargets = new Set<string>();

  private idleBindings = new Map<string, HTMLElement>();

  private combatantVisuals = new Map<string, { visualKey: string; isEnemy: boolean; alive: boolean }>();

  private combatantBindings = new Map<string, CombatantBinding>();

  private pulseSerial = 0;

  public constructor(driver: AnimationDriver) {
    this.driver = driver;
  }

  public setCombatId(combatId: string | null): void {
    if (this.combatId === combatId) {
      return;
    }

    this.resetInternalState();
    this.combatId = combatId;
  }

  public attach(root: HTMLElement): void {
    this.root = root;
    this.rebuildElementIndex();
    this.rebindCombatants();
    this.rebindIdle();
    this.rebindRolls();
    this.rebindPulses();
  }

  public syncCombatants(combat: CombatState): void {
    if (!this.combatId || combat.id !== this.combatId) {
      return;
    }

    const next = new Map<string, { visualKey: string; isEnemy: boolean; alive: boolean }>();

    for (const entry of combat.party) {
      next.set(entry.id, {
        visualKey: deriveVisualKey(entry),
        isEnemy: false,
        alive: entry.alive,
      });
    }

    for (const entry of combat.enemies) {
      next.set(entry.id, {
        visualKey: deriveVisualKey(entry),
        isEnemy: true,
        alive: entry.alive,
      });
    }

    for (const [entityId] of this.combatantVisuals) {
      if (!next.has(entityId)) {
        this.driver.unregisterCombatant(entityId);
        this.combatantBindings.delete(entityId);
      }
    }

    this.combatantVisuals = next;
    this.rebindCombatants();

    for (const [entityId, descriptor] of this.combatantVisuals) {
      if (descriptor.alive) {
        this.driver.setCombatantIntent(entityId, 'idle');
      } else {
        this.driver.setCombatantIntent(entityId, 'die');
      }
    }
  }

  public enqueue(events: CombatFxEvent[]): void {
    if (!this.combatId || events.length === 0) {
      return;
    }

    for (const event of events) {
      if (event.type === 'die_roll') {
        this.rollStates.set(event.rollId, {
          rollId: event.rollId,
          ownerId: event.ownerId,
          phase: 'roll',
          remainingMs: Math.max(120, event.durationMs),
          faceId: '0',
          queuedSettle: null,
          boundEl: null,
        });
        this.driver.setCombatantIntent(event.ownerId, 'cast', event.durationMs);
        continue;
      }

      if (event.type === 'die_settle') {
        const existing = this.rollStates.get(event.rollId);
        if (existing && existing.phase === 'roll' && existing.remainingMs > 0) {
          existing.queuedSettle = {
            faceId: event.faceId,
            durationMs: Math.max(120, event.durationMs),
          };
        } else {
          this.rollStates.set(event.rollId, {
            rollId: event.rollId,
            ownerId: event.ownerId,
            phase: 'settle',
            remainingMs: Math.max(120, event.durationMs),
            faceId: event.faceId,
            queuedSettle: null,
            boundEl: null,
          });
        }
        this.driver.setCombatantIntent(event.ownerId, 'attack', event.durationMs);
        continue;
      }

      if (event.type === 'hit') {
        this.pushPulse(event.targetId, 'hit', 'damage', Math.max(1, event.amount));
        this.driver.setCombatantIntent(event.targetId, 'hit');
        continue;
      }

      if (event.type === 'heal') {
        this.pushPulse(event.targetId, 'heal', 'heal', Math.max(1, event.amount));
        this.driver.setCombatantIntent(event.targetId, 'cast');
        continue;
      }

      if (event.type === 'status') {
        const amount = Math.max(1, Math.abs(event.stacks));
        const positiveById = positiveStatuses.has(event.statusId);
        const kind: PulseKind = event.stacks < 0 ? 'hit' : positiveById ? 'heal' : 'hit';
        const flavor: PulseFlavor = positiveById ? 'status_buff' : 'status_debuff';
        const weightedAmount =
          !positiveById && heavyDebuffStatuses.has(event.statusId) ? amount + 1 : amount;
        this.pushPulse(event.targetId, kind, flavor, weightedAmount);
        this.driver.setCombatantIntent(event.targetId, kind === 'hit' ? 'hit' : 'cast');
        continue;
      }

      if (event.type === 'swap') {
        this.pushPulse(event.aId, 'hit', 'swap', 1);
        this.pushPulse(event.bId, 'hit', 'swap', 1);
        this.driver.setCombatantIntent(event.aId, 'move', 220);
        this.driver.setCombatantIntent(event.bId, 'move', 220);
        continue;
      }

      if (event.type === 'focus') {
        const kind: PulseKind = event.delta < 0 ? 'hit' : 'heal';
        const flavor: PulseFlavor = event.delta < 0 ? 'focus_spend' : 'focus_gain';
        this.pushPulse(event.ownerId, kind, flavor, Math.max(1, Math.abs(event.delta)));
        this.driver.setCombatantIntent(event.ownerId, kind === 'hit' ? 'hit' : 'cast');
        continue;
      }

      if (event.type === 'idle') {
        if (event.enabled) {
          this.idleTargets.add(event.targetId);
          this.driver.setCombatantIntent(event.targetId, 'idle');
        } else {
          this.idleTargets.delete(event.targetId);
          const bound = this.idleBindings.get(event.targetId);
          if (bound) {
            this.driver.stopIdle(bound);
          }
          this.idleBindings.delete(event.targetId);
        }
      }
    }

    this.rebindRolls();
    this.rebindPulses();
    this.rebindIdle();
  }

  public tick(dtMs: number): void {
    if (!this.combatId) {
      return;
    }

    const frameDt = Math.max(0, Math.min(80, dtMs));

    for (const [rollId, state] of this.rollStates) {
      state.remainingMs -= frameDt;
      if (state.remainingMs > 0) {
        continue;
      }

      if (state.phase === 'roll' && state.queuedSettle) {
        state.phase = 'settle';
        state.remainingMs = state.queuedSettle.durationMs;
        state.faceId = state.queuedSettle.faceId;
        state.queuedSettle = null;
        state.boundEl = null;
        this.rebindRollState(state);
        continue;
      }

      this.rollStates.delete(rollId);
    }

    const nextPulses: PulseFxState[] = [];
    for (const pulse of this.pulseStates) {
      pulse.remainingMs -= frameDt;
      if (pulse.remainingMs > 0) {
        nextPulses.push(pulse);
      }
    }
    this.pulseStates = nextPulses;

    this.rebindCombatants();
    this.rebindRolls();
    this.rebindPulses();
    this.rebindIdle();
  }

  private resetInternalState(): void {
    for (const el of this.idleBindings.values()) {
      this.driver.stopIdle(el);
    }

    for (const entityId of this.combatantBindings.keys()) {
      this.driver.unregisterCombatant(entityId);
    }

    this.root = null;
    this.rollElements.clear();
    this.targetElements.clear();
    this.targetCanvases.clear();
    this.rollStates.clear();
    this.pulseStates = [];
    this.idleTargets.clear();
    this.idleBindings.clear();
    this.combatantVisuals.clear();
    this.combatantBindings.clear();
  }

  private rebuildElementIndex(): void {
    this.rollElements.clear();
    this.targetElements.clear();
    this.targetCanvases.clear();

    if (!this.root) {
      return;
    }

    this.root.querySelectorAll<HTMLElement>('[data-roll-id]').forEach((el) => {
      const rollId = el.dataset.rollId;
      if (!rollId) {
        return;
      }
      this.rollElements.set(rollId, el);
    });

    this.root.querySelectorAll<HTMLElement>('[data-target-id]').forEach((el) => {
      const targetId = el.dataset.targetId;
      if (!targetId) {
        return;
      }
      this.targetElements.set(targetId, el);

      const canvas = el.querySelector<HTMLCanvasElement>('.combatant-canvas');
      if (canvas) {
        this.targetCanvases.set(targetId, canvas);
      }
    });
  }

  private rebindCombatants(): void {
    for (const [entityId, descriptor] of this.combatantVisuals) {
      const canvas = this.targetCanvases.get(entityId);
      if (!canvas) {
        continue;
      }

      const bound = this.combatantBindings.get(entityId);
      if (
        bound &&
        bound.canvas === canvas &&
        bound.visualKey === descriptor.visualKey &&
        bound.isEnemy === descriptor.isEnemy
      ) {
        continue;
      }

      this.driver.registerCombatant(entityId, canvas, {
        visualKey: descriptor.visualKey,
        isEnemy: descriptor.isEnemy,
        width: 32,
        height: 32,
        facing: descriptor.isEnemy ? 'dl' : 'dr',
      });

      this.combatantBindings.set(entityId, {
        canvas,
        visualKey: descriptor.visualKey,
        isEnemy: descriptor.isEnemy,
      });
    }

    for (const [entityId] of this.combatantBindings) {
      if (!this.combatantVisuals.has(entityId)) {
        this.driver.unregisterCombatant(entityId);
        this.combatantBindings.delete(entityId);
      }
    }
  }

  private rebindRolls(): void {
    for (const state of this.rollStates.values()) {
      this.rebindRollState(state);
    }
  }

  private rebindRollState(state: RollFxState): void {
    const el = this.rollElements.get(state.rollId);
    if (!el || state.boundEl === el) {
      return;
    }

    if (state.phase === 'roll') {
      this.driver.playDiceRoll(el, state.remainingMs);
    } else {
      this.driver.playDiceSettle(el, state.faceId, state.remainingMs);
    }

    state.boundEl = el;
  }

  private rebindPulses(): void {
    for (const pulse of this.pulseStates) {
      const el = this.targetElements.get(pulse.targetId);
      if (!el || pulse.boundEl === el) {
        continue;
      }

      const fxAmount = pulseAmount(pulse.kind, pulse.flavor, pulse.amount);
      if (pulse.kind === 'hit') {
        this.driver.playHit(el, fxAmount);
      } else {
        this.driver.playHeal(el, fxAmount);
      }

      pulse.boundEl = el;
    }
  }

  private rebindIdle(): void {
    for (const targetId of this.idleTargets) {
      const el = this.targetElements.get(targetId);
      const bound = this.idleBindings.get(targetId);

      if (!el) {
        continue;
      }

      if (bound === el) {
        continue;
      }

      if (bound) {
        this.driver.stopIdle(bound);
      }

      this.driver.playIdle(el);
      this.idleBindings.set(targetId, el);
    }
  }

  private pushPulse(targetId: string, kind: PulseKind, flavor: PulseFlavor, amount: number): void {
    const state: PulseFxState = {
      id: `pulse_${this.pulseSerial}`,
      targetId,
      kind,
      flavor,
      amount,
      remainingMs: pulseDuration(kind, flavor, amount),
      boundEl: null,
    };
    this.pulseSerial += 1;
    this.pulseStates.push(state);
  }
}
