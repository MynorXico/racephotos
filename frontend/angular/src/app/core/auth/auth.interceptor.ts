import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { AppConfigService } from '../config/app-config.service';

/**
 * authInterceptor — attaches a Cognito JWT to all requests directed at apiBaseUrl (AC10).
 *
 * Only requests whose URL starts with apiBaseUrl are intercepted. All other
 * requests (e.g. /assets/config.json) pass through without modification.
 *
 * Calls fetchAuthSession() (Amplify v6) to obtain the current idToken.
 * Amplify handles token refresh automatically — no manual interval required.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const configService = inject(AppConfigService);
  const apiBase = configService.get()?.apiBaseUrl;

  if (!apiBase || !req.url.startsWith(apiBase)) {
    return next(req);
  }

  return from(fetchAuthSession()).pipe(
    switchMap((session) => {
      const token = session.tokens?.idToken?.toString();
      if (!token) return next(req);
      return next(req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) }));
    }),
  );
};
