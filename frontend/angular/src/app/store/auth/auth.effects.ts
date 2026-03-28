import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AuthActions } from './auth.actions';

@Injectable()
export class AuthEffects {
  private readonly actions$ = inject(Actions);

  loadSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.loadSession),
      switchMap(() =>
        from(getCurrentUser()).pipe(
          map((user) => AuthActions.sessionLoaded({ email: user.signInDetails?.loginId ?? '' })),
          catchError(() => of(AuthActions.sessionEmpty())),
        ),
      ),
    ),
  );

  signOut$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.signOut),
      switchMap(() =>
        from(signOut()).pipe(
          map(() => AuthActions.signOutSuccess()),
          catchError(() => of(AuthActions.signOutSuccess())),
        ),
      ),
    ),
  );

  /** Ensure a valid token exists — called before API requests via AuthInterceptor. */
  refreshSession$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.signInSuccess, AuthActions.sessionLoaded),
        switchMap(() => from(fetchAuthSession({ forceRefresh: false }))),
      ),
    { dispatch: false },
  );
}
