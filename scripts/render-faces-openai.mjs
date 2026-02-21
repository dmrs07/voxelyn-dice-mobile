import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const inputPath = process.argv[2] ?? 'content/dice/core-dice.with-prompts.json';
const outputDir = process.argv[3] ?? 'assets/generated/pixel/dice-faces';
const extraArgs = process.argv.slice(4);

const model = process.env.IMG_MODEL ?? 'gpt-image-1';
const size = process.env.IMG_SIZE ?? '1024x1024';
const quality = process.env.IMG_QUALITY ?? 'medium';
const background = process.env.IMG_BACKGROUND ?? 'opaque';
const apiKey = process.env.OPENAI_API_KEY ?? '';
const apiBase = (process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const envFromId = process.env.DICE_RESUME_FROM ?? '';
const envResetProgress = process.env.DICE_RESET_PROGRESS === '1';

const parseOptions = (args) => {
  let fromId = envFromId;
  let resetProgress = envResetProgress;
  for (const arg of args) {
    if (arg === '--reset-progress') {
      resetProgress = true;
      continue;
    }
    if (arg.startsWith('--from=')) {
      fromId = arg.slice('--from='.length);
      continue;
    }
    if (!arg.startsWith('--') && !fromId) {
      fromId = arg;
    }
  }
  return {
    fromId: fromId.trim(),
    resetProgress,
  };
};

const options = parseOptions(extraArgs);
const progressPath = path.join(outputDir, '.render-progress.json');

const promptKey = (prompt) =>
  crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 16);

