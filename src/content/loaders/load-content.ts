import type { ContentIndexDef, GameContent } from '../../domain/shared/types';
import { validateContent } from './validate-content';

const jsonModules = import.meta.glob('/content/**/*.json', { eager: true }) as Record<
  string,
  { default?: unknown } | unknown
>;

const unwrapModule = (entry: { default?: unknown } | unknown): unknown => {
  if (typeof entry === 'object' && entry !== null && 'default' in entry) {
    return (entry as { default?: unknown }).default;
  }
  return entry;
};

const getJsonByPath = (path: string): unknown => {
  const normalized = path.startsWith('/content/') ? path : `/content/${path}`;
  const entry = jsonModules[normalized];
  if (entry === undefined) {
    throw new Error(`Missing content file: ${normalized}`);
  }
  return unwrapModule(entry);
};

const parseIndex = (raw: unknown): ContentIndexDef => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid content index: expected object');
  }

  const asRecord = raw as Record<string, unknown>;
  const readList = (field: string): string[] => {
    const value = asRecord[field];
    if (!Array.isArray(value)) {
      throw new Error(`Invalid content index field ${field}: expected array`);
    }
    return value.map((entry, index) => {
      if (typeof entry !== 'string') {
        throw new Error(`Invalid content index ${field}[${index}]`);
      }
      return entry;
    });
  };

  const biome = asRecord.biome;
  if (typeof biome !== 'string') {
    throw new Error('Invalid content index field biome');
  }

  return {
    classes: readList('classes'),
    backgrounds: readList('backgrounds'),
    dice: readList('dice'),
    enemies: readList('enemies'),
    events: readList('events'),
    relics: readList('relics'),
    biome,
  };
};

export const loadContent = async (): Promise<GameContent> => {
  const indexRaw = getJsonByPath('/content/index.json');
  const index = parseIndex(indexRaw);

  const bundle = {
    classes: index.classes.map((path) => getJsonByPath(path)),
    backgrounds: index.backgrounds.map((path) => getJsonByPath(path)),
    dice: index.dice.map((path) => getJsonByPath(path)),
    enemies: index.enemies.map((path) => getJsonByPath(path)),
    events: index.events.map((path) => getJsonByPath(path)),
    relics: index.relics.map((path) => getJsonByPath(path)),
    biome: getJsonByPath(index.biome),
  };

  return validateContent(bundle);
};
