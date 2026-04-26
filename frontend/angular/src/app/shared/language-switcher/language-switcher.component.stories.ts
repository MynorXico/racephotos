import type { Meta, StoryObj } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { of } from 'rxjs';

import { LanguageSwitcherComponent } from './language-switcher.component';
import { LocaleService } from '../../core/services/locale.service';
import en from '../../../assets/i18n/en.json';
import es419 from '../../../assets/i18n/es-419.json';

function staticLoader(translations: Record<string, unknown>) {
  return { getTranslation: () => of(translations) };
}

function makeLocaleService(locale: string): Partial<LocaleService> {
  return {
    getCurrentLocale: () => locale,
    setLocale: (code: string) => {
      // In Storybook: record action without reloading
      console.log('[Storybook] setLocale called with:', code);
    },
  };
}

const meta: Meta<LanguageSwitcherComponent> = {
  title: 'Shared/LanguageSwitcher',
  component: LanguageSwitcherComponent,
};

export default meta;
type Story = StoryObj<LanguageSwitcherComponent>;

export const EnglishActive: Story = {
  render: (args) => ({
    props: args,
    moduleMetadata: {
      imports: [
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useValue: staticLoader(en) },
        }),
      ],
      providers: [
        provideAnimationsAsync(),
        { provide: LocaleService, useValue: makeLocaleService('en') },
      ],
    },
  }),
};

export const SpanishActive: Story = {
  render: (args) => ({
    props: args,
    moduleMetadata: {
      imports: [
        TranslateModule.forRoot({
          defaultLanguage: 'es-419',
          loader: { provide: TranslateLoader, useValue: staticLoader(es419) },
        }),
      ],
      providers: [
        provideAnimationsAsync(),
        { provide: LocaleService, useValue: makeLocaleService('es-419') },
      ],
    },
  }),
};
