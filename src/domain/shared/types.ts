import type {
  APP_PHASES,
  FACE_KINDS,
  NEGATIVE_STATUS_IDS,
  NODE_TYPES,
  RESOURCE_IDS,
  STATUS_IDS,
} from './enums';

export type FaceKind = (typeof FACE_KINDS)[number];
export type StatusId = (typeof STATUS_IDS)[number];
export type NegativeStatusId = (typeof NEGATIVE_STATUS_IDS)[number];
export type NodeType = (typeof NODE_TYPES)[number];
export type AppPhase = (typeof APP_PHASES)[number];
export type ResourceId = (typeof RESOURCE_IDS)[number];
export type CombatantVisualKey = string;
export type DiceFaceVisualKey = string;
export type EnemyDieTier = 'common' | 'elite' | 'boss';
export type CaptainPassiveId =
  | 'mecanico_scrap'
  | 'mecanico_oficina_campo'
  | 'mecanico_engrenagem_emergencia'
  | 'aviadora_corrente_ar'
  | 'aviadora_ataque_rasante'
  | 'aviadora_chefe_sinalizacao'
  | 'ocultista_cifra_voraz'
  | 'ocultista_veneno_metodico'
  | 'ocultista_ritual_curto'
  | 'cacador_observador'
  | 'cacador_tiro_limpo'
  | 'cacador_de_marcas';
export type CaptainFaceId =
  | 'face_rebites_rapidos'
  | 'face_sucata_util'
  | 'face_evasiva'
  | 'face_rajada_tatica'
  | 'face_selo_vazio'
  | 'face_ritual_rapido'
  | 'face_armadilha_perfeita'
  | 'face_mira_fria';

export interface CaptainLoadoutSelection {
  passiveId: CaptainPassiveId;
  faceId: CaptainFaceId;
}

export interface CaptainConfig {
  captainClassId: string;
  loadout: CaptainLoadoutSelection;
}

export interface CaptainRuntimeState {
  scrap: number;
  ritualShortPending: boolean;
  perTurnFlags: Record<string, boolean>;
  perCombatFlags: Record<string, boolean>;
  lockBonusByRollId: Record<string, number>;
}

export type CombatFxEvent =
  | {
      type: 'die_roll';
      rollId: string;
      ownerId: string;
      durationMs: number;
      face?: DiceFaceDef;
      faceIndex?: number;
      dieId?: string;
      transient?: boolean;
      selectable?: boolean;
      expiresAfterMs?: number;
    }
  | {
      type: 'die_settle';
      rollId: string;
      ownerId: string;
      faceId: string;
      durationMs: number;
      face?: DiceFaceDef;
      faceIndex?: number;
      dieId?: string;
      transient?: boolean;
      selectable?: boolean;
      expiresAfterMs?: number;
    }
  | { type: 'hit'; targetId: string; amount: number; sourceId?: string }
  | { type: 'heal'; targetId: string; amount: number; sourceId?: string }
  | { type: 'status'; targetId: string; statusId: StatusId; stacks: number }
  | { type: 'swap'; aId: string; bId: string }
  | { type: 'focus'; ownerId: string; delta: number }
  | {
      type: 'intent_telegraph';
      ownerId: string;
      intentKind: EnemyIntentDef['kind'];
      value: number;
      durationMs: number;
      label?: string;
      targetHint?: EnemyIntentDef['target'];
    }
  | { type: 'idle'; targetId: string; enabled: boolean };

export type DieSource = 'class' | 'background';
export type FaceTarget = 'self' | 'ally' | 'enemy' | 'any';
export type RangeType = 'melee' | 'ranged';

export interface DiceFaceCondition {
  requiresTag?: string;
  requiresMarked?: boolean;
  requiresTargetFront?: boolean;
}

export type FaceEffectTarget =
  | 'target'
  | 'self'
  | 'ally'
  | 'all_allies'
  | 'enemy_front_all'
  | 'enemy_back_all'
  | 'enemy_all'
  | 'enemy_random';

export type FaceEffectDef =
  | {
      type: 'damage';
      value: number;
      target?: FaceEffectTarget;
      range?: RangeType;
      consumeMark?: boolean;
      requiresMarked?: boolean;
      applyStatusId?: StatusId;
      applyStatusStacks?: number;
    }
  | {
      type: 'block';
      value: number;
      target?: FaceEffectTarget;
    }
  | {
      type: 'heal';
      value: number;
      target?: FaceEffectTarget;
      removeBleed?: boolean;
    }
  | {
      type: 'status';
      statusId: StatusId;
      value: number;
      target?: FaceEffectTarget;
    }
  | {
      type: 'cleanse';
      value: number;
      target?: FaceEffectTarget;
    }
  | {
      type: 'shred_armor';
      value: number;
      target?: FaceEffectTarget;
    }
  | {
      type: 'swap';
    }
  | {
      type: 'focus';
      value: number;
    }
  | {
      type: 'lock_die';
      value: number;
    }
  | {
      type: 'pull_front';
    }
  | {
      type: 'suppress_special';
      value: number;
    }
  | {
      type: 'post_combat';
      resource: 'gold' | 'supplies' | 'consumables';
      value: number;
      threatDelta?: number;
    }
  | {
      type: 'turret';
      value: number;
    };

