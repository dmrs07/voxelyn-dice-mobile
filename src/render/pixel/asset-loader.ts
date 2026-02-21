import {
  importAseprite,
  importTexturePacker,
  loadAtlasFromUrl,
  type AnimationFacing,
  type AnimationSet,
  type AtlasSource,
} from '@voxelyn/animation';
import type {
  ProceduralStyle,
  BiomeThemeDef,
  ClipBindingDef,
  CombatantEmotionState,
  PixelAssetManifest,
  PixelArtDirectionDef,
  UiIconDef,
} from './types';
import { COMBATANT_INTERNAL_PX } from './constants';

const MANIFEST_MODULES = import.meta.glob('/assets/generated/pixel/manifest.json', {
  eager: true,
}) as Record<string, { default?: unknown } | unknown>;

const META_MODULES = import.meta.glob('/assets/generated/pixel/meta/**/*.json', {
  eager: true,
}) as Record<string, { default?: unknown } | unknown>;

const FALLBACK_MANIFEST: PixelAssetManifest = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  atlases: [],
  combatants: [],
  uiIcons: [],
  diceFaces: [],
  biomeThemes: [],
};

const EMOTION_STATES: CombatantEmotionState[] = [
  'neutro',
  'ferido',
  'buffado',
  'amaldicoado',
];
const EMOTION_STATE_SET = new Set<CombatantEmotionState>(EMOTION_STATES);
const FRAME_BASICS = ['idle', 'walk', 'attack', 'cast', 'hit', 'die'] as const;

type TexturePackerFrameEntry = {
  frame: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  duration?: number;
};

type TexturePackerLike = {
  frames: Record<string, TexturePackerFrameEntry>;
  [key: string]: unknown;
};

const unwrapModule = (entry: { default?: unknown } | unknown): unknown => {
  if (typeof entry === 'object' && entry !== null && 'default' in entry) {
    return (entry as { default?: unknown }).default;
  }
  return entry;
};

const asNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const asEmotionState = (
  value: unknown,
  fallback: CombatantEmotionState = 'neutro',
): CombatantEmotionState => {
  const text = asString(value);
  return EMOTION_STATE_SET.has(text as CombatantEmotionState)
    ? (text as CombatantEmotionState)
    : fallback;
};

const asEmotionStateList = (value: unknown): CombatantEmotionState[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CombatantEmotionState[] = [];
  for (const entry of value) {
    const state = asEmotionState(entry, 'neutro');
    if (!out.includes(state)) {
      out.push(state);
    }
  }
  return out;
};

const asObjectList = <T>(
  value: unknown,
  projector: (entry: Record<string, unknown>) => T | null,
): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: T[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const projected = projector(entry as Record<string, unknown>);
    if (projected) {
      out.push(projected);
    }
  }
  return out;
};

