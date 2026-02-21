import { SeededRng } from '../../core/rng';
import { materializeDieFace } from '../shared/dice-face-utils';
import {
  resolveRolledDieAction,
  resolveTurretTicks,
  consumeStunAtTurnStart,
} from './action-resolver';
import { buildEnemyIntents, resolveEnemyTurn } from './intent-system';
import type {
  CombatFxEvent,
  CharacterState,
  CombatState,
  CombatantState,
  GameContent,
  NodeType,
  RolledDie,
  RunState,
  StatusId,
} from '../shared/types';

interface CombatActionResult {
  message: string;
  events: CombatFxEvent[];
}

interface CombatTurnResult {
  logs: string[];
  events: CombatFxEvent[];
}

const STATUS_KEYS: StatusId[] = [
  'block',
  'dodge',
  'mark',
  'poison',
  'bleed',
  'stun',
  'fear',
  'inspired',
  'charged',
  'turret',
];

const makeStatusRecord = (): Record<StatusId, number> => ({
  block: 0,
  dodge: 0,
  mark: 0,
  poison: 0,
  bleed: 0,
  stun: 0,
  fear: 0,
  inspired: 0,
  charged: 0,
  turret: 0,
});

const cloneStatuses = (input?: Partial<Record<StatusId, number>>): Record<StatusId, number> => {
  const base = makeStatusRecord();
  if (!input) {
    return base;
  }
  for (const key of STATUS_KEYS) {
    if (typeof input[key] === 'number') {
      base[key] = input[key] as number;
    }
  }
  return base;
};

const toCombatant = (member: CharacterState): CombatantState => ({
  id: member.id,
  name: member.name,
  visualKey: member.visualKey,
  hp: member.hp,
  maxHp: member.maxHp,
  armor: member.armor,
  statuses: cloneStatuses(member.statuses),
  tags: [...member.tags],
  row: member.row,
  alive: member.alive,
  isEnemy: false,
  classId: member.classId,
  backgroundId: member.backgroundId,
});

const computeInitialFocus = (run: RunState, content: GameContent): number => {
  let focus = 1;

  if (run.morale >= 7) {
    focus += 1;
  } else if (run.morale <= 3) {
    focus -= 1;
  }

  for (const member of run.party) {
    if (member.backgroundId === 'ex_correio_aereo') {
      focus += 1;
    }
  }

  for (const relicId of run.relicIds) {
    const relic = content.byId.relics[relicId];
    if (relic?.effect.kind === 'reroll_bonus') {
      focus += relic.effect.value;
    }
  }

  return Math.max(0, focus);
};

const applyTurnStartRelics = (combat: CombatState, run: RunState, content: GameContent): void => {
  let guardBonus = 0;
  for (const relicId of run.relicIds) {
    const relic = content.byId.relics[relicId];
    if (relic?.effect.kind === 'guard_turn_start') {
      guardBonus += relic.effect.value;
    }
  }

  if (guardBonus > 0) {
    for (const member of combat.party) {
      if (member.alive) {
        member.armor += guardBonus;
      }
    }
    combat.log.unshift(`Reliquias concederam BLK ${guardBonus} para a trip.`);
  }
};

const applyClassAndBackgroundStartPassives = (combat: CombatState): void => {
  for (const member of combat.party) {
    if (!member.alive) {
      continue;
    }

    if (member.classId === 'mecanico') {
      member.armor += 1;
    }

    if (member.backgroundId === 'ex_combatente') {
      member.statuses.fear += 1;
    }
  }
};

