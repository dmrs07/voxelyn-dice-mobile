import type { EventChoiceDef, EventDef, OutcomeDef } from '../../domain/shared/types';
import { RESOURCE_IDS } from '../../domain/shared/enums';
import {
  isRecord,
  readFaceKind,
  readInt,
  readLiteral,
  readStatusId,
  readString,
  readStringArray,
} from './common';

const parseOutcome = (input: unknown, field: string): OutcomeDef => {
  if (!isRecord(input)) {
    throw new Error(`Invalid ${field}: expected object`);
  }

  const kind = readString(input.kind, `${field}.kind`);

  if (kind === 'resource') {
    return {
      kind,
      resource: readLiteral(input.resource, `${field}.resource`, RESOURCE_IDS),
      delta: readInt(input.delta, `${field}.delta`),
    };
  }

  if (kind === 'heal' || kind === 'damage') {
    return {
      kind,
      amount: readInt(input.amount, `${field}.amount`),
      target: readLiteral(input.target, `${field}.target`, ['party', 'random_party']),
    };
  }

  if (kind === 'relic') {
    return {
      kind,
      relicId: input.relicId === undefined ? undefined : readString(input.relicId, `${field}.relicId`),
      poolTag: input.poolTag === undefined ? undefined : readString(input.poolTag, `${field}.poolTag`),
    };
  }

  if (kind === 'status') {
    return {
      kind,
      statusId: readStatusId(input.statusId, `${field}.statusId`),
      stacks: readInt(input.stacks, `${field}.stacks`),
      target: readLiteral(input.target, `${field}.target`, ['party', 'random_party']),
    };
  }

  if (kind === 'state') {
    return {
      kind,
      flag: readLiteral(input.flag, `${field}.flag`, [
        'force_elite_next',
        'reveal_nodes',
        'spawn_shop_next',
        'skip_danger_nodes',
      ]),
      value: readInt(input.value, `${field}.value`),
    };
  }

  if (kind === 'log') {
    return {
      kind,
      text: readString(input.text, `${field}.text`),
    };
  }

  throw new Error(`Invalid ${field}.kind: unsupported outcome kind ${kind}`);
};

const parseChoice = (input: unknown, index: number): EventChoiceDef => {
  const field = `event.choices[${index}]`;
  if (!isRecord(input)) {
    throw new Error(`Invalid ${field}: expected object`);
  }

  let check: EventChoiceDef['check'];
  if (input.check !== undefined) {
    if (!isRecord(input.check)) {
      throw new Error(`Invalid ${field}.check`);
    }

    const kind = readLiteral(input.check.kind, `${field}.check.kind`, [
      'face_kind',
      'face_value_min',
    ]);

    check = {
      kind,
      faceKind:
        input.check.faceKind === undefined
          ? undefined
          : readFaceKind(input.check.faceKind, `${field}.check.faceKind`),
      anyOfKinds:
        input.check.anyOfKinds === undefined
          ? undefined
          : (input.check.anyOfKinds as unknown[]).map((entry, kindIndex) =>
              readFaceKind(entry, `${field}.check.anyOfKinds[${kindIndex}]`),
            ),
      minValue:
        input.check.minValue === undefined
          ? undefined
          : readInt(input.check.minValue, `${field}.check.minValue`),
      bonusPerTag:
        input.check.bonusPerTag === undefined
          ? undefined
          : readString(input.check.bonusPerTag, `${field}.check.bonusPerTag`),
      autoSuccessTag:
        input.check.autoSuccessTag === undefined
          ? undefined
          : readString(input.check.autoSuccessTag, `${field}.check.autoSuccessTag`),
    };
  }

  if (!Array.isArray(input.onSuccess) || !Array.isArray(input.onFail)) {
    throw new Error(`Invalid ${field}: onSuccess and onFail must be arrays`);
  }

  return {
    id: readString(input.id, `${field}.id`),
    text: readString(input.text, `${field}.text`),
    check,
    onSuccess: input.onSuccess.map((entry, outcomeIndex) =>
      parseOutcome(entry, `${field}.onSuccess[${outcomeIndex}]`),
    ),
    onFail: input.onFail.map((entry, outcomeIndex) =>
      parseOutcome(entry, `${field}.onFail[${outcomeIndex}]`),
    ),
  };
};

export const parseEventDef = (input: unknown): EventDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid event entry: expected object');
  }

  if (!Array.isArray(input.choices) || input.choices.length === 0) {
    throw new Error('Invalid event.choices: expected non-empty array');
  }

  return {
    id: readString(input.id, 'event.id'),
    biome: readString(input.biome, 'event.biome'),
    weight: readInt(input.weight, 'event.weight'),
    title: readString(input.title, 'event.title'),
    body: readString(input.body, 'event.body'),
    requiredTags: readStringArray(input.requiredTags, 'event.requiredTags'),
    choices: input.choices.map((entry, choiceIndex) => parseChoice(entry, choiceIndex)),
  };
};
