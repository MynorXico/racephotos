import { createSelector } from '@ngrx/store';
import { photoUploadFeature } from './photo-upload.reducer';

export const {
  selectPhotoUploadState,
  selectTotal: selectUploadTotal,
  selectUploaded: selectUploadedCount,
  selectFailed: selectFailedFiles,
  selectInProgress: selectUploadInProgress,
  selectPresignError,
} = photoUploadFeature;

/** True when the session is finished: all files either succeeded or failed. */
export const selectUploadComplete = createSelector(
  selectPhotoUploadState,
  (state) =>
    !state.inProgress &&
    state.total > 0 &&
    state.uploaded + state.failed.length === state.total,
);

/** True when at least one file failed. */
export const selectHasFailures = createSelector(
  selectFailedFiles,
  (failed) => failed.length > 0,
);

/** Upload progress as an integer percentage (0–100). */
export const selectUploadProgressPercent = createSelector(
  selectUploadTotal,
  selectUploadedCount,
  (total, uploaded) => (total > 0 ? Math.round((uploaded / total) * 100) : 0),
);
