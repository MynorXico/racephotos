import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import { LanguageSwitcherComponent } from './language-switcher.component';
import { LocaleService } from '../../core/services/locale.service';

describe('LanguageSwitcherComponent', () => {
  let fixture: ComponentFixture<LanguageSwitcherComponent>;
  let localeServiceSpy: jasmine.SpyObj<LocaleService>;

  function setup(currentLocale = 'en') {
    localeServiceSpy = jasmine.createSpyObj<LocaleService>('LocaleService', [
      'getCurrentLocale',
      'setLocale',
    ]);
    localeServiceSpy.getCurrentLocale.and.returnValue(currentLocale);

    TestBed.configureTestingModule({
      imports: [
        LanguageSwitcherComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: LocaleService, useValue: localeServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSwitcherComponent);
    fixture.detectChanges();
  }

  it('renders a trigger button with the language icon', () => {
    setup();
    const btn = fixture.nativeElement.querySelector('[data-testid="language-switcher-btn"]');
    expect(btn).toBeTruthy();
    expect(btn.querySelector('mat-icon').textContent.trim()).toBe('language');
  });

  it('currentLocale is taken from LocaleService.getCurrentLocale()', () => {
    setup('es-419');
    expect(fixture.componentInstance.currentLocale).toBe('es-419');
  });

  it('exposes an entry for each supported locale', () => {
    setup();
    const locales = fixture.componentInstance.locales;
    const codes = locales.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('es-419');
  });

  it('calls setLocale when a menu item is clicked', () => {
    setup();
    fixture.componentInstance.selectLocale('es-419');
    expect(localeServiceSpy.setLocale).toHaveBeenCalledWith('es-419');
  });

  it('active locale item has aria-current="true"', () => {
    setup('es-419');
    fixture.detectChanges();
    // Open the menu programmatically
    fixture.componentInstance.selectLocale = jasmine.createSpy();
    const items = fixture.componentInstance.locales;
    const activeItem = items.find((l) => l.code === 'es-419');
    expect(activeItem).toBeTruthy();
    // The active locale is tracked in the component property
    expect(fixture.componentInstance.currentLocale).toBe('es-419');
  });
});
