import { loadContent } from '../content/loaders/load-content';
import { createGameState } from '../core/state-machine';
import { loadProfile, saveProfile } from '../domain/meta/profile-store';
import { sanitizeProfileForContent } from '../domain/meta/unlocks';
import { assertVoxelynAnimationApi } from '../anim/voxelyn-animation-adapter';
import { GameRouter } from './router';

export const bootstrapApp = async (): Promise<void> => {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('Elemento #app nao encontrado.');
  }

  root.innerHTML = '<main class="screen"><p>Carregando Voxelyn Dice Expedition...</p></main>';
  assertVoxelynAnimationApi();

  const content = await loadContent();
  const loadedProfile = await loadProfile();
  const profile = sanitizeProfileForContent(loadedProfile, content);
  await saveProfile(profile);

  const initialState = createGameState(content, profile);
  const router = new GameRouter(root, initialState);
  router.render();
};
