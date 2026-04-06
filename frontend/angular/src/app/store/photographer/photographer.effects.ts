import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { PhotographerActions } from './photographer.actions';
import { Photographer, emptyPhotographerDefaults } from './photographer.state';

@Injectable()
export class PhotographerEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /**
   * Loads GET /photographer/me.
   * On 404: dispatches initProfile with empty defaults to auto-initialise the profile (AC4).
   * On other errors: dispatches loadProfileFailure.
   */
  loadProfile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotographerActions.loadProfile),
      switchMap(() =>
        this.http.get<Photographer>(`${this.apiBase}/photographer/me`).pipe(
          map((profile) => PhotographerActions.loadProfileSuccess({ profile })),
          catchError((err: HttpErrorResponse) => {
            if (err.status === 404) {
              return of(PhotographerActions.initProfile({ profile: emptyPhotographerDefaults }));
            }
            return of(
              PhotographerActions.loadProfileFailure({
                error: (err.error as { error?: string })?.error ?? 'Failed to load profile',
              }),
            );
          }),
        ),
      ),
    ),
  );

  /**
   * Sends PUT /photographer/me for both user-initiated saves (updateProfile) and
   * the first-time auto-init (initProfile).
   * On success: dispatches updateProfileSuccess with the returned profile.
   * On failure: includes the server error message for AC9 (invalid currency → 400).
   */
  updateProfile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PhotographerActions.updateProfile, PhotographerActions.initProfile),
      switchMap(({ profile }) =>
        this.http.put<Photographer>(`${this.apiBase}/photographer/me`, profile).pipe(
          map((updated) => PhotographerActions.updateProfileSuccess({ profile: updated })),
          catchError((err: HttpErrorResponse) =>
            of(
              PhotographerActions.updateProfileFailure({
                error: (err.error as { error?: string })?.error ?? 'Failed to save profile',
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
