import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { RunnerPhoto, RunnerPhotosActions } from './runner-photos.actions';

interface SearchResponse {
  photos: RunnerPhoto[];
  nextCursor: string | null;
  totalCount: number;
  eventName: string;
  pricePerPhoto: number;
  currency: string;
}

interface PublicPhotosResponse {
  photos: RunnerPhoto[];
  nextCursor: string | null;
  totalCount: number;
  eventName: string;
  pricePerPhoto: number;
  currency: string;
}

@Injectable()
export class RunnerPhotosEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);
  private readonly snackBar = inject(MatSnackBar);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** GET /events/{id}/public-photos — first page load or after bib clear. */
  loadEventPhotos$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RunnerPhotosActions.loadEventPhotos),
      switchMap(({ eventId }) =>
        this.http
          .get<PublicPhotosResponse>(`${this.apiBase}/events/${eventId}/public-photos?limit=24`)
          .pipe(
            map((res) =>
              RunnerPhotosActions.loadEventPhotosSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor,
                totalCount: res.totalCount,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                RunnerPhotosActions.loadEventPhotosFailure({
                  error:
                    err.status === 404
                      ? 'event_not_found'
                      : ((err.error as { error?: string })?.error ?? 'Failed to load photos'),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /** GET /events/{id}/public-photos?cursor=... — "Load more" in all-event mode. */
  loadMoreEventPhotos$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RunnerPhotosActions.loadMoreEventPhotos),
      switchMap(({ eventId, cursor }) =>
        this.http
          .get<PublicPhotosResponse>(
            `${this.apiBase}/events/${eventId}/public-photos?limit=24&cursor=${encodeURIComponent(cursor)}`,
          )
          .pipe(
            map((res) =>
              RunnerPhotosActions.loadMoreEventPhotosSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor,
              }),
            ),
            catchError(() =>
              of(RunnerPhotosActions.loadMoreEventPhotosFailure({ error: 'Failed to load more photos' })),
            ),
          ),
      ),
    ),
  );

  /** Show snackbar when load-more fails — non-fatal (photos already loaded stay visible). */
  loadMoreEventPhotosFailure$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(RunnerPhotosActions.loadMoreEventPhotosFailure, RunnerPhotosActions.loadMoreBibPhotosFailure),
        tap(() => {
          this.snackBar.open('Failed to load more photos. Please try again.', 'Dismiss', {
            duration: 5000,
          });
        }),
      ),
    { dispatch: false },
  );

  /** GET /events/{id}/photos/search?bib=... — initial bib search. */
  searchByBib$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RunnerPhotosActions.searchByBib),
      switchMap(({ eventId, bibNumber }) =>
        this.http
          .get<SearchResponse>(
            `${this.apiBase}/events/${eventId}/photos/search?bib=${encodeURIComponent(bibNumber)}`,
          )
          .pipe(
            map((res) =>
              RunnerPhotosActions.searchByBibSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor,
                totalCount: res.totalCount,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                RunnerPhotosActions.searchByBibFailure({
                  error:
                    err.status === 404
                      ? 'event_not_found'
                      : ((err.error as { error?: string })?.error ?? 'Failed to search photos'),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /** GET /events/{id}/photos/search?bib=...&cursor=... — "Load more" in bib mode. */
  loadMoreBibPhotos$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RunnerPhotosActions.loadMoreBibPhotos),
      switchMap(({ eventId, bibNumber, cursor }) =>
        this.http
          .get<SearchResponse>(
            `${this.apiBase}/events/${eventId}/photos/search?bib=${encodeURIComponent(bibNumber)}&cursor=${encodeURIComponent(cursor)}`,
          )
          .pipe(
            map((res) =>
              RunnerPhotosActions.loadMoreBibPhotosSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor,
              }),
            ),
            catchError(() =>
              of(RunnerPhotosActions.loadMoreBibPhotosFailure({ error: 'Failed to load more photos' })),
            ),
          ),
      ),
    ),
  );
}
