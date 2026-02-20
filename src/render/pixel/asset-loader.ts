import {
  importAseprite,
  importTexturePacker,
  loadAtlasFromUrl,
  type AnimationFacing,
  type AnimationSet,
  type AtlasSource,
} from '@voxelyn/animation';
import type { ProceduralStyle, BiomeThemeDef, ClipBindingDef, PixelAssetManifest, UiIconDef } from './types';

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

  return {
    version: asNumber(root.version, 1),
    generatedAt: asString(root.generatedAt, new Date(0).toISOString()),
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
  options: { isEnemy?: boolean; width?: number; height?: number } = {},
): Promise<LoadedCombatantAnimation | null> => {
  const cacheKey = `${visualKey}:${options.isEnemy ? 'enemy' : 'party'}`;
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
        : importTexturePacker(metadata, atlas);

    return {
      set: imported.set,
      width: binding.width ?? options.width ?? 32,
      height: binding.height ?? options.height ?? 32,
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
