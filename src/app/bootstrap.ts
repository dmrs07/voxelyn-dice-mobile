import { loadContent } from '../content/loaders/load-content';
import { createGameState } from '../core/state-machine';
import { loadProfile, saveProfile } from '../domain/meta/profile-store';
import { sanitizeProfileForContent } from '../domain/meta/unlocks';
import { assertVoxelynAnimationApi } from '../anim/voxelyn-animation-adapter';
import { warmPixelAssets, getLoadedAtlas } from '../render/pixel/asset-loader';
import { GameRouter } from './router';
import { installViewportHeightVar } from './viewport';

export const bootstrapApp = async (): Promise<void> => {
  installViewportHeightVar();
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('Elemento #app nao encontrado.');
  }

  root.innerHTML = '<main class="screen"><p>Carregando Voxelyn Dice Expedition...</p></main>';
  assertVoxelynAnimationApi();
  await warmPixelAssets();

  if (import.meta.env && import.meta.env.DEV) {
    const atlas = getLoadedAtlas('demo.aviadora');
    if (atlas) {
      // eslint-disable-next-line no-console
      console.info('[dev] demo.aviadora atlas loaded', {
        width: atlas.width,
        height: atlas.height,
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn('[dev] demo.aviadora atlas not loaded (image missing?)');
    }
  }

  const content = await loadContent();
  const loadedProfile = await loadProfile();
  const profile = sanitizeProfileForContent(loadedProfile, content);
  await saveProfile(profile);

  const initialState = createGameState(content, profile);
  const router = new GameRouter(root, initialState);
  router.render();
};
