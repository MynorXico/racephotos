import { Component, inject, signal, ChangeDetectionStrategy, ViewChild } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs/operators';

import { AuthActions } from '../../../store/auth/auth.actions';
import { selectAuthEmail, selectAuthStatus } from '../../../store/auth/auth.selectors';
import { NavigationTitleService } from '../../../core/services/navigation-title.service';

@Component({
  selector: 'app-photographer-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
  ],
  templateUrl: './photographer-layout.component.html',
  styleUrl: './photographer-layout.component.scss',
})
export class PhotographerLayoutComponent {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  private readonly store = inject(Store);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly titleService = inject(NavigationTitleService);

  readonly authStatus = toSignal(this.store.select(selectAuthStatus), {
    initialValue: 'unknown' as const,
  });
  readonly email = toSignal(this.store.select(selectAuthEmail), { initialValue: null });
  readonly pageTitle = toSignal(this.titleService.title$, { initialValue: '' });

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  readonly signingOut = signal(false);

  signOut(): void {
    this.signingOut.set(true);
    this.store.dispatch(AuthActions.signOut());
  }

  closeSidenavOnMobile(): void {
    if (this.isMobile() && this.sidenav) {
      void this.sidenav.close();
    }
  }
}
