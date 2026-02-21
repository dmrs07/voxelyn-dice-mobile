import type { DiceFaceDef } from '../../domain/shared/types';
import { getDiceFaceIconRevision, renderDieFaceSurface } from './dice-renderer';

export interface FaceTexturePayload {
  width: number;
  height: number;
  data: Uint8Array;
}

const textureCache = new Map<string, FaceTexturePayload>();

const makeCacheKey = (face: DiceFaceDef, size: number): string =>
  `${face.id}:${face.kind}:${face.value}:${face.label}:r${getDiceFaceIconRevision(face.id)}:${size}`;

export const makeDieFaceTexturePayload = (face: DiceFaceDef, size = 64): FaceTexturePayload => {
  const normalizedSize = Math.max(16, Math.min(256, Math.floor(size)));
  const cacheKey = makeCacheKey(face, normalizedSize);
  const cached = textureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const surface = renderDieFaceSurface(face, normalizedSize);
  // Surface2D stores packed RGBA in little-endian (R,G,B,A bytes in memory).
  const bytes = new Uint8Array(surface.pixels.buffer.slice(0));
  const payload: FaceTexturePayload = {
    width: surface.width,
    height: surface.height,
    data: bytes,
  };
  textureCache.set(cacheKey, payload);
  return payload;
};
