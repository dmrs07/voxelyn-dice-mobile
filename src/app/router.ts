import { makeSeed, SeededRng } from '../core/rng';
import { setPhase, withMessage } from '../core/state-machine';
import { createVoxelynAnimationDriver, type AnimationDriver } from '../anim/voxelyn-animation-adapter';
import {
  createCombatState,
  discardDieForGuard,
  nextCombatTurn,
  rollCombatDice,
  rerollOneDieWithFocus,
  syncCombatToRun,
  usePlayerDie,
} from '../domain/combat/combat-reducer';
import { canUsePlayerDieOnTarget } from '../domain/combat/action-resolver';
import {
  pickEventForRun,
  resolveEventChoice as resolveEventChoiceRoll,
} from '../domain/expedition/event-runner';
import { generateExpeditionMap } from '../domain/expedition/map-generator';
import {
  applyRestNode,
  applyRunResourceDelta,
  applyTravelCost,
} from '../domain/expedition/resource-system';
import { clearProfile, saveProfile } from '../domain/meta/profile-store';
import {
  createDefaultProfile,
  markEnemiesSeen,
  markEventSeen,
  registerRunResult,
  sanitizeProfileForContent,
} from '../domain/meta/unlocks';
import type {
  CombatFxEvent,
  DieSource,
  EventDef,
  GameState,
  PartySelectionItem,
  RewardOption,
  RunState,
  StatusId,
} from '../domain/shared/types';
import { triggerLightHaptic } from '../platform/capacitor/haptics';
import { getBiomeTheme } from '../render/pixel/asset-loader';
import { CombatFxController } from '../render/ui/combat-fx-controller';
import { renderCombatScreen } from '../screens/combat-screen';
import { renderEventScreen } from '../screens/event-screen';
import { renderMapScreen } from '../screens/map-screen';
import { renderMetaScreen } from '../screens/meta-screen';
import { renderRewardScreen } from '../screens/reward-screen';
import { renderRunEndScreen } from '../screens/run-end-screen';

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const formatMessage = (parts: string[]): string => parts.filter(Boolean).join(' ');

const START_HIRING_GOLD = 7;
const hireCostForClass = (classId: string, state: GameState): number =>
  Math.max(0, state.content.byId.classes[classId]?.hireCost ?? 2);

export class GameRouter {
  private state: GameState;

  private readonly root: HTMLElement;

  private runRng: SeededRng = new SeededRng(makeSeed());

  private draftSeed: number = makeSeed();

  private draftParty: PartySelectionItem[];

  private selectedDraftSlot = 0;

  private metaFaceTooltipKey: string | null = null;

  private selectedRollId: string | null = null;

  private combatFaceTooltipRollId: string | null = null;

  private combatFaceTooltipPosition: { x: number; y: number } | null = null;

  private selectedTargetId: string | null = null;

  private combatLogCollapsed = true;

  private readonly animationDriver: AnimationDriver;

  private readonly combatFxController: CombatFxController;

  private rafHandle: number | null = null;

  private lastFrameAt: number | null = null;

  public constructor(root: HTMLElement, initialState: GameState) {
    this.root = root;
    this.state = initialState;
    this.animationDriver = createVoxelynAnimationDriver();
    this.combatFxController = new CombatFxController(this.animationDriver);
    this.combatFxController.setDiceDefinitions(initialState.content.byId.dice);
    this.startAnimationLoop();

    const defaultClass = this.state.profile.unlocks.classes[0] ?? this.state.content.classes[0]?.id;
    const defaultBackground =
      this.state.profile.unlocks.backgrounds[0] ?? this.state.content.backgrounds[0]?.id;

    const secondClass =
      this.state.profile.unlocks.classes.find((entry) => entry !== defaultClass) ??
      this.state.content.classes.find((entry) => entry.id !== defaultClass)?.id ??
      defaultClass;

    this.draftParty =
      defaultClass && defaultBackground
        ? [
            { classId: defaultClass, backgroundId: defaultBackground, row: 'front' },
            { classId: secondClass ?? defaultClass, backgroundId: defaultBackground, row: 'back' },
          ]
        : [];

    this.draftParty = this.ensureDraftValidity(this.draftParty);
    this.selectedDraftSlot = clamp(this.selectedDraftSlot, 0, this.draftParty.length - 1);
  }

