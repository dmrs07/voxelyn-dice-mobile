import type { StorageAdapter } from '../../domain/shared/types';

const memoryFallback = new Map<string, string>();

export const webStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // no-op
    }
    return memoryFallback.get(key) ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // no-op
    }
    memoryFallback.set(key, value);
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch {
      // no-op
    }
    memoryFallback.delete(key);
  },
};
