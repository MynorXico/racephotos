import { createReducer, on } from '@ngrx/store';
import { PhotographerActions } from './photographer.actions';
import { initialPhotographerState, PhotographerState } from './photographer.state';

export const photographerReducer = createReducer<PhotographerState>(
  initialPhotographerState,

  on(PhotographerActions.loadProfile, (state) => ({
    ...state,
    loading: true,
    error: null,
    saveError: null,
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

  // Auto-init path: GET returned 404; PUT with empty defaults will follow.
  // Sets loading: false (GET phase done) and wasAutoInitialized: true so the
  // welcome banner appears once the PUT completes.
  on(PhotographerActions.initProfile, (state) => ({
    ...state,
    loading: false,
    saving: true,
    wasAutoInitialized: true,
    error: null,
    saveError: null,
  })),

  // User-initiated save: clear the auto-init flag so the welcome banner hides.
  on(PhotographerActions.updateProfile, (state) => ({
    ...state,
    loading: false,
    saving: true,
    wasAutoInitialized: false,
    saveError: null,
  })),

  on(PhotographerActions.updateProfileSuccess, (state, { profile }) => ({
    ...state,
    loading: false,
    saving: false,
    profile,
    saveError: null,
  })),

  on(PhotographerActions.updateProfileFailure, (state, { error }) => ({
    ...state,
    loading: false,
    saving: false,
    saveError: error,
  })),
);
