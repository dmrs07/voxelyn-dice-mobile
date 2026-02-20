import { renderVoxelMiniature } from './voxel-model-factory';

const spriteCache = new Map<string, string>();

export const getMiniatureSprite = (key: string, color: string): string => {
  const cacheKey = `${key}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = renderVoxelMiniature({ key, baseColor: color });
  const src = canvas.toDataURL('image/png');
  spriteCache.set(cacheKey, src);
  return src;
};

export const clearSpriteCache = (): void => {
  spriteCache.clear();
};
