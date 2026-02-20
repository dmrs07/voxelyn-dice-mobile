import type { ActiveEventState, DieSource, EventDef, RunState } from '../domain/shared/types';
import { renderRunHud } from '../render/ui/hud-renderer';

export interface EventScreenHandlers {
  onChooseChoice: (choiceId: string, characterId: string, dieSource: DieSource) => void;
  onSetTester: (characterId: string, dieSource: DieSource) => void;
  onContinue: () => void;
}

export interface EventScreenState {
  run: RunState;
  event: EventDef;
  activeEvent: ActiveEventState;
  message: string;
}

const choiceCheckText = (choice: EventDef['choices'][number]): string => {
  if (!choice.check) {
    return 'Sem teste';
  }
  if (choice.check.kind === 'face_kind') {
    const kinds = [choice.check.faceKind, ...(choice.check.anyOfKinds ?? [])].filter(Boolean);
    return `Teste: tipo ${kinds.join(' / ')}`;
  }
  return `Teste: valor minimo ${choice.check.minValue ?? 0}`;
};

export const renderEventScreen = (
  root: HTMLElement,
  state: EventScreenState,
  handlers: EventScreenHandlers,
): void => {
  const hasReporter = state.run.party.some((member) => member.backgroundId === 'reporter_radio');
  const testerOptions = state.run.party
    .filter((member) => member.alive)
    .map(
      (member) =>
        `<option value="${member.id}" ${
          state.activeEvent.selectedCharacterId === member.id ? 'selected' : ''
        }>${member.name}</option>`,
    )
    .join('');

  const choicesMarkup = state.event.choices
    .map(
      (choice) => `
      <button class="event-choice" data-choice-id="${choice.id}" ${
        state.activeEvent.resolved ? 'disabled' : ''
      }>
        <strong>${choice.text}</strong>
        <small>${choiceCheckText(choice)}</small>
      </button>
    `,
    )
    .join('');

  root.innerHTML = `
    <main class="screen event-screen">
      <header class="screen-header">
        <h1>${state.event.title}</h1>
      </header>

      ${renderRunHud(state.run)}

      <section class="event-body">
        <p>${state.event.body}</p>
      </section>

      <section class="event-choices">
        <h2>Teste de evento</h2>
        <div class="tester-form">
          <label>
            Personagem
            <select id="event-character">${testerOptions}</select>
          </label>
          <label>
            Dado
            <select id="event-die-source">
              <option value="class" ${state.activeEvent.selectedDieSource === 'class' ? 'selected' : ''}>Classe</option>
              <option value="background" ${
                state.activeEvent.selectedDieSource === 'background' ? 'selected' : ''
              }>Background</option>
            </select>
          </label>
          <small>${
            hasReporter
              ? state.activeEvent.freeRerollAvailable
                ? 'Reroll gratuito de evento disponivel.'
                : 'Reroll gratuito ja usado neste evento.'
              : 'Sem reroll gratuito neste evento.'
          }</small>
        </div>
        <h2>Escolhas</h2>
        <div class="choice-grid">${choicesMarkup}</div>
      </section>

      <section class="event-result ${state.activeEvent.resolved ? 'resolved' : ''}">
        <p>${state.activeEvent.resultMessage || 'Escolha uma acao para resolver o evento.'}</p>
      </section>

      <button id="event-continue-btn" class="primary-btn" type="button" ${
        state.activeEvent.resolved ? '' : 'disabled'
      }>Voltar ao mapa</button>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  const charSelect = root.querySelector<HTMLSelectElement>('#event-character');
  const dieSelect = root.querySelector<HTMLSelectElement>('#event-die-source');

  const syncTester = (): void => {
    const characterId = charSelect?.value;
    const dieSourceRaw = dieSelect?.value;
    if (!characterId) {
      return;
    }
    const dieSource: DieSource = dieSourceRaw === 'background' ? 'background' : 'class';
    handlers.onSetTester(characterId, dieSource);
  };

  charSelect?.addEventListener('change', syncTester);
  dieSelect?.addEventListener('change', syncTester);

  root.querySelectorAll<HTMLButtonElement>('.event-choice[data-choice-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const choiceId = button.dataset.choiceId;
      const characterId = charSelect?.value;
      const dieSource: DieSource = dieSelect?.value === 'background' ? 'background' : 'class';
      if (!choiceId || !characterId) {
        return;
      }
      handlers.onChooseChoice(choiceId, characterId, dieSource);
    });
  });

  root.querySelector<HTMLButtonElement>('#event-continue-btn')?.addEventListener('click', () => {
    handlers.onContinue();
  });
};
