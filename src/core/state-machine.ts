import type { AppPhase, GameContent, GameState, ProfileState } from '../domain/shared/types';

export const createGameState = (content: GameContent, profile: ProfileState): GameState => ({
  phase: 'meta',
  content,
  profile,
  run: null,
  activeEvent: null,
  combat: null,
  rewardOptions: [],
  rewardSource: null,
  message: 'Monte sua trip e inicie a expedicao.',
});

export const setPhase = (state: GameState, phase: AppPhase, message?: string): GameState => ({
  ...state,
  phase,
  message: message ?? state.message,
});

export const withMessage = (state: GameState, message: string): GameState => ({
  ...state,
  message,
});
