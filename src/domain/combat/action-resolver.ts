import type {
  CombatFxEvent,
  CombatIntent,
  CombatState,
  CombatantState,
  DiceFaceDef,
  FaceEffectDef,
  FaceEffectTarget,
  RangeType,
  RolledDie,
  StatusId,
} from '../shared/types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const enemyTeamFor = (team: 'party' | 'enemy'): 'party' | 'enemy' =>
  team === 'party' ? 'enemy' : 'party';

const aliveTeam = (combat: CombatState, team: 'party' | 'enemy'): CombatantState[] =>
  (team === 'party' ? combat.party : combat.enemies).filter((entry) => entry.alive);

const hasFrontAlive = (members: CombatantState[]): boolean =>
  members.some((entry) => entry.alive && entry.row === 'front');

const findCombatant = (
  combat: CombatState,
  team: 'party' | 'enemy',
  targetId: string,
): CombatantState | null =>
  (team === 'party' ? combat.party : combat.enemies).find((entry) => entry.id === targetId) ?? null;

const deterministicIndex = (seed: string, length: number): number => {
  if (length <= 0) {
    return 0;
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
};

const pushIdleDisabledIfDead = (
  target: CombatantState,
  wasAlive: boolean,
  events: CombatFxEvent[],
): void => {
  if (wasAlive && !target.alive) {
    events.push({ type: 'idle', targetId: target.id, enabled: false });
  }
};

const cleanOneNegativeStatus = (target: CombatantState): string | null => {
  const order: StatusId[] = ['stun', 'bleed', 'poison', 'fear', 'mark'];
  for (const statusId of order) {
    if ((target.statuses[statusId] ?? 0) > 0) {
      target.statuses[statusId] -= 1;
      return statusId;
    }
  }
  return null;
};

export const addStatus = (target: CombatantState, statusId: StatusId, stacks: number): void => {
  if (stacks <= 0) {
    return;
  }
  if (statusId === 'block') {
    target.armor += stacks;
    return;
  }
  target.statuses[statusId] = clamp((target.statuses[statusId] ?? 0) + stacks, 0, 99);
};

export interface DamageResult {
  dealt: number;
  dodged: boolean;
  absorbed: number;
}

export const applyDamageToTarget = (
  target: CombatantState,
  rawDamage: number,
  options?: {
    consumeMark?: boolean;
    allowDodge?: boolean;
  },
): DamageResult => {
  let damage = Math.max(0, rawDamage);
  const consumeMark = options?.consumeMark ?? true;
  const allowDodge = options?.allowDodge ?? true;

  if (consumeMark && (target.statuses.mark ?? 0) > 0) {
    damage += target.statuses.mark;
    target.statuses.mark = 0;
  }

  if (allowDodge && (target.statuses.dodge ?? 0) > 0) {
    target.statuses.dodge -= 1;
    return { dealt: 0, dodged: true, absorbed: 0 };
  }

  const absorbed = Math.min(target.armor, damage);
  target.armor -= absorbed;
  const hpDamage = Math.max(0, damage - absorbed);
  target.hp = Math.max(0, target.hp - hpDamage);
  target.alive = target.hp > 0;

  return { dealt: hpDamage, dodged: false, absorbed };
};

export const applyHealingToTarget = (target: CombatantState, amount: number): number => {
  if (amount <= 0) {
    return 0;
  }
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  if (target.hp > 0) {
    target.alive = true;
  }

  return target.hp - before;
};

const resolveTargetsForEffect = (
  combat: CombatState,
  actor: CombatantState,
  actorTeam: 'party' | 'enemy',
  targetTeam: 'party' | 'enemy',
  selectedTarget: CombatantState,
  effectTarget: FaceEffectTarget | undefined,
): CombatantState[] => {
  const targetMode = effectTarget ?? 'target';

  if (targetMode === 'self') {
    return actor.alive ? [actor] : [];
  }

  if (targetMode === 'target') {
    return selectedTarget.alive ? [selectedTarget] : [];
  }

  if (targetMode === 'ally') {
    if (targetTeam === actorTeam && selectedTarget.alive) {
      return [selectedTarget];
    }
    return actor.alive ? [actor] : [];
  }

  if (targetMode === 'all_allies') {
    return aliveTeam(combat, actorTeam);
  }

  if (targetMode === 'enemy_front_all') {
    const enemies = aliveTeam(combat, enemyTeamFor(actorTeam));
    const front = enemies.filter((entry) => entry.row === 'front');
    return front.length > 0 ? front : enemies;
  }

  if (targetMode === 'enemy_back_all') {
    const enemies = aliveTeam(combat, enemyTeamFor(actorTeam));
    const back = enemies.filter((entry) => entry.row === 'back');
    return back.length > 0 ? back : enemies;
  }

  if (targetMode === 'enemy_all') {
    return aliveTeam(combat, enemyTeamFor(actorTeam));
  }

  if (targetMode === 'enemy_random') {
    const enemies = aliveTeam(combat, enemyTeamFor(actorTeam));
    if (enemies.length === 0) {
      return [];
    }
    const index = deterministicIndex(`${actor.id}:${combat.turn}:${selectedTarget.id}`, enemies.length);
    return [enemies[index] as CombatantState];
  }

  return [];
};

const canHitTargetWithRange = (
  combat: CombatState,
  actorTeam: 'party' | 'enemy',
  targetTeam: 'party' | 'enemy',
  target: CombatantState,
  range: RangeType,
): boolean => {
  if (range !== 'melee' || actorTeam === targetTeam) {
    return true;
  }

  const opponents = aliveTeam(combat, targetTeam);
  if (!hasFrontAlive(opponents)) {
    return true;
  }

  return target.row === 'front';
};

const focusFromNumeric = (actor: CombatantState, base: number, consumedCharged: { value: boolean }): number => {
  const inspired = Math.min(2, actor.statuses.inspired ?? 0);
  const fear = actor.statuses.fear ?? 0;
  let value = base + inspired - fear;

  if (!consumedCharged.value && (actor.statuses.charged ?? 0) > 0) {
    value += 2;
    actor.statuses.charged -= 1;
    consumedCharged.value = true;
  }

  return Math.max(1, value);
};

const applyAviadoraSwapPassive = (combat: CombatState, actor: CombatantState): string | null => {
  if (actor.classId !== 'aviadora') {
    return null;
  }

  const key = `${actor.id}:aviadora_swap`;
  if (combat.classPassivesUsedThisTurn[key]) {
    return null;
  }

  combat.classPassivesUsedThisTurn[key] = true;
  addStatus(actor, 'dodge', 1);
  return `${actor.name} ativou Manobra e ganhou DODGE 1.`;
};

const applyOcultistaMarkPassive = (actor: CombatantState): string | null => {
  if (actor.classId !== 'ocultista') {
    return null;
  }
  actor.armor += 1;
  return `${actor.name} ativou Sussurros e ganhou BLK 1.`;
};

const applyHunterMarkedBonus = (actor: CombatantState, target: CombatantState): number => {
  if (actor.classId !== 'cacador') {
    return 0;
  }
  return (target.statuses.mark ?? 0) > 0 ? 1 : 0;
};

const lockDiceForActor = (combat: CombatState, actorId: string, count: number): number => {
  let locked = 0;
  for (const roll of combat.diceRolls) {
    if (locked >= count) {
      break;
    }
    if (roll.ownerId !== actorId || roll.used || roll.locked) {
      continue;
    }
    roll.locked = true;
    locked += 1;
  }
  return locked;
};

const swapRows = (a: CombatantState, b: CombatantState): void => {
  const temp = a.row;
  a.row = b.row;
  b.row = temp;
};

const pullEnemyToFront = (combat: CombatState, target: CombatantState): string | null => {
  if (!target.alive || target.row === 'front') {
    return null;
  }

  const enemies = combat.enemies.filter((entry) => entry.alive);
  const front = enemies.filter((entry) => entry.row === 'front');
  target.row = 'front';

  if (front.length >= 2) {
    const pushed = front.find((entry) => entry.id !== target.id);
    if (pushed) {
      pushed.row = 'back';
      return `${target.name} foi puxado para Frente.`;
    }
  }

  return `${target.name} foi puxado para Frente.`;
};

const suppressEnemySpecialIntent = (combat: CombatState, targetEnemyId: string, value: number): string | null => {
  const intent = combat.intents.find((entry) => entry.enemyId === targetEnemyId);
  if (!intent) {
    return null;
  }

  if (intent.kind !== 'attack' || intent.isSpecial) {
    intent.kind = 'attack';
    intent.isSpecial = false;
    intent.label = 'Ataque basico';
    intent.value = Math.max(1, intent.value - value);
    intent.range = 'melee';
    intent.target = 'front';
    intent.aoe = 'single';
    intent.statusId = undefined;
    intent.statusStacks = undefined;
    intent.summonEnemyId = undefined;
    return 'Acao especial inimiga suprimida para ataque basico.';
  }

  return null;
};

const applyPostCombatReward = (
  combat: CombatState,
  effect: Extract<FaceEffectDef, { type: 'post_combat' }>,
): void => {
  combat.postCombatRewards[effect.resource] += effect.value;
  if (effect.threatDelta) {
    combat.postCombatRewards.threat += effect.threatDelta;
  }
};

export interface ActionResolutionResult {
  ok: boolean;
  log: string;
  events: CombatFxEvent[];
}

const canResolveRollTargetWithoutMutating = (
  combat: CombatState,
  roll: RolledDie,
  actorTeam: 'party' | 'enemy',
  targetTeam: 'party' | 'enemy',
  targetId: string,
): boolean => {
  const actor = findCombatant(combat, actorTeam, roll.ownerId);
  const target = findCombatant(combat, targetTeam, targetId);
  if (!actor || !target || !actor.alive || !target.alive) {
    return false;
  }

  const face = roll.face;
  if (face.kind === 'empty') {
    return false;
  }

  if (face.condition?.requiresTag && !actor.tags.includes(face.condition.requiresTag)) {
    return false;
  }
  if (face.condition?.requiresMarked && (target.statuses.mark ?? 0) <= 0) {
    return false;
  }
  if (face.condition?.requiresTargetFront && target.row !== 'front') {
    return false;
  }

  if (face.target === 'self' && actor.id !== target.id) {
    return false;
  }
  if (face.target === 'ally' && actorTeam !== targetTeam) {
    return false;
  }
  if (face.target === 'enemy' && actorTeam === targetTeam) {
    return false;
  }

  for (const effect of face.effects) {
    if (effect.type !== 'damage') {
      continue;
    }

    const targets = resolveTargetsForEffect(
      combat,
      actor,
      actorTeam,
      targetTeam,
      target,
      effect.target,
    );
    const range = effect.range ?? 'melee';
    const opponentTeam = enemyTeamFor(actorTeam);

    for (const current of targets) {
      if (!canHitTargetWithRange(combat, actorTeam, opponentTeam, current, range)) {
        return false;
      }
    }
  }

  return true;
};

export const canUsePlayerDieOnTarget = (
  combat: CombatState,
  rollId: string,
  targetTeam: 'party' | 'enemy',
  targetId: string,
): boolean => {
  const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
  if (!roll || roll.used || roll.locked) {
    return false;
  }
  return canResolveRollTargetWithoutMutating(combat, roll, 'party', targetTeam, targetId);
};

export const resolveRolledDieAction = (
  combat: CombatState,
  roll: RolledDie,
  actorTeam: 'party' | 'enemy',
  targetTeam: 'party' | 'enemy',
  targetId: string,
): ActionResolutionResult => {
  const actor = findCombatant(combat, actorTeam, roll.ownerId);
  const target = findCombatant(combat, targetTeam, targetId);
  const events: CombatFxEvent[] = [];

  if (!actor || !target || !actor.alive || !target.alive) {
    return { ok: false, log: 'Alvo invalido para a acao.', events };
  }

  const face: DiceFaceDef = roll.face;

  if (face.kind === 'empty') {
    return {
      ok: true,
      log: `${actor.name} rolou lado vazio.`,
      events,
    };
  }

  if (face.condition?.requiresTag && !actor.tags.includes(face.condition.requiresTag)) {
    return { ok: false, log: 'Condicao de tag nao atendida.', events };
  }

  if (face.condition?.requiresMarked && (target.statuses.mark ?? 0) <= 0) {
    return { ok: false, log: 'Essa acao exige alvo marcado.', events };
  }

  if (face.condition?.requiresTargetFront && target.row !== 'front') {
    return { ok: false, log: 'Essa acao exige alvo na Frente.', events };
  }

  if (face.target === 'self' && actor.id !== target.id) {
    return { ok: false, log: 'Essa face so pode mirar em si mesmo.', events };
  }

  if (face.target === 'ally' && actorTeam !== targetTeam) {
    return { ok: false, log: 'Essa face exige um aliado.', events };
  }

  if (face.target === 'enemy' && actorTeam === targetTeam) {
    return { ok: false, log: 'Essa face exige um inimigo.', events };
  }

  const logs: string[] = [];
  const consumedCharged = { value: false };

  for (const effect of face.effects) {
    if (effect.type === 'damage') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );

      for (const current of targets) {
        const range = effect.range ?? 'melee';
        if (!canHitTargetWithRange(combat, actorTeam, enemyTeamFor(actorTeam), current, range)) {
          return {
            ok: false,
            log: 'Ataque corpo-a-corpo nao alcanca alvo na Tras com Frente ocupada.',
            events,
          };
        }

        if (effect.requiresMarked && (current.statuses.mark ?? 0) <= 0) {
          continue;
        }

        const targetWasAlive = current.alive;
        const bonus = applyHunterMarkedBonus(actor, current);
        const value = focusFromNumeric(actor, effect.value, consumedCharged) + bonus;
        const damageResult = applyDamageToTarget(current, value, {
          consumeMark: effect.consumeMark ?? true,
          allowDodge: true,
        });

        if (damageResult.dodged) {
          logs.push(`${current.name} esquivou o golpe.`);
        } else {
          logs.push(`${actor.name} causou ${damageResult.dealt} em ${current.name}.`);
          events.push({
            type: 'hit',
            targetId: current.id,
            amount: Math.max(1, damageResult.dealt + damageResult.absorbed),
            sourceId: actor.id,
          });
          pushIdleDisabledIfDead(current, targetWasAlive, events);
        }

        if (effect.applyStatusId && (effect.applyStatusStacks ?? 0) > 0) {
          addStatus(current, effect.applyStatusId, effect.applyStatusStacks ?? 0);
          logs.push(`${current.name} recebeu ${effect.applyStatusId} ${effect.applyStatusStacks}.`);
          events.push({
            type: 'status',
            targetId: current.id,
            statusId: effect.applyStatusId,
            stacks: effect.applyStatusStacks ?? 0,
          });
        }
      }
      continue;
    }

    if (effect.type === 'block') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );
      const value = focusFromNumeric(actor, effect.value, consumedCharged);
      for (const current of targets) {
        current.armor += value;
        logs.push(`${current.name} ganhou BLK ${value}.`);
        events.push({
          type: 'status',
          targetId: current.id,
          statusId: 'block',
          stacks: value,
        });
      }
      continue;
    }

    if (effect.type === 'heal') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );
      const value = focusFromNumeric(actor, effect.value, consumedCharged);
      for (const current of targets) {
        const healed = applyHealingToTarget(current, value);
        if (effect.removeBleed && (current.statuses.bleed ?? 0) > 0) {
          current.statuses.bleed -= 1;
        }
        logs.push(`${current.name} curou ${healed}.`);
        if (healed > 0) {
          events.push({
            type: 'heal',
            targetId: current.id,
            amount: healed,
            sourceId: actor.id,
          });
        }
      }
      continue;
    }

    if (effect.type === 'status') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );
      const value = focusFromNumeric(actor, effect.value, consumedCharged);
      for (const current of targets) {
        addStatus(current, effect.statusId, value);
        logs.push(`${current.name} recebeu ${effect.statusId} ${value}.`);
        events.push({
          type: 'status',
          targetId: current.id,
          statusId: effect.statusId,
          stacks: value,
        });

        if (effect.statusId === 'mark') {
          const passiveLog = applyOcultistaMarkPassive(actor);
          if (passiveLog) {
            logs.push(passiveLog);
            events.push({
              type: 'status',
              targetId: actor.id,
              statusId: 'block',
              stacks: 1,
            });
          }
        }
      }
      continue;
    }

    if (effect.type === 'cleanse') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );
      const amount = focusFromNumeric(actor, effect.value, consumedCharged);
      for (const current of targets) {
        let removed = 0;
        for (let i = 0; i < amount; i += 1) {
          const cleaned = cleanOneNegativeStatus(current);
          if (!cleaned) {
            break;
          }
          removed += 1;
        }
        logs.push(`${current.name} removeu ${removed} status negativo(s).`);
      }
      continue;
    }

    if (effect.type === 'shred_armor') {
      const targets = resolveTargetsForEffect(
        combat,
        actor,
        actorTeam,
        targetTeam,
        target,
        effect.target,
      );
      const value = focusFromNumeric(actor, effect.value, consumedCharged);
      for (const current of targets) {
        const removed = Math.min(current.armor, value);
        current.armor -= removed;
        logs.push(`${current.name} perdeu BLK ${removed}.`);
        if (removed > 0) {
          events.push({
            type: 'status',
            targetId: current.id,
            statusId: 'block',
            stacks: -removed,
          });
        }
      }
      continue;
    }

    if (effect.type === 'swap') {
      if (targetTeam !== actorTeam || actor.id === target.id) {
        return { ok: false, log: 'SWAP exige aliado alvo.', events };
      }
      swapRows(actor, target);
      logs.push(`${actor.name} trocou de linha com ${target.name}.`);
      events.push({ type: 'swap', aId: actor.id, bId: target.id });
      const passiveLog = applyAviadoraSwapPassive(combat, actor);
      if (passiveLog) {
        logs.push(passiveLog);
        events.push({
          type: 'status',
          targetId: actor.id,
          statusId: 'dodge',
          stacks: 1,
        });
      }
      continue;
    }

    if (effect.type === 'focus') {
      const amount = focusFromNumeric(actor, effect.value, consumedCharged);
      combat.focus += amount;
      logs.push(`FOCO +${amount}.`);
      events.push({
        type: 'focus',
        ownerId: actor.id,
        delta: amount,
      });
      continue;
    }

    if (effect.type === 'lock_die') {
      const amount = focusFromNumeric(actor, effect.value, consumedCharged);
      const locked = lockDiceForActor(combat, actor.id, amount);
      logs.push(`${actor.name} travou ${locked} dado(s).`);
      continue;
    }

    if (effect.type === 'pull_front') {
      if (targetTeam !== enemyTeamFor(actorTeam)) {
        return { ok: false, log: 'Puxao exige alvo inimigo.', events };
      }
      const pullLog = pullEnemyToFront(combat, target);
      if (pullLog) {
        logs.push(pullLog);
      }
      continue;
    }

    if (effect.type === 'suppress_special') {
      const suppressLog = suppressEnemySpecialIntent(combat, target.id, effect.value);
      if (suppressLog) {
        logs.push(suppressLog);
      }
      continue;
    }

    if (effect.type === 'post_combat') {
      applyPostCombatReward(combat, effect);
      logs.push(`Recompensa pos-combate: ${effect.resource} +${effect.value}.`);
      continue;
    }

    if (effect.type === 'turret') {
      const value = focusFromNumeric(actor, effect.value, consumedCharged);
      addStatus(actor, 'turret', value);
      logs.push(`${actor.name} ativou TORRETA ${value}.`);
      events.push({
        type: 'status',
        targetId: actor.id,
        statusId: 'turret',
        stacks: value,
      });
      continue;
    }
  }

  return { ok: true, log: logs.join(' ') || `${actor.name} executou a acao.`, events };
};

