export interface CapacitorPreferences {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

export interface CapacitorHaptics {
  impact(options: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>;
}

export interface CapacitorLike {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Preferences?: CapacitorPreferences;
    Haptics?: CapacitorHaptics;
  };
}

export const getCapacitorRuntime = (): CapacitorLike | null => {
  const holder = globalThis as typeof globalThis & { Capacitor?: CapacitorLike };
  return holder.Capacitor ?? null;
};

export const isNativeCapacitor = (): boolean => {
  const cap = getCapacitorRuntime();
  return cap?.isNativePlatform?.() ?? false;
};