export interface DiceFaceDef {
  id: string;
  visualKey?: DiceFaceVisualKey;
  label: string;
  kind: FaceKind;
  value: number;
  tags: string[];
  target: FaceTarget;
  effects: FaceEffectDef[];
  condition?: DiceFaceCondition;
}

export interface DieDef {
  id: string;
  label: string;
  rarity: 'common' | 'rare' | 'cursed';
  emptyFaceIndices?: number[];
  faces: [
    DiceFaceDef,
    DiceFaceDef,
    DiceFaceDef,
    DiceFaceDef,
    DiceFaceDef,
    DiceFaceDef,
  ];
}

export interface ClassDef {
  id: string;
  name: string;
  role: 'tank' | 'striker' | 'support' | 'control';
  verb: string;
  passive: string;
  hireCost?: number;
  starterDiceIds: string[];
  growthPoolDiceIds: string[];
  maxHp: number;
}

export interface BackgroundDef {
  id: string;
  name: string;
  tags: string[];
  perk: string;
  starterDieId: string;
  exclusiveEventIds: string[];
}

export interface CharacterState {
  id: string;
  name: string;
  visualKey?: CombatantVisualKey;
  classId: string;
  backgroundId: string;
  tags: string[];
  hp: number;
  maxHp: number;
  armor: number;
  statuses: Record<StatusId, number>;
  diceIds: string[];
  row: 'front' | 'back';
  alive: boolean;
}

export interface EventChoiceCheck {
  kind: 'face_kind' | 'face_value_min';
  faceKind?: FaceKind;
  anyOfKinds?: FaceKind[];
  minValue?: number;
  bonusPerTag?: string;
  autoSuccessTag?: string;
}

export type OutcomeDef =
  | {
      kind: 'resource';
      resource: ResourceId;
      delta: number;
    }
  | {
      kind: 'heal';
      amount: number;
      target: 'party' | 'random_party';
    }
  | {
      kind: 'damage';
      amount: number;
      target: 'party' | 'random_party';
    }
  | {
      kind: 'relic';
      relicId?: string;
      poolTag?: string;
    }
  | {
      kind: 'status';
      statusId: StatusId;
      stacks: number;
      target: 'party' | 'random_party';
    }
  | {
      kind: 'state';
      flag: 'force_elite_next' | 'reveal_nodes' | 'spawn_shop_next' | 'skip_danger_nodes';
      value: number;
    }
  | {
      kind: 'log';
      text: string;
    };

export interface EventChoiceDef {
  id: string;
  text: string;
  check?: EventChoiceCheck;
  onSuccess: OutcomeDef[];
  onFail: OutcomeDef[];
}

export interface EventDef {
  id: string;
  biome: string;
  weight: number;
  title: string;
  body: string;
  requiredTags: string[];
  choices: EventChoiceDef[];
}

export interface EnemyIntentDef {
  id: string;
  label: string;
  kind: 'attack' | 'defend' | 'status' | 'heal' | 'special';
  min: number;
  max: number;
  statusId?: StatusId;
  statusStacks?: number;
  target: 'front' | 'back' | 'any';
  range?: RangeType;
  aoe?: 'single' | 'front_all' | 'back_all' | 'all';
  isSpecial?: boolean;
  onHitStatusId?: StatusId;
  onHitStatusStacks?: number;
  grantStatusId?: StatusId;
  grantStatusStacks?: number;
  summonEnemyId?: string;
  phase2Min?: number;
  phase2Max?: number;
  phase2StatusId?: StatusId;
  phase2StatusStacks?: number;
  weight: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  armor: number;
  isBoss: boolean;
  tags: string[];
  intentMode?: 'random' | 'cycle';
  intentCycle?: string[];
  phase2Hp?: number;
  intents: EnemyIntentDef[];
}

export interface RelicEffectDef {
  kind:
    | 'reroll_bonus'
    | 'max_hp_bonus'
    | 'heal_after_combat'
    | 'threat_slow'
    | 'guard_turn_start'
    | 'morale_on_win'
    | 'supplies_on_event';
  value: number;
}

export interface RelicDef {
  id: string;
  name: string;
  rarity: 'common' | 'rare';
  description: string;
  tags: string[];
  effect: RelicEffectDef;
}

export interface BiomeDef {
  id: string;
  name: string;
  palette: string[];
  description: string;
}

export interface ContentIndexDef {
  classes: string[];
  backgrounds: string[];
  dice: string[];
  enemies: string[];
  events: string[];
  relics: string[];
  biome: string;
}

export interface GameContent {
  classes: ClassDef[];
  backgrounds: BackgroundDef[];
  dice: DieDef[];
  enemies: EnemyDef[];
  events: EventDef[];
  relics: RelicDef[];
  biome: BiomeDef;
  byId: {
    classes: Record<string, ClassDef>;
    backgrounds: Record<string, BackgroundDef>;
    dice: Record<string, DieDef>;
    enemies: Record<string, EnemyDef>;
    events: Record<string, EventDef>;
    relics: Record<string, RelicDef>;
  };
}

