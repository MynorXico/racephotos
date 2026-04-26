import {
  APP_INITIALIZER,
  ApplicationConfig,
  isDevMode,
  LOCALE_ID,
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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { importProvidersFrom } from '@angular/core';

import { routes } from './app.routes';
import { AppConfigService } from './core/config/app-config.service';
import { authInterceptor } from './core/auth/auth.interceptor';
import { LocaleService } from './core/services/locale.service';
import { authReducer } from './store/auth/auth.reducer';
import { AuthEffects } from './store/auth/auth.effects';
import { photographerReducer } from './store/photographer/photographer.reducer';
import { PhotographerEffects } from './store/photographer/photographer.effects';
import { eventsReducer } from './store/events/events.reducer';
import { EventsEffects } from './store/events/events.effects';
import { purchasesFeature } from './store/purchases/purchases.reducer';
import { PurchasesEffects } from './store/purchases/purchases.effects';
import { reviewQueueFeature } from './store/review-queue/review-queue.reducer';
import { ReviewQueueEffects } from './store/review-queue/review-queue.effects';

/**
 * Loads /assets/config.json and configures AWS Amplify before the app renders.
 * Also initialises the i18n locale via TranslateService so both @ngx-translate
 * strings and Angular's built-in pipes use the correct locale from first render.
 * Called once via APP_INITIALIZER — no environment.ts involved (ADR-0007).
 */
function initializeApp(
  configService: AppConfigService,
  translate: TranslateService,
  localeService: LocaleService,
): () => Promise<void> {
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

    const locale = localeService.getCurrentLocale();
    translate.setDefaultLang('en');
    await translate.use(locale).toPromise();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),

    // i18n — TranslateModule loaded at runtime from /assets/i18n/{locale}.json
    importProvidersFrom(TranslateModule.forRoot({ defaultLanguage: 'en' })),
    provideTranslateHttpLoader({ prefix: '/assets/i18n/', suffix: '.json' }),

    // LOCALE_ID — resolved from localStorage / browser language before first render
    {
      provide: LOCALE_ID,
      useFactory: (localeService: LocaleService) => localeService.getCurrentLocale(),
      deps: [LocaleService],
    },

    // Bootstrap: load runtime config + configure Amplify + load translations before first render
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AppConfigService, TranslateService, LocaleService],
      multi: true,
    },

    // NgRx root store
    provideStore({
      auth: authReducer,
      photographer: photographerReducer,
      events: eventsReducer,
      [purchasesFeature.name]: purchasesFeature.reducer,
      [reviewQueueFeature.name]: reviewQueueFeature.reducer,
    }),
    provideEffects(AuthEffects, PhotographerEffects, EventsEffects, PurchasesEffects, ReviewQueueEffects),
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
};
