import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] ?? 'content/dice/core-dice.json';
const outputPath = process.argv[3] ?? 'content/dice/core-dice.with-prompts.json';

const BASE_PROMPT =
  'Pixel art FULL, texture de face de dado 1:1 64x64 (ou 48x48), icone central ocupando 60% do quadro, moldura/bevel do dado em pixels com detalhe art deco simples, contorno escuro definido, shading em 2-3 niveis solidos, alto contraste, iluminacao topo-esquerda, fundo solido preenchido (nao transparente), paleta limitada a 8-12 cores, sem blur, sem anti-aliasing, pixel perfeito, legivel em mobile, estilo roguelike tipo Slice & Dice, ideal para atlas.';

const rarityMod = (rarity) => {
  if (rarity === 'rare') {
    return 'Material raro: inlay azul-petroleo + filete dourado sutil, 1 brilho pequeno (1-2 pixels), sem gradiente.';
  }
  if (rarity === 'cursed') {
    return 'Material amaldiocoado: base escura com detalhes roxo/esverdeado e risco sutil, sem gradiente.';
  }
  return 'Material comum: marfim/metal escuro, sem brilho extra, sem gradiente.';
};

const hasEffect = (face, type) =>
  Array.isArray(face.effects) && face.effects.some((entry) => entry?.type === type);

const anyEffect = (face, predicate) =>
  Array.isArray(face.effects) && face.effects.some((entry) => predicate(entry ?? {}));

const badge = (face) => {
  if (typeof face.value === 'number' && face.value > 0) {
    return `Badge numerico "${face.value}" em fonte pixel pequena no canto inferior direito.`;
  }
  return 'Sem badge numerico.';
};

const rangeMarker = (face) => {
  const range = face?.effects?.find((entry) => entry?.range)?.range;
  if (range === 'ranged') {
    return 'Marcador pequeno de alcance: mini seta (ranged).';
  }
  if (range === 'melee') {
    return 'Marcador pequeno de alcance: mini punho (melee).';
  }
  return '';
};

