import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { AuthActions } from './auth.actions';

@Injectable()
export class AuthEffects {
  private readonly actions$ = inject(Actions);
  private readonly router = inject(Router);

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

  signIn$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AuthActions.signIn),
      switchMap(({ username, password }) =>
        from(signIn({ username, password })).pipe(
          map(() => AuthActions.signInSuccess({ email: username })),
          catchError((err: Error) =>
            of(AuthActions.signInFailure({ error: err.message ?? 'Sign-in failed' })),
          ),
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

  /** Navigate to /login after sign-out completes. */
  signOutNavigate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AuthActions.signOutSuccess),
        tap(() => void this.router.navigate(['/login'])),
      ),
    { dispatch: false },
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
