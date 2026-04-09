import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { PhotosActions, PhotoStatus } from '../../../store/photos/photos.actions';
import {
  selectAllPhotos,
  selectPhotosLoading,
  selectPhotosError,
  selectNextCursor,
  selectHasMorePages,
  selectActiveFilter,
  selectPhotoCount,
} from '../../../store/photos/photos.selectors';
import { selectSelectedEvent, selectEventsLoading } from '../../../store/events/events.selectors';
import { EventsActions } from '../../../store/events/events.actions';
import { PhotoCardComponent } from './photo-card/photo-card.component';

interface FilterChip { label: string; value: PhotoStatus | null }

@Component({
  selector: 'app-event-photos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PhotoCardComponent,
  ],
  templateUrl: './event-photos.component.html',
  styleUrl: './event-photos.component.scss',
})
export class EventPhotosComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(NavigationTitleService);

  readonly photos = toSignal(this.store.select(selectAllPhotos), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectPhotosLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectPhotosError), { initialValue: null });
  readonly nextCursor = toSignal(this.store.select(selectNextCursor), { initialValue: null });
  readonly hasMorePages = toSignal(this.store.select(selectHasMorePages), { initialValue: false });
  readonly activeFilter = toSignal(this.store.select(selectActiveFilter), { initialValue: null });
  readonly photoCount = toSignal(this.store.select(selectPhotoCount), { initialValue: 0 });
  readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), { initialValue: null });
  readonly eventsLoading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });

  readonly filterChips: FilterChip[] = [
    { label: 'All', value: null },
    { label: 'Indexed', value: 'indexed' },
    { label: 'Review Required', value: 'review_required' },
    { label: 'Error', value: 'error' },
    { label: 'Processing', value: 'processing' },
  ];

  readonly skeletonCards = Array.from({ length: 15 }, (_, i) => i);

  readonly isInitialLoading = computed(() => this.loading() && this.photos().length === 0);
  readonly isLoadMoreInFlight = computed(() => this.loading() && this.photos().length > 0);

  eventId = '';

  filterLabel(status: PhotoStatus | null): string {
    const chip = this.filterChips.find((c) => c.value === status);
    return chip?.label.toLowerCase() ?? '';
  }

  ngOnInit(): void {
    this.titleService.setTitle('Event Photos');
    this.eventId = this.route.snapshot.paramMap.get('id') ?? '';
    if (this.eventId) {
      this.store.dispatch(EventsActions.loadEvent({ id: this.eventId }));
      this.store.dispatch(PhotosActions.loadPhotos({ eventId: this.eventId }));
    }
  }

  ngOnDestroy(): void {
    this.store.dispatch(PhotosActions.clearPhotos());
  }

  onFilterChip(status: PhotoStatus | null): void {
    this.store.dispatch(PhotosActions.filterByStatus({ eventId: this.eventId, status }));
  }

  onLoadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.store.dispatch(PhotosActions.loadNextPage({ eventId: this.eventId, cursor }));
    }
  }

  onRetry(): void {
    this.store.dispatch(PhotosActions.loadPhotos({ eventId: this.eventId }));
  }
}