const readProgress = () => {
  if (!fs.existsSync(progressPath)) {
    return {
      completedPromptKeys: new Set(),
      updatedAt: null,
      lastPrimaryId: null,
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    return {
      completedPromptKeys: new Set(
        Array.isArray(raw.completedPromptKeys) ? raw.completedPromptKeys : [],
      ),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      lastPrimaryId: typeof raw.lastPrimaryId === 'string' ? raw.lastPrimaryId : null,
    };
  } catch (error) {
    console.warn('[dice:render:openai] checkpoint invalido, ignorando:', error);
    return {
      completedPromptKeys: new Set(),
      updatedAt: null,
      lastPrimaryId: null,
    };
  }
};

const writeProgress = (state) => {
  const serializable = {
    completedPromptKeys: Array.from(state.completedPromptKeys),
    completedCount: state.completedPromptKeys.size,
    updatedAt: new Date().toISOString(),
    lastPrimaryId: state.lastPrimaryId ?? null,
    inputPath,
    outputDir,
    model,
    size,
    quality,
    background,
  };
  fs.writeFileSync(progressPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
};

if (!apiKey) {
  console.error('[dice:render:openai] OPENAI_API_KEY nao definido.');
  process.exit(1);
}

const ensureSharp = async () => {
  try {
    const mod = await import('sharp');
    return mod.default ?? mod;
  } catch (error) {
    console.warn('[dice:render:openai] sharp nao encontrado. Continuando sem resize para 64x64.');
    return null;
  }
};

const requestImage = async (prompt) => {
  const requestPayload = {
    model,
    prompt,
    size,
    quality,
  };
  if (background === 'transparent') {
    requestPayload.background = 'transparent';
  }

  const response = await fetch(`${apiBase}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Erro API ${response.status}: ${body.slice(0, 400)}`);
  }

  const resultPayload = await response.json();
  const first = resultPayload?.data?.[0];
  if (!first) {
    throw new Error('Resposta da API sem data[0].');
  }

  if (typeof first.b64_json === 'string') {
    return Buffer.from(first.b64_json, 'base64');
  }

  if (typeof first.url === 'string' && first.url.length > 0) {
    const imgResponse = await fetch(first.url);
    if (!imgResponse.ok) {
      throw new Error(`Falha ao baixar URL retornada (${imgResponse.status}).`);
    }
    return Buffer.from(await imgResponse.arrayBuffer());
  }

  throw new Error('Resposta sem b64_json/url.');
};

const flattenFaces = (diceDefs) => {
  const rows = [];
  for (const die of diceDefs) {
    if (!Array.isArray(die.faces)) {
      continue;
    }
    for (const face of die.faces) {
      rows.push({
        dieId: die.id,
        rarity: die.rarity,
        id: face.id,
        label: face.label,
        prompt: face.prompt,
      });
    }
  }
  return rows;
};

const groupByPrompt = (faces) => {
  const grouped = new Map();
  for (const face of faces) {
    if (typeof face.prompt !== 'string' || face.prompt.trim().length === 0) {
      continue;
    }
    if (!grouped.has(face.prompt)) {
      grouped.set(face.prompt, []);
    }
    grouped.get(face.prompt).push(face);
  }
  return grouped;
};

const resizeTo64 = async (sharpLib, inputBuffer) => {
  if (!sharpLib) {
    return null;
  }
  return sharpLib(inputBuffer).resize(64, 64, { kernel: 'nearest' }).png().toBuffer();
};

const hasAllOutputs = (entries, outRoot) => {
  for (const face of entries) {
    const pngPath = path.join(outRoot, `${face.id}.png`);
    if (!fs.existsSync(pngPath)) {
      return false;
    }
  }
  return true;
};

const run = async () => {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Esperado array de dados em ${inputPath}.`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  if (options.resetProgress && fs.existsSync(progressPath)) {
    fs.unlinkSync(progressPath);
    console.log(`[dice:render:openai] checkpoint limpo (${progressPath})`);
  }

  const progress = readProgress();
  const sharpLib = await ensureSharp();

  const faces = flattenFaces(raw);
  const groups = Array.from(groupByPrompt(faces).entries()).map(([prompt, entries]) => ({
    prompt,
    entries,
    key: promptKey(prompt),
    primaryId: entries[0]?.id ?? null,
  }));
  const total = groups.length;
  console.log(`[dice:render:openai] faces=${faces.length} prompts_unicos=${total}`);
  if (progress.updatedAt) {
    console.log(`[dice:render:openai] checkpoint carregado (updatedAt=${progress.updatedAt}).`);
  }

  let fromIndex = 0;
  if (options.fromId) {
    const found = groups.findIndex((group) =>
      group.entries.some((entry) => entry.id === options.fromId),
    );
    if (found < 0) {
      throw new Error(`--from nao encontrado: ${options.fromId}`);
    }
    fromIndex = found;
    console.log(`[dice:render:openai] retomando manualmente a partir de ${options.fromId} (grupo ${found + 1}/${total}).`);
  }

  let processed = 0;
  for (let index = fromIndex; index < groups.length; index += 1) {
    const group = groups[index];
    const prompt = group.prompt;
    const entries = group.entries;
    const groupKey = group.key;
    const primary = entries[0];
    if (!primary) {
      continue;
    }

    if (
      progress.completedPromptKeys.has(groupKey) &&
      hasAllOutputs(entries, outputDir)
    ) {
      console.log(`[${index + 1}/${total}] skip checkpoint ${primary.id}`);
      continue;
    }

    const primaryPng = path.join(outputDir, `${primary.id}.png`);
    const primary64 = path.join(outputDir, `${primary.id}.64.png`);

    let baseBuffer = null;
    if (fs.existsSync(primaryPng)) {
      baseBuffer = fs.readFileSync(primaryPng);
      console.log(`[${index + 1}/${total}] reutilizando ${primary.id}.png`);
    } else {
      console.log(`[${index + 1}/${total}] gerando ${primary.id} (${model})`);
      baseBuffer = await requestImage(prompt);
      fs.writeFileSync(primaryPng, baseBuffer);
    }

    if (!fs.existsSync(primary64)) {
      const small = await resizeTo64(sharpLib, baseBuffer);
      if (small) {
        fs.writeFileSync(primary64, small);
      }
    }

    for (const face of entries.slice(1)) {
      const targetPng = path.join(outputDir, `${face.id}.png`);
      const target64 = path.join(outputDir, `${face.id}.64.png`);
      if (!fs.existsSync(targetPng)) {
        fs.copyFileSync(primaryPng, targetPng);
      }
      if (fs.existsSync(primary64) && !fs.existsSync(target64)) {
        fs.copyFileSync(primary64, target64);
      }
    }

    processed += 1;
    progress.completedPromptKeys.add(groupKey);
    progress.lastPrimaryId = primary.id;
    writeProgress(progress);
  }

  console.log(`[dice:render:openai] OK -> ${outputDir} (processados nesta execucao: ${processed})`);
};

run().catch((error) => {
  console.error('[dice:render:openai] Falhou:', error);
  process.exit(1);
});
