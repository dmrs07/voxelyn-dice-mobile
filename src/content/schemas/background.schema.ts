import type { BackgroundDef } from '../../domain/shared/types';
import { isRecord, readString, readStringArray } from './common';

export const parseBackgroundDef = (input: unknown): BackgroundDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid background entry: expected object');
  }

  return {
    id: readString(input.id, 'background.id'),
    name: readString(input.name, 'background.name'),
    tags: readStringArray(input.tags, 'background.tags'),
    perk: readString(input.perk, 'background.perk'),
    starterDieId: readString(input.starterDieId, 'background.starterDieId'),
    exclusiveEventIds: readStringArray(input.exclusiveEventIds, 'background.exclusiveEventIds'),
  };
};
