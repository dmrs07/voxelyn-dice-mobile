import {
  clearSurface,
  createSurface2D,
  fillRect,
  packRGBA,
  presentToCanvas,
} from '@voxelyn/core';
import type { StatusId } from '../../domain/shared/types';
import { STATUS_FX_DEFS } from '../ui/status-fx-defs';

type Rgba = [number, number, number, number];

type PatternSet = {
  primary: string[];
  secondary?: string[];
  accent?: string[];
};

const spriteCache = new Map<string, string>();

const rgba = (value: Rgba): number => packRGBA(value[0], value[1], value[2], value[3]);

const tint = (value: Rgba, delta: number): Rgba => {
  const clamp = (channel: number): number => Math.max(0, Math.min(255, channel));
  return [
    clamp(value[0] + delta),
    clamp(value[1] + delta),
    clamp(value[2] + delta),
    value[3],
  ];
};

const normalizePattern = (rows: string[]): string[] => {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => row.padEnd(width, '.'));
};

const drawPattern = (
  surface: ReturnType<typeof createSurface2D>,
  rows: string[],
  color: number,
  scale: number,
): void => {
  const pattern = normalizePattern(rows);
  const width = pattern[0]?.length ?? 0;
  const height = pattern.length;
  const offsetX = Math.floor((surface.width - width * scale) / 2);
  const offsetY = Math.floor((surface.height - height * scale) / 2);

  for (let y = 0; y < height; y += 1) {
    const row = pattern[y] as string;
    for (let x = 0; x < width; x += 1) {
      if (row[x] === '.') {
        continue;
      }
      fillRect(
        surface,
        offsetX + x * scale,
        offsetY + y * scale,
        scale,
        scale,
        color,
      );
    }
  }
};

const patternByVariant: Record<string, PatternSet> = {
  toxic_bubble: {
    primary: [
      '....####....',
      '..########..',
      '.##########.',
      '.##########.',
      '.##########.',
      '..########..',
      '...######...',
      '....####....',
    ],
    secondary: [
      '....##......',
      '...####.....',
      '...##.......',
      '......##....',
      '.....####...',
    ],
    accent: [
      '.....#......',
      '....##......',
      '.....#......',
    ],
  },
  ember: {
    primary: [
      '......##......',
      '.....####.....',
      '....######....',
      '...###..###...',
      '..###....###..',
      '..###....###..',
      '...###..###...',
      '....######....',
      '.....####.....',
      '......##......',
    ],
    secondary: [
      '......##......',
      '.....####.....',
      '....##..##....',
      '....##..##....',
      '.....####.....',
    ],
    accent: [
      '......##......',
      '.....#..#.....',
      '......##......',
    ],
  },
  bullseye: {
    primary: [
      '....########....',
      '..############..',
      '.######..######.',
      '.####......####.',
      '####........####',
      '###...####...###',
      '###...####...###',
      '####........####',
      '.####......####.',
      '.######..######.',
      '..############..',
      '....########....',
    ],
    secondary: [
      '.......##.......',
      '.......##.......',
      '....########....',
      '....########....',
      '.......##.......',
      '.......##.......',
    ],
    accent: [
      '.......##.......',
      '......####......',
      '.....######.....',
      '....########....',
      '.......##.......',
    ],
  },
  bird: {
    primary: [
      '......##......',
      '....######....',
      '...########...',
      '..####..####..',
      '.####....####.',
      '..##......##..',
      '...##....##...',
      '....######....',
      '.....####.....',
    ],
    secondary: [
      '.....####.....',
      '....##..##....',
      '...##....##...',
      '..##......##..',
      '...##....##...',
      '....######....',
    ],
    accent: [
      '......##......',
      '.....####.....',
      '......##......',
    ],
  },
  blood_drop: {
    primary: [
      '......##......',
      '.....####.....',
      '....######....',
      '...########...',
      '..##########..',
      '..##########..',
      '...########...',
      '....######....',
      '.....####.....',
      '......##......',
    ],
    secondary: [
      '......##......',
      '.....####.....',
      '.....####.....',
      '......##......',
    ],
    accent: [
      '.....##.......',
      '....##........',
    ],
  },
  void_eye: {
    primary: [
      '...##########...',
      '..############..',
      '.####......####.',
      '####........####',
      '###...####...###',
      '###...####...###',
      '####........####',
      '.####......####.',
      '..############..',
      '...##########...',
    ],
    secondary: [
      '......####......',
      '.....######.....',
      '.....######.....',
      '......####......',
    ],
    accent: [
      '.......##.......',
      '......####......',
      '.......##.......',
    ],
  },
  shield: {
    primary: [
      '....########....',
      '...##########...',
      '..############..',
      '..###......###..',
      '..###......###..',
      '..###......###..',
      '..####....####..',
      '...###....###...',
      '....##....##....',
      '.....##..##.....',
      '......####......',
    ],
    secondary: [
      '......####......',
      '.....######.....',
      '.....######.....',
      '......####......',
      '.......##.......',
    ],
    accent: [
      '....##....##....',
      '.....##..##.....',
      '......####......',
    ],
  },
  dash: {
    primary: [
      '....####........',
      '...######.......',
      '..########......',
      '.##########.....',
      '..##########....',
      '...##########...',
      '....##########..',
      '.....########...',
      '......######....',
      '.......####.....',
    ],
    secondary: [
      '..##............',
      '.####...........',
      '..####..........',
      '...####.........',
      '....####........',
      '.....####.......',
      '......####......',
      '.......####.....',
    ],
    accent: [
      '..............##',
      '.............###',
      '............####',
    ],
  },
  spark_star: {
    primary: [
      '.......##.......',
      '.......##.......',
      '..##...##...##..',
      '...##..##..##...',
      '....##.##.##....',
      '######.##.######',
      '....##.##.##....',
      '...##..##..##...',
      '..##...##...##..',
      '.......##.......',
      '.......##.......',
    ],
    secondary: [
      '......####......',
      '.....######.....',
      '......####......',
      '.......##.......',
    ],
    accent: [
      '...#........#...',
      '.....#....#.....',
      '.......##.......',
    ],
  },
  arc: {
    primary: [
      '....##......##....',
      '...####....####...',
      '..######..######..',
      '....####..####....',
      '......######......',
      '.....########.....',
      '....####..####....',
      '..######..######..',
      '...####....####...',
      '....##......##....',
    ],
    secondary: [
      '......##..##......',
      '.....###..###.....',
      '....####..####....',
      '.....###..###.....',
      '......##..##......',
    ],
    accent: [
      '........##........',
      '.......####.......',
      '........##........',
    ],
  },
  cog: {
    primary: [
      '.....##..##.....',
      '..####....####..',
      '.####......####.',
      '.##..######..##.',
      '##..########..##',
      '##..########..##',
      '.##..######..##.',
      '.####......####.',
      '..####....####..',
      '.....##..##.....',
    ],
    secondary: [
      '......####......',
      '.....######.....',
      '.....######.....',
      '......####......',
    ],
    accent: [
      '......##..##....',
      '....##......##..',
      '..##..........##',
    ],
  },
};

