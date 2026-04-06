import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AuthActions } from './store/auth/auth.actions';
import { selectAuthStatus } from './store/auth/auth.selectors';

/**
 * AppComponent — root shell.
 *
 * Responsibilities:
 *   1. Dispatches AuthActions.loadSession() once on init to restore the
 *      Cognito session from Amplify's storage.
 *   2. Shows a full-page spinner overlay while auth status is 'unknown'
 *      (UX spec UX-D1) — prevents a flash of protected content before the
 *      auth guard resolves.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MatProgressSpinnerModule],
  template: `
    <a class="sr-only" href="#main-content">Skip to main content</a>

    @if (authStatus() === 'unknown') {
      <div class="auth-loading-overlay" aria-label="Loading, please wait" role="status">
        <mat-progress-spinner mode="indeterminate" diameter="48" />
      </div>
    }

    <router-outlet />
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .auth-loading-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--mat-sys-surface);
        z-index: 9999;
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly store = inject(Store);

  readonly authStatus = toSignal(this.store.select(selectAuthStatus), {
    initialValue: 'unknown' as const,
  });

  ngOnInit(): void {
    this.store.dispatch(AuthActions.loadSession());
  }
}
