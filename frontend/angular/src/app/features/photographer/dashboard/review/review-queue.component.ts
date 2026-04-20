import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChildren } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ReviewQueueActions } from '../../../../store/review-queue/review-queue.actions';
import {
  selectReviewPhotoCount,
  selectReviewPhotos,
  selectReviewQueueError,
  selectReviewQueueLoading,
  selectReviewQueueLoadingMore,
  selectReviewQueueNextCursor,
  selectReviewQueuePaginationError,
} from '../../../../store/review-queue/review-queue.selectors';
import { selectSelectedEvent } from '../../../../store/events/events.selectors';
import { ReviewPhotoCardComponent } from './review-photo-card.component';

@Component({
  selector: 'app-review-queue',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ReviewPhotoCardComponent,
  ],
  templateUrl: './review-queue.component.html',
  styleUrl: './review-queue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewQueueComponent {
  private readonly store = inject(Store);
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly photoCards = viewChildren(ReviewPhotoCardComponent, { read: ElementRef });

  readonly loading = toSignal(this.store.select(selectReviewQueueLoading), { initialValue: false });
  readonly loadingMore = toSignal(this.store.select(selectReviewQueueLoadingMore), { initialValue: false });
  readonly paginationError = toSignal(this.store.select(selectReviewQueuePaginationError), { initialValue: null });
  readonly error = toSignal(this.store.select(selectReviewQueueError), { initialValue: null });
  readonly photos = toSignal(this.store.select(selectReviewPhotos), { initialValue: [] });
  readonly photoCount = toSignal(this.store.select(selectReviewPhotoCount), { initialValue: 0 });
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), {
    initialValue: null,
  });
  readonly nextCursor = toSignal(this.store.select(selectReviewQueueNextCursor), {
    initialValue: null,
  });

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  readonly skeletons = Array.from({ length: 8 });

  private _prevPhotoCount = 0;
  private _loadedEventId: string | null = null;

  constructor() {
    effect(() => {
      const event = this.selectedEvent();
      if (event && event.id !== this._loadedEventId) {
        this._loadedEventId = event.id;
        this.store.dispatch(ReviewQueueActions.loadReviewQueue({ eventId: event.id }));
      } else if (!event) {
        this._loadedEventId = null;
      }
    });

    effect(() => {
      const cards = this.photoCards();
      const currentCount = cards.length;
      if (currentCount > this._prevPhotoCount && this._prevPhotoCount > 0) {
        const firstNewCard = cards[this._prevPhotoCount];
        if (firstNewCard) {
          firstNewCard.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      this._prevPhotoCount = currentCount;
    });
  }

  onRefresh(): void {
    const event = this.selectedEvent();
    if (event) {
      this.store.dispatch(ReviewQueueActions.loadReviewQueue({ eventId: event.id }));
    }
  }

  onLoadMore(): void {
    const event = this.selectedEvent();
    if (event) {
      this.store.dispatch(ReviewQueueActions.loadNextPage({ eventId: event.id }));
    }
  }
}
