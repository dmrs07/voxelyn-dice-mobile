import { FACE_KINDS, STATUS_IDS } from '../../domain/shared/enums';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field}: expected non-empty string`);
  }
  return value;
};

export const readNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Invalid ${field}: expected number`);
  }
  return value;
};

export const readInt = (value: unknown, field: string): number => {
  const number = readNumber(value, field);
  if (!Number.isInteger(number)) {
    throw new Error(`Invalid ${field}: expected integer`);
  }
  return number;
};

export const readStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected array`);
  }
  const parsed = value.map((entry, index) => readString(entry, `${field}[${index}]`));
  return parsed;
};

export const readLiteral = <T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T => {
  const literal = readString(value, field) as T;
  if (!allowed.includes(literal)) {
    throw new Error(`Invalid ${field}: expected one of ${allowed.join(', ')}`);
  }
  return literal;
};

export const readOptionalLiteral = <T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return readLiteral(value, field, allowed);
};

export const readFaceKind = (value: unknown, field: string): (typeof FACE_KINDS)[number] =>
  readLiteral(value, field, FACE_KINDS);

export const readStatusId = (value: unknown, field: string): (typeof STATUS_IDS)[number] =>
  readLiteral(value, field, STATUS_IDS);
