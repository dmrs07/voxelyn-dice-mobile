import type { RelicDef } from '../../domain/shared/types';
import { isRecord, readInt, readLiteral, readString, readStringArray } from './common';

const RELIC_RARITIES = ['common', 'rare'] as const;
const RELIC_EFFECT_KINDS = [
  'reroll_bonus',
  'max_hp_bonus',
  'heal_after_combat',
  'threat_slow',
  'guard_turn_start',
  'morale_on_win',
  'supplies_on_event',
] as const;

export const parseRelicDef = (input: unknown): RelicDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid relic entry: expected object');
  }

  if (!isRecord(input.effect)) {
    throw new Error('Invalid relic.effect: expected object');
  }

  return {
    id: readString(input.id, 'relic.id'),
    name: readString(input.name, 'relic.name'),
    rarity: readLiteral(input.rarity, 'relic.rarity', RELIC_RARITIES),
    description: readString(input.description, 'relic.description'),
    tags: readStringArray(input.tags, 'relic.tags'),
    effect: {
      kind: readLiteral(input.effect.kind, 'relic.effect.kind', RELIC_EFFECT_KINDS),
      value: readInt(input.effect.value, 'relic.effect.value'),
    },
  };
};
