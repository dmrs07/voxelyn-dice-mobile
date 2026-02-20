import type { CombatState } from '../domain/shared/types';
import { renderCombatDiorama } from '../render/voxelyn/diorama-renderer';
import { renderDieFaceSprite } from '../render/voxelyn/dice-renderer';
import { wireDiceDragAndDrop } from '../render/ui/drag-drop-controller';
import { renderEnemyIntentHud, renderPartyHealthBars } from '../render/ui/hud-renderer';

export interface CombatScreenHandlers {
  onDropDie: (rollId: string, targetTeam: 'party' | 'enemy', targetId: string) => void;
  onDiscardDie: (rollId: string) => void;
  onSelectDie: (rollId: string | null) => void;
  onTapTarget: (targetTeam: 'party' | 'enemy', targetId: string) => void;
  onReroll: () => void;
  onEndTurn: () => void;
}

export interface CombatScreenState {
  combat: CombatState;
  message: string;
  selectedRollId: string | null;
}

export const renderCombatScreen = (
  root: HTMLElement,
  state: CombatScreenState,
  handlers: CombatScreenHandlers,
): void => {
  const diceMarkup = state.combat.diceRolls
    .map((roll) => {
      const owner = state.combat.party.find((entry) => entry.id === roll.ownerId);
      const sprite = renderDieFaceSprite(roll.face);
      return `
        <article class="die-card fx-target ${roll.used ? 'used' : ''} ${roll.locked ? 'locked' : ''} ${state.selectedRollId === roll.rollId ? 'selected' : ''}" data-roll-id="${roll.rollId}" data-owner-id="${roll.ownerId}" data-face-id="${roll.face.id}">
          <img src="${sprite}" alt="Face ${roll.face.kind}" />
          <strong>${roll.face.label}</strong>
          <small>${owner?.name ?? 'Trip'} · ${roll.face.kind.toUpperCase()} ${roll.face.value}${roll.locked ? ' · TRAVADO' : ''}</small>
        </article>
      `;
    })
    .join('');

  const logMarkup = state.combat.log
    .slice(0, 10)
    .map((entry) => `<li>${entry}</li>`)
    .join('');

  root.innerHTML = `
    <main class="screen combat-screen">
      <header class="screen-header">
        <h1>Combate · Turno ${state.combat.turn}</h1>
        <div class="combat-controls">
          <button id="reroll-btn" class="secondary-btn" type="button">Rerrolar 1 dado (FOCO ${state.combat.focus})</button>
          <button id="end-turn-btn" class="primary-btn" type="button">Fim do turno</button>
        </div>
      </header>

      ${renderEnemyIntentHud(state.combat)}
      ${renderCombatDiorama(state.combat.party, state.combat.enemies)}
      ${renderPartyHealthBars(state.combat)}

      <section class="dice-tray" aria-label="Bandeja de dados">
        <h2>Dados da trip</h2>
        <div class="dice-grid">${diceMarkup || '<p>Nenhum dado disponivel.</p>'}</div>
      </section>

      <section class="discard-target drop-target" aria-label="Descartar dado" data-discard="true">
        <p>Arraste para descartar e ganhar BLK 1</p>
      </section>

      <section class="combat-log">
        <h3>Log de combate</h3>
        <ul>${logMarkup || '<li>Sem logs.</li>'}</ul>
      </section>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#reroll-btn')?.addEventListener('click', () => {
    handlers.onReroll();
  });

  root.querySelector<HTMLButtonElement>('#end-turn-btn')?.addEventListener('click', () => {
    handlers.onEndTurn();
  });

  root.querySelectorAll<HTMLElement>('.die-card[data-roll-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const rollId = card.dataset.rollId;
      if (!rollId) {
        return;
      }
      const isUsed = card.classList.contains('used');
      if (isUsed) {
        return;
      }
      handlers.onSelectDie(state.selectedRollId === rollId ? null : rollId);
    });
  });

  root.querySelectorAll<HTMLElement>('.drop-target[data-team][data-target-id]').forEach((target) => {
    target.addEventListener('click', () => {
      const team = target.dataset.team;
      const targetId = target.dataset.targetId;
      if (!state.selectedRollId) {
        return;
      }
      if ((team !== 'party' && team !== 'enemy') || !targetId) {
        return;
      }
      handlers.onTapTarget(team, targetId);
    });
  });

  root.querySelector<HTMLElement>('.discard-target')?.addEventListener('click', () => {
    if (!state.selectedRollId) {
      return;
    }
    handlers.onDiscardDie(state.selectedRollId);
  });

  wireDiceDragAndDrop(root, {
    onDropDie: handlers.onDropDie,
    onDiscardDie: handlers.onDiscardDie,
  });
};
