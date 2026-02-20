import type { GameContent, PartySelectionItem, ProfileState } from '../domain/shared/types';

export interface MetaScreenHandlers {
  onStartRun: (seed: number, party: PartySelectionItem[]) => void;
  onDraftPartyChange: (party: PartySelectionItem[]) => void;
  onResetProfile: () => void;
}

export interface MetaScreenState {
  content: GameContent;
  profile: ProfileState;
  draftParty: PartySelectionItem[];
  seed: number;
  message: string;
}

const optionMarkup = (id: string, label: string, selected: boolean): string =>
  `<option value="${id}" ${selected ? 'selected' : ''}>${label}</option>`;

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

  const draftRows = state.draftParty
    .map((slot, index) => {
      const classOptions = unlockedClasses
        .map((entry) => optionMarkup(entry.id, `${entry.name} (${entry.verb})`, entry.id === slot.classId))
        .join('');
      const bgOptions = unlockedBackgrounds
        .map((entry) => optionMarkup(entry.id, `${entry.name} (${entry.perk})`, entry.id === slot.backgroundId))
        .join('');
      return `
        <article class="draft-card">
          <header>Integrante ${index + 1}</header>
          <label>
            Classe
            <select name="class_${index}">${classOptions}</select>
          </label>
          <label>
            Background
            <select name="background_${index}">${bgOptions}</select>
          </label>
          <label>
            Linha
            <select name="row_${index}">
              <option value="front" ${slot.row === 'front' ? 'selected' : ''}>Frente</option>
              <option value="back" ${slot.row === 'back' ? 'selected' : ''}>Tras</option>
            </select>
          </label>
        </article>
      `;
    })
    .join('');

  root.innerHTML = `
    <main class="screen meta-screen">
      <header class="title-block">
        <h1>Voxelyn Dice Expedition</h1>
        <p class="subtitle">Roguelite pulp em voxel, com combate por dados e expedicao tensa.</p>
      </header>

      <section class="meta-stats">
        <div><span>Runs</span><strong>${state.profile.runsPlayed}</strong></div>
        <div><span>Vitorias</span><strong>${state.profile.runsWon}</strong></div>
        <div><span>Eventos vistos</span><strong>${state.profile.compendium.eventsSeen.length}</strong></div>
        <div><span>Reliquias vistas</span><strong>${state.profile.compendium.relicsSeen.length}</strong></div>
      </section>

      <section class="unlock-list">
        <h2>Desbloqueios</h2>
        <p>Classes: ${state.profile.unlocks.classes.join(', ')}</p>
        <p>Backgrounds: ${state.profile.unlocks.backgrounds.join(', ')}</p>
      </section>

      <form id="meta-form" class="meta-form">
        <label>
          Seed da run
          <input type="number" name="seed" value="${state.seed}" min="1" max="2147483647" />
        </label>
        <div class="draft-grid">${draftRows}</div>
        <button type="submit" class="primary-btn">Iniciar expedicao</button>
      </form>

      <div class="meta-actions">
        <button id="add-member-btn" class="secondary-btn" type="button" ${
          state.draftParty.length >= 4 ? 'disabled' : ''
        }>Adicionar integrante</button>
        <button id="remove-member-btn" class="secondary-btn" type="button" ${
          state.draftParty.length <= 1 ? 'disabled' : ''
        }>Remover integrante</button>
        <button id="reset-profile-btn" class="secondary-btn danger" type="button">Resetar perfil</button>
      </div>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  const form = root.querySelector<HTMLFormElement>('#meta-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);

    const nextParty: PartySelectionItem[] = state.draftParty.map((_, index) => ({
      classId: String(formData.get(`class_${index}`) ?? ''),
      backgroundId: String(formData.get(`background_${index}`) ?? ''),
      row: formData.get(`row_${index}`) === 'back' ? 'back' : 'front',
    }));

    const rawSeed = Number(formData.get('seed'));
    const parsedSeed = Number.isFinite(rawSeed) && rawSeed > 0 ? Math.floor(rawSeed) : state.seed;

    handlers.onStartRun(parsedSeed, nextParty);
  });

  root.querySelector<HTMLButtonElement>('#reset-profile-btn')?.addEventListener('click', () => {
    handlers.onResetProfile();
  });

  root.querySelector<HTMLButtonElement>('#add-member-btn')?.addEventListener('click', () => {
    if (state.draftParty.length >= 4) {
      return;
    }
    const defaultClass = unlockedClasses[0]?.id;
    const defaultBg = unlockedBackgrounds[0]?.id;
    if (!defaultClass || !defaultBg) {
      return;
    }
    const nextDraft: PartySelectionItem[] = [
      ...state.draftParty,
      { classId: defaultClass, backgroundId: defaultBg, row: state.draftParty.length % 2 === 0 ? 'front' : 'back' },
    ];
    handlers.onDraftPartyChange(nextDraft);
  });

  root.querySelector<HTMLButtonElement>('#remove-member-btn')?.addEventListener('click', () => {
    if (state.draftParty.length <= 1) {
      return;
    }
    const nextDraft = state.draftParty.slice(0, -1);
    handlers.onDraftPartyChange(nextDraft);
  });
};