  public render(): void {
    this.applyBiomeTheme();
    document.body.dataset.phase = this.state.phase;
    const message = this.state.message;

    if (this.state.phase === 'meta') {
      const sanitizedDraft = this.ensureDraftValidity(this.draftParty);
      if (sanitizedDraft.length !== this.draftParty.length) {
        this.draftParty = sanitizedDraft;
      }
      const hiringSpent = this.calculateHiringSpent(this.draftParty);
      const hiringRemaining = Math.max(0, START_HIRING_GOLD - hiringSpent);

      renderMetaScreen(
        this.root,
        {
          content: this.state.content,
          profile: this.state.profile,
          draftParty: this.draftParty,
          selectedSlotIndex: this.selectedDraftSlot,
          openFaceTooltipKey: this.metaFaceTooltipKey,
          seed: this.draftSeed,
          hiringBudget: START_HIRING_GOLD,
          hiringSpent,
          hiringRemaining,
          message,
        },
        {
          onStartRun: (seed) => {
            this.startRun(seed);
          },
          onSetSeed: (seed) => {
            this.draftSeed = seed;
            this.render();
          },
          onDraftPartyChange: (party) => {
            const sanitized = this.ensureDraftValidity(party);
            const hadDuplicateClass = new Set(party.map((entry) => entry.classId)).size !== party.length;
            this.draftParty = sanitized;
            this.selectedDraftSlot = clamp(this.selectedDraftSlot, 0, this.draftParty.length - 1);
            this.metaFaceTooltipKey = null;
            this.state = withMessage(
              this.state,
              hadDuplicateClass
                ? 'Classe duplicada removida do roster.'
                : 'Draft atualizado.',
            );
            this.render();
          },
          onSelectSlot: (slotIndex) => {
            this.selectedDraftSlot = clamp(slotIndex, 0, this.draftParty.length - 1);
            this.metaFaceTooltipKey = null;
            this.render();
          },
          onToggleFaceTooltip: (faceKey) => {
            this.metaFaceTooltipKey = faceKey;
            this.render();
          },
          onResetProfile: () => {
            void this.resetProfile();
          },
        },
      );
      return;
    }

    if (this.state.phase === 'map' && this.state.run) {
      renderMapScreen(
        this.root,
        {
          run: this.state.run,
          content: this.state.content,
          message,
        },
        {
          onChooseNode: (nodeId) => this.chooseMapNode(nodeId),
          onAbandonRun: () => this.finishRun(false, 'Run encerrada manualmente.'),
        },
      );
      return;
    }

    if (this.state.phase === 'event' && this.state.run && this.state.activeEvent) {
      const event = this.state.content.byId.events[this.state.activeEvent.eventId];
      if (event) {
        renderEventScreen(
          this.root,
          {
            run: this.state.run,
            event,
            activeEvent: this.state.activeEvent,
            message,
          },
          {
            onChooseChoice: (choiceId, characterId, dieSource) =>
              this.resolveEventChoice(choiceId, event, characterId, dieSource),
            onSetTester: (characterId, dieSource) => this.setEventTester(characterId, dieSource),
            onContinue: () => this.returnFromEvent(),
          },
        );
        return;
      }
    }

    if (this.state.phase === 'combat' && this.state.combat) {
      const dieLabels = Object.fromEntries(
        Object.entries(this.state.content.byId.dice).map(([dieId, die]) => [dieId, die.label]),
      );
      const validTargetIds = this.buildValidTargetIds(this.state.combat, this.selectedRollId);

      renderCombatScreen(
        this.root,
        {
          combat: this.state.combat,
          message,
          selectedRollId: this.selectedRollId,
          openFaceTooltipRollId: this.combatFaceTooltipRollId,
          trayTooltipPosition: this.combatFaceTooltipPosition,
          combatLogCollapsed: this.combatLogCollapsed,
          validTargetIds,
          selectedTargetId: this.selectedTargetId,
          biomeId: this.state.run?.map.biomeId ?? this.state.content.biome.id,
          phaseBucket: this.combatPhaseBucket(this.state.combat.turn),
          dieLabels,
          trayDiagnostics: this.combatFxController.getDiceTrayDiagnostics(),
          showDevTrayDebug: Boolean(import.meta.env?.DEV),
        },
        {
          onSelectDie: (rollId) => {
            const combat = this.state.combat;
            if (!combat || !rollId) {
              this.clearCombatSelection(true);
              return;
            }
            const roll = combat.diceRolls.find(
              (entry) => entry.rollId === rollId && !entry.used && !entry.locked,
            );
            if (!roll) {
              return;
            }
            if (this.selectedRollId === rollId) {
              if (roll.face.kind === 'empty') {
                this.selectedRollId = null;
                this.selectedTargetId = null;
                this.combatFaceTooltipRollId = null;
                this.combatFaceTooltipPosition = null;
                this.useEmptyDie(rollId);
                return;
              }
              this.clearCombatSelection(true);
              return;
            }
            this.selectedRollId = rollId;
            this.selectedTargetId = null;
            this.combatFaceTooltipRollId = null;
            this.combatFaceTooltipPosition = null;
          },
          onClearSelection: () => this.clearCombatSelection(true),
          onTapTarget: (team, targetId) => {
            if (!this.selectedRollId) {
              return;
            }
            const combat = this.state.combat;
            if (!combat) {
              return;
            }
            const rollId = this.selectedRollId;
            const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
            if (!roll || roll.used || roll.locked) {
              this.clearCombatSelection(true);
              return;
            }
            if (roll.face.kind === 'empty') {
              this.selectedRollId = null;
              this.selectedTargetId = null;
              this.combatFaceTooltipRollId = null;
              this.combatFaceTooltipPosition = null;
              this.useEmptyDie(rollId);
              return;
            }
            if (!canUsePlayerDieOnTarget(combat, rollId, team, targetId)) {
              this.state = withMessage(this.state, 'Alvo invalido para este dado.');
              this.render();
              return;
            }
            this.selectedRollId = null;
            this.selectedTargetId = targetId;
            this.combatFaceTooltipRollId = null;
            this.combatFaceTooltipPosition = null;
            this.applyDieToTarget(rollId, team, targetId);
          },
          onDiscardSelectedDie: () => {
            if (!this.selectedRollId) {
              return;
            }
            const rollId = this.selectedRollId;
            this.selectedRollId = null;
            this.selectedTargetId = null;
            this.combatFaceTooltipRollId = null;
            this.combatFaceTooltipPosition = null;
            this.discardDie(rollId);
          },
          onUseEmptySelectedDie: () => {
            const combat = this.state.combat;
            if (!combat || !this.selectedRollId) {
              return;
            }
            const roll = combat.diceRolls.find((entry) => entry.rollId === this.selectedRollId);
            if (!roll || roll.face.kind !== 'empty') {
              this.state = withMessage(this.state, 'Selecione um lado vazio para usar.');
              this.render();
              return;
            }
            const rollId = this.selectedRollId;
            this.selectedRollId = null;
            this.selectedTargetId = null;
            this.combatFaceTooltipRollId = null;
            this.combatFaceTooltipPosition = null;
            this.useEmptyDie(rollId);
          },
          onReroll: () => this.rerollDice(),
          onRoll: () => this.rollCurrentTurnDice(),
          onEndTurn: () => this.handleEndTurnAction(),
          onToggleFaceTooltip: (rollId, position) => {
            const nextPosition = rollId ? (position ?? this.combatFaceTooltipPosition) : null;
            const sameRoll = this.combatFaceTooltipRollId === rollId;
            const samePosition =
              (this.combatFaceTooltipPosition?.x ?? -1) === (nextPosition?.x ?? -1) &&
              (this.combatFaceTooltipPosition?.y ?? -1) === (nextPosition?.y ?? -1);
            if (sameRoll && samePosition) {
              return;
            }
            this.combatFaceTooltipRollId = rollId;
            this.combatFaceTooltipPosition = nextPosition;
            this.render();
          },
          onToggleCombatLog: () => {
            this.combatLogCollapsed = !this.combatLogCollapsed;
            this.render();
          },
        },
      );
      this.combatFxController.attach(this.root);
      this.combatFxController.setDiceDefinitions(this.state.content.byId.dice);
      this.combatFxController.syncCombatants(this.state.combat);
      this.combatFxController.setDiceTrayQualityPreset('performance');
      this.combatFxController.syncUiSelection(this.selectedRollId);
      return;
    }

    if (this.state.phase === 'reward' && this.state.run && this.state.rewardSource) {
      renderRewardScreen(
        this.root,
        {
          run: this.state.run,
          options: this.state.rewardOptions,
          source: this.state.rewardSource,
          message,
        },
        {
          onChooseReward: (rewardId) => this.pickReward(rewardId),
          onSkip: () => this.skipReward(),
        },
      );
      return;
    }

    if (this.state.phase === 'run_end' && this.state.run) {
      renderRunEndScreen(
        this.root,
        {
          run: this.state.run,
          profile: this.state.profile,
          message,
        },
        {
          onReturnMeta: () => {
            this.state = {
              ...this.state,
              phase: 'meta',
              run: null,
              combat: null,
              activeEvent: null,
              rewardOptions: [],
              rewardSource: null,
              message: 'Meta pronto para nova run.',
            };
            this.selectedRollId = null;
            this.combatFaceTooltipRollId = null;
            this.combatFaceTooltipPosition = null;
            this.selectedTargetId = null;
            this.combatLogCollapsed = true;
            this.metaFaceTooltipKey = null;
            this.selectedDraftSlot = clamp(this.selectedDraftSlot, 0, Math.max(0, this.draftParty.length - 1));
            this.render();
          },
        },
      );
      return;
    }

    this.root.innerHTML = '<main class="screen"><p>Estado invalido do app.</p></main>';
  }

