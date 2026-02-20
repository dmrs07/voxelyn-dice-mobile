import { RNG as VoxRNG } from '@voxelyn/core';

export class SeededRng {
  private readonly rng: VoxRNG;

  public constructor(seed: number) {
    this.rng = new VoxRNG(seed >>> 0);
  }

  public nextFloat(): number {
    return this.rng.nextFloat01();
  }

  public nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      return 0;
    }
    return this.rng.nextInt(maxExclusive);
  }

  public rangeInt(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive <= minInclusive) {
      return minInclusive;
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + this.nextInt(span);
  }

  public pickOne<T>(list: readonly T[]): T {
    if (list.length === 0) {
      throw new Error('Cannot pick from empty list');
    }
    return list[this.nextInt(list.length)] as T;
  }

  public shuffle<T>(input: readonly T[]): T[] {
    const out = [...input];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(i + 1);
      const temp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = temp;
    }
    return out;
  }
}

export const makeSeed = (): number => {
  const now = Date.now() >>> 0;
  const perf = typeof performance !== 'undefined' ? Math.floor(performance.now()) >>> 0 : 0;
  return (now ^ perf) >>> 0;
};