export const consumeStunAtTurnStart = (combatant: CombatantState): boolean => {
  if ((combatant.statuses.stun ?? 0) <= 0) {
    return false;
  }
  combatant.statuses.stun -= 1;
  return true;
};

export const resolveTurretTicks = (
  combat: CombatState,
): { logs: string[]; events: CombatFxEvent[] } => {
  const logs: string[] = [];
  const events: CombatFxEvent[] = [];
  const aliveEnemies = aliveTeam(combat, 'enemy');
  if (aliveEnemies.length === 0) {
    return { logs, events };
  }

  for (const member of combat.party) {
    if (!member.alive) {
      continue;
    }

    const turretStacks = member.statuses.turret ?? 0;
    if (turretStacks <= 0) {
      continue;
    }

    const index = deterministicIndex(`${member.id}:${combat.turn}`, aliveEnemies.length);
    const target = aliveEnemies[index] as CombatantState;
    const targetWasAlive = target.alive;
    const damage = applyDamageToTarget(target, 1, { consumeMark: true, allowDodge: true });
    member.statuses.turret = Math.max(0, turretStacks - 1);

    if (damage.dodged) {
      logs.push(`Torreta de ${member.name} errou: ${target.name} esquivou.`);
    } else {
      logs.push(`Torreta de ${member.name} causou ${damage.dealt} em ${target.name}.`);
      events.push({
        type: 'hit',
        targetId: target.id,
        amount: Math.max(1, damage.dealt + damage.absorbed),
        sourceId: member.id,
      });
      pushIdleDisabledIfDead(target, targetWasAlive, events);
    }
  }

  return { logs, events };
};

