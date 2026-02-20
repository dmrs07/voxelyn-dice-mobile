import {
  clearSurface,
  createSurface2D,
  fillRect,
  packRGBA,
  presentToCanvas,
  setPixel,
} from '@voxelyn/core';
import type { AtlasSource } from '@voxelyn/animation';
import type { DiceFaceDef } from '../../domain/shared/types';
import { getLoadedAtlas, resolveDiceFaceIcon } from '../pixel/asset-loader';

const faceCache = new Map<string, string>();
const atlasPixelCache = new WeakMap<object, Uint32Array>();

const kindColor = (kind: DiceFaceDef['kind']): number => {
  switch (kind) {
    case 'attack':
      return packRGBA(180, 52, 41, 255);
    case 'block':
      return packRGBA(45, 92, 154, 255);
    case 'heal':
      return packRGBA(42, 132, 71, 255);
    case 'mark':
      return packRGBA(133, 110, 43, 255);
    case 'cleanse':
      return packRGBA(44, 137, 120, 255);
    case 'swap':
      return packRGBA(62, 92, 154, 255);
    case 'stun':
      return packRGBA(108, 73, 148, 255);
    case 'focus':
      return packRGBA(150, 123, 47, 255);
    case 'special':
      return packRGBA(170, 95, 23, 255);
    default:
      return packRGBA(89, 89, 89, 255);
  }
};

const symbolPatterns: Record<string, string[]> = {
  attack: [
    '00010000',
    '00111000',
    '01111100',
    '00111000',
    '00111000',
    '00111000',
    '00111000',
    '00000000',
  ],
  block: [
    '01111110',
    '01000010',
    '01000010',
    '01000010',
    '01000010',
    '01000010',
    '01111110',
    '00000000',
  ],
  heal: [
    '00011000',
    '00011000',
    '00011000',
    '11111111',
    '11111111',
    '00011000',
    '00011000',
    '00011000',
  ],
  mark: [
    '00111000',
    '01111100',
    '11111110',
    '11111110',
    '01111100',
    '00111000',
    '00010000',
    '00000000',
  ],
  cleanse: [
    '11000011',
    '01100110',
    '00111100',
    '00011000',
    '00111100',
    '01100110',
    '11000011',
    '00000000',
  ],
  swap: [
    '11100000',
    '00110000',
    '00011110',
    '00001100',
    '01111000',
    '00001100',
    '00011000',
    '00000000',
  ],
  stun: [
    '01010100',
    '11111110',
    '01111100',
    '11111110',
    '01111100',
    '11111110',
    '01010100',
    '00000000',
  ],
  focus: [
    '00111100',
    '01100110',
    '11000011',
    '10011001',
    '10011001',
    '11000011',
    '01100110',
    '00111100',
  ],
  special: [
    '00111100',
    '01111110',
    '11011011',
    '11111111',
    '11111111',
    '11011011',
    '01111110',
    '00111100',
  ],
};

const atlasToPixels = (atlas: AtlasSource): Uint32Array => {
  const cached = atlasPixelCache.get(atlas as object);
  if (cached) {
    return cached;
  }

  if ('pixels' in atlas) {
    atlasPixelCache.set(atlas as object, atlas.pixels);
    return atlas.pixels;
  }

  const out = new Uint32Array(atlas.width * atlas.height);
  const bytes = atlas.data;
  for (let i = 0; i < out.length; i += 1) {
    const offset = i * 4;
    out[i] = packRGBA(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
  }
  atlasPixelCache.set(atlas as object, out);
  return out;
};

const drawPatternIcon = (
  surface: ReturnType<typeof createSurface2D>,
  kind: string,
  x: number,
  y: number,
  scale: number,
  color: number,
): void => {
  const pattern = symbolPatterns[kind] ?? symbolPatterns.special;

  for (let py = 0; py < pattern.length; py += 1) {
    const row = pattern[py] ?? '';
    for (let px = 0; px < row.length; px += 1) {
      if (row[px] !== '1') {
        continue;
      }
      fillRect(surface, x + px * scale, y + py * scale, scale, scale, color);
    }
  }
};

const drawAtlasIcon = (
  surface: ReturnType<typeof createSurface2D>,
  atlas: AtlasSource,
  frame: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  scale: number,
): boolean => {
  if (frame.w <= 0 || frame.h <= 0) {
    return false;
  }

  const pixels = atlasToPixels(atlas);

  for (let y = 0; y < frame.h; y += 1) {
    const sy = frame.y + y;
    if (sy < 0 || sy >= atlas.height) {
      continue;
    }
    for (let x = 0; x < frame.w; x += 1) {
      const sx = frame.x + x;
      if (sx < 0 || sx >= atlas.width) {
        continue;
      }

      const packed = pixels[sy * atlas.width + sx] ?? 0;
      const alpha = (packed >>> 24) & 0xff;
      if (alpha === 0) {
        continue;
      }

      for (let oy = 0; oy < scale; oy += 1) {
        for (let ox = 0; ox < scale; ox += 1) {
          setPixel(surface, dx + x * scale + ox, dy + y * scale + oy, packed);
        }
      }
    }
  }

  return true;
};

const drawValuePips = (
  surface: ReturnType<typeof createSurface2D>,
  value: number,
  color: number,
): void => {
  const count = Math.max(0, Math.min(12, Math.floor(value)));
  const cols = 6;
  const size = 3;
  const gap = 1;
  const baseX = 22;
  const baseY = 48;

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    fillRect(surface, baseX + col * (size + gap), baseY + row * (size + gap), size, size, color);
  }
};

export const renderDieFaceSprite = (face: DiceFaceDef): string => {
  const cacheKey = `${face.id}:${face.kind}:${face.value}:${face.label}`;
  const cached = faceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const surface = createSurface2D(64, 64);
  clearSurface(surface, packRGBA(12, 16, 24, 255));
  fillRect(surface, 2, 2, 60, 60, kindColor(face.kind));
  fillRect(surface, 6, 6, 52, 52, packRGBA(16, 20, 30, 255));
  fillRect(surface, 8, 8, 48, 48, packRGBA(8, 10, 16, 255));

  const icon = resolveDiceFaceIcon({ id: face.id, kind: face.kind }, true);
  let iconDrawn = false;

  if (icon?.atlasId && icon.frame) {
    const atlas = getLoadedAtlas(icon.atlasId);
    if (atlas) {
      const scale = Math.max(1, Math.floor(24 / Math.max(1, icon.frame.w)));
      const iconW = icon.frame.w * scale;
      const iconH = icon.frame.h * scale;
      iconDrawn = drawAtlasIcon(
        surface,
        atlas,
        icon.frame,
        Math.floor((64 - iconW) / 2),
        Math.floor((36 - iconH) / 2),
        scale,
      );
    }
  }

  if (!iconDrawn) {
    drawPatternIcon(
      surface,
      icon?.fallbackKind ?? face.kind,
      20,
      16,
      3,
      packRGBA(235, 224, 193, 255),
    );
  }

  drawValuePips(surface, face.value, packRGBA(236, 184, 88, 255));

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    presentToCanvas(ctx, surface);
  }

  const src = canvas.toDataURL('image/png');
  faceCache.set(cacheKey, src);
  return src;
};
