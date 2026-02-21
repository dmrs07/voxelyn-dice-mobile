import type { DiceFaceDef, DieDef } from './types';

export const isEmptyFaceIndex = (die: DieDef, faceIndex: number): boolean =>
  Array.isArray(die.emptyFaceIndices) && die.emptyFaceIndices.includes(faceIndex);

export const buildEmptyDieFace = (die: DieDef, faceIndex: number): DiceFaceDef => ({
  id: `${die.id}_empty_${faceIndex}`,
  label: 'VAZIO',
  kind: 'empty',
  value: 0,
  tags: ['empty'],
  target: 'self',
  effects: [],
});

export const materializeDieFace = (die: DieDef, faceIndex: number): DiceFaceDef => {
  if (isEmptyFaceIndex(die, faceIndex)) {
    return buildEmptyDieFace(die, faceIndex);
  }
  return die.faces[faceIndex] ?? die.faces[0];
};

export const materializeAllDieFaces = (die: DieDef): DiceFaceDef[] =>
  die.faces.map((_, index) => materializeDieFace(die, index));

