import type {
  CombatIntent,
  CombatantState,
  GameContent,
  RunState,
} from '../../domain/shared/types';
import { COMBATANT_INTERNAL_PX } from '../pixel/constants';
import { resolveCombatantAvatarSrc } from '../pixel/asset-loader';

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

const pct = (current: number, max: number): number => {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
};

const intentGlyph = (kind: CombatIntent['kind']): string => {
  if (kind === 'attack') return 'ATK';
  if (kind === 'defend') return 'BLK';
  if (kind === 'heal') return 'HEAL';
  if (kind === 'status') return 'STS';
  return 'SPC';
};

export const renderMapDiorama = (run: RunState, content: GameContent): string => {
  const partyMarkup = run.party
    .map((member) => {
      const avatar = resolveCombatantAvatarSrc(member.visualKey ?? `party:${member.classId ?? 'default'}`);
      return `
        <article class="map-party-card ${member.alive ? '' : 'dead'}">
          <img class="map-party-portrait" src="${avatar}" alt="${member.name}" />
          <div class="map-party-meta">
            <strong>${member.name}</strong>
            <small>${member.row === 'front' ? 'FRONT' : 'BACK'} · HP ${member.hp}/${member.maxHp}</small>
          </div>
        </article>
      `;
    })
    .join('');

  return `
    <section class="diorama map-diorama" aria-label="Diorama de exploracao">
      <div class="mist-layer"></div>
      <div class="map-party-row">${partyMarkup}</div>
      <p class="diorama-caption">${content.biome.name} · Ameaca ${run.threat}</p>
    </section>
  `;
};

export const renderCombatDiorama = (
  party: CombatantState[],
  enemies: CombatantState[],
  options?: {
    biomeId?: string;
    phaseBucket?: 'opening' | 'mid' | 'climax';
    validTargetIds?: Set<string>;
    selectedTargetId?: string | null;
    intentByEnemyId?: Readonly<Record<string, CombatIntent[]>>;
    showPartyLine?: boolean;
  },
): string => {
  const biomeClass = (options?.biomeId ?? 'amazonia_nuvens').replace(/[^a-z0-9_]/gi, '_');
  const phaseBucket = options?.phaseBucket ?? 'opening';
  const validTargets = options?.validTargetIds ?? new Set<string>();
  const selectedTargetId = options?.selectedTargetId ?? null;
  const showPartyLine = options?.showPartyLine ?? true;
  const intentByEnemyId = options?.intentByEnemyId ?? {};

  const intentBadge = (enemyId: string): string => {
    const intents = intentByEnemyId[enemyId] ?? [];
    if (intents.length === 0) {
      return '<span class="enemy-intent-badge intent-empty">SEM INTENCAO</span>';
    }
    return intents
      .slice(0, 3)
      .map(
        (intent) => `
          <span class="enemy-intent-badge intent-${intent.kind}">
            <em>${intentGlyph(intent.kind)}</em>
            <strong>${intent.value}</strong>
          </span>
        `,
      )
      .join('');
  };

  const statusBadge = (member: CombatantState): string => {
    const active = Object.entries(member.statuses)
      .filter(([, value]) => Number(value) > 0)
      .slice(0, 2);
    if (active.length === 0) {
      return '';
    }
    return `<div class="unit-status-line">${active
      .map(([statusId, value]) => `<span class="unit-status">${statusId.toUpperCase()} ${value}</span>`)
      .join('')}</div>`;
  };

  const rowBadge = (member: CombatantState): string =>
    `<span class="unit-row-badge">${member.row === 'front' ? 'FRONT' : 'BACK'}</span>`;

  const sortedParty = [...party].sort((a, b) => {
    if (a.row === b.row) {
      return a.id.localeCompare(b.id);
    }
    return a.row === 'front' ? -1 : 1;
  });

  const sortedEnemies = [...enemies].sort((a, b) => {
    if (a.row === b.row) {
      return a.id.localeCompare(b.id);
    }
    return a.row === 'front' ? -1 : 1;
  });
  const enemyCount = sortedEnemies.length;

  const partyMarkup = sortedParty
    .map((member) => {
      const validClass = validTargets.size > 0 ? (validTargets.has(member.id) ? 'is-valid-target' : 'is-invalid-target') : '';
      return `
        <article class="battlefield-unit fx-target drop-target team-party row-${member.row} ${member.alive ? '' : 'dead'} ${validClass} ${selectedTargetId === member.id ? 'is-selected-target' : ''}" data-team="party" data-target-id="${member.id}" data-row="${member.row}" data-visual-key="${partyVisualKey(member)}" data-status-host="true">
          <canvas class="miniature combatant-canvas" width="${COMBATANT_INTERNAL_PX}" height="${COMBATANT_INTERNAL_PX}" aria-hidden="true"></canvas>
          <div class="unit-overlay">
            <div class="unit-head">
              <span class="unit-name">${member.name}</span>${rowBadge(member)}
            </div>
            <div class="unit-hp-head">
              <span class="unit-bars">HP ${member.hp}/${member.maxHp}</span>
              <span class="unit-armor-chip">BLK ${member.armor}</span>
            </div>
            <span class="unit-hp-track"><span class="unit-hp-fill" style="width:${pct(member.hp, member.maxHp)}%"></span></span>
            ${statusBadge(member)}
          </div>
        </article>
      `;
    })
    .join('');

  const enemyMarkup = sortedEnemies
    .map((enemy) => {
      const validClass = validTargets.size > 0 ? (validTargets.has(enemy.id) ? 'is-valid-target' : 'is-invalid-target') : '';
      return `
        <article class="battlefield-unit fx-target drop-target team-enemy row-${enemy.row} ${enemy.alive ? '' : 'dead'} ${validClass} ${selectedTargetId === enemy.id ? 'is-selected-target' : ''}" data-team="enemy" data-target-id="${enemy.id}" data-row="${enemy.row}" data-visual-key="${enemyVisualKey(enemy)}" data-status-host="true">
          <div class="enemy-intent-row">${intentBadge(enemy.id)}</div>
          <canvas class="miniature combatant-canvas" width="${COMBATANT_INTERNAL_PX}" height="${COMBATANT_INTERNAL_PX}" aria-hidden="true"></canvas>
          <div class="unit-overlay">
            <div class="unit-head">
              <span class="unit-name">${enemy.name}</span>${rowBadge(enemy)}
            </div>
            <div class="unit-hp-head">
              <span class="unit-bars">HP ${enemy.hp}/${enemy.maxHp}</span>
              <span class="unit-armor-chip">BLK ${enemy.armor}</span>
            </div>
            <span class="unit-hp-track"><span class="unit-hp-fill" style="width:${pct(enemy.hp, enemy.maxHp)}%"></span></span>
            ${statusBadge(enemy)}
          </div>
        </article>
      `;
    })
    .join('');

  return `
    <section class="battlefield biome-${biomeClass} phase-${phaseBucket} ${enemyCount === 1 ? 'enemy-solo' : ''}" data-enemy-count="${enemyCount}" aria-label="Campo de batalha">
      <div class="battlefield-fx-layer"></div>
      <div class="battleline enemy-line">${enemyMarkup}</div>
      ${showPartyLine ? `<div class="battleline party-line">${partyMarkup}</div>` : ''}
    </section>
  `;
};
