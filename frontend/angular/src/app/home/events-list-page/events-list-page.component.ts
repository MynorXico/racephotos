import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';

import { PublicEventsActions } from '../../store/events/events.actions';
import {
  selectPublicEvents,
  selectPublicEventsLoading,
  selectPublicEventsError,
  selectHasMorePublicEvents,
  selectPublicNextCursor,
} from '../../store/events/events.selectors';
import { EventCardComponent } from './event-card/event-card.component';

@Component({
  selector: 'app-events-list-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    EventCardComponent,
  ],
  templateUrl: './events-list-page.component.html',
  styleUrl: './events-list-page.component.scss',
})
export class EventsListPageComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(Title);
  private readonly destroy$ = new Subject<void>();

  readonly events = toSignal(this.store.select(selectPublicEvents), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectPublicEventsLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectPublicEventsError), { initialValue: null });
  readonly hasMore = toSignal(this.store.select(selectHasMorePublicEvents), { initialValue: false });
  readonly nextCursor = toSignal(this.store.select(selectPublicNextCursor), { initialValue: null });

  readonly skeletons = Array(6);

  ngOnInit(): void {
    this.titleService.setTitle('RaceShots — Find your race photos');
    this.store.dispatch(PublicEventsActions.listPublicEvents({}));

    // Show snackbar on load-more errors when cards are already visible.
    this.store
      .select(selectPublicEventsError)
      .pipe(takeUntil(this.destroy$))
      .subscribe((err) => {
        if (err && this.events().length > 0) {
          this.snackBar
            .open('Could not load more events. Tap to retry.', 'Retry', { duration: 8000 })
            .onAction()
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => {
              this.store.dispatch(
                PublicEventsActions.listPublicEvents({ cursor: this.nextCursor() ?? undefined }),
              );
            });
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onLoadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.store.dispatch(PublicEventsActions.listPublicEvents({ cursor }));
    }
  }

  onRetry(): void {
    this.store.dispatch(PublicEventsActions.listPublicEvents({}));
  }

  onCardClick(eventId: string): void {
    void this.router.navigate(['/events', eventId]);
  }
}
