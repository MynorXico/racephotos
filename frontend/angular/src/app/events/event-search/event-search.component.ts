import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  computed,
  effect,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';

import { RunnerPhotosActions } from '../../store/runner-photos/runner-photos.actions';
import {
  selectRunnerPhotos,
  selectRunnerPhotosLoading,
  selectRunnerPhotosError,
  selectSearchedBib,
  selectHasSearched,
  selectHasResults,
  selectSelectedPhoto,
} from '../../store/runner-photos/runner-photos.selectors';
import { EventsActions } from '../../store/events/events.actions';
import { selectSelectedEvent, selectEventsLoading } from '../../store/events/events.selectors';
import { RunnerPhotoGridComponent } from './photo-grid/photo-grid.component';
import {
  PhotoDetailComponent,
  PhotoDetailDialogData,
} from './photo-detail/photo-detail.component';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-event-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    RunnerPhotoGridComponent,
  ],
  templateUrl: './event-search.component.html',
  styleUrl: './event-search.component.scss',
})
export class EventSearchComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly titleService = inject(Title);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  readonly bibControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^[0-9]{1,6}$/),
  ]);

  readonly photos = toSignal(this.store.select(selectRunnerPhotos), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectRunnerPhotosLoading), {
    initialValue: false,
  });
  readonly error = toSignal(this.store.select(selectRunnerPhotosError), { initialValue: null });
  readonly searchedBib = toSignal(this.store.select(selectSearchedBib), { initialValue: null });
  readonly hasSearched = toSignal(this.store.select(selectHasSearched), { initialValue: false });
  readonly hasResults = toSignal(this.store.select(selectHasResults), { initialValue: false });
  readonly selectedPhoto = toSignal(this.store.select(selectSelectedPhoto), { initialValue: null });
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), { initialValue: null });
  readonly eventLoading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });

  readonly skeletonCards = Array.from({ length: 6 });

  private readonly paramMap = toSignal(this.route.paramMap);
  readonly eventId = computed(() => this.paramMap()?.get('id') ?? '');

  private dialogRef: MatDialogRef<PhotoDetailComponent> | null = null;

  constructor() {
    // Load event metadata when route param changes.
    effect(() => {
      const id = this.eventId();
      if (id) {
        this.store.dispatch(EventsActions.loadEvent({ id }));
        this.store.dispatch(RunnerPhotosActions.clearResults());
      }
    });

    // Update page title when event name is available.
    effect(() => {
      const ev = this.selectedEvent();
      if (ev?.name) {
        this.titleService.setTitle(`${ev.name} — Find your photos`);
      }
    });

    // Open/close the detail dialog reactively when selectedPhoto changes.
    effect(() => {
      const photo = this.selectedPhoto();
      const event = this.selectedEvent();
      if (photo && event && !this.dialogRef) {
        const data: PhotoDetailDialogData = {
          photo,
          pricePerPhoto: event.pricePerPhoto,
          currency: event.currency,
        };
        this.dialogRef = this.dialog.open(PhotoDetailComponent, {
          data,
          panelClass: 'rs-photo-detail-dialog',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          maxWidth: '720px',
          width: '90vw',
        });
        this.dialogRef
          .afterClosed()
          .pipe(takeUntilDestroyed(this._destroyRef))
          .subscribe(() => {
            this.store.dispatch(RunnerPhotosActions.deselectPhoto());
            this.dialogRef = null;
          });
      } else if (!photo && this.dialogRef) {
        this.dialogRef.close();
        this.dialogRef = null;
      }
    });
  }

  ngOnInit(): void {
    this.titleService.setTitle('Find your photos');
  }

  ngOnDestroy(): void {
    this.store.dispatch(RunnerPhotosActions.clearResults());
  }

  onSubmit(): void {
    this.bibControl.markAsTouched();
    this.cdr.markForCheck();
    if (this.bibControl.invalid) return;
    const id = this.eventId();
    const bib = this.bibControl.value?.trim() ?? '';
    if (!id || !bib) return;
    this.store.dispatch(RunnerPhotosActions.searchByBib({ eventId: id, bibNumber: bib }));
  }

  onPhotoSelected(photoId: string): void {
    this.store.dispatch(RunnerPhotosActions.selectPhoto({ photoId }));
  }

  onRetry(): void {
    const id = this.eventId();
    const bib = this.searchedBib();
    if (id && bib) {
      this.store.dispatch(RunnerPhotosActions.searchByBib({ eventId: id, bibNumber: bib }));
    }
  }
}
