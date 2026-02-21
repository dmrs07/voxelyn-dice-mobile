import type { DiceFaceDef, FaceEffectDef } from '../../domain/shared/types';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const kindLabel = (kind: DiceFaceDef['kind']): string => {
  switch (kind) {
    case 'empty':
      return 'Vazio';
    case 'attack':
      return 'Ataque';
    case 'block':
      return 'Bloqueio';
    case 'heal':
      return 'Cura';
    case 'mark':
      return 'Marca';
    case 'cleanse':
      return 'Purificar';
    case 'swap':
      return 'Troca';
    case 'stun':
      return 'Atordoar';
    case 'focus':
      return 'Foco';
    case 'special':
      return 'Especial';
    default:
      return kind;
  }
};

const targetLabel = (target: DiceFaceDef['target']): string => {
  if (target === 'self') return 'Si mesmo';
  if (target === 'ally') return 'Aliado';
  if (target === 'enemy') return 'Inimigo';
  return 'Qualquer';
};

const effectLabel = (effect: FaceEffectDef): string => {
  switch (effect.type) {
    case 'damage':
      return `Dano ${effect.value}${effect.applyStatusId ? ` + ${effect.applyStatusId} ${effect.applyStatusStacks ?? 0}` : ''}`;
    case 'block':
      return `BLK ${effect.value}`;
    case 'heal':
      return `Cura ${effect.value}${effect.removeBleed ? ' + remove bleed' : ''}`;
    case 'status':
      return `${effect.statusId} ${effect.value}`;
    case 'cleanse':
      return `Cleanse ${effect.value}`;
    case 'shred_armor':
      return `Quebra armadura ${effect.value}`;
    case 'swap':
      return 'Troca de linha';
    case 'focus':
      return `Foco +${effect.value}`;
    case 'lock_die':
      return `Trava ${effect.value} dado(s)`;
    case 'pull_front':
      return 'Puxa alvo para frente';
    case 'suppress_special':
      return `Suprime especial (${effect.value})`;
    case 'post_combat':
      return `Pos-combate ${effect.resource} ${effect.value >= 0 ? '+' : ''}${effect.value}`;
    case 'turret':
      return `Torreta ${effect.value}`;
    default:
      return 'Efeito';
  }
};

const conditionLabels = (face: DiceFaceDef): string[] => {
  const out: string[] = [];
  if (face.condition?.requiresTag) {
    out.push(`Exige tag: ${face.condition.requiresTag}`);
  }
  if (face.condition?.requiresMarked) {
    out.push('Exige alvo marcado');
  }
  if (face.condition?.requiresTargetFront) {
    out.push('Exige alvo na frente');
  }
  return out;
};

export const renderFaceTooltipContent = (face: DiceFaceDef): string => {
  if (face.kind === 'empty') {
    return `
      <p class="tooltip-line">Lado vazio.</p>
      <p class="tooltip-line">Pode ser descartado para ganhar BLK 1.</p>
    `;
  }

  const conditionLines = conditionLabels(face)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  const effects = face.effects
    .map((effect) => `<li>${escapeHtml(effectLabel(effect))}</li>`)
    .join('');

  return `
    <p class="tooltip-line"><strong>Tipo:</strong> ${escapeHtml(kindLabel(face.kind))}</p>
    <p class="tooltip-line"><strong>Alvo:</strong> ${escapeHtml(targetLabel(face.target))}</p>
    <p class="tooltip-line"><strong>Valor:</strong> ${face.value}</p>
    ${conditionLines ? `<p class="tooltip-line"><strong>Condicoes</strong></p><ul class="tooltip-list">${conditionLines}</ul>` : ''}
    ${effects ? `<p class="tooltip-line"><strong>Efeitos</strong></p><ul class="tooltip-list">${effects}</ul>` : ''}
  `;
};

export const renderFaceTooltipPopover = (face: DiceFaceDef, closeLabel = 'Fechar'): string => `
  <div class="face-tooltip-popover" role="dialog" aria-label="Detalhes da face">
    <div class="face-tooltip-head">
      <strong>${escapeHtml(face.label)}</strong>
      <button type="button" class="secondary-btn mini" data-close-face-tooltip="true">${escapeHtml(closeLabel)}</button>
    </div>
    ${renderFaceTooltipContent(face)}
  </div>
`;

export interface TrayFaceTooltipOptions {
  ownerName: string;
  dieLabel: string;
}

export const renderTrayFaceTooltipPopover = (
  face: DiceFaceDef,
  options: TrayFaceTooltipOptions,
): string => `
  <section class="face-tooltip-popover tray-tooltip" role="dialog" aria-label="Face do dado selecionado">
    <div class="face-tooltip-head">
      <strong>${escapeHtml(face.label)}</strong>
      <button type="button" class="secondary-btn mini" data-close-face-tooltip="true">Fechar</button>
    </div>
    <p class="tooltip-line"><strong>Dono:</strong> ${escapeHtml(options.ownerName)}</p>
    <p class="tooltip-line"><strong>Dado:</strong> ${escapeHtml(options.dieLabel)}</p>
    <p class="tooltip-line"><strong>Tipo:</strong> ${escapeHtml(kindLabel(face.kind))}</p>
    <p class="tooltip-line"><strong>Valor:</strong> ${face.value}</p>
    <button type="button" class="secondary-btn mini" data-toggle-face-tooltip-details="true" aria-expanded="false">Detalhes</button>
    <div class="face-tooltip-details is-hidden" data-face-tooltip-details="true">
      ${renderFaceTooltipContent(face)}
    </div>
  </section>
`;
