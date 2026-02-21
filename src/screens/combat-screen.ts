import type { CombatState } from '../domain/shared/types';
import type { DiceCubeDiagnostics } from '../render/voxelyn/dice-cube-runtime';
import { renderCombatDiorama } from '../render/voxelyn/diorama-renderer';
import { renderTrayFaceTooltipPopover } from '../render/ui/dice-face-tooltip';
import { renderEnemyIntentHud } from '../render/ui/hud-renderer';

interface TrayTooltipPosition {
  x: number;
  y: number;
}

interface DiceTraySelectEventDetail {
  rollId: string;
}

interface DiceTrayTooltipEventDetail {
  rollId: string;
  x: number;
  y: number;
  interaction: 'hover' | 'tap';
}

export interface CombatScreenHandlers {
  onSelectDie: (rollId: string | null) => void;
  onClearSelection: () => void;
  onTapTarget: (targetTeam: 'party' | 'enemy', targetId: string) => void;
  onDiscardSelectedDie: () => void;
  onUseEmptySelectedDie: () => void;
  onReroll: () => void;
  onRoll: () => void;
  onEndTurn: () => void;
  onToggleFaceTooltip: (rollId: string | null, position?: TrayTooltipPosition | null) => void;
  onToggleCombatLog: () => void;
}

