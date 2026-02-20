import { SeededRng } from '../../core/rng';
import { applyRunResourceDelta } from './resource-system';
import type {
  CharacterState,
  DieSource,
  EventChoiceDef,
  EventDef,
  FaceKind,
  GameContent,
  OutcomeDef,
  RunState,
  StatusId,
} from '../shared/types';

const getPartyTagSet = (run: RunState): Set<string> => {
  const tags = new Set<string>();
  for (const member of run.party) {
    for (const tag of member.tags) {
      tags.add(tag);
    }
  }
  return tags;
};

const findCharacter = (run: RunState, characterId: string): CharacterState | null =>
  run.party.find((entry) => entry.id === characterId) ?? null;

const getDieIdForSource = (character: CharacterState, source: DieSource): string | null => {
  if (source === 'class') {
    return character.diceIds[0] ?? null;
  }
  return character.diceIds[1] ?? null;
};

const rollFaceForEvent = (
  run: RunState,
  content: GameContent,
  rng: SeededRng,
  characterId: string,
  source: DieSource,
): { kind: FaceKind; value: number; label: string } | null => {
  const character = findCharacter(run, characterId);
  if (!character || !character.alive) {
    return null;
  }

  const dieId = getDieIdForSource(character, source);
  if (!dieId) {
    return null;
  }

  const die = content.byId.dice[dieId];
  if (!die) {
    return null;
  }

  const rolledFace = die.faces[rng.nextInt(6)] ?? die.faces[0];
  return {
    kind: rolledFace.kind,
    value: rolledFace.value,
    label: rolledFace.label,
  };
};

const evaluateCheck = (
  run: RunState,
  choice: EventChoiceDef,
  rolledFace: { kind: FaceKind; value: number; label: string } | null,
): boolean => {
  if (!choice.check) {
    return true;
  }

  if (choice.check.autoSuccessTag) {
    const tags = getPartyTagSet(run);
    if (tags.has(choice.check.autoSuccessTag)) {
      return true;
    }
  }

  if (!rolledFace) {
    return false;
  }

  if (choice.check.kind === 'face_kind') {
    if (choice.check.faceKind && rolledFace.kind === choice.check.faceKind) {
      return true;
    }
    if (choice.check.anyOfKinds && choice.check.anyOfKinds.includes(rolledFace.kind)) {
      return true;
    }
    return false;
  }

  if (choice.check.kind === 'face_value_min') {
    let bonus = 0;
    if (choice.check.bonusPerTag) {
      const tags = getPartyTagSet(run);
      if (tags.has(choice.check.bonusPerTag)) {
        bonus += 1;
      }
    }
    return rolledFace.value + bonus >= (choice.check.minValue ?? 0);
  }

  return false;
};

const applyStatusToRandomPartyMember = (
  run: RunState,
  rng: SeededRng,
  statusId: StatusId,
  stacks: number,
): void => {
  const alive = run.party.filter((member) => member.alive);
  if (alive.length === 0) {
    return;
  }
  const target = alive[rng.nextInt(alive.length)] as (typeof alive)[number];
  target.statuses[statusId] += stacks;
};