export interface MapNode {
  id: string;
  type: NodeType;
  depth: number;
  next: string[];
  title: string;
  subtitle: string;
  encounterIds: string[];
  visited: boolean;
  revealed: boolean;
}

export interface ExpeditionMap {
  id: string;
  biomeId: string;
  nodes: Record<string, MapNode>;
  orderedNodeIds: string[];
  startNodeId: string;
  bossNodeId: string;
}

export interface RunState {
  seed: number;
  nodeIndex: number;
  currentNodeId: string;
  availableNodeIds: string[];
  map: ExpeditionMap;
  party: CharacterState[];
  supplies: number;
  morale: number;
  threat: number;
  injuries: number;
  gold: number;
  consumables: number;
  relicIds: string[];
  runLog: string[];
  wins: number;
  losses: number;
  completed: boolean;
  victory: boolean;
  pendingForcedElite: number;
  pendingRevealNodes: number;
  pendingShopNodes: number;
  pendingSkipDangerNodes: number;
  captainConfig: CaptainConfig | null;
}

export interface RolledDie {
  rollId: string;
  ownerId: string;
  dieId: string;
  faceIndex: number;
  face: DiceFaceDef;
  used: boolean;
  locked: boolean;
}

export interface CombatIntent {
  enemyId: string;
  intentId: string;
  enemyRollId?: string;
  enemyDieTier?: EnemyDieTier;
  enemyFaceIndex?: number;
  enemyFace?: DiceFaceDef;
  label: string;
  kind: EnemyIntentDef['kind'];
  value: number;
  statusId?: StatusId;
  statusStacks?: number;
  target: EnemyIntentDef['target'];
  range: RangeType;
  aoe: 'single' | 'front_all' | 'back_all' | 'all';
  isSpecial: boolean;
  onHitStatusId?: StatusId;
  onHitStatusStacks?: number;
  grantStatusId?: StatusId;
  grantStatusStacks?: number;
  summonEnemyId?: string;
}

export interface CombatantState {
  id: string;
  name: string;
  visualKey?: CombatantVisualKey;
  hp: number;
  maxHp: number;
  armor: number;
  statuses: Record<StatusId, number>;
  tags: string[];
  row: 'front' | 'back';
  alive: boolean;
  isEnemy: boolean;
  classId?: string;
  backgroundId?: string;
}

export interface CombatState {
  id: string;
  nodeType: NodeType;
  turn: number;
  awaitingRoll: boolean;
  party: CombatantState[];
  enemies: CombatantState[];
  enemyBlueprintIds: string[];
  intents: CombatIntent[];
  diceRolls: RolledDie[];
  focus: number;
  outcome: 'ongoing' | 'victory' | 'defeat';
  log: string[];
  enemyIntentCursor: Record<string, number>;
  classPassivesUsedThisTurn: Record<string, boolean>;
  captainConfig: CaptainConfig | null;
  captainRuntime: CaptainRuntimeState;
  rerolledRollIdsThisTurn: Record<string, boolean>;
  freeRerollCharges: number;
  enemyRollSnapshot?: Array<{
    enemyId: string;
    tier: EnemyDieTier;
    rollId: string;
    intentId: string;
    label: string;
    kind: EnemyIntentDef['kind'];
    target: EnemyIntentDef['target'];
    range: RangeType;
    value: number;
    faceIndex: number;
  }>;
  postCombatRewards: {
    gold: number;
    supplies: number;
    consumables: number;
    threat: number;
  };
}

export interface RewardOption {
  id: string;
  label: string;
  detail: string;
  kind: 'relic' | 'resource' | 'heal' | 'upgrade';
  payload: {
    relicId?: string;
    resource?: ResourceId;
    amount?: number;
    characterId?: string;
    dieId?: string;
  };
}

export interface ActiveEventState {
  nodeId: string;
  eventId: string;
  successMessage: string;
  resultMessage: string;
  resolved: boolean;
  selectedCharacterId: string | null;
  selectedDieSource: DieSource;
  freeRerollAvailable: boolean;
}

export interface ProfileState {
  version: number;
  runsPlayed: number;
  runsWon: number;
  unlocks: {
    classes: string[];
    backgrounds: string[];
    relics: string[];
  };
  compendium: {
    eventsSeen: string[];
    enemiesSeen: string[];
    relicsSeen: string[];
  };
}

export interface GameState {
  phase: AppPhase;
  content: GameContent;
  profile: ProfileState;
  run: RunState | null;
  activeEvent: ActiveEventState | null;
  combat: CombatState | null;
  rewardOptions: RewardOption[];
  rewardSource: NodeType | null;
  message: string;
}

export interface PartySelectionItem {
  classId: string;
  backgroundId: string;
  row: 'front' | 'back';
}

export interface DraftRosterCandidate {
  classId: string;
  backgroundId: string;
  hireCost: number;
}

export interface ContentValidationIssue {
  source: string;
  message: string;
}

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
