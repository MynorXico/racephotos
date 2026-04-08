import { createActionGroup, emptyProps, props } from '@ngrx/store';

/** A file that failed to upload, with the error message. */
export interface FailedFile {
  file: File;
  errorMessage: string;
}

/** Presigned metadata returned by the API for a single photo. */
export interface PresignedFile {
  file: File;
  photoId: string;
  presignedUrl: string;
  contentType: string;
}

export const PhotoUploadActions = createActionGroup({
  source: 'PhotoUpload',
  events: {
    /** Component dispatches this when the photographer drops or selects files. */
    'Upload Files': props<{ files: File[]; eventId: string }>(),

    /** Effect dispatches internally — one per 100-file batch. */
    'Presign Batch': props<{ batch: File[]; eventId: string }>(),

    /** Effect dispatches after the presign API returns successfully. */
    'Presign Batch Success': props<{ presignedFiles: PresignedFile[] }>(),

    /** Effect dispatches when the presign API call itself fails. */
    'Presign Batch Failure': props<{ error: string }>(),

    /** Effect dispatches after each individual S3 PUT succeeds. */
    'File Upload Progress': props<{ uploadedCount: number }>(),

    /** Effect dispatches after each individual S3 PUT fails. */
    'File Upload Failed': props<{ file: File; errorMessage: string }>(),

    /** Component dispatches when the photographer clicks Retry on a single file. */
    'Retry File': props<{ file: File; eventId: string }>(),

    /** Component dispatches in ngOnDestroy to reset the slice on navigation away. */
    'Reset Upload': emptyProps(),
  },
});
