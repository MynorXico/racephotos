import { createFeature, createReducer, on } from '@ngrx/store';
import { FailedFile, PhotoUploadActions } from './photo-upload.actions';

export interface PhotoUploadState {
  /** Total number of files in the current upload session. */
  total: number;
  /** Count of files whose S3 PUT succeeded. */
  uploaded: number;
  /** Files whose S3 PUT failed (after one attempt). */
  failed: FailedFile[];
  /** True from the first presign request until all PUTs finish or fail. */
  inProgress: boolean;
  /** Non-null when the /presign API call itself fails. */
  presignError: string | null;
}

export const initialPhotoUploadState: PhotoUploadState = {
  total: 0,
  uploaded: 0,
  failed: [],
  inProgress: false,
  presignError: null,
};

/** Derive whether all uploads are settled (used in reducer logic below). */
function allSettled(state: PhotoUploadState, deltaUploaded = 0, deltaFailed = 0): boolean {
  if (state.total === 0) return false;
  return state.uploaded + deltaUploaded + state.failed.length + deltaFailed >= state.total;
}

export const photoUploadFeature = createFeature({
  name: 'photoUpload',
  reducer: createReducer<PhotoUploadState>(
    initialPhotoUploadState,

    // ── Upload Files ──────────────────────────────────────────────────────────
    // Reset all state for the new session.
    on(PhotoUploadActions.uploadFiles, (_state, { files }) => ({
      total: files.length,
      uploaded: 0,
      failed: [],
      inProgress: true,
      presignError: null,
    })),

    // ── Presign Batch Failure ─────────────────────────────────────────────────
    on(PhotoUploadActions.presignBatchFailure, (state, { error }) => ({
      ...state,
      inProgress: false,
      presignError: error,
    })),

    // ── File Upload Progress ──────────────────────────────────────────────────
    on(PhotoUploadActions.fileUploadProgress, (state, { uploadedCount }) => {
      const newUploaded = state.uploaded + uploadedCount;
      return {
        ...state,
        uploaded: newUploaded,
        inProgress: !allSettled(state, uploadedCount, 0),
      };
    }),

    // ── File Upload Failed ────────────────────────────────────────────────────
    on(PhotoUploadActions.fileUploadFailed, (state, { file, errorMessage }) => {
      const newFailed: FailedFile[] = [...state.failed, { file, errorMessage }];
      return {
        ...state,
        failed: newFailed,
        inProgress: state.total > 0
          ? state.uploaded + newFailed.length < state.total
          : false,
      };
    }),

    // ── Retry File ────────────────────────────────────────────────────────────
    // Remove the file from the failed list and restart inProgress.
    on(PhotoUploadActions.retryFile, (state, { file }) => ({
      ...state,
      failed: state.failed.filter((f) => f.file !== file),
      inProgress: true,
      presignError: null,
    })),

    // ── Reset Upload ──────────────────────────────────────────────────────────
    on(PhotoUploadActions.resetUpload, () => initialPhotoUploadState),
  ),
});
