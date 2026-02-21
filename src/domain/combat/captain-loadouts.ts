import type {
  CaptainFaceId,
  CaptainLoadoutSelection,
  CaptainPassiveId,
  DiceFaceDef,
  FaceEffectDef,
} from '../shared/types';

export interface CaptainPassiveOption {
  id: CaptainPassiveId;
  label: string;
  description: string;
}

export interface CaptainFaceOption {
  id: CaptainFaceId;
  label: string;
  description: string;
  face: DiceFaceDef;
}

interface CaptainClassCatalog {
  passives: readonly CaptainPassiveOption[];
  faces: readonly CaptainFaceOption[];
  preset: CaptainLoadoutSelection;
}

const cloneEffects = (effects: FaceEffectDef[]): FaceEffectDef[] => effects.map((effect) => ({ ...effect }));

const cloneFace = (face: DiceFaceDef): DiceFaceDef => ({
  ...face,
  tags: [...face.tags],
  effects: cloneEffects(face.effects),
  condition: face.condition ? { ...face.condition } : undefined,
});

const makeFace = (
  id: CaptainFaceId,
  label: string,
  kind: DiceFaceDef['kind'],
  value: number,
  target: DiceFaceDef['target'],
  effects: FaceEffectDef[],
  extra?: { tags?: string[]; condition?: DiceFaceDef['condition'] },
): DiceFaceDef => ({
  id,
  label,
  kind,
  value,
  target,
  tags: ['captain_face', ...(extra?.tags ?? [])],
  effects,
  ...(extra?.condition ? { condition: { ...extra.condition } } : {}),
});

