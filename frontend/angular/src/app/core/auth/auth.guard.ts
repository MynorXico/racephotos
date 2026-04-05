import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { filter, map, take } from 'rxjs/operators';

import { selectAuthStatus } from '../../store/auth/auth.selectors';

/**
 * authGuard — protects all /photographer/* routes (AC1).
 *
 * Behaviour by auth status:
 *   unknown        → waits (Observable does not emit) until status resolves
 *   authenticated  → allows navigation
 *   unauthenticated → redirects to /login?returnUrl=<attempted path>
 *
 * The full-page spinner while status is 'unknown' is rendered by AppComponent,
 * not by this guard (UX spec UX-D1).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(Store);
  const router = inject(Router);

  return store.select(selectAuthStatus).pipe(
    filter((status) => status !== 'unknown'),
    take(1),
    map((status) => {
      if (status === 'authenticated') return true;

      // Prevent redirect loops: never include /login as the returnUrl.
      const returnUrl = state.url.startsWith('/login') ? '/photographer/events' : state.url;

      return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
    }),
  );
};
