#!/usr/bin/env node
/**
 * Import enemy sprites as 128x128 atlases and wire them into the manifest.
 *
 * Usage:
 *   node scripts/import-enemy-sprites.mjs /path/to/downloaded/pngs
 *   # or with npm
 *   npm run assets:import:enemies -- /path/to/downloaded/pngs
 *
 * - Sorts the source PNGs by creation time (ctime) to match the desired order
 * - Renames/maps to ids from content/enemies/core-enemies.json
 * - Resizes to 128x128 using nearest-neighbor (crisp)
 * - Saves to assets/generated/pixel/atlas/<enemy_id>.png
 * - Creates TexturePacker-like single-frame meta in assets/generated/pixel/meta/<enemy_id>.json
 * - Updates assets/generated/pixel/manifest.json with atlas + combatant bindings
 *
 * Requires: sharp (npm i -D sharp)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

let sharp;
try {
  // Lazy import to give a better error if missing
  ({ default: sharp } = await import('sharp'));
} catch (err) {
  console.error('[import-enemy-sprites] Missing dependency: sharp');
  console.error('  Install with: npm i -D sharp');
  process.exit(2);
}

const root = process.cwd();
const ASSETS_ROOT = path.join(root, 'assets', 'generated', 'pixel');
const ATLAS_DIR = path.join(ASSETS_ROOT, 'atlas');
const META_DIR = path.join(ASSETS_ROOT, 'meta');
const MANIFEST_PATH = path.join(ASSETS_ROOT, 'manifest.json');
const ENEMIES_JSON = path.join(root, 'content', 'enemies', 'core-enemies.json');
const SIZE = 128;

const ORDERED_IDS = [
  'saqueador_rio',
  'besta_do_cipo',
  'atirador_fantasma',
  'bruxo_gramofone',
  'capataz_alfandega',
  'sentinela_nevoa',
  'jaguar_lunar',
  'capitao_vesper',
  'capanga_vesper',
];

const STYLE_BY_TAG = {
  machine: 'guardian',
  construct: 'guardian',
  cult: 'spitter',
  beast: 'stalker',
};

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

const styleForTags = (tags) => {
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (STYLE_BY_TAG[tag]) return STYLE_BY_TAG[tag];
  }
  return 'stalker';
};

const sortPngsByCtime = async (srcDir) => {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => path.join(srcDir, e.name));
  const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => ({ f, s }))));
  stats.sort((a, b) => a.s.ctimeMs - b.s.ctimeMs);
  return stats.map((it) => it.f);
};

const upsertAtlas = (manifest, atlasId, relPath, width, height) => {
  const atlases = Array.isArray(manifest.atlases) ? manifest.atlases : (manifest.atlases = []);
  const found = atlases.find((a) => a && a.id === atlasId);
  if (found) {
    found.path = relPath;
    found.width = width;
    found.height = height;
    found.domain = 'combat';
    return;
  }
  atlases.push({ id: atlasId, path: relPath, width, height, domain: 'combat' });
};

const upsertCombatantBinding = (manifest, visualKey, atlasId, metaRel, style) => {
  const combatants = Array.isArray(manifest.combatants)
    ? manifest.combatants
    : (manifest.combatants = []);
  const found = combatants.find((c) => c && c.visualKey === visualKey);
  const base = {
    visualKey,
    source: 'texturepacker',
    atlasId,
    metaPath: metaRel,
    width: SIZE,
    height: SIZE,
    anchorX: 0.5,
    anchorY: 1,
    style,
  };
  if (found) {
    Object.assign(found, base);
  } else {
    combatants.push(base);
  }
};

const writeMeta = async (metaPath) => {
  const meta = {
    frames: {
      'idle_0.png': {
        frame: { x: 0, y: 0, w: SIZE, h: SIZE },
        duration: 200,
      },
    },
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
};

const main = async () => {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('Uso: node scripts/import-enemy-sprites.mjs /caminho/para/pngs');
    process.exit(2);
  }

  await ensureDir(ATLAS_DIR);
  await ensureDir(META_DIR);

  const enemies = await readJson(ENEMIES_JSON, []);
  const indexById = new Map(
    (Array.isArray(enemies) ? enemies : []).map((e) => [e?.id, e]).filter(([k]) => typeof k === 'string'),
  );

  const manifest =
    (await readJson(MANIFEST_PATH, null)) ?? {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      atlases: [],
      combatants: [],
      uiIcons: [],
      diceFaces: [],
      biomeThemes: [],
    };

  const sources = await sortPngsByCtime(srcDir);
  if (sources.length < ORDERED_IDS.length) {
    console.warn(
      `[import-enemy-sprites] Aviso: ${sources.length} arquivos encontrados; ${ORDERED_IDS.length} exigidos.`,
    );
  }

  for (let i = 0; i < ORDERED_IDS.length; i++) {
    const enemyId = ORDERED_IDS[i];
    const src = sources[i];
    if (!src) {
      console.warn(`[import-enemy-sprites] Faltando imagem para ${enemyId}; ignorando.`);
      continue;
    }

    const outPng = path.join(ATLAS_DIR, `${enemyId}.png`);
    const outMeta = path.join(META_DIR, `${enemyId}.json`);
    const atlasId = `enemy.${enemyId}`;
    const relPng = `atlas/${enemyId}.png`;
    const relMeta = `meta/${enemyId}.json`;

    // Resize with nearest neighbor and save as PNG
    await sharp(src).resize(SIZE, SIZE, { kernel: sharp.kernel.nearest, fit: 'fill' }).png().toFile(outPng);

    await writeMeta(outMeta);

    const tags = indexById.get(enemyId)?.tags ?? [];
    const style = styleForTags(tags);

    upsertAtlas(manifest, atlasId, relPng, SIZE, SIZE);
    upsertCombatantBinding(manifest, `enemy:${enemyId}`, atlasId, relMeta, style);

    console.log(`[import-enemy-sprites] OK: ${path.basename(src)} → ${relPng} (visualKey=enemy:${enemyId})`);
  }

  if (!manifest.generatedAt) {
    manifest.generatedAt = new Date(0).toISOString();
  }
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[import-enemy-sprites] Manifest atualizado em ${path.relative(root, MANIFEST_PATH)}`);
};

main().catch((err) => {
  console.error('[import-enemy-sprites] Erro inesperado:', err);
  process.exit(1);
});
