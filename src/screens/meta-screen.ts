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
  onResetRoster: () => void;
  onRandomRecruit: () => void;
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
  const totalCandidates = state.rosterCandidates.length;
  const isCarouselLooping = totalCandidates > 1;
  const carouselLoopCopies = isCarouselLooping ? 3 : 1;
  const carouselCandidates = Array.from({ length: carouselLoopCopies }, (_, copyIndex) =>
    state.rosterCandidates.map((candidate) => ({ candidate, copyIndex })),
  ).flat();

  const captainClassId = state.captainClassId ?? state.draftParty[0]?.classId ?? null;
  const captainSlot = captainClassId
    ? state.draftParty.find((entry) => entry.classId === captainClassId) ?? null
    : null;
  const captainClass = captainSlot ? state.content.byId.classes[captainSlot.classId] : null;
  const isCaptainWizardStep = !captainClassId;
  const activePassiveId = state.captainLoadoutSelection?.passiveId ?? '';
  const activeFaceId = state.captainLoadoutSelection?.faceId ?? '';

  const partyClassSet = new Set(state.draftParty.map((entry) => entry.classId));

  const renderFaceMarkup = (faces: ReturnType<typeof materializeAllDieFaces>, keyPrefix: string): string =>
    faces
      .map((face, index) => {
        const key = `${keyPrefix}_${index}`;
        return `
          <button type="button" class="face-preview-card ${face.kind === 'empty' ? 'empty' : 'filled'}" data-face-key="${key}">
            <img src="${renderDieFaceMiniSprite(face)}" alt="${face.label}" />
            <small>${face.label}</small>
            ${state.openFaceTooltipKey === key ? renderFaceTooltipPopover(face) : ''}
          </button>
        `;
      })
      .join('');

  const candidateMarkup = carouselCandidates
    .map(({ candidate, copyIndex }, renderIndex) => {
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
      const classDieId = classDef?.starterDiceIds[0];
      const classDie = classDieId ? state.content.byId.dice[classDieId] : undefined;
      const classFaces = classDie ? materializeAllDieFaces(classDie) : [];
      if (classDie && isCaptain && state.captainLoadoutSelection) {
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
      const bgDie = backgroundDef ? state.content.byId.dice[backgroundDef.starterDieId] : undefined;
      const bgFaces = bgDie ? materializeAllDieFaces(bgDie) : [];
      const classFaceMarkup = renderFaceMarkup(classFaces, `class_${candidate.classId}_${copyIndex}_${renderIndex}`);
      const bgFaceMarkup = renderFaceMarkup(bgFaces, `bg_${candidate.classId}_${copyIndex}_${renderIndex}`);
      const captainActionDisabled = !isRecruited || isCaptain;
      return `
        <article class="${cardClass} roster-entry-card" data-focus-candidate="${candidate.classId}" data-carousel-card-index="${renderIndex}">
          <div class="roster-entry-top">
            <img class="roster-entry-portrait" src="${avatar}" alt="${classDef?.name ?? candidate.classId}" />
            <div class="roster-entry-meta">
              <strong>${classDef?.name ?? candidate.classId}</strong>
              <small>${backgroundDef?.name ?? candidate.backgroundId}</small>
              <small>${isRecruited ? 'No time recrutado' : `Hiring ${candidate.hireCost} ouro`}</small>
            </div>
            <div class="roster-entry-badges">
              ${isRecruited ? '<span class="roster-badge recruited">RECRUTADO</span>' : '<span class="roster-badge available">CANDIDATO</span>'}
              ${isCaptain ? '<span class="roster-badge captain">CAPITAO</span>' : ''}
            </div>
          </div>
          <div class="roster-entry-faces">
            <section class="roster-face-section">
              <h3>Dado de Classe</h3>
              <div class="face-preview-list roster-face-list">${classFaceMarkup || '<p>Sem dado de classe.</p>'}</div>
            </section>
            <section class="roster-face-section">
              <h3>Dado de Background</h3>
              <div class="face-preview-list roster-face-list">${bgFaceMarkup || '<p>Sem dado de background.</p>'}</div>
            </section>
          </div>
          <div class="candidate-actions roster-entry-actions">
            <button type="button" class="${isRecruited ? 'secondary-btn mini danger' : 'primary-btn mini'}" data-toggle-recruit="${candidate.classId}">
              ${isRecruited ? 'Remover' : 'Recrutar'}
            </button>
            <button type="button" class="secondary-btn mini" data-set-captain="${candidate.classId}" ${
              captainActionDisabled ? 'disabled' : ''
            }>Definir capitao</button>
          </div>
        </article>
      `;
    })
    .join('');

  const wizardSelectedClassDef = selectedCandidate
    ? state.content.byId.classes[selectedCandidate.classId]
    : undefined;
  const wizardSelectedBgDef = selectedCandidate
    ? state.content.byId.backgrounds[selectedCandidate.backgroundId]
    : undefined;
  const wizardClassDieId = wizardSelectedClassDef?.starterDiceIds[0];
  const wizardClassDie = wizardClassDieId ? state.content.byId.dice[wizardClassDieId] : undefined;
  const wizardBgDie = wizardSelectedBgDef ? state.content.byId.dice[wizardSelectedBgDef.starterDieId] : undefined;
  const wizardClassFaceMarkup = wizardClassDie
    ? renderFaceMarkup(
        materializeAllDieFaces(wizardClassDie),
        `wizard_class_${selectedCandidate?.classId ?? 'none'}`,
      )
    : '';
  const wizardBgFaceMarkup = wizardBgDie
    ? renderFaceMarkup(
        materializeAllDieFaces(wizardBgDie),
        `wizard_bg_${selectedCandidate?.classId ?? 'none'}`,
      )
    : '';
  const captainWizardChoicesMarkup = state.rosterCandidates
    .map((candidate) => {
      const classDef = state.content.byId.classes[candidate.classId];
      const backgroundDef = state.content.byId.backgrounds[candidate.backgroundId];
      const isSelected = selectedCandidate?.classId === candidate.classId;
      return `
        <button type="button" class="captain-choice-tile ${isSelected ? 'selected' : ''}" data-focus-candidate="${candidate.classId}">
          <img src="${resolveCombatantAvatarSrc(`party:${candidate.classId}`)}" alt="${classDef?.name ?? candidate.classId}" />
          <div>
            <strong>${classDef?.name ?? candidate.classId}</strong>
            <small>${backgroundDef?.name ?? candidate.backgroundId}</small>
          </div>
        </button>
      `;
    })
    .join('');
  const captainAvatar = resolveCombatantAvatarSrc(
    `party:${captainSlot?.classId ?? selectedCandidate?.classId ?? state.rosterCandidates[0]?.classId ?? 'default'}`,
  );

  root.innerHTML = `
    <main class="screen meta-screen recruitment-screen">
      <header class="title-block recruitment-header">
        <h1>Recrutamento da Expedicao</h1>
        <p class="subtitle">${
          isCaptainWizardStep
            ? 'Etapa 1/2: escolha o capitao com destaque total.'
            : 'Etapa 2/2: monte o roster completo.'
        }</p>
      </header>
      ${
        isCaptainWizardStep
          ? `
      <section class="captain-wizard-shell">
        <div class="captain-wizard-stage">
          ${
            selectedCandidate && wizardSelectedClassDef && wizardSelectedBgDef
              ? `
          <article class="captain-wizard-card">
            <img class="captain-wizard-portrait" src="${resolveCombatantAvatarSrc(`party:${selectedCandidate.classId}`)}" alt="${wizardSelectedClassDef.name}" />
            <div class="captain-wizard-meta">
              <h2>${wizardSelectedClassDef.name}</h2>
              <p>${wizardSelectedBgDef.name}</p>
              <p>Hiring: <strong>${selectedCandidate.hireCost}</strong> ouro</p>
            </div>
            <div class="captain-wizard-faces">
              <section class="roster-face-section">
                <h3>Dado de Classe</h3>
                <div class="face-preview-list roster-face-list">${wizardClassFaceMarkup || '<p>Sem dado de classe.</p>'}</div>
              </section>
              <section class="roster-face-section">
                <h3>Dado de Background</h3>
                <div class="face-preview-list roster-face-list">${wizardBgFaceMarkup || '<p>Sem dado de background.</p>'}</div>
              </section>
            </div>
          </article>
          `
              : '<p class="recruitment-carousel-empty">Sem candidatos disponiveis.</p>'
          }
        </div>

        <div class="captain-wizard-list">
          ${captainWizardChoicesMarkup || '<p class="recruitment-carousel-empty">Sem candidatos disponiveis.</p>'}
        </div>

        <div class="captain-wizard-controls">
          <button type="button" class="primary-btn" id="pick-captain-btn" ${selectedCandidate ? '' : 'disabled'}>Definir Capitao</button>
          <div class="recruitment-funds-actions">
            <button type="button" class="secondary-btn mini" id="regenerate-roster-btn">Novo Roster</button>
            <button type="button" class="secondary-btn mini" id="reset-roster-btn">Reset Roster</button>
            <button type="button" class="secondary-btn mini" id="random-recruit-btn">Random Recruit</button>
          </div>
        </div>
      </section>
      `
          : `
      <section class="recruitment-roster-shell">
        <div class="recruitment-roster-header">
          <div class="recruitment-overview-card">
            <strong>Recrutados</strong>
            <em>${state.draftParty.length}/4</em>
            <small>Capitao: ${captainClass?.name ?? 'Nao definido'}</small>
          </div>
          <div class="recruitment-funds">
            <h2>Fundos de Recrutamento</h2>
            <p>Orcamento: <strong>${state.hiringBudget}</strong> ouro</p>
            <p>Gasto: <strong>${state.hiringSpent}</strong> ouro</p>
            <p>Restante inicial da run: <strong>${state.hiringRemaining}</strong> ouro</p>
          </div>
          <div class="captain-id-block">
            <img class="captain-id-portrait" src="${captainAvatar}" alt="${captainClass?.name ?? 'Capitao'}" />
            <div class="captain-id-meta">
              <strong>Capitao Atual</strong>
              <small>${captainClass?.name ?? 'Nao definido'}</small>
            </div>
          </div>
        </div>

        <div class="recruitment-funds-actions">
          <button type="button" class="secondary-btn mini" id="regenerate-roster-btn">Novo Roster</button>
          <button type="button" class="secondary-btn mini" id="reset-roster-btn">Reset Roster</button>
          <button type="button" class="secondary-btn mini" id="random-recruit-btn">Random Recruit</button>
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

        <div class="recruitment-carousel-shell ${isCarouselLooping ? 'is-looping' : 'is-static'}">
          <button type="button" class="recruitment-carousel-nav prev" data-carousel-step="-1" ${
            isCarouselLooping ? '' : 'disabled'
          } aria-label="Card anterior">◀</button>
          <div class="recruitment-roster-carousel" data-roster-carousel data-roster-total="${totalCandidates}" data-roster-loop="${isCarouselLooping ? 'true' : 'false'}">
            <div class="recruitment-roster-track">
              ${candidateMarkup || '<p class="recruitment-carousel-empty">Sem candidatos disponiveis.</p>'}
            </div>
          </div>
          <button type="button" class="recruitment-carousel-nav next" data-carousel-step="1" ${
            isCarouselLooping ? '' : 'disabled'
          } aria-label="Proximo card">▶</button>
        </div>
        <p class="recruitment-carousel-hint">${isCarouselLooping ? 'Arraste para navegar no carrossel continuo.' : 'Card unico ativo.'}</p>
      </section>

      <section class="meta-form recruitment-actions">
        <label>
          Seed da run
          <input id="meta-seed-input" type="number" value="${safeNumber(state.seed)}" min="1" max="2147483647" />
        </label>
        <button type="button" class="primary-btn" id="start-run-btn">Iniciar expedicao</button>
      </section>
      `
      }

      <p class="status-line">${state.message}</p>
    </main>
  `;

  root.querySelector<HTMLButtonElement>('#regenerate-roster-btn')?.addEventListener('click', () => {
    handlers.onRegenerateRoster();
  });

  root.querySelector<HTMLButtonElement>('#reset-roster-btn')?.addEventListener('click', () => {
    handlers.onResetRoster();
  });

  root.querySelector<HTMLButtonElement>('#random-recruit-btn')?.addEventListener('click', () => {
    handlers.onRandomRecruit();
  });

  root.querySelector<HTMLButtonElement>('#pick-captain-btn')?.addEventListener('click', () => {
    if (!selectedCandidate) {
      return;
    }
    handlers.onRecruitCandidate(selectedCandidate.classId);
  });

  const carouselEl = root.querySelector<HTMLElement>('[data-roster-carousel]');
  if (carouselEl) {
    const trackEl = carouselEl.querySelector<HTMLElement>('.recruitment-roster-track');
    const baseCount = Math.max(1, totalCandidates);
    const getCards = (): HTMLElement[] =>
      Array.from(trackEl?.querySelectorAll<HTMLElement>('.candidate-card') ?? []);
    const getClosestCardIndex = (): number => {
      const cards = getCards();
      if (cards.length === 0) {
        return -1;
      }
      const center = carouselEl.scrollLeft + carouselEl.clientWidth / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(cardCenter - center);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      return closestIndex;
    };
    const scrollToCard = (index: number, behavior: ScrollBehavior = 'smooth'): void => {
      const cards = getCards();
      const targetCard = cards[index];
      if (!targetCard) {
        return;
      }
      const targetLeft = targetCard.offsetLeft - (carouselEl.clientWidth - targetCard.offsetWidth) / 2;
      carouselEl.scrollTo({ left: targetLeft, behavior });
    };

    const isLoop = carouselEl.dataset.rosterLoop === 'true';
    let normalizeTimer: number | undefined;
    const normalizeLoopPosition = (): void => {
      if (!isLoop) {
        return;
      }
      const cards = getCards();
      if (cards.length === 0) {
        return;
      }
      const currentIndex = getClosestCardIndex();
      if (currentIndex < 0) {
        return;
      }
      const logicalIndex = ((currentIndex % baseCount) + baseCount) % baseCount;
      const centeredIndex = logicalIndex + baseCount;
      if (centeredIndex !== currentIndex) {
        scrollToCard(centeredIndex, 'auto');
      }
    };

    if (isLoop) {
      requestAnimationFrame(() => {
        normalizeLoopPosition();
        requestAnimationFrame(() => {
          normalizeLoopPosition();
        });
      });

      let scrollFrame = 0;
      carouselEl.addEventListener(
        'scroll',
        () => {
          if (scrollFrame) {
            return;
          }
          scrollFrame = window.requestAnimationFrame(() => {
            scrollFrame = 0;
            const currentIndex = getClosestCardIndex();
            if (currentIndex < 0) {
              return;
            }
            if (currentIndex < baseCount || currentIndex >= baseCount * 2) {
              normalizeLoopPosition();
            }
          });
        },
        { passive: true },
      );
    }

    root.querySelectorAll<HTMLButtonElement>('[data-carousel-step]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = Number(button.dataset.carouselStep ?? '0');
        if (!Number.isFinite(direction) || direction === 0) {
          return;
        }
        if (isLoop) {
          normalizeLoopPosition();
        }
        const cards = getCards();
        const currentIndex = getClosestCardIndex();
        if (cards.length === 0 || currentIndex < 0) {
          return;
        }
        let nextIndex = currentIndex + (direction > 0 ? 1 : -1);
        if (isLoop) {
          if (nextIndex < 0) {
            nextIndex = cards.length - 1;
          } else if (nextIndex >= cards.length) {
            nextIndex = 0;
          }
        } else {
          nextIndex = Math.min(Math.max(nextIndex, 0), cards.length - 1);
        }
        scrollToCard(nextIndex, 'smooth');
        if (isLoop) {
          if (normalizeTimer !== undefined) {
            window.clearTimeout(normalizeTimer);
          }
          normalizeTimer = window.setTimeout(() => {
            normalizeLoopPosition();
            normalizeTimer = undefined;
          }, 280);
        }
      });
    });
  }

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
    const key = button.dataset.faceKey;
    if (!key) {
      return;
    }
    let longPressTimer: number | undefined;
    let longPressActive = false;
    let suppressClick = false;
    let pointerDown = false;
    const clearLongPressTimer = (): void => {
      if (longPressTimer !== undefined) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    };
    const endLongPress = (): void => {
      pointerDown = false;
      clearLongPressTimer();
      if (longPressActive) {
        handlers.onToggleFaceTooltip(null);
        longPressActive = false;
      }
    };

    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      pointerDown = true;
      longPressActive = false;
      suppressClick = false;
      clearLongPressTimer();
      longPressTimer = window.setTimeout(() => {
        if (!pointerDown) {
          return;
        }
        longPressActive = true;
        suppressClick = true;
        handlers.onToggleFaceTooltip(key);
      }, 360);
    });

    button.addEventListener('pointerup', () => {
      endLongPress();
    });

    button.addEventListener('pointercancel', () => {
      endLongPress();
    });

    button.addEventListener('pointerleave', () => {
      endLongPress();
    });

    button.addEventListener('mouseenter', () => {
      handlers.onToggleFaceTooltip(key);
    });

    button.addEventListener('mouseleave', () => {
      handlers.onToggleFaceTooltip(null);
    });

    button.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      handlers.onToggleFaceTooltip(key);
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
};
