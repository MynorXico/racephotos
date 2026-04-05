import { createReducer, on } from '@ngrx/store';
import { PhotographerActions } from './photographer.actions';
import { initialPhotographerState, PhotographerState } from './photographer.state';

export const photographerReducer = createReducer<PhotographerState>(
  initialPhotographerState,

  on(PhotographerActions.loadProfile, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(PhotographerActions.loadProfileSuccess, (state, { profile }) => ({
    ...state,
    loading: false,
    profile,
    error: null,
  })),

  on(PhotographerActions.loadProfileFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(PhotographerActions.updateProfile, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),

  on(PhotographerActions.updateProfileSuccess, (state, { profile }) => ({
    ...state,
    saving: false,
    profile,
    error: null,
  })),

  on(PhotographerActions.updateProfileFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
);
