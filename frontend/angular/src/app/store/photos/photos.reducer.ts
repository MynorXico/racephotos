import { createFeature, createReducer, on } from '@ngrx/store';
import { Photo, PhotoStatus, PhotosActions } from './photos.actions';

export interface PhotosState {
  photos: Photo[];
  nextCursor: string | null;
  activeFilter: PhotoStatus | null;
  loading: boolean;
  error: string | null;
}

export const initialPhotosState: PhotosState = {
  photos: [],
  nextCursor: null,
  activeFilter: null,
  loading: false,
  error: null,
};

export const photosFeature = createFeature({
  name: 'photos',
  reducer: createReducer<PhotosState>(
    initialPhotosState,

    // ── Load Photos (initial / filter reset) ──────────────────────────────────
    on(PhotosActions.loadPhotos, (state) => ({
      ...state,
      loading: true,
      error: null,
      photos: [],
      nextCursor: null,
    })),

    on(PhotosActions.loadPhotosSuccess, (state, { photos, nextCursor }) => ({
      ...state,
      loading: false,
      photos,
      nextCursor,
    })),

    on(PhotosActions.loadPhotosFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // ── Load Next Page (append) ───────────────────────────────────────────────
    on(PhotosActions.loadNextPage, (state) => ({
      ...state,
      loading: true,
      error: null,
    })),

    on(PhotosActions.loadNextPageSuccess, (state, { photos, nextCursor }) => ({
      ...state,
      loading: false,
      photos: [...state.photos, ...photos],
      nextCursor,
    })),

    on(PhotosActions.loadNextPageFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // ── Filter By Status ──────────────────────────────────────────────────────
    // Reset list and cursor; effect dispatches Load Photos after this.
    on(PhotosActions.filterByStatus, (state, { status }) => ({
      ...state,
      activeFilter: status,
      photos: [],
      nextCursor: null,
      loading: true,
      error: null,
    })),

    // ── Clear Photos ──────────────────────────────────────────────────────────
    on(PhotosActions.clearPhotos, () => initialPhotosState),
  ),
});
