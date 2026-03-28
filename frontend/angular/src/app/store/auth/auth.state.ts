export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  email: string | null;
  error: string | null;
}

export const initialAuthState: AuthState = {
  status: 'unknown',
  email: null,
  error: null,
};
