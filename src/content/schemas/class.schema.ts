import type { ClassDef } from '../../domain/shared/types';
import { isRecord, readLiteral, readString, readStringArray, readInt } from './common';

const CLASS_ROLES = ['tank', 'striker', 'support', 'control'] as const;

export const parseClassDef = (input: unknown): ClassDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid class entry: expected object');
  }

  let hireCost: number | undefined;
  if (input.hireCost !== undefined) {
    hireCost = readInt(input.hireCost, 'class.hireCost');
    if (hireCost < 0) {
      throw new Error('Invalid class.hireCost: expected >= 0');
    }
  }

  return {
    id: readString(input.id, 'class.id'),
    name: readString(input.name, 'class.name'),
    role: readLiteral(input.role, 'class.role', CLASS_ROLES),
    verb: readString(input.verb, 'class.verb'),
    passive: readString(input.passive, 'class.passive'),
    hireCost,
    starterDiceIds: readStringArray(input.starterDiceIds, 'class.starterDiceIds'),
    growthPoolDiceIds: readStringArray(input.growthPoolDiceIds, 'class.growthPoolDiceIds'),
    maxHp: readInt(input.maxHp, 'class.maxHp'),
  };
};
