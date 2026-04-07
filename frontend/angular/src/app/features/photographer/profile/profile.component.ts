import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  AbstractControl,
  ReactiveFormsModule,
  FormBuilder,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, filter } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { PhotographerActions } from '../../../store/photographer/photographer.actions';
import {
  selectProfile,
  selectProfileLoading,
  selectProfileSaving,
  selectProfileError,
  selectProfileSaveError,
  selectWasAutoInitialized,
} from '../../../store/photographer/photographer.selectors';
import { Photographer } from '../../../store/photographer/photographer.state';
import {
  SUPPORTED_CURRENCIES,
  CurrencyOption,
} from '../shared/currencies.constants';

export type { CurrencyOption };

/** Rejects strings that are non-empty but contain only whitespace. */
function noWhitespaceOnly(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() === ''
    ? { whitespace: true }
    : null;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDividerModule,
    MatIconModule,
    CdkTextareaAutosize,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroy$ = new Subject<void>();

  readonly currencies = SUPPORTED_CURRENCIES;

  readonly form = this.fb.group({
    displayName: ['', [Validators.required, noWhitespaceOnly, Validators.maxLength(100)]],
    defaultCurrency: ['USD', [Validators.required]],
    bankName: ['', [Validators.maxLength(100)]],
    bankAccountHolder: ['', [Validators.maxLength(100)]],
    bankAccountNumber: ['', [Validators.maxLength(50)]],
    bankInstructions: ['', [Validators.maxLength(500)]],
  });

  readonly loading = toSignal(this.store.select(selectProfileLoading), { initialValue: false });
  readonly saving = toSignal(this.store.select(selectProfileSaving), { initialValue: false });
  /** True after a 404 auto-init; cleared when the user manually saves. */
  readonly showWelcomeBanner = toSignal(this.store.select(selectWasAutoInitialized), {
    initialValue: false,
  });

  /** Last saved values — used by Cancel to reset the form. */
  private lastSavedValues = this.form.getRawValue();

  ngOnInit(): void {
    this.titleService.setTitle('Profile');
    this.store.dispatch(PhotographerActions.loadProfile());

    // Patch form when profile loads.
    this.store
      .select(selectProfile)
      .pipe(
        filter((profile): profile is Photographer => profile !== null),
        takeUntil(this.destroy$),
      )
      .subscribe((profile) => {
        const patch = {
          displayName: profile.displayName,
          defaultCurrency: profile.defaultCurrency,
          bankName: profile.bankName,
          bankAccountHolder: profile.bankAccountHolder,
          bankAccountNumber: profile.bankAccountNumber,
          bankInstructions: profile.bankInstructions,
        };
        this.form.patchValue(patch);
        this.lastSavedValues = this.form.getRawValue();
      });

    // Load failure — show snackbar with retry.
    this.store
      .select(selectProfileError)
      .pipe(
        filter((error): error is string => error !== null),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        const ref = this.snackBar.open(
          'Could not load your profile. Please refresh the page.',
          'Retry',
          { duration: 8000 },
        );
        ref.onAction().subscribe(() => {
          this.store.dispatch(PhotographerActions.loadProfile());
        });
      });

    // Save failure — show snackbar; user can correct the form and retry manually.
    this.store
      .select(selectProfileSaveError)
      .pipe(
        filter((error): error is string => error !== null),
        takeUntil(this.destroy$),
      )
      .subscribe((error) => {
        this.snackBar.open(error, 'Dismiss', { duration: 8000 });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }
    const value = this.form.getRawValue();
    this.store.dispatch(
      PhotographerActions.updateProfile({
        profile: {
          displayName: value.displayName ?? '',
          defaultCurrency: value.defaultCurrency ?? 'USD',
          bankName: value.bankName ?? '',
          bankAccountHolder: value.bankAccountHolder ?? '',
          bankAccountNumber: value.bankAccountNumber ?? '',
          bankInstructions: value.bankInstructions ?? '',
        },
      }),
    );
  }

  onCancel(): void {
    this.form.reset(this.lastSavedValues);
    void this.router.navigate(['/photographer/events']);
  }

  private focusFirstInvalidField(): void {
    // Angular Forms applies .ng-invalid to the control element itself — a stable
    // public-API class that works for both <input> and <mat-select>.
    const el = this.elementRef.nativeElement.querySelector(
      'input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid',
    ) as HTMLElement | null;
    el?.focus();
  }
}
