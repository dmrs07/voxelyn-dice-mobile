import { renderRunHud } from '../render/ui/hud-renderer';
import type { NodeType, RewardOption, RunState } from '../domain/shared/types';

export interface RewardScreenHandlers {
  onChooseReward: (rewardId: string) => void;
  onSkip: () => void;
}

export interface RewardScreenState {
  run: RunState;
  options: RewardOption[];
  source: NodeType;
  message: string;
}

const sourceTitle = (source: NodeType): string => {
  if (source === 'shop') {
    return 'Mercado';
  }
  if (source === 'boss') {
    return 'Tesouro do boss';
  }
  return 'Recompensa de combate';
};

export const renderRewardScreen = (
  root: HTMLElement,
  state: RewardScreenState,
  handlers: RewardScreenHandlers,
): void => {
  const optionsMarkup = state.options
    .map(
      (option) => `
      <button class="reward-card" data-reward-id="${option.id}">
        <strong>${option.label}</strong>
        <small>${option.detail}</small>
        <em>${option.kind}</em>
      </button>
    `,
    )
    .join('');

  root.innerHTML = `
    <main class="screen reward-screen">
      <header class="screen-header">
        <h1>${sourceTitle(state.source)}</h1>
      </header>

      ${renderRunHud(state.run)}

      <section class="reward-grid" aria-label="Opcoes de recompensa">
        ${optionsMarkup || '<p>Sem recompensas disponiveis.</p>'}
      </section>

      <div class="reward-actions">
        <button id="skip-reward-btn" class="secondary-btn" type="button">Pular recompensa</button>
      </div>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelectorAll<HTMLButtonElement>('.reward-card[data-reward-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const rewardId = button.dataset.rewardId;
      if (!rewardId) {
        return;
      }
      handlers.onChooseReward(rewardId);
    });
  });

  root.querySelector<HTMLButtonElement>('#skip-reward-btn')?.addEventListener('click', () => {
    handlers.onSkip();
  });
};
