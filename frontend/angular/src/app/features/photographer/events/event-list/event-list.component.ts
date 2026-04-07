import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, takeUntil, filter } from 'rxjs';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { NavigationTitleService } from '../../../../core/services/navigation-title.service';
import { EventsActions } from '../../../../store/events/events.actions';
import {
  selectAllEvents,
  selectEventsLoading,
  selectEventsError,
  selectNextCursor,
} from '../../../../store/events/events.selectors';
import { Event } from '../event.model';
import { EventArchiveDialogComponent } from '../event-archive-dialog/event-archive-dialog.component';

type EventFilter = 'all' | 'active' | 'archived';

@Component({
  selector: 'app-event-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    MatDialogModule,
  ],
  templateUrl: './event-list.component.html',
  styleUrl: './event-list.component.scss',
})
export class EventListComponent implements OnInit, OnDestroy {
  readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly titleService = inject(NavigationTitleService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectEventsError), { initialValue: null });
  readonly nextCursor = toSignal(this.store.select(selectNextCursor), { initialValue: null });
  readonly allEvents = toSignal(this.store.select(selectAllEvents), { initialValue: [] });

  readonly activeFilter = signal<EventFilter>('all');

  readonly displayedColumns = ['name', 'date', 'location', 'price', 'status', 'actions'];

  // Exposed for template usage.
  readonly EventsActions = EventsActions;

  shimmerRows = Array(5);

  get filteredEvents(): Event[] {
    const filter = this.activeFilter();
    const events = this.allEvents();
    if (filter === 'all') return events;
    return events.filter((e) => e.status === filter);
  }

  ngOnInit(): void {
    this.titleService.setTitle('My Events');
    this.store.dispatch(EventsActions.loadEvents({}));

    // Show snackbar on archive success.
    this.store
      .select(selectEventsError)
      .pipe(
        filter((e): e is string => e !== null),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.snackBar
          .open('Could not load your events.', 'Retry', { duration: 6000 })
          .onAction()
          .pipe(takeUntil(this.destroy$))
          .subscribe(() => {
            this.store.dispatch(EventsActions.loadEvents({}));
          });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setFilter(filter: EventFilter): void {
    this.activeFilter.set(filter);
  }

  onRowClick(event: Event, target: EventTarget | null): void {
    const el = target as HTMLElement;
    if (el && el.closest('[data-action]')) return;
    void this.router.navigate(['/photographer/events', event.id]);
  }

  onEdit(event: Event, $event: MouseEvent): void {
    $event.stopPropagation();
    void this.router.navigate(['/photographer/events', event.id, 'edit']);
  }

  onArchive(ev: Event, $event: MouseEvent): void {
    $event.stopPropagation();
    const dialogRef = this.dialog.open(EventArchiveDialogComponent, {
      maxWidth: '480px',
      data: { eventId: ev.id, eventName: ev.name },
    });
    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.store.dispatch(EventsActions.archiveEvent({ id: ev.id }));
        this.snackBar.open('Event archived.', undefined, { duration: 3000 });
      }
    });
  }

  onNextPage(): void {
    const cursor = this.nextCursor();
    if (cursor) {
      this.store.dispatch(EventsActions.loadEvents({ cursor }));
    }
  }

  onPreviousPage(): void {
    this.store.dispatch(EventsActions.loadEventsPreviousPage({}));
  }

  onSortChange(_sort: Sort): void {
    // Client-side sort — handled by MatSort in template.
  }
}
