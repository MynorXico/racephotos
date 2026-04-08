import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import {
  selectSelectedEvent,
  selectEventsLoading,
  selectEventsError,
} from '../../../../store/events/events.selectors';
import { SUPPORTED_CURRENCIES } from '../../shared/currencies.constants';
import { isoStringToDate, dateToIsoString } from '../date-utils';
import { Event } from '../event.model';

@Component({
  selector: 'app-event-edit',
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
  templateUrl: './event-edit.component.html',
  styleUrl: './event-edit.component.scss',
})
export class EventEditComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroy$ = new Subject<void>();

  readonly currencies = SUPPORTED_CURRENCIES;
  readonly loading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), { initialValue: null });

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

  private eventId = '';
  private originalValues: ReturnType<typeof this.form.getRawValue> | null = null;

  get selectedCurrency(): string {
    return this.form.get('currency')?.value ?? 'USD';
  }

  get watermarkHint(): string {
    const name = this.form.get('name')?.value ?? '';
    const displayName = name || '{Event name}';
    return `Default: ${displayName} · racephotos.example.com`;
  }

  ngOnInit(): void {
    this.titleService.setTitle('Edit Event');

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.eventId = params.get('id') ?? '';
    });

    // Patch form when event loads.
    this.store
      .select(selectSelectedEvent)
      .pipe(
        filter((e): e is Event => e !== null),
        distinctUntilChanged((a, b) => a.id === b.id),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.patchFromEvent(event);
      });

    // If event not in store, load it.
    const current = this.selectedEvent();
    if (!current && this.eventId) {
      this.store.dispatch(EventsActions.loadEvent({ id: this.eventId }));
    } else if (current && current.id === this.eventId) {
      this.patchFromEvent(current);
    }

    // Handle update failure.
    this.store
      .select(selectEventsError)
      .pipe(
        filter((e): e is string => e !== null),
        takeUntil(this.destroy$),
      )
      .subscribe((error) => {
        let message = 'Could not save changes. Please try again.';
        if (error === 'validation_error') {
          message = 'Some event details are invalid. Please check the form and try again.';
        } else if (error === 'forbidden') {
          message = "You don't have permission to edit this event.";
        }
        this.snackBar.open(message, undefined, { duration: 6000 });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private patchFromEvent(event: Event): void {
    const patch = {
      name: event.name,
      date: event.date ? isoStringToDate(event.date) : null,
      location: event.location,
      pricePerPhoto: event.pricePerPhoto,
      currency: event.currency,
      watermarkText: event.watermarkText,
    };
    this.form.patchValue(patch);
    this.originalValues = this.form.getRawValue();
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
      EventsActions.updateEvent({
        id: this.eventId,
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
    if (this.originalValues) {
      this.form.reset(this.originalValues);
    }
    void this.router.navigate(['/photographer/events', this.eventId]);
  }

  private focusFirstInvalidField(): void {
    const el = this.elementRef.nativeElement.querySelector(
      'input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid',
    ) as HTMLElement | null;
    el?.focus();
  }
}
