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
  EnemyDef,
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
): CombatIntent => ({
  enemyId: enemy.id,
  intentId: intent.id,
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

export const buildEnemyIntents = (
  combat: CombatState,
  content: GameContent,
  rng: SeededRng,
): CombatIntent[] => {
  const intents: CombatIntent[] = [];

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

    const pickedIntent = pickIntent(combat, enemy, blueprint, rng);
    if (!pickedIntent) {
      continue;
    }

    const rolled = rollIntentValue(pickedIntent, blueprint, enemy, rng);
    intents.push(intentToRuntime(pickedIntent, enemy, rolled));
  }

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

  for (const intent of combat.intents) {
    const enemy = combat.enemies.find((entry) => entry.id === intent.enemyId);
    if (!enemy || !enemy.alive) {
      continue;
    }

    if (consumeStunAtTurnStart(enemy)) {
      logs.push(`${enemy.name} esta STUN e perde a acao.`);
      continue;
    }

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
    const result = applyEndTurnStatusEffects(member);
    logs.push(...result.logs);
    events.push(...result.events);
  }

  for (const enemy of combat.enemies) {
    const result = applyEndTurnStatusEffects(enemy);
    logs.push(...result.logs);
    events.push(...result.events);
  }

  return { logs, events };
};