export const applyEndTurnStatusEffects = (
  combatant: CombatantState,
): { logs: string[]; events: CombatFxEvent[] } => {
  if (!combatant.alive) {
    return { logs: [], events: [] };
  }

  const logs: string[] = [];
  const events: CombatFxEvent[] = [];

  const poison = combatant.statuses.poison ?? 0;
  const bleed = combatant.statuses.bleed ?? 0;
  const incoming = poison + bleed;

  if (incoming > 0) {
    const wasAlive = combatant.alive;
    const dealt = applyDamageToTarget(combatant, incoming, {
      consumeMark: false,
      allowDodge: false,
    });
    logs.push(`${combatant.name} sofre ${dealt.dealt} por VENENO/SANGRAMENTO.`);
    events.push({
      type: 'hit',
      targetId: combatant.id,
      amount: Math.max(1, dealt.dealt + dealt.absorbed),
    });
    pushIdleDisabledIfDead(combatant, wasAlive, events);
  }

  if (poison > 0) {
    combatant.statuses.poison -= 1;
  }

  if ((combatant.statuses.fear ?? 0) > 0) {
    combatant.statuses.fear -= 1;
  }

  if ((combatant.statuses.inspired ?? 0) > 0) {
    combatant.statuses.inspired -= 1;
  }

  return { logs, events };
};

