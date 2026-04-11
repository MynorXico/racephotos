import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { RunnerPhoto, RunnerPhotosActions } from './runner-photos.actions';

interface SearchResponse {
  photos: RunnerPhoto[];
  eventName: string;
  pricePerPhoto: number;
  currency: string;
}

@Injectable()
export class RunnerPhotosEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** GET /events/{id}/photos/search?bib={bibNumber} */
  searchByBib$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RunnerPhotosActions.searchByBib),
      switchMap(({ eventId, bibNumber }) =>
        this.http
          .get<SearchResponse>(
            `${this.apiBase}/events/${eventId}/photos/search?bib=${encodeURIComponent(bibNumber)}`,
          )
          .pipe(
            map((res) => RunnerPhotosActions.searchByBibSuccess({ photos: res.photos })),
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
}
