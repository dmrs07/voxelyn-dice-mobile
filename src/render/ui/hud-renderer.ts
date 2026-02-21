import type { CombatState, RunState } from '../../domain/shared/types';

const pct = (current: number, max: number): number => {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
};

type ThresholdLevel = 'safe' | 'warning' | 'danger';

const suppliesLevel = (value: number): ThresholdLevel => {
  if (value <= 2) return 'danger';
  if (value <= 5) return 'warning';
  return 'safe';
};

const moraleLevel = (value: number): ThresholdLevel => {
  if (value <= 3) return 'danger';
  if (value <= 6) return 'warning';
  return 'safe';
};

const threatLevel = (value: number): ThresholdLevel => {
  if (value >= 70) return 'danger';
  if (value >= 40) return 'warning';
  return 'safe';
};

const levelLabel = (level: ThresholdLevel): string => {
  if (level === 'danger') return 'PERIGO';
  if (level === 'warning') return 'ALERTA';
  return 'ESTAVEL';
};

export const renderRunHud = (run: RunState): string => `
  <section class="hud run-hud" aria-label="Estado da expedicao">
    <div class="hud-item hud-threat is-${threatLevel(run.threat)}">
      <div class="hud-threat-head">
        <span>Ameaca</span>
        <strong>${run.threat}/100</strong>
      </div>
      <div class="hud-meter-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${run.threat}">
        <div class="hud-meter-fill level-${threatLevel(run.threat)}" style="width:${pct(run.threat, 100)}%"></div>
        <span class="hud-meter-threshold threshold-warning" style="left:40%"></span>
        <span class="hud-meter-threshold threshold-danger" style="left:70%"></span>
      </div>
      <small class="hud-threshold-note">${levelLabel(threatLevel(run.threat))} · 70+ aumenta risco de combate</small>
    </div>
    <div class="hud-item is-${suppliesLevel(run.supplies)}">
      <span>Suprimentos</span>
      <strong>${run.supplies}</strong>
      <div class="hud-meter-track" role="meter" aria-valuemin="0" aria-valuemax="30" aria-valuenow="${run.supplies}">
        <div class="hud-meter-fill level-${suppliesLevel(run.supplies)}" style="width:${pct(run.supplies, 30)}%"></div>
        <span class="hud-meter-threshold threshold-danger" style="left:6.66%"></span>
        <span class="hud-meter-threshold threshold-warning" style="left:16.66%"></span>
      </div>
      <small class="hud-threshold-note">${run.supplies <= 2 ? 'Critico: risco de desgaste' : run.supplies <= 5 ? 'Baixo: planeje descanso/loot' : 'Reserva ok'}</small>
    </div>
    <div class="hud-item is-${moraleLevel(run.morale)}">
      <span>Moral</span>
      <strong>${run.morale}/10</strong>
      <div class="hud-meter-track" role="meter" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${run.morale}">
        <div class="hud-meter-fill level-${moraleLevel(run.morale)}" style="width:${pct(run.morale, 10)}%"></div>
        <span class="hud-meter-threshold threshold-danger" style="left:30%"></span>
        <span class="hud-meter-threshold threshold-warning" style="left:60%"></span>
      </div>
      <small class="hud-threshold-note">${run.morale <= 3 ? 'Baixa: -1 foco inicial' : run.morale >= 7 ? 'Alta: +1 foco inicial' : 'Neutra'}</small>
    </div>
    <div class="hud-item"><span>Ferimentos</span><strong>${run.injuries}</strong></div>
    <div class="hud-item"><span>Ouro</span><strong>${run.gold}</strong></div>
    <div class="hud-item"><span>Consumiveis</span><strong>${run.consumables}</strong></div>
  </section>
`;

export const renderEnemyIntentHud = (combat: CombatState): string => {
  const kindGlyph = (kind: string): string => {
    if (kind === 'attack') return 'ATK';
    if (kind === 'defend') return 'BLK';
    if (kind === 'heal') return 'HEAL';
    if (kind === 'status') return 'STS';
    return 'SPC';
  };

  const intentMarkup = combat.intents
    .map((intent) => {
      const enemy = combat.enemies.find((entry) => entry.id === intent.enemyId);
      const enemyName = enemy?.name ?? 'Inimigo';
      const detail = `${enemyName}: ${intent.label} (${intent.value})`;
      return `
        <span class="intent-chip intent-${intent.kind}" title="${detail}">
          <strong>${enemyName}</strong>
          <em>${kindGlyph(intent.kind)} ${intent.value}</em>
        </span>
      `;
    })
    .join('');

  return `
    <section class="hud intent-hud compact" aria-label="Intencoes inimigas">
      <h3>Intencoes</h3>
      <div class="intent-chip-row">${intentMarkup || '<span class="intent-chip empty">Sem intencoes ativas</span>'}</div>
    </section>
  `;
};

export const renderPartyHealthBars = (combat: CombatState): string => {
  const markup = combat.party
    .map((member) => `
      <div class="bar-row ${member.alive ? '' : 'dead'}">
        <span>${member.name}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct(member.hp, member.maxHp)}%"></div></div>
        <em>${member.hp}/${member.maxHp}</em>
      </div>
    `)
    .join('');

  return `<section class="party-bars">${markup}</section>`;
};
