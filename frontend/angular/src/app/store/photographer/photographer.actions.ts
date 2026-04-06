import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Photographer } from './photographer.state';

export const PhotographerActions = createActionGroup({
  source: 'Photographer',
  events: {
    'Load Profile': emptyProps(),
    'Load Profile Success': props<{ profile: Photographer }>(),
    'Load Profile Failure': props<{ error: string }>(),
    /** Dispatched instead of updateProfile when GET returns 404 to auto-initialise the profile. */
    'Init Profile': props<{ profile: Partial<Photographer> }>(),
    'Update Profile': props<{ profile: Partial<Photographer> }>(),
    'Update Profile Success': props<{ profile: Photographer }>(),
    'Update Profile Failure': props<{ error: string }>(),
  },
});
