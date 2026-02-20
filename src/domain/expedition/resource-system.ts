import type { RelicDef, RunState } from '../shared/types';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const relicModifier = (run: RunState, relics: RelicDef[], kind: RelicDef['effect']['kind']): number => {
  let total = 0;
  for (const relic of relics) {
    if (!run.relicIds.includes(relic.id)) {
      continue;
    }
    if (relic.effect.kind === kind) {
      total += relic.effect.value;
    }
  }
  return total;
};

export const applyTravelCost = (run: RunState, relics: RelicDef[]): void => {
  const threatSlow = relicModifier(run, relics, 'threat_slow');
  const threatGain = Math.max(1, 6 - threatSlow);

  run.supplies -= 1;
  if (run.supplies < 0) {
    run.supplies = 0;
  }
  run.threat = clamp(run.threat + threatGain, 0, 100);

  if (run.supplies === 0) {
    run.injuries += 1;
    run.morale = clamp(run.morale - 1, 0, 10);
    run.runLog.unshift('Sem suprimentos: a trip sofre desgaste.');
  }
};

export const applyRunResourceDelta = (
  run: RunState,
  resource: 'supplies' | 'morale' | 'threat' | 'injuries' | 'gold' | 'consumables',
  delta: number,
): void => {
  if (resource === 'supplies') {
    run.supplies = clamp(run.supplies + delta, 0, 30);
    return;
  }

  if (resource === 'morale') {
    run.morale = clamp(run.morale + delta, 0, 10);
    return;
  }

  if (resource === 'threat') {
    run.threat = clamp(run.threat + delta, 0, 100);
    return;
  }

  if (resource === 'injuries') {
    run.injuries = clamp(run.injuries + delta, 0, 10);
    return;
  }

  if (resource === 'gold') {
    run.gold = clamp(run.gold + delta, 0, 999);
    return;
  }

  run.consumables = clamp(run.consumables + delta, 0, 99);
};

export const applyRestNode = (run: RunState): void => {
  run.injuries = Math.max(0, run.injuries - 2);
  run.morale = clamp(run.morale + 2, 0, 10);

  const hasGuide = run.party.some((member) => member.backgroundId === 'guia_local');
  const healAmount = hasGuide ? 6 : 5;

  for (const member of run.party) {
    member.hp = Math.min(member.maxHp, member.hp + healAmount);
    member.armor = 0;
  }

  run.runLog.unshift(
    hasGuide
      ? 'Acampamento: guia local melhorou a recuperacao da trip.'
      : 'Acampamento: a trip recuperou folego.',
  );
};
