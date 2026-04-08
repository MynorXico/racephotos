import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Observable, from, of } from 'rxjs';
import {
  catchError,
  concatMap,
  map,
  mergeMap,
  tap,
} from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { PhotoUploadActions, PresignedFile } from './photo-upload.actions';

const PRESIGN_BATCH_SIZE = 100;
const S3_PUT_CONCURRENCY = 5;

interface PresignResponse {
  photos: { photoId: string; presignedUrl: string }[];
}

@Injectable()
export class PhotoUploadEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /**
   * On `Upload Files`: split files into 100-file batches, dispatch `Presign Batch`
   * for each batch sequentially (concatMap ensures batches do not overlap).
   */
  uploadFiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotoUploadActions.uploadFiles),
      concatMap(({ files, eventId }) => {
        const batches: File[][] = [];
        for (let i = 0; i < files.length; i += PRESIGN_BATCH_SIZE) {
          batches.push(files.slice(i, i + PRESIGN_BATCH_SIZE));
        }
        return from(batches).pipe(
          concatMap((batch) => of(PhotoUploadActions.presignBatch({ batch, eventId }))),
        );
      }),
    ),
  );

  /**
   * On `Retry File`: re-presign and re-upload the single failed file.
   */
  retryFile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotoUploadActions.retryFile),
      map(({ file, eventId }) => PhotoUploadActions.presignBatch({ batch: [file], eventId })),
    ),
  );

  /**
   * On `Presign Batch`: call POST /events/{eventId}/photos/presign, then
   * dispatch `Presign Batch Success` or `Presign Batch Failure`.
   * The eventId comes from the action payload (set by the component from ActivatedRoute).
   */
  presignBatch$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotoUploadActions.presignBatch),
      concatMap(({ batch, eventId }) => {
        const payload = {
          photos: batch.map((f) => ({
            filename: f.name,
            contentType: f.type,
            size: f.size,
          })),
        };

        return this.http
          .post<PresignResponse>(
            `${this.apiBase}/events/${eventId}/photos/presign`,
            payload,
          )
          .pipe(
            map((res) => {
              const presignedFiles: PresignedFile[] = res.photos.map((p, i) => ({
                file: batch[i],
                photoId: p.photoId,
                presignedUrl: p.presignedUrl,
                contentType: batch[i].type,
              }));
              return PhotoUploadActions.presignBatchSuccess({ presignedFiles });
            }),
            catchError((err: HttpErrorResponse) =>
              of(
                PhotoUploadActions.presignBatchFailure({
                  error:
                    err.status === 403
                      ? 'You do not own this event.'
                      : err.status === 404
                        ? 'Event not found.'
                        : ((err.error as { error?: string })?.error ??
                          'Could not request upload URLs.'),
                }),
              ),
            ),
          );
      }),
    ),
  );

  /**
   * On `Presign Batch Success`: upload each file directly to S3 via XHR
   * (XMLHttpRequest required for `progress` event tracking).
   * concatMap processes one batch's files at a time; mergeMap within each batch
   * caps concurrent PUTs at S3_PUT_CONCURRENCY (AC5: max 5 concurrent uploads).
   */
  uploadToS3$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotoUploadActions.presignBatchSuccess),
      concatMap(({ presignedFiles }) =>
        from(presignedFiles).pipe(
          mergeMap(
            ({ file, presignedUrl, contentType }) =>
              this.uploadViaXHR(presignedUrl, file, contentType).pipe(
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                tap(() => {}),
                map(() => PhotoUploadActions.fileUploadProgress({ uploadedCount: 1 })),
                catchError((err: Error) =>
                  of(
                    PhotoUploadActions.fileUploadFailed({
                      file,
                      errorMessage: err.message ?? 'Upload failed',
                    }),
                  ),
                ),
              ),
            S3_PUT_CONCURRENCY,
          ),
        ),
      ),
    ),
  );

  /** Wrap an S3 PUT in an Observable so XHR progress events can be piped back. */
  private uploadViaXHR(
    presignedUrl: string,
    file: File,
    contentType: string,
  ): Observable<void> {
    return new Observable<void>((subscriber) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', contentType);

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          subscriber.next();
          subscriber.complete();
        } else {
          subscriber.error(new Error(`Upload failed with HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => subscriber.error(new Error('Network error during upload'));
      xhr.ontimeout = () => subscriber.error(new Error('Upload timed out'));

      xhr.send(file);

      // Abort the upload if the Observable is unsubscribed (e.g. component destroyed).
      return () => xhr.abort();
    });
  }
}
