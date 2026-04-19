import { createSelector } from '@ngrx/store';
import { reviewQueueFeature } from './review-queue.reducer';

export const {
  selectReviewQueueState,
  selectPhotos: selectReviewPhotos,
  selectLoading: selectReviewQueueLoading,
  selectError: selectReviewQueueError,
  selectSaveLoading: selectSaveLoadingMap,
  selectSaveError: selectSaveErrorMap,
} = reviewQueueFeature;

export const selectReviewPhotoCount = createSelector(
  selectReviewPhotos,
  (photos) => photos.length,
);

export const selectSaveLoadingForPhoto = (photoId: string) =>
  createSelector(selectSaveLoadingMap, (map) => map[photoId] ?? false);

export const selectSaveErrorForPhoto = (photoId: string) =>
  createSelector(selectSaveErrorMap, (map) => map[photoId] ?? null);
