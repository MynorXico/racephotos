import { createFeature, createReducer, on } from '@ngrx/store';
import { RunnerPhoto, RunnerPhotosActions } from './runner-photos.actions';

export type BrowseMode = 'all' | 'bib';

export interface RunnerPhotosState {
  photos: RunnerPhoto[];
  searchedBib: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  selectedPhotoId: string | null;
  nextCursor: string | null;
  totalCount: number;
  mode: BrowseMode;
}

const initialState: RunnerPhotosState = {
  photos: [],
  searchedBib: null,
  loading: false,
  loadingMore: false,
  error: null,
  loadMoreError: null,
  selectedPhotoId: null,
  nextCursor: null,
  totalCount: 0,
  mode: 'all',
};

const runnerPhotosReducer = createReducer<RunnerPhotosState>(
  initialState,

  // ── All-event browse ──────────────────────────────────────────────────────

  on(RunnerPhotosActions.loadEventPhotos, (state) => ({
    ...state,
    loading: true,
    error: null,
    photos: [],
    nextCursor: null,
    totalCount: 0,
    mode: 'all' as BrowseMode,
    searchedBib: null,
  })),

  on(RunnerPhotosActions.loadEventPhotosSuccess, (state, { photos, nextCursor, totalCount }) => ({
    ...state,
    loading: false,
    photos,
    nextCursor,
    totalCount,
  })),

  on(RunnerPhotosActions.loadEventPhotosFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(RunnerPhotosActions.loadMoreEventPhotos, (state) => ({
    ...state,
    loadingMore: true,
    loadMoreError: null,
  })),

  on(RunnerPhotosActions.loadMoreEventPhotosSuccess, (state, { photos, nextCursor }) => {
    // Guard: if mode changed to 'bib' while the HTTP request was in-flight,
    // discard the stale response to prevent corrupting the current page state.
    if (state.mode !== 'all') return state;
    return { ...state, loadingMore: false, photos: [...state.photos, ...photos], nextCursor };
  }),

  on(RunnerPhotosActions.loadMoreEventPhotosFailure, (state, { error }) => ({
    ...state,
    loadingMore: false,
    loadMoreError: error,
  })),

  // ── Bib search ────────────────────────────────────────────────────────────

  on(RunnerPhotosActions.searchByBib, (state, { bibNumber }) => ({
    ...state,
    loading: true,
    error: null,
    searchedBib: bibNumber,
    photos: [],
    nextCursor: null,
    totalCount: 0,
    mode: 'bib' as BrowseMode,
  })),

  on(RunnerPhotosActions.searchByBibSuccess, (state, { photos, nextCursor, totalCount }) => ({
    ...state,
    loading: false,
    photos,
    nextCursor,
    totalCount,
  })),

  on(RunnerPhotosActions.searchByBibFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(RunnerPhotosActions.loadMoreBibPhotos, (state) => ({
    ...state,
    loadingMore: true,
    loadMoreError: null,
  })),

  on(RunnerPhotosActions.loadMoreBibPhotosSuccess, (state, { photos, nextCursor }) => {
    // Guard: if mode changed to 'all' while the HTTP request was in-flight,
    // discard the stale response to prevent corrupting the current page state.
    if (state.mode !== 'bib') return state;
    return { ...state, loadingMore: false, photos: [...state.photos, ...photos], nextCursor };
  }),

  on(RunnerPhotosActions.loadMoreBibPhotosFailure, (state, { error }) => ({
    ...state,
    loadingMore: false,
    loadMoreError: error,
  })),

  // ── Photo selection ───────────────────────────────────────────────────────

  on(RunnerPhotosActions.selectPhoto, (state, { photoId }) => ({
    ...state,
    selectedPhotoId: photoId,
  })),

  on(RunnerPhotosActions.deselectPhoto, (state) => ({
    ...state,
    selectedPhotoId: null,
  })),

  on(RunnerPhotosActions.clearResults, () => initialState),
);

export const runnerPhotosFeature = createFeature({
  name: 'runnerPhotos',
  reducer: runnerPhotosReducer,
});
