import { deserializeProfile, serializeProfile } from '../../core/serializer';
import { capacitorStorageAdapter } from '../../platform/capacitor/storage';
import { createDefaultProfile } from './unlocks';
import type { ProfileState, StorageAdapter } from '../shared/types';

const PROFILE_KEY = 'voxelyn_dice_profile';

const getStorage = (): StorageAdapter => capacitorStorageAdapter;

export const loadProfile = async (): Promise<ProfileState> => {
  const storage = getStorage();
  const raw = await storage.getItem(PROFILE_KEY);
  if (!raw) {
    return createDefaultProfile();
  }
  const parsed = deserializeProfile(raw);
  return parsed ?? createDefaultProfile();
};

export const saveProfile = async (profile: ProfileState): Promise<void> => {
  const storage = getStorage();
  await storage.setItem(PROFILE_KEY, serializeProfile(profile));
};

export const clearProfile = async (): Promise<void> => {
  const storage = getStorage();
  await storage.removeItem(PROFILE_KEY);
};