const rollDice = (
  combat: CombatState,
  run: RunState,
  content: GameContent,
  rng: SeededRng,
): RolledDie[] => {
  const rolls: RolledDie[] = [];

  for (const member of combat.party) {
    if (!member.alive) {
      continue;
    }

    if (consumeStunAtTurnStart(member)) {
      combat.log.unshift(`${member.name} esta STUN e perde os dados deste turno.`);
      continue;
    }

    const originalMember = run.party.find((entry) => entry.id === member.id);
    const diceIds = (originalMember?.diceIds ?? []).slice(0, 2);

    for (let index = 0; index < diceIds.length; index += 1) {
      const dieId = diceIds[index] as string;
      const die = content.byId.dice[dieId];
      if (!die) {
        continue;
      }
      const faceIndex = rng.nextInt(6);
      const face = materializeDieFace(die, faceIndex);
      rolls.push({
        rollId: `${member.id}_${combat.turn}_${index}`,
        ownerId: member.id,
        dieId,
        faceIndex,
        face,
        used: false,
        locked: false,
      });
    }
  }

  return rolls.slice(0, 8);
};

const mapEnemyToCombatant = (
  enemyId: string,
  uniqueSuffix: number,
  content: GameContent,
  nodeType: NodeType,
  threat: number,
): CombatantState => {
  const blueprint = content.byId.enemies[enemyId];
  const hpBonus = nodeType === 'elite' ? 3 : nodeType === 'boss' ? 0 : 0;
  const threatBonus = threat >= 70 ? 1 : 0;

  return {
    id: `${enemyId}_${uniqueSuffix}`,
    name: blueprint?.name ?? 'Inimigo',
    // Prefer per-enemy visuals when available; falls back to procedural if not bound.
    visualKey: `enemy:${enemyId}`,
    hp: (blueprint?.hp ?? 10) + hpBonus + threatBonus,
    maxHp: (blueprint?.hp ?? 10) + hpBonus + threatBonus,
    armor: blueprint?.armor ?? 0,
    statuses: makeStatusRecord(),
    tags: blueprint?.tags ?? [],
    row: uniqueSuffix % 2 === 0 ? 'front' : 'back',
    alive: true,
    isEnemy: true,
  };
};

const applyThreatScaling = (
  encounterIds: string[],
  nodeType: NodeType,
  run: RunState,
  content: GameContent,
  rng: SeededRng,
): string[] => {
  const regularEnemyIds = content.enemies
    .filter((entry) => !entry.isBoss && !entry.tags.includes('summon_only'))
    .map((entry) => entry.id);
  const hasGuide = run.party.some((entry) => entry.backgroundId === 'guia_local');
  const out = [...encounterIds];

  if (run.pendingForcedElite > 0 && nodeType === 'combat') {
    run.pendingForcedElite = Math.max(0, run.pendingForcedElite - 1);
    if (regularEnemyIds.length > 0) {
      out.push(regularEnemyIds[rng.nextInt(regularEnemyIds.length)] as string);
      out.push(regularEnemyIds[rng.nextInt(regularEnemyIds.length)] as string);
    }
    return out;
  }

  if (nodeType === 'combat' && run.threat >= 70 && regularEnemyIds.length > 0) {
    const shouldAmbush = hasGuide ? rng.nextInt(100) < 45 : true;
    if (shouldAmbush) {
      out.push(regularEnemyIds[rng.nextInt(regularEnemyIds.length)] as string);
    }
  }

  if (nodeType === 'elite' && regularEnemyIds.length > 0) {
    out.push(regularEnemyIds[rng.nextInt(regularEnemyIds.length)] as string);
  }

  return out;
};

const syncPartyBackToRun = (run: RunState, combat: CombatState): void => {
  for (const member of run.party) {
    const source = combat.party.find((entry) => entry.id === member.id);
    if (!source) {
      continue;
    }
    member.hp = source.hp;
    member.armor = source.armor;
    member.statuses = cloneStatuses(source.statuses);
    member.alive = source.alive;
  }
};

const allAliveDead = (list: CombatantState[]): boolean => list.every((entry) => !entry.alive);

const evaluateOutcome = (combat: CombatState): void => {
  if (allAliveDead(combat.enemies)) {
    combat.outcome = 'victory';
  } else if (allAliveDead(combat.party)) {
    combat.outcome = 'defeat';
  }
};