const CATALOG: Record<string, CaptainClassCatalog> = {
  mecanico: {
    passives: [
      {
        id: 'mecanico_scrap',
        label: 'Scrap',
        description:
          'Ao rolar face vazia ganha Sucata (max 2). Ao aplicar BLK/HEAL gasta 1 Sucata para +1 no primeiro efeito elegivel.',
      },
      {
        id: 'mecanico_oficina_campo',
        label: 'Oficina de Campo',
        description: '1x por turno, o primeiro BLK em aliado recebe +1 adicional.',
      },
      {
        id: 'mecanico_engrenagem_emergencia',
        label: 'Engrenagem de Emergencia',
        description: '1x por combate, quando um aliado cai para <= 50% HP: BLK 2 nele e FOCO +1.',
      },
    ],
    faces: [
      {
        id: 'face_rebites_rapidos',
        label: 'Rebites Rapidos',
        description: 'FOCO +1 e BLK 1 em si.',
        face: makeFace('face_rebites_rapidos', 'Rebites Rapidos', 'focus', 1, 'self', [
          { type: 'focus', value: 1 },
          { type: 'block', value: 1, target: 'self' },
        ], { tags: ['mecanico'] }),
      },
      {
        id: 'face_sucata_util',
        label: 'Sucata Util',
        description: 'BLK 2 em aliado.',
        face: makeFace('face_sucata_util', 'Sucata Util', 'block', 2, 'ally', [
          { type: 'block', value: 2, target: 'target' },
        ], { tags: ['mecanico'] }),
      },
    ],
    preset: {
      passiveId: 'mecanico_oficina_campo',
      faceId: 'face_rebites_rapidos',
    },
  },
  aviadora: {
    passives: [
      {
        id: 'aviadora_corrente_ar',
        label: 'Corrente de Ar',
        description: '1x por turno, apos SWAP valido ganha 1 rerrolagem gratuita.',
      },
      {
        id: 'aviadora_ataque_rasante',
        label: 'Ataque Rasante',
        description: '1x por turno, primeiro ATK ranged em alvo MARKADO causa +1 dano.',
      },
      {
        id: 'aviadora_chefe_sinalizacao',
        label: 'Chefe de Sinalizacao',
        description: '1x por turno, ao aplicar MARK ganha FOCO +1.',
      },
    ],
    faces: [
      {
        id: 'face_evasiva',
        label: 'Evasiva',
        description: 'SWAP e DODGE 1 em si.',
        face: makeFace('face_evasiva', 'Evasiva', 'swap', 1, 'ally', [
          { type: 'swap' },
          { type: 'status', statusId: 'dodge', value: 1, target: 'self' },
        ], { tags: ['aviadora'] }),
      },
      {
        id: 'face_rajada_tatica',
        label: 'Rajada Tatica',
        description: 'ATK 1 e MARK 1 na frente inimiga.',
        face: makeFace('face_rajada_tatica', 'Rajada Tatica', 'attack', 1, 'enemy', [
          { type: 'damage', value: 1, range: 'ranged', target: 'enemy_front_all' },
          { type: 'status', statusId: 'mark', value: 1, target: 'enemy_front_all' },
        ], { tags: ['aviadora', 'aoe'] }),
      },
    ],
    preset: {
      passiveId: 'aviadora_corrente_ar',
      faceId: 'face_evasiva',
    },
  },
  ocultista: {
    passives: [
      {
        id: 'ocultista_cifra_voraz',
        label: 'Cifra Voraz',
        description: '1x por turno, ao aplicar MARK ganha FOCO +1.',
      },
      {
        id: 'ocultista_veneno_metodico',
        label: 'Veneno Metodico',
        description: '1x por turno, ao aplicar POISON em alvo com BLK remove BLK 1.',
      },
      {
        id: 'ocultista_ritual_curto',
        label: 'Ritual Curto',
        description: 'Ao ganhar CHARGED prepara +1 no proximo dado usado (nao acumula).',
      },
    ],
    faces: [
      {
        id: 'face_selo_vazio',
        label: 'Selo do Vazio',
        description: 'SHRED 1 e MARK 1.',
        face: makeFace('face_selo_vazio', 'Selo do Vazio', 'special', 1, 'enemy', [
          { type: 'shred_armor', value: 1, target: 'target' },
          { type: 'status', statusId: 'mark', value: 1, target: 'target' },
        ], { tags: ['ocultista'] }),
      },
      {
        id: 'face_ritual_rapido',
        label: 'Ritual Rapido',
        description: 'CHARGED 1 e FOCO +1.',
        face: makeFace('face_ritual_rapido', 'Ritual Rapido', 'special', 1, 'self', [
          { type: 'status', statusId: 'charged', value: 1, target: 'self' },
          { type: 'focus', value: 1 },
        ], { tags: ['ocultista'] }),
      },
    ],
    preset: {
      passiveId: 'ocultista_veneno_metodico',
      faceId: 'face_ritual_rapido',
    },
  },
  cacador: {
    passives: [
      {
        id: 'cacador_observador',
        label: 'Observador',
        description: '1x por turno, ao usar LOCK_DIE os dados travados recebem +1 no proximo uso.',
      },
      {
        id: 'cacador_tiro_limpo',
        label: 'Tiro Limpo',
        description: '1x por turno, primeiro ATK ranged ignora 1 BLK do alvo.',
      },
      {
        id: 'cacador_de_marcas',
        label: 'Cacador de Marcas',
        description: '1x por turno, ao causar dano em inimigo MARKADO ganha FOCO +1.',
      },
    ],
    faces: [
      {
        id: 'face_armadilha_perfeita',
        label: 'Armadilha Perfeita',
        description: 'STUN 1 (frente) e MARK 1.',
        face: makeFace(
          'face_armadilha_perfeita',
          'Armadilha Perfeita',
          'stun',
          1,
          'enemy',
          [
            { type: 'status', statusId: 'stun', value: 1, target: 'target' },
            { type: 'status', statusId: 'mark', value: 1, target: 'target' },
          ],
          { tags: ['cacador'], condition: { requiresTargetFront: true } },
        ),
      },
      {
        id: 'face_mira_fria',
        label: 'Mira Fria',
        description: 'LOCK_DIE 1 e FOCO +1.',
        face: makeFace('face_mira_fria', 'Mira Fria', 'focus', 1, 'self', [
          { type: 'lock_die', value: 1 },
          { type: 'focus', value: 1 },
        ], { tags: ['cacador'] }),
      },
    ],
    preset: {
      passiveId: 'cacador_de_marcas',
      faceId: 'face_mira_fria',
    },
  },
};

export const getCaptainOptionsForClass = (classId: string): CaptainClassCatalog | null => {
  const catalog = CATALOG[classId];
  if (!catalog) {
    return null;
  }
  return {
    passives: catalog.passives.map((entry) => ({ ...entry })),
    faces: catalog.faces.map((entry) => ({
      ...entry,
      face: cloneFace(entry.face),
    })),
    preset: { ...catalog.preset },
  };
};

export const getDefaultCaptainLoadoutForClass = (classId: string): CaptainLoadoutSelection | null => {
  const catalog = CATALOG[classId];
  if (!catalog) {
    return null;
  }
  return { ...catalog.preset };
};

export const getCaptainFaceDefinition = (faceId: CaptainFaceId): DiceFaceDef | null => {
  for (const catalog of Object.values(CATALOG)) {
    const found = catalog.faces.find((entry) => entry.id === faceId);
    if (found) {
      return cloneFace(found.face);
    }
  }
  return null;
};
