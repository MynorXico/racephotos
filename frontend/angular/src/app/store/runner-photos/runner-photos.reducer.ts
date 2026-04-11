import { createFeature, createReducer, on } from '@ngrx/store';
import { RunnerPhoto, RunnerPhotosActions } from './runner-photos.actions';

export interface RunnerPhotosState {
  photos: RunnerPhoto[];
  searchedBib: string | null;
  loading: boolean;
  error: string | null;
  selectedPhotoId: string | null;
}

const initialState: RunnerPhotosState = {
  photos: [],
  searchedBib: null,
  loading: false,
  error: null,
  selectedPhotoId: null,
};

const runnerPhotosReducer = createReducer<RunnerPhotosState>(
  initialState,

  on(RunnerPhotosActions.searchByBib, (state, { bibNumber }) => ({
    ...state,
    loading: true,
    error: null,
    searchedBib: bibNumber,
    photos: [],
  })),

  on(RunnerPhotosActions.searchByBibSuccess, (state, { photos }) => ({
    ...state,
    loading: false,
    photos,
  })),

  on(RunnerPhotosActions.searchByBibFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

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
