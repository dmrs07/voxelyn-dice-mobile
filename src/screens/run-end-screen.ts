import type { ProfileState, RunState } from '../domain/shared/types';

export interface RunEndHandlers {
  onReturnMeta: () => void;
}

export interface RunEndState {
  run: RunState;
  profile: ProfileState;
  message: string;
}

export const renderRunEndScreen = (
  root: HTMLElement,
  state: RunEndState,
  handlers: RunEndHandlers,
): void => {
  const logMarkup = state.run.runLog
    .slice(0, 12)
    .map((entry) => `<li>${entry}</li>`)
    .join('');

  root.innerHTML = `
    <main class="screen run-end-screen">
      <header class="title-block">
        <h1>${state.run.victory ? 'Expedicao concluida' : 'Expedicao encerrada'}</h1>
        <p class="subtitle">${state.run.victory ? 'A trip voltou com gloria.' : 'A trip falhou desta vez.'}</p>
      </header>

      <section class="meta-stats">
        <div><span>Runs totais</span><strong>${state.profile.runsPlayed}</strong></div>
        <div><span>Vitorias</span><strong>${state.profile.runsWon}</strong></div>
        <div><span>Reliquias na run</span><strong>${state.run.relicIds.length}</strong></div>
        <div><span>Nos visitados</span><strong>${state.run.nodeIndex}</strong></div>
        <div><span>Ouro final</span><strong>${state.run.gold}</strong></div>
      </section>

      <section class="run-log">
        <h2>Resumo</h2>
        <ul>${logMarkup || '<li>Sem registros.</li>'}</ul>
      </section>

      <button id="return-meta-btn" class="primary-btn" type="button">Voltar ao meta</button>
      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#return-meta-btn')?.addEventListener('click', () => {
    handlers.onReturnMeta();
  });
};
