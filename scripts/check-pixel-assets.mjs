#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const MANIFEST_PATH = path.join(root, 'assets', 'generated', 'pixel', 'manifest.json');
const MAX_ATLAS_DIM = 2048;
const MAX_TEXTURE_BUDGET_BYTES = 40 * 1024 * 1024;
const COMBATANT_INTERNAL_PX = 128;
const REQUIRED_CLIPS = ['idle', 'walk', 'attack', 'cast', 'hit', 'die'];
const CORE_CLIPS = ['idle', 'attack', 'hit', 'die'];
const STATE_REGEX =
  /^(neutro|ferido|buffado|amaldicoado)_(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/;
const LEGACY_REGEX = /^(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/;

const CRITICAL_ICON_IDS = ['status.block', 'status.poison', 'resource.gold', 'node.combat'];

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizeAssetPath = (assetPath) => {
  if (assetPath.startsWith('/')) {
    return path.join(root, assetPath.slice(1));
  }
  if (assetPath.startsWith('assets/')) {
    return path.join(root, assetPath);
  }
  if (assetPath.startsWith('atlas/') || assetPath.startsWith('meta/')) {
    return path.join(root, 'assets', 'generated', 'pixel', assetPath);
  }
  return path.join(root, 'assets', 'generated', 'pixel', assetPath);
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
    return path.join(root, 'assets', 'generated', 'pixel', trimmed);
  }
  return path.join(root, 'assets', 'generated', 'pixel', 'meta', trimmed);
};

const toFrameBase = (name) => {
  const slash = name.lastIndexOf('/');
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  return (dot >= 0 ? file.slice(0, dot) : file).toLowerCase();
};

const parseFrame = (name) => {
  const base = toFrameBase(name);
  const stateMatch = base.match(STATE_REGEX);
  if (stateMatch) {
    return { state: stateMatch[1], clip: stateMatch[2] };
  }
  const legacyMatch = base.match(LEGACY_REGEX);
  if (legacyMatch) {
    return { state: null, clip: legacyMatch[1] };
  }
  return null;
};

const missingClips = (clips) => REQUIRED_CLIPS.filter((clip) => !clips.has(clip));

const validateCombatantMeta = async (combatant) => {
  const errors = [];
  const warnings = [];
  const visualKey = typeof combatant.visualKey === 'string' ? combatant.visualKey : '<sem-visual-key>';
  const source = typeof combatant.source === 'string' ? combatant.source : 'procedural';
  if (source === 'procedural') {
    return { errors, warnings };
  }

  const metaPath = normalizeMetaPath(combatant.metaPath);
  if (!metaPath) {
    errors.push(`Combatant ${visualKey} sem metaPath.`);
    return { errors, warnings };
  }
  if (!(await exists(metaPath))) {
    errors.push(`Metadata ausente para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }

  const metadata = await readJson(metaPath);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push(`Metadata invalido para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }
  const frames = metadata.frames;
  if (!frames || typeof frames !== 'object' || Array.isArray(frames)) {
    errors.push(`Metadata sem objeto frames para ${visualKey}: ${path.relative(root, metaPath)}`);
    return { errors, warnings };
  }

  const framePattern = combatant.framePattern === 'legacy' ? 'legacy' : 'state_clip_index';
  const stateBuckets = new Map();
  const legacyBucket = new Set();

  for (const frameName of Object.keys(frames)) {
    const parsed = parseFrame(frameName);
    if (!parsed) {
      if (framePattern === 'state_clip_index') {
        errors.push(`Frame fora do padrao state_clip_index em ${visualKey}: ${frameName}`);
      }
      continue;
    }

    if (parsed.state) {
      const bucket = stateBuckets.get(parsed.state) ?? new Set();
      bucket.add(parsed.clip);
      stateBuckets.set(parsed.state, bucket);
      continue;
    }

    legacyBucket.add(parsed.clip);
  }

  const supportedStates = Array.isArray(combatant.supportedStates)
    ? combatant.supportedStates.filter((entry) => typeof entry === 'string')
    : ['neutro', 'ferido', 'buffado', 'amaldicoado'];

  if (stateBuckets.size === 0 && legacyBucket.size === 0) {
    errors.push(`Combatant ${visualKey} sem frames reconhecidos.`);
    return { errors, warnings };
  }

  if (stateBuckets.size > 0) {
    for (const state of supportedStates) {
      const clips = stateBuckets.get(state);
      if (!clips) {
        warnings.push(`Combatant ${visualKey} sem estado ${state}.`);
        continue;
      }
      const missing = missingClips(clips);
      if (missing.length > 0) {
        warnings.push(`Combatant ${visualKey} estado ${state} sem clips: ${missing.join(', ')}.`);
      }
      const hasCore = CORE_CLIPS.every((clip) => clips.has(clip));
      if (hasCore && (!clips.has('walk') || !clips.has('cast'))) {
        warnings.push(`Combatant ${visualKey} estado ${state} sem walk/cast no MVP.`);
      }
    }
    return { errors, warnings };
  }

  const missingLegacy = missingClips(legacyBucket);
  if (missingLegacy.length > 0) {
    warnings.push(`Combatant ${visualKey} (legado) sem clips: ${missingLegacy.join(', ')}.`);
  }
  const legacyCore = CORE_CLIPS.every((clip) => legacyBucket.has(clip));
  if (legacyCore && (!legacyBucket.has('walk') || !legacyBucket.has('cast'))) {
    warnings.push(`Combatant ${visualKey} (legado) sem walk/cast no MVP.`);
  }

  return { errors, warnings };
};

const main = async () => {
  if (!(await exists(MANIFEST_PATH))) {
    throw new Error(`Manifest nao encontrado: ${path.relative(root, MANIFEST_PATH)}`);
  }

  const manifest = await readJson(MANIFEST_PATH);
  const errors = [];
  const warnings = [];

  const atlases = Array.isArray(manifest.atlases) ? manifest.atlases : [];
  let estimatedBytes = 0;

  for (const atlas of atlases) {
    const id = typeof atlas?.id === 'string' ? atlas.id : '<sem-id>';
    const width = Number(atlas?.width ?? 0);
    const height = Number(atlas?.height ?? 0);

    if (width <= 0 || height <= 0) {
      errors.push(`Atlas ${id} sem dimensoes validas.`);
      continue;
    }

    if (width > MAX_ATLAS_DIM || height > MAX_ATLAS_DIM) {
      errors.push(`Atlas ${id} excede limite ${MAX_ATLAS_DIM}x${MAX_ATLAS_DIM} (${width}x${height}).`);
    }

    estimatedBytes += width * height * 4;

    const atlasPath = typeof atlas?.path === 'string' ? atlas.path : '';
    if (!atlasPath) {
      errors.push(`Atlas ${id} sem path.`);
      continue;
    }

    const fullPath = normalizeAssetPath(atlasPath);
    if (!(await exists(fullPath))) {
      errors.push(`Arquivo de atlas ausente: ${path.relative(root, fullPath)}`);
    }
  }

  if (estimatedBytes > MAX_TEXTURE_BUDGET_BYTES) {
    errors.push(
      `Orcamento de texturas excedido: ${estimatedBytes} bytes > ${MAX_TEXTURE_BUDGET_BYTES} bytes.`,
    );
  }

  const combatants = Array.isArray(manifest.combatants) ? manifest.combatants : [];
  for (const combatant of combatants) {
    if (!combatant || typeof combatant !== 'object') {
      continue;
    }

    const visualKey = typeof combatant.visualKey === 'string' ? combatant.visualKey : '<sem-visual-key>';
    const source = typeof combatant.source === 'string' ? combatant.source : 'procedural';

    if (source !== 'procedural') {
      if (!combatant.atlasId || typeof combatant.atlasId !== 'string') {
        errors.push(`Combatant ${visualKey} sem atlasId.`);
      }
      if (!combatant.metaPath || typeof combatant.metaPath !== 'string') {
        errors.push(`Combatant ${visualKey} sem metaPath.`);
      }
      if (Number(combatant.width) !== COMBATANT_INTERNAL_PX || Number(combatant.height) !== COMBATANT_INTERNAL_PX) {
        errors.push(`Combatant ${visualKey} deve usar ${COMBATANT_INTERNAL_PX}x${COMBATANT_INTERNAL_PX}.`);
      }
      if (Number(combatant.anchorX) !== 0.5 || Number(combatant.anchorY) !== 1) {
        errors.push(`Combatant ${visualKey} deve usar ancora padrao (0.5, 1).`);
      }
      const metaValidation = await validateCombatantMeta(combatant);
      errors.push(...metaValidation.errors);
      warnings.push(...metaValidation.warnings);
    }
  }

  const uiIcons = Array.isArray(manifest.uiIcons) ? manifest.uiIcons : [];
  const iconById = new Map();
  for (const icon of uiIcons) {
    if (icon && typeof icon.id === 'string') {
      iconById.set(icon.id, icon);
    }
  }

  const diceFaces = Array.isArray(manifest.diceFaces) ? manifest.diceFaces : [];

  for (const id of CRITICAL_ICON_IDS) {
    const icon = iconById.get(id);
    if (!icon) {
      errors.push(`Icone critico ausente: ${id}`);
      continue;
    }

    const directContrast = typeof icon.contrastIconId === 'string' ? icon.contrastIconId : null;
    const bindingContrast = diceFaces.find((entry) => entry?.iconId === id)?.contrastIconId;
    if (!directContrast && !bindingContrast) {
      errors.push(`Icone critico sem variante de contraste: ${id}`);
    }
  }

  if (warnings.length > 0) {
    console.warn('[assets:check] Avisos:');
    for (const warning of warnings) {
      console.warn(` - ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error('[assets:check] Falhou com os seguintes problemas:');
    for (const issue of errors) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  const estimatedMb = (estimatedBytes / (1024 * 1024)).toFixed(2);
  console.log(
    `[assets:check] OK. Atlases=${atlases.length}, memoria estimada=${estimatedMb} MB, warnings=${warnings.length}.`,
  );
};

main().catch((error) => {
  console.error('[assets:check] Erro inesperado:', error);
  process.exit(1);
});
