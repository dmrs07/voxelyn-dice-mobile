import { SeededRng } from '../../core/rng';
import {
  addStatus,
  applyEnemyIntent,
  applyEndTurnStatusEffects,
  consumeStunAtTurnStart,
} from './action-resolver';
import type {
  CombatFxEvent,
  CombatIntent,
  CombatState,
  CombatantState,
  DiceFaceDef,
  EnemyDef,
  EnemyDieTier,
  EnemyIntentDef,
  GameContent,
} from '../shared/types';

const weightedPickIntent = (intents: EnemyIntentDef[], rng: SeededRng): EnemyIntentDef => {
  const bag: EnemyIntentDef[] = [];
  for (const intent of intents) {
    const weight = Math.max(1, intent.weight);
    for (let i = 0; i < weight; i += 1) {
      bag.push(intent);
    }
  }
  return bag[rng.nextInt(bag.length)] ?? intents[0] as EnemyIntentDef;
};

const findIntentById = (blueprint: EnemyDef, intentId: string): EnemyIntentDef | null =>
  blueprint.intents.find((entry) => entry.id === intentId) ?? null;

const pickIntent = (
  combat: CombatState,
  enemy: CombatantState,
  blueprint: EnemyDef,
  rng: SeededRng,
): EnemyIntentDef | null => {
  if (blueprint.intentMode === 'cycle' && blueprint.intentCycle && blueprint.intentCycle.length > 0) {
    const cursor = combat.enemyIntentCursor[enemy.id] ?? 0;
    const cycleId = blueprint.intentCycle[cursor % blueprint.intentCycle.length] as string;
    combat.enemyIntentCursor[enemy.id] = cursor + 1;
    return findIntentById(blueprint, cycleId) ?? blueprint.intents[0] ?? null;
  }

  return weightedPickIntent(blueprint.intents, rng);
};

const rollIntentValue = (
  intent: EnemyIntentDef,
  blueprint: EnemyDef,
  enemy: CombatantState,
  rng: SeededRng,
): { value: number; onHitStatusId: EnemyIntentDef['onHitStatusId']; onHitStatusStacks: number } => {
  let min = intent.min;
  let max = intent.max;
  let onHitStatusId = intent.onHitStatusId;
  let onHitStatusStacks = intent.onHitStatusStacks ?? 0;

  if (blueprint.phase2Hp !== undefined && enemy.hp <= blueprint.phase2Hp) {
    if (intent.phase2Min !== undefined) {
      min = intent.phase2Min;
    }
    if (intent.phase2Max !== undefined) {
      max = intent.phase2Max;
    }
    if (intent.phase2StatusId) {
      onHitStatusId = intent.phase2StatusId;
      onHitStatusStacks = intent.phase2StatusStacks ?? onHitStatusStacks;
    }
  }

  return {
    value: rng.rangeInt(min, max),
    onHitStatusId,
    onHitStatusStacks,
  };
};

const intentToRuntime = (
  intent: EnemyIntentDef,
  enemy: CombatantState,
  rolled: {
    value: number;
    onHitStatusId?: EnemyIntentDef['onHitStatusId'];
    onHitStatusStacks: number;
  },
  options?: {
    rollId?: string;
    tier?: EnemyDieTier;
    faceIndex?: number;
    face?: DiceFaceDef;
  },
): CombatIntent => ({
  enemyId: enemy.id,
  intentId: intent.id,
  enemyRollId: options?.rollId,
  enemyDieTier: options?.tier,
  enemyFaceIndex: options?.faceIndex,
  enemyFace: options?.face,
  label: intent.label,
  kind: intent.kind,
  value: rolled.value,
  statusId: intent.statusId,
  statusStacks: intent.statusStacks,
  target: intent.target,
  range: intent.range ?? 'melee',
  aoe: intent.aoe ?? 'single',
  isSpecial: intent.isSpecial ?? intent.kind === 'special',
  onHitStatusId: rolled.onHitStatusId,
  onHitStatusStacks: rolled.onHitStatusStacks,
  grantStatusId: intent.grantStatusId,
  grantStatusStacks: intent.grantStatusStacks,
  summonEnemyId: intent.summonEnemyId,
});

const tierDiceCount = (tier: EnemyDieTier): number => {
  if (tier === 'boss') {
    return 3;
  }
  if (tier === 'elite') {
    return 2;
  }
  return 1;
};

const inferEnemyTier = (combat: CombatState, blueprint: EnemyDef): EnemyDieTier => {
  if (blueprint.isBoss || combat.nodeType === 'boss') {
    return 'boss';
  }
  if (combat.nodeType === 'elite') {
    return 'elite';
  }
  return 'common';
};

const mapIntentKindToFaceKind = (kind: EnemyIntentDef['kind']): DiceFaceDef['kind'] => {
  if (kind === 'attack') return 'attack';
  if (kind === 'defend') return 'block';
  if (kind === 'heal') return 'heal';
  return 'special';
};

