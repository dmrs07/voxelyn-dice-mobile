#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const MANIFEST_PATH = path.join(root, 'assets', 'generated', 'pixel', 'manifest.json');
const MAX_ATLAS_DIM = 2048;
const MAX_TEXTURE_BUDGET_BYTES = 40 * 1024 * 1024;

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
  return path.join(root, assetPath);
};

const main = async () => {
  if (!(await exists(MANIFEST_PATH))) {
    throw new Error(`Manifest nao encontrado: ${path.relative(root, MANIFEST_PATH)}`);
  }

  const manifest = await readJson(MANIFEST_PATH);
  const errors = [];

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

  if (errors.length > 0) {
    console.error('[assets:check] Falhou com os seguintes problemas:');
    for (const issue of errors) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  const estimatedMb = (estimatedBytes / (1024 * 1024)).toFixed(2);
  console.log(`[assets:check] OK. Atlases=${atlases.length}, memoria estimada=${estimatedMb} MB.`);
};

main().catch((error) => {
  console.error('[assets:check] Erro inesperado:', error);
  process.exit(1);
});
