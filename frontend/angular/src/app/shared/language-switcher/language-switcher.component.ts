import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

import { LocaleService } from '../../core/services/locale.service';

interface LocaleEntry {
  code: string;
  label: string;
}

@Component({
  selector: 'app-language-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslateModule],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss',
})
export class LanguageSwitcherComponent {
  private readonly localeService = inject(LocaleService);

  readonly currentLocale = this.localeService.getCurrentLocale();

  readonly locales: LocaleEntry[] = Array.from(
    LocaleService.SUPPORTED_LOCALES.entries(),
  ).map(([code, label]) => ({ code, label }));

  selectLocale(code: string): void {
    this.localeService.setLocale(code);
  }
}
