import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { filter } from 'rxjs/operators';

import { AuthActions } from '../../../store/auth/auth.actions';
import { selectAuthStatus, selectAuthError } from '../../../store/auth/auth.selectors';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroy$ = new Subject<void>();

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  readonly showPassword = signal(false);
  readonly submitting = signal(false);

  ngOnInit(): void {
    // If already authenticated, redirect immediately.
    this.store
      .select(selectAuthStatus)
      .pipe(
        filter((status) => status === 'authenticated'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        const raw = new URLSearchParams(window.location.search).get('returnUrl') ?? '';
        // Only allow same-origin relative paths to prevent open-redirect attacks.
        const url = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/photographer/events';
        void this.router.navigateByUrl(url);
      });

    // Listen for sign-in success to redirect.
    this.store
      .select(selectAuthStatus)
      .pipe(
        filter((status) => status === 'authenticated'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.submitting.set(false);
      });

    // Listen for sign-in failure to show snackbar.
    this.store
      .select(selectAuthError)
      .pipe(
        filter((error): error is string => error !== null),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.submitting.set(false);
        this.snackBar.open(
          'Sign-in failed. Check your email and password and try again.',
          undefined,
          { duration: 6000 },
        );
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.store.dispatch(
      AuthActions.signIn({
        username: this.form.value.email!,
        password: this.form.value.password!,
      }),
    );
  }
}
