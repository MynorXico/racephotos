import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AuthState } from './auth.state';

export const selectAuthState = createFeatureSelector<AuthState>('auth');

export const selectAuthStatus = createSelector(selectAuthState, (s) => s.status);
export const selectAuthEmail = createSelector(selectAuthState, (s) => s.email);
export const selectIsAuthenticated = createSelector(
  selectAuthState,
  (s) => s.status === 'authenticated',
);
export const selectAuthError = createSelector(selectAuthState, (s) => s.error);
