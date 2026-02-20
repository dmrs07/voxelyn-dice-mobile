export interface DragDropBindings {
  onDropDie: (rollId: string, targetTeam: 'party' | 'enemy', targetId: string) => void;
  onDiscardDie: (rollId: string) => void;
}

export const wireDiceDragAndDrop = (root: HTMLElement, bindings: DragDropBindings): void => {
  const dieCards = root.querySelectorAll<HTMLElement>('.die-card[data-roll-id]');
  for (const card of dieCards) {
    card.draggable = true;

    card.addEventListener('dragstart', (event) => {
      const rollId = card.dataset.rollId;
      if (!rollId) {
        return;
      }
      event.dataTransfer?.setData('text/plain', rollId);
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  }

  const slotTargets = root.querySelectorAll<HTMLElement>('.drop-target[data-team][data-target-id]');
  for (const target of slotTargets) {
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
      const rollId = event.dataTransfer?.getData('text/plain');
      if (!rollId) {
        return;
      }
      const teamRaw = target.dataset.team;
      const targetId = target.dataset.targetId;
      if (!targetId || (teamRaw !== 'party' && teamRaw !== 'enemy')) {
        return;
      }
      bindings.onDropDie(rollId, teamRaw, targetId);
    });
  }

  const discardTargets = root.querySelectorAll<HTMLElement>('.discard-target');
  for (const target of discardTargets) {
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
      const rollId = event.dataTransfer?.getData('text/plain');
      if (!rollId) {
        return;
      }
      bindings.onDiscardDie(rollId);
    });
  }
};
