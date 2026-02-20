import type { ProfileState } from '../domain/shared/types';

export const PROFILE_VERSION = 1;

export const serializeProfile = (profile: ProfileState): string => JSON.stringify(profile);

export const deserializeProfile = (raw: string): ProfileState | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileState>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    if (typeof parsed.version !== 'number') {
      return null;
    }

    return {
      version: PROFILE_VERSION,
      runsPlayed: typeof parsed.runsPlayed === 'number' ? parsed.runsPlayed : 0,
      runsWon: typeof parsed.runsWon === 'number' ? parsed.runsWon : 0,
      unlocks: {
        classes: Array.isArray(parsed.unlocks?.classes)
          ? parsed.unlocks.classes.filter((x): x is string => typeof x === 'string')
          : [],
        backgrounds: Array.isArray(parsed.unlocks?.backgrounds)
          ? parsed.unlocks.backgrounds.filter((x): x is string => typeof x === 'string')
          : [],
        relics: Array.isArray(parsed.unlocks?.relics)
          ? parsed.unlocks.relics.filter((x): x is string => typeof x === 'string')
          : [],
      },
      compendium: {
        eventsSeen: Array.isArray(parsed.compendium?.eventsSeen)
          ? parsed.compendium.eventsSeen.filter((x): x is string => typeof x === 'string')
          : [],
        enemiesSeen: Array.isArray(parsed.compendium?.enemiesSeen)
          ? parsed.compendium.enemiesSeen.filter((x): x is string => typeof x === 'string')
          : [],
        relicsSeen: Array.isArray(parsed.compendium?.relicsSeen)
          ? parsed.compendium.relicsSeen.filter((x): x is string => typeof x === 'string')
          : [],
      },
    };
  } catch {
    return null;
  }
};