const mapIntentTargetToFaceTarget = (
  target: EnemyIntentDef['target'],
): DiceFaceDef['target'] => {
  if (target === 'any') {
    return 'any';
  }
  return 'enemy';
};

const makeEnemyIntentFace = (
  blueprintId: string,
  enemyId: string,
  intent: EnemyIntentDef,
  value: number,
  faceIndex: number,
): DiceFaceDef => ({
  id: `${enemyId}:${intent.id}:${faceIndex}`,
  label: intent.label,
  kind: mapIntentKindToFaceKind(intent.kind),
  value: Math.max(0, value),
  tags: [
    'enemy_intent',
    intent.kind,
    intent.range ?? 'melee',
    intent.target,
    intent.aoe ?? 'single',
    blueprintId,
  ],
  target: mapIntentTargetToFaceTarget(intent.target),
  effects: [],
});

export const deriveEnemyDieFacesFromIntents = (blueprint: EnemyDef): DiceFaceDef[] => {
  if (blueprint.intents.length === 0) {
    return [];
  }

  const weighted: EnemyIntentDef[] = [];
  for (const intent of blueprint.intents) {
    const weight = Math.max(1, Math.floor(intent.weight));
    for (let i = 0; i < weight; i += 1) {
      weighted.push(intent);
    }
  }

  const source = weighted.length > 0 ? weighted : blueprint.intents;
  const faces: DiceFaceDef[] = [];
  for (let index = 0; index < 6; index += 1) {
    const intent = source[index % source.length] as EnemyIntentDef;
    const value = Math.max(0, Math.floor((intent.min + intent.max) / 2));
    faces.push(
      makeEnemyIntentFace(
        blueprint.id,
        blueprint.id,
        intent,
        value,
        index,
      ),
    );
  }
  return faces;
};

export const buildEnemyIntents = (
  combat: CombatState,
  content: GameContent,
  rng: SeededRng,
): CombatIntent[] => {
  const intents: CombatIntent[] = [];
  const snapshot: NonNullable<CombatState['enemyRollSnapshot']> = [];

  for (let index = 0; index < combat.enemies.length; index += 1) {
    const enemy = combat.enemies[index] as CombatantState;
    if (!enemy.alive) {
      continue;
    }

    const blueprintId = combat.enemyBlueprintIds[index] as string;
    const blueprint = content.byId.enemies[blueprintId];
    if (!blueprint || blueprint.intents.length === 0) {
      continue;
    }

    const tier = inferEnemyTier(combat, blueprint);
    const dieCount = tierDiceCount(tier);
    const dieFaces = deriveEnemyDieFacesFromIntents(blueprint);

    for (let dieIndex = 0; dieIndex < dieCount; dieIndex += 1) {
      const pickedIntent = pickIntent(combat, enemy, blueprint, rng);
      if (!pickedIntent) {
        continue;
      }

      const rolled = rollIntentValue(pickedIntent, blueprint, enemy, rng);
      const faceIndex = rng.nextInt(6);
      const fallbackFace = dieFaces[faceIndex] ?? makeEnemyIntentFace(
        blueprint.id,
        enemy.id,
        pickedIntent,
        rolled.value,
        faceIndex,
      );
      const face = {
        ...fallbackFace,
        id: `${enemy.id}:${pickedIntent.id}:${combat.turn}:${dieIndex}`,
        label: pickedIntent.label,
        kind: mapIntentKindToFaceKind(pickedIntent.kind),
        value: rolled.value,
        target: mapIntentTargetToFaceTarget(pickedIntent.target),
        tags: [
          ...fallbackFace.tags.filter((tag) => tag !== 'enemy_intent'),
          'enemy_intent',
        ],
      } satisfies DiceFaceDef;
      const rollId = `enemy_${enemy.id}_${combat.turn}_${dieIndex}`;
      intents.push(
        intentToRuntime(pickedIntent, enemy, rolled, {
          rollId,
          tier,
          faceIndex,
          face,
        }),
      );
      snapshot.push({
        enemyId: enemy.id,
        tier,
        rollId,
        intentId: pickedIntent.id,
        label: pickedIntent.label,
        kind: pickedIntent.kind,
        target: pickedIntent.target,
        range: pickedIntent.range ?? 'melee',
        value: rolled.value,
        faceIndex,
      });
    }
  }

  combat.enemyRollSnapshot = snapshot;
  return intents;
};

const makeSummonRow = (combat: CombatState): 'front' | 'back' => {
  const frontAlive = combat.enemies.filter((entry) => entry.alive && entry.row === 'front').length;
  return frontAlive < 2 ? 'front' : 'back';
};

