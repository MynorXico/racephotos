import { createFeature, createReducer, on } from '@ngrx/store';
import { ReviewPhoto, ReviewQueueActions } from './review-queue.actions';

export interface ReviewQueueState {
  photos: ReviewPhoto[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  paginationError: string | null;
  nextCursor: string | null;
  saveLoading: Record<string, boolean>;
  saveError: Record<string, string | null>;
}

export const initialReviewQueueState: ReviewQueueState = {
  photos: [],
  loading: false,
  loadingMore: false,
  error: null,
  paginationError: null,
  nextCursor: null,
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
      paginationError: null,
      photos: [],
      nextCursor: null,
    })),

    on(ReviewQueueActions.loadReviewQueueSuccess, (state, { photos, nextCursor }) => ({
      ...state,
      loading: false,
      photos,
      nextCursor,
    })),

    on(ReviewQueueActions.loadReviewQueueFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // ── Load Next Page (append) ───────────────────────────────────────────────
    on(ReviewQueueActions.loadNextPage, (state) => ({
      ...state,
      loadingMore: true,
      paginationError: null,
    })),

    on(ReviewQueueActions.loadNextPageSuccess, (state, { photos, nextCursor }) => ({
      ...state,
      loadingMore: false,
      photos: [...state.photos, ...photos],
      nextCursor,
    })),

    on(ReviewQueueActions.loadNextPageFailure, (state, { error }) => ({
      ...state,
      loadingMore: false,
      paginationError: error,
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
      // Remove indexed photos from the queue immediately — they no longer need
      // review and lingering cards confuse photographers with 409 errors on retry.
      photos: updatedPhoto.status === 'indexed'
        ? state.photos.filter((p) => p.id !== photoId)
        : state.photos.map((p) => (p.id === photoId ? { ...p, ...updatedPhoto } : p)),
    })),

    on(ReviewQueueActions.savePhotoBibsFailure, (state, { photoId, error }) => ({
      ...state,
      saveLoading: { ...state.saveLoading, [photoId]: false },
      saveError: { ...state.saveError, [photoId]: error },
    })),
  ),
});
