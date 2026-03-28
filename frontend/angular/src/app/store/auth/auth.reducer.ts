import { createReducer, on } from '@ngrx/store';
import { AuthActions } from './auth.actions';
import { AuthState, initialAuthState } from './auth.state';

export const authReducer = createReducer<AuthState>(
  initialAuthState,

  on(AuthActions.signInSuccess, AuthActions.sessionLoaded, (state, { email }) => ({
    ...state,
    status: 'authenticated' as const,
    email,
    error: null,
  })),

  on(AuthActions.signInFailure, (state, { error }) => ({
    ...state,
    status: 'unauthenticated' as const,
    error,
  })),

  on(AuthActions.signOutSuccess, AuthActions.sessionEmpty, () => ({
    ...initialAuthState,
    status: 'unauthenticated' as const,
  })),
);