const summonEnemy = (
  combat: CombatState,
  content: GameContent,
  summonEnemyId: string,
  turn: number,
): CombatantState | null => {
  const blueprint = content.byId.enemies[summonEnemyId];
  if (!blueprint) {
    return null;
  }

  const created: CombatantState = {
    id: `${summonEnemyId}_summon_${turn}_${combat.enemies.length}`,
    name: blueprint.name,
    hp: blueprint.hp,
    maxHp: blueprint.hp,
    armor: blueprint.armor,
    statuses: {
      block: 0,
      dodge: 0,
      mark: 0,
      poison: 0,
      burn: 0,
      bleed: 0,
      stun: 0,
      fear: 0,
      inspired: 0,
      charged: 0,
      turret: 0,
    },
    tags: [...blueprint.tags],
    row: makeSummonRow(combat),
    alive: true,
    isEnemy: true,
  };

  combat.enemies.push(created);
  combat.enemyBlueprintIds.push(summonEnemyId);
  combat.enemyIntentCursor[created.id] = 0;
  return created;
};

export const resolveEnemyTurn = (
  combat: CombatState,
  content: GameContent,
  rng: SeededRng,
): { logs: string[]; events: CombatFxEvent[] } => {
  const logs: string[] = [];
  const events: CombatFxEvent[] = [];

  for (let index = 0; index < combat.intents.length; index += 1) {
    const intent = combat.intents[index] as CombatIntent;
    const enemy = combat.enemies.find((entry) => entry.id === intent.enemyId);
    if (!enemy || !enemy.alive) {
      continue;
    }

    if (consumeStunAtTurnStart(enemy)) {
      logs.push(`${enemy.name} esta STUN e perde a acao.`);
      continue;
    }

    const enemyRollId = intent.enemyRollId ?? `enemy_${intent.enemyId}_${combat.turn}_${index}`;
    const enemyFaceIndex = intent.enemyFaceIndex ?? (index % 6);
    const enemyFace =
      intent.enemyFace ??
      makeEnemyIntentFace('enemy', enemy.id, {
        id: intent.intentId,
        label: intent.label,
        kind: intent.kind,
        min: intent.value,
        max: intent.value,
        target: intent.target,
        range: intent.range,
        aoe: intent.aoe,
        weight: 1,
      }, intent.value, enemyFaceIndex);

    events.push({
      type: 'die_roll',
      rollId: enemyRollId,
      ownerId: enemy.id,
      durationMs: 280,
      face: enemyFace,
      faceIndex: enemyFaceIndex,
      dieId: `enemy_die_${enemy.id}`,
      transient: true,
      selectable: false,
      expiresAfterMs: 1450,
    });
    events.push({
      type: 'die_settle',
      rollId: enemyRollId,
      ownerId: enemy.id,
      faceId: enemyFace.id,
      durationMs: 360,
      face: enemyFace,
      faceIndex: enemyFaceIndex,
      dieId: `enemy_die_${enemy.id}`,
      transient: true,
      selectable: false,
      expiresAfterMs: 1450,
    });
    events.push({
      type: 'intent_telegraph',
      ownerId: enemy.id,
      intentKind: intent.kind,
      value: intent.value,
      durationMs: 280,
      label: intent.label,
      targetHint: intent.target,
    });
    logs.push(`${enemy.name} rolou ${intent.label} (${intent.value}).`);

    if (intent.summonEnemyId && intent.kind === 'special') {
      if (intent.grantStatusId && (intent.grantStatusStacks ?? 0) > 0) {
        addStatus(enemy, intent.grantStatusId, intent.grantStatusStacks ?? 0);
        logs.push(`${enemy.name} ganhou ${intent.grantStatusId} ${intent.grantStatusStacks}.`);
        events.push({
          type: 'status',
          targetId: enemy.id,
          statusId: intent.grantStatusId,
          stacks: intent.grantStatusStacks ?? 0,
        });
      }

      const created = summonEnemy(combat, content, intent.summonEnemyId, combat.turn);
      if (created) {
        logs.push(`${enemy.name} invocou ${created.name}.`);
        events.push({ type: 'idle', targetId: created.id, enabled: true });
      }

      if (intent.value > 0) {
        const result = applyEnemyIntent(combat, enemy, intent);
        logs.push(...result.logs);
        events.push(...result.events);
      }
      continue;
    }

    const result = applyEnemyIntent(combat, enemy, intent);
    logs.push(...result.logs);
    events.push(...result.events);
  }

  for (const member of combat.party) {
    const result = applyEndTurnStatusEffects(member, { combat, team: 'party' });
    logs.push(...result.logs);
    events.push(...result.events);
  }

  for (const enemy of combat.enemies) {
    const result = applyEndTurnStatusEffects(enemy, { combat, team: 'enemy' });
    logs.push(...result.logs);
    events.push(...result.events);
  }

  return { logs, events };
};
