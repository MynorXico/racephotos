import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
  ViewChildren,
  QueryList,
} from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, filter } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule, MatFormField } from '@angular/material/form-field';
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
} from '../../../store/photographer/photographer.selectors';
import { Photographer } from '../../../store/photographer/photographer.state';

export interface CurrencyOption {
  code: string;
  name: string;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'GTQ', name: 'Guatemalan Quetzal' },
  { code: 'BRL', name: 'Brazilian Real' },
] as const;

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
  @ViewChildren(MatFormField) formFields!: QueryList<MatFormField>;

  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly destroy$ = new Subject<void>();

  readonly currencies = SUPPORTED_CURRENCIES;

  readonly form = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(100)]],
    defaultCurrency: ['USD', [Validators.required]],
    bankName: ['', [Validators.maxLength(100)]],
    bankAccountHolder: ['', [Validators.maxLength(100)]],
    bankAccountNumber: ['', [Validators.maxLength(50)]],
    bankInstructions: ['', [Validators.maxLength(500)]],
  });

  readonly loading = toSignal(this.store.select(selectProfileLoading), { initialValue: false });
  readonly saving = toSignal(this.store.select(selectProfileSaving), { initialValue: false });

  /** Local signal — shown when profile was just initialised from a 404. */
  readonly showWelcomeBanner = signal(false);

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

    // Update profile success.
    this.store
      .select(selectProfileSaving)
      .pipe(takeUntil(this.destroy$))
      .subscribe((saving) => {
        if (!saving) {
          // Check if a profile exists — means save completed.
          this.store
            .select(selectProfile)
            .pipe(
              filter((p): p is Photographer => p !== null),
              takeUntil(this.destroy$),
            )
            .subscribe((profile) => {
              if (profile.updatedAt) {
                this.showWelcomeBanner.set(false);
              }
            });
        }
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
    const firstInvalid = this.formFields.find((field) => !!field._control?.ngControl?.invalid);
    if (firstInvalid) {
      const el = (firstInvalid._elementRef.nativeElement as HTMLElement).querySelector(
        'input, select, textarea',
      ) as HTMLElement | null;
      el?.focus();
    }
  }
}
