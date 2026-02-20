#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const RAW_ROOT = path.join(root, 'assets', 'raw', 'aseprite');
const GENERATED_ROOT = path.join(root, 'assets', 'generated', 'pixel');
const META_ROOT = path.join(GENERATED_ROOT, 'meta');
const MANIFEST_PATH = path.join(GENERATED_ROOT, 'manifest.json');
const REPORT_PATH = path.join(META_ROOT, 'build-report.json');

const REQUIRED_TAGS = ['idle', 'walk', 'attack', 'cast', 'hit', 'die'];

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

const normalizeManifest = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
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
    generatedAt: typeof rootManifest.generatedAt === 'string' ? rootManifest.generatedAt : new Date().toISOString(),
    atlases: Array.isArray(rootManifest.atlases) ? rootManifest.atlases : [],
    combatants: Array.isArray(rootManifest.combatants) ? rootManifest.combatants : [],
    uiIcons: Array.isArray(rootManifest.uiIcons) ? rootManifest.uiIcons : [],
    diceFaces: Array.isArray(rootManifest.diceFaces) ? rootManifest.diceFaces : [],
    biomeThemes: Array.isArray(rootManifest.biomeThemes) ? rootManifest.biomeThemes : [],
  };
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

  for (const filePath of files) {
    const base = path.basename(filePath, '.aseprite');
    if (!/^[a-z0-9_\-]+$/.test(base)) {
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
        ? metadata.meta.frameTags.map((entry) => (entry && typeof entry.name === 'string' ? entry.name : ''))
        : [];

    const missing = REQUIRED_TAGS.filter((tag) => !tags.includes(tag));
    if (missing.length > 0) {
      metadataIssues.push(
        `Tags faltando (${missing.join(', ')}): ${path.relative(root, jsonCandidate)}`,
      );
    }
  }

  const existingManifest = normalizeManifest(await readJson(MANIFEST_PATH, null));

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
      width: 32,
      height: 32,
      anchorX: 0.5,
      anchorY: 1,
    });
  }

  const enemyTagSet = new Set();
  for (const enemyDef of Array.isArray(enemies) ? enemies : []) {
    const tags = Array.isArray(enemyDef?.tags) ? enemyDef.tags.filter((entry) => typeof entry === 'string') : [];
    for (const tag of tags) {
      enemyTagSet.add(tag);
    }
  }

  for (const tag of enemyTagSet) {
    generatedCombatants.push({
      visualKey: `enemy:${tag}`,
      source: 'procedural',
      style: styleForEnemyTags([tag]),
      width: 32,
      height: 32,
      anchorX: 0.5,
      anchorY: 1,
    });
  }

  generatedCombatants.push({
    visualKey: 'enemy:default',
    source: 'procedural',
    style: 'stalker',
    width: 32,
    height: 32,
    anchorX: 0.5,
    anchorY: 1,
  });

  const mergedCombatants = [...existingManifest.combatants];
  for (const entry of generatedCombatants) {
    if (!mergedCombatants.some((current) => current && current.visualKey === entry.visualKey)) {
      mergedCombatants.push(entry);
    }
  }

  const candidateManifest = {
    ...existingManifest,
    version: 1,
    combatants: mergedCombatants,
  };
  const existingSignature = JSON.stringify({ ...existingManifest, generatedAt: '' });
  const nextSignature = JSON.stringify({ ...candidateManifest, generatedAt: '' });
  const generatedAt =
    existingManifest.generatedAt && existingSignature === nextSignature
      ? existingManifest.generatedAt
      : new Date().toISOString();

  const nextManifest = {
    ...candidateManifest,
    generatedAt,
  };

  const fullNext = JSON.stringify(nextManifest, null, 2);
  const fullPrev = JSON.stringify(existingManifest, null, 2);
  if (fullNext !== fullPrev) {
    await fs.writeFile(MANIFEST_PATH, `${fullNext}\n`, 'utf8');
  }

  const report = {
    generatedAt: nextManifest.generatedAt,
    asepriteFileCount: files.length,
    namingIssues,
    metadataIssues,
    combatantCount: mergedCombatants.length,
  };

  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (namingIssues.length > 0 || metadataIssues.length > 0) {
    console.error('[assets:build] Validacao falhou.');
    for (const issue of [...namingIssues, ...metadataIssues]) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  console.log(`[assets:build] Manifest atualizado em ${path.relative(root, MANIFEST_PATH)}.`);
  console.log(`[assets:build] Relatorio em ${path.relative(root, REPORT_PATH)}.`);
};

main().catch((error) => {
  console.error('[assets:build] Erro inesperado:', error);
  process.exit(1);
});
