import { materializeAllDieFaces } from '../domain/shared/dice-face-utils';
import { getCaptainFaceDefinition } from '../domain/combat/captain-loadouts';
import type {
  CaptainFaceId,
  CaptainLoadoutSelection,
  CaptainPassiveId,
  DraftRosterCandidate,
  GameContent,
  PartySelectionItem,
  ProfileState,
} from '../domain/shared/types';
import { resolveCombatantAvatarSrc } from '../render/pixel/asset-loader';
import { renderFaceTooltipPopover } from '../render/ui/dice-face-tooltip';
import { renderDieFaceMiniSprite } from '../render/voxelyn/dice-renderer';

export interface MetaScreenHandlers {
  onStartRun: (seed: number) => void;
  onSetSeed: (seed: number) => void;
  onRegenerateRoster: () => void;
  onFocusCandidate: (classId: string) => void;
  onRecruitCandidate: (classId: string) => void;
  onRemovePartyMember: (classId: string) => void;
  onSetCaptain: (classId: string) => void;
  onSetCaptainPassive: (passiveId: CaptainPassiveId) => void;
  onSetCaptainFace: (faceId: CaptainFaceId) => void;
  onToggleFaceTooltip: (faceKey: string | null) => void;
  onResetProfile: () => void;
}

export interface MetaScreenState {
  content: GameContent;
  profile: ProfileState;
  rosterCandidates: DraftRosterCandidate[];
  draftParty: PartySelectionItem[];
  selectedCandidateClassId: string | null;
  captainClassId: string | null;
  captainLoadoutSelection: CaptainLoadoutSelection | null;
  captainPassiveOptions: ReadonlyArray<{ id: CaptainPassiveId; label: string; description: string }>;
  captainFaceOptions: ReadonlyArray<{ id: CaptainFaceId; label: string; description: string }>;
  openFaceTooltipKey: string | null;
  seed: number;
  hiringBudget: number;
  hiringSpent: number;
  hiringRemaining: number;
  message: string;
}

const safeNumber = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

