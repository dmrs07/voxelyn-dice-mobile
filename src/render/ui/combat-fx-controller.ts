import type { AnimationDriver } from '../../anim/voxelyn-animation-adapter';
import type {
  CombatFxEvent,
  CombatState,
  CombatantState,
  DieDef,
  StatusId,
} from '../../domain/shared/types';
import { COMBATANT_INTERNAL_PX } from '../pixel/constants';
import type { CombatantEmotionState } from '../pixel/types';
import { DiceCubeRuntime, type DiceCubeDiagnostics } from '../voxelyn/dice-cube-runtime';
import { getStatusFxSprite } from '../voxelyn/status-fx-sprites';
import type { StatusFxTier } from './status-fx-defs';
import {
  STATUS_FX_CLASS_NAMES,
  STATUS_FX_CSS_VARS,
  STATUS_FX_DEFS,
  STATUS_FX_LAYER_ORDER,
  resolveStatusFxCadence,
  resolveStatusFxParticles,
  resolveStatusFxTier,
} from './status-fx-defs';

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
  state: CombatantEmotionState;
};

type ActiveStatusFx = {
  id: StatusId;
  stacks: number;
  tier: StatusFxTier;
  particles: number;
  cadenceMs: number;
};

const positiveStatuses = new Set(['block', 'dodge', 'inspired', 'charged', 'turret']);
const heavyDebuffStatuses = new Set(['stun', 'poison', 'burn', 'bleed', 'fear']);
const cursedStatuses = new Set(['stun', 'fear', 'poison', 'burn', 'bleed']);
const statusCount = (combatant: CombatantState, statusId: string): number =>
  (combatant.statuses as Record<string, number>)[statusId] ?? 0;

