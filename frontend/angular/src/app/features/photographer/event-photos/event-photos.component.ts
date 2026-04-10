import {
  Component,
  OnDestroy,
  inject,
  ChangeDetectionStrategy,
  computed,
  effect,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { PhotosActions, PhotoStatusFilter } from '../../../store/photos/photos.actions';
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

interface FilterChip { label: string; value: PhotoStatusFilter | null }

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
export class EventPhotosComponent implements OnDestroy {
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

  // Derive eventId reactively from the route so that Angular component reuse
  // (navigation between different events without destroying this instance) is
  // handled correctly. Using snapshot.paramMap would only capture the ID once.
  private readonly paramMap = toSignal(this.route.paramMap);
  readonly eventId = computed(() => this.paramMap()?.get('id') ?? '');

  readonly filterChips: FilterChip[] = [
    { label: 'All',             value: null           },
    { label: 'In Progress',     value: 'in_progress'  },
    { label: 'Indexed',         value: 'indexed'      },
    { label: 'Review Required', value: 'review_required' },
    { label: 'Error',           value: 'error'        },
  ];

  readonly skeletonCards = Array.from({ length: 15 }, (_, i) => i);

  readonly isInitialLoading = computed(() => this.loading() && this.photos().length === 0);
  readonly isLoadMoreInFlight = computed(() => this.loading() && this.photos().length > 0);

  filterLabel(status: PhotoStatusFilter | null): string {
    const chip = this.filterChips.find((c) => c.value === status);
    return chip?.label.toLowerCase() ?? '';
  }

  constructor() {
    this.titleService.setTitle('Event Photos');

    // Re-load photos whenever the route's :id param changes. This handles both
    // the initial render and Angular component reuse during navigation.
    effect(() => {
      const id = this.eventId();
      if (id) {
        this.store.dispatch(PhotosActions.clearPhotos());
        this.store.dispatch(EventsActions.loadEvent({ id }));
        this.store.dispatch(PhotosActions.loadPhotos({ eventId: id }));
      }
    });
  }

  ngOnDestroy(): void {
    this.store.dispatch(PhotosActions.clearPhotos());
  }

  onFilterChip(status: PhotoStatusFilter | null): void {
    this.store.dispatch(PhotosActions.filterByStatus({ eventId: this.eventId(), status }));
  }

  onLoadMore(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.store.dispatch(PhotosActions.loadNextPage({ eventId: this.eventId(), cursor }));
    }
  }

  onRetry(): void {
    this.store.dispatch(PhotosActions.loadPhotos({ eventId: this.eventId() }));
  }
}
