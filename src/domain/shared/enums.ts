export const FACE_KINDS = [
  'empty',
  'attack',
  'block',
  'heal',
  'mark',
  'cleanse',
  'swap',
  'stun',
  'focus',
  'special',
] as const;

export const STATUS_IDS = [
  'block',
  'dodge',
  'mark',
  'poison',
  'burn',
  'bleed',
  'stun',
  'fear',
  'inspired',
  'charged',
  'turret',
] as const;

export const NEGATIVE_STATUS_IDS = ['mark', 'poison', 'burn', 'bleed', 'stun', 'fear'] as const;

export const NODE_TYPES = [
  'start',
  'event',
  'combat',
  'shop',
  'rest',
  'elite',
  'boss',
] as const;

export const APP_PHASES = ['meta', 'map', 'event', 'combat', 'reward', 'run_end'] as const;

export const RESOURCE_IDS = [
  'supplies',
  'morale',
  'threat',
  'injuries',
  'gold',
  'consumables',
] as const;
