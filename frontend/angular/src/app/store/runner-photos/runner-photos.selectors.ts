import { createSelector } from '@ngrx/store';
import { runnerPhotosFeature } from './runner-photos.reducer';

export const {
  selectRunnerPhotosState,
  selectPhotos: selectRunnerPhotos,
  selectLoading: selectRunnerPhotosLoading,
  selectError: selectRunnerPhotosError,
  selectSearchedBib,
  selectSelectedPhotoId,
} = runnerPhotosFeature;

export const selectHasSearched = createSelector(
  selectSearchedBib,
  (bib) => bib !== null,
);

export const selectHasResults = createSelector(
  selectRunnerPhotos,
  (photos) => photos.length > 0,
);

export const selectSelectedPhoto = createSelector(
  selectRunnerPhotos,
  selectSelectedPhotoId,
  (photos, id) => (id ? (photos.find((p) => p.photoId === id) ?? null) : null),
);
