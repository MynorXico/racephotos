import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { catchError, map, switchMap, takeUntil, withLatestFrom } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { Photo, PhotosActions } from './photos.actions';
import { selectActiveFilter } from './photos.selectors';

interface ListPhotosResponse {
  photos: Photo[];
  nextCursor: string | null;
}

@Injectable()
export class PhotosEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** GET /events/{id}/photos — loads the first page of photos for an event. */
  loadPhotos$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotosActions.loadPhotos),
      withLatestFrom(this.store.select(selectActiveFilter)),
      switchMap(([{ eventId }, filter]) => {
        const params = new URLSearchParams();
        if (filter) params.set('status', filter);
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.http
          .get<ListPhotosResponse>(`${this.apiBase}/events/${eventId}/photos${query}`)
          .pipe(
            map((res) =>
              PhotosActions.loadPhotosSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor ?? null,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                PhotosActions.loadPhotosFailure({
                  error:
                    err.status === 403
                      ? 'forbidden'
                      : err.status === 404
                        ? 'not_found'
                        : ((err.error as { error?: string })?.error ?? 'Failed to load photos'),
                }),
              ),
            ),
          );
      }),
    ),
  );

  /** Load next page using the cursor, then append results to state. */
  loadNextPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotosActions.loadNextPage),
      withLatestFrom(this.store.select(selectActiveFilter)),
      switchMap(([{ eventId, cursor }, filter]) => {
        const params = new URLSearchParams({ cursor });
        if (filter) params.set('status', filter);
        return this.http
          .get<ListPhotosResponse>(
            `${this.apiBase}/events/${eventId}/photos?${params.toString()}`,
          )
          .pipe(
            // Cancel this in-flight request if the user changes the filter or
            // triggers a full reload. Without this, a stale loadNextPage response
            // arriving after the reducer has reset photos:[] would append wrong-filter
            // items to the fresh list (silent data corruption).
            takeUntil(
              this.actions$.pipe(
                ofType(PhotosActions.loadPhotos, PhotosActions.filterByStatus),
              ),
            ),
            map((res) =>
              PhotosActions.loadNextPageSuccess({
                photos: res.photos,
                nextCursor: res.nextCursor ?? null,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                PhotosActions.loadNextPageFailure({
                  error:
                    (err.error as { error?: string })?.error ?? 'Failed to load more photos',
                }),
              ),
            ),
          );
      }),
    ),
  );

  /**
   * Filter By Status — reducer already reset photos/cursor/activeFilter.
   * This effect re-dispatches Load Photos so the component only needs to dispatch
   * Filter By Status when a chip is selected.
   */
  filterByStatus$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotosActions.filterByStatus),
      map(({ eventId }) => PhotosActions.loadPhotos({ eventId })),
    ),
  );
}
