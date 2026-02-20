import { PROFILE_VERSION } from '../../core/serializer';
import type { GameContent, ProfileState, RunState } from '../shared/types';

export const DEFAULT_UNLOCKED_CLASSES = ['aviadora', 'ocultista', 'cacador', 'mecanico'];
export const DEFAULT_UNLOCKED_BACKGROUNDS = [
  'ex_correio_aereo',
  'cartografo_posteres',
  'reporter_radio',
  'guia_local',
  'colecionador_selos',
  'ex_combatente',
];

export const createDefaultProfile = (): ProfileState => ({
  version: PROFILE_VERSION,
  runsPlayed: 0,
  runsWon: 0,
  unlocks: {
    classes: [...DEFAULT_UNLOCKED_CLASSES],
    backgrounds: [...DEFAULT_UNLOCKED_BACKGROUNDS],
    relics: [],
  },
  compendium: {
    eventsSeen: [],
    enemiesSeen: [],
    relicsSeen: [],
  },
});

export const sanitizeProfileForContent = (
  profile: ProfileState,
  content: GameContent,
): ProfileState => {
  const classIds = new Set(content.classes.map((entry) => entry.id));
  const backgroundIds = new Set(content.backgrounds.map((entry) => entry.id));
  const relicIds = new Set(content.relics.map((entry) => entry.id));

  const classUnlocks = profile.unlocks.classes.filter((id) => classIds.has(id));
  const backgroundUnlocks = profile.unlocks.backgrounds.filter((id) => backgroundIds.has(id));
  const relicUnlocks = profile.unlocks.relics.filter((id) => relicIds.has(id));

  for (const id of DEFAULT_UNLOCKED_CLASSES) {
    if (classIds.has(id) && !classUnlocks.includes(id)) {
      classUnlocks.push(id);
    }
  }

  for (const id of DEFAULT_UNLOCKED_BACKGROUNDS) {
    if (backgroundIds.has(id) && !backgroundUnlocks.includes(id)) {
      backgroundUnlocks.push(id);
    }
  }

  return {
    ...profile,
    unlocks: {
      classes: classUnlocks,
      backgrounds: backgroundUnlocks,
      relics: relicUnlocks,
    },
  };
};

export const registerRunResult = (
  profile: ProfileState,
  run: RunState,
  content: GameContent,
): ProfileState => {
  const next: ProfileState = {
    ...profile,
    runsPlayed: profile.runsPlayed + 1,
    runsWon: profile.runsWon + (run.victory ? 1 : 0),
    unlocks: {
      classes: [...profile.unlocks.classes],
      backgrounds: [...profile.unlocks.backgrounds],
      relics: [...profile.unlocks.relics],
    },
    compendium: {
      eventsSeen: [...profile.compendium.eventsSeen],
      enemiesSeen: [...profile.compendium.enemiesSeen],
      relicsSeen: [...profile.compendium.relicsSeen],
    },
  };

  for (const relicId of run.relicIds) {
    if (!next.unlocks.relics.includes(relicId)) {
      next.unlocks.relics.push(relicId);
    }
    if (!next.compendium.relicsSeen.includes(relicId)) {
      next.compendium.relicsSeen.push(relicId);
    }
  }

  const unlockClassOrder = content.classes.map((entry) => entry.id);
  const unlockBackgroundOrder = content.backgrounds.map((entry) => entry.id);

  const pendingClassUnlock = unlockClassOrder.find((id) => !next.unlocks.classes.includes(id));
  const pendingBackgroundUnlock = unlockBackgroundOrder.find(
    (id) => !next.unlocks.backgrounds.includes(id),
  );

  if (run.victory && pendingClassUnlock) {
    next.unlocks.classes.push(pendingClassUnlock);
  }

  if ((run.victory || profile.runsPlayed % 2 === 0) && pendingBackgroundUnlock) {
    next.unlocks.backgrounds.push(pendingBackgroundUnlock);
  }

  return sanitizeProfileForContent(next, content);
};

export const markEventSeen = (profile: ProfileState, eventId: string): ProfileState => {
  if (profile.compendium.eventsSeen.includes(eventId)) {
    return profile;
  }
  return {
    ...profile,
    compendium: {
      ...profile.compendium,
      eventsSeen: [...profile.compendium.eventsSeen, eventId],
    },
  };
};

export const markEnemiesSeen = (profile: ProfileState, enemyIds: string[]): ProfileState => {
  const set = new Set(profile.compendium.enemiesSeen);
  for (const id of enemyIds) {
    set.add(id);
  }
  return {
    ...profile,
    compendium: {
      ...profile.compendium,
      enemiesSeen: [...set],
    },
  };
};