export interface CombatScreenState {
  combat: CombatState;
  message: string;
  selectedRollId: string | null;
  openFaceTooltipRollId: string | null;
  trayTooltipPosition: TrayTooltipPosition | null;
  combatLogCollapsed: boolean;
  validTargetIds: Set<string>;
  selectedTargetId: string | null;
  biomeId: string;
  phaseBucket: 'opening' | 'mid' | 'climax';
  dieLabels: Record<string, string>;
  trayDiagnostics: DiceCubeDiagnostics;
  showDevTrayDebug: boolean;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderDiagnostics = (diagnostics: DiceCubeDiagnostics): string => `
  <aside class="dice-tray-debug" aria-label="Diagnostico do Dice Tray">
    <span>mode ${diagnostics.mode}</span>
    <span>fps~ ${Math.max(0, Math.round(1000 / Math.max(1, diagnostics.p95FrameMs || 1)))}</span>
    <span>p95 ${diagnostics.p95FrameMs.toFixed(1)}ms</span>
    <span>sim ${diagnostics.simMs.toFixed(1)}ms</span>
    <span>render ${diagnostics.renderMs.toFixed(1)}ms</span>
    <span>dice ${diagnostics.diceCount}</span>
    <span>seed ${diagnostics.seed ?? 0}</span>
  </aside>
`;

export const renderCombatScreen = (
  root: HTMLElement,
  state: CombatScreenState,
  handlers: CombatScreenHandlers,
): void => {
  const aliveEnemies = state.combat.enemies.filter((entry) => entry.alive).length;
  const selectedRoll = state.selectedRollId
    ? state.combat.diceRolls.find((roll) => roll.rollId === state.selectedRollId)
    : null;
  const selectedRollIsValid = Boolean(selectedRoll && !selectedRoll.used && !selectedRoll.locked);
  const canReroll =
    !state.combat.awaitingRoll &&
    state.combat.focus > 0 &&
    selectedRollIsValid &&
    state.trayDiagnostics.interactionReady;
  const tooltipRoll = state.openFaceTooltipRollId
    ? state.combat.diceRolls.find((roll) => roll.rollId === state.openFaceTooltipRollId)
    : null;

  const tooltipMarkup = (() => {
    if (!tooltipRoll || !state.trayTooltipPosition) {
      return '';
    }
    const ownerName =
      state.combat.party.find((entry) => entry.id === tooltipRoll.ownerId)?.name ?? 'Trip';
    const dieLabel = state.dieLabels[tooltipRoll.dieId] ?? tooltipRoll.dieId;

    return `
      <div class="tray-tooltip-anchor" style="left:${Math.max(16, Math.round(state.trayTooltipPosition.x))}px;top:${Math.max(16, Math.round(state.trayTooltipPosition.y))}px;">
        ${renderTrayFaceTooltipPopover(tooltipRoll.face, { ownerName, dieLabel })}
      </div>
    `;
  })();

  const logItems = state.combat.log.slice(0, 18);
  const lastLog = logItems[0] ?? 'Sem logs.';

  root.innerHTML = `
    <main class="screen combat-screen revamp ${state.combatLogCollapsed ? 'log-collapsed' : 'log-expanded'}">
      <header class="combat-status-strip">
        <strong>Turno ${state.combat.turn}</strong>
        <span>Inimigos ${aliveEnemies}</span>
        <span>Modo ${state.trayDiagnostics.mode}</span>
      </header>

      <section class="combat-roll-core">
        <div class="dice-tray-stage ${state.combat.awaitingRoll ? 'awaiting-roll' : ''}" data-dice-tray-stage="true">
          <canvas class="dice-tray-canvas" data-dice-tray-canvas width="640" height="280" aria-label="Bandeja 3D dos dados"></canvas>
          ${state.showDevTrayDebug ? renderDiagnostics(state.trayDiagnostics) : ''}
          ${tooltipMarkup}
        </div>
        <p class="dice-tray-hint">${state.combat.awaitingRoll ? 'Toque ROLL para lançar os dados.' : state.trayDiagnostics.interactionReady ? 'Toque um dado no tray e depois um alvo no campo.' : 'Aguarde os dados assentarem para jogar.'}</p>
      </section>

      <section class="combat-battlefield-core">
        ${renderEnemyIntentHud(state.combat)}
        <section class="combat-top-targets">
          ${renderCombatDiorama(state.combat.party, state.combat.enemies, {
            biomeId: state.biomeId,
            phaseBucket: state.phaseBucket,
            validTargetIds: state.validTargetIds,
            selectedTargetId: state.selectedTargetId,
          })}
        </section>
      </section>

      <section class="combat-bottom-zone">
        <div class="combat-action-bar">
          <button id="roll-btn" class="primary-btn" type="button" ${state.combat.awaitingRoll ? '' : 'disabled'}>ROLL</button>
          <button id="reroll-btn" class="secondary-btn" type="button" ${canReroll ? '' : 'disabled'}>RE-ROLL</button>
          <button id="discard-btn" class="secondary-btn" type="button" ${!selectedRoll || state.combat.awaitingRoll ? 'disabled' : ''}>DISCARD</button>
          <button id="end-turn-btn" class="secondary-btn" type="button" ${state.combat.awaitingRoll ? 'disabled' : ''}>END TURN</button>
          <button id="use-empty-btn" class="secondary-btn" type="button" ${selectedRoll?.face.kind === 'empty' ? '' : 'disabled'}>USAR VAZIO</button>
        </div>

        <section class="combat-log">
          <div class="combat-log-head">
            <h3>Log de combate</h3>
            <button id="toggle-combat-log-btn" class="secondary-btn mini" type="button">${state.combatLogCollapsed ? 'Expandir' : 'Colapsar'}</button>
          </div>
          ${
            state.combatLogCollapsed
              ? `<p class="combat-log-last">${escapeHtml(lastLog)}</p>`
              : `<div class="combat-log-scroll"><ul>${logItems.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('') || '<li>Sem logs.</li>'}</ul></div>`
          }
        </section>
      </section>

      <p class="status-line">${escapeHtml(state.message)}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#roll-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onRoll();
  });

  root.querySelector<HTMLButtonElement>('#reroll-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onReroll();
  });

  root.querySelector<HTMLButtonElement>('#discard-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onDiscardSelectedDie();
  });

  root.querySelector<HTMLButtonElement>('#end-turn-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onEndTurn();
  });

  root.querySelector<HTMLButtonElement>('#use-empty-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onUseEmptySelectedDie();
  });

  root.querySelector<HTMLButtonElement>('#toggle-combat-log-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onToggleCombatLog();
  });

  root.querySelectorAll<HTMLElement>('.drop-target[data-team][data-target-id]').forEach((target) => {
    target.addEventListener('click', (event) => {
      event.stopPropagation();
      const team = target.dataset.team;
      const targetId = target.dataset.targetId;
      if ((team !== 'party' && team !== 'enemy') || !targetId) {
        return;
      }
      handlers.onTapTarget(team, targetId);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-close-face-tooltip]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onToggleFaceTooltip(null);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-toggle-face-tooltip-details]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const panel = button.closest('.tray-tooltip')?.querySelector<HTMLElement>('[data-face-tooltip-details]');
      if (!panel) {
        return;
      }
      const hidden = panel.classList.toggle('is-hidden');
      button.setAttribute('aria-expanded', String(!hidden));
      button.textContent = hidden ? 'Detalhes' : 'Ocultar';
    });
  });

  const combatRoot = root.querySelector<HTMLElement>('main.combat-screen');
  if (combatRoot) {
    combatRoot.addEventListener('dice-tray:select', (event) => {
      const detail = (event as CustomEvent<DiceTraySelectEventDetail>).detail;
      if (!detail?.rollId) {
        return;
      }
      handlers.onSelectDie(detail.rollId);
    });

    combatRoot.addEventListener('dice-tray:tooltip', (event) => {
      const detail = (event as CustomEvent<DiceTrayTooltipEventDetail>).detail;
      if (!detail?.rollId) {
        return;
      }
      handlers.onToggleFaceTooltip(detail.rollId, {
        x: detail.x,
        y: detail.y,
      });
    });

    combatRoot.addEventListener('dice-tray:clear', () => {
      handlers.onClearSelection();
    });

    combatRoot.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.dice-tray-stage') ||
        target.closest('.combat-action-bar') ||
        target.closest('.drop-target') ||
        target.closest('.tray-tooltip')
      ) {
        return;
      }
      handlers.onClearSelection();
    });
  }
};
