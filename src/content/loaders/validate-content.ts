import { parseBackgroundDef } from '../schemas/background.schema';
import { parseBiomeDef } from '../schemas/biome.schema';
import { parseClassDef } from '../schemas/class.schema';
import { parseDieDef } from '../schemas/die.schema';
import { parseEnemyDef } from '../schemas/enemy.schema';
import { parseEventDef } from '../schemas/event.schema';
import { parseRelicDef } from '../schemas/relic.schema';
import type { ContentValidationIssue, GameContent } from '../../domain/shared/types';

const asList = (input: unknown): unknown[] => {
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
};

const makeIssue = (source: string, message: string): ContentValidationIssue => ({ source, message });

const pushUniqueIssue = (
  issues: ContentValidationIssue[],
  source: string,
  seen: Set<string>,
  id: string,
  kind: string,
): void => {
  if (seen.has(id)) {
    issues.push(makeIssue(source, `Duplicate ${kind} id: ${id}`));
  } else {
    seen.add(id);
  }
};

export interface RawContentBundle {
  classes: unknown[];
  backgrounds: unknown[];
  dice: unknown[];
  enemies: unknown[];
  events: unknown[];
  relics: unknown[];
  biome: unknown;
}

export const validateContent = (bundle: RawContentBundle): GameContent => {
  const issues: ContentValidationIssue[] = [];

  const classes = bundle.classes.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseClassDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`classes[${index}]`, (error as Error).message));
      return [];
    }
  });

  const backgrounds = bundle.backgrounds.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseBackgroundDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`backgrounds[${index}]`, (error as Error).message));
      return [];
    }
  });

  const dice = bundle.dice.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseDieDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`dice[${index}]`, (error as Error).message));
      return [];
    }
  });

  const enemies = bundle.enemies.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseEnemyDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`enemies[${index}]`, (error as Error).message));
      return [];
    }
  });

  const events = bundle.events.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseEventDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`events[${index}]`, (error as Error).message));
      return [];
    }
  });

  const relics = bundle.relics.flatMap(asList).flatMap((entry, index) => {
    try {
      return [parseRelicDef(entry)];
    } catch (error) {
      issues.push(makeIssue(`relics[${index}]`, (error as Error).message));
      return [];
    }
  });

  let biome;
  try {
    biome = parseBiomeDef(bundle.biome);
  } catch (error) {
    issues.push(makeIssue('biome', (error as Error).message));
    biome = {
      id: 'invalid',
      name: 'Invalid',
      palette: ['#000000'],
      description: 'Invalid biome placeholder',
    };
  }

  const seenClassIds = new Set<string>();
  const seenBackgroundIds = new Set<string>();
  const seenDieIds = new Set<string>();
  const seenEnemyIds = new Set<string>();
  const seenEventIds = new Set<string>();
  const seenRelicIds = new Set<string>();

  for (const entry of classes) {
    pushUniqueIssue(issues, 'classes', seenClassIds, entry.id, 'class');
  }
  for (const entry of backgrounds) {
    pushUniqueIssue(issues, 'backgrounds', seenBackgroundIds, entry.id, 'background');
  }
  for (const entry of dice) {
    pushUniqueIssue(issues, 'dice', seenDieIds, entry.id, 'die');
  }
  for (const entry of enemies) {
    pushUniqueIssue(issues, 'enemies', seenEnemyIds, entry.id, 'enemy');
  }
  for (const entry of events) {
    pushUniqueIssue(issues, 'events', seenEventIds, entry.id, 'event');
  }
  for (const entry of relics) {
    pushUniqueIssue(issues, 'relics', seenRelicIds, entry.id, 'relic');
  }

  const dieIdSet = new Set(dice.map((entry) => entry.id));
  for (const entry of classes) {
    for (const dieId of entry.starterDiceIds) {
      if (!dieIdSet.has(dieId)) {
        issues.push(makeIssue('classes', `Class ${entry.id} references missing die ${dieId}`));
      }
    }
    for (const dieId of entry.growthPoolDiceIds) {
      if (!dieIdSet.has(dieId)) {
        issues.push(makeIssue('classes', `Class ${entry.id} growth references missing die ${dieId}`));
      }
    }
  }

  for (const entry of backgrounds) {
    if (!dieIdSet.has(entry.starterDieId)) {
      issues.push(makeIssue('backgrounds', `Background ${entry.id} references missing die ${entry.starterDieId}`));
    }
  }

  const eventIdSet = new Set(events.map((entry) => entry.id));
  for (const entry of backgrounds) {
    for (const eventId of entry.exclusiveEventIds) {
      if (!eventIdSet.has(eventId)) {
        issues.push(
          makeIssue(
            'backgrounds',
            `Background ${entry.id} references missing exclusive event ${eventId}`,
          ),
        );
      }
    }
  }

  if (issues.length > 0) {
    const joined = issues.map((issue) => `${issue.source}: ${issue.message}`).join('\n');
    throw new Error(`Content validation failed:\n${joined}`);
  }

  const byId = {
    classes: Object.fromEntries(classes.map((entry) => [entry.id, entry])),
    backgrounds: Object.fromEntries(backgrounds.map((entry) => [entry.id, entry])),
    dice: Object.fromEntries(dice.map((entry) => [entry.id, entry])),
    enemies: Object.fromEntries(enemies.map((entry) => [entry.id, entry])),
    events: Object.fromEntries(events.map((entry) => [entry.id, entry])),
    relics: Object.fromEntries(relics.map((entry) => [entry.id, entry])),
  };

  return {
    classes,
    backgrounds,
    dice,
    enemies,
    events,
    relics,
    biome,
    byId,
  };
};
