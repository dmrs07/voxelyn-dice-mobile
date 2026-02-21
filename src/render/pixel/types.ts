import type { AnimationFacing, ProceduralCharacterDef } from '@voxelyn/animation';

export type ProceduralStyle = NonNullable<ProceduralCharacterDef['style']>;
export type CombatantEmotionState = 'neutro' | 'ferido' | 'buffado' | 'amaldicoado';
export type CombatantFramePattern = 'state_clip_index' | 'legacy';

export interface AtlasFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasEntry {
  id: string;
  path: string;
  width: number;
  height: number;
  domain?: 'combat' | 'ui' | 'tiles' | 'misc';
}

export interface ClipBindingDef {
  visualKey: string;
  source: 'aseprite' | 'texturepacker' | 'procedural';
  atlasId?: string;
  metaPath?: string;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  style?: ProceduralStyle;
  facing?: AnimationFacing;
  seedHint?: string;
  supportedStates?: CombatantEmotionState[];
  defaultState?: CombatantEmotionState;
  paletteId?: string;
  framePattern?: CombatantFramePattern;
}

export interface UiIconDef {
  id: string;
  atlasId?: string;
  frame?: AtlasFrameRect;
  fallbackKind?: string;
  contrastIconId?: string;
}

export interface DiceFaceBindingDef {
  faceId?: string;
  kind?: string;
  iconId: string;
  contrastIconId?: string;
}

export interface BiomeThemeDef {
  biomeId: string;
  palette: string[];
  uiFrame: string;
}

export interface PixelArtDirectionDef {
  version: string;
  combatantInternalPx: number;
  mapMiniatureInternalPx: number;
  anchorX: number;
  anchorY: number;
  shadingLevelsMin: number;
  shadingLevelsMax: number;
  antiAliasing: boolean;
  blur: boolean;
  contrast: 'high';
}

export interface PixelAssetManifest {
  version: number;
  generatedAt: string;
  artDirection?: PixelArtDirectionDef;
  atlases: AtlasEntry[];
  combatants: ClipBindingDef[];
  uiIcons: UiIconDef[];
  diceFaces: DiceFaceBindingDef[];
  biomeThemes: BiomeThemeDef[];
}
