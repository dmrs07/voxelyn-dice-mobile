import {
  clearSurface,
  createSurface2D,
  fillRect,
  packRGBA,
  presentToCanvas,
  projectIso,
} from '@voxelyn/core';
import { BASE_MINIATURE_PX, MAP_MINIATURE_INTERNAL_PX } from '../pixel/constants';

export interface MiniatureRenderOptions {
  key: string;
  baseColor: string;
  width?: number;
  height?: number;
}

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const toRgb = (hexColor: string): { r: number; g: number; b: number } => {
  const normalized = hexColor.replace('#', '').trim();
  const clean = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { r: 180, g: 148, b: 80 };
  }

  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
};

const shade = (
  color: { r: number; g: number; b: number },
  factor: number,
): { r: number; g: number; b: number } => ({
  r: Math.max(0, Math.min(255, Math.round(color.r * factor))),
  g: Math.max(0, Math.min(255, Math.round(color.g * factor))),
  b: Math.max(0, Math.min(255, Math.round(color.b * factor))),
});

export const renderVoxelMiniature = (options: MiniatureRenderOptions): HTMLCanvasElement => {
  const width = options.width ?? MAP_MINIATURE_INTERNAL_PX;
  const height = options.height ?? MAP_MINIATURE_INTERNAL_PX;
  const scale = Math.max(1, Math.floor(Math.min(width, height) / BASE_MINIATURE_PX));
  const surface = createSurface2D(width, height);
  clearSurface(surface, packRGBA(0, 0, 0, 0));

  const base = toRgb(options.baseColor);
  const topColor = shade(base, 1.2);
  const leftColor = shade(base, 0.8);
  const rightColor = shade(base, 0.6);

  const topPacked = packRGBA(topColor.r, topColor.g, topColor.b, 255);
  const leftPacked = packRGBA(leftColor.r, leftColor.g, leftColor.b, 255);
  const rightPacked = packRGBA(rightColor.r, rightColor.g, rightColor.b, 255);

  const seed = hashString(options.key);
  const gridSize = 4;

  for (let x = 0; x < gridSize; x += 1) {
    for (let y = 0; y < gridSize; y += 1) {
      const noise = ((seed >> ((x + y) % 16)) & 0x7) + 1;
      const z = Math.max(1, noise % 4);
      const point = projectIso(x - 1.5, y - 1.5, z, 10 * scale, 6 * scale, 4 * scale);
      const screenX = Math.round(width / 2 + point.sx);
      const screenY = Math.round(height / 2 + point.sy);

      fillRect(surface, screenX - (5 * scale), screenY - (6 * scale), 10 * scale, 4 * scale, topPacked);
      fillRect(surface, screenX - (5 * scale), screenY - (2 * scale), 5 * scale, 6 * scale, leftPacked);
      fillRect(surface, screenX, screenY - (2 * scale), 5 * scale, 6 * scale, rightPacked);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    presentToCanvas(ctx, surface);
  }
  return canvas;
};