export const createCombatState = (
  run: RunState,
  content: GameContent,
  rng: SeededRng,
  nodeType: NodeType,
  encounterIds: string[],
): CombatState => {
  const scaledEncounter = applyThreatScaling(encounterIds, nodeType, run, content, rng).filter(Boolean);
  const party = run.party.map((member) => toCombatant(member));
  const enemies = scaledEncounter.map((enemyId, index) =>
    mapEnemyToCombatant(enemyId, index, content, nodeType, run.threat),
  );

  const combat: CombatState = {
    id: `combat_${run.seed}_${Date.now()}`,
    nodeType,
    turn: 1,
    awaitingRoll: true,
    party,
    enemies,
    enemyBlueprintIds: [...scaledEncounter],
    intents: [],
    diceRolls: [],
    focus: computeInitialFocus(run, content),
    outcome: 'ongoing',
    log: ['Combate iniciado.'],
    enemyIntentCursor: {},
    classPassivesUsedThisTurn: {},
    enemyRollSnapshot: [],
    postCombatRewards: {
      gold: 0,
      supplies: 0,
      consumables: 0,
      threat: 0,
    },
  };

  applyClassAndBackgroundStartPassives(combat);
  applyTurnStartRelics(combat, run, content);

  for (const enemy of combat.enemies) {
    combat.enemyIntentCursor[enemy.id] = 0;
  }

  combat.intents = buildEnemyIntents(combat, content, rng);
  combat.diceRolls = [];

  return combat;
};

export const rollCombatDice = (
  combat: CombatState,
  run: RunState,
  content: GameContent,
  rng: SeededRng,
): CombatActionResult => {
  const events: CombatFxEvent[] = [];
  if (combat.outcome !== 'ongoing') {
    return { message: 'Combate encerrado.', events };
  }

  if (!combat.awaitingRoll) {
    return { message: 'Os dados deste turno ja foram rolados.', events };
  }

  combat.diceRolls = rollDice(combat, run, content, rng);
  combat.awaitingRoll = false;

  for (const roll of combat.diceRolls) {
    events.push({
      type: 'die_roll',
      rollId: roll.rollId,
      ownerId: roll.ownerId,
      durationMs: 520,
    });
    events.push({
      type: 'die_settle',
      rollId: roll.rollId,
      ownerId: roll.ownerId,
      faceId: roll.face.id,
      durationMs: 680,
    });
  }

  if (combat.diceRolls.length === 0) {
    return { message: 'Nenhum dado disponivel neste turno.', events };
  }

  return {
    message: `Dados rolados: ${combat.diceRolls.length}.`,
    events,
  };
};

export const rerollOneDieWithFocus = (
  combat: CombatState,
  content: GameContent,
  rng: SeededRng,
  preferredRollId?: string,
): CombatActionResult => {
  const events: CombatFxEvent[] = [];

  if (combat.outcome !== 'ongoing') {
    return { message: 'Combate encerrado.', events };
  }

  if (combat.awaitingRoll) {
    return { message: 'Toque ROLL para gerar os dados do turno.', events };
  }

  if (combat.focus <= 0) {
    return { message: 'Sem FOCO para rerrolar.', events };
  }

  let roll =
    (preferredRollId
      ? combat.diceRolls.find((entry) => entry.rollId === preferredRollId && !entry.used)
      : undefined) ??
    combat.diceRolls.find((entry) => !entry.used && !entry.locked);

  if (!roll) {
    return { message: 'Nenhum dado disponivel para rerrolar.', events };
  }

  if (roll.locked) {
    return { message: 'Esse dado esta travado por MIRAR.', events };
  }

  const die = content.byId.dice[roll.dieId];
  if (!die) {
    return { message: 'Dado nao encontrado no conteudo.', events };
  }

  events.push({
    type: 'die_roll',
    rollId: roll.rollId,
    ownerId: roll.ownerId,
    durationMs: 540,
  });
  roll.faceIndex = rng.nextInt(6);
  roll.face = materializeDieFace(die, roll.faceIndex);
  combat.focus -= 1;
  events.push({
    type: 'die_settle',
    rollId: roll.rollId,
    ownerId: roll.ownerId,
    faceId: roll.face.id,
    durationMs: 700,
  });
  events.push({
    type: 'focus',
    ownerId: roll.ownerId,
    delta: -1,
  });

  return {
    message: `Rerrolagem aplicada em ${roll.face.label}. FOCO restante: ${combat.focus}.`,
    events,
  };
};