const paletteByStatus: Record<StatusId, { primary: Rgba; secondary: Rgba; accent: Rgba }> = {
  block: {
    primary: [67, 130, 220, 255],
    secondary: [156, 199, 255, 255],
    accent: [223, 242, 255, 255],
  },
  dodge: {
    primary: [67, 194, 216, 255],
    secondary: [129, 244, 255, 255],
    accent: [224, 255, 255, 255],
  },
  mark: {
    primary: [232, 48, 58, 255],
    secondary: [255, 126, 130, 255],
    accent: [255, 230, 230, 255],
  },
  poison: {
    primary: [116, 61, 160, 255],
    secondary: [173, 111, 223, 255],
    accent: [221, 186, 255, 255],
  },
  burn: {
    primary: [197, 86, 35, 255],
    secondary: [239, 137, 52, 255],
    accent: [255, 225, 136, 255],
  },
  bleed: {
    primary: [169, 45, 55, 255],
    secondary: [223, 82, 92, 255],
    accent: [255, 182, 190, 255],
  },
  stun: {
    primary: [201, 152, 65, 255],
    secondary: [246, 203, 113, 255],
    accent: [255, 241, 197, 255],
  },
  fear: {
    primary: [74, 58, 121, 255],
    secondary: [130, 94, 187, 255],
    accent: [213, 195, 248, 255],
  },
  inspired: {
    primary: [191, 146, 52, 255],
    secondary: [234, 197, 92, 255],
    accent: [255, 240, 178, 255],
  },
  charged: {
    primary: [70, 150, 236, 255],
    secondary: [152, 226, 255, 255],
    accent: [239, 250, 255, 255],
  },
  turret: {
    primary: [143, 117, 71, 255],
    secondary: [203, 164, 95, 255],
    accent: [246, 223, 162, 255],
  },
};

const hashVariant = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const encodeSurface = (surface: ReturnType<typeof createSurface2D>): string => {
  if (typeof document === 'undefined') {
    return '';
  }

  const canvas = document.createElement('canvas');
  canvas.width = surface.width;
  canvas.height = surface.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }

  context.imageSmoothingEnabled = false;
  presentToCanvas(context, surface);
  return canvas.toDataURL('image/png');
};

const renderStatusSprite = (statusId: StatusId, variantKey: string): string => {
  const cacheKey = `${statusId}:${variantKey}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const spriteVariant = STATUS_FX_DEFS[statusId].spriteVariant;
  const pattern = patternByVariant[spriteVariant] ?? patternByVariant.spark_star;
  const palette = paletteByStatus[statusId];
  const variantSeed = hashVariant(variantKey);
  const delta = (variantSeed % 3) * 8;

  const primaryColor = rgba(tint(palette.primary, delta));
  const secondaryColor = rgba(tint(palette.secondary, delta));
  const accentColor = rgba(tint(palette.accent, delta));

  const surface = createSurface2D(32, 32);
  clearSurface(surface, packRGBA(0, 0, 0, 0));

  drawPattern(surface, pattern.primary, primaryColor, 1);
  if (pattern.secondary) {
    drawPattern(surface, pattern.secondary, secondaryColor, 1);
  }
  if (pattern.accent) {
    drawPattern(surface, pattern.accent, accentColor, 1);
  }

  const src = encodeSurface(surface);
  spriteCache.set(cacheKey, src);
  return src;
};

export const getStatusFxSprite = (statusId: StatusId, variant = 'base'): string =>
  renderStatusSprite(statusId, variant);

export const clearStatusFxSpriteCache = (): void => {
  spriteCache.clear();
};
