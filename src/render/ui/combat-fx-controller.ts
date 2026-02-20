import type { AnimationDriver } from '../../anim/voxelyn-animation-adapter';
import type { CombatFxEvent } from '../../domain/shared/types';

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

export class CombatFxController {
  private readonly driver: AnimationDriver;

  private combatId: string | null = null;

  private root: HTMLElement | null = null;

  private rollElements = new Map<string, HTMLElement>();

  private targetElements = new Map<string, HTMLElement>();

  private rollStates = new Map<string, RollFxState>();

  private pulseStates: PulseFxState[] = [];

  private idleTargets = new Set<string>();

  private idleBindings = new Map<string, HTMLElement>();

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
    this.rebindIdle();
    this.rebindRolls();
    this.rebindPulses();
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
        continue;
      }

      if (event.type === 'hit') {
        this.pushPulse(event.targetId, 'hit', 'damage', Math.max(1, event.amount));
        continue;
      }

      if (event.type === 'heal') {
        this.pushPulse(event.targetId, 'heal', 'heal', Math.max(1, event.amount));
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
        continue;
      }

      if (event.type === 'swap') {
        this.pushPulse(event.aId, 'hit', 'swap', 1);
        this.pushPulse(event.bId, 'hit', 'swap', 1);
        continue;
      }

      if (event.type === 'focus') {
        const kind: PulseKind = event.delta < 0 ? 'hit' : 'heal';
        const flavor: PulseFlavor = event.delta < 0 ? 'focus_spend' : 'focus_gain';
        this.pushPulse(event.ownerId, kind, flavor, Math.max(1, Math.abs(event.delta)));
        continue;
      }

      if (event.type === 'idle') {
        if (event.enabled) {
          this.idleTargets.add(event.targetId);
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

    this.rebindRolls();
    this.rebindPulses();
    this.rebindIdle();
  }

  private resetInternalState(): void {
    for (const el of this.idleBindings.values()) {
      this.driver.stopIdle(el);
    }

    this.root = null;
    this.rollElements.clear();
    this.targetElements.clear();
    this.rollStates.clear();
    this.pulseStates = [];
    this.idleTargets.clear();
    this.idleBindings.clear();
  }

  private rebuildElementIndex(): void {
    this.rollElements.clear();
    this.targetElements.clear();

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
    });
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
