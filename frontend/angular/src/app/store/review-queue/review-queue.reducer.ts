import { createFeature, createReducer, on } from '@ngrx/store';
import { ReviewPhoto, ReviewQueueActions } from './review-queue.actions';

export interface ReviewQueueState {
  photos: ReviewPhoto[];
  loading: boolean;
  error: string | null;
  saveLoading: Record<string, boolean>;
  saveError: Record<string, string | null>;
}

export const initialReviewQueueState: ReviewQueueState = {
  photos: [],
  loading: false,
  error: null,
  saveLoading: {},
  saveError: {},
};

export const reviewQueueFeature = createFeature({
  name: 'reviewQueue',
  reducer: createReducer<ReviewQueueState>(
    initialReviewQueueState,

    // ── Load Review Queue ────────────────────────────────────────────────────
    on(ReviewQueueActions.loadReviewQueue, (state) => ({
      ...state,
      loading: true,
      error: null,
      photos: [],
    })),

    on(ReviewQueueActions.loadReviewQueueSuccess, (state, { photos }) => ({
      ...state,
      loading: false,
      photos,
    })),

    on(ReviewQueueActions.loadReviewQueueFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // ── Save Photo Bibs ──────────────────────────────────────────────────────
    on(ReviewQueueActions.savePhotoBibs, (state, { photoId }) => ({
      ...state,
      saveLoading: { ...state.saveLoading, [photoId]: true },
      saveError: { ...state.saveError, [photoId]: null },
    })),

    on(ReviewQueueActions.savePhotoBibsSuccess, (state, { photoId, updatedPhoto }) => ({
      ...state,
      saveLoading: { ...state.saveLoading, [photoId]: false },
      saveError: { ...state.saveError, [photoId]: null },
      photos: state.photos.map((p) => (p.id === photoId ? updatedPhoto : p)),
    })),

    on(ReviewQueueActions.savePhotoBibsFailure, (state, { photoId, error }) => ({
      ...state,
      saveLoading: { ...state.saveLoading, [photoId]: false },
      saveError: { ...state.saveError, [photoId]: error },
    })),
  ),
});
