import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, filter, distinctUntilChanged } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { NavigationTitleService } from '../../../../core/services/navigation-title.service';
import { EventsActions } from '../../../../store/events/events.actions';
import { selectEventsLoading, selectEventsError } from '../../../../store/events/events.selectors';
import {
  selectProfile,
  selectProfileLoading,
} from '../../../../store/photographer/photographer.selectors';
import { SUPPORTED_CURRENCIES } from '../../shared/currencies.constants';
import { dateToIsoString } from '../date-utils';

@Component({
  selector: 'app-event-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './event-create.component.html',
  styleUrl: './event-create.component.scss',
})
export class EventCreateComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroy$ = new Subject<void>();

  readonly currencies = SUPPORTED_CURRENCIES;
  readonly loading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
  readonly profileLoading = toSignal(this.store.select(selectProfileLoading), {
    initialValue: false,
  });

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    date: [null as Date | null, [Validators.required]],
    location: ['', [Validators.required, Validators.maxLength(200)]],
    pricePerPhoto: [
      null as number | null,
      [Validators.required, Validators.min(0), Validators.pattern('^[0-9]+(\\.[0-9]{1,2})?$')],
    ],
    currency: ['USD', [Validators.required]],
    watermarkText: ['', [Validators.maxLength(200)]],
  });

  get watermarkHint(): string {
    const name = this.form.get('name')?.value ?? '';
    const displayName = name || '{Event name}';
    return `Default: ${displayName} · racephotos.example.com`;
  }

  get selectedCurrency(): string {
    return this.form.get('currency')?.value ?? 'USD';
  }

  ngOnInit(): void {
    this.titleService.setTitle('Create Event');

    // Pre-fill currency from photographer profile.
    this.store
      .select(selectProfile)
      .pipe(
        filter((p) => p !== null),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe((profile) => {
        if (profile?.defaultCurrency) {
          this.form.patchValue({ currency: profile.defaultCurrency });
        }
      });

    // Handle create failure — show snackbar.
    this.store
      .select(selectEventsError)
      .pipe(
        filter((e): e is string => e !== null),
        takeUntil(this.destroy$),
      )
      .subscribe((error) => {
        const message =
          error === 'validation_error'
            ? 'Some event details are invalid. Please check the form and try again.'
            : 'Could not create the event. Please try again.';
        this.snackBar.open(message, undefined, { duration: 6000 });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidField();
      return;
    }
    const value = this.form.getRawValue();
    const dateVal = value.date;
    this.store.dispatch(
      EventsActions.createEvent({
        event: {
          name: value.name ?? '',
          date: dateVal ? dateToIsoString(dateVal) : '',
          location: value.location ?? '',
          pricePerPhoto: value.pricePerPhoto ?? 0,
          currency: value.currency ?? 'USD',
          watermarkText: value.watermarkText ?? undefined,
        },
      }),
    );
  }

  onCancel(): void {
    void this.router.navigate(['/photographer/events']);
  }

  private focusFirstInvalidField(): void {
    const el = this.elementRef.nativeElement.querySelector(
      'input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid',
    ) as HTMLElement | null;
    el?.focus();
  }
}
