import { getCapacitorRuntime, isNativeCapacitor } from './runtime';

export const triggerLightHaptic = async (): Promise<void> => {
  if (!isNativeCapacitor()) {
    return;
  }
  try {
    const haptics = getCapacitorRuntime()?.Plugins?.Haptics;
    await haptics?.impact({ style: 'LIGHT' });
  } catch {
    // no-op
  }
};
