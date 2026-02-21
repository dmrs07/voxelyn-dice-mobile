import { materializeAllDieFaces } from '../domain/shared/dice-face-utils';
import type { GameContent, PartySelectionItem, ProfileState } from '../domain/shared/types';
import { resolveCombatantAvatarSrc } from '../render/pixel/asset-loader';
import { renderFaceTooltipPopover } from '../render/ui/dice-face-tooltip';
import { renderDieFaceMiniSprite } from '../render/voxelyn/dice-renderer';

export interface MetaScreenHandlers {
  onStartRun: (seed: number) => void;
  onSetSeed: (seed: number) => void;
  onDraftPartyChange: (party: PartySelectionItem[]) => void;
  onSelectSlot: (slotIndex: number) => void;
  onToggleFaceTooltip: (faceKey: string | null) => void;
  onResetProfile: () => void;
}

export interface MetaScreenState {
  content: GameContent;
  profile: ProfileState;
  draftParty: PartySelectionItem[];
  selectedSlotIndex: number;
  openFaceTooltipKey: string | null;
  seed: number;
  hiringBudget: number;
  hiringSpent: number;
  hiringRemaining: number;
  message: string;
}

const safeNumber = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

export const renderMetaScreen = (
  root: HTMLElement,
  state: MetaScreenState,
  handlers: MetaScreenHandlers,
): void => {
  const unlockedClasses = state.content.classes.filter((entry) =>
    state.profile.unlocks.classes.includes(entry.id),
  );
  const unlockedBackgrounds = state.content.backgrounds.filter((entry) =>
    state.profile.unlocks.backgrounds.includes(entry.id),
  );

  const clampedSelected = Math.max(0, Math.min(state.selectedSlotIndex, state.draftParty.length - 1));
  const selectedSlot = state.draftParty[clampedSelected];

  const usedClasses = new Set(
    state.draftParty
      .map((entry, index) => (index === clampedSelected ? null : entry.classId))
      .filter((entry): entry is string => Boolean(entry)),
  );

  const rosterMarkup = state.draftParty
    .map((slot, index) => {
      const classDef = state.content.byId.classes[slot.classId];
      const bgDef = state.content.byId.backgrounds[slot.backgroundId];
      const avatar = resolveCombatantAvatarSrc(`party:${slot.classId}`);
      const isCaptain = index === 0;
      const cost = classDef?.hireCost ?? 0;
      return `
        <article class="roster-slot ${index === clampedSelected ? 'selected' : ''}" data-select-slot="${index}">
          <img class="roster-avatar" src="${avatar}" alt="${classDef?.name ?? 'Classe'}" />
          <div class="roster-meta">
            <strong>${classDef?.name ?? slot.classId}${isCaptain ? ' · CAPITAO' : ''}</strong>
            <small>${bgDef?.name ?? slot.backgroundId} · ${slot.row === 'front' ? 'Frente' : 'Tras'}</small>
            <small>${isCaptain ? 'Custo: gratis' : `Custo: ${cost} ouro`}</small>
          </div>
          <div class="roster-actions">
            <button type="button" class="secondary-btn mini" data-select-slot="${index}">Editar</button>
            <button type="button" class="secondary-btn mini danger" data-remove-slot="${index}" ${
              state.draftParty.length <= 1 ? 'disabled' : ''
            }>Remover</button>
          </div>
        </article>
      `;
    })
    .join('');

  const classCardsMarkup = unlockedClasses
    .map((entry) => {
      const avatar = resolveCombatantAvatarSrc(`party:${entry.id}`);
      const isUsed = usedClasses.has(entry.id);
      const isSelected = selectedSlot?.classId === entry.id;
      const cost = entry.hireCost ?? 0;
      return `
        <button type="button" class="class-pick-card ${isSelected ? 'selected' : ''}" data-pick-class="${entry.id}" ${
          isUsed && !isSelected ? 'disabled' : ''
        }>
          <img class="class-avatar" src="${avatar}" alt="${entry.name}" />
          <strong>${entry.name}</strong>
          <small>${entry.verb}</small>
          <small>${clampedSelected === 0 ? 'Gratis (capitao)' : `Custo ${cost} ouro`}</small>
        </button>
      `;
    })
    .join('');

  const bgOptions = unlockedBackgrounds
    .map(
      (entry) =>
        `<option value="${entry.id}" ${
          selectedSlot?.backgroundId === entry.id ? 'selected' : ''
        }>${entry.name} (${entry.perk})</option>`,
    )
    .join('');

  const selectedClassDef = selectedSlot ? state.content.byId.classes[selectedSlot.classId] : undefined;
  const selectedBgDef = selectedSlot ? state.content.byId.backgrounds[selectedSlot.backgroundId] : undefined;
  const classDie = selectedClassDef?.starterDiceIds[0]
    ? state.content.byId.dice[selectedClassDef.starterDiceIds[0]]
    : undefined;
  const bgDie = selectedBgDef ? state.content.byId.dice[selectedBgDef.starterDieId] : undefined;

  const classFaces = classDie ? materializeAllDieFaces(classDie) : [];
  const bgFaces = bgDie ? materializeAllDieFaces(bgDie) : [];

  const classFaceMarkup = classFaces
    .map((face, index) => {
      const key = `class_${index}`;
      return `
        <button type="button" class="face-preview-card ${face.kind === 'empty' ? 'empty' : 'filled'}" data-face-key="${key}">
          <img src="${renderDieFaceMiniSprite(face)}" alt="${face.label}" />
          <small>${face.label}</small>
          ${state.openFaceTooltipKey === key ? renderFaceTooltipPopover(face) : ''}
        </button>
      `;
    })
    .join('');

  const bgFaceMarkup = bgFaces
    .map((face, index) => {
      const key = `bg_${index}`;
      return `
        <button type="button" class="face-preview-card ${face.kind === 'empty' ? 'empty' : 'filled'}" data-face-key="${key}">
          <img src="${renderDieFaceMiniSprite(face)}" alt="${face.label}" />
          <small>${face.label}</small>
          ${state.openFaceTooltipKey === key ? renderFaceTooltipPopover(face) : ''}
        </button>
      `;
    })
    .join('');

  root.innerHTML = `
    <main class="screen meta-screen">
      <header class="title-block">
        <h1>Voxelyn Dice Expedition</h1>
        <p class="subtitle">Monte sua trip, contrate membros e visualize cada face antes da run.</p>
      </header>

      <section class="meta-stats">
        <div><span>Runs</span><strong>${state.profile.runsPlayed}</strong></div>
        <div><span>Vitorias</span><strong>${state.profile.runsWon}</strong></div>
        <div><span>Eventos vistos</span><strong>${state.profile.compendium.eventsSeen.length}</strong></div>
        <div><span>Reliquias vistas</span><strong>${state.profile.compendium.relicsSeen.length}</strong></div>
      </section>

      <section class="hiring-summary">
        <h2>Hiring</h2>
        <p>Orcamento: <strong>${state.hiringBudget}</strong> ouro</p>
        <p>Gasto: <strong>${state.hiringSpent}</strong> ouro</p>
        <p>Restante inicial da run: <strong>${state.hiringRemaining}</strong> ouro</p>
      </section>

      <section class="roster-grid">
        <h2>Roster da expedicao</h2>
        <div class="roster-list">${rosterMarkup}</div>
        <button type="button" class="secondary-btn" id="add-slot-btn" ${
          state.draftParty.length >= 4 ? 'disabled' : ''
        }>Adicionar integrante</button>
      </section>

      <section class="class-pick-grid">
        <h2>Classe (sem repeticao)</h2>
        <div class="class-pick-list">${classCardsMarkup}</div>
      </section>

      <section class="slot-config">
        <h2>Configuracao do integrante</h2>
        ${
          selectedSlot
            ? `
              <label>
                Background
                <select id="slot-background">${bgOptions}</select>
              </label>
              <label>
                Linha
                <select id="slot-row">
                  <option value="front" ${selectedSlot.row === 'front' ? 'selected' : ''}>Frente</option>
                  <option value="back" ${selectedSlot.row === 'back' ? 'selected' : ''}>Tras</option>
                </select>
              </label>
            `
            : '<p>Nenhum integrante selecionado.</p>'
        }
      </section>

      <section class="face-preview-grid">
        <h2>Preview de faces</h2>
        <h3>Dado de classe</h3>
        <div class="face-preview-list">${classFaceMarkup || '<p>Sem dado de classe.</p>'}</div>
        <h3>Dado de background</h3>
        <div class="face-preview-list">${bgFaceMarkup || '<p>Sem dado de background.</p>'}</div>
      </section>

      <section class="meta-form">
        <label>
          Seed da run
          <input id="meta-seed-input" type="number" value="${safeNumber(state.seed)}" min="1" max="2147483647" />
        </label>
        <button type="button" class="primary-btn" id="start-run-btn">Iniciar expedicao</button>
      </section>

      <div class="meta-actions">
        <button id="reset-profile-btn" class="secondary-btn danger" type="button">Resetar perfil</button>
      </div>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  const addSlotBtn = root.querySelector<HTMLButtonElement>('#add-slot-btn');
  addSlotBtn?.addEventListener('click', () => {
    if (state.draftParty.length >= 4) {
      return;
    }
    const defaultClass = unlockedClasses.find((entry) =>
      !state.draftParty.some((slot) => slot.classId === entry.id),
    ) ?? unlockedClasses[0];
    const defaultBg = unlockedBackgrounds[0];
    if (!defaultClass || !defaultBg) {
      return;
    }
    handlers.onDraftPartyChange([
      ...state.draftParty,
      { classId: defaultClass.id, backgroundId: defaultBg.id, row: state.draftParty.length % 2 === 0 ? 'front' : 'back' },
    ]);
    handlers.onSelectSlot(state.draftParty.length);
  });

  root.querySelectorAll<HTMLElement>('[data-select-slot]').forEach((el) => {
    el.addEventListener('click', () => {
      const raw = el.dataset.selectSlot;
      const index = raw ? Number(raw) : NaN;
      if (!Number.isFinite(index)) {
        return;
      }
      handlers.onSelectSlot(index);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-remove-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      const raw = button.dataset.removeSlot;
      const index = raw ? Number(raw) : NaN;
      if (!Number.isFinite(index) || state.draftParty.length <= 1) {
        return;
      }
      const next = state.draftParty.filter((_, slotIndex) => slotIndex !== index);
      handlers.onDraftPartyChange(next);
      handlers.onSelectSlot(Math.max(0, Math.min(next.length - 1, clampedSelected)));
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-pick-class]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!selectedSlot) {
        return;
      }
      const classId = button.dataset.pickClass;
      if (!classId) {
        return;
      }
      const next = state.draftParty.map((slot, index) =>
        index === clampedSelected ? { ...slot, classId } : slot,
      );
      handlers.onDraftPartyChange(next);
    });
  });

  root.querySelector<HTMLSelectElement>('#slot-background')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    if (!selectedSlot) {
      return;
    }
    const next = state.draftParty.map((slot, index) =>
      index === clampedSelected ? { ...slot, backgroundId: target.value } : slot,
    );
    handlers.onDraftPartyChange(next);
  });

  root.querySelector<HTMLSelectElement>('#slot-row')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    if (!selectedSlot) {
      return;
    }
    const row: PartySelectionItem['row'] = target.value === 'back' ? 'back' : 'front';
    const next = state.draftParty.map((slot, index) =>
      index === clampedSelected ? { ...slot, row } : slot,
    );
    handlers.onDraftPartyChange(next);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-face-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.faceKey;
      if (!key) {
        return;
      }
      handlers.onToggleFaceTooltip(state.openFaceTooltipKey === key ? null : key);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-close-face-tooltip]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.onToggleFaceTooltip(null);
    });
  });

  root.querySelector<HTMLElement>('main.meta-screen')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-face-key]') || target.closest('.face-tooltip-popover')) {
      return;
    }
    if (state.openFaceTooltipKey) {
      handlers.onToggleFaceTooltip(null);
    }
  });

  root.querySelector<HTMLInputElement>('#meta-seed-input')?.addEventListener('change', (event) => {
    const raw = Number((event.currentTarget as HTMLInputElement).value);
    handlers.onSetSeed(safeNumber(raw));
  });

  root.querySelector<HTMLButtonElement>('#start-run-btn')?.addEventListener('click', () => {
    handlers.onStartRun(safeNumber(state.seed));
  });

  root.querySelector<HTMLButtonElement>('#reset-profile-btn')?.addEventListener('click', () => {
    handlers.onResetProfile();
  });
};
