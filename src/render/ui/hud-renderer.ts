import type { CombatState, RunState } from '../../domain/shared/types';

const pct = (current: number, max: number): number => {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
};

export const renderRunHud = (run: RunState): string => `
  <section class="hud run-hud" aria-label="Estado da expedicao">
    <div class="hud-item"><span>Suprimentos</span><strong>${run.supplies}</strong></div>
    <div class="hud-item"><span>Moral</span><strong>${run.morale}/10</strong></div>
    <div class="hud-item"><span>Ameaca</span><strong>${run.threat}/100</strong></div>
    <div class="hud-item"><span>Ferimentos</span><strong>${run.injuries}</strong></div>
    <div class="hud-item"><span>Ouro</span><strong>${run.gold}</strong></div>
    <div class="hud-item"><span>Consumiveis</span><strong>${run.consumables}</strong></div>
  </section>
`;

export const renderEnemyIntentHud = (combat: CombatState): string => {
  const intentMarkup = combat.intents
    .map((intent) => {
      const enemy = combat.enemies.find((entry) => entry.id === intent.enemyId);
      return `<li>${enemy?.name ?? 'Inimigo'}: ${intent.label} (${intent.value})</li>`;
    })
    .join('');

  return `
    <section class="hud intent-hud" aria-label="Intencoes inimigas">
      <h3>Intencoes</h3>
      <ul>${intentMarkup || '<li>Sem intencoes ativas</li>'}</ul>
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
