import { createSelector } from '@ngrx/store';
import { photosFeature } from './photos.reducer';

export const {
  selectPhotosState,
  selectPhotos: selectAllPhotos,
  selectNextCursor,
  selectActiveFilter,
  selectLoading: selectPhotosLoading,
  selectError: selectPhotosError,
} = photosFeature;

export const selectHasMorePages = createSelector(
  selectNextCursor,
  (cursor) => cursor !== null,
);

export const selectPhotoCount = createSelector(
  selectAllPhotos,
  (photos) => photos.length,
);
