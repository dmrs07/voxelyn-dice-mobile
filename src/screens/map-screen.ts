import { renderMapDiorama } from '../render/voxelyn/diorama-renderer';
import { renderRunHud } from '../render/ui/hud-renderer';
import type { GameContent, RunState } from '../domain/shared/types';

export interface MapScreenHandlers {
  onChooseNode: (nodeId: string) => void;
  onAbandonRun: () => void;
}

export interface MapScreenState {
  run: RunState;
  content: GameContent;
  message: string;
}

export const renderMapScreen = (
  root: HTMLElement,
  state: MapScreenState,
  handlers: MapScreenHandlers,
): void => {
  const optionsMarkup = state.run.availableNodeIds
    .map((nodeId) => {
      const node = state.run.map.nodes[nodeId];
      if (!node) {
        return '';
      }

      return `
        <button class="node-card" data-node-id="${node.id}">
          <span class="node-type">${node.type.toUpperCase()}</span>
          <strong>${node.title}</strong>
          <small>${node.subtitle}</small>
        </button>
      `;
    })
    .join('');

  const pathMarkup = state.run.map.orderedNodeIds
    .map((id) => {
      const node = state.run.map.nodes[id];
      const isCurrent = id === state.run.currentNodeId;
      const label = node.visited || node.revealed ? node.type : '?';
      return `<li class="path-node ${node.visited ? 'visited' : ''} ${isCurrent ? 'current' : ''}">${label}</li>`;
    })
    .join('');

  const logMarkup = state.run.runLog
    .slice(0, 8)
    .map((entry) => `<li>${entry}</li>`)
    .join('');

  root.innerHTML = `
    <main class="screen map-screen">
      <header class="screen-header">
        <h1>Expedicao · ${state.content.biome.name}</h1>
        <button id="abandon-run-btn" class="secondary-btn" type="button">Encerrar run</button>
      </header>

      ${renderRunHud(state.run)}
      ${renderMapDiorama(state.run, state.content)}

      <section class="node-options">
        <h2>Proximos nos</h2>
        <div class="node-grid">${optionsMarkup || '<p>Sem caminhos disponiveis.</p>'}</div>
      </section>

      <section class="path-track">
        <h3>Trilha</h3>
        <ol>${pathMarkup}</ol>
      </section>

      <section class="run-log">
        <h3>Diario</h3>
        <ul>${logMarkup || '<li>Sem registros ainda.</li>'}</ul>
      </section>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#abandon-run-btn')?.addEventListener('click', () => {
    handlers.onAbandonRun();
  });

  root.querySelectorAll<HTMLButtonElement>('.node-card[data-node-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const nodeId = button.dataset.nodeId;
      if (!nodeId) {
        return;
      }
      handlers.onChooseNode(nodeId);
    });
  });
};
