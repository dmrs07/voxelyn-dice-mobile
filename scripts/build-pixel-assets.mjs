#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const RAW_ROOT = path.join(root, 'assets', 'raw', 'aseprite');
const GENERATED_ROOT = path.join(root, 'assets', 'generated', 'pixel');
const META_ROOT = path.join(GENERATED_ROOT, 'meta');
const MANIFEST_PATH = path.join(GENERATED_ROOT, 'manifest.json');
const REPORT_PATH = path.join(META_ROOT, 'build-report.json');
const COMBATANT_INTERNAL_PX = 128;
const PIXEL_STRICT = process.env.PIXEL_STRICT === '1';

const REQUIRED_TAGS = ['idle', 'walk', 'attack', 'cast', 'hit', 'die'];
const EMOTION_STATES = ['neutro', 'ferido', 'buffado', 'amaldicoado'];
const REQUIRED_COMBAT_CLIPS = ['idle', 'walk', 'attack', 'cast', 'hit', 'die'];

const PARTY_FILE_REGEX = /^[a-z0-9]+_[a-z0-9]+_(neutro|ferido|buffado|amaldicoado)\.aseprite$/;
const FRAME_STATE_REGEX =
  /^(neutro|ferido|buffado|amaldicoado)_(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/;
const FRAME_LEGACY_REGEX = /^(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/;

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const walk = async (dirPath) => {
  const out = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(absolute)));
      continue;
    }
    out.push(absolute);
  }
  return out;
};

const styleForClass = (classId) => {
  if (classId === 'mecanico') return 'bruiser';
  if (classId === 'ocultista') return 'guardian';
  return 'player';
};

const styleForEnemyTags = (tags) => {
  if (tags.includes('machine')) return 'guardian';
  if (tags.includes('cult')) return 'spitter';
  if (tags.includes('beast')) return 'stalker';
  return 'stalker';
};

const CORE_ENEMY_VISUALS = [
  { visualKey: 'enemy:beast', style: 'stalker' },
  { visualKey: 'enemy:cult', style: 'spitter' },
  { visualKey: 'enemy:machine', style: 'guardian' },
  { visualKey: 'enemy:default', style: 'stalker' },
];

const normalizeManifest = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      artDirection: {},
      atlases: [],
      combatants: [],
      uiIcons: [],
      diceFaces: [],
      biomeThemes: [],
    };
  }

  const rootManifest = input;
  return {
    version: Number.isFinite(Number(rootManifest.version)) ? Number(rootManifest.version) : 1,
    generatedAt:
      typeof rootManifest.generatedAt === 'string'
        ? rootManifest.generatedAt
        : new Date().toISOString(),
    artDirection:
      rootManifest.artDirection &&
      typeof rootManifest.artDirection === 'object' &&
      !Array.isArray(rootManifest.artDirection)
        ? rootManifest.artDirection
        : {},
    atlases: Array.isArray(rootManifest.atlases) ? rootManifest.atlases : [],
    combatants: Array.isArray(rootManifest.combatants) ? rootManifest.combatants : [],
    uiIcons: Array.isArray(rootManifest.uiIcons) ? rootManifest.uiIcons : [],
    diceFaces: Array.isArray(rootManifest.diceFaces) ? rootManifest.diceFaces : [],
    biomeThemes: Array.isArray(rootManifest.biomeThemes) ? rootManifest.biomeThemes : [],
  };
};

const isState = (value) => EMOTION_STATES.includes(value);

const normalizeStates = (value) => {
  if (!Array.isArray(value)) {
    return [...EMOTION_STATES];
  }
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !isState(entry) || out.includes(entry)) {
      continue;
    }
    out.push(entry);
  }
  return out.length > 0 ? out : [...EMOTION_STATES];
};

const paletteFromVisualKey = (visualKey) => {
  if (typeof visualKey !== 'string') {
    return 'default';
  }
  const parts = visualKey.split(':');
  if (parts.length < 2) {
    return visualKey;
  }
  return parts[1] || 'default';
};

const normalizeMetaPath = (metaPath) => {
  if (typeof metaPath !== 'string' || metaPath.trim().length === 0) {
    return '';
  }
  const trimmed = metaPath.trim();
  if (trimmed.startsWith('/')) {
    return path.join(root, trimmed.slice(1));
  }
  if (trimmed.startsWith('assets/')) {
    return path.join(root, trimmed);
  }
  if (trimmed.startsWith('meta/')) {
    return path.join(GENERATED_ROOT, trimmed);
  }
  return path.join(META_ROOT, trimmed);
};