const applyOutcome = (
  run: RunState,
  content: GameContent,
  rng: SeededRng,
  outcome: OutcomeDef,
  logs: string[],
): void => {
  switch (outcome.kind) {
    case 'resource': {
      applyRunResourceDelta(run, outcome.resource, outcome.delta);
      logs.push(`${outcome.resource} ${outcome.delta >= 0 ? '+' : ''}${outcome.delta}`);
      return;
    }
    case 'heal': {
      if (outcome.target === 'party') {
        for (const member of run.party) {
          member.hp = Math.min(member.maxHp, member.hp + outcome.amount);
          if (member.hp > 0) {
            member.alive = true;
          }
        }
        logs.push(`Trip curada em ${outcome.amount}.`);
        return;
      }
      const alive = run.party.filter((member) => member.alive);
      if (alive.length > 0) {
        const target = alive[rng.nextInt(alive.length)] as (typeof alive)[number];
        target.hp = Math.min(target.maxHp, target.hp + outcome.amount);
        logs.push(`${target.name} curou ${outcome.amount}.`);
      }
      return;
    }
    case 'damage': {
      if (outcome.target === 'party') {
        for (const member of run.party) {
          member.hp = Math.max(0, member.hp - outcome.amount);
          member.alive = member.hp > 0;
        }
        logs.push(`Trip sofreu ${outcome.amount} dano.`);
        return;
      }
      const alive = run.party.filter((member) => member.alive);
      if (alive.length > 0) {
        const target = alive[rng.nextInt(alive.length)] as (typeof alive)[number];
        target.hp = Math.max(0, target.hp - outcome.amount);
        target.alive = target.hp > 0;
        logs.push(`${target.name} sofreu ${outcome.amount} dano.`);
      }
      return;
    }
    case 'relic': {
      const pool = content.relics.filter((entry) => {
        if (outcome.relicId) {
          return entry.id === outcome.relicId;
        }
        if (outcome.poolTag) {
          return entry.tags.includes(outcome.poolTag);
        }
        return true;
      });
      const available = pool.filter((entry) => !run.relicIds.includes(entry.id));
      const picked = available.length > 0 ? available[rng.nextInt(available.length)] : undefined;
      if (picked) {
        run.relicIds.push(picked.id);
        logs.push(`Reliquia obtida: ${picked.name}`);
        if (picked.effect.kind === 'max_hp_bonus') {
          for (const member of run.party) {
            member.maxHp += picked.effect.value;
            member.hp += picked.effect.value;
          }
          logs.push(`Trip recebeu +${picked.effect.value} HP maximo por reliquia.`);
        }
      }
      return;
    }
    case 'status': {
      if (outcome.target === 'party') {
        for (const member of run.party) {
          member.statuses[outcome.statusId] += outcome.stacks;
        }
      } else {
        applyStatusToRandomPartyMember(run, rng, outcome.statusId, outcome.stacks);
      }
      logs.push(`Status ${outcome.statusId} aplicado (${outcome.stacks}).`);
      return;
    }
    case 'state': {
      if (outcome.flag === 'force_elite_next') {
        run.pendingForcedElite += outcome.value;
        logs.push(`Elite garantida em ${outcome.value} proximo(s) encontro(s).`);
      } else if (outcome.flag === 'reveal_nodes') {
        run.pendingRevealNodes += outcome.value;
        logs.push(`Rotas reveladas: +${outcome.value}.`);
      } else if (outcome.flag === 'spawn_shop_next') {
        run.pendingShopNodes += outcome.value;
        logs.push(`Mercador surgira adiante.`);
      } else if (outcome.flag === 'skip_danger_nodes') {
        run.pendingSkipDangerNodes += outcome.value;
        logs.push(`Carga de salto de risco +${outcome.value}.`);
      }
      return;
    }
    case 'log': {
      logs.push(outcome.text);
      return;
    }
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
};

export const pickEventForRun = (run: RunState, content: GameContent, rng: SeededRng): EventDef => {
  const partyTags = getPartyTagSet(run);
  const exclusiveEvents = new Set<string>();
  for (const member of run.party) {
    const background = content.byId.backgrounds[member.backgroundId];
    if (!background) {
      continue;
    }
    for (const eventId of background.exclusiveEventIds) {
      exclusiveEvents.add(eventId);
    }
  }

  const candidates = content.events.filter((entry) => {
    if (entry.biome !== run.map.biomeId) {
      return false;
    }

    if (entry.requiredTags.length === 0) {
      return true;
    }

    return entry.requiredTags.some((tag) => partyTags.has(tag));
  });

  const weighted: EventDef[] = [];
  for (const event of candidates) {
    const weight = Math.max(1, event.weight) + (exclusiveEvents.has(event.id) ? 2 : 0);
    for (let i = 0; i < weight; i += 1) {
      weighted.push(event);
    }
  }

  if (weighted.length === 0) {
    return content.events[0] as EventDef;
  }

  return weighted[rng.nextInt(weighted.length)] as EventDef;
};

export interface EventChoiceResolution {
  success: boolean;
  log: string[];
  rolledFaceLabel: string;
  usedFreeReroll: boolean;
}

export const resolveEventChoice = (
  run: RunState,
  content: GameContent,
  rng: SeededRng,
  choice: EventChoiceDef,
  selectedCharacterId: string,
  selectedDieSource: DieSource,
  freeRerollAvailable: boolean,
): EventChoiceResolution => {
  let rolledFace = rollFaceForEvent(run, content, rng, selectedCharacterId, selectedDieSource);
  let success = evaluateCheck(run, choice, rolledFace);
  const log: string[] = [];
  let usedFreeReroll = false;

  if (rolledFace) {
    log.push(`Rolagem: ${rolledFace.label} (${rolledFace.kind.toUpperCase()} ${rolledFace.value})`);
  }

  const hasReporter = run.party.some((entry) => entry.backgroundId === 'reporter_radio');
  if (!success && freeRerollAvailable && hasReporter && choice.check) {
    const rerolled = rollFaceForEvent(run, content, rng, selectedCharacterId, selectedDieSource);
    if (rerolled) {
      rolledFace = rerolled;
      usedFreeReroll = true;
      log.push(`Reroll gratuito: ${rerolled.label} (${rerolled.kind.toUpperCase()} ${rerolled.value})`);
      success = evaluateCheck(run, choice, rerolled);
    }
  }

  const outcomes = success ? choice.onSuccess : choice.onFail;

  for (const outcome of outcomes) {
    applyOutcome(run, content, rng, outcome, log);
  }

  return {
    success,
    log,
    rolledFaceLabel: rolledFace?.label ?? 'Sem rolagem valida',
    usedFreeReroll,
  };
};
