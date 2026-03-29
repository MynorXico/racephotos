import {
  APP_INITIALIZER,
  ApplicationConfig,
  isDevMode,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideRouterStore } from '@ngrx/router-store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { Amplify } from 'aws-amplify';

import { routes } from './app.routes';
import { AppConfigService } from './core/config/app-config.service';
import { authReducer } from './store/auth/auth.reducer';
import { AuthEffects } from './store/auth/auth.effects';

/**
 * Loads /assets/config.json and configures AWS Amplify before the app renders.
 * Called once via APP_INITIALIZER — no environment.ts involved.
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

    // Bootstrap: load runtime config + configure Amplify before first render
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AppConfigService],
      multi: true,
    },

    // NgRx root store
    provideStore({ auth: authReducer }),
    provideEffects(AuthEffects),
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
};
