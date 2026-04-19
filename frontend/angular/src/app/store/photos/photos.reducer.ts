import { createFeature, createReducer, on } from '@ngrx/store';
import { Photo, PhotoStatusFilter, PhotosActions } from './photos.actions';

export interface PhotosState {
  photos: Photo[];
  nextCursor: string | null;
  activeFilter: PhotoStatusFilter | null;
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

    // ── Upsert Photo ─────────────────────────────────────────────────────────
    // Patch a single photo after bib re-tag without a full reload (RS-013).
    on(PhotosActions.upsertPhoto, (state, { photo }) => ({
      ...state,
      photos: state.photos.map((p) => (p.id === photo.id ? photo : p)),
    })),
  ),
});