const toFrameBase = (name) => {
  const slash = name.lastIndexOf('/');
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  return (dot >= 0 ? file.slice(0, dot) : file).toLowerCase();
};

const parseFrameName = (name) => {
  const base = toFrameBase(name);
  const stateMatch = base.match(FRAME_STATE_REGEX);
  if (stateMatch) {
    return {
      state: stateMatch[1],
      clip: stateMatch[2],
    };
  }
  const legacyMatch = base.match(FRAME_LEGACY_REGEX);
  if (legacyMatch) {
    return {
      state: null,
      clip: legacyMatch[1],
    };
  }
  return null;
};

const listMissing = (clips) => REQUIRED_COMBAT_CLIPS.filter((clip) => !clips.has(clip));

const validateCombatantMetadata = async (combatant) => {
  const errors = [];
  const warnings = [];
  const source = typeof combatant.source === 'string' ? combatant.source : 'procedural';
  if (source === 'procedural') {
    return { errors, warnings };
  }

  const visualKey = typeof combatant.visualKey === 'string' ? combatant.visualKey : '<sem-visual-key>';
  const metaPath = normalizeMetaPath(combatant.metaPath);
  if (!metaPath) {
    errors.push(`Combatant ${visualKey} sem metaPath.`);
    return { errors, warnings };
  }

  if (!(await exists(metaPath))) {
    errors.push(`Metadata ausente para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }

  const metadata = await readJson(metaPath, null);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push(`Metadata invalido para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }

  const frames = metadata.frames;
  if (!frames || typeof frames !== 'object' || Array.isArray(frames)) {
    errors.push(`Texture metadata sem objeto frames para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }

  const stateClips = new Map();
  const legacyClips = new Set();
  const invalidFrameNames = [];

  for (const frameName of Object.keys(frames)) {
    const parsed = parseFrameName(frameName);
    if (!parsed) {
      invalidFrameNames.push(frameName);
      continue;
    }

    if (parsed.state) {
      const bucket = stateClips.get(parsed.state) ?? new Set();
      bucket.add(parsed.clip);
      stateClips.set(parsed.state, bucket);
      continue;
    }

    legacyClips.add(parsed.clip);
  }

  for (const invalid of invalidFrameNames) {
    errors.push(
      `Frame fora do padrao em ${visualKey}: ${invalid} (esperado estado_clip_indice ou clip_indice).`,
    );
  }

  const supportedStates = normalizeStates(combatant.supportedStates);
  const defaultState = isState(combatant.defaultState) ? combatant.defaultState : 'neutro';
  if (!supportedStates.includes(defaultState)) {
    warnings.push(`Combatant ${visualKey} com defaultState fora de supportedStates (${defaultState}).`);
  }

  if (stateClips.size === 0) {
    if (legacyClips.size === 0) {
      errors.push(`Combatant ${visualKey} sem frames validos no metadata.`);
      return { errors, warnings };
    }
    const missingLegacy = listMissing(legacyClips);
    if (missingLegacy.length > 0) {
      warnings.push(`Combatant ${visualKey} (legado) sem clips: ${missingLegacy.join(', ')}.`);
    }

    const legacyCore = ['idle', 'attack', 'hit', 'die'].every((clip) => legacyClips.has(clip));
    if (legacyCore && (!legacyClips.has('walk') || !legacyClips.has('cast'))) {
      warnings.push(`Combatant ${visualKey} (legado) sem walk/cast no pacote atual.`);
    }

    return { errors, warnings };
  }

  for (const state of supportedStates) {
    const clips = stateClips.get(state);
    if (!clips) {
      warnings.push(`Combatant ${visualKey} sem estado ${state}.`);
      continue;
    }

    const missing = listMissing(clips);
    if (missing.length > 0) {
      warnings.push(`Combatant ${visualKey} estado ${state} sem clips: ${missing.join(', ')}.`);
    }

    const hasCore = ['idle', 'attack', 'hit', 'die'].every((clip) => clips.has(clip));
    if (hasCore && (!clips.has('walk') || !clips.has('cast'))) {
      warnings.push(`Combatant ${visualKey} estado ${state} sem walk/cast no pacote atual.`);
    }
  }

  return { errors, warnings };
};

const main = async () => {
  await ensureDir(path.join(RAW_ROOT, 'combat', 'party'));
  await ensureDir(path.join(RAW_ROOT, 'combat', 'enemies'));
  await ensureDir(path.join(RAW_ROOT, 'ui', 'dice_faces'));
  await ensureDir(path.join(RAW_ROOT, 'ui', 'icons'));
  await ensureDir(META_ROOT);

  const files = (await walk(RAW_ROOT)).filter((entry) => entry.endsWith('.aseprite'));

  const namingIssues = [];
  const metadataIssues = [];
  const warnings = [];

  for (const filePath of files) {
    const relative = path.relative(RAW_ROOT, filePath).replace(/\\/g, '/');
    const base = path.basename(filePath);
    const inParty = relative.startsWith('combat/party/');

    if (inParty && !PARTY_FILE_REGEX.test(base)) {
      namingIssues.push(`Nome invalido (party): ${path.relative(root, filePath)}`);
    } else if (!/^[a-z0-9_\-]+\.aseprite$/.test(base)) {
      namingIssues.push(`Nome invalido: ${path.relative(root, filePath)}`);
    }

    const jsonCandidate = `${filePath}.json`;
    const hasMetadata = await exists(jsonCandidate);
    if (!hasMetadata) {
      continue;
    }

    const metadata = await readJson(jsonCandidate, null);
    const tags =
      metadata && metadata.meta && Array.isArray(metadata.meta.frameTags)
        ? metadata.meta.frameTags.map((entry) =>
            entry && typeof entry.name === 'string' ? entry.name : '',
          )
        : [];

    const missing = REQUIRED_TAGS.filter((tag) => !tags.includes(tag));
    if (missing.length > 0) {
      metadataIssues.push(
        `Tags faltando (${missing.join(', ')}): ${path.relative(root, jsonCandidate)}`,
      );
    }
  }

  const existingManifest = normalizeManifest(await readJson(MANIFEST_PATH, null));
  const originalManifest = JSON.parse(JSON.stringify(existingManifest));

  const classes = await readJson(path.join(root, 'content', 'classes', 'core-classes.json'), []);
  const enemies = await readJson(path.join(root, 'content', 'enemies', 'core-enemies.json'), []);

  const generatedCombatants = [];

  for (const classDef of Array.isArray(classes) ? classes : []) {
    if (!classDef || typeof classDef !== 'object' || typeof classDef.id !== 'string') {
      continue;
    }
    generatedCombatants.push({
      visualKey: `party:${classDef.id}`,
      source: 'procedural',
      style: styleForClass(classDef.id),
      width: COMBATANT_INTERNAL_PX,
      height: COMBATANT_INTERNAL_PX,
      anchorX: 0.5,
      anchorY: 1,
      supportedStates: [...EMOTION_STATES],
      defaultState: 'neutro',
      paletteId: classDef.id,
      framePattern: 'state_clip_index',
    });
  }

  const enemyTagSet = new Set();
  for (const enemyDef of Array.isArray(enemies) ? enemies : []) {
    const tags = Array.isArray(enemyDef?.tags)
      ? enemyDef.tags.filter((entry) => typeof entry === 'string')
      : [];
    for (const tag of tags) {
      enemyTagSet.add(tag);
    }
  }

  for (const tag of enemyTagSet) {
    generatedCombatants.push({
      visualKey: `enemy:${tag}`,
      source: 'procedural',
      style: styleForEnemyTags([tag]),
      width: COMBATANT_INTERNAL_PX,
      height: COMBATANT_INTERNAL_PX,
      anchorX: 0.5,
      anchorY: 1,
      supportedStates: [...EMOTION_STATES],
      defaultState: 'neutro',
      paletteId: String(tag),
      framePattern: 'state_clip_index',
    });
  }

  for (const entry of CORE_ENEMY_VISUALS) {
    generatedCombatants.push({
      visualKey: entry.visualKey,
      source: 'procedural',
      style: entry.style,
      width: COMBATANT_INTERNAL_PX,
      height: COMBATANT_INTERNAL_PX,
      anchorX: 0.5,
      anchorY: 1,
      supportedStates: [...EMOTION_STATES],
      defaultState: 'neutro',
      paletteId: paletteFromVisualKey(entry.visualKey),
      framePattern: 'state_clip_index',
    });
  }

  const generatedByKey = new Map(generatedCombatants.map((entry) => [entry.visualKey, entry]));
  const mergedCombatants = [];

  for (const current of existingManifest.combatants) {
    if (!current || typeof current !== 'object') {
      mergedCombatants.push(current);
      continue;
    }

    const currentKey = typeof current.visualKey === 'string' ? current.visualKey : '';
    if (!currentKey) {
      mergedCombatants.push({ ...current });
      continue;
    }

    const generated = generatedByKey.get(currentKey);
    if (!generated) {
      mergedCombatants.push({ ...current });
      continue;
    }

    const currentSource = typeof current.source === 'string' ? current.source : 'procedural';
    if (currentSource !== 'procedural') {
      mergedCombatants.push({ ...current });
      generatedByKey.delete(currentKey);
      continue;
    }

    mergedCombatants.push({ ...current, ...generated });
    generatedByKey.delete(currentKey);
  }

  for (const generated of generatedByKey.values()) {
    mergedCombatants.push(generated);
  }

  for (const entry of mergedCombatants) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    entry.width = COMBATANT_INTERNAL_PX;
    entry.height = COMBATANT_INTERNAL_PX;
    entry.anchorX = 0.5;
    entry.anchorY = 1;
    entry.supportedStates = normalizeStates(entry.supportedStates);
    entry.defaultState = isState(entry.defaultState) ? entry.defaultState : 'neutro';
    entry.paletteId =
      typeof entry.paletteId === 'string' && entry.paletteId.length > 0
        ? entry.paletteId
        : paletteFromVisualKey(entry.visualKey);
    entry.framePattern =
      entry.framePattern === 'legacy' || entry.framePattern === 'state_clip_index'
        ? entry.framePattern
        : 'state_clip_index';
  }

  for (const entry of mergedCombatants) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const validation = await validateCombatantMetadata(entry);
    metadataIssues.push(...validation.errors);
    warnings.push(...validation.warnings);
  }

  const artDirection = {
    version:
      typeof existingManifest.artDirection?.version === 'string'
        ? existingManifest.artDirection.version
        : '1.0.0',
    combatantInternalPx: COMBATANT_INTERNAL_PX,
    mapMiniatureInternalPx: COMBATANT_INTERNAL_PX,
    anchorX: 0.5,
    anchorY: 1,
    shadingLevelsMin: 2,
    shadingLevelsMax: 3,
    antiAliasing: false,
    blur: false,
    contrast: 'high',
  };

  const candidateManifest = {
    ...existingManifest,
    version: 1,
    artDirection,
    combatants: mergedCombatants,
  };
  const existingSignature = JSON.stringify({ ...originalManifest, generatedAt: '' });
  const nextSignature = JSON.stringify({ ...candidateManifest, generatedAt: '' });
  const generatedAt =
    originalManifest.generatedAt && existingSignature === nextSignature
      ? originalManifest.generatedAt
      : new Date().toISOString();

  const nextManifest = {
    ...candidateManifest,
    generatedAt,
  };

  const fullNext = JSON.stringify(nextManifest, null, 2);
  const fullPrev = JSON.stringify(originalManifest, null, 2);
  if (fullNext !== fullPrev) {
    await fs.writeFile(MANIFEST_PATH, `${fullNext}\n`, 'utf8');
  }

  const errors = [...namingIssues, ...metadataIssues];

  const report = {
    generatedAt: nextManifest.generatedAt,
    strictMode: PIXEL_STRICT,
    asepriteFileCount: files.length,
    combatantCount: mergedCombatants.length,
    namingIssues,
    metadataIssues,
    errors,
    warnings,
  };

  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (errors.length > 0 || (PIXEL_STRICT && warnings.length > 0)) {
    console.error('[assets:build] Validacao falhou.');
    for (const issue of errors) {
      console.error(` - ERROR: ${issue}`);
    }
    if (PIXEL_STRICT) {
      for (const warning of warnings) {
        console.error(` - WARNING->ERROR: ${warning}`);
      }
    } else {
      for (const warning of warnings) {
        console.warn(` - WARNING: ${warning}`);
      }
    }
    process.exit(1);
  }

  for (const warning of warnings) {
    console.warn(` - WARNING: ${warning}`);
  }
  console.log(`[assets:build] Manifest atualizado em ${path.relative(root, MANIFEST_PATH)}.`);
  console.log(`[assets:build] Relatorio em ${path.relative(root, REPORT_PATH)}.`);
};

main().catch((error) => {
  console.error('[assets:build] Erro inesperado:', error);
  process.exit(1);
});
