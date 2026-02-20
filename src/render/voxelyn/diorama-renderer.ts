import type { CombatantState, GameContent, RunState } from '../../domain/shared/types';
import { getMiniatureSprite } from './sprite-cache';

const classColor: Record<string, string> = {
  aviadora: '#5f7fa0',
  ocultista: '#9d6f94',
  cacador: '#7a9e58',
  mecanico: '#a57943',
};

const enemyColor = (enemy: CombatantState): string => {
  if (enemy.tags.includes('beast')) {
    return '#8f6f4f';
  }
  if (enemy.tags.includes('cult')) {
    return '#7b4f6e';
  }
  if (enemy.tags.includes('machine')) {
    return '#6b7686';
  }
  return '#8f4a4a';
};

const memberSprite = (key: string, color: string): string => getMiniatureSprite(key, color);

const partyVisualKey = (member: CombatantState): string =>
  member.visualKey ?? `party:${member.classId ?? 'default'}`;

const enemyVisualKey = (enemy: CombatantState): string => {
  if (enemy.visualKey) {
    return enemy.visualKey;
  }
  if (enemy.tags.includes('machine')) {
    return 'enemy:machine';
  }
  if (enemy.tags.includes('cult')) {
    return 'enemy:cult';
  }
  if (enemy.tags.includes('beast')) {
    return 'enemy:beast';
  }
  return 'enemy:default';
};

export const renderMapDiorama = (run: RunState, content: GameContent): string => {
  const partyMarkup = run.party
    .map((member) => {
      const color = classColor[member.classId] ?? '#7f7f7f';
      const sprite = memberSprite(`map:${member.id}`, color);
      return `<img class="miniature party" src="${sprite}" alt="${member.name}" />`;
    })
    .join('');

  return `
    <section class="diorama map-diorama" aria-label="Diorama de exploracao">
      <div class="mist-layer"></div>
      <div class="miniature-row">${partyMarkup}</div>
      <p class="diorama-caption">${content.biome.name} · Ameaca ${run.threat}</p>
    </section>
  `;
};

export const renderCombatDiorama = (
  party: CombatantState[],
  enemies: CombatantState[],
): string => {
  const partyMarkup = party
    .map((member) => {
      return `
        <div class="slot fx-target drop-target ${member.alive ? '' : 'dead'}" data-team="party" data-target-id="${member.id}" data-row="${member.row}" data-visual-key="${partyVisualKey(member)}">
          <canvas class="miniature combatant-canvas" width="32" height="32" aria-hidden="true"></canvas>
          <span class="slot-name">${member.name}</span>
          <span class="slot-hp">HP ${member.hp}/${member.maxHp} · AR ${member.armor}</span>
        </div>
      `;
    })
    .join('');

  const enemyMarkup = enemies
    .map((enemy) => {
      return `
        <div class="slot fx-target enemy-slot drop-target ${enemy.alive ? '' : 'dead'}" data-team="enemy" data-target-id="${enemy.id}" data-row="${enemy.row}" data-visual-key="${enemyVisualKey(enemy)}">
          <canvas class="miniature combatant-canvas" width="32" height="32" aria-hidden="true"></canvas>
          <span class="slot-name">${enemy.name}</span>
          <span class="slot-hp">HP ${enemy.hp}/${enemy.maxHp} · AR ${enemy.armor}</span>
        </div>
      `;
    })
    .join('');

  return `
    <section class="diorama combat-diorama" aria-label="Campo de batalha">
      <div class="battle-row enemy-row">${enemyMarkup}</div>
      <div class="battle-row party-row">${partyMarkup}</div>
    </section>
  `;
};