export const resolveEnemyAttackTargets = (
  combat: CombatState,
  intent: CombatIntent,
): CombatantState[] => {
  const partyAlive = combat.party.filter((entry) => entry.alive);
  if (partyAlive.length === 0) {
    return [];
  }

  if (intent.intentId === 'lamina_cerimonial') {
    const marked = partyAlive.filter((entry) => (entry.statuses.mark ?? 0) > 0);
    if (marked.length > 0) {
      return [marked[0] as CombatantState];
    }
    const randomIndex = deterministicIndex(`${combat.turn}:${intent.enemyId}`, partyAlive.length);
    return [partyAlive[randomIndex] as CombatantState];
  }

  if (intent.intentId === 'recarga_veneno') {
    let target = partyAlive[0] as CombatantState;
    for (const member of partyAlive) {
      if (member.hp > target.hp) {
        target = member;
      }
    }
    return [target];
  }

  const front = partyAlive.filter((entry) => entry.row === 'front');
  const back = partyAlive.filter((entry) => entry.row === 'back');

  const selectByPreferredRow = (
    preferred: 'front' | 'back',
  ): CombatantState[] => {
    if (preferred === 'front') {
      return front.length > 0 ? front : (back.length > 0 ? back : partyAlive);
    }
    return back.length > 0 ? back : (front.length > 0 ? front : partyAlive);
  };

  const baseTargets = (() => {
    if (intent.target === 'front') {
      return front.length > 0 ? front : partyAlive;
    }
    if (intent.target === 'back') {
      return back.length > 0 ? back : partyAlive;
    }
    if (intent.target === 'any') {
      const preferredRow = intent.range === 'ranged' ? 'back' : 'front';
      return selectByPreferredRow(preferredRow);
    }
    return partyAlive;
  })();

  if (intent.range === 'melee' && front.length > 0) {
    const meleeBase = baseTargets.filter((entry) => entry.row === 'front');
    if (meleeBase.length > 0) {
      if (intent.aoe === 'front_all' || intent.aoe === 'all') {
        return front;
      }
      return [meleeBase[0] as CombatantState];
    }
    return [front[0] as CombatantState];
  }

  if (intent.aoe === 'all') {
    return partyAlive;
  }

  if (intent.aoe === 'front_all') {
    return front.length > 0 ? front : partyAlive;
  }

  if (intent.aoe === 'back_all') {
    return back.length > 0 ? back : partyAlive;
  }

  return [baseTargets[0] as CombatantState];
};