  private applyBiomeTheme(): void {
    const biomeId = this.state.run?.map.biomeId ?? this.state.content.biome.id;
    const theme = getBiomeTheme(biomeId);
    if (!theme || theme.palette.length < 6) {
      return;
    }

    const rootStyle = this.root.style;
    rootStyle.setProperty('--ink-0', theme.palette[0] ?? '#0a1020');
    rootStyle.setProperty('--ink-1', theme.palette[1] ?? '#111a2e');
    rootStyle.setProperty('--accent-1', theme.palette[3] ?? '#7ea650');
    rootStyle.setProperty('--accent-0', theme.palette[4] ?? '#d38a2c');
    rootStyle.setProperty('--paper-0', theme.palette[5] ?? '#efe2bf');
  }

  private startAnimationLoop(): void {
    const frame = (now: number): void => {
      if (this.lastFrameAt === null) {
        this.lastFrameAt = now;
      }
      const dtMs = Math.max(0, Math.min(80, now - this.lastFrameAt));
      this.lastFrameAt = now;

      this.animationDriver.update(dtMs);
      this.combatFxController.tick(dtMs);

      this.rafHandle = requestAnimationFrame(frame);
    };

    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(frame);
    }
  }

  private enqueueCombatFx(events: CombatFxEvent[]): void {
    if (events.length === 0) {
      return;
    }

    this.combatFxController.enqueue(events);

    if (events.some((entry) => entry.type === 'die_settle' || entry.type === 'hit')) {
      void triggerLightHaptic();
    }
  }

  private hasBackground(run: RunState, backgroundId: string): boolean {
    return run.party.some((member) => member.backgroundId === backgroundId);
  }

  private revealAhead(run: RunState, depth: number): void {
    if (depth <= 0) {
      return;
    }

    let frontier = [...run.availableNodeIds];
    const seen = new Set(frontier);

    for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const node = run.map.nodes[nodeId];
        if (!node) {
          continue;
        }

        node.revealed = true;
        for (const nextId of node.next) {
          if (!seen.has(nextId)) {
            seen.add(nextId);
            nextFrontier.push(nextId);
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  private applyPendingMapModifiers(run: RunState): void {
    if (run.pendingShopNodes > 0) {
      for (const nodeId of run.availableNodeIds) {
        if (run.pendingShopNodes <= 0) {
          break;
        }
        const node = run.map.nodes[nodeId];
        if (!node || node.type === 'boss' || node.type === 'start') {
          continue;
        }
        node.type = 'shop';
        node.title = 'Mercado Itinerante';
        node.subtitle = 'Oferta inesperada no caminho.';
        node.encounterIds = [];
        run.pendingShopNodes -= 1;
      }
    }

    if (run.pendingSkipDangerNodes > 0) {
      const extras: string[] = [];
      let charges = run.pendingSkipDangerNodes;

      for (const nodeId of run.availableNodeIds) {
        if (charges <= 0) {
          break;
        }
        const node = run.map.nodes[nodeId];
        if (!node || (node.type !== 'combat' && node.type !== 'elite')) {
          continue;
        }
        for (const nextId of node.next) {
          if (!run.availableNodeIds.includes(nextId) && !extras.includes(nextId)) {
            extras.push(nextId);
          }
        }
        charges -= 1;
      }

      if (extras.length > 0) {
        run.availableNodeIds = [...new Set([...run.availableNodeIds, ...extras])];
        run.runLog.unshift('Rota perigosa pode ser evitada por atalho.');
      }

      run.pendingSkipDangerNodes = charges;
    }
  }

  private ensureDraftValidity(party: PartySelectionItem[]): PartySelectionItem[] {
    const unlockedClasses = new Set(this.state.profile.unlocks.classes);
    const unlockedBackgrounds = new Set(this.state.profile.unlocks.backgrounds);

    const classFallback = this.state.profile.unlocks.classes[0] ?? this.state.content.classes[0]?.id;
    const backgroundFallback =
      this.state.profile.unlocks.backgrounds[0] ?? this.state.content.backgrounds[0]?.id;

    const next: PartySelectionItem[] = [];
    const usedClasses = new Set<string>();

    for (const raw of party.slice(0, 4)) {
      const classId =
        unlockedClasses.has(raw.classId) || !classFallback ? raw.classId : classFallback;
      const backgroundId =
        unlockedBackgrounds.has(raw.backgroundId) || !backgroundFallback
          ? raw.backgroundId
          : backgroundFallback;
      if (!classId || !backgroundId) {
        continue;
      }
      if (usedClasses.has(classId)) {
        continue;
      }
      usedClasses.add(classId);
      next.push({
        classId,
        backgroundId,
        row: raw.row === 'back' ? 'back' : 'front',
      });
    }

    if (next.length === 0 && classFallback && backgroundFallback) {
      next.push({ classId: classFallback, backgroundId: backgroundFallback, row: 'front' });
    }

    let frontCount = 0;
    let backCount = 0;
    for (const entry of next) {
      if (entry.row === 'front') {
        frontCount += 1;
      } else {
        backCount += 1;
      }

      if (frontCount > 2) {
        entry.row = 'back';
        frontCount -= 1;
        backCount += 1;
      }

      if (backCount > 2) {
        entry.row = 'front';
        backCount -= 1;
        frontCount += 1;
      }
    }

    return next;
  }

  private calculateHiringSpent(partyDraft: PartySelectionItem[]): number {
    let spent = 0;
    for (let i = 1; i < partyDraft.length; i += 1) {
      const entry = partyDraft[i] as PartySelectionItem;
      spent += hireCostForClass(entry.classId, this.state);
    }
    return Math.max(0, spent);
  }

  private startRun(seed: number): void {
    const sanitizedParty = this.ensureDraftValidity(this.draftParty);

    if (sanitizedParty.length < 1 || sanitizedParty.length > 4) {
      this.state = withMessage(this.state, 'A trip precisa ter entre 1 e 4 integrantes.');
      this.render();
      return;
    }

    const hiringSpent = this.calculateHiringSpent(sanitizedParty);
    if (hiringSpent > START_HIRING_GOLD) {
      this.state = withMessage(this.state, `Orcamento insuficiente para hiring (${hiringSpent}/${START_HIRING_GOLD}).`);
      this.render();
      return;
    }

    this.draftParty = sanitizedParty;
    this.selectedDraftSlot = Math.min(this.selectedDraftSlot, this.draftParty.length - 1);
    this.draftSeed = seed;
    this.runRng = new SeededRng(seed);

    const map = generateExpeditionMap(seed, this.state.content);
    const startNode = map.nodes[map.startNodeId];
    startNode.visited = true;
    startNode.revealed = true;

    const party = sanitizedParty.map((selection, index) => {
      const classDef = this.state.content.byId.classes[selection.classId];
      const backgroundDef = this.state.content.byId.backgrounds[selection.backgroundId];

      if (!classDef || !backgroundDef) {
        throw new Error('Draft invalido: classe ou background nao encontrado.');
      }

      const exCombatenteHpBonus = backgroundDef.id === 'ex_combatente' ? 1 : 0;

      return {
        id: `char_${index + 1}`,
        name: `${classDef.name} ${index + 1}`,
        visualKey: `party:${classDef.id}`,
        classId: classDef.id,
        backgroundId: backgroundDef.id,
        tags: [
          ...backgroundDef.tags.map((tag) => tag.toLowerCase()),
          classDef.id,
          backgroundDef.id,
        ],
        hp: classDef.maxHp + exCombatenteHpBonus,
        maxHp: classDef.maxHp + exCombatenteHpBonus,
        armor: 0,
        statuses: makeStatusRecord(),
        diceIds: [classDef.starterDiceIds[0] as string, backgroundDef.starterDieId],
        row: selection.row,
        alive: true,
      };
    });

    const run: RunState = {
      seed,
      nodeIndex: 0,
      currentNodeId: map.startNodeId,
      availableNodeIds: [...(startNode.next ?? [])],
      map,
      party,
      supplies: 12,
      morale: 5,
      threat: 10,
      injuries: 0,
      gold: Math.max(0, START_HIRING_GOLD - hiringSpent),
      consumables: 0,
      relicIds: [],
      runLog: ['Run iniciada.'],
      wins: 0,
      losses: 0,
      completed: false,
      victory: false,
      pendingForcedElite: 0,
      pendingRevealNodes: 0,
      pendingShopNodes: 0,
      pendingSkipDangerNodes: 0,
    };

    this.applyPendingMapModifiers(run);
    if (this.hasBackground(run, 'cartografo_posteres')) {
      this.revealAhead(run, 1);
    }

    this.state = {
      ...this.state,
      phase: 'map',
      run,
      combat: null,
      activeEvent: null,
      rewardOptions: [],
      rewardSource: null,
      message: 'Escolha o proximo no da expedicao.',
    };

    this.render();
  }

  private chooseMapNode(nodeId: string): void {
    const run = this.state.run;
    if (!run) {
      return;
    }

    if (!run.availableNodeIds.includes(nodeId)) {
      this.state = withMessage(this.state, 'No indisponivel.');
      this.render();
      return;
    }

    const node = run.map.nodes[nodeId];
    if (!node) {
      this.state = withMessage(this.state, 'No nao encontrado.');
      this.render();
      return;
    }

    applyTravelCost(run, this.state.content.relics);

    run.currentNodeId = node.id;
    run.nodeIndex += 1;
    run.availableNodeIds = [...node.next];
    node.visited = true;
    node.revealed = true;
    run.runLog.unshift(`No ${node.type}: ${node.title}`);

    this.applyPendingMapModifiers(run);

    let revealDepth = 0;
    if (this.hasBackground(run, 'cartografo_posteres')) {
      revealDepth += 1;
    }
    if (run.pendingRevealNodes > 0) {
      revealDepth += run.pendingRevealNodes;
      run.pendingRevealNodes = 0;
    }
    if (revealDepth > 0) {
      this.revealAhead(run, revealDepth);
    }

    if (run.party.every((entry) => !entry.alive)) {
      this.finishRun(false, 'A trip nao resistiu a expedicao.');
      return;
    }

    if (node.type === 'event') {
      this.enterEvent(node.id);
      return;
    }

    if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
      this.enterCombat(node.type, node.encounterIds);
      return;
    }

    if (node.type === 'rest') {
      applyRestNode(run);
      this.state = withMessage(this.state, 'A trip descansou e segue viagem.');
      this.render();
      return;
    }

    if (node.type === 'shop') {
      this.state = {
        ...this.state,
        phase: 'reward',
        rewardSource: 'shop',
        rewardOptions: this.generateRewardOptions('shop'),
        message: 'Mercado aberto: escolha uma opcao.',
      };
      this.render();
      return;
    }

    this.state = withMessage(this.state, 'No visitado.');
    this.render();
  }

  private enterEvent(nodeId: string): void {
    if (!this.state.run) {
      return;
    }

    const event = pickEventForRun(this.state.run, this.state.content, this.runRng);
    const firstAlive = this.state.run.party.find((entry) => entry.alive);
    const hasReporter = this.hasBackground(this.state.run, 'reporter_radio');

    this.state = {
      ...this.state,
      phase: 'event',
      activeEvent: {
        nodeId,
        eventId: event.id,
        successMessage: '',
        resultMessage: '',
        resolved: false,
        selectedCharacterId: firstAlive?.id ?? null,
        selectedDieSource: 'class',
        freeRerollAvailable: hasReporter,
      },
      message: 'Evento ativo: selecione uma escolha.',
    };

    this.state.profile = markEventSeen(this.state.profile, event.id);
    void saveProfile(this.state.profile);

    this.render();
  }

  private setEventTester(characterId: string, dieSource: DieSource): void {
    if (!this.state.activeEvent || this.state.activeEvent.resolved) {
      return;
    }

    this.state = {
      ...this.state,
      activeEvent: {
        ...this.state.activeEvent,
        selectedCharacterId: characterId,
        selectedDieSource: dieSource,
      },
    };

    this.render();
  }

  private resolveEventChoice(
    choiceId: string,
    event: EventDef,
    selectedCharacterId: string,
    selectedDieSource: DieSource,
  ): void {
    if (!this.state.run || !this.state.activeEvent) {
      return;
    }

    if (this.state.activeEvent.resolved) {
      this.state = withMessage(this.state, 'Evento ja resolvido.');
      this.render();
      return;
    }

    const choice = event.choices.find((entry) => entry.id === choiceId);
    if (!choice) {
      this.state = withMessage(this.state, 'Escolha de evento invalida.');
      this.render();
      return;
    }

    const result = resolveEventChoiceRoll(
      this.state.run,
      this.state.content,
      this.runRng,
      choice,
      selectedCharacterId,
      selectedDieSource,
      this.state.activeEvent.freeRerollAvailable,
    );

    let eventSupplyBonus = 0;
    for (const relicId of this.state.run.relicIds) {
      const relic = this.state.content.byId.relics[relicId];
      if (relic?.effect.kind === 'supplies_on_event') {
        eventSupplyBonus += relic.effect.value;
      }
    }
    if (eventSupplyBonus > 0) {
      applyRunResourceDelta(this.state.run, 'supplies', eventSupplyBonus);
      result.log.push(`Reliquias concederam +${eventSupplyBonus} suprimentos.`);
    }

    const resultMessage = formatMessage([
      result.success ? 'Sucesso no evento.' : 'Falha no evento.',
      ...result.log,
    ]);

    this.state.run.runLog.unshift(resultMessage);

    this.state = {
      ...this.state,
      activeEvent: {
        ...this.state.activeEvent,
        successMessage: result.success ? 'Sucesso' : 'Falha',
        resultMessage,
        selectedCharacterId,
        selectedDieSource,
        freeRerollAvailable:
          result.usedFreeReroll || !this.state.activeEvent.freeRerollAvailable
            ? false
            : this.state.activeEvent.freeRerollAvailable,
        resolved: true,
      },
      message: resultMessage,
    };

    this.render();
  }

  private returnFromEvent(): void {
    if (!this.state.run || !this.state.activeEvent?.resolved) {
      return;
    }

    if (this.state.run.party.every((member) => !member.alive)) {
      this.finishRun(false, 'A trip caiu durante o evento.');
      return;
    }

    this.applyPendingMapModifiers(this.state.run);
    if (this.state.run.pendingRevealNodes > 0) {
      this.revealAhead(this.state.run, this.state.run.pendingRevealNodes);
      this.state.run.pendingRevealNodes = 0;
    }

    this.state = {
      ...this.state,
      phase: 'map',
      activeEvent: null,
      message: 'Evento concluido. Continue a expedicao.',
    };

    this.render();
  }

  private enterCombat(nodeType: 'combat' | 'elite' | 'boss', encounterIds: string[]): void {
    if (!this.state.run) {
      return;
    }

    const encounter = encounterIds.length > 0 ? encounterIds : ['saqueador_rio'];
    const combat = createCombatState(this.state.run, this.state.content, this.runRng, nodeType, encounter);

    this.state.profile = markEnemiesSeen(this.state.profile, combat.enemyBlueprintIds);
    void saveProfile(this.state.profile);

    this.state = {
      ...this.state,
      phase: 'combat',
      combat,
      message: 'Toque ROLL para iniciar o turno.',
    };
    this.selectedRollId = null;
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.selectedTargetId = null;
    this.combatLogCollapsed = true;
    this.combatFxController.setCombatId(combat.id);

    const idleEvents: CombatFxEvent[] = [
      ...combat.party
        .filter((entry) => entry.alive)
        .map(
          (entry): CombatFxEvent => ({ type: 'idle', targetId: entry.id, enabled: true }),
        ),
      ...combat.enemies
        .filter((entry) => entry.alive)
        .map(
          (entry): CombatFxEvent => ({ type: 'idle', targetId: entry.id, enabled: true }),
        ),
    ];
    this.enqueueCombatFx(idleEvents);

    this.render();
  }

  private clearCombatSelection(renderAfter = false): void {
    const changed =
      this.selectedRollId !== null ||
      this.selectedTargetId !== null ||
      this.combatFaceTooltipRollId !== null ||
      this.combatFaceTooltipPosition !== null;
    this.selectedRollId = null;
    this.selectedTargetId = null;
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    if (renderAfter && changed) {
      this.render();
    }
  }

  private combatPhaseBucket(turn: number): 'opening' | 'mid' | 'climax' {
    if (turn <= 2) {
      return 'opening';
    }
    if (turn <= 5) {
      return 'mid';
    }
    return 'climax';
  }

  private buildValidTargetIds(combat: NonNullable<GameState['combat']>, rollId: string | null): Set<string> {
    if (!rollId) {
      return new Set<string>();
    }
    const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
    if (!roll || roll.used || roll.locked || roll.face.kind === 'empty') {
      return new Set<string>();
    }

    const valid = new Set<string>();
    for (const target of combat.party) {
      if (canUsePlayerDieOnTarget(combat, rollId, 'party', target.id)) {
        valid.add(target.id);
      }
    }
    for (const target of combat.enemies) {
      if (canUsePlayerDieOnTarget(combat, rollId, 'enemy', target.id)) {
        valid.add(target.id);
      }
    }
    return valid;
  }

  private applyDieToTarget(rollId: string, targetTeam: 'party' | 'enemy', targetId: string): void {
    const combat = this.state.combat;
    if (!combat || !this.state.run) {
      return;
    }

    const result = usePlayerDie(combat, rollId, targetTeam, targetId);
    combat.log.unshift(result.message);
    this.enqueueCombatFx(result.events);

    syncCombatToRun(this.state.run, combat);
    this.state = withMessage(this.state, result.message);
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;

    this.handleCombatProgress();
  }

  private useEmptyDie(rollId: string): void {
    const combat = this.state.combat;
    if (!combat || !this.state.run) {
      return;
    }
    const roll = combat.diceRolls.find((entry) => entry.rollId === rollId);
    if (!roll) {
      this.state = withMessage(this.state, 'Dado vazio invalido.');
      this.render();
      return;
    }

    const result = usePlayerDie(combat, rollId, 'party', roll.ownerId);
    combat.log.unshift(result.message);
    this.enqueueCombatFx(result.events);
    syncCombatToRun(this.state.run, combat);
    this.state = withMessage(this.state, result.message);
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.handleCombatProgress();
  }

  private discardDie(rollId: string): void {
    const combat = this.state.combat;
    if (!combat || !this.state.run) {
      return;
    }

    const result = discardDieForGuard(combat, rollId);
    combat.log.unshift(result.message);
    this.enqueueCombatFx(result.events);

    syncCombatToRun(this.state.run, combat);
    this.state = withMessage(this.state, result.message);
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.handleCombatProgress();
  }

  private rerollDice(): void {
    const combat = this.state.combat;
    if (!combat) {
      return;
    }
    if (combat.awaitingRoll) {
      this.state = withMessage(this.state, 'Role os dados antes de rerrolar.');
      this.render();
      return;
    }

    if (!this.combatFxController.getDiceTrayDiagnostics().interactionReady) {
      this.state = withMessage(this.state, 'Aguarde os dados assentarem para rerrolar.');
      this.render();
      return;
    }

    if (!this.selectedRollId) {
      this.state = withMessage(this.state, 'Selecione um dado valido para rerrolar.');
      this.render();
      return;
    }

    if (combat.focus <= 0) {
      this.state = withMessage(this.state, 'Sem FOCO para rerrolar.');
      this.render();
      return;
    }

    const selectedRoll = combat.diceRolls.find((entry) => entry.rollId === this.selectedRollId);
    if (!selectedRoll || selectedRoll.used || selectedRoll.locked) {
      this.state = withMessage(this.state, 'Selecione um dado valido para rerrolar.');
      this.clearCombatSelection(false);
      this.render();
      return;
    }

    const result = rerollOneDieWithFocus(
      combat,
      this.state.content,
      this.runRng,
      this.selectedRollId,
    );
    combat.log.unshift(result.message);
    this.enqueueCombatFx(result.events);
    this.state = withMessage(this.state, result.message);
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.render();
  }

  private rollCurrentTurnDice(): void {
    const combat = this.state.combat;
    const run = this.state.run;
    if (!combat || !run) {
      return;
    }
    if (!combat.awaitingRoll) {
      this.state = withMessage(this.state, 'Os dados deste turno ja foram rolados.');
      this.render();
      return;
    }

    const tray = this.combatFxController.getDiceTrayDiagnostics();
    if (tray.diceCount > 0 && !tray.interactionReady) {
      this.state = withMessage(this.state, 'Aguarde a animacao inimiga terminar.');
      this.render();
      return;
    }

    const result = rollCombatDice(combat, run, this.state.content, this.runRng);
    combat.log.unshift(result.message);
    this.enqueueCombatFx(result.events);
    this.state = withMessage(this.state, result.message);
    this.clearCombatSelection(false);
    this.render();
  }

  private handleEndTurnAction(): void {
    const combat = this.state.combat;
    if (!combat) {
      return;
    }

    if (combat.awaitingRoll) {
      return;
    }

    const hasUnused = combat.diceRolls.some((entry) => !entry.used);
    if (hasUnused) {
      const canAsk = typeof window !== 'undefined' && typeof window.confirm === 'function';
      const ok = canAsk ? window.confirm('Encerrar turno com dados nao usados?') : true;
      if (!ok) {
        return;
      }
    }

    this.endTurn();
  }

  private endTurn(): void {
    const combat = this.state.combat;
    const run = this.state.run;
    if (!combat || !run) {
      return;
    }
    this.clearCombatSelection(false);

    const result = nextCombatTurn(combat, run, this.state.content, this.runRng);
    for (const entry of result.logs.slice().reverse()) {
      combat.log.unshift(entry);
    }
    this.enqueueCombatFx(result.events);

    this.state = withMessage(this.state, result.logs[0] ?? 'Turno resolvido.');
    this.handleCombatProgress();
  }

  private applyPostCombatRewards(run: RunState, rewards: { gold: number; supplies: number; consumables: number; threat: number }): void {
    if (rewards.gold !== 0) {
      applyRunResourceDelta(run, 'gold', rewards.gold);
      run.runLog.unshift(`Recompensa pos-combate: ouro ${rewards.gold >= 0 ? '+' : ''}${rewards.gold}.`);
    }

    if (rewards.supplies !== 0) {
      applyRunResourceDelta(run, 'supplies', rewards.supplies);
      run.runLog.unshift(`Recompensa pos-combate: suprimentos ${rewards.supplies >= 0 ? '+' : ''}${rewards.supplies}.`);
    }

    if (rewards.consumables !== 0) {
      applyRunResourceDelta(run, 'consumables', rewards.consumables);
      run.runLog.unshift(
        `Recompensa pos-combate: consumiveis ${rewards.consumables >= 0 ? '+' : ''}${rewards.consumables}.`,
      );
    }

    if (rewards.threat !== 0) {
      applyRunResourceDelta(run, 'threat', rewards.threat);
      run.runLog.unshift(`Ameaca ${rewards.threat >= 0 ? '+' : ''}${rewards.threat} por efeitos de combate.`);
    }
  }

  private handleCombatProgress(): void {
    const combat = this.state.combat;
    const run = this.state.run;
    if (!combat || !run) {
      return;
    }

    syncCombatToRun(run, combat);
    this.selectedTargetId = null;

    if (combat.outcome === 'victory') {
      run.wins += 1;
      run.runLog.unshift('Combate vencido.');

      this.applyPostCombatRewards(run, combat.postCombatRewards);

      for (const relicId of run.relicIds) {
        const relic = this.state.content.byId.relics[relicId];
        if (relic?.effect.kind === 'heal_after_combat') {
          for (const member of run.party) {
            member.hp = Math.min(member.maxHp, member.hp + relic.effect.value);
          }
        }
        if (relic?.effect.kind === 'morale_on_win') {
          run.morale = clamp(run.morale + relic.effect.value, 0, 10);
        }
      }

      const rewardSource = combat.nodeType === 'elite' || combat.nodeType === 'boss' ? combat.nodeType : 'combat';
      this.combatFxController.setCombatId(null);

      this.state = {
        ...this.state,
        phase: 'reward',
        rewardSource,
        rewardOptions: this.generateRewardOptions(rewardSource),
        combat: null,
        message: rewardSource === 'boss' ? 'Boss derrotado. Recompensa final.' : 'Escolha sua recompensa.',
      };
      this.selectedRollId = null;
      this.combatFaceTooltipRollId = null;
      this.combatFaceTooltipPosition = null;
      this.combatLogCollapsed = true;
      this.render();
      return;
    }

    if (combat.outcome === 'defeat') {
      run.losses += 1;
      this.combatFxController.setCombatId(null);
      this.finishRun(false, 'A trip foi derrotada em combate.');
      return;
    }

    this.render();
  }

  private generateRewardOptions(source: 'combat' | 'elite' | 'boss' | 'shop'): RewardOption[] {
    const run = this.state.run;
    if (!run) {
      return [];
    }

    const options: RewardOption[] = [];
    const availableRelics = this.state.content.relics.filter((entry) => !run.relicIds.includes(entry.id));

    if (availableRelics.length > 0) {
      const relic = availableRelics[this.runRng.nextInt(availableRelics.length)] as (typeof availableRelics)[number];
      options.push({
        id: `reward_relic_${relic.id}`,
        label: relic.name,
        detail: relic.description,
        kind: 'relic',
        payload: { relicId: relic.id },
      });
    }

    options.push({
      id: 'reward_supplies',
      label: source === 'shop' ? 'Kit de suprimentos' : 'Pacote de suprimentos',
      detail: source === 'shop' ? '+3 suprimentos (custa 2 ouro)' : '+3 suprimentos',
      kind: 'resource',
      payload: { resource: 'supplies', amount: 3 },
    });

    options.push({
      id: 'reward_morale',
      label: source === 'shop' ? 'Suprimento de conforto' : 'Impulso de moral',
      detail: source === 'shop' ? '+2 moral (custa 2 ouro)' : '+2 moral',
      kind: 'resource',
      payload: { resource: 'morale', amount: 2 },
    });

    const aliveParty = run.party.filter((member) => member.alive);
    const randomParty =
      (aliveParty.length > 0 ? aliveParty : run.party)[
        this.runRng.nextInt((aliveParty.length > 0 ? aliveParty : run.party).length)
      ] as (typeof run.party)[number];
    const classDef = this.state.content.byId.classes[randomParty.classId];
    const growthPool = classDef?.growthPoolDiceIds ?? [];
    const growthDieId =
      growthPool.length > 0
        ? (growthPool[this.runRng.nextInt(growthPool.length)] as string)
        : (classDef?.starterDiceIds[0] as string | undefined);
    const growthDie = growthDieId ? this.state.content.byId.dice[growthDieId] : undefined;

    options.push({
      id: `reward_upgrade_${randomParty.id}`,
      label: `Treino rapido de ${randomParty.name}`,
      detail: growthDie ? `Evoluir dado para ${growthDie.label}` : '+2 max HP e cura 2',
      kind: 'upgrade',
      payload: growthDieId
        ? { characterId: randomParty.id, dieId: growthDieId }
        : { characterId: randomParty.id, amount: 2 },
    });

    const hasCollector = this.hasBackground(run, 'colecionador_selos');
    const optionLimit = source === 'shop' && hasCollector ? 4 : 3;

    return options.slice(0, optionLimit);
  }

  private pickReward(rewardId: string): void {
    const run = this.state.run;
    const rewardSource = this.state.rewardSource;
    if (!run || !rewardSource) {
      return;
    }

    const option = this.state.rewardOptions.find((entry) => entry.id === rewardId);
    if (!option) {
      this.state = withMessage(this.state, 'Recompensa invalida.');
      this.render();
      return;
    }

    if (rewardSource === 'shop') {
      const cost = 2;
      if (run.gold < cost) {
        this.state = withMessage(this.state, 'Ouro insuficiente para comprar no mercado.');
        this.render();
        return;
      }
      run.gold -= cost;
      run.runLog.unshift(`Compra no mercado custou ${cost} ouro.`);
    }

    if (option.kind === 'relic' && option.payload.relicId) {
      if (!run.relicIds.includes(option.payload.relicId)) {
        run.relicIds.push(option.payload.relicId);
        run.runLog.unshift(`Reliquia adquirida: ${option.payload.relicId}`);
        const relic = this.state.content.byId.relics[option.payload.relicId];
        if (relic?.effect.kind === 'max_hp_bonus') {
          for (const member of run.party) {
            member.maxHp += relic.effect.value;
            member.hp += relic.effect.value;
          }
          run.runLog.unshift(`Reliquia elevou HP maximo da trip em +${relic.effect.value}.`);
        }
      }
    }

    if (option.kind === 'resource' && option.payload.resource && option.payload.amount) {
      applyRunResourceDelta(run, option.payload.resource, option.payload.amount);
      run.runLog.unshift(
        `${option.payload.resource} ${option.payload.amount >= 0 ? '+' : ''}${option.payload.amount}`,
      );
    }

    if (option.kind === 'upgrade' && option.payload.characterId && option.payload.dieId) {
      const target = run.party.find((entry) => entry.id === option.payload.characterId);
      if (target) {
        target.diceIds[0] = option.payload.dieId;
        run.runLog.unshift(`${target.name} evoluiu dado de classe para ${option.payload.dieId}.`);
      }
    }

    if (option.kind === 'upgrade' && option.payload.characterId && option.payload.amount) {
      const target = run.party.find((entry) => entry.id === option.payload.characterId);
      if (target) {
        target.maxHp += option.payload.amount;
        target.hp = Math.min(target.maxHp, target.hp + option.payload.amount);
        run.runLog.unshift(`${target.name} recebeu treino (+${option.payload.amount} max HP).`);
      }
    }

    if (option.kind === 'heal' && option.payload.amount) {
      for (const member of run.party) {
        member.hp = Math.min(member.maxHp, member.hp + option.payload.amount);
      }
      run.runLog.unshift(`Trip curada em ${option.payload.amount}.`);
    }

    if (rewardSource === 'boss') {
      this.finishRun(true, 'Expedicao concluida com sucesso.');
      return;
    }

    this.state = {
      ...this.state,
      phase: 'map',
      rewardSource: null,
      rewardOptions: [],
      message: `Recompensa aplicada: ${option.label}.`,
    };

    this.render();
  }

  private skipReward(): void {
    if (!this.state.run) {
      return;
    }

    if (this.state.rewardSource === 'boss') {
      this.finishRun(true, 'Expedicao concluida.');
      return;
    }

    this.state = {
      ...this.state,
      phase: 'map',
      rewardOptions: [],
      rewardSource: null,
      message: 'Recompensa pulada. Continue a run.',
    };

    this.render();
  }

  private finishRun(victory: boolean, message: string): void {
    const run = this.state.run;
    this.combatFxController.setCombatId(null);
    if (!run) {
      this.state = setPhase(this.state, 'meta', message);
      this.clearCombatSelection(false);
      this.combatLogCollapsed = true;
      this.render();
      return;
    }

    run.completed = true;
    run.victory = victory;

    let nextProfile = registerRunResult(this.state.profile, run, this.state.content);
    nextProfile = sanitizeProfileForContent(nextProfile, this.state.content);

    this.state = {
      ...this.state,
      profile: nextProfile,
      phase: 'run_end',
      combat: null,
      activeEvent: null,
      rewardOptions: [],
      rewardSource: null,
      message,
    };
    this.selectedRollId = null;
    this.selectedTargetId = null;
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.combatLogCollapsed = true;

    void saveProfile(nextProfile);
    this.render();
  }

  private async resetProfile(): Promise<void> {
    this.combatFxController.setCombatId(null);
    await clearProfile();
    const next = sanitizeProfileForContent(createDefaultProfile(), this.state.content);
    this.state = {
      ...this.state,
      profile: next,
      run: null,
      combat: null,
      activeEvent: null,
      rewardOptions: [],
      rewardSource: null,
      phase: 'meta',
      message: 'Perfil resetado.',
    };

    this.draftSeed = makeSeed();
    this.draftParty = this.ensureDraftValidity(this.draftParty);
    this.selectedDraftSlot = clamp(this.selectedDraftSlot, 0, this.draftParty.length - 1);
    this.metaFaceTooltipKey = null;
    this.selectedRollId = null;
    this.selectedTargetId = null;
    this.combatFaceTooltipRollId = null;
    this.combatFaceTooltipPosition = null;
    this.combatLogCollapsed = true;

    await saveProfile(next);
    this.render();
  }
}
