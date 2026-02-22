import type { StatusId } from '../../domain/shared/types';

export type StatusFxTier = 1 | 2 | 3;

export interface StatusFxTierConfig {
  particles: number;
  cadenceMs: number;
}

export interface StatusFxDef {
  id: StatusId;
  className: `status-${StatusId}`;
  cssVar: `--st-${StatusId}`;
  mode: 'tint' | 'border' | 'particle' | 'icon';
  layer: number;
  spriteVariant: string;
  tiers: Record<StatusFxTier, StatusFxTierConfig>;
}

const tier = (baseCadenceMs: number): Record<StatusFxTier, StatusFxTierConfig> => ({
  1: { particles: 2, cadenceMs: baseCadenceMs },
  2: { particles: 4, cadenceMs: Math.max(220, Math.round(baseCadenceMs * 0.84)) },
  3: { particles: 6, cadenceMs: Math.max(180, Math.round(baseCadenceMs * 0.72)) },
});

export const STATUS_FX_DEFS: Record<StatusId, StatusFxDef> = {
  block: {
    id: 'block',
    className: 'status-block',
    cssVar: '--st-block',
    mode: 'border',
    layer: 30,
    spriteVariant: 'shield',
    tiers: tier(920),
  },
  dodge: {
    id: 'dodge',
    className: 'status-dodge',
    cssVar: '--st-dodge',
    mode: 'border',
    layer: 32,
    spriteVariant: 'dash',
    tiers: tier(780),
  },
  mark: {
    id: 'mark',
    className: 'status-mark',
    cssVar: '--st-mark',
    mode: 'icon',
    layer: 51,
    spriteVariant: 'bullseye',
    tiers: tier(900),
  },
  poison: {
    id: 'poison',
    className: 'status-poison',
    cssVar: '--st-poison',
    mode: 'tint',
    layer: 20,
    spriteVariant: 'toxic_bubble',
    tiers: tier(860),
  },
  burn: {
    id: 'burn',
    className: 'status-burn',
    cssVar: '--st-burn',
    mode: 'tint',
    layer: 21,
    spriteVariant: 'ember',
    tiers: tier(760),
  },
  bleed: {
    id: 'bleed',
    className: 'status-bleed',
    cssVar: '--st-bleed',
    mode: 'particle',
    layer: 40,
    spriteVariant: 'blood_drop',
    tiers: tier(940),
  },
  stun: {
    id: 'stun',
    className: 'status-stun',
    cssVar: '--st-stun',
    mode: 'icon',
    layer: 50,
    spriteVariant: 'bird',
    tiers: tier(1020),
  },
  fear: {
    id: 'fear',
    className: 'status-fear',
    cssVar: '--st-fear',
    mode: 'tint',
    layer: 10,
    spriteVariant: 'void_eye',
    tiers: tier(980),
  },
  inspired: {
    id: 'inspired',
    className: 'status-inspired',
    cssVar: '--st-inspired',
    mode: 'particle',
    layer: 41,
    spriteVariant: 'spark_star',
    tiers: tier(760),
  },
  charged: {
    id: 'charged',
    className: 'status-charged',
    cssVar: '--st-charged',
    mode: 'border',
    layer: 31,
    spriteVariant: 'arc',
    tiers: tier(720),
  },
  turret: {
    id: 'turret',
    className: 'status-turret',
    cssVar: '--st-turret',
    mode: 'icon',
    layer: 52,
    spriteVariant: 'cog',
    tiers: tier(840),
  },
};

export const STATUS_FX_LAYER_ORDER: StatusId[] = [
  'fear',
  'poison',
  'burn',
  'block',
  'charged',
  'dodge',
  'bleed',
  'inspired',
  'stun',
  'mark',
  'turret',
];

export const STATUS_FX_CLASS_NAMES = Object.values(STATUS_FX_DEFS).map((entry) => entry.className);

export const STATUS_FX_CSS_VARS = Object.values(STATUS_FX_DEFS).map((entry) => entry.cssVar);

export const resolveStatusFxTier = (stacks: number): StatusFxTier => {
  const normalized = Math.max(0, Math.floor(stacks));
  if (normalized >= 3) {
    return 3;
  }
  if (normalized >= 2) {
    return 2;
  }
  return 1;
};

export const resolveStatusFxParticles = (statusId: StatusId, stacks: number): number => {
  const fxTier = resolveStatusFxTier(stacks);
  return STATUS_FX_DEFS[statusId].tiers[fxTier].particles;
};

export const resolveStatusFxCadence = (statusId: StatusId, stacks: number): number => {
  const fxTier = resolveStatusFxTier(stacks);
  return STATUS_FX_DEFS[statusId].tiers[fxTier].cadenceMs;
};
