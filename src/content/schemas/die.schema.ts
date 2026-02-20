import type { DiceFaceDef, FaceEffectDef, DieDef } from '../../domain/shared/types';
import {
  isRecord,
  readFaceKind,
  readInt,
  readLiteral,
  readOptionalLiteral,
  readStatusId,
  readString,
  readStringArray,
} from './common';

const RARITIES = ['common', 'rare', 'cursed'] as const;
const TARGETS = ['self', 'ally', 'enemy', 'any'] as const;
const RANGE_TYPES = ['melee', 'ranged'] as const;
const FACE_EFFECT_TARGETS = [
  'target',
  'self',
  'ally',
  'all_allies',
  'enemy_front_all',
  'enemy_back_all',
  'enemy_all',
  'enemy_random',
] as const;

const parseEffect = (input: unknown, field: string): FaceEffectDef => {
  if (!isRecord(input)) {
    throw new Error(`Invalid ${field}: expected object`);
  }

  const type = readString(input.type, `${field}.type`);

  if (type === 'damage') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
      range: readOptionalLiteral(input.range, `${field}.range`, RANGE_TYPES),
      consumeMark:
        input.consumeMark === undefined ? undefined : Boolean(input.consumeMark),
      requiresMarked:
        input.requiresMarked === undefined ? undefined : Boolean(input.requiresMarked),
      applyStatusId:
        input.applyStatusId === undefined
          ? undefined
          : readStatusId(input.applyStatusId, `${field}.applyStatusId`),
      applyStatusStacks:
        input.applyStatusStacks === undefined
          ? undefined
          : readInt(input.applyStatusStacks, `${field}.applyStatusStacks`),
    };
  }

  if (type === 'block') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
    };
  }

  if (type === 'heal') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
      removeBleed:
        input.removeBleed === undefined
          ? undefined
          : Boolean(input.removeBleed),
    };
  }

  if (type === 'status') {
    return {
      type,
      statusId: readStatusId(input.statusId, `${field}.statusId`),
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
    };
  }

  if (type === 'cleanse') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
    };
  }

  if (type === 'shred_armor') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
      target: readOptionalLiteral(input.target, `${field}.target`, FACE_EFFECT_TARGETS),
    };
  }

  if (type === 'swap') {
    return { type };
  }

  if (type === 'focus') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
    };
  }

  if (type === 'lock_die') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
    };
  }

  if (type === 'pull_front') {
    return { type };
  }

  if (type === 'suppress_special') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
    };
  }

  if (type === 'post_combat') {
    return {
      type,
      resource: readLiteral(input.resource, `${field}.resource`, ['gold', 'supplies', 'consumables']),
      value: readInt(input.value, `${field}.value`),
      threatDelta:
        input.threatDelta === undefined
          ? undefined
          : readInt(input.threatDelta, `${field}.threatDelta`),
    };
  }

  if (type === 'turret') {
    return {
      type,
      value: readInt(input.value, `${field}.value`),
    };
  }

  throw new Error(`Invalid ${field}.type: unsupported effect type ${type}`);
};

const parseFace = (input: unknown, index: number): DiceFaceDef => {
  if (!isRecord(input)) {
    throw new Error(`Invalid die.faces[${index}]`);
  }

  if (!Array.isArray(input.effects) || input.effects.length === 0) {
    throw new Error(`Invalid die.faces[${index}].effects: expected non-empty array`);
  }

  const condition =
    input.condition && isRecord(input.condition)
      ? {
          requiresTag:
            input.condition.requiresTag === undefined
              ? undefined
              : readString(input.condition.requiresTag, `die.faces[${index}].condition.requiresTag`),
          requiresMarked:
            input.condition.requiresMarked === undefined
              ? undefined
              : Boolean(input.condition.requiresMarked),
          requiresTargetFront:
            input.condition.requiresTargetFront === undefined
              ? undefined
              : Boolean(input.condition.requiresTargetFront),
        }
      : undefined;

  return {
    id: readString(input.id, `die.faces[${index}].id`),
    label: readString(input.label, `die.faces[${index}].label`),
    kind: readFaceKind(input.kind, `die.faces[${index}].kind`),
    value: readInt(input.value, `die.faces[${index}].value`),
    tags: readStringArray(input.tags, `die.faces[${index}].tags`),
    target: readLiteral(input.target, `die.faces[${index}].target`, TARGETS),
    effects: input.effects.map((effectEntry, effectIndex) =>
      parseEffect(effectEntry, `die.faces[${index}].effects[${effectIndex}]`),
    ),
    condition,
  };
};

export const parseDieDef = (input: unknown): DieDef => {
  if (!isRecord(input)) {
    throw new Error('Invalid die entry: expected object');
  }

  if (!Array.isArray(input.faces) || input.faces.length !== 6) {
    throw new Error('Invalid die.faces: expected array with 6 entries');
  }

  return {
    id: readString(input.id, 'die.id'),
    label: readString(input.label, 'die.label'),
    rarity: readOptionalLiteral(input.rarity, 'die.rarity', RARITIES) ?? 'common',
    faces: [
      parseFace(input.faces[0], 0),
      parseFace(input.faces[1], 1),
      parseFace(input.faces[2], 2),
      parseFace(input.faces[3], 3),
      parseFace(input.faces[4], 4),
      parseFace(input.faces[5], 5),
    ],
  };
};
