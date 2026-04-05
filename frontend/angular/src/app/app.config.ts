import {
  APP_INITIALIZER,
  ApplicationConfig,
  isDevMode,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideRouterStore } from '@ngrx/router-store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { Amplify } from 'aws-amplify';

import { routes } from './app.routes';
import { AppConfigService } from './core/config/app-config.service';
import { authInterceptor } from './core/auth/auth.interceptor';
import { authReducer } from './store/auth/auth.reducer';
import { AuthEffects } from './store/auth/auth.effects';
import { photographerReducer } from './store/photographer/photographer.reducer';
import { PhotographerEffects } from './store/photographer/photographer.effects';

/**
 * Loads /assets/config.json and configures AWS Amplify before the app renders.
 * Called once via APP_INITIALIZER — no environment.ts involved (ADR-0007).
 */
function initializeApp(configService: AppConfigService): () => Promise<void> {
  return async () => {
    await configService.load();
    const cfg = configService.get();

    // Custom Angular login page — Amplify's signIn() is called directly.
    // The Cognito hosted UI / OAuth redirect flow is not used (ADR-0007).
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: cfg.cognitoUserPoolId,
          userPoolClientId: cfg.cognitoClientId,
        },
      },
    });
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),

    // Bootstrap: load runtime config + configure Amplify before first render
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AppConfigService],
      multi: true,
    },

    // NgRx root store
    provideStore({ auth: authReducer, photographer: photographerReducer }),
    provideEffects(AuthEffects, PhotographerEffects),
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
};
