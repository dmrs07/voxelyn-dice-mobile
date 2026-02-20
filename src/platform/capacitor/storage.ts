import type { StorageAdapter } from '../../domain/shared/types';
import { webStorageAdapter } from '../web/storage';
import { getCapacitorRuntime, isNativeCapacitor } from './runtime';

export const capacitorStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeCapacitor()) {
      return webStorageAdapter.getItem(key);
    }

    try {
      const pref = getCapacitorRuntime()?.Plugins?.Preferences;
      if (!pref) {
        return webStorageAdapter.getItem(key);
      }
      const response = await pref.get({ key });
      return response.value;
    } catch {
      return webStorageAdapter.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!isNativeCapacitor()) {
      await webStorageAdapter.setItem(key, value);
      return;
    }

    try {
      const pref = getCapacitorRuntime()?.Plugins?.Preferences;
      if (!pref) {
        await webStorageAdapter.setItem(key, value);
        return;
      }
      await pref.set({ key, value });
    } catch {
      await webStorageAdapter.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!isNativeCapacitor()) {
      await webStorageAdapter.removeItem(key);
      return;
    }

    try {
      const pref = getCapacitorRuntime()?.Plugins?.Preferences;
      if (!pref) {
        await webStorageAdapter.removeItem(key);
        return;
      }
      await pref.remove({ key });
    } catch {
      await webStorageAdapter.removeItem(key);
    }
  },
};