const parseManifest = (raw: unknown): PixelAssetManifest => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return FALLBACK_MANIFEST;
  }

  const root = raw as Record<string, unknown>;

  const atlases = asObjectList(root.atlases, (entry) => {
    const id = asString(entry.id);
    const path = asString(entry.path);
    if (!id || !path) {
      return null;
    }
    return {
      id,
      path,
      width: asNumber(entry.width, 0),
      height: asNumber(entry.height, 0),
      domain: ['combat', 'ui', 'tiles', 'misc'].includes(asString(entry.domain))
        ? (asString(entry.domain) as 'combat' | 'ui' | 'tiles' | 'misc')
        : undefined,
    };
  });

  const combatants = asObjectList(root.combatants, (entry) => {
    const visualKey = asString(entry.visualKey);
    const sourceRaw = asString(entry.source, 'procedural');
    if (!visualKey) {
      return null;
    }
    const source: ClipBindingDef['source'] =
      sourceRaw === 'aseprite' || sourceRaw === 'texturepacker' || sourceRaw === 'procedural'
        ? sourceRaw
        : 'procedural';

    const supportedStates = asEmotionStateList(entry.supportedStates);
    const framePatternRaw = asString(entry.framePattern);
    const framePattern: ClipBindingDef['framePattern'] =
      framePatternRaw === 'state_clip_index' || framePatternRaw === 'legacy'
        ? framePatternRaw
        : undefined;

    return {
      visualKey,
      source,
      atlasId: asString(entry.atlasId) || undefined,
      metaPath: asString(entry.metaPath) || undefined,
      width: asNumber(entry.width, 0) || undefined,
      height: asNumber(entry.height, 0) || undefined,
      anchorX: asNumber(entry.anchorX, 0.5),
      anchorY: asNumber(entry.anchorY, 1),
      style: asString(entry.style) as ProceduralStyle,
      facing: asString(entry.facing) as AnimationFacing,
      seedHint: asString(entry.seedHint) || undefined,
      supportedStates: supportedStates.length > 0 ? supportedStates : undefined,
      defaultState: asEmotionState(entry.defaultState, 'neutro'),
      paletteId: asString(entry.paletteId) || undefined,
      framePattern,
    };
  });

  const uiIcons = asObjectList(root.uiIcons, (entry) => {
    const id = asString(entry.id);
    if (!id) {
      return null;
    }

    const frameRaw = entry.frame;
    let frame;
    if (frameRaw && typeof frameRaw === 'object' && !Array.isArray(frameRaw)) {
      const frameRecord = frameRaw as Record<string, unknown>;
      frame = {
        x: asNumber(frameRecord.x, 0),
        y: asNumber(frameRecord.y, 0),
        w: asNumber(frameRecord.w, 0),
        h: asNumber(frameRecord.h, 0),
      };
    }

    return {
      id,
      atlasId: asString(entry.atlasId) || undefined,
      frame,
      fallbackKind: asString(entry.fallbackKind) || undefined,
      contrastIconId: asString(entry.contrastIconId) || undefined,
    } satisfies UiIconDef;
  });

  const diceFaces = asObjectList(root.diceFaces, (entry) => {
    const iconId = asString(entry.iconId);
    if (!iconId) {
      return null;
    }

    return {
      faceId: asString(entry.faceId) || undefined,
      kind: asString(entry.kind) || undefined,
      iconId,
      contrastIconId: asString(entry.contrastIconId) || undefined,
    };
  });

  const biomeThemes = asObjectList(root.biomeThemes, (entry) => {
    const biomeId = asString(entry.biomeId);
    if (!biomeId) {
      return null;
    }
    return {
      biomeId,
      palette: asStringList(entry.palette),
      uiFrame: asString(entry.uiFrame),
    };
  });

  let artDirection: PixelArtDirectionDef | undefined;
  if (root.artDirection && typeof root.artDirection === 'object' && !Array.isArray(root.artDirection)) {
    const art = root.artDirection as Record<string, unknown>;
    artDirection = {
      version: asString(art.version, '1.0.0'),
      combatantInternalPx: asNumber(art.combatantInternalPx, COMBATANT_INTERNAL_PX),
      mapMiniatureInternalPx: asNumber(art.mapMiniatureInternalPx, COMBATANT_INTERNAL_PX),
      anchorX: asNumber(art.anchorX, 0.5),
      anchorY: asNumber(art.anchorY, 1),
      shadingLevelsMin: asNumber(art.shadingLevelsMin, 2),
      shadingLevelsMax: asNumber(art.shadingLevelsMax, 3),
      antiAliasing: Boolean(art.antiAliasing),
      blur: Boolean(art.blur),
      contrast: 'high',
    };
  }

  return {
    version: asNumber(root.version, 1),
    generatedAt: asString(root.generatedAt, new Date(0).toISOString()),
    artDirection,
    atlases,
    combatants,
    uiIcons,
    diceFaces,
    biomeThemes,
  };
};

const resolveManifestRaw = (): unknown => {
  const keys = Object.keys(MANIFEST_MODULES);
  if (keys.length === 0) {
    return FALLBACK_MANIFEST;
  }
  return unwrapModule(MANIFEST_MODULES[keys[0] as string]);
};

const normalizeAssetPath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  if (trimmed.startsWith('assets/')) {
    return `/${trimmed}`;
  }
  return `/assets/generated/pixel/${trimmed.replace(/^\.\//, '')}`;
};