const deriveEmotionState = (combatant: CombatantState): CombatantEmotionState => {
  for (const statusId of cursedStatuses) {
    if (statusCount(combatant, statusId) > 0) {
      return 'amaldicoado';
    }
  }

  for (const statusId of positiveStatuses) {
    if (statusCount(combatant, statusId) > 0) {
      return 'buffado';
    }
  }

  const hpRatio = combatant.maxHp > 0 ? combatant.hp / combatant.maxHp : 0;
  if (hpRatio <= 0.35) {
    return 'ferido';
  }

  return 'neutro';
};

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

  private readonly diceCubeRuntime: DiceCubeRuntime;

  private combatId: string | null = null;

  private root: HTMLElement | null = null;

  private rollElements = new Map<string, HTMLElement>();

  private targetElements = new Map<string, HTMLElement>();

  private targetCanvases = new Map<string, HTMLCanvasElement>();

  private statusHostsByTargetId = new Map<string, HTMLElement[]>();

  private statusSignatureByHost = new WeakMap<HTMLElement, string>();

  private rollStates = new Map<string, RollFxState>();

  private pulseStates: PulseFxState[] = [];

  private idleTargets = new Set<string>();

  private idleBindings = new Map<string, HTMLElement>();

  private combatantVisuals = new Map<
    string,
    { visualKey: string; isEnemy: boolean; alive: boolean; state: CombatantEmotionState }
  >();

  private combatantBindings = new Map<string, CombatantBinding>();

  private pulseSerial = 0;

  private enemyVisualLockMs = 0;

  public constructor(driver: AnimationDriver) {
    this.driver = driver;
    this.diceCubeRuntime = new DiceCubeRuntime();
  }

  public setCombatId(combatId: string | null): void {
    if (this.combatId === combatId) {
      return;
    }

    this.resetInternalState();
    this.combatId = combatId;
    this.diceCubeRuntime.setCombatId(combatId);
  }

  public attach(root: HTMLElement): void {
    this.root = root;
    this.rebuildElementIndex();
    this.diceCubeRuntime.attach(root);
    this.rebindCombatants();
    this.rebindIdle();
    this.rebindRolls();
    this.rebindPulses();
  }

  public syncCombatants(combat: CombatState): void {
    if (!this.combatId || combat.id !== this.combatId) {
      return;
    }

    const next = new Map<
      string,
      { visualKey: string; isEnemy: boolean; alive: boolean; state: CombatantEmotionState }
    >();

    for (const entry of combat.party) {
      next.set(entry.id, {
        visualKey: deriveVisualKey(entry),
        isEnemy: false,
        alive: entry.alive,
        state: deriveEmotionState(entry),
      });
    }

    for (const entry of combat.enemies) {
      next.set(entry.id, {
        visualKey: deriveVisualKey(entry),
        isEnemy: true,
        alive: entry.alive,
        state: deriveEmotionState(entry),
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
    this.syncStatusFx(combat);
    this.diceCubeRuntime.syncCombat(combat);

    for (const [entityId, descriptor] of this.combatantVisuals) {
      if (descriptor.alive) {
        this.driver.setCombatantIntent(entityId, 'idle');
      } else {
        this.driver.setCombatantIntent(entityId, 'die');
      }
    }
  }

  public syncUiSelection(selectedRollId: string | null): void {
    this.diceCubeRuntime.setSelectedRollId(selectedRollId);
  }

  public setDiceTrayQualityPreset(preset: 'performance' | 'quality'): void {
    this.diceCubeRuntime.setQualityPreset(preset);
  }

  public setDiceDefinitions(diceById: Record<string, DieDef>): void {
    this.diceCubeRuntime.setDieDefinitions(diceById);
  }

  public getDiceTrayDiagnostics(): DiceCubeDiagnostics {
    return this.diceCubeRuntime.getDiagnostics();
  }

  public enqueue(events: CombatFxEvent[]): void {
    if (!this.combatId || events.length === 0) {
      return;
    }
    this.diceCubeRuntime.enqueue(events);

    for (const event of events) {
      if (event.type === 'die_roll') {
        if (event.transient) {
          this.enemyVisualLockMs = Math.max(
            this.enemyVisualLockMs,
            Math.max(200, event.durationMs + 220),
          );
          this.diceCubeRuntime.setInteractionSuspended(true);
          this.driver.setCombatantIntent(event.ownerId, 'cast', event.durationMs);
          continue;
        }
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
        if (event.transient) {
          this.enemyVisualLockMs = Math.max(
            this.enemyVisualLockMs,
            Math.max(220, event.durationMs + 240),
          );
          this.diceCubeRuntime.setInteractionSuspended(true);
          this.driver.setCombatantIntent(event.ownerId, 'attack', event.durationMs);
          continue;
        }
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

      if (event.type === 'intent_telegraph') {
        this.enemyVisualLockMs = Math.max(
          this.enemyVisualLockMs,
          Math.max(220, event.durationMs + 180),
        );
        this.diceCubeRuntime.setInteractionSuspended(true);
        if (event.intentKind === 'attack') {
          this.driver.setCombatantIntent(event.ownerId, 'attack', event.durationMs);
        } else {
          this.driver.setCombatantIntent(event.ownerId, 'cast', event.durationMs);
        }
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
    if (this.enemyVisualLockMs > 0) {
      this.enemyVisualLockMs = Math.max(0, this.enemyVisualLockMs - frameDt);
      this.diceCubeRuntime.setInteractionSuspended(this.enemyVisualLockMs > 0);
    }

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
    this.diceCubeRuntime.tick(frameDt);
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
    this.statusHostsByTargetId.clear();
    this.statusSignatureByHost = new WeakMap<HTMLElement, string>();
    this.rollStates.clear();
    this.pulseStates = [];
    this.idleTargets.clear();
    this.idleBindings.clear();
    this.combatantVisuals.clear();
    this.combatantBindings.clear();
    this.enemyVisualLockMs = 0;
    this.diceCubeRuntime.setInteractionSuspended(false);
    this.diceCubeRuntime.setCombatId(null);
    this.diceCubeRuntime.setSelectedRollId(null);
  }

  private rebuildElementIndex(): void {
    this.rollElements.clear();
    this.targetElements.clear();
    this.targetCanvases.clear();
    this.statusHostsByTargetId.clear();

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
      const existing = this.targetElements.get(targetId);
      const existingIsStatusHost = existing?.dataset.statusHost === 'true';
      const nextIsStatusHost = el.dataset.statusHost === 'true';
      if (!existing || (!existingIsStatusHost && nextIsStatusHost)) {
        this.targetElements.set(targetId, el);
      }
    });

    for (const [targetId, el] of this.targetElements) {
      const canvas = el.querySelector<HTMLCanvasElement>('.combatant-canvas');
      if (canvas) {
        this.targetCanvases.set(targetId, canvas);
      }
    }

    this.root.querySelectorAll<HTMLElement>('[data-status-host][data-target-id]').forEach((el) => {
      const targetId = el.dataset.targetId;
      if (!targetId) {
        return;
      }
      const existing = this.statusHostsByTargetId.get(targetId);
      if (existing) {
        existing.push(el);
      } else {
        this.statusHostsByTargetId.set(targetId, [el]);
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
        bound.isEnemy === descriptor.isEnemy &&
        bound.state === descriptor.state
      ) {
        continue;
      }

      this.driver.registerCombatant(entityId, canvas, {
        visualKey: descriptor.visualKey,
        isEnemy: descriptor.isEnemy,
        width: COMBATANT_INTERNAL_PX,
        height: COMBATANT_INTERNAL_PX,
        facing: descriptor.isEnemy ? 'dl' : 'dr',
        state: descriptor.state,
      });

      this.combatantBindings.set(entityId, {
        canvas,
        visualKey: descriptor.visualKey,
        isEnemy: descriptor.isEnemy,
        state: descriptor.state,
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

  private syncStatusFx(combat: CombatState): void {
    const combatantsById = new Map<string, CombatantState>();
    for (const entry of combat.party) {
      combatantsById.set(entry.id, entry);
    }
    for (const entry of combat.enemies) {
      combatantsById.set(entry.id, entry);
    }

    for (const [targetId, hosts] of this.statusHostsByTargetId) {
      const activeStatuses = this.collectActiveStatuses(combatantsById.get(targetId));
      for (const host of hosts) {
        this.applyStatusFxToHost(host, activeStatuses);
      }
    }
  }

  private collectActiveStatuses(combatant: CombatantState | undefined): ActiveStatusFx[] {
    if (!combatant || !combatant.alive) {
      return [];
    }

    const active: ActiveStatusFx[] = [];
    for (const statusId of STATUS_FX_LAYER_ORDER) {
      const stacks = Math.max(0, Math.floor(Number(combatant.statuses[statusId] ?? 0)));
      if (stacks <= 0) {
        continue;
      }
      active.push({
        id: statusId,
        stacks,
        tier: resolveStatusFxTier(stacks),
        particles: resolveStatusFxParticles(statusId, stacks),
        cadenceMs: resolveStatusFxCadence(statusId, stacks),
      });
    }
    return active;
  }

  private applyStatusFxToHost(host: HTMLElement, activeStatuses: ActiveStatusFx[]): void {
    const signature = this.statusSignature(activeStatuses);
    if (this.statusSignatureByHost.get(host) === signature) {
      return;
    }
    this.statusSignatureByHost.set(host, signature);

    this.clearStatusFx(host);
    if (activeStatuses.length === 0) {
      return;
    }

    host.classList.add('has-status');
    const maxTier = activeStatuses.reduce<StatusFxTier>(
      (max, status) => (status.tier > max ? status.tier : max),
      1,
    );
    host.classList.add(`status-tier-${maxTier}`);
    host.style.setProperty('--status-max-tier', String(maxTier));

    const overlay = this.ensureStatusOverlay(host);
    overlay.replaceChildren();

    for (const status of activeStatuses) {
      const def = STATUS_FX_DEFS[status.id];
      host.classList.add(def.className);
      host.style.setProperty(def.cssVar, String(status.stacks));

      const node = document.createElement('div');
      node.className = `status-fx-node status-fx-${status.id} status-tier-${status.tier}`;
      node.dataset.statusId = status.id;
      node.style.zIndex = String(def.layer);
      node.style.setProperty('--status-stacks', String(status.stacks));
      node.style.setProperty('--status-particles', String(status.particles));
      node.style.setProperty('--status-cadence-ms', `${status.cadenceMs}ms`);

      const spriteCount = Math.max(1, status.particles);
      for (let index = 0; index < spriteCount; index += 1) {
        const sprite = document.createElement('img');
        sprite.className = 'status-fx-sprite';
        sprite.alt = '';
        sprite.draggable = false;
        sprite.decoding = 'async';
        sprite.src = getStatusFxSprite(status.id, `${status.id}-${status.tier}-${index}`);
        sprite.style.setProperty('--fx-index', String(index));
        sprite.style.setProperty('--fx-total', String(spriteCount));
        sprite.style.setProperty(
          '--fx-delay-ms',
          `${Math.round((status.cadenceMs / Math.max(1, spriteCount)) * index)}ms`,
        );
        node.appendChild(sprite);
      }

      overlay.appendChild(node);
    }
  }

  private clearStatusFx(host: HTMLElement): void {
    host.classList.remove('has-status', 'status-tier-1', 'status-tier-2', 'status-tier-3');
    host.classList.remove(...STATUS_FX_CLASS_NAMES);
    host.style.removeProperty('--status-max-tier');
    for (const cssVar of STATUS_FX_CSS_VARS) {
      host.style.removeProperty(cssVar);
    }

    const overlay = this.findStatusOverlay(host);
    if (overlay) {
      overlay.replaceChildren();
      overlay.remove();
    }
  }

  private statusSignature(activeStatuses: ActiveStatusFx[]): string {
    if (activeStatuses.length === 0) {
      return 'none';
    }
    return activeStatuses.map((status) => `${status.id}:${status.stacks}`).join('|');
  }

  private findStatusOverlay(host: HTMLElement): HTMLElement | null {
    for (const child of Array.from(host.children)) {
      if (child instanceof HTMLElement && child.classList.contains('status-fx-overlay')) {
        return child;
      }
    }
    return null;
  }

  private ensureStatusOverlay(host: HTMLElement): HTMLElement {
    const existing = this.findStatusOverlay(host);
    if (existing) {
      return existing;
    }

    const overlay = document.createElement('div');
    overlay.className = 'status-fx-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(overlay);
    return overlay;
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
