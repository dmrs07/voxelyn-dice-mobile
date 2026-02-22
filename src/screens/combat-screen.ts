import type { CombatIntent, CombatState, CombatantState, RolledDie } from '../domain/shared/types';
import { resolveCombatantAvatarSrc } from '../render/pixel/asset-loader';
import { COMBATANT_INTERNAL_PX } from '../render/pixel/constants';
import type { DiceCubeDiagnostics } from '../render/voxelyn/dice-cube-runtime';
import { renderDieFaceSprite } from '../render/voxelyn/dice-renderer';
import { renderCombatDiorama } from '../render/voxelyn/diorama-renderer';
import { renderTrayFaceTooltipPopover } from '../render/ui/dice-face-tooltip';

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
}

export interface CombatScreenState {
  combat: CombatState;
  message: string;
  selectedRollId: string | null;
  openFaceTooltipRollId: string | null;
  trayTooltipPosition: TrayTooltipPosition | null;
  validTargetIds: Set<string>;
  selectedTargetId: string | null;
  biomeId: string;
  phaseBucket: 'opening' | 'mid' | 'climax';
  dieLabels: Record<string, string>;
  trayDiagnostics: DiceCubeDiagnostics;
  showDevTrayDebug: boolean;
}

interface TargetSlot {
  team: 'party' | 'enemy';
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  armor: number;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pct = (current: number, max: number): number => {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
};

const partyVisualKey = (member: CombatantState): string =>
  member.visualKey ?? `party:${member.classId ?? 'default'}`;

const faceKindTag = (kind: string): string => {
  if (kind === 'attack') return 'ATK';
  if (kind === 'block') return 'BLK';
  if (kind === 'heal') return 'HEAL';
  if (kind === 'status') return 'STS';
  if (kind === 'focus') return 'FOCO';
  if (kind === 'empty') return 'VAZIO';
  return 'SPC';
};

const collectStatusEntries = (combatant: CombatantState): Array<[string, number]> =>
  Object.entries(combatant.statuses)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([statusId, amount]) => [statusId.toUpperCase(), Number(amount)]);