const iconDescription = (die, face) => {
  const tags = new Set(face.tags ?? []);
  const target = face.target;

  if (anyEffect(face, (entry) => entry.type === 'post_combat' && entry.resource === 'gold')) {
    return 'Icone: moeda art deco (ouro) + mini +1.';
  }
  if (anyEffect(face, (entry) => entry.type === 'post_combat' && entry.resource === 'supplies')) {
    return 'Icone: caixa de suprimentos com folhagem + mini +1.';
  }
  if (anyEffect(face, (entry) => entry.type === 'post_combat' && entry.resource === 'consumables')) {
    return 'Icone: caixote + frasco pequeno; mini seta para cima discreta indicando ameaca.';
  }

  if (tags.has('turret') || hasEffect(face, 'turret')) {
    return 'Icone: mini torreta/canhao pixel art, robusto e legivel.';
  }

  if (tags.has('shred') || hasEffect(face, 'shred_armor')) {
    return 'Icone: escudo rachado + projetil/tiro pequeno (shred + dano).';
  }

  if (
    tags.has('charge') ||
    anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'charged')
  ) {
    return 'Icone: circulo runico geometrico art deco (carregar/ritual), sem texto.';
  }

  if (
    tags.has('fear') ||
    anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'fear')
  ) {
    const plusFocus = hasEffect(face, 'focus');
    if (plusFocus) {
      return 'Icone: mascara/olho assombrado + faisca/raio pequeno (medo + foco).';
    }
    return 'Icone: mascara/olho assombrado (medo), simples e forte.';
  }

  if (
    tags.has('buff') ||
    anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'inspired')
  ) {
    return 'Icone: microfone vintage + estrela (inspirar), art deco simples.';
  }

  if (hasEffect(face, 'suppress_special')) {
    return 'Icone: moeda + X sobre uma estrela (cancelar especial), legivel em 16x16.';
  }

  if (hasEffect(face, 'pull_front')) {
    return 'Icone: gancho com seta puxando para frente, sem texto.';
  }

  if (hasEffect(face, 'lock_die') && hasEffect(face, 'focus')) {
    return 'Icone: mira (crosshair) + cadeado + faisca pequena (lock + foco).';
  }

  if (hasEffect(face, 'swap')) {
    if (hasEffect(face, 'block')) {
      return 'Icone: setas cruzadas (swap) + escudo pequeno.';
    }
    if (hasEffect(face, 'damage')) {
      return 'Icone: setas cruzadas (swap) + projetil/tiro pequeno.';
    }
    return 'Icone: setas cruzadas (swap) centralizadas, sem texto.';
  }

  if (
    face.kind === 'mark' ||
    tags.has('mark') ||
    anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'mark')
  ) {
    const frontAll = anyEffect(face, (entry) => entry.target === 'enemy_front_all');
    if (frontAll) {
      return 'Icone: sinalizador/flare + dois silhouettes (marca em area/frente).';
    }
    if (hasEffect(face, 'damage')) {
      return 'Icone: arma simples + alvo bullseye pequeno (dano + marca).';
    }
    return 'Icone: alvo bullseye grande (marca), com contorno grosso.';
  }

  if (face.kind === 'block' || hasEffect(face, 'block')) {
    const allAllies = anyEffect(face, (entry) => entry.target === 'all_allies');
    if (allAllies) {
      return 'Icone: escudo + aura envolvendo 3 silhouettes (BLK em todos aliados).';
    }
    if (target === 'self') {
      return 'Icone: escudo/placa art deco (BLK proprio).';
    }
    return 'Icone: escudo/placa com seta pequena apontando para fora (BLK em aliado).';
  }

  if (face.kind === 'heal' || hasEffect(face, 'heal')) {
    const hasCleanseFlag = hasEffect(face, 'cleanse');
    const hasBlockFlag = hasEffect(face, 'block');
    if (hasCleanseFlag) {
      return 'Icone: cruz/frasco + brilho (HEAL + CLEANSE).';
    }
    if (hasBlockFlag) {
      return 'Icone: cruz/frasco + escudo pequeno (HEAL + BLK).';
    }
    return 'Icone: cruz/frasco de cura simples, alto contraste.';
  }

  if (face.kind === 'cleanse' || hasEffect(face, 'cleanse')) {
    const hasBlockFlag = hasEffect(face, 'block');
    if (hasBlockFlag) {
      return 'Icone: gota + brilho + escudo pequeno (CLEANSE + BLK).';
    }
    return 'Icone: gota + brilho (CLEANSE), minimalista e claro.';
  }

  if (face.kind === 'focus' || hasEffect(face, 'focus')) {
    const alsoBlock = hasEffect(face, 'block');
    const alsoMark = anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'mark');
    if (alsoBlock) {
      return 'Icone: faisca/raio + escudo pequeno (FOCO + BLK).';
    }
    if (alsoMark) {
      return 'Icone: faisca/raio + alvo bullseye pequeno (FOCO + MARK).';
    }
    return 'Icone: faisca/raio art deco (FOCO), simples.';
  }

  if (
    face.kind === 'stun' ||
    anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'stun')
  ) {
    return 'Icone: armadilha ou estrela de impacto (STUN), bem legivel.';
  }

  if (face.kind === 'attack' || hasEffect(face, 'damage')) {
    const isAoe = tags.has('aoe') || anyEffect(face, (entry) => entry.target === 'enemy_front_all');
    if (isAoe) {
      return 'Icone: 2-3 linhas de rajada atingindo dois silhouettes (AoE frente).';
    }
    const isPoison = tags.has('poison') || anyEffect(face, (entry) => entry.applyStatusId === 'poison');
    if (isPoison) {
      return 'Icone: projetil/tiro + gota verde (ATK + VENENO).';
    }
    const isBleed = tags.has('bleed') || anyEffect(face, (entry) => entry.applyStatusId === 'bleed');
    if (isBleed) {
      return 'Icone: lamina/corte + gota vermelha (ATK + BLEED).';
    }
    const isRisk = tags.has('risk');
    if (isRisk) {
      return 'Icone: golpe pesado + gota vermelha com mini seta para self (risco).';
    }
    const hasDodge = anyEffect(face, (entry) => entry.type === 'status' && entry.statusId === 'dodge');
    if (hasDodge) {
      return 'Icone: projetil/tiro + asa/pena (ATK + DODGE).';
    }
    if (die.id.includes('mecanico')) {
      return 'Icone: chave inglesa/golpe mecanico simples, bem legivel.';
    }
    return 'Icone: arma simples (ranged = tiro; melee = corte), bem legivel.';
  }

  return 'Icone: simbolo generico art deco minimalista.';
};

const makePrompt = (die, face) =>
  [
    BASE_PROMPT,
    rarityMod(die.rarity),
    iconDescription(die, face),
    badge(face),
    rangeMarker(face),
    'Sem texto (exceto badge numerico), composicao limpa, sem cenario complexo.',
  ]
    .filter(Boolean)
    .join(' ');

const run = () => {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Esperado array de dados em ${inputPath}.`);
  }

  const withPrompts = raw.map((die) => ({
    ...die,
    faces: Array.isArray(die.faces)
      ? die.faces.map((face) => ({
          ...face,
          prompt: makePrompt(die, face),
        }))
      : [],
  }));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(withPrompts, null, 2)}\n`, 'utf8');
  console.log(`[dice:prompts] OK -> ${outputPath}`);
};

run();
