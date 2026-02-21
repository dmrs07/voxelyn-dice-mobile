import { renderVoxelMiniature } from './voxel-model-factory';
import { MAP_MINIATURE_INTERNAL_PX } from '../pixel/constants';

const spriteCache = new Map<string, string>();

export const getMiniatureSprite = (key: string, color: string): string => {
  const cacheKey = `${key}:${color}:${MAP_MINIATURE_INTERNAL_PX}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = renderVoxelMiniature({
    key,
    baseColor: color,
    width: MAP_MINIATURE_INTERNAL_PX,
    height: MAP_MINIATURE_INTERNAL_PX,
  });
  const src = canvas.toDataURL('image/png');
  spriteCache.set(cacheKey, src);
  return src;
};

export const clearSpriteCache = (): void => {
  spriteCache.clear();
};