const renderStatusCompact = (combatant: CombatantState, maxVisible: number): string => {
  const entries = collectStatusEntries(combatant);
  if (entries.length === 0) {
    return '<span class="status-empty">SEM STATUS</span>';
  }

  const visible = entries.slice(0, maxVisible);
  const extra = Math.max(0, entries.length - maxVisible);
  const visibleMarkup = visible
    .map(([statusId, amount]) => `<span class="status-chip">${statusId} ${amount}</span>`)
    .join('');
  const extraMarkup = extra > 0 ? `<span class="status-chip status-extra">+${extra}</span>` : '';
  return `${visibleMarkup}${extraMarkup}`;
};

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
    (state.combat.focus > 0 || state.combat.freeRerollCharges > 0) &&
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
      <div class="tray-tooltip-anchor" style="left:${Math.max(12, Math.round(state.trayTooltipPosition.x))}px;top:${Math.max(12, Math.round(state.trayTooltipPosition.y))}px;">
        ${renderTrayFaceTooltipPopover(tooltipRoll.face, { ownerName, dieLabel })}
      </div>
    `;
  })();

  const logItems = state.combat.log.slice(0, 18);
  const lastLog = logItems[0] ?? 'Sem logs.';
  const intentByEnemyId = state.combat.intents.reduce<Record<string, CombatIntent[]>>((acc, intent) => {
    if (!acc[intent.enemyId]) {
      acc[intent.enemyId] = [];
    }
    (acc[intent.enemyId] as CombatIntent[]).push(intent);
    return acc;
  }, {});

  const targetClassForId = (targetId: string): string => {
    const validityClass =
      state.validTargetIds.size > 0
        ? state.validTargetIds.has(targetId)
          ? 'is-valid-target'
          : 'is-invalid-target'
        : '';
    const selectedClass = state.selectedTargetId === targetId ? 'is-selected-target' : '';
    return `${validityClass} ${selectedClass}`.trim();
  };

  const actionTargets: TargetSlot[] = [
    ...state.combat.enemies
      .filter((entry) => entry.alive)
      .map((entry) => ({
        team: 'enemy' as const,
        id: entry.id,
        name: entry.name,
        hp: entry.hp,
        maxHp: entry.maxHp,
        armor: entry.armor,
      })),
    ...state.combat.party
      .filter((entry) => entry.alive)
      .map((entry) => ({
        team: 'party' as const,
        id: entry.id,
        name: entry.name,
        hp: entry.hp,
        maxHp: entry.maxHp,
        armor: entry.armor,
      })),
  ];

  const actionSlotsMarkup = actionTargets
    .map((target) => `
      <button
        class="action-slot drop-target ${targetClassForId(target.id)} team-${target.team}"
        data-team="${target.team}"
        data-target-id="${target.id}"
        type="button"
      >
        <strong>${escapeHtml(target.name)}</strong>
        <span>HP ${target.hp}/${target.maxHp}</span>
        <span>BLK ${target.armor}</span>
      </button>
    `)
    .join('');

  const diceByOwner = new Map<string, RolledDie[]>();
  for (const roll of state.combat.diceRolls) {
    const existing = diceByOwner.get(roll.ownerId);
    if (existing) {
      existing.push(roll);
    } else {
      diceByOwner.set(roll.ownerId, [roll]);
    }
  }

  const diceGroupMarkup = state.combat.party
    .slice(0, 4)
    .map((member, index) => {
      const ownerRolls = diceByOwner.get(member.id) ?? [];
      const avatar = resolveCombatantAvatarSrc(partyVisualKey(member));
      const diceMarkup = ownerRolls
        .map((roll) => {
          const isSelected = state.selectedRollId === roll.rollId;
          const isLocked = roll.locked;
          const isUsed = roll.used;
          const isInvalid = !isLocked && !isUsed && (state.combat.awaitingRoll || !state.trayDiagnostics.interactionReady);
          const isInteractive = !state.combat.awaitingRoll && !isLocked && !isUsed;

          return `
            <article
              class="die-card series-die-card ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''} ${isUsed ? 'used' : ''} ${isInvalid ? 'invalid' : ''}"
              data-roll-id="${roll.rollId}"
              data-die-interactive="${isInteractive ? 'true' : 'false'}"
              draggable="${isInteractive ? 'true' : 'false'}"
            >
              <button class="die-face-preview" type="button" data-roll-select="${roll.rollId}" aria-label="Selecionar dado ${escapeHtml(roll.face.label)}">
                <img src="${renderDieFaceSprite(roll.face)}" alt="${escapeHtml(roll.face.label)}" />
              </button>
              <span class="die-kind-tag">${faceKindTag(roll.face.kind)}</span>
              <span class="die-value-badge">${roll.face.value}</span>
              ${isLocked ? '<span class="die-state-badge state-lock">LOCK</span>' : ''}
              ${isUsed ? '<span class="die-state-badge state-used">USED</span>' : ''}
              ${isInvalid ? '<span class="die-state-badge state-invalid">INV</span>' : ''}
              <button class="die-face-toggle" type="button" data-face-tooltip-roll-id="${roll.rollId}" aria-label="Detalhes do dado">?</button>
            </article>
          `;
        })
        .join('');

      return `
        <section class="dice-owner-group" data-owner-id="${member.id}">
          <header class="dice-owner-head">
            <img src="${avatar}" alt="${escapeHtml(member.name)}" />
            <strong>P${index + 1}</strong>
          </header>
          <div class="dice-owner-row">
            ${diceMarkup || '<span class="dice-owner-empty">Sem dados</span>'}
          </div>
        </section>
      `;
    })
    .join('');

  const visiblePartyMembers = state.combat.party.slice(0, 4);
  const partyColumns = Math.max(1, visiblePartyMembers.length);

  const partyCardsMarkup = visiblePartyMembers
    .map((member, index) => `
      <article
        class="party-card drop-target ${member.alive ? '' : 'dead'} ${targetClassForId(member.id)}"
        data-team="party"
        data-target-id="${member.id}"
        data-status-host="true"
      >
        <div class="party-bust-frame">
          <canvas class="combatant-canvas party-bust-canvas" width="${COMBATANT_INTERNAL_PX}" height="${COMBATANT_INTERNAL_PX}" aria-hidden="true"></canvas>
        </div>
        <div class="party-meta">
          <div class="party-name-row">
            <strong>P${index + 1} ${escapeHtml(member.name)}</strong>
            <span>HP ${member.hp}/${member.maxHp}</span>
          </div>
          <span class="party-hp-track"><span class="party-hp-fill" style="width:${pct(member.hp, member.maxHp)}%"></span></span>
          <div class="party-block-row">
            <span>BLK ${member.armor}</span>
          </div>
          <div class="party-status-row">${renderStatusCompact(member, 2)}</div>
        </div>
      </article>
    `)
    .join('');

  const actionHint = state.combat.awaitingRoll
    ? 'Toque ROLL para lancar os dados.'
    : state.selectedRollId
      ? 'Arraste o dado selecionado para um slot valido.'
      : state.trayDiagnostics.interactionReady
        ? 'Toque ou arraste um dado para escolher o alvo.'
        : 'Aguarde os dados assentarem para agir.';

  root.innerHTML = `
    <main class="screen combat-screen revamp">
      <section class="combat-top-zone">
        <header class="combat-status-strip">
          <strong>Turno ${state.combat.turn}</strong>
          <span>Inimigos ${aliveEnemies}</span>
          <span>FOCO ${state.combat.focus}</span>
          ${
            state.showDevTrayDebug
              ? `<small>mode ${state.trayDiagnostics.mode} · p95 ${state.trayDiagnostics.p95FrameMs.toFixed(1)}ms · dice ${state.trayDiagnostics.diceCount}</small>`
              : ''
          }
        </header>
        <section class="combat-top-targets">
          ${renderCombatDiorama(state.combat.party, state.combat.enemies, {
            biomeId: state.biomeId,
            phaseBucket: state.phaseBucket,
            validTargetIds: state.validTargetIds,
            selectedTargetId: state.selectedTargetId,
            intentByEnemyId,
            showPartyLine: false,
          })}
        </section>
      </section>

      <section class="combat-action-strip">
        <div class="action-slot-row">
          ${actionSlotsMarkup || '<span class="action-empty">Sem alvos validos</span>'}
        </div>
        <p class="action-strip-tip">${actionHint}</p>
      </section>

      <section class="combat-dice-zone">
        <div class="dice-owner-grid">
          ${diceGroupMarkup}
        </div>
        ${tooltipMarkup}
      </section>

      <section class="combat-roll-zone">
        <div class="roll-main-row">
          <button id="reroll-btn" class="secondary-btn mini-action" type="button" ${canReroll ? '' : 'disabled'}>RE-ROLL</button>
          <button id="roll-btn" class="primary-btn roll-main-btn" type="button" ${state.combat.awaitingRoll ? '' : 'disabled'}>ROLL</button>
          <button id="end-turn-btn" class="secondary-btn mini-action" type="button" ${state.combat.awaitingRoll ? 'disabled' : ''}>END</button>
        </div>
        <div class="roll-sub-row">
          <button id="discard-btn" class="secondary-btn mini-action" type="button" ${!selectedRoll || state.combat.awaitingRoll ? 'disabled' : ''}>DISCARD</button>
          <button id="use-empty-btn" class="secondary-btn mini-action" type="button" ${selectedRoll?.face.kind === 'empty' ? '' : 'disabled'}>VAZIO</button>
          <span class="focus-chip">FOCO <strong>${state.combat.focus}</strong></span>
        </div>
      </section>

      <section class="combat-party-zone">
        <div class="party-card-row" style="--party-columns:${partyColumns};">
          ${partyCardsMarkup}
        </div>
        <p class="party-log-line">${escapeHtml(lastLog)}</p>
        <p class="status-line">${escapeHtml(state.message)}</p>
      </section>
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

  root.querySelectorAll<HTMLElement>('.series-die-card[data-roll-id]').forEach((card) => {
    const rollId = card.dataset.rollId;
    if (!rollId) {
      return;
    }

    const interactive = card.dataset.dieInteractive === 'true';
    card.draggable = interactive;

    card.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-face-tooltip-roll-id]')) {
        return;
      }
      event.stopPropagation();
      if (!interactive) {
        return;
      }
      handlers.onSelectDie(rollId);
    });

    card.addEventListener('dragstart', (event) => {
      if (!interactive) {
        event.preventDefault();
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', rollId);
        event.dataTransfer.setData('application/x-roll-id', rollId);
        event.dataTransfer.effectAllowed = 'move';
      }
      card.classList.add('dragging');
      handlers.onSelectDie(rollId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      root.querySelectorAll<HTMLElement>('.drop-target.drop-active').forEach((entry) => {
        entry.classList.remove('drop-active');
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-face-tooltip-roll-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const rollId = button.dataset.faceTooltipRollId;
      if (!rollId) {
        return;
      }

      if (state.openFaceTooltipRollId === rollId) {
        handlers.onToggleFaceTooltip(null);
        return;
      }

      const card = button.closest<HTMLElement>('.series-die-card');
      const zone = root.querySelector<HTMLElement>('.combat-dice-zone');
      if (!card || !zone) {
        handlers.onToggleFaceTooltip(rollId);
        return;
      }

      const zoneRect = zone.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      handlers.onToggleFaceTooltip(rollId, {
        x: Math.round(cardRect.left - zoneRect.left + cardRect.width / 2),
        y: Math.round(cardRect.top - zoneRect.top),
      });
    });
  });

  root.querySelectorAll<HTMLElement>('.drop-target[data-team][data-target-id]').forEach((target) => {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      target.classList.add('drop-active');
    });

    target.addEventListener('dragleave', () => {
      target.classList.remove('drop-active');
    });

    target.addEventListener('drop', (event) => {
      event.preventDefault();
      target.classList.remove('drop-active');
      const rollId = event.dataTransfer?.getData('application/x-roll-id')
        || event.dataTransfer?.getData('text/plain');
      if (!rollId) {
        return;
      }

      const team = target.dataset.team;
      const targetId = target.dataset.targetId;
      if ((team !== 'party' && team !== 'enemy') || !targetId) {
        return;
      }

      handlers.onSelectDie(rollId);
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

    combatRoot.addEventListener('dice-tray:tooltip-clear', () => {
      handlers.onToggleFaceTooltip(null);
    });

    combatRoot.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.combat-dice-zone') ||
        target.closest('.combat-roll-zone') ||
        target.closest('.combat-action-strip') ||
        target.closest('.combat-party-zone') ||
        target.closest('.drop-target') ||
        target.closest('.tray-tooltip')
      ) {
        return;
      }
      handlers.onClearSelection();
    });
  }
};