export const applyEnemyIntent = (
  combat: CombatState,
  enemy: CombatantState,
  intent: CombatIntent,
): { logs: string[]; events: CombatFxEvent[] } => {
  const logs: string[] = [];
  const events: CombatFxEvent[] = [];

  if (intent.kind === 'defend') {
    enemy.armor += intent.value;
    events.push({
      type: 'status',
      targetId: enemy.id,
      statusId: 'block',
      stacks: intent.value,
    });
    if (intent.grantStatusId && (intent.grantStatusStacks ?? 0) > 0) {
      addStatus(enemy, intent.grantStatusId, intent.grantStatusStacks ?? 0);
      events.push({
        type: 'status',
        targetId: enemy.id,
        statusId: intent.grantStatusId,
        stacks: intent.grantStatusStacks ?? 0,
      });
    }
    logs.push(`${enemy.name} reforcou defesa (${intent.value}).`);
    return { logs, events };
  }

  if (intent.kind === 'heal') {
    const healed = applyHealingToTarget(enemy, intent.value);
    logs.push(`${enemy.name} recuperou ${healed} HP.`);
    if (healed > 0) {
      events.push({
        type: 'heal',
        targetId: enemy.id,
        amount: healed,
        sourceId: enemy.id,
      });
    }
    return { logs, events };
  }

  if (intent.kind === 'status' && intent.statusId) {
    const targets = resolveEnemyAttackTargets(combat, {
      ...intent,
      kind: 'attack',
      aoe: intent.aoe,
    });
    for (const target of targets) {
      addStatus(target, intent.statusId, intent.statusStacks ?? 1);
      logs.push(`${enemy.name} aplicou ${intent.statusId} ${intent.statusStacks ?? 1} em ${target.name}.`);
      events.push({
        type: 'status',
        targetId: target.id,
        statusId: intent.statusId,
        stacks: intent.statusStacks ?? 1,
      });
    }
    return { logs, events };
  }

  if (intent.kind === 'special') {
    if (intent.grantStatusId && (intent.grantStatusStacks ?? 0) > 0) {
      addStatus(enemy, intent.grantStatusId, intent.grantStatusStacks ?? 0);
      logs.push(`${enemy.name} ganhou ${intent.grantStatusId} ${intent.grantStatusStacks}.`);
      events.push({
        type: 'status',
        targetId: enemy.id,
        statusId: intent.grantStatusId,
        stacks: intent.grantStatusStacks ?? 0,
      });
    }

    if (intent.summonEnemyId) {
      logs.push(`${enemy.name} chamou reforco (${intent.summonEnemyId}).`);
    }

    if (intent.value > 0) {
      const targets = resolveEnemyAttackTargets(combat, {
        ...intent,
        kind: 'attack',
      });
      for (const target of targets) {
        const targetWasAlive = target.alive;
        const damage = applyDamageToTarget(target, intent.value, {
          consumeMark: true,
          allowDodge: true,
        });
        if (damage.dodged) {
          logs.push(`${target.name} esquivou do especial.`);
        } else {
          logs.push(`${enemy.name} acertou ${target.name} por ${damage.dealt}.`);
          const impactAmount = damage.dealt + damage.absorbed;
          if (impactAmount > 0) {
            events.push({
              type: 'hit',
              targetId: target.id,
              amount: impactAmount,
              sourceId: enemy.id,
            });
          }
          pushIdleDisabledIfDead(target, targetWasAlive, events);
        }
        if (intent.onHitStatusId && (intent.onHitStatusStacks ?? 0) > 0) {
          addStatus(target, intent.onHitStatusId, intent.onHitStatusStacks ?? 0);
          logs.push(`${target.name} recebeu ${intent.onHitStatusId} ${intent.onHitStatusStacks}.`);
          events.push({
            type: 'status',
            targetId: target.id,
            statusId: intent.onHitStatusId,
            stacks: intent.onHitStatusStacks ?? 0,
          });
        }
      }
    }

    return { logs, events };
  }

  if (intent.grantStatusId && (intent.grantStatusStacks ?? 0) > 0) {
    addStatus(enemy, intent.grantStatusId, intent.grantStatusStacks ?? 0);
    logs.push(`${enemy.name} ganhou ${intent.grantStatusId} ${intent.grantStatusStacks}.`);
    events.push({
      type: 'status',
      targetId: enemy.id,
      statusId: intent.grantStatusId,
      stacks: intent.grantStatusStacks ?? 0,
    });
  }

  const targets = resolveEnemyAttackTargets(combat, intent);
  for (const target of targets) {
    const isRecarga = intent.intentId === 'recarga_veneno';
    const targetWasAlive = target.alive;
    const damage = applyDamageToTarget(target, intent.value, {
      consumeMark: !isRecarga,
      allowDodge: true,
    });

    if (damage.dodged) {
      logs.push(`${target.name} esquivou do ataque de ${enemy.name}.`);
      continue;
    }

    if (isRecarga && intent.value <= 0) {
      logs.push(`${enemy.name} espalhou veneno em ${target.name}.`);
    } else {
      logs.push(`${enemy.name} atacou ${target.name} por ${damage.dealt}.`);
    }
    const impactAmount = damage.dealt + damage.absorbed;
    if (impactAmount > 0) {
      events.push({
        type: 'hit',
        targetId: target.id,
        amount: impactAmount,
        sourceId: enemy.id,
      });
    }
    pushIdleDisabledIfDead(target, targetWasAlive, events);
    if (intent.onHitStatusId && (intent.onHitStatusStacks ?? 0) > 0) {
      addStatus(target, intent.onHitStatusId, intent.onHitStatusStacks ?? 0);
      logs.push(`${target.name} recebeu ${intent.onHitStatusId} ${intent.onHitStatusStacks}.`);
      events.push({
        type: 'status',
        targetId: target.id,
        statusId: intent.onHitStatusId,
        stacks: intent.onHitStatusStacks ?? 0,
      });
    }
  }

  return { logs, events };
};
