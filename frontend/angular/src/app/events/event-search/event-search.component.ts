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
import { Actions, ofType } from '@ngrx/effects';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';

import { RunnerPhotosActions } from '../../store/runner-photos/runner-photos.actions';
import {
  selectRunnerPhotos,
  selectRunnerPhotosLoading,
  selectRunnerPhotosLoadingMore,
  selectRunnerPhotosError,
  selectRunnerPhotosLoadMoreError,
  selectSearchedBib,
  selectHasSearched,
  selectHasResults,
  selectSelectedPhoto,
  selectNextCursor,
  selectTotalCount,
  selectMode,
  selectHasMorePhotos,
} from '../../store/runner-photos/runner-photos.selectors';
import { EventsActions } from '../../store/events/events.actions';
import { selectSelectedEvent, selectEventsLoading } from '../../store/events/events.selectors';
import { PurchasesActions } from '../../store/purchases/purchases.actions';
import { selectActivePhotoIds } from '../../store/purchases/purchases.selectors';
import { RunnerPhotoGridComponent } from './photo-grid/photo-grid.component';
import {
  PhotoDetailComponent,
  PhotoDetailDialogData,
} from './photo-detail/photo-detail.component';
import {
  PurchaseStepperComponent,
  PurchaseStepperDialogData,
} from './purchase-stepper/purchase-stepper.component';
import { take } from 'rxjs';

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
    MatSnackBarModule,
    RunnerPhotoGridComponent,
  ],
  templateUrl: './event-search.component.html',
  styleUrl: './event-search.component.scss',
})
export class EventSearchComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly actions$ = inject(Actions);
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
  readonly loadingMore = toSignal(this.store.select(selectRunnerPhotosLoadingMore), {
    initialValue: false,
  });
  readonly error = toSignal(this.store.select(selectRunnerPhotosError), { initialValue: null });
  readonly loadMoreError = toSignal(this.store.select(selectRunnerPhotosLoadMoreError), { initialValue: null });
  readonly searchedBib = toSignal(this.store.select(selectSearchedBib), { initialValue: null });
  readonly hasSearched = toSignal(this.store.select(selectHasSearched), { initialValue: false });
  readonly hasResults = toSignal(this.store.select(selectHasResults), { initialValue: false });
  readonly selectedPhoto = toSignal(this.store.select(selectSelectedPhoto), { initialValue: null });
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), { initialValue: null });
  readonly eventLoading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
  readonly nextCursor = toSignal(this.store.select(selectNextCursor), { initialValue: null });
  readonly totalCount = toSignal(this.store.select(selectTotalCount), { initialValue: 0 });
  readonly mode = toSignal(this.store.select(selectMode), { initialValue: 'all' as const });
  readonly hasMorePhotos = toSignal(this.store.select(selectHasMorePhotos), { initialValue: false });

  readonly skeletonCards = Array.from({ length: 6 });

  private readonly paramMap = toSignal(this.route.paramMap);
  readonly eventId = computed(() => this.paramMap()?.get('id') ?? '');

  private readonly snackBar = inject(MatSnackBar);

  private dialogRef: MatDialogRef<PhotoDetailComponent> | null = null;
  private purchaseDialogRef: MatDialogRef<PurchaseStepperComponent> | null = null;
  private loadMoreSnackBarRef: MatSnackBarRef<TextOnlySnackBar> | null = null;

  constructor() {
    // Show a persistent snackbar with Retry action when load-more fails; dismiss on recovery.
    effect(() => {
      const err = this.loadMoreError();
      if (err && !this.loadMoreSnackBarRef) {
        this.loadMoreSnackBarRef = this.snackBar.open(
          'Could not load more photos — tap to retry.',
          'Retry',
          { duration: 0 },
        );
        this.loadMoreSnackBarRef
          .onAction()
          .pipe(takeUntilDestroyed(this._destroyRef))
          .subscribe(() => this.onLoadMore());
        this.loadMoreSnackBarRef
          .afterDismissed()
          .pipe(takeUntilDestroyed(this._destroyRef))
          .subscribe(() => { this.loadMoreSnackBarRef = null; });
      } else if (!err && this.loadMoreSnackBarRef) {
        this.loadMoreSnackBarRef.dismiss();
        this.loadMoreSnackBarRef = null;
      }
    });

    // Load event metadata and first page of public photos when route param changes.
    effect(() => {
      const id = this.eventId();
      if (id) {
        this.store.dispatch(EventsActions.loadEvent({ id }));
        this.store.dispatch(RunnerPhotosActions.loadEventPhotos({ eventId: id }));
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
          eventId: this.eventId(),
          eventName: event.name,
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

    // When the runner initiates a purchase: close the photo-detail dialog and open the stepper.
    this.actions$
      .pipe(ofType(PurchasesActions.initiatePurchase), takeUntilDestroyed(this._destroyRef))
      .subscribe(({ photoIds }) => {
        if (this.purchaseDialogRef) {
          return;
        }
        if (this.dialogRef) {
          this.dialogRef.close();
          this.dialogRef = null;
        }
        const data: PurchaseStepperDialogData = { photoIds };
        this.purchaseDialogRef = this.dialog.open(PurchaseStepperComponent, {
          data,
          width: '560px',
          maxWidth: '100vw',
          height: 'auto',
          maxHeight: '90vh',
          panelClass: 'purchase-stepper-dialog',
          disableClose: true,
        });
        this.purchaseDialogRef
          .afterClosed()
          .pipe(takeUntilDestroyed(this._destroyRef))
          .subscribe(() => {
            this.store
              .select(selectActivePhotoIds)
              .pipe(take(1))
              .subscribe((activeIds) => {
                if (activeIds && activeIds.length > 0) {
                  this.store.dispatch(PurchasesActions.resetPurchase());
                }
              });
            this.purchaseDialogRef = null;
          });
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

  onClearBib(): void {
    this.bibControl.reset('');
    const id = this.eventId();
    if (id) {
      this.store.dispatch(RunnerPhotosActions.loadEventPhotos({ eventId: id }));
    }
  }

  onLoadMore(): void {
    const cursor = this.nextCursor();
    const id = this.eventId();
    if (!cursor || !id) return;

    if (this.mode() === 'bib') {
      const bib = this.searchedBib();
      if (bib) {
        this.store.dispatch(RunnerPhotosActions.loadMoreBibPhotos({ eventId: id, bibNumber: bib, cursor }));
      }
    } else {
      this.store.dispatch(RunnerPhotosActions.loadMoreEventPhotos({ eventId: id, cursor }));
    }
  }

  onPhotoSelected(photoId: string): void {
    this.store.dispatch(RunnerPhotosActions.selectPhoto({ photoId }));
  }

  onRetry(): void {
    const id = this.eventId();
    if (!id) return;
    if (this.mode() === 'bib') {
      const bib = this.searchedBib();
      if (bib) {
        this.store.dispatch(RunnerPhotosActions.searchByBib({ eventId: id, bibNumber: bib }));
      }
    } else {
      this.store.dispatch(RunnerPhotosActions.loadEventPhotos({ eventId: id }));
    }
  }
}
