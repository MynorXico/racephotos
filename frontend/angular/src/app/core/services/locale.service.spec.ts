import { TestBed } from '@angular/core/testing';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  let service: LocaleService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(LocaleService);
  });

  afterEach(() => localStorage.clear());

  describe('getCurrentLocale', () => {
    it('returns stored locale when valid', () => {
      localStorage.setItem('racephotos_locale', 'es-419');
      expect(service.getCurrentLocale()).toBe('es-419');
    });

    it('ignores stored locale when unsupported (e.g. de)', () => {
      localStorage.setItem('racephotos_locale', 'de');
      spyOnProperty(navigator, 'language', 'get').and.returnValue('en');
      expect(service.getCurrentLocale()).toBe('en');
    });

    it('returns en for unsupported browser locale (de)', () => {
      spyOnProperty(navigator, 'language', 'get').and.returnValue('de');
      expect(service.getCurrentLocale()).toBe('en');
    });

    it('matches es-MX to es-419 via prefix', () => {
      spyOnProperty(navigator, 'language', 'get').and.returnValue('es-MX');
      expect(service.getCurrentLocale()).toBe('es-419');
    });

    it('matches en-US to en via prefix', () => {
      spyOnProperty(navigator, 'language', 'get').and.returnValue('en-US');
      expect(service.getCurrentLocale()).toBe('en');
    });

    it('returns en as ultimate fallback', () => {
      spyOnProperty(navigator, 'language', 'get').and.returnValue('');
      expect(service.getCurrentLocale()).toBe('en');
    });
  });

  describe('setLocale', () => {
    let reloadSpy: jasmine.Spy;

    beforeEach(() => {
      // Spy on the protected reloadPage() method instead of window.location.reload,
      // which is not configurable in ChromeHeadless.
      reloadSpy = spyOn(service as unknown as { reloadPage: () => void }, 'reloadPage');
    });

    it('writes to localStorage for a supported locale', () => {
      service.setLocale('es-419');
      expect(localStorage.getItem('racephotos_locale')).toBe('es-419');
    });

    it('calls reloadPage() after writing', () => {
      service.setLocale('en');
      expect(reloadSpy).toHaveBeenCalled();
    });

    it('does nothing for an unsupported locale', () => {
      service.setLocale('fr');
      expect(localStorage.getItem('racephotos_locale')).toBeNull();
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });

  describe('SUPPORTED_LOCALES', () => {
    it('contains en and es-419', () => {
      expect(LocaleService.SUPPORTED_LOCALES.has('en')).toBeTrue();
      expect(LocaleService.SUPPORTED_LOCALES.has('es-419')).toBeTrue();
    });
  });
});
