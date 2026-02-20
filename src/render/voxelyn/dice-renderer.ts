import { clearSurface, createSurface2D, fillRect, packRGBA, presentToCanvas } from '@voxelyn/core';
import type { DiceFaceDef } from '../../domain/shared/types';

const faceCache = new Map<string, string>();

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

const kindIcon = (kind: DiceFaceDef['kind']): string => {
  switch (kind) {
    case 'attack':
      return 'ATK';
    case 'block':
      return 'BLK';
    case 'heal':
      return 'HL';
    case 'mark':
      return 'MRK';
    case 'cleanse':
      return 'CLN';
    case 'swap':
      return 'SWP';
    case 'stun':
      return 'STN';
    case 'focus':
      return 'FOC';
    case 'special':
      return 'SP';
    default:
      return '?';
  }
};

export const renderDieFaceSprite = (face: DiceFaceDef): string => {
  const cacheKey = `${face.id}:${face.kind}:${face.value}:${face.label}`;
  const cached = faceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const surface = createSurface2D(64, 64);
  clearSurface(surface, packRGBA(24, 28, 36, 255));
  fillRect(surface, 4, 4, 56, 56, kindColor(face.kind));
  fillRect(surface, 8, 8, 48, 48, packRGBA(12, 16, 24, 255));

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    presentToCanvas(ctx, surface);
    ctx.fillStyle = '#f4f1de';
    ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(kindIcon(face.kind), 32, 20);
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.fillText(String(face.value), 32, 40);
    ctx.font = 'bold 8px "Trebuchet MS", sans-serif';
    ctx.fillText(face.label.slice(0, 10), 32, 54);
  }

  const src = canvas.toDataURL('image/png');
  faceCache.set(cacheKey, src);
  return src;
};
