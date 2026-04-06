import { createActionGroup, emptyProps, props } from '@ngrx/store';

export const AuthActions = createActionGroup({
  source: 'Auth',
  events: {
    'Sign In': props<{ username: string; password: string }>(),
    'Sign In Success': props<{ email: string }>(),
    'Sign In Failure': props<{ error: string }>(),
    'Sign Out': emptyProps(),
    'Sign Out Success': emptyProps(),
    'Load Session': emptyProps(),
    'Session Loaded': props<{ email: string }>(),
    'Session Empty': emptyProps(),
  },
});
