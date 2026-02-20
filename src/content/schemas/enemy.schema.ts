import type { EnemyDef, EnemyIntentDef } from '../../domain/shared/types';
import {
  isRecord,
  readInt,
  readOptionalLiteral,
  readStatusId,
  readString,
  readStringArray,
  readLiteral,
} from './common';

const parseIntent = (input: unknown, index: number): EnemyIntentDef => {
  if (!isRecord(input)) {
    throw new Error(`Invalid enemy.intents[${index}]`);
  }

  const kind = readLiteral(input.kind, `enemy.intents[${index}].kind`, [
    'attack',
    'defend',
    'status',
    'heal',
    'special',
  ]);

  return {
    id: readString(input.id, `enemy.intents[${index}].id`),
    label: readString(input.label, `enemy.intents[${index}].label`),
    kind,
    min: readInt(input.min, `enemy.intents[${index}].min`),
    max: readInt(input.max, `enemy.intents[${index}].max`),
    statusId:
      input.statusId === undefined
        ? undefined
        : readStatusId(input.statusId, `enemy.intents[${index}].statusId`),
    statusStacks:
      input.statusStacks === undefined
        ? undefined
        : readInt(input.statusStacks, `enemy.intents[${index}].statusStacks`),
    target: readLiteral(input.target, `enemy.intents[${index}].target`, ['front', 'back', 'any']),
    range: readOptionalLiteral(input.range, `enemy.intents[${index}].range`, ['melee', 'ranged']),
    aoe: readOptionalLiteral(input.aoe, `enemy.intents[${index}].aoe`, [
      'single',
      'front_all',
      'back_all',
      'all',
    ]),
    isSpecial: input.isSpecial === undefined ? undefined : Boolean(input.isSpecial),
    onHitStatusId:
      input.onHitStatusId === undefined
        ? undefined
        : readStatusId(input.onHitStatusId, `enemy.intents[${index}].onHitStatusId`),
    onHitStatusStacks:
      input.onHitStatusStacks === undefined
        ? undefined
        : readInt(input.onHitStatusStacks, `enemy.intents[${index}].onHitStatusStacks`),
    grantStatusId:
      input.grantStatusId === undefined
        ? undefined
        : readStatusId(input.grantStatusId, `enemy.intents[${index}].grantStatusId`),
    grantStatusStacks:
      input.grantStatusStacks === undefined
        ? undefined
        : readInt(input.grantStatusStacks, `enemy.intents[${index}].grantStatusStacks`),
    summonEnemyId:
      input.summonEnemyId === undefined
        ? undefined
        : readString(input.summonEnemyId, `enemy.intents[${index}].summonEnemyId`),
    phase2Min:
      input.phase2Min === undefined
        ? undefined
        : readInt(input.phase2Min, `enemy.intents[${index}].phase2Min`),
    phase2Max:
      input.phase2Max === undefined
        ? undefined
        : readInt(input.phase2Max, `enemy.intents[${index}].phase2Max`),
    phase2StatusId:
      input.phase2StatusId === undefined
        ? undefined
        : readStatusId(input.phase2StatusId, `enemy.intents[${index}].phase2StatusId`),
    phase2StatusStacks:
      input.phase2StatusStacks === undefined
        ? undefined
        : readInt(input.phase2StatusStacks, `enemy.intents[${index}].phase2StatusStacks`),
    weight: readInt(input.weight, `enemy.intents[${index}].weight`),
  };
};

export const parseEnemyDef = (input: unknown): EnemyDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid enemy entry: expected object');
  }

  if (!Array.isArray(input.intents) || input.intents.length === 0) {
    throw new Error('Invalid enemy.intents: expected non-empty array');
  }

  return {
    id: readString(input.id, 'enemy.id'),
    name: readString(input.name, 'enemy.name'),
    hp: readInt(input.hp, 'enemy.hp'),
    armor: readInt(input.armor, 'enemy.armor'),
    isBoss: Boolean(input.isBoss),
    tags: readStringArray(input.tags, 'enemy.tags'),
    intentMode: readOptionalLiteral(input.intentMode, 'enemy.intentMode', ['random', 'cycle']),
    intentCycle:
      input.intentCycle === undefined
        ? undefined
        : readStringArray(input.intentCycle, 'enemy.intentCycle'),
    phase2Hp:
      input.phase2Hp === undefined
        ? undefined
        : readInt(input.phase2Hp, 'enemy.phase2Hp'),
    intents: input.intents.map((entry, index) => parseIntent(entry, index)),
  };
};