const normalizeMetaPath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('/assets/generated/pixel/meta/')) {
    return trimmed;
  }
  if (trimmed.startsWith('assets/generated/pixel/meta/')) {
    return `/${trimmed}`;
  }
  if (trimmed.startsWith('meta/')) {
    return `/assets/generated/pixel/${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `/assets/generated/pixel/meta/${trimmed.slice(1)}`;
  }
  return `/assets/generated/pixel/meta/${trimmed}`;
};

const resolveMetaRaw = (path: string): unknown | null => {
  const normalized = normalizeMetaPath(path);
  const exact = META_MODULES[normalized];
  if (exact !== undefined) {
    return unwrapModule(exact);
  }

  for (const [key, moduleValue] of Object.entries(META_MODULES)) {
    if (key.endsWith(path)) {
      return unwrapModule(moduleValue);
    }
  }

  return null;
};

const toFrameBaseName = (name: string): string => {
  const slashAt = name.lastIndexOf('/');
  const withFileName = slashAt >= 0 ? name.slice(slashAt + 1) : name;
  const dotAt = withFileName.lastIndexOf('.');
  return dotAt >= 0 ? withFileName.slice(0, dotAt) : withFileName;
};

const parseClipFrameKey = (
  name: string,
): { state?: CombatantEmotionState; clip: (typeof FRAME_BASICS)[number]; index: number } | null => {
  const base = toFrameBaseName(name).toLowerCase();
  const withState = base.match(
    /^(neutro|ferido|buffado|amaldicoado)_(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/,
  );
  if (withState) {
    return {
      state: withState[1] as CombatantEmotionState,
      clip: withState[2] as (typeof FRAME_BASICS)[number],
      index: Number.parseInt(withState[3] ?? '0', 10) || 0,
    };
  }

  const legacy = base.match(/^(idle|walk|attack|cast|hit|die)(?:[_-](\d+))?$/);
  if (legacy) {
    return {
      clip: legacy[1] as (typeof FRAME_BASICS)[number],
      index: Number.parseInt(legacy[2] ?? '0', 10) || 0,
    };
  }

  return null;
};

const asTexturePacker = (metadata: unknown): TexturePackerLike | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const root = metadata as Record<string, unknown>;
  if (!root.frames || typeof root.frames !== 'object' || Array.isArray(root.frames)) {
    return null;
  }

  return root as TexturePackerLike;
};

const resolveEmotionState = (
  binding: ClipBindingDef,
  requested?: CombatantEmotionState,
): CombatantEmotionState => {
  const supported = binding.supportedStates && binding.supportedStates.length > 0
    ? binding.supportedStates
    : EMOTION_STATES;
  const fallbackState = EMOTION_STATE_SET.has(binding.defaultState ?? 'neutro')
    ? (binding.defaultState ?? 'neutro')
    : 'neutro';
  const desired = requested ?? fallbackState;
  return supported.includes(desired) ? desired : fallbackState;
};

const pickStatefulTexturePacker = (
  metadata: unknown,
  binding: ClipBindingDef,
  requestedState?: CombatantEmotionState,
): unknown => {
  const parsed = asTexturePacker(metadata);
  if (!parsed) {
    return metadata;
  }

  const statefulFrames = new Map<CombatantEmotionState, Record<string, TexturePackerFrameEntry>>();
  const legacyFrames: Record<string, TexturePackerFrameEntry> = {};

  for (const [frameName, frameValue] of Object.entries(parsed.frames)) {
    if (!frameValue || typeof frameValue !== 'object' || !('frame' in frameValue)) {
      continue;
    }
    const parsedKey = parseClipFrameKey(frameName);
    if (!parsedKey) {
      continue;
    }

    const normalizedKey = `${parsedKey.clip}_${parsedKey.index}.png`;
    if (parsedKey.state) {
      const bucket = statefulFrames.get(parsedKey.state) ?? {};
      if (!bucket[normalizedKey]) {
        bucket[normalizedKey] = frameValue;
      }
      statefulFrames.set(parsedKey.state, bucket);
      continue;
    }

    if (!legacyFrames[normalizedKey]) {
      legacyFrames[normalizedKey] = frameValue;
    }
  }

  const supported = binding.supportedStates && binding.supportedStates.length > 0
    ? binding.supportedStates
    : EMOTION_STATES;
  const requested = resolveEmotionState(binding, requestedState);
  const fallbacks: CombatantEmotionState[] = [requested];
  if (!fallbacks.includes('neutro')) {
    fallbacks.push('neutro');
  }
  for (const entry of supported) {
    if (!fallbacks.includes(entry)) {
      fallbacks.push(entry);
    }
  }

  for (const state of fallbacks) {
    const selected = statefulFrames.get(state);
    if (selected && Object.keys(selected).length > 0) {
      return {
        ...parsed,
        frames: selected,
      };
    }
  }

  if (Object.keys(legacyFrames).length > 0) {
    return {
      ...parsed,
      frames: legacyFrames,
    };
  }

  return metadata;
};

let manifestCache: PixelAssetManifest | null = null;
let manifestPromise: Promise<PixelAssetManifest> | null = null;

const atlasPromiseCache = new Map<string, Promise<AtlasSource | null>>();
const atlasValueCache = new Map<string, AtlasSource | null>();

export interface LoadedCombatantAnimation {
  set: AnimationSet;
  width: number;
  height: number;
  facing: AnimationFacing;
  styleHint?: ProceduralStyle;
}

const combatantAnimationCache = new Map<string, Promise<LoadedCombatantAnimation | null>>();

export const loadPixelAssetManifest = async (): Promise<PixelAssetManifest> => {
  if (manifestCache) {
    return manifestCache;
  }
  if (manifestPromise) {
    return manifestPromise;
  }

  manifestPromise = Promise.resolve().then(() => {
    const parsed = parseManifest(resolveManifestRaw());
    manifestCache = parsed;
    return parsed;
  });

  return manifestPromise;
};

export const getPixelAssetManifest = (): PixelAssetManifest => {
  if (!manifestCache) {
    manifestCache = parseManifest(resolveManifestRaw());
  }
  return manifestCache;
};

const getAtlasEntry = (atlasId: string) =>
  getPixelAssetManifest().atlases.find((entry) => entry.id === atlasId);

const loadAtlasById = async (atlasId: string): Promise<AtlasSource | null> => {
  const cached = atlasPromiseCache.get(atlasId);
  if (cached) {
    return cached;
  }

  const atlasEntry = getAtlasEntry(atlasId);
  if (!atlasEntry) {
    atlasValueCache.set(atlasId, null);
    return null;
  }

  const promise = loadAtlasFromUrl(normalizeAssetPath(atlasEntry.path))
    .then((atlas) => {
      atlasValueCache.set(atlasId, atlas);
      return atlas;
    })
    .catch((error) => {
      console.warn(`[pixel-assets] Falha ao carregar atlas ${atlasId}:`, error);
      atlasValueCache.set(atlasId, null);
      return null;
    });

  atlasPromiseCache.set(atlasId, promise);
  return promise;
};

export const getLoadedAtlas = (atlasId: string): AtlasSource | null =>
  atlasValueCache.get(atlasId) ?? null;

export const warmPixelAssets = async (): Promise<void> => {
  const manifest = await loadPixelAssetManifest();
  await Promise.all(manifest.atlases.map((entry) => loadAtlasById(entry.id)));
};

export const findCombatantBinding = (visualKey: string): ClipBindingDef | null =>
  getPixelAssetManifest().combatants.find((entry) => entry.visualKey === visualKey) ?? null;

export const resolveCombatantFallbackStyle = (
  visualKey: string,
  isEnemy: boolean,
): ProceduralStyle => {
  const fromManifest = findCombatantBinding(visualKey)?.style;
  if (fromManifest) {
    return fromManifest;
  }
  return isEnemy ? 'stalker' : 'player';
};

export const loadCombatantAnimationSet = async (
  visualKey: string,
  options: {
    isEnemy?: boolean;
    width?: number;
    height?: number;
    state?: CombatantEmotionState;
  } = {},
): Promise<LoadedCombatantAnimation | null> => {
  const cacheKey = `${visualKey}:${options.isEnemy ? 'enemy' : 'party'}:${options.width ?? COMBATANT_INTERNAL_PX}:${options.height ?? COMBATANT_INTERNAL_PX}:${options.state ?? 'neutro'}`;
  const cached = combatantAnimationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    await loadPixelAssetManifest();
    const binding = findCombatantBinding(visualKey);
    if (!binding || binding.source === 'procedural') {
      return null;
    }

    if (!binding.atlasId || !binding.metaPath) {
      return null;
    }

    const atlas = await loadAtlasById(binding.atlasId);
    if (!atlas) {
      return null;
    }

    const metadata = resolveMetaRaw(binding.metaPath);
    if (!metadata) {
      console.warn(`[pixel-assets] Metadata ausente para ${visualKey}: ${binding.metaPath}`);
      return null;
    }

    const imported =
      binding.source === 'aseprite'
        ? importAseprite(metadata, atlas)
        : importTexturePacker(
            pickStatefulTexturePacker(metadata, binding, options.state),
            atlas,
          );

    return {
      set: imported.set,
      width: binding.width ?? options.width ?? COMBATANT_INTERNAL_PX,
      height: binding.height ?? options.height ?? COMBATANT_INTERNAL_PX,
      facing: binding.facing ?? (options.isEnemy ? 'dl' : 'dr'),
      styleHint: binding.style,
    } satisfies LoadedCombatantAnimation;
  })().catch((error) => {
    console.warn(`[pixel-assets] Falha ao importar animacao ${visualKey}:`, error);
    return null;
  });

  combatantAnimationCache.set(cacheKey, pending);
  return pending;
};

const buildUiIconMap = (): Map<string, UiIconDef> => {
  const map = new Map<string, UiIconDef>();
  for (const icon of getPixelAssetManifest().uiIcons) {
    map.set(icon.id, icon);
  }
  return map;
};

const avatarCache = new Map<string, string>();

const makeAvatarPlaceholder = (visualKey: string): string => {
  const cached = avatarCache.get(visualKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  let hash = 0;
  for (let i = 0; i < visualKey.length; i += 1) {
    hash = (hash * 33 + visualKey.charCodeAt(i)) >>> 0;
  }

  const r = 70 + (hash % 110);
  const g = 60 + ((hash >> 8) % 110);
  const b = 65 + ((hash >> 16) % 110);

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#080b14';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(6, 6, 52, 52);
  ctx.fillStyle = '#0f1322';
  ctx.fillRect(10, 10, 44, 44);
  ctx.fillStyle = `rgb(${Math.min(255, r + 45)}, ${Math.min(255, g + 45)}, ${Math.min(255, b + 45)})`;
  ctx.fillRect(18, 18, 28, 28);

  const keyChar = (visualKey.split(':')[1] ?? visualKey).slice(0, 1).toUpperCase();
  ctx.fillStyle = '#0a0d15';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(keyChar, 32, 32);

  const src = canvas.toDataURL('image/png');
  avatarCache.set(visualKey, src);
  return src;
};

export const resolveCombatantAvatarSrc = (visualKey: string): string => {
  const binding = findCombatantBinding(visualKey);
  if (binding?.atlasId) {
    const atlas = getAtlasEntry(binding.atlasId);
    if (atlas) {
      return normalizeAssetPath(atlas.path);
    }
  }

  const rawClassId = visualKey.includes(':') ? visualKey.split(':')[1] : visualKey;
  if (rawClassId) {
    const icon = getPixelAssetManifest().uiIcons.find((entry) => entry.id === `portrait.${rawClassId}`);
    if (icon?.atlasId) {
      const atlas = getAtlasEntry(icon.atlasId);
      if (atlas) {
        return normalizeAssetPath(atlas.path);
      }
    }
  }

  return makeAvatarPlaceholder(visualKey);
};

export const resolveDiceFaceIcon = (
  face: { id: string; kind: string },
  preferContrast = false,
): UiIconDef | null => {
  const manifest = getPixelAssetManifest();
  const binding =
    manifest.diceFaces.find((entry) => entry.faceId === face.id) ??
    manifest.diceFaces.find((entry) => entry.kind === face.kind);

  if (!binding) {
    return null;
  }

  const iconMap = buildUiIconMap();
  const direct = iconMap.get(binding.iconId) ?? null;

  if (!preferContrast) {
    return direct;
  }

  const contrastId = binding.contrastIconId ?? direct?.contrastIconId;
  if (!contrastId) {
    return direct;
  }

  return iconMap.get(contrastId) ?? direct;
};

export const getBiomeTheme = (biomeId: string): BiomeThemeDef | null =>
  getPixelAssetManifest().biomeThemes.find((entry) => entry.biomeId === biomeId) ?? null;
