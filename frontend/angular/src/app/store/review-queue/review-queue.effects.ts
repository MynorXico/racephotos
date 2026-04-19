import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, mergeMap, switchMap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { Photo, PhotosActions } from '../photos/photos.actions';
import { ReviewPhoto, ReviewQueueActions } from './review-queue.actions';

interface ListPhotosResponse {
  photos: ReviewPhoto[];
  nextCursor: string | null;
}

interface SaveBibsResponse {
  id: string;
  status: 'review_required' | 'error';
  bibNumbers: string[];
  thumbnailUrl: string | null;
  uploadedAt: string;
  errorReason: string | null;
}

@Injectable()
export class ReviewQueueEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  loadReviewQueue$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewQueueActions.loadReviewQueue),
      switchMap(({ eventId }) =>
        this.http
          .get<ListPhotosResponse>(
            `${this.apiBase}/events/${eventId}/photos?status=review_required,error`,
          )
          .pipe(
            map((res) =>
              ReviewQueueActions.loadReviewQueueSuccess({ photos: res.photos }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                ReviewQueueActions.loadReviewQueueFailure({
                  error:
                    (err.error as { error?: string })?.error ??
                    'Failed to load review queue',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  savePhotoBibs$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewQueueActions.savePhotoBibs),
      mergeMap(({ photoId, bibNumbers }) =>
        this.http
          .put<SaveBibsResponse>(`${this.apiBase}/photos/${photoId}/bibs`, { bibNumbers })
          .pipe(
            map((res) => {
              const updatedPhoto: ReviewPhoto = {
                id: res.id,
                status: res.status,
                bibNumbers: res.bibNumbers,
                thumbnailUrl: res.thumbnailUrl,
                uploadedAt: res.uploadedAt,
                errorReason: res.errorReason,
              };
              return ReviewQueueActions.savePhotoBibsSuccess({ photoId, updatedPhoto });
            }),
            catchError((err: HttpErrorResponse) =>
              of(
                ReviewQueueActions.savePhotoBibsFailure({
                  photoId,
                  error:
                    (err.error as { error?: string })?.error ??
                    'Failed to save bib numbers',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  savePhotoBibsSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewQueueActions.savePhotoBibsSuccess),
      map(({ updatedPhoto }) => {
        const photo: Photo = {
          id: updatedPhoto.id,
          status: updatedPhoto.status,
          thumbnailUrl: updatedPhoto.thumbnailUrl,
          bibNumbers: updatedPhoto.bibNumbers,
          uploadedAt: updatedPhoto.uploadedAt,
          errorReason: updatedPhoto.errorReason,
        };
        return PhotosActions.upsertPhoto({ photo });
      }),
    ),
  );
}
