import type { BiomeDef } from '../../domain/shared/types';
import { isRecord, readString, readStringArray } from './common';

export const parseBiomeDef = (input: unknown): BiomeDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid biome entry: expected object');
  }

  return {
    id: readString(input.id, 'biome.id'),
    name: readString(input.name, 'biome.name'),
    palette: readStringArray(input.palette, 'biome.palette'),
    description: readString(input.description, 'biome.description'),
  };
};