export const renderMetaScreen = (
  root: HTMLElement,
  state: MetaScreenState,
  handlers: MetaScreenHandlers,
): void => {
  const candidateByClass = new Map<string, DraftRosterCandidate>();
  for (const candidate of state.rosterCandidates) {
    candidateByClass.set(candidate.classId, candidate);
  }

  const selectedCandidate =
    (state.selectedCandidateClassId ? candidateByClass.get(state.selectedCandidateClassId) : undefined) ??
    state.rosterCandidates[0];

  const selectedClassDef = selectedCandidate
    ? state.content.byId.classes[selectedCandidate.classId]
    : undefined;
  const selectedBgDef = selectedCandidate
    ? state.content.byId.backgrounds[selectedCandidate.backgroundId]
    : undefined;

  const captainClassId = state.captainClassId ?? state.draftParty[0]?.classId ?? null;
  const captainSlot = captainClassId
    ? state.draftParty.find((entry) => entry.classId === captainClassId) ?? null
    : null;
  const captainClass = captainSlot ? state.content.byId.classes[captainSlot.classId] : null;
  const captainBackground = captainSlot ? state.content.byId.backgrounds[captainSlot.backgroundId] : null;
  const captainAvatar = resolveCombatantAvatarSrc(
    `party:${captainSlot?.classId ?? selectedCandidate?.classId ?? 'default'}`,
  );
  const activePassiveId = state.captainLoadoutSelection?.passiveId ?? '';
  const activeFaceId = state.captainLoadoutSelection?.faceId ?? '';

  const partyClassSet = new Set(state.draftParty.map((entry) => entry.classId));

  const teamMarkup = state.draftParty
    .map((slot, index) => {
      const classDef = state.content.byId.classes[slot.classId];
      const bgDef = state.content.byId.backgrounds[slot.backgroundId];
      const isCaptain = slot.classId === captainClassId || index === 0;
      const avatar = resolveCombatantAvatarSrc(`party:${slot.classId}`);
      const classId = slot.classId;
      return `
        <article class="team-member-card ${isCaptain ? 'is-captain' : ''}">
          <img class="team-member-portrait" src="${avatar}" alt="${classDef?.name ?? slot.classId}" />
          <div class="team-member-meta">
            <strong>${classDef?.name ?? slot.classId}</strong>
            <small>${bgDef?.name ?? slot.backgroundId} · ${slot.row === 'front' ? 'FRONT' : 'BACK'}</small>
            <small>${isCaptain ? 'Capitao · custo gratis' : `Hiring ${classDef?.hireCost ?? 0} ouro`}</small>
          </div>
          <div class="team-member-actions">
            <button type="button" class="secondary-btn mini" data-set-captain="${classId}" ${
              isCaptain ? 'disabled' : ''
            }>Definir capitao</button>
            <button type="button" class="secondary-btn mini danger" data-remove-party-class="${classId}">Remover</button>
          </div>
          ${isCaptain ? '<span class="captain-badge">CAPITAO</span>' : ''}
        </article>
      `;
    })
    .join('');

  const candidateMarkup = state.rosterCandidates
    .map((candidate) => {
      const classDef = state.content.byId.classes[candidate.classId];
      const backgroundDef = state.content.byId.backgrounds[candidate.backgroundId];
      const isFocused = selectedCandidate?.classId === candidate.classId;
      const isRecruited = partyClassSet.has(candidate.classId);
      const isCaptain = candidate.classId === captainClassId;
      const avatar = resolveCombatantAvatarSrc(`party:${candidate.classId}`);
      const cardClass = [
        'candidate-card',
        isFocused ? 'selected' : '',
        isRecruited ? 'is-recruited' : '',
        isCaptain ? 'is-captain' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
        <article class="${cardClass}" data-focus-candidate="${candidate.classId}">
          <img class="candidate-avatar" src="${avatar}" alt="${classDef?.name ?? candidate.classId}" />
          <div class="candidate-meta">
            <strong>${classDef?.name ?? candidate.classId}</strong>
            <small>${backgroundDef?.name ?? candidate.backgroundId}</small>
            <small>${isRecruited ? 'No time' : `Hiring ${candidate.hireCost} ouro`}</small>
          </div>
          <div class="candidate-actions">
            <button type="button" class="secondary-btn mini" data-focus-candidate="${candidate.classId}">Foco</button>
            <button type="button" class="${isRecruited ? 'secondary-btn mini danger' : 'primary-btn mini'}" data-toggle-recruit="${candidate.classId}">
              ${isRecruited ? 'Remover' : 'Recrutar'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  const classDie = selectedClassDef?.starterDiceIds[0]
    ? state.content.byId.dice[selectedClassDef.starterDiceIds[0]]
    : undefined;
  const bgDie = selectedBgDef ? state.content.byId.dice[selectedBgDef.starterDieId] : undefined;

  const classFaces = classDie ? materializeAllDieFaces(classDie) : [];
  const isFocusedCaptain = Boolean(
    selectedCandidate?.classId &&
      captainClassId &&
      selectedCandidate.classId === captainClassId &&
      state.captainLoadoutSelection,
  );
  if (classDie && isFocusedCaptain && state.captainLoadoutSelection) {
    const emptyIndex = classDie.emptyFaceIndices?.[0];
    const captainFace = getCaptainFaceDefinition(state.captainLoadoutSelection.faceId);
    if (
      captainFace &&
      Number.isInteger(emptyIndex) &&
      typeof emptyIndex === 'number' &&
      emptyIndex >= 0 &&
      emptyIndex < classFaces.length &&
      classFaces[emptyIndex]?.kind === 'empty'
    ) {
      classFaces[emptyIndex] = captainFace;
    }
  }
  const bgFaces = bgDie ? materializeAllDieFaces(bgDie) : [];

  const classFaceMarkup = classFaces
    .map((face, index) => {
      const key = `class_${selectedCandidate?.classId ?? 'none'}_${index}`;
      return `
        <button type="button" class="face-preview-card ${face.kind === 'empty' ? 'empty' : 'filled'}" data-face-key="${key}">
          <img src="${renderDieFaceMiniSprite(face)}" alt="${face.label}" />
          <small>${face.label}</small>
          ${state.openFaceTooltipKey === key ? renderFaceTooltipPopover(face) : ''}
        </button>
      `;
    })
    .join('');

  const bgFaceMarkup = bgFaces
    .map((face, index) => {
      const key = `bg_${selectedCandidate?.classId ?? 'none'}_${index}`;
      return `
        <button type="button" class="face-preview-card ${face.kind === 'empty' ? 'empty' : 'filled'}" data-face-key="${key}">
          <img src="${renderDieFaceMiniSprite(face)}" alt="${face.label}" />
          <small>${face.label}</small>
          ${state.openFaceTooltipKey === key ? renderFaceTooltipPopover(face) : ''}
        </button>
      `;
    })
    .join('');

  root.innerHTML = `
    <main class="screen meta-screen recruitment-screen">
      <header class="title-block recruitment-header">
        <h1>Recrutamento da Expedicao</h1>
        <p class="subtitle">Escolha o capitao, monte a trip e revise as faces antes de iniciar a run.</p>
      </header>

      <section class="meta-stats recruitment-stats">
        <div><span>Runs</span><strong>${state.profile.runsPlayed}</strong></div>
        <div><span>Vitorias</span><strong>${state.profile.runsWon}</strong></div>
        <div><span>Eventos vistos</span><strong>${state.profile.compendium.eventsSeen.length}</strong></div>
        <div><span>Reliquias vistas</span><strong>${state.profile.compendium.relicsSeen.length}</strong></div>
      </section>

      <section class="recruitment-hero">
        <div class="captain-stage">
          <div class="captain-scene">
            <img class="captain-portrait" src="${captainAvatar}" alt="${captainClass?.name ?? 'Candidato'}" />
            <div class="captain-table-map"></div>
          </div>
          <div class="captain-meta">
            <h2>Capitao da Missao</h2>
            ${
              captainSlot && captainClass && captainBackground
                ? `
                <p><strong>${captainClass.name}</strong> · ${captainBackground.name}</p>
                <p class="subtitle">Passiva: ${captainClass.passive}</p>
              `
                : '<p class="subtitle">Recrute integrantes e defina um capitao para liderar a expedicao.</p>'
            }
          </div>
        </div>
        <div class="captain-loadout-panel ${captainSlot ? '' : 'is-disabled'}">
          <h3>Loadout do Capitao</h3>
          ${
            captainSlot
              ? `
              <label>
                Passiva de Capitao
                <select data-captain-passive>
                  ${state.captainPassiveOptions
                    .map(
                      (entry) =>
                        `<option value="${entry.id}" ${entry.id === activePassiveId ? 'selected' : ''}>${entry.label}</option>`,
                    )
                    .join('')}
                </select>
              </label>
              <p class="subtitle captain-loadout-description">${
                state.captainPassiveOptions.find((entry) => entry.id === activePassiveId)?.description ??
                'Selecione a passiva tematica.'
              }</p>
              <label>
                Face Especial
                <select data-captain-face>
                  ${state.captainFaceOptions
                    .map(
                      (entry) =>
                        `<option value="${entry.id}" ${entry.id === activeFaceId ? 'selected' : ''}>${entry.label}</option>`,
                    )
                    .join('')}
                </select>
              </label>
              <p class="subtitle captain-loadout-description">${
                state.captainFaceOptions.find((entry) => entry.id === activeFaceId)?.description ??
                'Selecione a face especial.'
              }</p>
            `
              : '<p class="subtitle">Defina um capitao para editar passiva e face especial.</p>'
          }
        </div>
      </section>

      <section class="recruitment-funds">
        <h2>Fundos de Recrutamento</h2>
        <p>Orcamento: <strong>${state.hiringBudget}</strong> ouro</p>
        <p>Gasto: <strong>${state.hiringSpent}</strong> ouro</p>
        <p>Restante inicial da run: <strong>${state.hiringRemaining}</strong> ouro</p>
        <button type="button" class="secondary-btn" id="regenerate-roster-btn">Novo roster</button>
      </section>

      <section class="team-strip">
        <h2>Time Recrutado</h2>
        <div class="team-member-list">${teamMarkup || '<p>Nenhum integrante recrutado.</p>'}</div>
      </section>

      <section class="candidate-grid">
        <h2>Candidatos</h2>
        <div class="candidate-list">${candidateMarkup || '<p>Sem candidatos disponiveis.</p>'}</div>
      </section>

      <section class="candidate-detail">
        <h2>Preview de Faces</h2>
        ${
          selectedClassDef && selectedBgDef
            ? `
            <p class="subtitle"><strong>${selectedClassDef.name}</strong> + ${selectedBgDef.name}</p>
            <h3>Dado de classe</h3>
            <div class="face-preview-list dice-preview-grid">${classFaceMarkup || '<p>Sem dado de classe.</p>'}</div>
            <h3>Dado de background</h3>
            <div class="face-preview-list dice-preview-grid">${bgFaceMarkup || '<p>Sem dado de background.</p>'}</div>
            `
            : '<p>Selecione um candidato para ver o preview completo de faces.</p>'
        }
      </section>

      <section class="meta-form recruitment-actions">
        <label>
          Seed da run
          <input id="meta-seed-input" type="number" value="${safeNumber(state.seed)}" min="1" max="2147483647" />
        </label>
        <button type="button" class="primary-btn" id="start-run-btn">Iniciar expedicao</button>
      </section>

      <div class="meta-actions">
        <button id="reset-profile-btn" class="secondary-btn danger" type="button">Resetar perfil</button>
      </div>

      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#regenerate-roster-btn')?.addEventListener('click', () => {
    handlers.onRegenerateRoster();
  });

  root.querySelectorAll<HTMLElement>('[data-focus-candidate]').forEach((el) => {
    el.addEventListener('click', () => {
      const classId = el.dataset.focusCandidate;
      if (!classId) {
        return;
      }
      handlers.onFocusCandidate(classId);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-toggle-recruit]').forEach((button) => {
    button.addEventListener('click', () => {
      const classId = button.dataset.toggleRecruit;
      if (!classId) {
        return;
      }
      if (partyClassSet.has(classId)) {
        handlers.onRemovePartyMember(classId);
      } else {
        handlers.onRecruitCandidate(classId);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-remove-party-class]').forEach((button) => {
    button.addEventListener('click', () => {
      const classId = button.dataset.removePartyClass;
      if (!classId) {
        return;
      }
      handlers.onRemovePartyMember(classId);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-set-captain]').forEach((button) => {
    button.addEventListener('click', () => {
      const classId = button.dataset.setCaptain;
      if (!classId) {
        return;
      }
      handlers.onSetCaptain(classId);
    });
  });

  root.querySelector<HTMLSelectElement>('[data-captain-passive]')?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    handlers.onSetCaptainPassive(target.value as CaptainPassiveId);
  });

  root.querySelector<HTMLSelectElement>('[data-captain-face]')?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    handlers.onSetCaptainFace(target.value as CaptainFaceId);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-face-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.faceKey;
      if (!key) {
        return;
      }
      handlers.onToggleFaceTooltip(state.openFaceTooltipKey === key ? null : key);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-close-face-tooltip]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.onToggleFaceTooltip(null);
    });
  });

  root.querySelector<HTMLElement>('main.meta-screen')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-face-key]') || target.closest('.face-tooltip-popover')) {
      return;
    }
    if (state.openFaceTooltipKey) {
      handlers.onToggleFaceTooltip(null);
    }
  });

  root.querySelector<HTMLInputElement>('#meta-seed-input')?.addEventListener('change', (event) => {
    const raw = Number((event.currentTarget as HTMLInputElement).value);
    handlers.onSetSeed(safeNumber(raw));
  });

  root.querySelector<HTMLButtonElement>('#start-run-btn')?.addEventListener('click', () => {
    handlers.onStartRun(safeNumber(state.seed));
  });

  root.querySelector<HTMLButtonElement>('#reset-profile-btn')?.addEventListener('click', () => {
    handlers.onResetProfile();
  });
};