export const discardDieForGuard = (combat: CombatState, rollId: string): CombatActionResult => {
  const events: CombatFxEvent[] = [];
  const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
  if (!roll || roll.used) {
    return { message: 'Dado invalido para descarte.', events };
  }

  const owner = combat.party.find((entry) => entry.id === roll.ownerId);
  if (!owner) {
    return { message: 'Dono do dado nao encontrado.', events };
  }

  owner.armor += 1;
  roll.used = true;
  events.push({
    type: 'status',
    targetId: owner.id,
    statusId: 'block',
    stacks: 1,
  });
  return { message: `${owner.name} descartou dado e ganhou BLK 1.`, events };
};

export const usePlayerDie = (
  combat: CombatState,
  rollId: string,
  targetTeam: 'party' | 'enemy',
  targetId: string,
): CombatActionResult => {
  const events: CombatFxEvent[] = [];
  if (combat.awaitingRoll) {
    return { message: 'Toque ROLL para gerar os dados do turno.', events };
  }
  const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
  if (!roll || roll.used) {
    return { message: 'Dado invalido.', events };
  }

  if (roll.face.kind === 'empty') {
    roll.used = true;
    const owner = combat.party.find((entry) => entry.id === roll.ownerId);
    return { message: `${owner?.name ?? 'Trip'} caiu em um lado vazio.`, events };
  }

  const result = resolveRolledDieAction(combat, roll, 'party', targetTeam, targetId);
  if (!result.ok) {
    return { message: result.log, events: result.events };
  }

  roll.used = true;
  evaluateOutcome(combat);
  return { message: result.log, events: result.events };
};

export const nextCombatTurn = (
  combat: CombatState,
  run: RunState,
  content: GameContent,
  rng: SeededRng,
): CombatTurnResult => {
  const events: CombatFxEvent[] = [];
  if (combat.outcome !== 'ongoing') {
    syncPartyBackToRun(run, combat);
    return { logs: ['Combate ja encerrado.'], events };
  }

  const logs: string[] = [];

  const turretResult = resolveTurretTicks(combat);
  logs.push(...turretResult.logs);
  events.push(...turretResult.events);

  const enemyTurn = resolveEnemyTurn(combat, content, rng);
  logs.push(...enemyTurn.logs);
  events.push(...enemyTurn.events);

  evaluateOutcome(combat);

  if (combat.outcome !== 'ongoing') {
    syncPartyBackToRun(run, combat);
    return { logs, events };
  }

  combat.turn += 1;
  combat.classPassivesUsedThisTurn = {};
  applyTurnStartRelics(combat, run, content);
  combat.intents = buildEnemyIntents(combat, content, rng);
  combat.diceRolls = [];
  combat.awaitingRoll = true;

  if (combat.turn % 3 === 0) {
    for (let i = 0; i < combat.enemies.length; i += 1) {
      const enemy = combat.enemies[i] as CombatantState;
      const blueprintId = combat.enemyBlueprintIds[i] as string;
      if (blueprintId === 'capitao_vesper' && enemy.alive) {
        enemy.statuses.dodge += 1;
        logs.push(`${enemy.name} ativou fumaca e ganhou DODGE 1.`);
        events.push({
          type: 'status',
          targetId: enemy.id,
          statusId: 'dodge',
          stacks: 1,
        });
      }
    }
  }

  syncPartyBackToRun(run, combat);

  return { logs: [...logs, `Turno ${combat.turn} pronto. Toque ROLL.`], events };
};

export const syncCombatToRun = (run: RunState, combat: CombatState): void => {
  syncPartyBackToRun(run, combat);
};
