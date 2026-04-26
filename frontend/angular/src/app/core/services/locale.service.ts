import { Injectable } from '@angular/core';

const STORAGE_KEY = 'racephotos_locale';

@Injectable({ providedIn: 'root' })
export class LocaleService {
  /** Registry of supported locale codes. Add a code here to support a new language. */
  static readonly SUPPORTED_LOCALES: ReadonlyMap<string, string> = new Map([
    ['en', 'English'],
    ['es-419', 'Español (Latino)'],
  ]);

  /** Returns the active locale code for this session. */
  getCurrentLocale(): string {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LocaleService.SUPPORTED_LOCALES.has(stored)) {
      return stored;
    }
    return this.detectBrowserLocale();
  }

  /**
   * Persists the chosen locale and triggers a full page reload so Angular
   * re-bootstraps with the correct LOCALE_ID and translation file.
   * LOCALE_ID must not be mutated mid-session.
   */
  setLocale(code: string): void {
    if (!LocaleService.SUPPORTED_LOCALES.has(code)) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, code);
    this.reloadPage();
  }

  /** Separated for testability — Karma/ChromeHeadless cannot spy on window.location.reload. */
  protected reloadPage(): void {
    window.location.reload();
  }

  private detectBrowserLocale(): string {
    const lang = navigator.language ?? 'en';
    // Exact match first (handles 'en', 'es-419', etc.)
    if (LocaleService.SUPPORTED_LOCALES.has(lang)) {
      return lang;
    }
    // Prefix match: 'es-MX' → 'es-419', 'en-US' → 'en'
    for (const code of LocaleService.SUPPORTED_LOCALES.keys()) {
      const prefix = code.split('-')[0];
      if (lang.startsWith(prefix)) {
        return code;
      }
    }
    return 'en';
  }
}
