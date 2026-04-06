import { createFeatureSelector, createSelector } from '@ngrx/store';
import { PhotographerState } from './photographer.state';

export const selectPhotographerState = createFeatureSelector<PhotographerState>('photographer');

export const selectProfile = createSelector(selectPhotographerState, (s) => s.profile);
export const selectProfileLoading = createSelector(selectPhotographerState, (s) => s.loading);
export const selectProfileSaving = createSelector(selectPhotographerState, (s) => s.saving);
export const selectProfileError = createSelector(selectPhotographerState, (s) => s.error);
export const selectProfileSaveError = createSelector(selectPhotographerState, (s) => s.saveError);
export const selectWasAutoInitialized = createSelector(
  selectPhotographerState,
  (s) => s.wasAutoInitialized,
);
